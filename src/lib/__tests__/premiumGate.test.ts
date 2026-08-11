import { describe, expect, it } from 'vitest';
import { resolvePremiumGate, type RootScreenId } from '../premiumGate';

type GateOverrides = Partial<Parameters<typeof resolvePremiumGate>[0]>;

function resolve(overrides: GateOverrides = {}) {
  return resolvePremiumGate({
    requestedScreen: 'auth' as RootScreenId,
    authInitializing: false,
    profileLoading: false,
    authenticated: true,
    hasQuestionnaire: true,
    subscriptionLoading: false,
    subscriptionConfigured: true,
    isPremium: false,
    ...overrides,
  });
}

describe('resolvePremiumGate', () => {
  it('A) libera AppShell para usuário autenticado, com questionário e Premium ativo', () => {
    expect(resolve({ isPremium: true })).toBe('app');
  });

  it('B) envia ao paywall usuário autenticado, com questionário e sem Premium', () => {
    expect(resolve()).toBe('paywall');
  });

  it('C) não decide acesso enquanto CustomerInfo ainda está carregando', () => {
    expect(resolve({ subscriptionLoading: true, isPremium: true })).toBeNull();
    expect(resolve({ subscriptionConfigured: false })).toBeNull();
  });

  it('D) prioriza o questionário antes do estado da assinatura', () => {
    expect(
      resolve({
        hasQuestionnaire: false,
        subscriptionLoading: true,
        subscriptionConfigured: false,
      }),
    ).toBe('quiz');
  });

  it('E) remove o acesso ao AppShell após logout', () => {
    expect(
      resolve({
        requestedScreen: 'app',
        authenticated: false,
        hasQuestionnaire: false,
        isPremium: true,
      }),
    ).toBe('auth');
  });

  it('F) não reutiliza Premium enquanto a assinatura de outro usuário não foi resolvida', () => {
    expect(
      resolve({
        requestedScreen: 'app',
        subscriptionLoading: true,
        subscriptionConfigured: false,
        isPremium: true,
      }),
    ).toBeNull();
    expect(resolve({ requestedScreen: 'app', isPremium: false })).toBe('paywall');
  });

  it('G) cold start Premium aguarda CustomerInfo e depois libera AppShell sem paywall', () => {
    expect(resolve({ subscriptionLoading: true, subscriptionConfigured: false })).toBeNull();
    expect(resolve({ requestedScreen: 'splash', isPremium: true })).toBe('app');
  });

  it('H) cold start sem Premium aguarda CustomerInfo e depois mostra paywall', () => {
    expect(resolve({ subscriptionLoading: true, subscriptionConfigured: false })).toBeNull();
    expect(resolve({ requestedScreen: 'splash' })).toBe('paywall');
  });

  it('bloqueia qualquer pedido direto de AppShell quando o entitlement está inativo', () => {
    expect(resolve({ requestedScreen: 'app' })).toBe('paywall');
  });
});
