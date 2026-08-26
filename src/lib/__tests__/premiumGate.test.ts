import { describe, expect, it } from 'vitest';
import { resolvePremiumGate, explainPremiumGateBlockers, type RootScreenId } from '../premiumGate';

type GateOverrides = Partial<Parameters<typeof resolvePremiumGate>[0]>;

function resolve(overrides: GateOverrides = {}) {
  return resolvePremiumGate({
    requestedScreen: 'auth' as RootScreenId,
    authInitializing: false,
    profileLoading: false,
    authenticated: true,
    emailVerificationRequired: false,
    preferencesReconciling: false,
    questionnaireResolution: 'found',
    subscriptionLoading: false,
    subscriptionConfigured: true,
    isPremium: false,
    // Established by default — every pre-existing test in this file models
    // an account that already resolved (or predates) the initial
    // commercial gate. Tests for the brand-new/pending case set this to
    // `false` explicitly (see the "conta nova" describe block below).
    commercialGateResolved: true,
    // Ready by default — every pre-existing test in this file is about the
    // auth/questionnaire/subscription/commercial-gate axes, not workout
    // readiness. See the dedicated `workoutReadinessGate` describe block
    // below for that axis's own coverage.
    workoutReadinessGate: 'ready',
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
        questionnaireResolution: 'not_found',
        subscriptionLoading: true,
        subscriptionConfigured: false,
      }),
    ).toBe('onboardingFunnel');
  });

  it('prioriza a verificação obrigatória de e-mail antes do questionário e da assinatura', () => {
    expect(
      resolve({
        emailVerificationRequired: true,
        questionnaireResolution: 'not_found',
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
        questionnaireResolution: 'not_found',
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
    expect(resolve({ preferencesReconciling: false, questionnaireResolution: 'not_found' })).toBe(
      'onboardingFunnel',
    );
    expect(resolve({ preferencesReconciling: false, isPremium: true })).toBe('app');
    expect(resolve({ preferencesReconciling: false, isPremium: false })).toBe('app');
  });

  it('L) para uma conta ESTABELECIDA, resolvePremiumGate nunca retorna "paywall" — Fase 1 permanece intacta para quem já resolveu o gate comercial', () => {
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

  describe('conta nova — commercialGateResolved: false', () => {
    it('M) questionário concluído, sem Premium, gate comercial pendente → paywall', () => {
      expect(resolve({ commercialGateResolved: false, isPremium: false })).toBe('paywall');
    });

    it('N) Premium ativo libera app mesmo antes do marker do servidor confirmar (CustomerInfo é mais rápido que o webhook)', () => {
      expect(resolve({ commercialGateResolved: false, isPremium: true })).toBe('app');
    });

    it('O) sem questionário ainda, independente do gate comercial → onboardingFunnel (questionário sempre precede o paywall)', () => {
      expect(
        resolve({ commercialGateResolved: false, questionnaireResolution: 'not_found', isPremium: false }),
      ).toBe('onboardingFunnel');
    });

    it('P) subscription ainda não resolvida → não decide, mesmo com o gate comercial pendente', () => {
      expect(
        resolve({ commercialGateResolved: false, subscriptionLoading: true, isPremium: false }),
      ).toBeNull();
      expect(
        resolve({
          commercialGateResolved: false,
          subscriptionConfigured: false,
          isPremium: false,
        }),
      ).toBeNull();
    });

    it('Q) Apple/Google não alteram a regra — o gate só olha commercialGateResolved/isPremium, nunca o provider', () => {
      // O provider nunca entra no shape de PremiumGateState — este teste
      // documenta que não há, e nunca deve haver, um campo `provider` aqui.
      expect(resolve({ commercialGateResolved: false, isPremium: false })).toBe('paywall');
      expect(resolve({ commercialGateResolved: true, isPremium: false })).toBe('app');
    });
  });

  describe('questionnaireResolution — state machine invariants (cold-start intermittency fix)', () => {
    it('1) found + demais gates ok → app', () => {
      expect(resolve({ questionnaireResolution: 'found', isPremium: true })).toBe('app');
    });

    it('2) not_found → onboardingFunnel', () => {
      expect(resolve({ questionnaireResolution: 'not_found' })).toBe('onboardingFunnel');
    });

    it('3) loading (query pending) → unresolved, nunca onboarding', () => {
      expect(resolve({ questionnaireResolution: 'loading' })).toBeNull();
    });

    it('3b) unknown (ainda não iniciado) → unresolved, nunca onboarding', () => {
      expect(resolve({ questionnaireResolution: 'unknown' })).toBeNull();
    });

    it('4) error (permission-denied, unavailable, ou qualquer falha de leitura) → unresolved, NUNCA onboarding', () => {
      expect(resolve({ questionnaireResolution: 'error' })).toBeNull();
      expect(resolve({ questionnaireResolution: 'error', isPremium: true })).toBeNull();
      expect(resolve({ questionnaireResolution: 'error', isPremium: false })).toBeNull();
    });

    it('12) commercialGateResolved não interfere na existência do questionário — not_found continua onboarding independente dele', () => {
      expect(
        resolve({ questionnaireResolution: 'not_found', commercialGateResolved: false }),
      ).toBe('onboardingFunnel');
      expect(
        resolve({ questionnaireResolution: 'not_found', commercialGateResolved: true }),
      ).toBe('onboardingFunnel');
    });

    it('13) subscriptionLoading não transforma questionnaire error em onboarding', () => {
      expect(
        resolve({ questionnaireResolution: 'error', subscriptionLoading: true }),
      ).toBeNull();
      expect(
        resolve({ questionnaireResolution: 'error', subscriptionLoading: false }),
      ).toBeNull();
    });

    it('14) found + Premium ativo → app', () => {
      expect(resolve({ questionnaireResolution: 'found', isPremium: true })).toBe('app');
    });

    it('15) found + commercialGate pendente + sem Premium → paywall', () => {
      expect(
        resolve({
          questionnaireResolution: 'found',
          commercialGateResolved: false,
          isPremium: false,
        }),
      ).toBe('paywall');
    });

    it('16) not_found + Premium ativo → onboarding MESMO ASSIM — Premium nunca faz bypass do questionário obrigatório', () => {
      expect(
        resolve({ questionnaireResolution: 'not_found', isPremium: true }),
      ).toBe('onboardingFunnel');
      expect(
        resolve({
          questionnaireResolution: 'not_found',
          isPremium: true,
          commercialGateResolved: false,
        }),
      ).toBe('onboardingFunnel');
    });
  });

  describe('workoutReadinessGate — first-app-entry readiness (audit: onboarding→Home lifecycle)', () => {
    it('F) AppShell is never reached while the gate is still "checking", even with every other prerequisite resolved and Premium active', () => {
      expect(resolve({ isPremium: true, workoutReadinessGate: 'checking' })).toBeNull();
      expect(resolve({ isPremium: false, workoutReadinessGate: 'checking' })).toBeNull();
    });

    it('idle behaves exactly like checking — never a route on its own', () => {
      expect(resolve({ isPremium: true, workoutReadinessGate: 'idle' })).toBeNull();
    });

    it('G) once the gate flips to "ready", AppShell opens immediately — same render, no extra wait', () => {
      expect(resolve({ isPremium: true, workoutReadinessGate: 'ready' })).toBe('app');
    });

    it('is the LAST prerequisite checked — never overrides questionnaire/subscription/commercial-gate priority', () => {
      expect(
        resolve({ questionnaireResolution: 'not_found', workoutReadinessGate: 'checking' }),
      ).toBe('onboardingFunnel');
      expect(
        resolve({ subscriptionLoading: true, workoutReadinessGate: 'checking' }),
      ).toBeNull();
      expect(
        resolve({ commercialGateResolved: false, isPremium: false, workoutReadinessGate: 'checking' }),
      ).toBe('paywall');
    });

    it('never blocks an unauthenticated user — routes straight to auth regardless of readiness', () => {
      expect(
        resolve({ requestedScreen: 'app', authenticated: false, workoutReadinessGate: 'checking' }),
      ).toBe('auth');
    });
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

describe('explainPremiumGateBlockers — diagnostic-only, never drives routing', () => {
  function explain(overrides: GateOverrides = {}) {
    return explainPremiumGateBlockers({
      requestedScreen: 'auth' as RootScreenId,
      authInitializing: false,
      profileLoading: false,
      authenticated: true,
      emailVerificationRequired: false,
      preferencesReconciling: false,
      questionnaireResolution: 'found',
      subscriptionLoading: false,
      subscriptionConfigured: true,
      isPremium: false,
      commercialGateResolved: true,
      workoutReadinessGate: 'ready',
      ...overrides,
    });
  }

  it('is empty exactly when resolvePremiumGate resolves to a real screen', () => {
    expect(explain({ isPremium: true })).toEqual([]);
    expect(resolve({ isPremium: true })).toBe('app');
  });

  it('names preferences-reconciling — the exact confirmed root cause of the reported double-loading bug', () => {
    expect(explain({ preferencesReconciling: true })).toEqual(['preferences-reconciling']);
    expect(resolve({ preferencesReconciling: true })).toBeNull();
  });

  it('reports every unresolved prerequisite together, in resolvePremiumGate priority order', () => {
    expect(
      explain({
        preferencesReconciling: true,
        questionnaireResolution: 'loading',
        subscriptionLoading: true,
        subscriptionConfigured: false,
      }),
    ).toEqual([
      'preferences-reconciling',
      'questionnaire-loading',
      'subscription-loading',
      'subscription-not-configured',
    ]);
  });

  it('stops at authInitializing/profileLoading — no downstream reasons listed while identity itself is unresolved', () => {
    expect(explain({ authInitializing: true, profileLoading: true })).toEqual([
      'auth-initializing',
      'profile-loading',
    ]);
  });

  it('is empty for an unauthenticated user (nothing left to block once routed to auth)', () => {
    expect(explain({ authenticated: false })).toEqual([]);
  });

  it('names workout-readiness-checking/idle so a stuck first-app-entry gate is diagnosable', () => {
    expect(explain({ workoutReadinessGate: 'checking' })).toEqual(['workout-readiness-checking']);
    expect(explain({ workoutReadinessGate: 'idle' })).toEqual(['workout-readiness-idle']);
    expect(explain({ workoutReadinessGate: 'ready' })).toEqual([]);
  });
});
