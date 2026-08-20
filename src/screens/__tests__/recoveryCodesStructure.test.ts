import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Structural guarantees for the MFA recovery-codes client.
 *
 * These read SOURCE rather than behaviour because the guarantees are about
 * capabilities that must NOT exist: there is no runtime assertion that can
 * prove "this code never writes to SecureStore". A plaintext recovery code is
 * the one credential in this product that grants an MFA reset, so the rules
 * below are enforced mechanically instead of by review.
 */

const projectRoot = path.resolve(__dirname, '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

/** Source with comments stripped, so prose about storage does not trip a check. */
function readCode(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Every module that can hold a plaintext recovery code in memory. */
const RECOVERY_MODULES = [
  'src/services/mfaRecovery.ts',
  'src/hooks/useRecoveryCodes.ts',
  'src/screens/RecoveryCodesScreen.tsx',
] as const;

describe('recovery codes are never persisted', () => {
  it.each([
    ['AsyncStorage', /AsyncStorage/],
    ['SecureStore', /SecureStore|expo-secure-store/],
    ['the filesystem', /FileSystem|expo-file-system/],
    ['Firestore', /firebase\/firestore|setDoc|updateDoc|addDoc/],
    ['MMKV or SQLite', /MMKV|SQLite|expo-sqlite/],
    ['a persisted store', /persist\(|redux-persist|zustand/],
    ['secure auth storage', /secureAuthStorage/],
  ])('never writes them to %s', (_label, pattern) => {
    for (const file of RECOVERY_MODULES) {
      expect(readCode(file), `${file} must not persist recovery codes`).not.toMatch(pattern);
    }
  });

  it('keeps the codes in React state only', () => {
    const hook = readCode('src/hooks/useRecoveryCodes.ts');

    expect(hook).toMatch(/useState<string\[\]>\(\[\]\)/);
    // A wipe path must exist and must reset the array.
    expect(hook).toMatch(/setCodes\(\[\]\)/);
  });

  it('wipes the plaintext when the screen deactivates', () => {
    const screen = readCode('src/screens/RecoveryCodesScreen.tsx');

    expect(screen).toMatch(/useScreenFocusEffect/);
    // The focus-effect cleanup calls clear(), mirroring how the TOTP
    // enrollment screen wipes its secret.
    expect(screen).toMatch(/return\s*\(\)\s*=>\s*\{[\s\S]*clear\(\)/);
  });

  it('wipes the plaintext on both exits', () => {
    const screen = readCode('src/screens/RecoveryCodesScreen.tsx');

    // handleDone and the leave confirmation both clear before navigating.
    expect(screen).toMatch(/clear\(\);\s*onDone\(\)/);
    expect(screen).toMatch(/clear\(\);\s*onDismiss\(\)/);
  });
});

describe('recovery codes are never logged', () => {
  it('uses no console logging at all', () => {
    for (const file of RECOVERY_MODULES) {
      expect(readCode(file), file).not.toMatch(/console\.(log|warn|error|info|debug)/);
    }
  });

  it('never hands an error object or a response to the logger', () => {
    const errors = readCode('src/lib/mfaRecoveryErrors.ts');

    // The logging helper takes an ISSUE, never `unknown`. Passing a rejection
    // is how a response body (ten plaintext codes) reaches a crash report.
    expect(errors).toMatch(/logMfaRecoveryIssue\(\s*stage:\s*string,\s*issue:\s*MfaRecoveryIssue/);
    expect(errors).not.toMatch(/logError\([^)]*\berr\b/);
  });

  it('never logs from the hook or the screen', () => {
    expect(readCode('src/hooks/useRecoveryCodes.ts')).not.toMatch(/logError|logMfaRecoveryIssue/);
    expect(readCode('src/screens/RecoveryCodesScreen.tsx')).not.toMatch(/logError/);
  });
});

describe('no internal backend state reaches the UI', () => {
  it('never renders a recoverySetId, digest, version or pepper', () => {
    const screen = readCode('src/screens/RecoveryCodesScreen.tsx');

    for (const forbidden of [
      'recoverySetId',
      'digest',
      'pepperVersion',
      'selector',
      'schemaVersion',
      'createdAt',
    ]) {
      expect(screen, `${forbidden} must not reach the UI`).not.toContain(forbidden);
    }
  });

  it('drops those fields in the service instead of forwarding them', () => {
    const service = readCode('src/services/mfaRecovery.ts');

    // The parsed result exposes codes + count and nothing else.
    expect(service).toMatch(/return\s*\{\s*codes,\s*count:\s*codes\.length\s*\}/);
  });
});

describe('the client sends no identity', () => {
  it('calls the callable with no arguments', () => {
    const service = readCode('src/services/mfaRecovery.ts');

    expect(service).toMatch(/httpsCallable\(functions,\s*'generateMfaRecoveryCodes'\)/);
    expect(service).toMatch(/await call\(\)/);
    expect(service).not.toMatch(/call\(\s*\{/);
  });

  it('never references a uid, email or provider in the payload', () => {
    const service = readCode('src/services/mfaRecovery.ts');

    expect(service).not.toMatch(/uid/);
    expect(service).not.toMatch(/email/);
  });
});

describe('confirmation gates the exit', () => {
  it('disables the primary action until the user confirms', () => {
    const screen = readCode('src/screens/RecoveryCodesScreen.tsx');

    expect(screen).toMatch(/disabled=\{!recovery\.confirmed\}/);
  });

  it('warns before leaving with unsaved codes', () => {
    const screen = readCode('src/screens/RecoveryCodesScreen.tsx');

    expect(screen).toMatch(/Alert\.alert\(/);
    expect(screen).toContain('security.recoveryCodes.leaveTitle');
    expect(screen).toContain('security.recoveryCodes.leaveConfirm');
  });

  it('states the one-time warning', () => {
    expect(read('src/screens/RecoveryCodesScreen.tsx')).toContain(
      'security.recoveryCodes.warningOneTime',
    );
  });
});

describe('clipboard behaviour is honest', () => {
  it('shows a notice instead of promising an automatic wipe', () => {
    const screen = readCode('src/screens/RecoveryCodesScreen.tsx');

    expect(screen).toContain('security.recoveryCodes.clipboardNotice');
    // No timer that pretends to clear the clipboard — no platform API can
    // guarantee it, so implementing one would be misleading.
    expect(screen).not.toMatch(/setTimeout[\s\S]{0,120}Clipboard/);
  });

  it('offers no share sheet for a credential', () => {
    const screen = readCode('src/screens/RecoveryCodesScreen.tsx');

    expect(screen).not.toMatch(/Share|expo-sharing|shareAsync/);
  });
});

describe('phase boundaries', () => {
  it('offers no "lost my authenticator" option at sign-in yet', () => {
    // Consuming a recovery code does not exist. Showing the entry point would
    // advertise a door that does not open.
    const challenge = read('src/screens/TotpChallengeScreen.tsx');

    expect(challenge).not.toMatch(/recoveryCode|recovery\.code|lostAuthenticator/i);
  });

  it('never calls a consume or reset endpoint', () => {
    for (const file of [...RECOVERY_MODULES, 'src/services/mfaTotp.ts']) {
      expect(readCode(file), file).not.toMatch(/consumeMfaRecoveryCode|consumeRecoveryCode/);
    }
  });

  it('generates only after enrollment actually completed', () => {
    const shell = readCode('src/screens/AppShell.tsx');

    // The recovery flow opens from `onCompleted`, which fires after Firebase's
    // enroll() resolved — never while the QR is merely on screen.
    expect(shell).toMatch(/onCompleted=\{\(\) => \{[\s\S]*setRecoveryCodesOrigin\('enrollment'\)/);
  });

  it('keeps TOTP enrolled when generation fails', () => {
    const screen = readCode('src/screens/RecoveryCodesScreen.tsx');

    // No unenroll/rollback anywhere on the failure path.
    expect(screen).not.toMatch(/unenroll|disableTotp|rollback/i);
    expect(read('src/screens/RecoveryCodesScreen.tsx')).toContain(
      'security.recoveryCodes.failure.enrollmentTitle',
    );
  });
});

describe('regeneration requires confirmation and reauthentication', () => {
  it('confirms before invalidating previous codes', () => {
    const settings = read('src/screens/TwoFactorSettingsScreen.tsx');

    expect(settings).toContain('security.recoveryCodes.regenerate.confirmTitle');
    expect(settings).toContain('security.recoveryCodes.regenerate.confirmDescription');
  });

  it('only offers regeneration while a factor is enrolled', () => {
    const settings = readCode('src/screens/TwoFactorSettingsScreen.tsx');
    const action = settings.indexOf('security.recoveryCodes.regenerate.action');
    const factorsBranch = settings.indexOf('mfa.factors.map');

    expect(factorsBranch).toBeGreaterThanOrEqual(0);
    expect(action).toBeGreaterThan(factorsBranch);
  });

  it('reauthenticates through the shared machinery, not a new flow', () => {
    const hook = readCode('src/hooks/useRecoveryCodes.ts');

    expect(hook).toMatch(/startTotpReauthentication/);
    expect(hook).toMatch(/finishTotpReauthentication/);
    // No bespoke credential handling: no direct Firebase auth imports.
    expect(hook).not.toMatch(/from 'firebase\/auth'/);
  });

  it('still challenges for TOTP during reauthentication', () => {
    const hook = readCode('src/hooks/useRecoveryCodes.ts');

    // The first factor alone must never be enough to mint the codes that
    // stand in for the second factor.
    expect(hook).toMatch(/reauthChallenge/);
    expect(hook).toMatch(/submitReauthCode/);
  });
});

describe('double submit is blocked', () => {
  it('guards the generation function itself, not just the button', () => {
    const hook = readCode('src/hooks/useRecoveryCodes.ts');

    expect(hook).toMatch(/inFlight\.current/);
    expect(hook).toMatch(/if \(inFlight\.current\) return false/);
  });

  it('never retries a conflict automatically', () => {
    const hook = readCode('src/hooks/useRecoveryCodes.ts');
    const service = readCode('src/services/mfaRecovery.ts');

    for (const source of [hook, service]) {
      expect(source).not.toMatch(/while \(/);
      expect(source).not.toMatch(/setInterval|setTimeout/);
    }
  });
});
