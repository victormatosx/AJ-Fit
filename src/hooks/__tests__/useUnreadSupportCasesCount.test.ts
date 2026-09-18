import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * No component renderer exists in this Node-only suite (vitest.config.mts,
 * same limitation documented in usePremiumCapabilities.test.ts) — the real
 * behavioral coverage for the unread count lives in
 * `src/lib/__tests__/unreadSupportCasesCount.test.ts`. This file only
 * asserts the hook stays a thin `observeOwnSupportCases` +
 * `countUnreadSupportCases` wiring: realtime, uid-scoped, reset to 0 on
 * missing uid/error, and never a second, independently maintained counter.
 */
const SOURCE = readFileSync('src/hooks/useUnreadSupportCasesCount.ts', 'utf8');

describe('useUnreadSupportCasesCount wiring', () => {
  it('subscribes through observeOwnSupportCases — never a direct Firestore query/onSnapshot of its own', () => {
    expect(SOURCE).toContain("from '../services/supportCases'");
    expect(SOURCE).toContain('observeOwnSupportCases(');
    expect(SOURCE).not.toContain('onSnapshot');
    expect(SOURCE).not.toContain("from 'firebase/firestore'");
  });

  it('derives the count exclusively through countUnreadSupportCases — no inline increment/decrement logic', () => {
    expect(SOURCE).toContain("from '../lib/unreadSupportCasesCount'");
    expect(SOURCE).toContain('countUnreadSupportCases(');
    for (const forbidden of ['count + 1', 'count - 1', 'setCount((prev']) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });

  it('resets to 0 for a missing uid and on an observe error', () => {
    expect(SOURCE).toContain('if (!uid)');
    expect(SOURCE).toMatch(/\(\) => setCount\(0\)/);
  });

  it('resubscribes when the uid changes (effect dependency array)', () => {
    expect(SOURCE).toMatch(/\}, \[uid\]\);/);
  });
});
