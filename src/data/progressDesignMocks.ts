import { Timestamp } from 'firebase/firestore';

import type { AssessmentDelta, AssessmentView } from '../hooks/useAssessments';

/**
 * Development-only data used to inspect the complete Progress experience.
 *
 * Nothing in this file is persisted or sent to Firebase. Keeping the preview
 * data outside the screen also makes it difficult to mistake these values for
 * a user's real history when the load-history repository is implemented.
 */
export const SHOW_PROGRESS_DESIGN_PREVIEW =
  typeof __DEV__ !== 'undefined' && __DEV__;

const DAY_MS = 24 * 60 * 60 * 1000;
const HEIGHT_M = 1.76;

function daysAgo(days: number): Date {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setHours(12, 0, 0, 0);
  return date;
}

function assessment(
  id: string,
  days: number,
  weight: number,
  bodyFat: number,
): AssessmentView {
  const measuredAt = Timestamp.fromDate(daysAgo(days));
  return {
    id,
    source: 'imported',
    measuredAt,
    createdAt: measuredAt,
    weight,
    height: HEIGHT_M,
    bodyFat,
    bmi: weight / HEIGHT_M ** 2,
    leanMass: weight * (1 - bodyFat / 100),
    fatMass: weight * (bodyFat / 100),
  };
}

/** Newest first, matching the contract returned by useAssessments. */
export const PROGRESS_BODY_PREVIEW: AssessmentView[] = [
  assessment('preview-body-08', 0, 78.6, 18.7),
  assessment('preview-body-07', 14, 79.2, 19.4),
  assessment('preview-body-06', 28, 79.5, 19.8),
  assessment('preview-body-05', 42, 80.1, 20.5),
  assessment('preview-body-04', 56, 80.4, 21.0),
  assessment('preview-body-03', 70, 81.2, 21.7),
  assessment('preview-body-02', 84, 81.7, 22.1),
  assessment('preview-body-01', 98, 82.4, 22.8),
];

function assessmentDelta(to: AssessmentView, from: AssessmentView): AssessmentDelta {
  return {
    weightDelta: to.weight - from.weight,
    bodyFatDelta:
      to.bodyFat != null && from.bodyFat != null ? to.bodyFat - from.bodyFat : null,
    leanMassDelta:
      to.leanMass != null && from.leanMass != null ? to.leanMass - from.leanMass : null,
    fatMassDelta:
      to.fatMass != null && from.fatMass != null ? to.fatMass - from.fatMass : null,
  };
}

export const PROGRESS_BODY_PREVIEW_DELTA = assessmentDelta(
  PROGRESS_BODY_PREVIEW[0]!,
  PROGRESS_BODY_PREVIEW[1]!,
);

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
