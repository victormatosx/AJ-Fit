import { afterEach, describe, expect, it, vi } from 'vitest';
import { planSnapshotRegistrationEnabled } from '../diary/config';

afterEach(() => vi.unstubAllEnvs());
describe('global snapshot registration switch', () => {
  it('defaults closed and can be disabled without a UID policy', () => {
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', '');
    expect(planSnapshotRegistrationEnabled()).toBe(false);
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'true');
    expect(planSnapshotRegistrationEnabled()).toBe(true);
    vi.stubEnv('NUTRITION_PLAN_SNAPSHOT_ENABLED', 'false');
    expect(planSnapshotRegistrationEnabled()).toBe(false);
  });
});
