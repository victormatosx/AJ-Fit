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
      'actions.startTrial',
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
  });

  it('preserves email/password and Google/Apple authentication behavior', () => {
    for (const token of [
      'await signUp(email, password, name, quiz)',
      'await signIn(email, password)',
      'await reset(email)',
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
