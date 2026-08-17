import type { PhotoVaultStatus } from './photoVaultLock';

/**
 * Native capture protection may be released only after the locked tree is in
 * the foreground and no OS share handoff still owns the presented window.
 */
export function canReleasePhotoVaultScreenProtection(input: {
  appState: string;
  vaultStatus: PhotoVaultStatus;
  shareInFlight: boolean;
}): boolean {
  return (
    input.appState === 'active' &&
    input.vaultStatus !== 'unlocked' &&
    !input.shareInFlight
  );
}
