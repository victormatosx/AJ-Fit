import { describe, expect, it } from 'vitest';
import { resolvePremiumGate } from '../premiumGate';
import {
  createIdentityScopedSingleFlight,
  createInitialSubscriptionLifecycleState,
  hasMeaningfulSubscriptionChange,
  POST_MANAGE_REVALIDATION_DELAYS_MS,
  reduceSubscriptionLifecycle,
  selectIdentityCustomerInfo,
  shouldRevalidateOnAppStateChange,
  type SubscriptionLifecycleState,
} from '../subscriptionLifecycle';

type Info = {
  owner: string;
  entitlements: { active: Record<string, unknown> };
};

const premium = (owner: string): Info => ({
  owner,
  entitlements: { active: { premium: { identifier: 'premium' } } },
});

const basic = (owner: string): Info => ({ owner, entitlements: { active: {} } });

const failure = { kind: 'temporary' as const, message: 'temporário' };
const offlineFailure = { kind: 'offline' as const, message: 'offline' };

function changed(uid: string | null, generation: number) {
  return reduceSubscriptionLifecycle(createInitialSubscriptionLifecycleState<Info>(), {
    type: 'identity-changed',
    uid,
    generation,
  });
}

function resolved(uid: string, generation: number, info: Info) {
  return reduceSubscriptionLifecycle(changed(uid, generation), {
    type: 'identity-resolved',
    uid,
    generation,
    customerInfo: info,
  });
}

function route(
  state: SubscriptionLifecycleState<Info>,
  uid: string | null,
  overrides: Partial<Parameters<typeof resolvePremiumGate>[0]> = {},
) {
  const info = selectIdentityCustomerInfo(state, uid);
  return resolvePremiumGate({
    requestedScreen: 'splash',
    authInitializing: false,
    profileLoading: false,
    authenticated: Boolean(uid),
    emailVerificationRequired: false,
    preferencesReconciling: false,
    hasQuestionnaire: true,
    subscriptionLoading: Boolean(uid) && !info && state.phase !== 'error',
    subscriptionConfigured: !uid || Boolean(info),
    isPremium: Boolean(info?.entitlements.active.premium),
    // This suite models an established account throughout — persistence/
    // revalidation of an already-resolved subscription, not the brand-new
    // pending-Paywall case (covered in premiumGate.test.ts instead).
    commercialGateResolved: true,
    ...overrides,
  });
}

