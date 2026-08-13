import type { ResolvedUnits } from '../types/units';
import { weightFromKg, weightToKg, weightUnit } from './weightConversions';

export function workoutLoadUnit(units: ResolvedUnits): string {
  return weightUnit(units);
}

export function workoutLoadFromKg(kg: number, units: ResolvedUnits): number {
  return weightFromKg(kg, units);
}

export function workoutLoadToKg(value: number, units: ResolvedUnits): number {
  return weightToKg(value, units);
}

export function workoutLoadStep(units: ResolvedUnits): number {
  return units === 'imperial' ? 5 : 2.5;
}

export function formatWorkoutLoadFromKg(kg: number, units: ResolvedUnits): string {
  const displayed = Math.round(workoutLoadFromKg(kg, units) * 10) / 10;
  return Number.isInteger(displayed) ? String(displayed) : displayed.toFixed(1);
}

export function adjustWorkoutLoadKg(
  currentKg: number,
  direction: -1 | 1,
  units: ResolvedUnits,
): number {
  const currentDisplayed = Math.round(workoutLoadFromKg(currentKg, units) * 10) / 10;
  const nextDisplayed = Math.max(0, currentDisplayed + direction * workoutLoadStep(units));
  return workoutLoadToKg(nextDisplayed, units);
}
