import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_PAYWALL_PREMIUM_RETURN_STATE,
  resolvePaywallPremiumReturn,
  type PaywallPremiumReturnState,
} from '../paywallPremiumReturn';

function advance(
  state: PaywallPremiumReturnState,
  visible: boolean,
  isPremium: boolean,
) {
  return resolvePaywallPremiumReturn(state, { visible, isPremium });
}

describe('on-demand Paywall Premium return', () => {
  it('closes after an open Paywall observes confirmed non-Premium -> Premium', () => {
    const opened = advance(INITIAL_PAYWALL_PREMIUM_RETURN_STATE, true, false);
    const confirmed = advance(opened.state, true, true);

    expect(opened.shouldClose).toBe(false);
    expect(confirmed.shouldClose).toBe(true);
  });

  it.each(['purchase cancelled', 'purchase failed'])(
    '%s stays on the Paywall while Premium remains false',
    () => {
      const opened = advance(INITIAL_PAYWALL_PREMIUM_RETURN_STATE, true, false);
      const unchanged = advance(opened.state, true, false);

      expect(unchanged.shouldClose).toBe(false);
      expect(unchanged.state.armed).toBe(true);
    },
  );

  it('does not close merely because a purchase call finished before entitlement confirmation', () => {
    const opened = advance(INITIAL_PAYWALL_PREMIUM_RETURN_STATE, true, false);
    const purchaseReturned = advance(opened.state, true, false);

    expect(purchaseReturned.shouldClose).toBe(false);

    const listenerConfirmedLater = advance(purchaseReturned.state, true, true);
    expect(listenerConfirmedLater.shouldClose).toBe(true);
  });

  it('requests the return only once for a confirmed transition', () => {
    const opened = advance(INITIAL_PAYWALL_PREMIUM_RETURN_STATE, true, false);
    const confirmed = advance(opened.state, true, true);
    const repeatedPremiumRender = advance(confirmed.state, true, true);

    expect(confirmed.shouldClose).toBe(true);
    expect(repeatedPremiumRender.shouldClose).toBe(false);
  });

  it('does not create a transition when an inconsistent Paywall opens already Premium', () => {
    const openedPremium = advance(INITIAL_PAYWALL_PREMIUM_RETURN_STATE, true, true);
    expect(openedPremium.shouldClose).toBe(false);
  });

  it('resets the transition latch when the Paywall closes', () => {
    const opened = advance(INITIAL_PAYWALL_PREMIUM_RETURN_STATE, true, false);
    const closed = advance(opened.state, false, false);

    expect(closed).toEqual({
      state: INITIAL_PAYWALL_PREMIUM_RETURN_STATE,
      shouldClose: false,
    });
  });

  it('uses the existing overlay state to reveal the previous screen, with no Home redirect', () => {
    const appShell = readFileSync('src/screens/AppShell.tsx', 'utf8');
    const effectStart = appShell.indexOf('const transition = resolvePaywallPremiumReturn(');
    const effectEnd = appShell.indexOf('const selectTab', effectStart);
    const returnEffect = appShell.slice(effectStart, effectEnd);

    expect(returnEffect).toContain('setShowPremium(false)');
    expect(returnEffect).not.toMatch(/setTab\(|Home|navigate|replace|reset|goBack/);
  });
});
