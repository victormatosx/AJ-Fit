export type ActiveRest = Readonly<{
  /** Identifies one concrete rest, independently from the workout session. */
  restId: string;
  /** Identifies one concrete workout execution, never a T001-T090 template. */
  workoutSessionId: string;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Epoch milliseconds and the countdown's source of truth. */
  endsAt: number;
  initialDurationSeconds: number;
  exerciseId: string;
  /** Zero-based set index within the exercise. */
  setIndex: number;
  totalSets: number;
}>;

export type RestTimerState =
  | Readonly<{ status: 'idle'; rest: null }>
  | Readonly<{ status: 'running'; rest: ActiveRest }>
  | Readonly<{ status: 'expired'; rest: ActiveRest }>;

export const IDLE_REST_TIMER_STATE: RestTimerState = { status: 'idle', rest: null };

export type CreateRestInput = Readonly<{
  restId: string;
  workoutSessionId: string;
  startedAt: number;
  durationSeconds: number;
  exerciseId: string;
  setIndex: number;
  totalSets: number;
}>;

function assertFiniteInteger(value: number, field: string, minimum: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${field} must be an integer >= ${minimum}`);
  }
}

function assertNonEmptyId(value: string, field: string): void {
  if (value.trim().length === 0) throw new RangeError(`${field} must not be empty`);
}

export function createRest(input: CreateRestInput): ActiveRest {
  assertNonEmptyId(input.restId, 'restId');
  assertNonEmptyId(input.workoutSessionId, 'workoutSessionId');
  assertNonEmptyId(input.exerciseId, 'exerciseId');
  assertFiniteInteger(input.startedAt, 'startedAt', 0);
  assertFiniteInteger(input.durationSeconds, 'durationSeconds', 1);
  assertFiniteInteger(input.setIndex, 'setIndex', 0);
  assertFiniteInteger(input.totalSets, 'totalSets', 1);
  if (input.setIndex >= input.totalSets) {
    throw new RangeError('setIndex must be lower than totalSets');
  }

  return {
    restId: input.restId,
    workoutSessionId: input.workoutSessionId,
    startedAt: input.startedAt,
    endsAt: input.startedAt + input.durationSeconds * 1000,
    initialDurationSeconds: input.durationSeconds,
    exerciseId: input.exerciseId,
    setIndex: input.setIndex,
    totalSets: input.totalSets,
  };
}

export function computeRemainingSeconds(rest: ActiveRest, now: number): number {
  return Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
}

export function isRestExpired(rest: ActiveRest, now: number): boolean {
  return now >= rest.endsAt;
}

export function addRestSeconds(rest: ActiveRest, seconds: number): ActiveRest {
  assertFiniteInteger(seconds, 'seconds', 1);
  return { ...rest, endsAt: rest.endsAt + seconds * 1000 };
}

/**
 * Preserves the existing countdown-bar direction: full at rest start and
 * empty at expiry. The effective duration is `endsAt - startedAt`, so +15s
 * extends both the deadline and the bar's denominator. Clamping also covers
 * delayed renders and backwards wall-clock adjustments safely.
 */
export function computeRestProgress(rest: ActiveRest, now: number): number {
  const effectiveDurationMs = rest.endsAt - rest.startedAt;
  if (effectiveDurationMs <= 0) return 0;
  const remainingMs = Math.min(effectiveDurationMs, Math.max(0, rest.endsAt - now));
  return remainingMs / effectiveDurationMs;
}

export function reconcileRestExpiration(
  state: RestTimerState,
  now: number,
): RestTimerState {
  if (state.status !== 'running' || !isRestExpired(state.rest, now)) return state;
  return { status: 'expired', rest: state.rest };
}

export type RestTransitionConsumption = Readonly<{
  state: RestTimerState;
  consumed: boolean;
}>;

/** Claims an automatic expiry. Running/idle rests cannot be consumed. */
export function consumeExpiredRest(
  state: RestTimerState,
  restId: string,
): RestTransitionConsumption {
  if (state.status !== 'expired' || state.rest.restId !== restId) {
    return { state, consumed: false };
  }
  return { state: IDLE_REST_TIMER_STATE, consumed: true };
}

/** Claims an explicit skip/cancel before an expiry consumer can do so. */
export function cancelRestTransition(
  state: RestTimerState,
  restId: string,
): RestTransitionConsumption {
  if (state.status === 'idle' || state.rest.restId !== restId) {
    return { state, consumed: false };
  }
  return { state: IDLE_REST_TIMER_STATE, consumed: true };
}

export function ensureWorkoutSessionId(
  current: string | null,
  createId: () => string,
): string {
  return current ?? createId();
}

export function parseActiveRest(value: unknown): ActiveRest | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const stringFields = ['restId', 'workoutSessionId', 'exerciseId'] as const;
  if (stringFields.some((field) =>
    typeof candidate[field] !== 'string' || candidate[field].trim().length === 0
  )) return null;

  const numberFields = [
    'startedAt',
    'endsAt',
    'initialDurationSeconds',
    'setIndex',
    'totalSets',
  ] as const;
  if (numberFields.some((field) =>
    typeof candidate[field] !== 'number' ||
    !Number.isFinite(candidate[field]) ||
    !Number.isInteger(candidate[field])
  )) return null;

  const rest = candidate as unknown as ActiveRest;
  if (
    rest.startedAt < 0 ||
    rest.endsAt <= rest.startedAt ||
    rest.initialDurationSeconds < 1 ||
    rest.setIndex < 0 ||
    rest.totalSets < 1 ||
    rest.setIndex >= rest.totalSets
  ) return null;
  return rest;
}
