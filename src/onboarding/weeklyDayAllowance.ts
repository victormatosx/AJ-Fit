import type { Quiz } from '../state/AppState';
import type { CurrentTrainingLevel } from '../workoutLifecycle/types';

/**
 * Weekly training-day ceiling per experience level — the single definition
 * both the questionnaire and the post-onboarding agenda consult.
 *
 * Two entry points for the SAME ceiling, differing only in where the level
 * comes from: `maxWeeklyDaysForLevel` reads the questionnaire's self-reported
 * answer (the only level that exists before a lifecycle does), and
 * `maxWeeklyDaysForTrainingLevel` reads the Workout Lifecycle's
 * `currentTrainingLevel` (authoritative once the account is live, and the
 * level ADAPT itself regenerates against). After a promotion the lifecycle
 * level moves and the ceiling lifts on its own — the stale questionnaire
 * answer is never consulted again.
 *
 * The definitive policy: 2-3 days for beginners, 2-6 for everyone else, and
 * 7 for nobody. Both questionnaire intermediate options share the standard
 * ceiling — the prescription engine already treats them identically.
 *
 * Every ceiling here is the point where a level's templates stop adding
 * strength sessions: the beginner family prescribes three no matter how much
 * availability is offered, and the 7-day families prescribe six plus one
 * active-recovery day. Past that point, a user's stated availability and
 * their prescribed frequency disagree, which is exactly what these bounds
 * exist to prevent — never a clinical cap invented here.
 */
export const BEGINNER_MAX_WEEKLY_DAYS = 3;

/**
 * The ceiling for every non-beginner level, and the app-wide maximum: NO
 * level may select 7. The 7-day templates prescribe six strength sessions
 * plus one active-recovery day, so a 7-day availability could never be
 * honoured as seven training days anyway — offering it only ever produced a
 * schedule whose stated frequency and prescribed frequency disagreed.
 */
export const STANDARD_MAX_WEEKLY_DAYS = 6;

/** Every level trains at least twice a week. */
export const MIN_WEEKLY_DAYS = 2;

/**
 * Mirrors the engine's own `isBeginnerExperience`
 * (src/workoutPrescription/personalization.ts), including the legacy `beg`
 * and retired `never_or_starting` values a stored draft or an older
 * questionnaire document can still carry.
 *
 * Deliberately re-stated here instead of imported: `personalization.ts` ->
 * `input.ts` -> `lib/questionnaireSchema.ts`, and `questionnaireSchema` is
 * itself a consumer of this rule, so importing the engine predicate would
 * close an import cycle. `__tests__/weeklyDayAllowance.test.ts` asserts the
 * two predicates agree for every level value in `Quiz`, so they cannot drift
 * apart unnoticed.
 */
const BEGINNER_LEVELS: readonly string[] = ['beginner', 'beg', 'never_or_starting'];

export function isBeginnerLevelSelection(level: Quiz['level']): boolean {
  return level != null && BEGINNER_LEVELS.includes(level);
}

export function maxWeeklyDaysForLevel(level: Quiz['level']): number {
  return isBeginnerLevelSelection(level) ? BEGINNER_MAX_WEEKLY_DAYS : STANDARD_MAX_WEEKLY_DAYS;
}

/**
 * The ceiling for a LIVE account, keyed on the Workout Lifecycle's
 * `currentTrainingLevel` — the same field `authorizeMutation`'s ADAPT uses to
 * regenerate the canonical plan, so the agenda can never offer a frequency
 * the authority will refuse. A not-yet-loaded level (`null`) falls back to
 * the STANDARD ceiling, never the beginner one: an unknown level must not
 * tighten the agenda below what the account may be entitled to, and it still
 * cannot reach 7, which no level allows.
 */
export function maxWeeklyDaysForTrainingLevel(level: CurrentTrainingLevel | null | undefined): number {
  return level === 'BEGINNER' ? BEGINNER_MAX_WEEKLY_DAYS : STANDARD_MAX_WEEKLY_DAYS;
}
