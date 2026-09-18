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

  it('observes only real RevenueCat state and silently baselines each uid', () => {
    expect(runtime).toContain('const { realCustomerInfo } = useSubscription();');
    expect(runtime).not.toContain('effectiveCustomerInfo');
    expect(runtime).not.toContain('isPremium');
    expect(runtime).toContain('if (!previous || previous.uid !== uid)');
    expect(runtime).toContain('baseline.current = { uid, snapshot };');
  });

  it('uses explicit purchase provenance and never treats restore as a purchase', () => {
    expect(runtime).toContain('subscribeToSubscriptionPurchaseCelebrations');
    expect(runtime).toContain('subscribeToSubscriptionRestoreCelebrationBoundaries');
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
    expect(restoreBlock).toContain("phase: 'started'");
    expect(restoreBlock).toContain("phase: 'finished'");
  });

  it('uses its own animation without a native Modal transition', () => {
    expect(runtime).toContain('animationType="none"');
    expect(runtime).toContain('Animated.sequence([');
    expect(runtime).toContain('<CelebrationPulseRings');
    expect(runtime).toContain('useReducedMotionPreference()');
  });
});
