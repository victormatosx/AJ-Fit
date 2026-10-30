/**
 * What AJ says when he presents a freshly swapped program.
 *
 * Pure, like `workoutSwapPreview.ts` and `myPlanPresentation.ts`, so the whole
 * script is unit-testable in this project's Node-only Vitest suite — a
 * narration that can silently start inventing facts is exactly the kind of
 * thing that needs a test, and a component module could not have one here.
 *
 * Every line is assembled from values the two sealed snapshots already carry.
 * There is deliberately no line about anything the plan does not state: no
 * projected results, no "ideal" weekly volume, no physiological claim. A line
 * whose data is missing is dropped rather than filled with a guess, which is
 * why the return type is a list and not a fixed-length tuple.
 */
import type { WorkoutSwapComparison } from './workoutSwapPreview';

export type LooseTranslate = (key: string, opts?: Record<string, unknown>) => string;

/** One session, already resolved by the screen through `workoutExercisesFromPlan`. */
export interface SwapNarrationSession {
  /** 'A', 'B', 'C'… — the division letter the preview also shows. */
  letter: string;
  /** Localized muscle-group labels, in the order they appear in the session. */
  muscleGroups: readonly string[];
  exerciseCount: number;
  setCount: number;
  /** Prescribed rest per exercise, in seconds. `0` is a real "no rest" value. */
  restSeconds: readonly number[];
}

export interface SwapNarrationInput {
  firstName: string | null;
  comparison: WorkoutSwapComparison;
  scheduleMode: 'fixed' | 'flexible';
  frequency: number;
  /** Localized short labels of the weekdays the new plan prescribes as TRAINING. */
  trainingDayLabels: readonly string[];
  restDayCount: number;
  split: string;
  sessions: readonly SwapNarrationSession[];
}

/**
 * How many muscle groups per session the spoken breakdown names.
 *
 * The panel underneath lists every one of them; the line only has to make the
 * division legible. Two keeps a six-session plan inside one comfortable
 * sentence instead of a paragraph AJ types for eight seconds.
 */
const SPOKEN_MUSCLES_PER_SESSION = 2;

export function totalExercises(sessions: readonly SwapNarrationSession[]): number {
  return sessions.reduce((sum, session) => sum + session.exerciseCount, 0);
}

export function totalSets(sessions: readonly SwapNarrationSession[]): number {
  return sessions.reduce((sum, session) => sum + session.setCount, 0);
}

/**
 * "A: Peitoral, Tríceps · B: Dorsal, Bíceps" — the division, spoken.
 * A session whose exercises carry no catalogued muscle target (cardio,
 * mobility) contributes its letter alone rather than a fabricated group.
 */
export function spokenDivision(sessions: readonly SwapNarrationSession[]): string {
  return sessions
    .map((session) => {
      const muscles = session.muscleGroups.slice(0, SPOKEN_MUSCLES_PER_SESSION);
      return muscles.length > 0 ? `${session.letter}: ${muscles.join(', ')}` : session.letter;
    })
    .join(' · ');
}

/**
 * The prescribed rest, as a single value or a range. Only counts exercises
 * that actually prescribe rest — a mobility slot's `0` is meaningful in the
 * plan but would misreport the range as starting at zero seconds.
 */
export function restRange(sessions: readonly SwapNarrationSession[]): { min: number; max: number } | null {
  const resting = sessions.flatMap((session) => session.restSeconds).filter((seconds) => seconds > 0);
  if (resting.length === 0) return null;
  return { min: Math.min(...resting), max: Math.max(...resting) };
}

/**
 * The real differences against the superseded plan, each as its own localized
 * fragment. Only genuine changes appear: a metric that did not move produces
 * nothing, so the line never claims a change that did not happen.
 *
 * Deliberately no exercise-level diff. An availability change rebuilds the
 * division, so old slot and new slot have no correspondence to compare (see
 * `workoutSwapComparison`).
 */
export function changeFragments(t: LooseTranslate, comparison: WorkoutSwapComparison): string[] {
  const fragments: string[] = [];
  if (comparison.sessionCount.changed) {
    fragments.push(t(
      comparison.sessionCount.to > comparison.sessionCount.from
        ? 'treino:swapPresentation.aj.changeSessionsMore'
        : 'treino:swapPresentation.aj.changeSessionsFewer',
      { count: Math.abs(comparison.sessionCount.to - comparison.sessionCount.from) },
    ));
  }
  if (comparison.exerciseCount.changed) {
    fragments.push(t(
      comparison.exerciseCount.to > comparison.exerciseCount.from
        ? 'treino:swapPresentation.aj.changeExercisesMore'
        : 'treino:swapPresentation.aj.changeExercisesFewer',
      { count: Math.abs(comparison.exerciseCount.to - comparison.exerciseCount.from) },
    ));
  }
  if (comparison.split.changed) {
    fragments.push(t('treino:swapPresentation.aj.changeSplit', { split: comparison.split.to }));
  }
  return fragments;
}

/**
 * The full script, in order. Each line reveals the block it describes, the
 * same contract `PlanReadyScreen`'s own narration follows.
 */
export function buildSwapNarration(t: LooseTranslate, input: SwapNarrationInput): string[] {
  const { comparison, sessions, scheduleMode, frequency } = input;
  const exercises = totalExercises(sessions);
  const sets = totalSets(sessions);
  const rest = restRange(sessions);
  const changes = changeFragments(t, comparison);

  const lines: (string | null)[] = [
    // 1 — what just happened, and the headline number.
    input.firstName
      ? t('treino:swapPresentation.aj.intro', { name: input.firstName, count: frequency })
      : t('treino:swapPresentation.aj.introNoName', { count: frequency }),

    // 2 — how the week is organised around the days the user chose.
    scheduleMode === 'flexible'
      ? t('treino:swapPresentation.aj.daysFlexible', { count: frequency })
      : input.trainingDayLabels.length > 0
        ? t('treino:swapPresentation.aj.daysFixed', {
            days: input.trainingDayLabels.join(', '),
            rest: input.restDayCount,
          })
        : null,

    // 3 — the division itself, and which muscles land on which day.
    sessions.length > 0
      ? t('treino:swapPresentation.aj.division', {
          split: input.split,
          count: sessions.length,
          breakdown: spokenDivision(sessions),
        })
      : null,

    // 4 — volume and intervals.
    exercises > 0
      ? rest
        ? t(
            rest.min === rest.max
              ? 'treino:swapPresentation.aj.volumeSingleRest'
              : 'treino:swapPresentation.aj.volumeRestRange',
            { exercises, sets, rest: rest.min, restMax: rest.max },
          )
        : t('treino:swapPresentation.aj.volume', { exercises, sets })
      : null,

    // 5 — only real differences against the plan being replaced.
    changes.length > 0
      ? t('treino:swapPresentation.aj.changes', { changes: changes.join(', ') })
      : null,

    // 6 — what the swap did NOT touch, then hand over.
    t('treino:swapPresentation.aj.closing'),
  ];

  return lines.filter((line): line is string => Boolean(line && line.trim()));
}
