/**
 * Development-only data used to inspect the Loads panel of the Progress
 * experience, which has no repository behind it yet.
 *
 * Nothing here is persisted or sent to Firebase.
 *
 * SCOPE — READ THIS BEFORE ADDING ANYTHING
 * ----------------------------------------
 * This file covers the LOADS panel only. The "Corpo" panel used to have a
 * preview here too, and it was removed: that panel is backed by real
 * assessments through `useAssessments`, so preview values there meant a user
 * could be shown a body history that was not theirs — weights, body fat and
 * trends they never recorded. A screen that reports the user's own body must
 * never be able to render anything but the user's own measurements.
 *
 * Do not reintroduce body/assessment preview data. An account with no
 * assessments is meant to reach `BodyEvolutionView`'s empty state and its
 * "add an assessment" CTA; that empty state IS the design for that case.
 *
 * The same reasoning will apply to Loads the moment a real load-history
 * repository exists — at which point this file should be deleted rather than
 * extended.
 */
export const SHOW_PROGRESS_DESIGN_PREVIEW =
  typeof __DEV__ !== 'undefined' && __DEV__;

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setHours(12, 0, 0, 0);
  return date;
}

export type ProgressLoadExerciseId = 'benchPress' | 'squat' | 'deadlift';

export type ProgressLoadPoint = {
  recordedAt: Date;
  loadKg: number;
};

export type ProgressLoadExercisePreview = {
  id: ProgressLoadExerciseId;
  history: ProgressLoadPoint[];
};

function loadHistory(values: number[], latestEntryDaysAgo: number): ProgressLoadPoint[] {
  if (values.length === 1) {
    return [{ recordedAt: daysAgo(latestEntryDaysAgo), loadKg: values[0]! }];
  }

  return values.map((loadKg, index) => ({
    recordedAt: daysAgo(
      Math.round(latestEntryDaysAgo + 84 * (1 - index / (values.length - 1))),
    ),
    loadKg,
  }));
}

/** Histories are chronological (oldest first), ready for chart rendering. */
export const PROGRESS_LOADS_PREVIEW: ProgressLoadExercisePreview[] = [
  {
    id: 'benchPress',
    history: loadHistory([57.5, 60, 62.5, 62.5, 67.5, 70, 72.5, 75, 77.5, 80, 82.5], 3),
  },
  {
    id: 'squat',
    history: loadHistory([85, 87.5, 90, 92.5, 95, 97.5, 100, 102.5, 105, 107.5, 110], 7),
  },
  {
    id: 'deadlift',
    history: loadHistory([105, 110, 112.5, 117.5, 120, 125, 127.5, 130, 135, 137.5, 140], 14),
  },
];
