import { describe, expect, it } from 'vitest';
import { isLegacyGenerationVersion, resolveGenerationVersion } from '../generationVersion';

describe('resolveGenerationVersion — Fase 11 cutover point', () => {
  it('defaults to v1.27 with no arguments (the only production-reachable call shape)', () => {
    expect(resolveGenerationVersion()).toBe('v1.27');
    expect(isLegacyGenerationVersion(resolveGenerationVersion())).toBe(false);
  });

  it('an explicit v2 override selects v2 — the single-point rollback path', () => {
    expect(resolveGenerationVersion('v2')).toBe('v2');
    expect(isLegacyGenerationVersion('v2')).toBe(true);
  });

  it('an explicit v1.27 override is a no-op (still v1.27)', () => {
    expect(resolveGenerationVersion('v1.27')).toBe('v1.27');
  });
});
