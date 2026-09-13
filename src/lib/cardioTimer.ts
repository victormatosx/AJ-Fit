/**
 * Cardio finisher session state — same architectural principle as
 * `workoutSessionTimer.ts` and `restTimer.ts`: absolute timestamps are the
 * only source of truth for elapsed time, never a tick counter. A caller
 * re-invokes `computeCardioElapsedSeconds` with a fresh `nowMs` (a UI-only
 * `setInterval` or an `AppState` foreground event) and always gets the
 * chronologically correct value, including time spent backgrounded, locked,
 * or with the JS runtime suspended.
 */

export type CardioStatus = 'READY' | 'RUNNING' | 'PAUSED' | 'FINISHED';

export type CardioSession = Readonly<{
  /** Identifies one concrete cardio attempt, independent of the workout session. */
  cardioSessionId: string;
  /** Identifies the owning workout execution — never a T001-T090 template. */
  workoutSessionId: string;
  status: CardioStatus;
  /** Epoch ms. `null` until `startCardio` runs. */
  cardioStartedAt: number | null;
  /** Epoch ms. `null` until `finishCardio` runs. */
  cardioFinishedAt: number | null;
  /** Epoch ms for the current pause, otherwise null. */
  cardioPausedAt: number | null;
  /** Accumulated completed pause intervals. Running time never includes it. */
  accumulatedPausedMs: number;
  /** Original prescription-derived target, in seconds — never mutated after creation. */
  plannedDurationSeconds: number;
  /** `plannedDurationSeconds` plus any `extendCardioTarget` calls — this attempt's live goal. */
  targetDurationSeconds: number;
  /** Frozen the instant `finishCardio` runs. `null` while READY/RUNNING. */
  actualDurationSeconds: number | null;
}>;

/** Absolute cap on how far `targetDurationSeconds` can be extended — guards against runaway taps, not a real-world limit. */
export const MAX_CARDIO_TARGET_SECONDS = 3 * 60 * 60; // 3h

