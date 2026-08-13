import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/auth.json';
import es from '../resources/es/auth.json';
import ptBR from '../resources/pt-BR/auth.json';

const screen = readFileSync(
  new URL('../../screens/EmailVerificationScreen.tsx', import.meta.url),
  'utf8',
);

describe('email verification i18n', () => {
  it('ships complete, interpolatable copy in pt-BR, en and es', () => {
    for (const resource of [ptBR, en, es]) {
      const verification = resource.emailVerification;
      expect(verification.kicker).toBeTruthy();
      expect(verification.titleLine1).toBeTruthy();
      expect(verification.titleLine2).toBeTruthy();
      expect(verification.descriptionBeforeEmail).toBeTruthy();
      expect(verification.descriptionAfterEmail).toBeTruthy();
      expect(Object.values(verification.actions).every(Boolean)).toBe(true);
      expect(Object.values(verification.feedback).every(Boolean)).toBe(true);
    }
  });

  it('references translations for every visible state', () => {
    for (const key of [
      'emailVerification.kicker',
      'emailVerification.titleLine1',
      'emailVerification.descriptionBeforeEmail',
      'emailVerification.descriptionAfterEmail',
      'emailVerification.actions.check',
      'emailVerification.actions.checking',
      'emailVerification.actions.resend',
      'emailVerification.actions.resending',
      'emailVerification.actions.signOut',
      'emailVerification.feedback.resent',
      'emailVerification.feedback.verified',
    ]) {
      expect(screen).toContain(key);
    }

    for (const hardcode of [
      'Verifique seu e-mail',
      'Já verifiquei meu e-mail',
      'Reenviar e-mail',
      'Entrar com outra conta',
      'E-mail de verificação enviado novamente',
    ]) {
      expect(screen).not.toContain(hardcode);
    }
  });
});
