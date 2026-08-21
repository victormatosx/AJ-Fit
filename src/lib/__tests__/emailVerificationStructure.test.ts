import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
const premiumGate = readFileSync(new URL('../premiumGate.ts', import.meta.url), 'utf8');
const context = readFileSync(
  new URL('../../state/AuthContext.tsx', import.meta.url),
  'utf8',
);
const hook = readFileSync(
  new URL('../../hooks/useEmailVerification.ts', import.meta.url),
  'utf8',
);
const screen = readFileSync(
  new URL('../../screens/EmailVerificationScreen.tsx', import.meta.url),
  'utf8',
);
const socialAuth = readFileSync(
  new URL('../../services/socialAuth.ts', import.meta.url),
  'utf8',
);
const verificationService = readFileSync(
  new URL('../../services/emailVerification.ts', import.meta.url),
  'utf8',
);

describe('email verification integration structure', () => {
  it('starts one automatic send immediately after Auth creation', () => {
    const create = context.indexOf('await signUpWithEmail(email, password, name)');
    const send = context.indexOf('sendVerificationEmail(newUser)');
    const provision = context.indexOf('await provisionNewUser(newUser');

    expect(create).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(create);
    expect(provision).toBeGreaterThan(-1);
    expect(send).toBeLessThan(provision);
    expect(context).toContain('const sendError = await verificationError');
    expect(screen).not.toContain('useEffect');
    expect(screen).not.toContain('sendVerificationEmail');
  });

  it('gives the central guard priority over questionnaire and app routes', () => {
    const verificationGuard = premiumGate.indexOf('if (state.emailVerificationRequired)');
    const questionnaireGuard = premiumGate.indexOf("if (state.questionnaireResolution === 'not_found')");

    expect(verificationGuard).toBeGreaterThan(-1);
    expect(verificationGuard).toBeLessThan(questionnaireGuard);
    expect(app).toContain('emailVerificationRequired,');
    expect(app).toContain("{resolvedScreen === 'emailVerification' && <EmailVerificationScreen />}");
    expect(premiumGate).toContain("['emailVerification', 'paywall', 'app']");
  });

  it('reloads through AuthContext and lets the guard decide navigation', () => {
    expect(hook).toContain('await refreshEmailVerification()');
    expect(context).toContain('await refreshEmailVerificationStatus()');
    expect(context).toContain('setAuthRevision((revision) => revision + 1)');
    expect(screen).not.toContain('setScreen');
    expect(screen).not.toContain('navigate(');
    expect(verificationService).toContain('await refreshedUser.getIdToken(true)');
  });

  it('reuses logout and disables every action during an operation', () => {
    expect(hook).toContain('await logout()');
    expect(screen.match(/disabled=\{verification\.busy\}/g)).toHaveLength(3);
    expect(screen).toContain('verification.signOut()');
  });

  it('preserves account linking and consumes the Firebase-linked user', () => {
    expect(socialAuth).toContain('await linkWithCredential(user, pendingCredential)');
    // Password linking, provider linking, and the post-MFA continuation all
    // consume Firebase's linked user for the same UID.
    expect(socialAuth.match(/const \{ user: linkedUser \}/g)).toHaveLength(3);
    expect(socialAuth.match(/return linkedUser;/g)).toHaveLength(3);
    expect(socialAuth).toContain('pendingCredential = null');
    expect(socialAuth).toContain('AccountLinkingRequiredError');
  });

  it('contains no polling, AppState auto-refresh or MFA implementation', () => {
    for (const forbidden of [
      'setInterval',
      'AppState',
      'multiFactor',
      'Totp',
      'PhoneAuthProvider',
    ]) {
      expect(`${screen}\n${hook}\n${context}`).not.toContain(forbidden);
    }
  });
});
