/**
 * "Você tem um treino pendente" — the Jotinha notice, rebuilt for free
 * rotation.
 *
 * ## Why it disappeared
 *
 * The old notice was produced by `resolveTodaysSchedule` as the BLOCKING
 * status `MISSED_SESSION_DECISION_REQUIRED`: it stood between the user and
 * training until answered, and `FOLLOW_SCHEDULE` consumed one rotation
 * position per elapsed recommended day. Decision 2.b retired the punitive
 * mechanics, and `resolveFreeSchedule` cannot report that status at all — so
 * the notice lost its only producer.
 *
 * What was punitive was the BLOCK, not the question. This module brings the
 * question back as an offer: detection only, no status, nothing gated on the
 * answer. The user can ignore it and train whatever they like.
 *
 * ## What "really pending" means now
 *
 * Under free rotation the suggestion does NOT move when a day passes without
 * training — miss Saturday's A and A is still what Monday offers. So nothing
 * is ever lost, and the pending session is simply the session the rotation
 * still offers. The notice is therefore informational, and the only decision
 * with a state effect is the one to SKIP:
 *
 * BOTH answers are selections of the pending session, so both advance the
 * suggestion immediately — selecting advances the rotation whether or not the
 * workout is then started or abandoned. ONE position, not one per elapsed
 * day: in free rotation sessions are not owed to days, so a three-week
 * absence still moves the rotation by exactly one. Finalizing afterwards
 * recomputes the same pointer and reports `UNCHANGED`, so it can never move
 * twice. No retroactive execution is ever written — the workout is started
 * today and dated today.
 *
 * What the two answers differ in is only which session the user then trains:
 *
 *  - `CONTINUE_SEQUENCE` ("refazer hoje") trains the session just consumed
 *    off the rotation, so the caller must carry it explicitly rather than
 *    re-read the pointer, which has already moved past it.
 *  - `FOLLOW_SCHEDULE` ("seguir o planejamento") trains whatever the rotation
 *    now offers.
 *
 * ## Identity
 *
 * Keyed by `(programInstanceId, missedScheduledDate)` and NOT by the session
 * index, because `FOLLOW_SCHEDULE` changes which session is pending. Keying
 * on the session would make the notice reappear for the next letter the
 * moment the user skipped one — asking again about the same missed day.
 *
 * ## Why no "was the rotation reorganized?" signal
 *
 * An earlier version inferred one from `scheduleState.updatedAt`, treating
 * any write as a deliberate selection. That field is touched by thirteen
 * distinct writers — every completion through `finalizeWorkoutSession`
 * included — so it conflates "the user repositioned on Sunday" with "a
 * workout finalized on Sunday", and a completion could silently suppress a
 * legitimate notice. There is no per-selection timestamp in the schema, and
 * adding one would mean a new Firestore field, a Rules change and a redeploy.
 *
 * It is not needed: what the signal was reaching for — never calling an
 * already-handled day missed — is answered precisely by the two execution
 * sets below, and "don't ask twice" is answered by `decidedNoticeIds`. A
 * reorganization the user performed with full knowledge of a skipped day
 * still yields at most one dismissible question about that day.
 */
import {
  addDaysLocal,
  trainingDayOccurrences,
  weekdayOfLocalDate,
  type LocalDate,
} from './calendar';
import { suggestionAfter } from './sessionSuggestion';
import type { Weekday } from '../state/AppState';

export interface MissedSessionNotice {
  /** The first recommended day that went by with no workout. */
  missedScheduledDate: LocalDate;
  /** The session the rotation still offers — what `CONTINUE_SEQUENCE` does today. */
  pendingSessionIndex: number;
  /** Where the rotation lands if the user declines — what `FOLLOW_SCHEDULE` selects. */
  skipToSessionIndex: number;
  /** Stable per missed occurrence; see the identity note above. */
  noticeId: string;
  /** How many recommended days went by unused. Informative only — it changes no decision. */
  missedOccurrenceCount: number;
}

