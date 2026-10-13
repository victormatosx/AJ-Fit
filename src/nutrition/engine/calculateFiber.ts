import { FIBER_G_PER_1000_KCAL } from './constants';

/** `canonical/nutrition_rules.json` `macros.fiber.target`: 14 g / 1000 kcal. */
export function calculateFiberG(targetKcal: number): number {
  return (targetKcal / 1000) * FIBER_G_PER_1000_KCAL;
}
