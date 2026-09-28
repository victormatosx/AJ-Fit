import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

/**
 * Three independent axes, none derived from another:
 *   - AccountClass (lib/accountClassification.ts) — account identity.
 *   - RevenueCatWebhookEnvironment (billing/financialEnvironment.ts) — one
 *     financial transaction's origin.
 *   - NotificationDispatchMode (notifications/schema.ts) — one dispatch's
 *     mode.
 *
 * A valid combination is `accountClass = INTERNAL_QA` with
 * `RevenueCat environment = PRODUCTION` (a QA account making a deliberate
 * real purchase) or `dispatchMode = PRODUCT` (an ordinary product
 * notification reaching a QA account) — this test locks down that no
 * source file ever collapses one axis into another.
 */
describe('AccountClass — axis independence from RevenueCat environment and dispatchMode', () => {
  it('never writes accountClass from anything RevenueCat-shaped', () => {
    const source = read('src/adminUsers/accountClassProvisioning.ts');
    for (const forbidden of ['revenuecat', 'RevenueCat', 'SANDBOX', 'event.environment']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('never writes accountClass from anything notification-dispatch-shaped', () => {
    const source = read('src/adminUsers/accountClassProvisioning.ts');
    for (const forbidden of ['dispatchMode', 'QA_PREVIEW', 'notificationDispatches']) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('never reads accountClass to decide a financial or dispatch-mode value', () => {
    const financialEnvironment = read('src/billing/financialEnvironment.ts');
    const subscriptionTransactions = read('src/billing/subscriptionTransactions.ts');
    for (const forbidden of ['accountClass', 'INTERNAL_QA']) {
      expect(financialEnvironment).not.toContain(forbidden);
      expect(subscriptionTransactions).not.toContain(forbidden);
    }
  });

  it('accountClass is a closed two-state enum that never includes SANDBOX', () => {
    const source = read('src/lib/accountClassification.ts');
    expect(source).toMatch(/ACCOUNT_CLASSES = \['PRODUCTION', 'INTERNAL_QA'\]/);
    expect(source).not.toContain("'SANDBOX'");
  });
});

/**
 * Regression lock for the resolver/query divergence bug: `resolveAccountClass`
 * once returned `'PRODUCTION'` for an absent field while `productionUsersQuery`
 * (correctly) excludes absent fields — two different answers to "is this
 * PRODUCTION?" depending on which code path asked. Fixed by making absence
 * resolve to `'UNKNOWN'`. This scans the actual source text — not just
 * behavior — so a future edit that reintroduces a fallback-to-PRODUCTION
 * pattern (`?? 'PRODUCTION'`, `|| 'PRODUCTION'`, or equivalent) fails here
 * even if no existing behavioral test happens to catch that specific input.
 */
describe('AccountClass — no fallback-to-PRODUCTION regression', () => {
  it('no file touching accountClass ever falls back to PRODUCTION for a missing/invalid value', () => {
    const suspectFiles = [
      'src/lib/accountClassification.ts',
      'src/adminUsers/accountClassProvisioning.ts',
      'src/adminUsers/adminUsers.ts',
    ];
    const fallbackPatterns = [
      /accountClass[^;\n]*\?\?\s*['"]PRODUCTION['"]/,
      /['"]PRODUCTION['"]\s*:\s*resolveAccountClass/,
      /\|\|\s*['"]PRODUCTION['"]/,
    ];
    for (const file of suspectFiles) {
      const source = read(file);
      for (const pattern of fallbackPatterns) {
        expect(source, `${file} matched forbidden fallback pattern ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("resolveAccountClass's only literal return of 'PRODUCTION' is gated on an exact-match check against the raw value", () => {
    const source = read('src/lib/accountClassification.ts');
    // The one true production path: an explicit equality check, never an
    // absence-tolerant fallback.
    expect(source).toMatch(/if \(raw === 'PRODUCTION'\) return 'PRODUCTION';/);
  });
});
