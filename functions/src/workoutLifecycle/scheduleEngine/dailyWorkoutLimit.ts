// GENERATED FILE — do not edit directly.
// Synced from src/scheduleEngine by scripts/syncScheduleEngineToFunctions.cjs.
// Edit the source file in src/scheduleEngine/ and re-run `npm run sync:scheduleEngine`.
import type { LocalDate } from './calendar';

/**
 * One completed workout per day.
 *
 * The product allows the user to pick ANY session on ANY day, but credits at
 * most one workout per calendar day. That is a hard limit, not a nudge, so it
 * cannot live in the UI: it is enforced by a single authoritative document per
 * user and day, written inside `finalizeWorkoutSession`'s own transaction.
 *
 *     users/{uid}/workoutDailyCompletions/{performedLocalDate}
 *
 * ## Why this shape
 *
 *  - **One document per (user, day)** is the mutual exclusion itself. The
 *    finalize transaction READS it and then writes it, so Firestore aborts and
 *    retries any transaction whose read is invalidated before commit. Two
 *    devices finalizing two different sessions at the same instant therefore
 *    serialize, and exactly one wins. (A bare `create()` would also be
 *    exclusive, but it fails with a non-retryable ALREADY_EXISTS, which would
 *    turn a legitimate replay into an error instead of an idempotent success.)
 *  - **User-scoped, not program-scoped**, so switching session, program or
 *    program instance cannot buy a second workout for the same day.
 *  - **Keyed by `performedLocalDate`**, which `finalizeWorkoutSession` has
 *    already validated to equal the day the EXECUTION was created, measured in
 *    the user's schedule timezone. The limit therefore shares the day boundary
 *    with the completion it guards, by construction. (This is deliberately the
 *    schedule timezone and not `streakSettings.timezone`: the streak counts
 *    activity days across two independent sources, while this guards the
 *    completion whose own date it is keyed by.)
 *  - **Only ever created going forward.** Days that already hold two
 *    completions from before this rule keep both; nothing is rewritten, and
 *    the limit never retroactively invalidates history.
 *
 * Pure module, synchronized into `functions/` by
 * `scripts/syncScheduleEngineToFunctions.cjs`, so the callable that writes the
 * marker and the client that reads it can never disagree about its shape.
 */

export const WORKOUT_DAILY_COMPLETIONS_COLLECTION = 'workoutDailyCompletions';

/** Statuses that count as "the user trained" and therefore consume the day. */
export const DAILY_LIMIT_CONSUMING_STATUSES = ['COMPLETED', 'PARTIALLY_COMPLETED'] as const;

export type DailyLimitConsumingStatus = (typeof DAILY_LIMIT_CONSUMING_STATUSES)[number];

/**
 * `PARTIALLY_COMPLETED` consumes the day exactly like `COMPLETED`: both are
 * credited as a performed workout everywhere else in the app (frequency, the
 * streak, adherence), so letting a partial finish leave the day open would let
 * a user bank two credited sessions. `ABANDONED` and `IN_PROGRESS` never
 * consume it — abandoning costs nothing, which is what keeps the existing
 * restart-after-abandon and crash-recovery paths working untouched.
 */
export function consumesDailyLimit(status: unknown): status is DailyLimitConsumingStatus {
  return typeof status === 'string'
    && (DAILY_LIMIT_CONSUMING_STATUSES as readonly string[]).includes(status);
}

/** Shape of the marker document. */
export interface WorkoutDailyCompletion {
  localDate: LocalDate;
  /** The execution that consumed the day — what makes a replay recognizable. */
  executionId: string;
  programInstanceId: string;
  sessionIndex: number;
}

export type DailyLimitDecision =
  /** No workout credited today yet: this completion may proceed and claim the day. */
  | { status: 'AVAILABLE' }
  /** The very same execution already claimed it — a replay, not a second workout. */
  | { status: 'ALREADY_CLAIMED_BY_THIS_EXECUTION' }
  /** A different workout already consumed today. */
  | {
      status: 'LIMIT_REACHED';
      reason: 'MARKER_PRESENT' | 'CREDITED_EXECUTION_TODAY' | 'LAST_PERFORMED_TODAY';
    };

export interface DailyLimitInput {
  /** `performedLocalDate` of the execution being finalized. */
  performedLocalDate: LocalDate;
  /** Id of the execution being finalized. */
  executionId: string;
  /** The marker document for `performedLocalDate`, or `null` when absent. */
  marker: { executionId?: unknown } | null;
  /**
   * Ids of OTHER executions already credited on `performedLocalDate`, found
   * by querying `workoutExecutions` on that date inside the same transaction.
   *
   * This is the program-INDEPENDENT transition guard. It exists because
   * completions committed before this rule wrote no marker, and because the
   * marker is the only user-scoped fact: a user who completed a workout on
   * instance A and then switched to instance B would otherwise find B's
   * rotation state empty and be granted a second workout for the same day.
   * Querying the executions themselves sees across every program and
   * instance, so the switch buys nothing.
   *
   * Only consulted when the marker is absent — i.e. the first completion of
   * any given day — so it costs one indexed equality query per day, never
   * one per finalize.
   */
  creditedExecutionIdsToday?: readonly string[];
  /**
   * `scheduleState.lastPerformedLocalDate` for the active instance.
   *
   * Second transition signal, kept for one blind spot the query cannot cover:
   * a legacy execution persisted with NO `performedLocalDate` at all is never
   * returned by an equality query on that field, yet its completion did write
   * this. Instance-scoped and therefore best-effort — the marker is the
   * primary control, the query is the general guard, and this is the
   * last-resort backstop for pre-field data.
   */
  lastPerformedLocalDate?: string | null;
}

export function resolveDailyLimit(input: DailyLimitInput): DailyLimitDecision {
  if (input.marker !== null) {
    return input.marker.executionId === input.executionId
      ? { status: 'ALREADY_CLAIMED_BY_THIS_EXECUTION' }
      : { status: 'LIMIT_REACHED', reason: 'MARKER_PRESENT' };
  }
  // Program-independent: any other execution already credited on this day
  // closes it, whichever program or instance it belonged to.
  if ((input.creditedExecutionIdsToday ?? []).some(id => id !== input.executionId)) {
    return { status: 'LIMIT_REACHED', reason: 'CREDITED_EXECUTION_TODAY' };
  }
  if (input.lastPerformedLocalDate === input.performedLocalDate) {
    return { status: 'LIMIT_REACHED', reason: 'LAST_PERFORMED_TODAY' };
  }
  return { status: 'AVAILABLE' };
}
