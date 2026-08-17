import { describe, expect, it } from 'vitest';

import { canReleasePhotoVaultScreenProtection } from '../photoVaultPrivacyLifecycle';

describe('Photo Vault foreground privacy release policy', () => {
  it('keeps protection through active → inactive → background during share', () => {
    expect(canReleasePhotoVaultScreenProtection({
      appState: 'active', vaultStatus: 'unlocked', shareInFlight: true,
    })).toBe(false);
    expect(canReleasePhotoVaultScreenProtection({
      appState: 'inactive', vaultStatus: 'locked', shareInFlight: true,
    })).toBe(false);
    expect(canReleasePhotoVaultScreenProtection({
      appState: 'background', vaultStatus: 'locked', shareInFlight: true,
    })).toBe(false);
  });

  it('renders locked foreground without releasing while shareAsync still owns handoff', () => {
    expect(canReleasePhotoVaultScreenProtection({
      appState: 'active', vaultStatus: 'locked', shareInFlight: true,
    })).toBe(false);
  });

  it('allows release only after share resolve/grace while remaining locked', () => {
    expect(canReleasePhotoVaultScreenProtection({
      appState: 'active', vaultStatus: 'locked', shareInFlight: false,
    })).toBe(true);
  });

  it('never releases protection for an unlocked private tree', () => {
    expect(canReleasePhotoVaultScreenProtection({
      appState: 'active', vaultStatus: 'unlocked', shareInFlight: false,
    })).toBe(false);
  });
});
