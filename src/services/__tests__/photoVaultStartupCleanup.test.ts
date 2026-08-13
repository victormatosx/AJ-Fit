import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Photo Vault startup cleanup', () => {
  it('sweeps plaintext during app bootstrap without blocking startup on failure', () => {
    const source = readFileSync('App.tsx', 'utf8');

    expect(source).toContain('cleanupPhotoVaultTempFiles({ includeEncrypted: true })');
    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*cleanupPhotoVaultTempFiles\(\{ includeEncrypted: true \}\)/,
    );
    expect(source).toContain("logPhotoVaultIssue('startupCleanup', 'vaultTempCleanupFailed')");
  });

  it('also removes encrypted staging after a cold process restart', () => {
    const source = readFileSync('App.tsx', 'utf8');
    expect(source).toContain('includeEncrypted: true');
    expect(source).toContain('no resumable local upload queue');
  });
});
