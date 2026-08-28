import { normalizeExperience } from './input';
import type { Population, QuestionnaireAnswers } from './types';

export interface FrequencyPrescription {
  availabilityDays: number;
  prescribedTrainingFrequency: number;
  reasonCode: string;
}

/**
 * Phase 2 frequency policy. Availability is always a ceiling. The policy is
 * intentionally small, deterministic and population-aware; it is not a
 * training-content or clinical decision engine.
 */
export function prescribeTrainingFrequency(
  answers: QuestionnaireAnswers,
  population: Population,
): FrequencyPrescription {
  const availabilityDays = Math.max(2, Math.min(7, Math.trunc(answers.days ?? 0)));

  if (population === 'frailty') {
    return {
      availabilityDays,
      prescribedTrainingFrequency: Math.min(availabilityDays, 3),
      reasonCode: 'SPECIAL_POPULATION_FRAILTY_CAP_3',
    };
  }
  if (population !== 'conventional') {
    return {
      availabilityDays,
      prescribedTrainingFrequency: Math.min(availabilityDays, 4),
      reasonCode: 'SPECIAL_POPULATION_CAP_4',
    };
  }

  if (availabilityDays <= 5) {
    return {
      availabilityDays,
      prescribedTrainingFrequency: availabilityDays,
      reasonCode: 'CONVENTIONAL_AVAILABILITY_2_TO_5',
    };
  }

  const experience = normalizeExperience(answers.level);
  const prescribedTrainingFrequency = experience === 'advanced'
    ? 6
    : experience === 'intermediate'
      ? 5
      : 4;
  return {
    availabilityDays,
    prescribedTrainingFrequency: Math.min(availabilityDays, prescribedTrainingFrequency),
    reasonCode: `CONVENTIONAL_HIGH_AVAILABILITY_${String(experience ?? 'BEGINNER').toUpperCase()}`,
  };
}
