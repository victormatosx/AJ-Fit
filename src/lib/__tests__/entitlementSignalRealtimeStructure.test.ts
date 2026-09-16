import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const subscriptionContext = read('state/SubscriptionContext.tsx');
const revenueCatService = read('services/revenueCatService.ts');

/**
 * Acesso Premium Gratuito Administrativo — realtime invalidation signal
 * (`entitlementSignals/{uid}`). There is no React Testing Library in this
 * project (see postManageRevalidationStructure.test.ts's own note), so the
 * React-effect wiring for the new Firestore listener is verified
 * structurally, the same way the pre-existing post-manage revalidation
 * window is. Behavioral coverage for the backend side (when the signal is
 * actually written) lives in
 * functions/src/adminUsers/__tests__/adminFreeAccess.test.ts.
 */

function extractFunctionBody(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const attachFn = extractFunctionBody(
  subscriptionContext,
  'const attachEntitlementSignalListener = useCallback(',
  '// The one and only place',
);

describe('entitlementSignals listener — initial snapshot never triggers a refresh', () => {
  it('ignores the first snapshot after attaching, only reacting from the second one onward', () => {
    expect(attachFn).toContain('let receivedFirstSnapshot = false;');
    expect(attachFn).toMatch(/if \(!receivedFirstSnapshot\) \{\s*receivedFirstSnapshot = true;\s*return;\s*\}/);
    // The invalidate+refresh call must appear textually AFTER the
    // early-return guard above, i.e. unreachable on the first snapshot.
    const guardIndex = attachFn.indexOf('receivedFirstSnapshot = true;');
    const refreshIndex = attachFn.indexOf('invalidateCustomerInfoCache()');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(refreshIndex).toBeGreaterThan(guardIndex);
  });
});

describe('entitlementSignals listener — identity protections mirror the RevenueCat listener', () => {
  it('re-checks mounted/generation/uid/syncedUid before treating a snapshot as live', () => {
    expect(attachFn).toContain('!mounted.current');
    expect(attachFn).toContain('identityGeneration.current !== generation');
    expect(attachFn).toContain('currentUid.current !== listenerUid');
    expect(attachFn).toContain('syncedUid.current !== listenerUid');
  });

  it('re-checks the same four guards again after the async invalidate+fetch round-trip', () => {
    const guardOccurrences = attachFn.match(/currentUid\.current !== listenerUid/g) ?? [];
    // Once before deciding to invalidate, once again inside the `.then()`
    // before applying the follow-up fetch — an identity switch mid-flight
    // must not let a stale uid's refresh proceed.
    expect(guardOccurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('detaches before re-attaching, and is torn down at every identity transition and unmount', () => {
    expect(attachFn.startsWith('const attachEntitlementSignalListener = useCallback(\n    (listenerUid: string, generation: number) => {\n      detachEntitlementSignalListener();')).toBe(true);
    const detachOccurrences = subscriptionContext.match(/detachEntitlementSignalListener\(\)/g) ?? [];
    // Inside attach (re-attach guard) + auth-waiting branch + identity-changed
    // branch + unmount cleanup = at least 4 call sites.
    expect(detachOccurrences.length).toBeGreaterThanOrEqual(4);
  });
});

describe('entitlementSignals listener — never a new entitlement decision path', () => {
  it('never calls applyLifecycleEvent itself — only invalidates + re-fetches CustomerInfo', () => {
    expect(attachFn).not.toContain('applyLifecycleEvent(');
  });

  it('uses invalidateCustomerInfoCache followed by the existing fetchCustomerInfo, never restorePurchases/syncPurchases', () => {
    expect(attachFn).toContain('invalidateCustomerInfoCache()');
    expect(attachFn).toContain('fetchCustomerInfo()');
    expect(attachFn).not.toContain('restorePurchasesService');
    expect(attachFn).not.toContain('syncPurchases');
  });

  it('does not read any field from the snapshot — the callback receives no snapshot parameter', () => {
    expect(subscriptionContext).toMatch(/onSnapshot\(\s*doc\(db, 'entitlementSignals', listenerUid\),\s*\(\) => \{/);
  });
});

describe('entitlementSignals listener — attached alongside the RevenueCat listener, not instead of it', () => {
  it('attachCustomerInfoListener and attachEntitlementSignalListener are both called for the same identity', () => {
    expect(subscriptionContext).toContain(
      'attachCustomerInfoListener(identityUid, generation);\n          attachEntitlementSignalListener(identityUid, generation);',
    );
  });

  it('AppState foreground revalidation is unchanged (redundant fallback preserved)', () => {
    expect(subscriptionContext).toContain("NativeAppState.addEventListener('change'");
    expect(subscriptionContext).toContain('shouldRevalidateOnAppStateChange(previousState, nextState)');
  });
});

describe('CustomerInfoUpdateListener doc comment reflects official RevenueCat documentation', () => {
  it('no longer claims promotional grants/cross-device changes are pushed spontaneously', () => {
    expect(revenueCatService).not.toContain(
      'Subscribes to CustomerInfo pushed by the SDK outside of an explicit call',
    );
  });

  it('states the documented outbound-network-request requirement instead', () => {
    expect(revenueCatService).toContain('CustomerInfo updates are not pushed to your app from the');
    expect(revenueCatService).toContain('RevenueCat backend');
    expect(revenueCatService).toMatch(/outbound network\s*\*?\s*request/);
  });
});
