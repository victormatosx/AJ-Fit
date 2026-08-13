/**
 * Waits for a REAL CustomerInfo push from the RevenueCat SDK's
 * `CustomerInfoUpdateListener` — used after `Purchases.presentCodeRedemptionSheet()`
 * (`revenueCatService.ts`'s `redeemOfferCode`), which is fire-and-forget in
 * react-native-purchases@10.6.0 (confirmed by reading the installed SDK's JS/
 * native source — see that function's doc comment): its own Promise resolves
 * almost immediately after dispatching the native call, NOT when the sheet
 * closes or a redemption completes. Calling `Purchases.getCustomerInfo()`
 * right after that Promise resolves reads a stale cache — this module exists
 * to replace that premature read with an actual signal.
 *
 * Deliberately generic (`<TCustomerInfo>`) and free of any React
 * Native/RevenueCat/Firebase import — same testability rationale as
 * `subscriptionLifecycle.ts`'s `createIdentityScopedSingleFlight`: every
 * dependency (listener registration, the final revalidation call, the
 * timeout) is injected, so this is fully unit-testable with fake timers and
 * a fake listener, without mocking the native SDK.
 *
 * NEVER decides Premium access itself — it only decides WHEN to resolve with
 * a `CustomerInfo`. Whichever `CustomerInfo` it resolves with (from the
 * listener, or from the final timeout revalidation) is handed back to the
 * caller exactly as-is; `classifyPurchaseResult` (subscriptionOffer.ts)
 * remains the ONLY code that reads `entitlements.active['premium']` to
 * decide access. A listener firing, a timeout occurring, or the final
 * refresh succeeding are never, by themselves, treated as "premium granted"
 * here — this module has no concept of "premium" at all.
 */

export type AwaitCustomerInfoUpdateResult<TCustomerInfo> =
  | { status: 'listener-update'; customerInfo: TCustomerInfo }
  | { status: 'timeout-refresh'; customerInfo: TCustomerInfo }
  | { status: 'timeout-refresh-error'; error: unknown };

export interface AwaitCustomerInfoUpdateDeps<TCustomerInfo> {
  /** Mirrors `revenueCatService.ts`'s `addCustomerInfoListener` — must accept the SAME listener reference back to `removeListener`. */
  addListener: (listener: (info: TCustomerInfo) => void) => void;
  removeListener: (listener: (info: TCustomerInfo) => void) => void;
  /** The single, explicit final revalidation allowed after timeout (Parte 6/7) — e.g. `Purchases.getCustomerInfo()`. Never called more than once by this function. */
  refreshFinal: () => Promise<TCustomerInfo>;
  /** Milliseconds to wait for a listener push before falling back to `refreshFinal`. Purely a "stop waiting" mechanism — never treated as proof of anything (Parte 6). */
  timeoutMs: number;
}

/**
 * Resolves EXACTLY ONCE (Parte 4/14 item 5): a `settled` guard makes every
 * code path after the first — a second listener callback, the timeout firing
 * after a listener already resolved, etc. — a no-op. The temporary listener
 * is always removed before resolving, on every path (listener success,
 * timeout+refresh success, timeout+refresh error) — never left registered
 * (Parte 4: "evitar memory leak", "remover qualquer listener temporário ao
 * finalizar").
 *
 * Never rejects: `refreshFinal` throwing is reported as
 * `{status:'timeout-refresh-error'}` data, not a rejection — mirrors this
 * codebase's existing convention (`PurchaseOutcome`/`RestoreOutcome` in
 * revenueCatService.ts) of representing expected failure modes as typed
 * results, not exceptions, so callers never need a bare `try/catch` around
 * this call.
 */
export function awaitCustomerInfoUpdate<TCustomerInfo>(
  deps: AwaitCustomerInfoUpdateDeps<TCustomerInfo>,
): Promise<AwaitCustomerInfoUpdateResult<TCustomerInfo>> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;

    const listener = (info: TCustomerInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      deps.removeListener(listener);
      resolve({ status: 'listener-update', customerInfo: info });
    };

    deps.addListener(listener);

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      deps.removeListener(listener);
      deps
        .refreshFinal()
        .then((customerInfo) => resolve({ status: 'timeout-refresh', customerInfo }))
        .catch((error: unknown) => resolve({ status: 'timeout-refresh-error', error }));
    }, deps.timeoutMs);
  });
}
