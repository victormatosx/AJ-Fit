import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Regression coverage for a real iPhone bug: opening the Health Integration
 * screen left it stuck on the loading spinner forever (two
 * `[healthIntegration] availability_checked` log lines, no error).
 *
 * Root cause: `useHealthIntegration` tracked staleness with a single counter
 * (`operation`) that BOTH the uid-change effect and `refresh()` incremented.
 * `HealthIntegrationScreen`'s `useScreenFocusEffect` calls `refresh()` on the
 * screen's very first activation (documented behavior of
 * `useScreenFocusEffect` — it fires on first activation too), racing the
 * initial load. Because `refresh()` bumped the same counter the initial
 * load's async fetch was about to check, the initial fetch's own completion
 * looked "superseded" to itself and its `setLoading(false)` never ran —
 * `refresh()` itself never touches `loading`, so nothing else could clear it
 * either. Both fetches actually succeeded (hence the duplicate log, zero
 * errors) — the result was silently discarded, not failed.
 *
 * Fix: only the uid-change effect may advance `uidEpoch`; every other
 * operation only reads it, and `refresh()` no-ops entirely while the initial
 * load is still in flight instead of racing it.
 *
 * No component renderer in this Node-only suite (see
 * `usePremiumCapabilities.test.ts`), so — like every other hook/screen
 * correctness test in this repo — this reads the source directly.
 */
const HOOK_SOURCE = readFileSync('src/hooks/useHealthIntegration.ts', 'utf8');
const HOOK_CODE = HOOK_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function bodyOf(fnStart: string): string {
  const startIdx = HOOK_CODE.indexOf(fnStart);
  expect(startIdx, `"${fnStart}" not found`).toBeGreaterThan(-1);
  const endIdx = HOOK_CODE.indexOf('\n  }, [', startIdx);
  expect(endIdx, `closing "}, [...]" not found after "${fnStart}"`).toBeGreaterThan(-1);
  return HOOK_CODE.slice(startIdx, endIdx);
}

describe('useHealthIntegration — single epoch owner (the actual bug)', () => {
  it('advances uidEpoch in exactly one place: the uid-change effect', () => {
    const advances = HOOK_CODE.match(/uidEpoch\.current\s*\+=\s*1/g) ?? [];
    expect(advances).toHaveLength(1);
  });

  it('refresh() never advances the epoch — it only reads it', () => {
    const refreshBody = bodyOf('const refresh = useCallback(async () => {');
    expect(refreshBody).not.toMatch(/uidEpoch\.current\s*\+=/);
    expect(refreshBody).not.toMatch(/\+\+uidEpoch\.current/);
    expect(refreshBody).toContain('uidEpoch.current !== requestEpoch');
  });

  it('refresh() no-ops while the initial load is still running, instead of racing it', () => {
    const prefix = 'const refresh = useCallback(async () => {';
    const refreshBody = bodyOf(prefix).slice(prefix.length);
    const firstStatement = refreshBody.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
    // Must be the very first statement — a late check would still allow the
    // native calls below it to have already fired.
    expect(firstStatement).toBe('if (loadingRef.current) return;');
  });

  it('the initial load always reaches setLoading(false): no-uid, success, and failure paths', () => {
    const effectBody = bodyOf('useEffect(() => {\n    uidEpoch.current += 1;');
    const occurrences = effectBody.match(/setLoading\(false\)/g) ?? [];
    expect(occurrences).toHaveLength(3);
  });

  it('loadingRef is kept in sync with the loading state on all three paths (no-uid, success, failure)', () => {
    const effectBody = bodyOf('useEffect(() => {\n    uidEpoch.current += 1;');
    expect(effectBody).toContain('loadingRef.current = true;');
    expect((effectBody.match(/loadingRef\.current = false;/g) ?? []).length).toBe(3);
  });
});

describe('useHealthIntegration — connect()/disconnect() never apply a stale account\'s result', () => {
  it('connect() re-checks the epoch after each await before touching state', () => {
    const body = bodyOf('const connect = useCallback(async () => {');
    const checks = body.match(/uidEpoch\.current !== requestEpoch/g) ?? [];
    // After setHealthIntegrationIntent, after requestHealthPermissions, and in the catch.
    expect(checks.length).toBeGreaterThanOrEqual(3);
  });

  it('disconnect() re-checks the epoch after its await before touching state', () => {
    const body = bodyOf('const disconnect = useCallback(async () => {');
    const checks = body.match(/uidEpoch\.current !== requestEpoch/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(2);
  });
});
