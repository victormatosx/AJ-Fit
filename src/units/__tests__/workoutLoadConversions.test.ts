import { describe, expect, it } from 'vitest';
import {
  adjustWorkoutLoadKg,
  formatWorkoutLoadFromKg,
  workoutLoadFromKg,
  workoutLoadStep,
  workoutLoadToKg,
  workoutLoadUnit,
} from '../workoutLoadConversions';

describe('workout load conversions', () => {
  it('keeps the metric interface in kg with a 2.5 kg step', () => {
    expect(workoutLoadUnit('metric')).toBe('kg');
    expect(workoutLoadStep('metric')).toBe(2.5);
    expect(adjustWorkoutLoadKg(60, 1, 'metric')).toBe(62.5);
  });

  it('uses a deliberate 5 lb imperial step', () => {
    expect(workoutLoadUnit('imperial')).toBe('lb');
    expect(workoutLoadStep('imperial')).toBe(5);
    const currentKg = workoutLoadToKg(100, 'imperial');
    const nextKg = adjustWorkoutLoadKg(currentKg, 1, 'imperial');
    expect(workoutLoadFromKg(nextKg, 'imperial')).toBeCloseTo(105, 10);
  });

  it('converts 100 lb input to kg for internal state', () => {
    expect(workoutLoadToKg(100, 'imperial')).toBeCloseTo(45.3592, 4);
  });

  it('changes only presentation when resolving another unit', () => {
    const internalKg = 60;
    expect(formatWorkoutLoadFromKg(internalKg, 'metric')).toBe('60');
    expect(formatWorkoutLoadFromKg(internalKg, 'imperial')).toBe('132.3');
    expect(internalKg).toBe(60);
  });
});
