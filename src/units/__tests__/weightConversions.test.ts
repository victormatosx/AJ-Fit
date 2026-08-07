import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  formatWeightFromKg,
  kgToLb,
  lbToKg,
  weightFromKg,
  weightToKg,
  weightUnit,
} from '../weightConversions';
import { computeFatMass, computeLeanMass } from '../../lib/skinfoldCalculator';

describe('body-weight conversions', () => {
  it('converts the acceptance example from stored kg to displayed lb', () => {
    expect(kgToLb(81.65)).toBeCloseTo(180, 0);
    expect(formatWeightFromKg(81.65, 'imperial')).toBe('180.0');
  });

  it('converts 180 lb input back to kg', () => {
    expect(lbToKg(180)).toBeCloseTo(81.6466, 4);
    expect(weightToKg(180, 'imperial')).toBeCloseTo(81.6466, 4);
  });

  it.each([40, 78, 81.65, 180])('round-trips %s kg without loss', (kg) => {
    expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 12);
  });

  it('keeps metric values unchanged and exposes the correct unit', () => {
    expect(weightFromKg(81.65, 'metric')).toBe(81.65);
    expect(weightToKg(81.65, 'metric')).toBe(81.65);
    expect(weightUnit('metric')).toBe('kg');
    expect(weightUnit('imperial')).toBe('lb');
  });

  it('converts derived masses only after calculations remain in kg', () => {
    const weightKg = 80;
    const leanMassKg = computeLeanMass(weightKg, 20);
    const fatMassKg = computeFatMass(weightKg, 20);

    expect(leanMassKg).toBe(64);
    expect(fatMassKg).toBe(16);
    expect(weightFromKg(leanMassKg!, 'imperial')).toBeCloseTo(141.1, 1);
    expect(weightFromKg(fatMassKg!, 'imperial')).toBeCloseTo(35.3, 1);
  });
});

describe('body-weight integration contract', () => {
  const assessmentSource = readFileSync(
    resolve(__dirname, '../../screens/AssessmentScreen.tsx'),
    'utf8',
  );
  const quizSource = readFileSync(
    resolve(__dirname, '../../screens/QuizScreen.tsx'),
    'utf8',
  );
  const assessmentService = readFileSync(
    resolve(__dirname, '../../services/assessments.ts'),
    'utf8',
  );

  it('converts assessment input to kg before both save flows', () => {
    expect(assessmentSource.match(/weight:\s*weightKg/g)).toHaveLength(2);
    expect(assessmentSource).toContain(
      'const weightKg = weightToKg(displayedWeight, resolvedUnits)',
    );
  });

  it('converts imperial questionnaire input before updating domain state', () => {
    expect(quizSource).toContain(
      "isBodyWeight && resolvedUnits === 'imperial' ? lbToKg(next) : next",
    );
  });

  it('keeps Firestore assessment writes in the unchanged weight field', () => {
    expect(assessmentService).toContain('weight: input.weight');
    expect(assessmentService).not.toMatch(/kgToLb|lbToKg|weightFromKg|weightToKg/);
  });
});
