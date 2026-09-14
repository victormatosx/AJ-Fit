import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Subscription Center integration', () => {
  const appShell = source('src/screens/AppShell.tsx');
  const profile = source('src/screens/ProfileScreen.tsx');
  const account = source('src/screens/AccountSettingsScreen.tsx');
  const center = source('src/screens/SubscriptionCenterScreen.tsx');
  const gate = source('src/lib/premiumGate.ts');

  it('opens the Subscription Center only from the Account settings sub-screen', () => {
    expect(account).toContain('onPress: onOpenSubscription');
    expect(profile).not.toContain('onOpenSubscription');
    expect(appShell).toContain('onOpenSubscription={() => setShowSubscriptionCenter(true)}');
    expect(appShell).toContain('<SubscriptionCenterScreen');
  });

  it('reuses the existing Paywall only from the renew action', () => {
    expect(appShell).toContain('onRenew={() => {');
    expect(appShell).toContain('setShowPremium(true)');
    expect(appShell).toContain('<PaywallScreen');
    expect(center).toContain("model.status === 'expired'");
    expect(center).toContain('onPress={onRenew}');
  });

  it('opens subscription management from the status card without a separate section', () => {
    expect(center).toContain('onPress={() => void handleManage()}');
    expect(center).toContain('accessibilityRole="button"');
    expect(center).not.toContain('function SubscriptionActions');
    expect(center).not.toContain("title={t('subscriptionCenter.section.manage')}");
  });

  it('reuses context restore and live CustomerInfo rather than caching a screen snapshot', () => {
    expect(center).toContain('customerInfo,');
    expect(center).toContain('const outcome = await restore()');
    expect(center).toContain('resolveSubscriptionCenterModel({');
    expect(center).toContain('[customerInfo, offerings, profile?.subscription]');
  });

  it('keeps the Premium Gate independent from the Subscription Center', () => {
    expect(gate).not.toContain('SubscriptionCenter');
    expect(gate).not.toContain('CANCELED');
    expect(gate).not.toContain('BILLING_ISSUE');
    // FASE 1: the root gate no longer branches on isPremium — it opens
    // AppShell unconditionally once the subscription state is resolved.
    expect(gate).toContain("return 'app';");
  });

  it('does not turn attribution coupon text into a financial promotion claim', () => {
    expect(center).not.toContain('couponCode');
    expect(center).not.toContain('Cupom aplicado');
    expect(center).not.toContain('Coupon applied');
  });
});
