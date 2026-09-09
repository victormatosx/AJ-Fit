import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `resolveMiss` used to be fire-and-forget (`Promise<void>`, errors caught
 * and only logged) — AppShell called it with `void schedule.resolveMiss(...)`
 * and could never tell whether the resolution actually succeeded, so it had
 * no way to keep the decision modal open/show an error on failure. This
 * pins the new `Promise<boolean>` contract: success and failure are both
 * observable to the caller, and `reload()` still always runs (idempotency
 * — a failed write must not leave stale local state behind).
 */
const HOOK = readFileSync('src/scheduleEngine/useWorkoutSchedule.ts', 'utf8');
const HOOK_CODE = HOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('useWorkoutSchedule — resolveMiss return contract', () => {
  it('declares resolveMiss as returning Promise<boolean> on the controller interface', () => {
    expect(HOOK_CODE).toContain('resolveMiss: (decision: MissDecision) => Promise<boolean>;');
  });

  it('returns true on success and false on failure, from within the same try/catch/finally shape', () => {
    const start = HOOK_CODE.indexOf('const resolveMiss = useCallback(async (decision: MissDecision) => {');
    const end = HOOK_CODE.indexOf('}, [uid, programId, programInstanceId, sessionCount, config, reload]);', start);
    const fn = HOOK_CODE.slice(start, end);
    expect(fn).toContain('return true;');
    expect(fn).toContain('return false;');
    // reload() must still run unconditionally (finally), regardless of
    // whether the write succeeded — the UI's resolution must never go
    // stale after a failed attempt.
    expect(fn).toMatch(/finally \{\s*await reload\(\);/);
  });
});
