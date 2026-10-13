import type { NonTrainingActivityLevel } from '../../types/nutrition';
import { NON_TRAINING_ACTIVITY_FACTOR, trainingSessionKcal } from './constants';

/**
 * `canonical/nutrition_rules.json` `energy.tdeeStrategy`:
 *
 * tdeeKcal = rmrKcal * nonTrainingActivityFactor[level]
 *          + (weeklyTrainingFrequency * trainingSessionKcal(weightKg) / 7)
 *
 * The two terms are additive and deliberately independent, to avoid double
 * counting exercise: `nonTrainingActivityFactor` describes ONLY non-exercise
 * daily movement, and the training term is derived solely from the
 * authoritative `weeklyTrainingFrequency` (never from the activity level).
 */
export function calculateTdee(
  rmrKcal: number,
  nonTrainingActivityLevel: NonTrainingActivityLevel,
  weeklyTrainingFrequency: number,
  weightKg: number,
): number {
  const nonTrainingKcal = rmrKcal * NON_TRAINING_ACTIVITY_FACTOR[nonTrainingActivityLevel];
  const trainingKcalPerDay = (weeklyTrainingFrequency * trainingSessionKcal(weightKg)) / 7;
  return nonTrainingKcal + trainingKcalPerDay;
}
