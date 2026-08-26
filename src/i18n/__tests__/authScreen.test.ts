import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '../resources/en/auth.json';
import es from '../resources/es/auth.json';
import ptBR from '../resources/pt-BR/auth.json';

const screen = readFileSync(new URL('../../screens/AuthScreen.tsx', import.meta.url), 'utf8');
const socialService = readFileSync(new URL('../../services/socialAuth.ts', import.meta.url), 'utf8');

describe('Auth screen i18n', () => {
  it('ships signup, login, recovery, social and linking copy in every language', () => {
    for (const resource of [ptBR, en, es]) {
      expect(Object.values(resource.signup).every(Boolean)).toBe(true);
      expect(Object.values(resource.login).every(Boolean)).toBe(true);
      expect(Object.values(resource.reset).every(Boolean)).toBe(true);
      expect(Object.values(resource.fields).every(Boolean)).toBe(true);
      expect(Object.values(resource.validation).every(Boolean)).toBe(true);
      expect(resource.social.continueWith).toContain('{{provider}}');
      expect(resource.linking.passwordMessage).toContain('{{email}}');
      expect(Object.values(resource.errors).every(Boolean)).toBe(true);
    }
  });

  it('uses translation keys for all visible authentication paths', () => {
    for (const key of [
      'signup.kicker',
      'login.kicker',
      'reset.kicker',
      'fields.name',
      'validation.passwordMinimum',
      'actions.createAccount',
      'actions.sendLinkCooldown',
      'social.continueWith',
      'linking.passwordMessage',
      'linking.providerMessage',
      'errors.genericWithCode',
      'accessibility.togglePassword',
    ]) expect(screen).toContain(key);

    for (const hardcode of [
      'ÚLTIMO PASSO',
      'BEM-VINDO DE VOLTA',
      'RECUPERAR ACESSO',
      'placeholder="Seu nome"',
      'placeholder="Senha"',
      'Continuar com Apple',
      'Continuar com Google',
      'Conta já existente',
      'Entrar e vincular',
    ]) expect(screen).not.toContain(hardcode);

    expect(screen).not.toContain('actions.startTrial');
    for (const resource of [ptBR, en, es]) {
      expect(resource.actions).not.toHaveProperty('startTrial');
      expect(resource.signup.subtitle).not.toMatch(
        /trial|teste gr[aá]tis|prueba gratis|7\s*(dias|days|días)|sem cobran[cç]a|no charge|sin cargo/i,
      );
    }
  });

  it('presents throttling and reset cooldown without infrastructure details', () => {
    expect(ptBR.errors.tooManyRequests).toBe(
      'Muitas tentativas realizadas. Aguarde um momento antes de tentar novamente.',
    );
    for (const resource of [ptBR, en, es]) {
      expect(resource.errors.tooManyRequests).not.toMatch(
        /firebase|identity|quota|infra/i,
      );
      expect(resource.actions.sendLinkCooldown).toContain('{{seconds}}');
    }

    expect(screen).toContain('requestPasswordResetWithCooldown');
    expect(screen).toContain("mode === 'reset' && resetCooldown.isActive()");
    expect(screen).toContain("result.status === 'cooldown'");
    expect(screen).toContain('setInterval');
    expect(screen).toContain('clearInterval');
  });

  it('keeps signup limited to authentication instead of commercial eligibility', () => {
    for (const forbiddenDependency of [
      'react-native-purchases',
      'checkTrialOrIntroductoryPriceEligibility',
      'iosPromotion',
      'promoApplied',
    ]) expect(screen).not.toContain(forbiddenDependency);
  });

  it('preserves email/password and Google/Apple authentication behavior', () => {
    for (const token of [
      'await signUp(email, password, name, quiz, preparedWorkoutProgram)',
      'await signIn(email, password)',
      '() => reset(email)',
      'await signInWithProvider(provider, quiz)',
      'await completeLinkingWithPassword(linking.email, linkPassword, quiz)',
      'await completeLinkingWithProvider(existing, quiz)',
      "Platform.OS === 'ios'",
      "Platform.OS !== 'web'",
      "socialBusy === 'apple'",
      "socialBusy === 'google'",
      'err instanceof SocialAuthCancelledError',
      'err instanceof AccountLinkingRequiredError',
    ]) expect(screen).toContain(token);

    expect(socialService).toContain('const acquireCredential: Record<SocialProvider');
    expect(socialService).toContain("google: getGoogleCredential");
    expect(socialService).toContain("apple: getAppleCredential");
    expect(socialService).toContain('signInWithCredential(auth, result.credential)');
    expect(socialService).toContain('linkWithCredential(user, pendingCredential)');
  });
});
