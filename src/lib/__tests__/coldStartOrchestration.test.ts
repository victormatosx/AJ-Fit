import { describe, expect, it } from 'vitest';
import { resolvePremiumGate } from '../premiumGate';
import { resolveOfferingViewState } from '../subscriptionOffer';
import {
  createInitialSubscriptionLifecycleState,
  reduceSubscriptionLifecycle,
  selectIdentityCustomerInfo,
} from '../subscriptionLifecycle';

type Info = {
  owner: string;
  entitlements: { active: Record<string, unknown> };
};

const premium = (owner: string): Info => ({
  owner,
  entitlements: { active: { premium: { identifier: 'premium' } } },
});

const basic = (owner: string): Info => ({
  owner,
  entitlements: { active: {} },
});

function gate({
  authInitializing = false,
  profileLoading = false,
  info = null,
  subscriptionLoading = false,
  subscriptionConfigured = Boolean(info),
}: {
  authInitializing?: boolean;
  profileLoading?: boolean;
  info?: Info | null;
  subscriptionLoading?: boolean;
  subscriptionConfigured?: boolean;
}) {
  return resolvePremiumGate({
    requestedScreen: 'splash',
    authInitializing,
    profileLoading,
    authenticated: true,
    preferencesReconciling: false,
    hasQuestionnaire: true,
    subscriptionLoading,
    subscriptionConfigured,
    isPremium: Boolean(info?.entitlements.active.premium),
  });
}

function slowOfferings() {
  return resolveOfferingViewState({
    offerings: null,
    loading: true,
    error: null,
    offline: false,
    unavailable: false,
  });
}

describe('auditoria pós-Fase 3 — orchestration/loading A–G', () => {
  it('A — Premium cold start: não mostra Paywall antes de CustomerInfo', () => {
    expect(
      gate({ subscriptionLoading: true, subscriptionConfigured: false }),
    ).toBeNull();
    expect(gate({ info: premium('A') })).toBe('app');
  });

  it('B — não Premium cold start: não decide antes de CustomerInfo', () => {
    expect(
      gate({ subscriptionLoading: true, subscriptionConfigured: false }),
    ).toBeNull();
    expect(gate({ info: basic('A') })).toBe('paywall');
  });

  it('C — Offerings lento não bloqueia Premium já confirmado', () => {
    expect(slowOfferings()).toBe('loading');
    expect(gate({ info: premium('A') })).toBe('app');
  });

  it('D — não Premium chega ao Paywall enquanto ele carrega Offerings', () => {
    expect(gate({ info: basic('A') })).toBe('paywall');
    expect(slowOfferings()).toBe('loading');
  });

  it('E — CustomerInfo lento não libera AppShell nem presume não Premium', () => {
    expect(
      gate({ subscriptionLoading: true, subscriptionConfigured: false }),
    ).toBeNull();
  });

  it('F — Firebase Auth lento impede qualquer decisão do Gate', () => {
    expect(
      gate({
        authInitializing: true,
        info: premium('A'),
        subscriptionConfigured: true,
      }),
    ).toBeNull();
  });

  it('G — troca de UID durante startup descarta o resultado antigo', () => {
    let state = createInitialSubscriptionLifecycleState<Info>();
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-changed',
      uid: 'A',
      generation: 1,
    });
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-changed',
      uid: 'B',
      generation: 2,
    });

    const afterStaleA = reduceSubscriptionLifecycle(state, {
      type: 'identity-resolved',
      uid: 'A',
      generation: 1,
      customerInfo: premium('A'),
    });

    expect(afterStaleA).toBe(state);
    expect(selectIdentityCustomerInfo(afterStaleA, 'B')).toBeNull();
  });
});
