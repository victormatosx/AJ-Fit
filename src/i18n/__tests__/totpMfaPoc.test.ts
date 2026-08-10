import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import enAuth from '../resources/en/auth.json';
import esAuth from '../resources/es/auth.json';
import ptBRAuth from '../resources/pt-BR/auth.json';
import enSettings from '../resources/en/settings.json';
import esSettings from '../resources/es/settings.json';
import ptBRSettings from '../resources/pt-BR/settings.json';

const enrollmentScreen = readFileSync(
  new URL('../../screens/TotpMfaPocScreen.tsx', import.meta.url),
  'utf8',
);
const challengeScreen = readFileSync(
  new URL('../../screens/TotpMfaPocChallengeScreen.tsx', import.meta.url),
  'utf8',
);

describe('TOTP MFA POC i18n', () => {
  it('ships complete POC copy in pt-BR, en and es', () => {
    for (const resource of [ptBRAuth, enAuth, esAuth]) {
      expect(resource.totpMfaPoc.badge).toBeTruthy();
      expect(Object.values(resource.totpMfaPoc.actions).every(Boolean)).toBe(true);
      expect(Object.values(resource.totpMfaPoc.errors).every(Boolean)).toBe(true);
      expect(resource.totpMfaPoc.enrollment.description).toBeTruthy();
      expect(resource.totpMfaPoc.challenge.description).toBeTruthy();
      expect(resource.totpMfaPoc.loginTest.instructions).toBeTruthy();
    }
    for (const resource of [ptBRSettings, enSettings, esSettings]) {
      expect(resource.sections.development).toBeTruthy();
      expect(resource.items.totpMfaPoc).toBeTruthy();
      expect(resource.development.totpMfaPocDescription).toBeTruthy();
    }
  });

  it('uses translation keys for user-visible enrollment and challenge copy', () => {
    const screens = `${enrollmentScreen}\n${challengeScreen}`;
    for (const key of [
      'totpMfaPoc.enrollment.title',
      'totpMfaPoc.setupKey',
      'totpMfaPoc.otpAuthUri',
      'totpMfaPoc.codeLabel',
      'totpMfaPoc.actions.enroll',
      'totpMfaPoc.challenge.title',
      'totpMfaPoc.actions.resolve',
    ]) {
      expect(screens).toContain(key);
    }
  });
});

