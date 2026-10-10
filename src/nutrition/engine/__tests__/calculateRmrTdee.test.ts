import { describe, expect, it } from 'vitest';
import { calculateRmr } from '../calculateRmr';
import { calculateTdee } from '../calculateTdee';

describe('calculateRmr — Mifflin-St Jeor', () => {
  it('male: 80kg / 180cm / 30y -> 1780 kcal', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5
    expect(calculateRmr('m', 80, 180, 30)).toBe(1780);
  });

  it('female: 60kg / 165cm / 30y -> 1320.25 kcal', () => {
    // 10*60 + 6.25*165 - 5*30 - 161 = 600 + 1031.25 - 150 - 161
    expect(calculateRmr('f', 60, 165, 30)).toBeCloseTo(1320.25, 5);
  });
});

describe('calculateTdee — split non-training factor + additive training contribution', () => {
  it('sedentary, 0 training sessions/week -> pure RMR * 1.2 (no training term)', () => {
    const rmr = 1780;
    expect(calculateTdee(rmr, 'sedentary', 0, 80)).toBeCloseTo(1780 * 1.2, 5);
  });

  it('active, 4 sessions/week at 60kg -> RMR*1.4 + 150 kcal/day training contribution', () => {
    // trainingSessionKcal(60) = 5.0*3.5*60/200*50 = 262.5
    // training/day = 4*262.5/7 = 150
    const rmr = 1320.25;
    expect(calculateTdee(rmr, 'active', 4, 60)).toBeCloseTo(1320.25 * 1.4 + 150, 4);
  });

  it('is monotonically increasing in weeklyTrainingFrequency for a fixed weight (no double counting the other way either)', () => {
    const rmr = 1700;
    const tdee0 = calculateTdee(rmr, 'low_active', 0, 75);
    const tdee3 = calculateTdee(rmr, 'low_active', 3, 75);
    const tdee6 = calculateTdee(rmr, 'low_active', 6, 75);
    expect(tdee3).toBeGreaterThan(tdee0);
    expect(tdee6).toBeGreaterThan(tdee3);
  });

  it.each([
    ['sedentary', 1.2],
    ['low_active', 1.3],
    ['active', 1.4],
    ['very_active', 1.5],
  ] as const)('%s uses factor %s with 0 training', (level, factor) => {
    expect(calculateTdee(1000, level, 0, 70)).toBeCloseTo(1000 * factor, 5);
  });
});