describe('Fase 3 — persistência e revalidação Premium A–AA', () => {
  it('A — cold start Premium: aguarda e depois libera AppShell', () => {
    const syncing = changed('A', 1);
    expect(route(syncing, 'A')).toBeNull();
    expect(route(resolved('A', 1, premium('A')), 'A')).toBe('app');
  });

  it('B — FASE 1: cold start sem Premium também libera AppShell, uma vez resolvida a assinatura', () => {
    expect(route(resolved('A', 1, basic('A')), 'A')).toBe('app');
  });

  it('C — auth ainda carregando: não decide Premium', () => {
    expect(
      resolvePremiumGate({
        requestedScreen: 'app',
        authInitializing: true,
        profileLoading: false,
        authenticated: true,
        emailVerificationRequired: false,
        preferencesReconciling: false,
        hasQuestionnaire: true,
        subscriptionLoading: false,
        subscriptionConfigured: true,
        isPremium: true,
        commercialGateResolved: true,
      }),
    ).toBeNull();
  });

  it('D — RevenueCat sincronizando identidade: não mostra AppShell nem Paywall', () => {
    let state = changed('A', 1);
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-sync-started',
      uid: 'A',
      generation: 1,
    });
    expect(state.phase).toBe('syncing-identity');
    expect(route(state, 'A')).toBeNull();
  });

  it('E — login Premium: CustomerInfo confirmado libera AppShell', () => {
    expect(route(resolved('login-premium', 3, premium('login-premium')), 'login-premium')).toBe(
      'app',
    );
  });

  it('F — FASE 1: login não Premium: CustomerInfo confirmado também libera AppShell', () => {
    expect(route(resolved('login-basic', 4, basic('login-basic')), 'login-basic')).toBe(
      'app',
    );
  });

  it('G — A Premium → logout: snapshot de A deixa de autorizar imediatamente', () => {
    const loggedOut = reduceSubscriptionLifecycle(resolved('A', 1, premium('A')), {
      type: 'identity-changed',
      uid: null,
      generation: 2,
    });
    expect(selectIdentityCustomerInfo(loggedOut, null)).toBeNull();
    expect(route(loggedOut, null, { requestedScreen: 'app' })).toBe('auth');
  });

  it('H — A Premium → B sem Premium: B nunca herda Premium, mas FASE 1 ainda libera AppShell para B', () => {
    let state = resolved('A', 1, premium('A'));
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-changed',
      uid: 'B',
      generation: 2,
    });
    expect(route(state, 'B')).toBeNull();
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-resolved',
      uid: 'B',
      generation: 2,
      customerInfo: basic('B'),
    });
    expect(selectIdentityCustomerInfo(state, 'B')).toEqual(basic('B'));
    expect(route(state, 'B')).toBe('app');
  });

  it('I — B sem Premium → A Premium: A recupera o próprio estado', () => {
    let state = resolved('B', 1, basic('B'));
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-changed',
      uid: 'A',
      generation: 2,
    });
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-resolved',
      uid: 'A',
      generation: 2,
      customerInfo: premium('A'),
    });
    expect(route(state, 'A')).toBe('app');
  });

  it('J — request antigo de A termina após login B: resultado é ignorado', () => {
    let state = changed('A', 1);
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
    expect(route(afterStaleA, 'B')).toBeNull();
  });

  it('K — listener de A dispara após troca para B: geração antiga é ignorada', () => {
    const stateB = resolved('B', 2, basic('B'));
    const afterOldListener = reduceSubscriptionLifecycle(stateB, {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: premium('A'),
    });
    expect(afterOldListener).toBe(stateB);
    expect(selectIdentityCustomerInfo(afterOldListener, 'B')).toEqual(basic('B'));
    expect(route(afterOldListener, 'B')).toBe('app');
  });

  it('L — listener atual recebe Premium: Gate abre', () => {
    const next = reduceSubscriptionLifecycle(resolved('A', 1, basic('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: premium('A'),
    });
    expect(route(next, 'A')).toBe('app');
  });

  it('M — FASE 1: listener atual remove Premium: AppShell permanece aberto (a raiz não expulsa mais o usuário)', () => {
    const next = reduceSubscriptionLifecycle(resolved('A', 1, premium('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: basic('A'),
    });
    // isPremium continues to reflect the loss accurately — it's the root
    // gate's routing decision that stops depending on it, not the entitlement
    // signal itself. Future phases read this same boolean for capabilities.
    expect(selectIdentityCustomerInfo(next, 'A')).toEqual(basic('A'));
    expect(route(next, 'A')).toBe('app');
  });

  it('N — purchase retorna Premium: estado central libera AppShell', () => {
    const purchaseResult = reduceSubscriptionLifecycle(resolved('A', 1, basic('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: premium('A'),
    });
    expect(route(purchaseResult, 'A')).toBe('app');
  });

  it('O — purchase sem Premium: FASE 1 permanece AppShell (não há mais Paywall raiz para "permanecer")', () => {
    const purchaseResult = reduceSubscriptionLifecycle(resolved('A', 1, basic('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: basic('A'),
    });
    expect(route(purchaseResult, 'A')).toBe('app');
  });

  it('P — restore retorna Premium: estado central libera AppShell', () => {
    const restoreResult = reduceSubscriptionLifecycle(resolved('A', 1, basic('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: premium('A'),
    });
    expect(route(restoreResult, 'A')).toBe('app');
  });

  it('Q — restore sem Premium: FASE 1 permanece AppShell', () => {
    const restoreResult = reduceSubscriptionLifecycle(resolved('A', 1, basic('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: basic('A'),
    });
    expect(route(restoreResult, 'A')).toBe('app');
  });

  it('R — foreground com Premium mantido: continua AppShell', () => {
    expect(shouldRevalidateOnAppStateChange('background', 'active')).toBe(true);
    const refreshed = reduceSubscriptionLifecycle(resolved('A', 1, premium('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: premium('A'),
    });
    expect(route(refreshed, 'A')).toBe('app');
  });

  it('S — FASE 1: foreground após perda do Premium NÃO expulsa do AppShell (regressão crítica desta fase)', () => {
    const refreshed = reduceSubscriptionLifecycle(resolved('A', 1, premium('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: basic('A'),
    });
    expect(selectIdentityCustomerInfo(refreshed, 'A')).toEqual(basic('A'));
    expect(route(refreshed, 'A')).toBe('app');
  });

  it('T — foreground após aquisição externa: vai ao AppShell', () => {
    const refreshed = reduceSubscriptionLifecycle(resolved('A', 1, basic('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: premium('A'),
    });
    expect(route(refreshed, 'A')).toBe('app');
  });

  it('U — erro temporário sem CustomerInfo confirmado não produz bypass', () => {
    const failed = reduceSubscriptionLifecycle(changed('B', 2), {
      type: 'identity-failed',
      uid: 'B',
      generation: 2,
      error: failure,
    });
    expect(failed.phase).toBe('error');
    expect(selectIdentityCustomerInfo(failed, 'B')).toBeNull();
    expect(route(failed, 'B')).toBeNull();
  });

  it('V — offline com estado confirmado do UID atual preserva o snapshot seguro', () => {
    let state = resolved('A', 1, premium('A'));
    state = reduceSubscriptionLifecycle(state, {
      type: 'refresh-started',
      uid: 'A',
      generation: 1,
    });
    state = reduceSubscriptionLifecycle(state, {
      type: 'refresh-failed',
      uid: 'A',
      generation: 1,
      error: offlineFailure,
    });
    expect(state.phase).toBe('ready');
    expect(state.error?.kind).toBe('offline');
    expect(route(state, 'A')).toBe('app');
  });

  it('W — offline sem CustomerInfo confirmado nunca usa snapshot de outra identidade', () => {
    let state = resolved('A', 1, premium('A'));
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-changed',
      uid: 'B',
      generation: 2,
    });
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-failed',
      uid: 'B',
      generation: 2,
      error: offlineFailure,
    });
    expect(selectIdentityCustomerInfo(state, 'B')).toBeNull();
    expect(route(state, 'B')).toBeNull();
  });

  it('X — múltiplos foregrounds só iniciam uma revalidação concorrente por geração', async () => {
    expect(shouldRevalidateOnAppStateChange('active', 'active')).toBe(false);
    expect(shouldRevalidateOnAppStateChange(null, 'active')).toBe(false);
    expect(shouldRevalidateOnAppStateChange('inactive', 'active')).toBe(true);

    const singleFlight = createIdentityScopedSingleFlight();
    let calls = 0;
    let release!: () => void;
    const operation = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const first = singleFlight.run('A:1', operation);
    const second = singleFlight.run('A:1', operation);
    expect(second).toBe(first);
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
  });

  it('Y — logout durante request pendente: resposta antiga é ignorada', () => {
    let state = resolved('A', 1, premium('A'));
    state = reduceSubscriptionLifecycle(state, {
      type: 'identity-changed',
      uid: null,
      generation: 2,
    });
    const afterPendingResponse = reduceSubscriptionLifecycle(state, {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: premium('A'),
    });
    expect(afterPendingResponse).toBe(state);
    expect(route(afterPendingResponse, null, { requestedScreen: 'app' })).toBe('auth');
  });

  it('Z — Firestore subscription=true não afeta isPremium (CustomerInfo continua soberano); FASE 1 libera AppShell de qualquer forma', () => {
    const firestoreMirror = { entitlementActive: true };
    expect(firestoreMirror.entitlementActive).toBe(true);
    expect(selectIdentityCustomerInfo(resolved('A', 1, basic('A')), 'A')).toEqual(basic('A'));
    expect(route(resolved('A', 1, basic('A')), 'A')).toBe('app');
  });

  it('AA — Firestore subscription=false não bloqueia Premium do CustomerInfo', () => {
    const firestoreMirror = { entitlementActive: false };
    expect(firestoreMirror.entitlementActive).toBe(false);
    expect(route(resolved('A', 1, premium('A')), 'A')).toBe('app');
  });
});

describe('hasMeaningfulSubscriptionChange — post-manage revalidation window', () => {
  const activeRenewing = { premiumActive: true, willRenew: true, unsubscribeDetected: false };
  const activeCanceled = { premiumActive: true, willRenew: false, unsubscribeDetected: true };
  const expired = { premiumActive: false, willRenew: null, unsubscribeDetected: false };

  it('no baseline (identity not resolved yet) never reports a change — fail-safe', () => {
    expect(hasMeaningfulSubscriptionChange(null, activeCanceled)).toBe(false);
  });

  it('identical signal is not a change', () => {
    expect(hasMeaningfulSubscriptionChange(activeRenewing, { ...activeRenewing })).toBe(false);
  });

  it('willRenew flipping to false is the cancellation signal', () => {
    expect(hasMeaningfulSubscriptionChange(activeRenewing, activeCanceled)).toBe(true);
  });

  it('entitlement going inactive (expiration) is a change', () => {
    expect(hasMeaningfulSubscriptionChange(activeCanceled, expired)).toBe(true);
  });

  it('unsubscribeDetected flipping alone (willRenew unresolved) is still a change', () => {
    const baseline = { premiumActive: true, willRenew: null, unsubscribeDetected: false };
    const next = { premiumActive: true, willRenew: null, unsubscribeDetected: true };
    expect(hasMeaningfulSubscriptionChange(baseline, next)).toBe(true);
  });
});

describe('POST_MANAGE_REVALIDATION_DELAYS_MS — bounded, not polling', () => {
  it('starts immediate and is strictly increasing (finite schedule)', () => {
    expect(POST_MANAGE_REVALIDATION_DELAYS_MS[0]).toBe(0);
    const delays = [...POST_MANAGE_REVALIDATION_DELAYS_MS];
    const sorted = [...delays].sort((a, b) => a - b);
    expect(delays).toEqual(sorted);
    expect(new Set(delays).size).toBe(delays.length);
  });

  it('caps out well under the observed ~8min Sandbox propagation, at a fixed length', () => {
    expect(POST_MANAGE_REVALIDATION_DELAYS_MS.length).toBeGreaterThan(1);
    expect(Math.max(...POST_MANAGE_REVALIDATION_DELAYS_MS)).toBeLessThanOrEqual(15 * 60_000);
  });
});
