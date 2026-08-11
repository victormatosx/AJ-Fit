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
const challengeHook = source('src/hooks/useTotpChallenge.ts');
const challengeScreen = source('src/screens/TotpChallengeScreen.tsx');
const enrollmentHook = source('src/hooks/useTotpEnrollment.ts');
const enrollmentScreen = source('src/screens/TotpEnrollmentScreen.tsx');
const managementHook = source('src/hooks/useTotpMfa.ts');
const managementScreen = source('src/screens/TwoFactorSettingsScreen.tsx');
const securityScreen = source('src/screens/SecurityScreen.tsx');
const service = source('src/services/mfaTotp.ts');
const authService = source('src/services/auth.ts');
const socialService = source('src/services/socialAuth.ts');

describe('production TOTP enrollment and management structure', () => {
  it('keeps Screen -> Hook -> Service -> Firebase boundaries', () => {
    expect(securityScreen).toContain('onOpenTwoFactor');
    expect(securityScreen).not.toContain("from 'firebase/auth'");
    expect(managementScreen).toContain("from '../hooks/useTotpMfa'");
    expect(enrollmentScreen).toContain("from '../hooks/useTotpEnrollment'");
    expect(managementScreen).not.toContain("from 'firebase/auth'");
    expect(enrollmentScreen).not.toContain("from 'firebase/auth'");
    expect(challengeScreen).toContain("from '../hooks/useTotpChallenge'");
    expect(challengeScreen).not.toContain("from 'firebase/auth'");
    expect(challengeHook).toContain('resolveTotpSignIn');
    expect(service).toContain("from 'firebase/auth'");
  });

  it('uses production overlays and removes the DEV enrollment entry', () => {
    expect(appShell).toContain('<TwoFactorSettingsScreen');
    expect(appShell).toContain('<TotpEnrollmentScreen');
    expect(securityScreen).toContain('onPress: onOpenTwoFactor');
  });

  it('promotes one production sign-in challenge for every first factor', () => {
    expect(authScreen).toContain("beginTotpChallenge(err, 'password')");
    expect(authScreen).toContain('beginTotpChallenge(err, provider)');
    expect(authScreen).toContain("beginTotpChallenge(err, 'account-linking')");
    expect(authScreen).toContain('<TotpChallengeScreen');
    expect(authScreen).not.toContain('__DEV__');
    expect(challengeScreen).not.toContain('__DEV__');
    expect(service).toContain(
      'let pendingSignInResolver: MultiFactorResolver | null = null',
    );
    expect(authService).toContain('if (isMultiFactorAuthRequired(err)) throw err;');
    expect(socialService).toContain('if (isMultiFactorAuthRequired(err))');
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
      challengeHook,
      challengeScreen,
    ].join('\n');
    for (const forbidden of [
      "from '@react-native-async-storage/async-storage'",
      "from 'expo-secure-store'",
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
    expect(service).toContain('clearTotpSignInChallenge');
  });

  it('does not alter central Quiz/Dashboard navigation', () => {
    expect(authContext).toContain('subscribeToAuthState(async (nextUser) =>');
    expect(authContext).toContain('await loadUserState(nextUser.uid)');
    const questionnaireGuard = app.indexOf('if (!questionnaire)');
    const funnelGuard = app.indexOf('if (FUNNEL_ONLY.includes(screen))');
    expect(questionnaireGuard).toBeGreaterThan(-1);
    expect(funnelGuard).toBeGreaterThan(questionnaireGuard);
    expect(app).not.toContain('TotpEnrollment');
    expect(app).not.toContain('TotpChallenge');
    expect(challengeHook).not.toContain('setUser(');
    expect(challengeHook).not.toContain('navigate(');
    expect(challengeHook).not.toContain('setScreen(');
  });

  it('keeps OTP input accessible, numeric, bounded and retryable', () => {
    expect(challengeScreen).toContain('keyboardType="number-pad"');
    expect(challengeScreen).toContain('maxLength={6}');
    expect(challengeScreen).toContain('textContentType="oneTimeCode"');
    expect(challengeHook).toContain("value.replace(/\\D/g, '').slice(0, 6)");
    expect(challengeHook).toContain('operationLock.current');
    expect(challengeHook).toContain('setIssue(nextIssue)');
  });

  it('keeps resolver and OTP process-memory only', () => {
    const signInImplementation = `${service}\n${challengeHook}\n${challengeScreen}`;
    for (const forbidden of [
      "from '@react-native-async-storage/async-storage'",
      "from 'expo-secure-store'",
      'setDoc(',
      'updateDoc(',
      'console.log',
      'console.error',
    ]) {
      expect(signInImplementation).not.toContain(forbidden);
    }
    expect(challengeHook).toContain('clearTotpSignInChallenge()');
    expect(challengeHook).toContain("setCodeState('')");
  });

  it('returns expired/invalid sessions to Login without adding MFA to the funnel', () => {
    expect(challengeHook).toContain("'expiredCode'");
    expect(challengeHook).toContain("'sessionExpired'");
    expect(challengeHook).toContain('callbacks.onSessionExpired()');
    expect(authScreen).toContain("setMode('login')");
    expect(authScreen).toContain("setError(t('totpChallenge.errors.sessionExpired'))");
    expect(app).not.toContain("| 'totpChallenge'");
  });
});
