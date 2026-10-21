import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runtime = readFileSync(
  'src/components/subscription/SubscriptionCelebrationRuntime.tsx',
  'utf8',
);
const app = readFileSync('App.tsx', 'utf8');
const subscriptionContext = readFileSync('src/state/SubscriptionContext.tsx', 'utf8');

describe('SubscriptionCelebrationRuntime structure', () => {
  it('is mounted globally beside RootNavigator inside SubscriptionProvider', () => {
    expect(app).toContain('<SubscriptionCelebrationRuntime />');
    expect(app.indexOf('<SubscriptionProvider>')).toBeLessThan(
      app.indexOf('<SubscriptionCelebrationRuntime />'),
    );
  });

  it('never reacts to the raw RevenueCat CustomerInfo snapshot', () => {
    // Regression guard: the runtime used to diff `realCustomerInfo` on every
    // update and infer a "renewed" celebration whenever the latest purchase
    // date advanced. That fired for auto-renewals delivered by the native
    // RevenueCat listener, app startup and foreground syncs, not just manual
    // in-app purchases. The runtime must not read subscription state at all —
    // it may only react to the explicit purchase-completed event.
    expect(runtime).not.toContain('useSubscription');
    expect(runtime).not.toContain('realCustomerInfo');
    expect(runtime).not.toContain('resolveSubscriptionCelebration');
    expect(runtime).not.toContain('subscriptionCelebrationState');
    expect(runtime).not.toContain('isPremium');
  });

  it('resets its dedup state when the signed-in identity changes', () => {
    expect(runtime).toContain('celebratedTransaction.current = null');
    expect(runtime).toContain('setCelebration(null)');
  });

  it('uses explicit purchase provenance and never treats restore as a purchase', () => {
    expect(runtime).toContain('subscribeToSubscriptionPurchaseCelebrations');
    expect(subscriptionContext).toContain('emitSubscriptionPurchaseCelebration({');
    const purchaseBlock = subscriptionContext.slice(
      subscriptionContext.indexOf('const performPurchase'),
      subscriptionContext.indexOf('const purchase = useCallback'),
    );
    const restoreBlock = subscriptionContext.slice(
      subscriptionContext.indexOf('const restore = useCallback'),
      subscriptionContext.indexOf('const manageSubscription = useCallback'),
    );
    expect(purchaseBlock).toContain('emitSubscriptionPurchaseCelebration({');
    expect(restoreBlock).not.toContain('emitSubscriptionPurchaseCelebration({');
  });

  it('only shows the celebration overlay for an id matching the dispatched event', () => {
    expect(runtime).toContain('setCelebration({ id: ++nextId.current, kind: event.kind })');
  });

  it('uses its own animation without a native Modal transition', () => {
    expect(runtime).toContain('animationType="none"');
    expect(runtime).toContain('Animated.sequence([');
    expect(runtime).toContain('<CelebrationPulseRings');
    expect(runtime).toContain('useReducedMotionPreference()');
  });
});
