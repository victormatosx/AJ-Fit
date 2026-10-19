import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { validateNativeEnvironment } = require('../../../scripts/checkNativeEnvironment.cjs');
const firebase = { EXPO_PUBLIC_FIREBASE_API_KEY: 'synthetic', EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-ajfit', EXPO_PUBLIC_FIREBASE_APP_ID: 'synthetic' };
describe('native environment preflight — no credentials in diagnostics', () => {
  it('detects the isolated Firebase-only environment that caused RevenueCat configuration failure', () => {
    const result = validateNativeEnvironment(firebase);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing EXPO_PUBLIC_REVENUECAT_IOS_API_KEY');
  });
  it('accepts existing per-platform public SDK configuration without substituting keys', () => {
    expect(validateNativeEnvironment({ ...firebase, EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'appl_synthetic' }).ok).toBe(true);
    expect(validateNativeEnvironment({ ...firebase, EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: 'goog_synthetic' }, 'android').ok).toBe(true);
  });
  it('does not expose a supplied invalid key in its errors', () => {
    const result = validateNativeEnvironment({ ...firebase, EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: 'synthetic-private-value' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('synthetic-private-value');
  });
});