function assertFiniteInteger(value: number, field: string, minimum: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${field} must be an integer >= ${minimum}`);
  }
}

function assertNonEmptyId(value: string, field: string): void {
  if (value.trim().length === 0) throw new RangeError(`${field} must not be empty`);
}

export type CreateCardioSessionInput = Readonly<{
  cardioSessionId: string;
  workoutSessionId: string;
  plannedDurationSeconds: number;
}>;

/** Fresh `READY` state — nothing counts as cardio time until `startCardio` runs (docs §4: guarding pesos/deslocamento até a esteira). */
export function createCardioSession(input: CreateCardioSessionInput): CardioSession {
  assertNonEmptyId(input.cardioSessionId, 'cardioSessionId');
  assertNonEmptyId(input.workoutSessionId, 'workoutSessionId');
  assertFiniteInteger(input.plannedDurationSeconds, 'plannedDurationSeconds', 1);
  return {
    cardioSessionId: input.cardioSessionId,
    workoutSessionId: input.workoutSessionId,
    status: 'READY',
    cardioStartedAt: null,
    cardioFinishedAt: null,
    cardioPausedAt: null,
    accumulatedPausedMs: 0,
    plannedDurationSeconds: input.plannedDurationSeconds,
    targetDurationSeconds: input.plannedDurationSeconds,
    actualDurationSeconds: null,
  };
}

/** No-op if not `READY` — a double tap or a stale callback can never rewind an in-progress/finished attempt's clock. */
export function startCardio(session: CardioSession, nowMs: number): CardioSession {
  if (session.status !== 'READY') return session;
  return { ...session, status: 'RUNNING', cardioStartedAt: nowMs };
}

/** Wall-clock elapsed seconds for the current status — never a tick count (see module doc). */
export function computeCardioElapsedSeconds(session: CardioSession, nowMs: number): number {
  if (session.status === 'READY') return 0;
  if (session.status === 'FINISHED') return session.actualDurationSeconds ?? 0;
  const effectiveNow = session.status === 'PAUSED'
    ? session.cardioPausedAt ?? nowMs
    : nowMs;
  return Math.max(0, Math.floor(
    (effectiveNow - (session.cardioStartedAt ?? effectiveNow) - session.accumulatedPausedMs) / 1000,
  ));
}

/** Manual pause; backgrounding the app deliberately does not pause cardio. */
export function pauseCardio(session: CardioSession, nowMs: number): CardioSession {
  if (session.status !== 'RUNNING') return session;
  return { ...session, status: 'PAUSED', cardioPausedAt: nowMs };
}

/** Resumes from the same elapsed timestamp without counting paused wall time. */
export function resumeCardio(session: CardioSession, nowMs: number): CardioSession {
  if (session.status !== 'PAUSED' || session.cardioPausedAt === null) return session;
  return {
    ...session,
    status: 'RUNNING',
    cardioPausedAt: null,
    accumulatedPausedMs:
      session.accumulatedPausedMs + Math.max(0, nowMs - session.cardioPausedAt),
  };
}

export function remainingCardioSeconds(elapsedSeconds: number, targetDurationSeconds: number): number {
  return Math.max(0, targetDurationSeconds - elapsedSeconds);
}

/** Clamped to `[0, 1]` — progress UI treats "past the goal" as simply full, never overflowing. */
export function cardioProgressRatio(elapsedSeconds: number, targetDurationSeconds: number): number {
  if (targetDurationSeconds <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedSeconds / targetDurationSeconds));
}

/**
 * Only meaningful while `RUNNING` — extending a `READY` (nothing started
 * yet) or `FINISHED` (already frozen) session is a no-op. Never touches
 * `cardioStartedAt`/elapsed time, only the live goal (docs §8).
 */
export function extendCardioTarget(session: CardioSession, addSeconds: number): CardioSession {
  assertFiniteInteger(addSeconds, 'addSeconds', 1);
  if (session.status !== 'RUNNING' && session.status !== 'PAUSED') return session;
  const nextTarget = Math.min(MAX_CARDIO_TARGET_SECONDS, session.targetDurationSeconds + addSeconds);
  if (nextTarget === session.targetDurationSeconds) return session;
  return { ...session, targetDurationSeconds: nextTarget };
}

/**
 * Freezes `actualDurationSeconds` at whatever was actually elapsed —
 * never clamped to the target, whether finishing early (docs §10) or
 * well past it (docs §11). No-op once already `FINISHED`.
 */
export function finishCardio(session: CardioSession, nowMs: number): CardioSession {
  if (session.status === 'FINISHED') return session;
  const actualDurationSeconds = computeCardioElapsedSeconds(session, nowMs);
  return {
    ...session,
    status: 'FINISHED',
    cardioFinishedAt: nowMs,
    cardioPausedAt: null,
    actualDurationSeconds,
  };
}

/**
 * Detects a target-reached transition exactly once per target value — the
 * caller passes the elapsed seconds it observed on the previous tick and
 * the current one. Raising the target via `extendCardioTarget` naturally
 * re-arms this: the next crossing compares against the new, higher target
 * (docs §16 — no repeat-firing while `elapsed >= target` holds, but a fresh
 * celebration once a *raised* target is reached again).
 */
export function crossedCardioTarget(
  previousElapsedSeconds: number,
  elapsedSeconds: number,
  targetDurationSeconds: number,
): boolean {
  return previousElapsedSeconds < targetDurationSeconds && elapsedSeconds >= targetDurationSeconds;
}

/**
 * Parses catalog-authored free text like `"10-20 min"` or `"20 min"` into a
 * concrete target — the composer (`composition.ts`) never lets an empty/
 * missing duration survive into a `FinalCardioFinisher`, so this always has
 * digits to work with in practice; the fallback below only guards against a
 * genuinely malformed string reaching here some other way.
 *
 * A range picks its upper bound: it reads as "up to N minutes", which stays
 * generous while `finishCardio` never forces the user past it (docs §10).
 */
export function parsePrescribedCardioDurationSeconds(duration: string): number {
  const FALLBACK_SECONDS = 15 * 60;
  const matches = duration.match(/\d+/g);
  if (!matches || matches.length === 0) return FALLBACK_SECONDS;
  const minutes = Math.max(...matches.map((value) => parseInt(value, 10)));
  if (!Number.isFinite(minutes) || minutes <= 0) return FALLBACK_SECONDS;
  return minutes * 60;
}

/** Centralized clock formatting (docs §18) — `m:ss` under an hour, `h:mm:ss` at/after it. */
export function formatCardioClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function parseCardioSession(value: unknown): CardioSession | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;

  const stringFields = ['cardioSessionId', 'workoutSessionId'] as const;
  if (stringFields.some((field) =>
    typeof candidate[field] !== 'string' || (candidate[field] as string).trim().length === 0
  )) return null;

  if (
    candidate.status !== 'READY' &&
    candidate.status !== 'RUNNING' &&
    candidate.status !== 'PAUSED' &&
    candidate.status !== 'FINISHED'
  ) {
    return null;
  }

  const numberOrNullFields = ['cardioStartedAt', 'cardioFinishedAt', 'actualDurationSeconds'] as const;
  if (numberOrNullFields.some((field) => {
    const v = candidate[field];
    return v !== null && (typeof v !== 'number' || !Number.isFinite(v));
  })) return null;

  const requiredNumberFields = ['plannedDurationSeconds', 'targetDurationSeconds'] as const;
  if (requiredNumberFields.some((field) =>
    typeof candidate[field] !== 'number' || !Number.isFinite(candidate[field]) || (candidate[field] as number) <= 0
  )) return null;

  const cardioPausedAt = candidate.cardioPausedAt ?? null;
  const accumulatedPausedMs = candidate.accumulatedPausedMs ?? 0;
  if (
    cardioPausedAt !== null &&
    (typeof cardioPausedAt !== 'number' || !Number.isInteger(cardioPausedAt) || cardioPausedAt < 0)
  ) return null;
  if (
    typeof accumulatedPausedMs !== 'number' ||
    !Number.isInteger(accumulatedPausedMs) ||
    accumulatedPausedMs < 0
  ) return null;

  const session = {
    ...candidate,
    cardioPausedAt,
    accumulatedPausedMs,
  } as unknown as CardioSession;
  if (session.status !== 'READY' && session.cardioStartedAt === null) return null;
  if (session.status === 'PAUSED' && session.cardioPausedAt === null) return null;
  if (session.status !== 'PAUSED' && session.cardioPausedAt !== null) return null;
  if (session.status === 'FINISHED' && session.cardioFinishedAt === null) return null;
  if (session.targetDurationSeconds < session.plannedDurationSeconds) return null;

  return session;
}
