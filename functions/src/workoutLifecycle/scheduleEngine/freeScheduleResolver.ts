// GENERATED FILE — do not edit directly.
// Synced from src/scheduleEngine by scripts/syncScheduleEngineToFunctions.cjs.
// Edit the source file in src/scheduleEngine/ and re-run `npm run sync:scheduleEngine`.
import { nextTrainingDayOnOrAfter, weekdayOfLocalDate, type LocalDate } from './calendar';
import { readSessionSuggestion } from './sessionSuggestion';
import type { Weekday } from './weekday';

/**
 * Schedule resolution under the new training model.
 *
 * Deliberately a NEW module rather than an edit to `resolver.ts`. The old
 * resolver is still wired into `AppShell`, `TreinoScreen`, `HomeScreen`, the
 * widget projection and the daily notifications, all of which currently carry
 * concurrent work from other collaborators; rewriting it in place would change
 * their behavior before their copy adaptations exist. This module is complete
 * and independently tested, and the switch-over is a one-line change in
 * `useWorkoutSchedule` once those screens are integrated — see
 * `docs/.../B-1.2` notes in the hand-off report.
 *
 * ## What changed, semantically
 *
 * The old resolver answered "may the user train right now, and with what?"
 * and could say no — `REST_DAY`, `SCHEDULE_SETUP_REQUIRED`, or
 * `MISSED_SESSION_DECISION_REQUIRED`, which demanded a modal decision before
 * training could continue. Recommended weekdays were obligations.
 *
 * This one answers a strictly smaller question: "what do we OFFER, and is
 * today one of the days the user asked to be nudged on?" It can never refuse.
 * There is no rest-day block, no setup gate (a user with no configured days
 * can still train), and no missed-session concept at all: `cursorDate` and
 * `pendingMissDecision` are not even read.
 *
 * Everything calendar-shaped it returns is INFORMATIVE — copy, badges and the
 * friendly reminder — never authorization.
 *
 * ## The one refusal that IS a product rule
 *
 * At most one workout is credited per day. That is not a calendar constraint
 * (it does not care which day of the week it is), so it survives the move:
 * once today is claimed, the resolution is `TODAY_COMPLETED`. Selection stays
 * available — the user may still set which session comes next — but starting
 * another execution is refused, here, in Firestore Rules and in
 * `finalizeWorkoutSession`'s transaction.
 */

interface FreeScheduleOffer {
  /** What to offer: the user's own last intentional choice, or the rotation's position. */
  sessionIndex: number;
  /** `scheduleState.suggestionVersion`, to be carried by the execution this starts. */
  suggestionVersion: number;
  /** Informative: is today one of the user's recommended weekdays? */
  todayIsRecommended: boolean;
  /** Informative: next recommended day on/after tomorrow; `null` when none are configured. */
  nextRecommendedLocalDate: LocalDate | null;
}

export type FreeScheduleResolution =
  | { status: 'PROGRAM_NOT_AVAILABLE' }
  /**
   * Today's workout is already credited. `sessionIndex` is what TOMORROW will
   * open on, so the UI can say "Treino de hoje concluído. Volte amanhã para o
   * próximo!" and still name it. Starting another execution today is refused.
   */
  | (FreeScheduleOffer & { status: 'TODAY_COMPLETED'; canStartWorkout: false })
  | (FreeScheduleOffer & { status: 'SESSION_READY'; canStartWorkout: true });

export interface FreeScheduleResolverInput {
  hasActiveProgram: boolean;
  /** `program.sessions.length`. Zero means there is nothing to offer. */
  sessionCount: number;
  /** Raw `scheduleState` document, or `null` when the rotation was never walked. */
  state: {
    suggestedSessionIndex?: unknown;
    nextSessionIndex?: unknown;
    suggestionVersion?: unknown;
    lastSelectedSessionIndex?: unknown;
  } | null;
  /** The user's preferred weekdays. Empty/absent is perfectly valid now. */
  recommendedWeekdays?: readonly Weekday[];
  todayLocalDate: LocalDate;
  /**
   * Whether today already has a credited workout — the presence of
   * `users/{uid}/workoutDailyCompletions/{today}`. Defaults to `false`.
   */
  workoutCreditedToday?: boolean;
}

export function resolveFreeSchedule(input: FreeScheduleResolverInput): FreeScheduleResolution {
  if (!input.hasActiveProgram || input.sessionCount <= 0) return { status: 'PROGRAM_NOT_AVAILABLE' };

  const suggestion = readSessionSuggestion(input.state, input.sessionCount);
  const recommended = input.recommendedWeekdays ?? [];
  const offer: FreeScheduleOffer = {
    sessionIndex: suggestion.suggestedSessionIndex,
    suggestionVersion: suggestion.version,
    todayIsRecommended: recommended.includes(weekdayOfLocalDate(input.todayLocalDate)),
    nextRecommendedLocalDate: nextRecommendedDate(recommended, input.todayLocalDate),
  };

  return input.workoutCreditedToday === true
    ? { ...offer, status: 'TODAY_COMPLETED', canStartWorkout: false }
    : { ...offer, status: 'SESSION_READY', canStartWorkout: true };
}

/**
 * Next recommended day strictly after today, or `null` when the user
 * configured none. Strictly after on purpose: "próximo treino recomendado" is
 * about what comes next, and today is already described by
 * `todayIsRecommended`.
 */
export function nextRecommendedDate(
  recommendedWeekdays: readonly Weekday[],
  todayLocalDate: LocalDate,
): LocalDate | null {
  if (recommendedWeekdays.length === 0) return null;
  // `nextTrainingDayOnOrAfter` throws only on an empty set, already excluded.
  const tomorrow = addOneDay(todayLocalDate);
  return nextTrainingDayOnOrAfter(recommendedWeekdays, tomorrow);
}

function addOneDay(localDate: LocalDate): LocalDate {
  const [year, month, day] = localDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Decision 2.b, encoded: whether to nudge the user on a recommended day.
 *
 * The product removed punitive notifications. There is deliberately no
 * `MISSED_WORKOUT` outcome in this union — a day the user did not train is
 * simply a day, and nothing is sent about it after the fact. The only
 * notification this can ask for is a same-day, forward-looking nudge on a day
 * the user themselves marked as preferred.
 *
 * Returns only the DECISION, never any text, so it carries no dependency on
 * the shared translation files still under concurrent work.
 */
export type WorkoutReminderDecision =
  | { send: true; kind: 'RECOMMENDED_DAY' }
  | {
      send: false;
      reason: 'NO_ACTIVE_PROGRAM' | 'NOT_A_RECOMMENDED_DAY' | 'ALREADY_TRAINED_TODAY';
    };

export function nonPunitiveWorkoutReminder(
  resolution: FreeScheduleResolution,
): WorkoutReminderDecision {
  if (resolution.status === 'PROGRAM_NOT_AVAILABLE') return { send: false, reason: 'NO_ACTIVE_PROGRAM' };
  if (resolution.status === 'TODAY_COMPLETED') return { send: false, reason: 'ALREADY_TRAINED_TODAY' };
  if (!resolution.todayIsRecommended) return { send: false, reason: 'NOT_A_RECOMMENDED_DAY' };
  return { send: true, kind: 'RECOMMENDED_DAY' };
}
