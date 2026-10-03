import type { PersistedWorkoutExecution } from '../services/workoutExecutions';
import { countCompletedExecutionSets } from '../workoutShare/data';
import { computeSessionMaxLoadKg, computeSessionVolumeKg, computeTotalCompletedReps } from './metrics';

export const PULSE_METRIC_IDS = ['volume', 'sets', 'reps', 'maxLoad'] as const;
export type PulseMetricId = (typeof PULSE_METRIC_IDS)[number];

export type PulseDirection = 'positive' | 'neutral' | 'negative';

export interface PulseComparison {
  currentValue: number;
  previousValue: number;
  deltaAbsolute: number;
  /** `null` when `previousValue` is 0 — a percentage against zero is not meaningful. */
  deltaPercent: number | null;
  direction: PulseDirection;
}

export interface WorkoutPulse {
  hasPreviousSession: boolean;
  metrics: Record<PulseMetricId, PulseComparison> | null;
}

function compare(currentValue: number, previousValue: number): PulseComparison {
  const deltaAbsolute = currentValue - previousValue;
  const deltaPercent = previousValue > 0 ? (deltaAbsolute / previousValue) * 100 : null;
  const direction: PulseDirection = deltaAbsolute > 0 ? 'positive' : deltaAbsolute < 0 ? 'negative' : 'neutral';
  return { currentValue, previousValue, deltaAbsolute, deltaPercent, direction };
}

/**
 * "Hoje vs. sua última sessão na mesma escala" — `previousExecution` must
 * already be the correct equivalent session (see
 * `findPreviousEquivalentExecution`); this function does no matching of its
 * own. Returns `hasPreviousSession: false` (never a fabricated zero
 * baseline) when there is nothing comparable yet.
 */
export function buildWorkoutPulse(
  current: PersistedWorkoutExecution,
  previousExecution: PersistedWorkoutExecution | null,
): WorkoutPulse {
  if (!previousExecution) return { hasPreviousSession: false, metrics: null };

  return {
    hasPreviousSession: true,
    metrics: {
      volume: compare(computeSessionVolumeKg(current), computeSessionVolumeKg(previousExecution)),
      sets: compare(countCompletedExecutionSets(current), countCompletedExecutionSets(previousExecution)),
      reps: compare(computeTotalCompletedReps(current), computeTotalCompletedReps(previousExecution)),
      maxLoad: compare(computeSessionMaxLoadKg(current), computeSessionMaxLoadKg(previousExecution)),
    },
  };
}
