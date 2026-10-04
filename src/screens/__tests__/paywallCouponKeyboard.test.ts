import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const paywall = readFileSync(new URL('../PaywallScreen.tsx', import.meta.url), 'utf8');

describe('Paywall coupon keyboard handling', () => {
  it('shrinks the Paywall safely for the iOS keyboard while Android keeps adjustResize', () => {
    expect(paywall).toContain('KeyboardAvoidingView');
    expect(paywall).toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
    expect(paywall).not.toContain('automaticallyAdjustKeyboardInsets');
  });

  it('keeps the coupon input visible after the keyboard finishes opening', () => {
    expect(paywall).toContain("Keyboard.addListener('keyboardDidShow'");
    expect(paywall).toContain('if (promoInputFocusedRef.current) revealPromoInput();');
    expect(paywall).toContain('contentScrollRef.current?.scrollToEnd({ animated: true });');
    expect(paywall).toContain('onLayout={() => {');
    expect(paywall).toContain('onFocus={onInputFocus}');
    expect(paywall).toContain('onBlur={onInputBlur}');
  });

  it('allows Apply to receive the first tap and supports dismissing the keyboard by scrolling', () => {
    expect(paywall).toContain('keyboardShouldPersistTaps="handled"');
    expect(paywall).toContain("keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}");
  });
});
