import { describe, expect, it } from 'vitest';
import { resolvePremiumGate } from '../premiumGate';
import {
  createIdentityScopedSingleFlight,
  createInitialSubscriptionLifecycleState,
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
    preferencesReconciling: false,
    hasQuestionnaire: true,
    subscriptionLoading: Boolean(uid) && !info && state.phase !== 'error',
    subscriptionConfigured: !uid || Boolean(info),
    isPremium: Boolean(info?.entitlements.active.premium),
    ...overrides,
  });
}

describe('Fase 3 — persistência e revalidação Premium A–AA', () => {
  it('A — cold start Premium: aguarda e depois libera AppShell', () => {
    const syncing = changed('A', 1);
    expect(route(syncing, 'A')).toBeNull();
    expect(route(resolved('A', 1, premium('A')), 'A')).toBe('app');
  });

  it('B — cold start sem Premium: resolve Paywall', () => {
    expect(route(resolved('A', 1, basic('A')), 'A')).toBe('paywall');
  });

  it('C — auth ainda carregando: não decide Premium', () => {
    expect(
      resolvePremiumGate({
        requestedScreen: 'app',
        authInitializing: true,
        profileLoading: false,
        authenticated: true,
        preferencesReconciling: false,
        hasQuestionnaire: true,
        subscriptionLoading: false,
        subscriptionConfigured: true,
        isPremium: true,
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

  it('F — login não Premium: CustomerInfo confirmado mostra Paywall', () => {
    expect(route(resolved('login-basic', 4, basic('login-basic')), 'login-basic')).toBe(
      'paywall',
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

  it('H — A Premium → B sem Premium: B nunca herda Premium', () => {
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
    expect(route(state, 'B')).toBe('paywall');
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
    expect(route(afterOldListener, 'B')).toBe('paywall');
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

  it('M — listener atual remove Premium: Gate fecha AppShell', () => {
    const next = reduceSubscriptionLifecycle(resolved('A', 1, premium('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: basic('A'),
    });
    expect(route(next, 'A')).toBe('paywall');
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

  it('O — purchase sem Premium: permanece Paywall', () => {
    const purchaseResult = reduceSubscriptionLifecycle(resolved('A', 1, basic('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: basic('A'),
    });
    expect(route(purchaseResult, 'A')).toBe('paywall');
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

  it('Q — restore sem Premium: permanece Paywall', () => {
    const restoreResult = reduceSubscriptionLifecycle(resolved('A', 1, basic('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: basic('A'),
    });
    expect(route(restoreResult, 'A')).toBe('paywall');
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

  it('S — foreground após perda do Premium: vai ao Paywall', () => {
    const refreshed = reduceSubscriptionLifecycle(resolved('A', 1, premium('A')), {
      type: 'customer-info-updated',
      uid: 'A',
      generation: 1,
      customerInfo: basic('A'),
    });
    expect(route(refreshed, 'A')).toBe('paywall');
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

  it('Z — Firestore subscription=true não libera sem Premium no CustomerInfo', () => {
    const firestoreMirror = { entitlementActive: true };
    expect(firestoreMirror.entitlementActive).toBe(true);
    expect(route(resolved('A', 1, basic('A')), 'A')).toBe('paywall');
  });

  it('AA — Firestore subscription=false não bloqueia Premium do CustomerInfo', () => {
    const firestoreMirror = { entitlementActive: false };
    expect(firestoreMirror.entitlementActive).toBe(false);
    expect(route(resolved('A', 1, premium('A')), 'A')).toBe('app');
  });
});
