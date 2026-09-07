import { describe, expect, it } from 'vitest';

import { resolveMuscleIntensity } from '../muscleFillIntensity';

describe('resolveMuscleIntensity', () => {
  it('returns primary when the muscle is in the primary set', () => {
    const primary = new Set<'chest'>(['chest']);
    const secondary = new Set<'chest'>([]);
    expect(resolveMuscleIntensity('chest', primary, secondary)).toBe('primary');
  });

  it('returns secondary when only in the secondary set', () => {
    const primary = new Set<'chest'>([]);
    const secondary = new Set<'chest'>(['chest']);
    expect(resolveMuscleIntensity('chest', primary, secondary)).toBe('secondary');
  });

  it('returns inactive when in neither set', () => {
    expect(resolveMuscleIntensity('chest', new Set(), new Set())).toBe('inactive');
  });

  it('prefers primary when a muscle is (invalidly) in both sets', () => {
    const primary = new Set<'chest'>(['chest']);
    const secondary = new Set<'chest'>(['chest']);
    expect(resolveMuscleIntensity('chest', primary, secondary)).toBe('primary');
  });

  it('handles empty sets without throwing', () => {
    expect(() => resolveMuscleIntensity('quads', new Set(), new Set())).not.toThrow();
  });
});
