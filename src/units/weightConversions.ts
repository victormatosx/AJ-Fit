import type { ResolvedUnits } from '../types/units';

export const LB_PER_KG = 2.2046226218487757;

export function kgToLb(kilograms: number): number {
  return kilograms * LB_PER_KG;
}

export function lbToKg(pounds: number): number {
  return pounds / LB_PER_KG;
}

export function weightFromKg(
  kilograms: number,
  units: ResolvedUnits,
): number {
  return units === 'imperial' ? kgToLb(kilograms) : kilograms;
}

export function weightToKg(value: number, units: ResolvedUnits): number {
  return units === 'imperial' ? lbToKg(value) : value;
}

export function weightUnit(units: ResolvedUnits): 'kg' | 'lb' {
  return units === 'imperial' ? 'lb' : 'kg';
}

export function formatWeightFromKg(
  kilograms: number,
  units: ResolvedUnits,
  fractionDigits = 1,
): string {
  return weightFromKg(kilograms, units).toFixed(fractionDigits);
}

export function formatWeightInputFromKg(
  kilograms: number,
  units: ResolvedUnits,
): string {
  return formatWeightFromKg(kilograms, units).replace(/\.0$/, '');
}
