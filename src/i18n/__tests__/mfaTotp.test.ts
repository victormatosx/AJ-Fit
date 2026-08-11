import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/settings.json';
import es from '../resources/es/settings.json';
import ptBR from '../resources/pt-BR/settings.json';

const enrollmentScreen = readFileSync(
  new URL('../../screens/TotpEnrollmentScreen.tsx', import.meta.url),
  'utf8',
);
const managementScreen = readFileSync(
  new URL('../../screens/TwoFactorSettingsScreen.tsx', import.meta.url),
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
    const screens = `${enrollmentScreen}\n${managementScreen}`;
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
    ]) {
      expect(screens).toContain(key);
    }
  });
});
