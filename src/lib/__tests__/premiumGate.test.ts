import { describe, expect, it } from 'vitest';
import { resolvePremiumGate, type RootScreenId } from '../premiumGate';

type GateOverrides = Partial<Parameters<typeof resolvePremiumGate>[0]>;

function resolve(overrides: GateOverrides = {}) {
  return resolvePremiumGate({
    requestedScreen: 'auth' as RootScreenId,
    authInitializing: false,
    profileLoading: false,
    authenticated: true,
    emailVerificationRequired: false,
    preferencesReconciling: false,
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

  it('prioriza a verificação obrigatória de e-mail antes do questionário e da assinatura', () => {
    expect(
      resolve({
        emailVerificationRequired: true,
        hasQuestionnaire: false,
        subscriptionLoading: true,
        subscriptionConfigured: false,
      }),
    ).toBe('emailVerification');
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

  it('mantém EXPIRED/inativo no Paywall independentemente do histórico da assinatura', () => {
    const expiredMirror = {
      status: 'EXPIRED',
      entitlementActive: false,
      currentPeriodEndsAt: new Date('2026-08-12T12:00:00Z'),
    };

    expect(resolve({ ...expiredMirror, isPremium: false } as GateOverrides)).toBe('paywall');
  });

  it('não usa canceledAt para antecipar a perda de acesso; o entitlement continua soberano', () => {
    const canceledWithinActivePeriod = {
      status: 'CANCELED',
      canceledAt: new Date('2026-08-13T12:00:00Z'),
      currentPeriodEndsAt: new Date('2026-08-20T12:00:00Z'),
    };

    expect(resolve({ ...canceledWithinActivePeriod, isPremium: true } as GateOverrides)).toBe(
      'app',
    );
    expect(resolve({ ...canceledWithinActivePeriod, isPremium: false } as GateOverrides)).toBe(
      'paywall',
    );
  });

  it('I) preferencesReconciling segura o gate mesmo com Premium já ativo — nunca expõe AppShell antes da reconciliação terminar', () => {
    expect(resolve({ preferencesReconciling: true, isPremium: true })).toBeNull();
    expect(resolve({ preferencesReconciling: true })).toBeNull();
  });

  it('J) preferencesReconciling não afeta usuário não autenticado — segue direto para auth', () => {
    expect(
      resolve({ requestedScreen: 'app', authenticated: false, preferencesReconciling: true }),
    ).toBe('auth');
  });

  it('K) uma vez reconciliado, o fluxo normal (questionário → assinatura) continua exatamente igual', () => {
    expect(resolve({ preferencesReconciling: false, hasQuestionnaire: false })).toBe('quiz');
    expect(resolve({ preferencesReconciling: false, isPremium: true })).toBe('app');
  });

  it.each([
    ['cupom válido', { couponCode: 'ARNALDO' }],
    ['iosPromotion', { iosPromotion: { offeringIdentifier: 'promo_7d' } }],
    ['purchase_pending', { purchaseIntent: { status: 'purchase_pending' } }],
    ['lockedAt', { lockedAt: new Date() }],
    ['trialStartedAt', { trialStartedAt: new Date() }],
    ['attribution matched', { attribution: 'matched' }],
    ['attribution no-match', { attribution: 'no_intent' }],
  ])('FASE 10: %s não entra na autoridade do Premium Gate', (_label, marketingEvidence) => {
    expect(resolve({ ...marketingEvidence, isPremium: false } as GateOverrides)).toBe('paywall');
    expect(resolve({ ...marketingEvidence, isPremium: true } as GateOverrides)).toBe('app');
  });
});
