import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../..', relativePath), 'utf8');
}

const app = source('App.tsx');
const premiumGate = source('src/lib/premiumGate.ts');
const authContext = source('src/state/AuthContext.tsx');
const authScreen = source('src/screens/AuthScreen.tsx');
const authService = source('src/services/auth.ts');
const socialService = source('src/services/socialAuth.ts');
const challengeHook = source('src/hooks/useTotpChallenge.ts');
const challengeScreen = source('src/screens/TotpChallengeScreen.tsx');
const mfaService = source('src/services/mfaTotp.ts');

describe('definitive TOTP sign-in flow contract', () => {
  it('keeps MFA as an in-memory AuthScreen substate, not a funnel route', () => {
    expect(authScreen).toContain('const [totpChallenge, setTotpChallenge]');
    expect(authScreen).toContain('if (totpChallenge)');
    expect(app).not.toContain("| 'totpChallenge'");
    expect(app).not.toContain('<TotpChallengeScreen');
  });

  it('lets onAuthStateChanged publish User and load both protected data sources', () => {
    expect(challengeHook).not.toContain('setUser(');
    expect(challengeHook).not.toContain('loadUserState(');
    expect(authContext).toContain('subscribeToAuthState(async (nextUser) =>');
    expect(authContext).toContain('const userStatePromise = loadUserState(nextUser.uid)');
    expect(authContext).toContain('await userStatePromise');
    expect(authContext).toContain('getUserProfile(uid)');
    expect(authContext).toContain('getLatestQuestionnaire(uid, attempt)');
  });

  it('routes an existing questionnaire to Dashboard only after authentication loads', () => {
    const loadingGate = premiumGate.indexOf(
      'if (state.authInitializing || state.profileLoading) return null;',
    );
    const questionnaireGuard = premiumGate.indexOf("if (state.questionnaireResolution === 'not_found')");
    const dashboardGuard = premiumGate.indexOf("return 'app';");
    expect(loadingGate).toBeGreaterThan(-1);
    expect(questionnaireGuard).toBeGreaterThan(loadingGate);
    expect(dashboardGuard).toBeGreaterThan(questionnaireGuard);
    expect(app).toContain('const resolvedScreen = resolvePremiumGate({');
  });

  it('preserves email-verification priority over Quiz/Dashboard', () => {
    const verificationGuard = premiumGate.indexOf('if (state.emailVerificationRequired)');
    const questionnaireGuard = premiumGate.indexOf("if (state.questionnaireResolution === 'not_found')");
    expect(verificationGuard).toBeGreaterThan(-1);
    expect(verificationGuard).toBeLessThan(questionnaireGuard);
  });

  it('preserves one first-factor acquisition for Google and Apple', () => {
    expect(socialService).toContain(
      'const acquireCredential: Record<SocialProvider, () => Promise<ProviderResult>>',
    );
    expect(socialService).toContain('result = await acquireCredential[provider]()');
    expect(socialService).toContain('throw err;');
    expect(authScreen).toContain('beginTotpChallenge(err, provider)');
    expect(challengeHook).toContain('resolveTotpSignIn(selectedHintUid, code)');
  });

  it('keeps account-exists and MFA as distinct continuations on the same UID', () => {
    const accountExists = socialService.indexOf(
      "errorCode(err) === 'auth/account-exists-with-different-credential'",
    );
    const mfaRequired = socialService.indexOf('isMultiFactorAuthRequired(err)', accountExists);
    expect(accountExists).toBeGreaterThan(-1);
    expect(mfaRequired).toBeGreaterThan(accountExists);
    expect(socialService).toContain('linkWithCredential(user, pendingCredential)');
    expect(socialService).toContain('finalizeSocialSignInAfterMfa');
  });

  it('keeps resolver, hints and OTP away from every persistence layer', () => {
    const implementation = `${mfaService}\n${challengeHook}\n${challengeScreen}`;
    expect(mfaService).toContain(
      'let pendingSignInResolver: MultiFactorResolver | null = null',
    );
    for (const forbidden of [
      'secureAuthStorage',
      "from 'expo-secure-store'",
      "from '@react-native-async-storage/async-storage'",
      "from 'firebase/firestore'",
      "from 'firebase/storage'",
    ]) {
      expect(implementation).not.toContain(forbidden);
    }
  });

  it('preserves the existing logout and secure-session cleanup order', () => {
    const firebaseSignOut = authService.indexOf('await signOut(auth)');
    const secureCleanup = authService.indexOf('await clearSecureAuthSession()');
    expect(firebaseSignOut).toBeGreaterThan(-1);
    expect(secureCleanup).toBeGreaterThan(firebaseSignOut);
  });
});
