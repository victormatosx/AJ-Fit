import { Timestamp } from 'firebase/firestore';

import type { AssessmentView } from '../../hooks/useAssessments';

/**
 * Demonstrative data only — never persisted, never sent to any backend.
 * Used exclusively by `BodyEvolutionView` to feed the blurred preview shown
 * when the real account has no assessments yet (see `EvolutionLockedPreview`).
 *
 * Dates are relative to `now` (rather than fixed calendar dates) so the
 * preview always looks current, no matter when it's viewed.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface DemoAssessmentSpec {
  weeksAgo: number;
  weight: number;
  bodyFat: number;
  bmi: number;
  leanMass: number;
  fatMass: number;
  chest: number;
  abdom: number;
  thigh: number;
}

// Newest first, matching the real hook's contract. Weight/body-fat/folds all
// trend down from oldest to newest — a believable short progression.
const DEMO_ENTRIES: readonly DemoAssessmentSpec[] = [
  { weeksAgo: 0, weight: 79.5, bodyFat: 19.6, bmi: 26.0, leanMass: 63.9, fatMass: 15.6, chest: 12, abdom: 20, thigh: 22 },
  { weeksAgo: 1, weight: 80.9, bodyFat: 20.8, bmi: 26.4, leanMass: 64.1, fatMass: 16.8, chest: 14, abdom: 22, thigh: 24 },
  { weeksAgo: 2, weight: 82.4, bodyFat: 22.0, bmi: 26.9, leanMass: 64.3, fatMass: 18.1, chest: 16, abdom: 24, thigh: 26 },
  { weeksAgo: 3, weight: 84.0, bodyFat: 23.5, bmi: 27.4, leanMass: 64.3, fatMass: 19.7, chest: 18, abdom: 26, thigh: 28 },
];

export function buildDemoAssessments(now: Date = new Date()): AssessmentView[] {
  return DEMO_ENTRIES.map((entry, index) => ({
    id: `demo-assessment-${index}`,
    source: 'guided' as const,
    measuredAt: Timestamp.fromDate(new Date(now.getTime() - entry.weeksAgo * WEEK_MS)),
    createdAt: null,
    weight: entry.weight,
    height: 175,
    bodyFat: entry.bodyFat,
    calculatorVersion: 1 as const,
    protocol: 'jp3' as const,
    sex: 'm' as const,
    age: 30,
    folds: { chest: entry.chest, abdom: entry.abdom, thigh: entry.thigh },
    bmi: entry.bmi,
    leanMass: entry.leanMass,
    fatMass: entry.fatMass,
  }));
}
