import type { Sex } from '../../types/nutrition';
import { MIFFLIN_ST_JEOR } from './constants';

/**
 * Mifflin-St Jeor resting metabolic rate
 * (`canonical/nutrition_rules.json` `energy.restingEnergyFormula`):
 *
 * male:   10*weightKg + 6.25*heightCm - 5*ageYears + 5
 * female: 10*weightKg + 6.25*heightCm - 5*ageYears - 161
 */
export function calculateRmr(sex: Sex, weightKg: number, heightCm: number, ageYears: number): number {
  const { weightCoefficient, heightCoefficient, ageCoefficient, sexConstant } = MIFFLIN_ST_JEOR;
  return (
    weightCoefficient * weightKg
    + heightCoefficient * heightCm
    - ageCoefficient * ageYears
    + sexConstant[sex]
  );
}
