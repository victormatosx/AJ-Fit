import { describe, expect, it } from 'vitest';
import {
  adjustWorkoutLoadKg,
  formatWorkoutLoadFromKg,
  formatWorkoutVolumeFromKg,
  workoutLoadFromKg,
  workoutLoadStep,
  workoutLoadToKg,
  workoutLoadUnit,
  workoutVolumeUnit,
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

  it('shows volume below 1000 kg in kg', () => {
    expect(formatWorkoutVolumeFromKg(999, 'metric')).toBe('999');
    expect(workoutVolumeUnit(999, 'metric')).toBe('kg');
  });

  it('switches volume to tonnes at 1000 kg and above', () => {
    expect(formatWorkoutVolumeFromKg(1000, 'metric')).toBe('1');
    expect(workoutVolumeUnit(1000, 'metric')).toBe('ton');
    expect(formatWorkoutVolumeFromKg(1250, 'metric')).toBe('1.3');
    expect(workoutVolumeUnit(1250, 'metric')).toBe('ton');
  });

  it('applies the equivalent 2000 lb threshold for imperial volume', () => {
    const justUnderKg = workoutLoadToKg(1999, 'imperial');
    expect(workoutVolumeUnit(justUnderKg, 'imperial')).toBe('lb');
    const atThresholdKg = workoutLoadToKg(2000, 'imperial');
    expect(workoutVolumeUnit(atThresholdKg, 'imperial')).toBe('ton');
    expect(formatWorkoutVolumeFromKg(atThresholdKg, 'imperial')).toBe('1');
  });
});
