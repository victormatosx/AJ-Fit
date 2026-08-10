import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../..', relativePath), 'utf8');
}

const app = source('App.tsx');
const authContext = source('src/state/AuthContext.tsx');
const authScreen = source('src/screens/AuthScreen.tsx');
const appShell = source('src/screens/AppShell.tsx');
const settingsScreen = source('src/screens/SettingsScreen.tsx');
const securityScreen = source('src/screens/SecurityScreen.tsx');
const service = source('src/services/totpMfaPoc.ts');
const enrollmentScreen = source('src/screens/TotpMfaPocScreen.tsx');
const challengeScreen = source('src/screens/TotpMfaPocChallengeScreen.tsx');
const signInHook = source('src/hooks/useTotpMfaPocSignIn.ts');

describe('TOTP MFA POC integration structure', () => {
  it('makes both POC entry points development-only', () => {
    expect(settingsScreen).toContain('{__DEV__ && onOpenTotpMfaPoc ? (');
    expect(appShell).toContain(
      'onOpenTotpMfaPoc={__DEV__ ? () => setShowTotpMfaPoc(true) : undefined}',
    );
    expect(appShell).toContain('{__DEV__ && showTotpMfaPoc && (');
    expect(authScreen).toContain(
      "if (__DEV__ && mode === 'login' && isMultiFactorAuthRequired(err))",
    );
    expect(enrollmentScreen).toContain('if (!__DEV__) return null;');
    expect(challengeScreen).toContain('if (!__DEV__) return null;');
  });

  it('wraps the conditional logout label in Text for React Native', () => {
    expect(enrollmentScreen).toMatch(
      /<Text style=\{\{ \.\.\.typography\.subtitle, color: colors\.text \}\}>[\s\S]*totpMfaPoc\.actions\.signOutAndTest[\s\S]*<\/Text>/,
    );
  });

  it('keeps SecurityScreen out of the experimental implementation', () => {
    expect(securityScreen).not.toContain('Totp');
    expect(securityScreen).not.toContain('MfaPoc');
    expect(securityScreen).not.toContain('multiFactor');
  });

  it('does not persist secrets, OTPs or MFA flags and adds no forbidden SDKs', () => {
    const pocSource = `${service}\n${enrollmentScreen}\n${challengeScreen}\n${signInHook}`;
    for (const forbidden of [
      'AsyncStorage',
      'SecureStore',
      'Firestore',
      'setDoc(',
      'updateDoc(',
      '@react-native-firebase',
      'PhoneAuthProvider',
      'PhoneMultiFactorGenerator',
      'RecaptchaVerifier',
      'console.log',
      'console.error',
    ]) {
      expect(pocSource).not.toContain(forbidden);
    }
    expect(service).toContain('let pendingSignInResolver: MultiFactorResolver | null = null');
    expect(service).not.toContain('emailVerified: true');
    expect(service).not.toContain('mfaEnabled');
    expect(service).not.toContain('mfaVerified');
  });

  it('lets Firebase/AuthContext/central guard choose Dashboard versus Quiz', () => {
    expect(signInHook).not.toContain('navigate(');
    expect(signInHook).not.toContain('setScreen');
    expect(challengeScreen).not.toContain('Dashboard');
    expect(authContext).toContain('subscribeToAuthState(async (nextUser) =>');
    expect(authContext).toContain('await loadUserState(nextUser.uid)');

    const questionnaireGuard = app.indexOf('if (!questionnaire)');
    const funnelGuard = app.indexOf('if (FUNNEL_ONLY.includes(screen))');
    expect(questionnaireGuard).toBeGreaterThan(-1);
    expect(funnelGuard).toBeGreaterThan(questionnaireGuard);
    expect(app).not.toContain('TotpMfaPoc');
  });

  it('preserves the original resolver error only on the DEV password-login POC path', () => {
    const authService = source('src/services/auth.ts');
    expect(authService).toContain(
      'if (__DEV__ && isMultiFactorAuthRequired(err)) throw err;',
    );
    expect(authScreen).toContain('captureTotpMfaSignInPoc(err)');
    expect(service).toContain('getMultiFactorResolver(auth, error as MultiFactorError)');
    expect(service).toContain('resolver.resolveSignIn(assertion)');
  });
});