export interface MissedSessionNoticeInput {
  hasActiveProgram: boolean;
  sessionCount: number;
  programInstanceId: string | null;
  /** `scheduleConfig.trainingDays` — the user's recommended weekdays. */
  recommendedWeekdays: readonly Weekday[];
  /**
   * `scheduleState.lastPerformedLocalDate`. A PROJECTION, never the authority:
   * it is instance-scoped, absent on documents written before the field
   * existed, and lags inside the crash window where an execution committed
   * but its schedule write did not. Used only as one more candidate for the
   * last real effort.
   */
  lastPerformedLocalDate: LocalDate | null;
  /**
   * Local dates of REAL terminal executions (`COMPLETED`/`PARTIALLY_COMPLETED`),
   * keyed by the day the effort happened. This is the authority for "was this
   * day trained": a day present here can never be reported as missed, no
   * matter what the schedule pointer says.
   */
  performedLocalDates: ReadonlySet<LocalDate>;
  /**
   * `scheduledLocalDate` of REAL terminal executions — the OPPORTUNITY each
   * one consumed, as opposed to the day the effort happened.
   *
   * This is what covers an anticipated session: finishing Saturday's workout
   * on Friday leaves Saturday with no effort of its own, and reporting it as
   * missed would be telling the user they skipped a session they had already
   * done. The two sets differ only for anticipated or deferred executions,
   * which is exactly the case that needs it.
   */
  coveredScheduledLocalDates: ReadonlySet<LocalDate>;
  /** `scheduleState.suggestedSessionIndex` — what the rotation currently offers. */
  suggestedSessionIndex: number;
  todayLocalDate: LocalDate;
  /** True once today's single credited workout exists. */
  workoutCreditedToday: boolean;
  /** Notice ids already answered (or dismissed) on this device. */
  decidedNoticeIds: readonly string[];
}

export function missedSessionNoticeId(
  programInstanceId: string | null,
  missedScheduledDate: LocalDate,
): string {
  return `${programInstanceId ?? 'no-instance'}:${missedScheduledDate}`;
}

/**
 * `null` whenever there is nothing honest to ask about. Every guard below is
 * a case where showing the notice would be wrong, not merely unnecessary.
 */
export function detectMissedSessionNotice(
  input: MissedSessionNoticeInput,
): MissedSessionNotice | null {
  if (!input.hasActiveProgram || input.sessionCount <= 0) return null;
  // No recommended days configured means nothing was ever expected on any
  // particular day, so no day can have been missed.
  if (input.recommendedWeekdays.length === 0) return null;
  // Already trained today: there is no pending question, and the daily limit
  // state speaks for itself.
  if (input.workoutCreditedToday) return null;
  // Rest day: the notice must not interrupt a day the user was never
  // expected to train. It waits for the next recommended day.
  if (!input.recommendedWeekdays.includes(weekdayOfLocalDate(input.todayLocalDate))) return null;
  // The last real effort is the LATEST of every signal available, so a
  // lagging or instance-scoped pointer can never make an already-trained day
  // look missed. Real executions win over the projection by construction:
  // taking the maximum means an execution the pointer does not know about
  // still moves the window forward.
  const lastEffort = [
    input.lastPerformedLocalDate,
    ...input.performedLocalDates,
  ].reduce<LocalDate | null>(
    (latest, candidate) => (candidate && (!latest || candidate > latest) ? candidate : latest),
    null,
  );
  // An account that never trained has no missed session — only a first one
  // ahead of it. Nagging a brand-new user about a "pending" workout they
  // never had would be plainly wrong.
  if (!lastEffort) return null;

  // Recommended days strictly after the last real effort and strictly BEFORE
  // today. Today is excluded deliberately: today is still available, so it is
  // not missed — it is the day being offered.
  const candidates = trainingDayOccurrences(
    input.recommendedWeekdays,
    lastEffort,
    addDaysLocal(input.todayLocalDate, -1),
  ).filter((date) => (
    // Trained ON that day — it was never missed. Reachable whenever the
    // effort belongs to another program instance, or predates the pointer.
    !input.performedLocalDates.has(date)
    // Or trained AS that day's session, ahead of time. Both are "already
    // realizado"; neither may be presented as pending.
    && !input.coveredScheduledLocalDates.has(date)
  ));
  if (candidates.length === 0) return null;

  const noticeId = missedSessionNoticeId(input.programInstanceId, candidates[0]);
  if (input.decidedNoticeIds.includes(noticeId)) return null;

  return {
    missedScheduledDate: candidates[0],
    pendingSessionIndex: input.suggestedSessionIndex,
    skipToSessionIndex: suggestionAfter(input.suggestedSessionIndex, input.sessionCount),
    noticeId,
    missedOccurrenceCount: candidates.length,
  };
}
