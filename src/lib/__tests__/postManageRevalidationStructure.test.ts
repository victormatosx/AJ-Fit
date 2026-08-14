import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const subscriptionContext = read('state/SubscriptionContext.tsx');
const subscriptionLifecycle = read('lib/subscriptionLifecycle.ts');
const revenueCatService = read('services/revenueCatService.ts');

/**
 * RevenueCat cancellation audit, follow-up: bounded post-manage revalidation
 * window. Behavioral coverage for the pure pieces
 * (`hasMeaningfulSubscriptionChange`, `POST_MANAGE_REVALIDATION_DELAYS_MS`,
 * `extractSubscriptionSignal`) lives in
 * subscriptionLifecycle.test.ts/revenueCatService.test.ts. This file covers
 * the React-context wiring the same way iosPromotionPhase6Structure.test.ts
 * does — there is no React Testing Library in this project, so timer/effect
 * lifecycle correctness for SubscriptionContext is verified structurally.
 */
describe('post-manage revalidation window — refresh fires after the manage sheet closes', () => {
  it('manageSubscription only starts the window when a real store surface was opened', () => {
    expect(subscriptionContext).toContain("if (outcome.status === 'opened') {");
    expect(subscriptionContext).toContain('startPostManageRevalidation(manageUid, generation, sheetClosedAt)');
  });

  it('brackets the sheet with opened/closed instrumentation, not inside the UI/screen', () => {
    expect(subscriptionContext).toContain("logSubscriptionEvent('subscription_manage_opened', manageUid)");
    expect(subscriptionContext).toContain("logSubscriptionEvent('subscription_manage_closed', manageUid)");
  });

  it('schedules every attempt from the shared bounded delay table (no ad-hoc timers)', () => {
    expect(subscriptionContext).toContain('POST_MANAGE_REVALIDATION_DELAYS_MS.forEach');
    expect(subscriptionContext).toContain('setTimeout(() => {');
  });
});

describe('post-manage revalidation window — a no-op close does not fabricate a state change', () => {
  it('only clears the remaining schedule when a meaningful change was actually found', () => {
    expect(subscriptionContext).toContain('if (changed) clearPostManageWindow();');
    // Guards against a version that clears unconditionally after every
    // attempt regardless of `changed`, which would silently cancel the
    // remaining bounded attempts even when nothing changed.
    expect(subscriptionContext).not.toMatch(/\n\s*clearPostManageWindow\(\);\n\s*},\n\s*\[clearPostManageWindow, doRefresh\]/);
  });

  it('compares against hasMeaningfulSubscriptionChange, never a raw CustomerInfo diff', () => {
    expect(subscriptionContext).toContain('hasMeaningfulSubscriptionChange(baseline, nextSignal)');
  });
});

describe('post-manage revalidation window — late attempts never survive an identity switch', () => {
  it('every attempt re-checks mounted/generation/uid/syncedUid before AND after the refresh', () => {
    const attemptFn = subscriptionContext.slice(
      subscriptionContext.indexOf('const runPostManageRefreshAttempt'),
      subscriptionContext.indexOf('const startPostManageRevalidation'),
    );
    const guardOccurrences = attemptFn.match(/currentUid\.current !== attemptUid/g) ?? [];
    expect(guardOccurrences.length).toBeGreaterThanOrEqual(2);
    expect(attemptFn).toContain('syncedUid.current !== attemptUid');
    expect(attemptFn).toContain('generation !== identityGeneration.current');
    expect(attemptFn).toContain('!mounted.current');
  });

  it('identity-sync effect and unmount both clear the window — no orphaned timers on account switch', () => {
    expect(subscriptionContext).toContain('detachCustomerInfoListener();\n      clearPostManageWindow();');
    expect(subscriptionContext).toContain('detachCustomerInfoListener();\n    clearPostManageWindow();');
    expect(subscriptionContext).toContain('clearTimeout(timer)');
  });
});

describe('post-manage revalidation window — shared, guarded refresh core', () => {
  it('doRefresh still discards stale results the same way the original refreshCustomerInfo did', () => {
    expect(subscriptionContext).toContain('subscription_snapshot_discarded_stale_identity');
    expect(subscriptionContext).toContain("const doRefresh = useCallback(");
  });

  it('post-manage attempts never throw into an unhandled rejection (silent, best-effort)', () => {
    expect(subscriptionContext).toContain("if (reason === 'manual') throw err;");
    expect(subscriptionContext).toContain('return null;');
  });

  it('every refresh path (manual, AppState, post-manage) funnels through the same identity-scoped singleflight', () => {
    expect(subscriptionContext).toContain('refreshSingleFlight.run(`${refreshUid}:${generation}`');
    const doRefreshCalls = subscriptionContext.match(/doRefresh\(/g) ?? [];
    expect(doRefreshCalls.length).toBeGreaterThanOrEqual(2); // manual wrapper + post-manage attempt
  });
});

describe('RevenueCat stays the only entitlement source of truth', () => {
  it('SubscriptionContext never reads Firestore/mirror for entitlement', () => {
    expect(subscriptionContext).not.toMatch(/from ['"]firebase\/firestore['"]/);
    expect(subscriptionContext).not.toContain('getFirestore(');
    expect(subscriptionContext).not.toContain('onSnapshot(');
    expect(subscriptionContext).not.toContain('.subscription?.');
  });

  it('isPremium is still derived only from CustomerInfo.entitlements.active', () => {
    expect(subscriptionContext).toContain(
      'Boolean(customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID])',
    );
  });

  it('the post-manage signal comparator never derives entitlement from a Firestore-shaped field', () => {
    expect(subscriptionLifecycle).not.toContain('mirror');
    expect(revenueCatService).toContain('entitlements.active[PREMIUM_ENTITLEMENT_ID]');
  });
});

describe('preserves the pre-existing CustomerInfo synchronization paths', () => {
  it('CustomerInfoUpdateListener and AppState revalidation are both still wired', () => {
    expect(subscriptionContext).toContain('addCustomerInfoListener(listener)');
    expect(subscriptionContext).toContain("NativeAppState.addEventListener('change'");
    expect(subscriptionContext).toContain('shouldRevalidateOnAppStateChange(previousState, nextState)');
  });

  it('diagnostic AppState transition logging was added without replacing the existing guard', () => {
    expect(subscriptionContext).toContain("logInfo('subscription', 'app_state_transition'");
  });
});
