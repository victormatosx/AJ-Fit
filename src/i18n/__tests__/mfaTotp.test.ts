import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/settings.json';
import es from '../resources/es/settings.json';
import ptBR from '../resources/pt-BR/settings.json';
import enAuth from '../resources/en/auth.json';
import esAuth from '../resources/es/auth.json';
import ptBRAuth from '../resources/pt-BR/auth.json';

const enrollmentScreen = readFileSync(
  new URL('../../screens/TotpEnrollmentScreen.tsx', import.meta.url),
  'utf8',
);
const managementScreen = readFileSync(
  new URL('../../screens/TwoFactorSettingsScreen.tsx', import.meta.url),
  'utf8',
);
const reauthenticationMethods = readFileSync(
  new URL('../../components/auth/ReauthenticationMethods.tsx', import.meta.url),
  'utf8',
);
const challengeScreen = readFileSync(
  new URL('../../screens/TotpChallengeScreen.tsx', import.meta.url),
  'utf8',
);

describe('production TOTP MFA i18n', () => {
  it('ships complete and structurally equal copy in pt-BR, en and es', () => {
    const resources = [ptBR.security.twoFactor, en.security.twoFactor, es.security.twoFactor];
    expect(resources.map((resource) => Object.keys(resource))).toEqual([
      Object.keys(resources[0]),
      Object.keys(resources[0]),
      Object.keys(resources[0]),
    ]);
    for (const resource of resources) {
      expect(resource.title).toBeTruthy();
      expect(Object.values(resource.status).every(Boolean)).toBe(true);
      expect(Object.values(resource.actions).every(Boolean)).toBe(true);
      expect(Object.values(resource.enrollment).every(Boolean)).toBe(true);
      expect(Object.values(resource.errors).every(Boolean)).toBe(true);
    }
  });

  it('uses translation keys for all production enrollment and management copy', () => {
    const screens = `${enrollmentScreen}\n${managementScreen}\n${reauthenticationMethods}`;
    for (const key of [
      'security.twoFactor.title',
      'security.twoFactor.status.enabled',
      'security.twoFactor.status.disabled',
      'security.twoFactor.actions.enable',
      'security.twoFactor.actions.disable',
      'security.twoFactor.enrollment.manualKey',
      'security.twoFactor.enrollment.copyKey',
      'security.twoFactor.enrollment.openAuthenticator',
      'security.twoFactor.enrollment.confirm',
      'security.twoFactor.reauth.passwordLabel',
      'security.twoFactor.reauth.continueWithPassword',
      'security.twoFactor.reauth.continueWithGoogle',
      'security.twoFactor.reauth.continueWithApple',
    ]) {
      expect(screens).toContain(key);
    }
    expect(screens).not.toContain('federatedReauthPending');
  });

  it('ships equal production challenge copy in pt-BR, en and es', () => {
    const resources = [
      ptBRAuth.totpChallenge,
      enAuth.totpChallenge,
      esAuth.totpChallenge,
    ];
    expect(resources.map((resource) => Object.keys(resource))).toEqual([
      Object.keys(resources[0]),
      Object.keys(resources[0]),
      Object.keys(resources[0]),
    ]);
    for (const resource of resources) {
      expect(resource.title).toBeTruthy();
      expect(resource.description).toBeTruthy();
      expect(resource.factor.defaultName).toContain('{{index}}');
      expect(Object.values(resource.actions).every(Boolean)).toBe(true);
      expect(Object.values(resource.errors).every(Boolean)).toBe(true);
    }
  });

  it('uses translation keys for every visible challenge string', () => {
    for (const key of [
      'totpChallenge.kicker',
      'totpChallenge.title',
      'totpChallenge.description',
      'totpChallenge.codeLabel',
      'totpChallenge.factor.selectionLabel',
      'totpChallenge.factor.defaultName',
      'totpChallenge.actions.continue',
      'totpChallenge.actions.cancel',
      'totpChallenge.actions.backToLogin',
      'totpChallenge.errors.invalidCode',
    ]) {
      expect(challengeScreen).toContain(key);
    }
    expect(challengeScreen).not.toContain('enrollmentId');
    expect(challengeScreen).not.toContain('factorId');
  });
});
