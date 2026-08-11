import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../..', relativePath), 'utf8');
}

const app = source('App.tsx');
const appShell = source('src/screens/AppShell.tsx');
const authContext = source('src/state/AuthContext.tsx');
const authScreen = source('src/screens/AuthScreen.tsx');
const challengeScreen = source('src/screens/TotpMfaPocChallengeScreen.tsx');
const enrollmentHook = source('src/hooks/useTotpEnrollment.ts');
const enrollmentScreen = source('src/screens/TotpEnrollmentScreen.tsx');
const managementHook = source('src/hooks/useTotpMfa.ts');
const managementScreen = source('src/screens/TwoFactorSettingsScreen.tsx');
const securityScreen = source('src/screens/SecurityScreen.tsx');
const service = source('src/services/mfaTotp.ts');
const signInPocService = source('src/services/totpMfaPoc.ts');

describe('production TOTP enrollment and management structure', () => {
  it('keeps Screen -> Hook -> Service -> Firebase boundaries', () => {
    expect(securityScreen).toContain('onOpenTwoFactor');
    expect(securityScreen).not.toContain("from 'firebase/auth'");
    expect(managementScreen).toContain("from '../hooks/useTotpMfa'");
    expect(enrollmentScreen).toContain("from '../hooks/useTotpEnrollment'");
    expect(managementScreen).not.toContain("from 'firebase/auth'");
    expect(enrollmentScreen).not.toContain("from 'firebase/auth'");
    expect(service).toContain("from 'firebase/auth'");
  });

  it('uses production overlays and removes the DEV enrollment entry', () => {
    expect(appShell).toContain('<TwoFactorSettingsScreen');
    expect(appShell).toContain('<TotpEnrollmentScreen');
    expect(appShell).not.toContain('TotpMfaPocScreen');
    expect(source('src/screens/SettingsScreen.tsx')).not.toContain('onOpenTotpMfaPoc');
    expect(securityScreen).toContain('onPress: onOpenTwoFactor');
  });

  it('keeps only the sign-in challenge bridge DEV-only until Phase 3', () => {
    expect(authScreen).toContain(
      "if (__DEV__ && mode === 'login' && isMultiFactorAuthRequired(err))",
    );
    expect(challengeScreen).toContain('if (!__DEV__) return null;');
    expect(signInPocService).toContain(
      'let pendingSignInResolver: MultiFactorResolver | null = null',
    );
    expect(signInPocService).not.toContain('generateSecret');
    expect(signInPocService).not.toContain('enroll(');
  });

  it('derives status from Firebase factors and operates on explicit factor UIDs', () => {
    expect(service).toContain('multiFactor(currentUserOrThrow()).enrolledFactors');
    expect(service).toContain('selectTotpFactors');
    expect(service).toContain('candidate.uid === factorUid');
    expect(service).not.toContain('enrolledFactors[0]');
    expect(service).not.toContain('mfaEnabled');
    expect(service).not.toContain('twoFactorEnabled');
    expect(service).not.toContain('totpEnabled');
  });

  it('requires password reauthentication for enrollment and unenrollment', () => {
    expect(service).toContain('reauthenticatePasswordUser(currentPassword)');
    expect(service).toContain('preserveMultiFactorError: true');
    expect(service).toContain('finishTotpUnenrollment');
    expect(managementHook).toContain('startTotpUnenrollmentWithPassword');
    expect(enrollmentHook).toContain('startTotpEnrollmentWithPassword');
  });

  it('keeps secret and OTP out of persistent stores, logs and Firebase data', () => {
    const implementation = [
      service,
      enrollmentHook,
      enrollmentScreen,
      managementHook,
      managementScreen,
    ].join('\n');
    for (const forbidden of [
      'AsyncStorage',
      'SecureStore',
      'setDoc(',
      'updateDoc(',
      '@react-native-firebase',
      'PhoneAuthProvider',
      'PhoneMultiFactorGenerator',
      'RecaptchaVerifier',
      'console.log',
      'console.error',
      'emailVerified: true',
    ]) {
      expect(implementation).not.toContain(forbidden);
    }
    expect(enrollmentHook).toContain('draftRef.current = null');
    expect(enrollmentHook).toContain('clearSensitiveState()');
  });

  it('does not alter central Quiz/Dashboard navigation', () => {
    expect(authContext).toContain('subscribeToAuthState(async (nextUser) =>');
    expect(authContext).toContain('await loadUserState(nextUser.uid)');
    const questionnaireGuard = app.indexOf('if (!questionnaire)');
    const funnelGuard = app.indexOf('if (FUNNEL_ONLY.includes(screen))');
    expect(questionnaireGuard).toBeGreaterThan(-1);
    expect(funnelGuard).toBeGreaterThan(questionnaireGuard);
    expect(app).not.toContain('TotpEnrollment');
  });
});
