import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const context = readFileSync(new URL('../AuthContext.tsx', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../../screens/AuthScreen.tsx', import.meta.url), 'utf8');

describe('social registration gate wiring', () => {
  it('checks email registration eligibility before creating the Firebase user', () => {
    const signUpFlow = context.slice(
      context.indexOf('signUp: (email, password, name, answers, legalAccepted, prepared)'),
      context.indexOf('signIn: (email, password)'),
    );

    const eligibilityCheck = signUpFlow.indexOf(
      'assertNewAccountEligibility({ answers, legalAccepted })',
    );
    const firebaseCreation = signUpFlow.indexOf(
      'await signUpWithEmail(email, password, name)',
    );
    expect(eligibilityCheck).toBeGreaterThan(-1);
    expect(firebaseCreation).toBeGreaterThan(eligibilityCheck);
  });

  it('uses Firebase new-user metadata and rolls back rejected new identities', () => {
    expect(context).toContain('isNewUser: socialResult.isNewUser');
    expect(context).toContain('await discardNewSocialIdentity(incompleteUser)');
    expect(context).toContain("admission === 'requires-provisioning'");
    expect(context).toContain('await provisionNewUser(authedUser');
  });

  it('does not publish a non-null auth listener result during an identity operation', () => {
    const operationGuard = context.indexOf('if (identityOperationFlight.isRunning())');
    const publishUser = context.indexOf('setUser(nextUser);', operationGuard);

    expect(operationGuard).toBeGreaterThan(-1);
    expect(publishUser).toBeGreaterThan(operationGuard);
  });

  it('keeps linking on the explicit existing-account provisioning path', () => {
    expect(context.match(/'existing',/g)).toHaveLength(2);
    expect(context).not.toMatch(/socialLinkPassword[\s\S]{0,500}resolveSocialAccountAdmission/);
    expect(context).not.toMatch(/socialLinkProvider[\s\S]{0,500}resolveSocialAccountAdmission/);
  });

  it('reveals the shared legal controls after a new social attempt from login', () => {
    expect(screen).toContain("code === 'registrationLegalAcceptanceRequired'");
    expect(screen).toContain("mode === 'signup' || pendingNewSocialProvider !== null");
    expect(screen).toContain('pendingNewSocialProvider === provider');
    expect(screen).toContain('<LegalDocumentModal document={legalDocument}');
  });
});
