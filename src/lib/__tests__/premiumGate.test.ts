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
  it('A) libera AppShell para usuário autenticado, com questionário, assinatura resolvida e Premium ativo', () => {
    expect(resolve({ isPremium: true })).toBe('app');
  });

  it('B) FASE 1: libera AppShell também para usuário autenticado, com questionário, assinatura resolvida e SEM Premium', () => {
    expect(resolve({ isPremium: false })).toBe('app');
  });

  it('C) não decide acesso enquanto CustomerInfo ainda está carregando, independentemente de isPremium', () => {
    expect(resolve({ subscriptionLoading: true, isPremium: true })).toBeNull();
    expect(resolve({ subscriptionLoading: true, isPremium: false })).toBeNull();
    expect(resolve({ subscriptionConfigured: false, isPremium: true })).toBeNull();
    expect(resolve({ subscriptionConfigured: false, isPremium: false })).toBeNull();
  });

  it('D) prioriza o questionário antes do estado da assinatura', () => {
    expect(
      resolve({
        hasQuestionnaire: false,
        subscriptionLoading: true,
        subscriptionConfigured: false,
      }),
    ).toBe('onboardingFunnel');
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

  it('E) remove o acesso ao AppShell após logout, mesmo que a última sessão fosse Premium', () => {
    expect(
      resolve({
        requestedScreen: 'app',
        authenticated: false,
        hasQuestionnaire: false,
        isPremium: true,
      }),
    ).toBe('auth');
  });

  it('F) não abre AppShell com a assinatura de outro usuário ainda não resolvida — mesmo que isPremium venha true do estado anterior', () => {
    expect(
      resolve({
        requestedScreen: 'app',
        subscriptionLoading: true,
        subscriptionConfigured: false,
        isPremium: true,
      }),
    ).toBeNull();
  });

  it('G) cold start Premium aguarda CustomerInfo e depois libera AppShell', () => {
    expect(resolve({ subscriptionLoading: true, subscriptionConfigured: false })).toBeNull();
    expect(resolve({ requestedScreen: 'splash', isPremium: true })).toBe('app');
  });

  it('H) cold start sem Premium aguarda CustomerInfo e, uma vez resolvida, também libera AppShell (FASE 1)', () => {
    expect(resolve({ subscriptionLoading: true, subscriptionConfigured: false })).toBeNull();
    expect(resolve({ requestedScreen: 'splash', isPremium: false })).toBe('app');
  });

  it('libera AppShell para pedido direto de "app" quando o entitlement está inativo, uma vez tudo resolvido (FASE 1)', () => {
    expect(resolve({ requestedScreen: 'app', isPremium: false })).toBe('app');
  });

  it('libera AppShell mesmo com histórico de assinatura EXPIRED — entitlement inativo deixou de bloquear a navegação raiz', () => {
    const expiredMirror = {
      status: 'EXPIRED',
      entitlementActive: false,
      currentPeriodEndsAt: new Date('2026-08-12T12:00:00Z'),
    };

    expect(resolve({ ...expiredMirror, isPremium: false } as GateOverrides)).toBe('app');
  });

  it('não usa canceledAt para antecipar nem para atrasar a decisão de navegação raiz — o gate raiz não lê mais isPremium', () => {
    const canceledWithinActivePeriod = {
      status: 'CANCELED',
      canceledAt: new Date('2026-08-13T12:00:00Z'),
      currentPeriodEndsAt: new Date('2026-08-20T12:00:00Z'),
    };

    expect(resolve({ ...canceledWithinActivePeriod, isPremium: true } as GateOverrides)).toBe(
      'app',
    );
    expect(resolve({ ...canceledWithinActivePeriod, isPremium: false } as GateOverrides)).toBe(
      'app',
    );
  });

  it('I) preferencesReconciling segura o gate independentemente de isPremium — nunca expõe AppShell antes da reconciliação terminar', () => {
    expect(resolve({ preferencesReconciling: true, isPremium: true })).toBeNull();
    expect(resolve({ preferencesReconciling: true, isPremium: false })).toBeNull();
  });

  it('J) preferencesReconciling não afeta usuário não autenticado — segue direto para auth', () => {
    expect(
      resolve({ requestedScreen: 'app', authenticated: false, preferencesReconciling: true }),
    ).toBe('auth');
  });

  it('K) uma vez reconciliado, o fluxo normal (questionário → assinatura → app) continua igual, com ou sem Premium', () => {
    expect(resolve({ preferencesReconciling: false, hasQuestionnaire: false })).toBe(
      'onboardingFunnel',
    );
    expect(resolve({ preferencesReconciling: false, isPremium: true })).toBe('app');
    expect(resolve({ preferencesReconciling: false, isPremium: false })).toBe('app');
  });

  it('L) resolvePremiumGate nunca mais retorna "paywall" — a rota deixou de ser uma decisão da navegação raiz', () => {
    const outcomes = new Set<RootScreenId | null>();
    for (const isPremium of [true, false]) {
      for (const subscriptionLoading of [true, false]) {
        for (const subscriptionConfigured of [true, false]) {
          outcomes.add(resolve({ isPremium, subscriptionLoading, subscriptionConfigured }));
        }
      }
    }
    expect(outcomes.has('paywall')).toBe(false);
  });

  it.each([
    ['cupom válido', { couponCode: 'ARNALDO' }],
    ['iosPromotion', { iosPromotion: { offeringIdentifier: 'promo_7d' } }],
    ['purchase_pending', { purchaseIntent: { status: 'purchase_pending' } }],
    ['lockedAt', { lockedAt: new Date() }],
    ['trialStartedAt', { trialStartedAt: new Date() }],
    ['attribution matched', { attribution: 'matched' }],
    ['attribution no-match', { attribution: 'no_intent' }],
  ])(
    'FASE 10/FASE 1: %s não entra na autoridade do Premium Gate — resultado é sempre "app" uma vez resolvido',
    (_label, marketingEvidence) => {
      expect(resolve({ ...marketingEvidence, isPremium: false } as GateOverrides)).toBe('app');
      expect(resolve({ ...marketingEvidence, isPremium: true } as GateOverrides)).toBe('app');
    },
  );
});
