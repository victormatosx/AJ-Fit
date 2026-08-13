import type { ResolvedUnits } from '../types/units';

export const CM_PER_INCH = 2.54;
export const INCHES_PER_FOOT = 12;

export type ImperialHeight = Readonly<{
  feet: number;
  inches: number;
}>;

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH;
}

export function cmToFeetInches(cm: number): ImperialHeight {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  };
}

export function selectableImperialHeightRange(minCm: number, maxCm: number) {
  return {
    minTotalInches: Math.ceil(minCm / CM_PER_INCH),
    maxTotalInches: Math.floor(maxCm / CM_PER_INCH),
  };
}

export function selectableFeet(minCm: number, maxCm: number): number[] {
  const { minTotalInches, maxTotalInches } = selectableImperialHeightRange(minCm, maxCm);
  const minFeet = Math.floor(minTotalInches / INCHES_PER_FOOT);
  const maxFeet = Math.floor(maxTotalInches / INCHES_PER_FOOT);
  return Array.from({ length: maxFeet - minFeet + 1 }, (_, index) => minFeet + index);
}

export function selectableInchesForFeet(
  feet: number,
  minCm: number,
  maxCm: number,
): number[] {
  const { minTotalInches, maxTotalInches } = selectableImperialHeightRange(minCm, maxCm);
  return Array.from({ length: INCHES_PER_FOOT }, (_, inches) => inches).filter((inches) => {
    const totalInches = feet * INCHES_PER_FOOT + inches;
    return totalInches >= minTotalInches && totalInches <= maxTotalInches;
  });
}

export function cmToSelectableFeetInches(
  cm: number,
  minCm: number,
  maxCm: number,
): ImperialHeight {
  const { minTotalInches, maxTotalInches } = selectableImperialHeightRange(minCm, maxCm);
  const totalInches = Math.max(
    minTotalInches,
    Math.min(maxTotalInches, Math.round(cm / CM_PER_INCH)),
  );
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  };
}

export function isValidImperialHeight(
  feet: number,
  inches: number,
  minCm: number,
  maxCm: number,
): boolean {
  if (!Number.isInteger(feet) || !Number.isInteger(inches) || inches < 0 || inches > 11) {
    return false;
  }
  const cm = feetInchesToCm(feet, inches);
  return cm >= minCm && cm <= maxCm;
}

export function formatHeightFromCm(cm: number, units: ResolvedUnits): string {
  if (units === 'metric') return String(cm);
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet} ft ${inches} in`;
}

export function heightUnit(units: ResolvedUnits): string {
  return units === 'imperial' ? '' : 'cm';
}
