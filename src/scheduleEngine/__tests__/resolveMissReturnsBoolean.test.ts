import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HOOK = readFileSync('src/scheduleEngine/useWorkoutSchedule.ts', 'utf8');
const HOOK_CODE = HOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * This file used to pin the identity-scoped missed-session resolution
 * contract unconditionally. The new training model removes the concept — but
 * only for accounts enrolled in the controlled pilot. What it pins now is the
 * FORK, and the two opposite regressions on either side of it:
 *
 *  - for an enrolled account, a stray caller must never write a
 *    `MISS_RESOLVED`/`SKIPPED` ledger entry under rules that no longer have a
 *    miss to resolve;
 *  - for every other account, the published mutation must still work, or the
 *    pilot would strand the entire base on an unresolvable modal.
 */
describe('useWorkoutSchedule — missed-session resolution is pilot-gated', () => {
  it('keeps the exported signature so existing callers still compile', () => {
    expect(HOOK_CODE).toMatch(/resolveMiss:\s*\(\s*decision: MissDecision,\s*expected: MissedSessionDecisionIdentity,\s*\) => Promise<MissResolutionOutcome>/);
  });

  const resolveMissBody = () => {
    const start = HOOK_CODE.indexOf('const resolveMiss = useCallback((');
    expect(start).toBeGreaterThan(-1);
    return HOOK_CODE.slice(start, HOOK_CODE.indexOf('const selectSession', start));
  };

  it('ENROLLED: returns FAILED before touching Firestore', () => {
    const fn = resolveMissBody();
    // The enrolment check must come FIRST — before the in-flight ref, before
    // the mode guard, and before any read — so no ordering change can let an
    // enrolled account reach the mutation.
    const gate = fn.indexOf('if (enrolled) {');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(fn.indexOf('resolveMissedSession('));
    const enrolledBranch = fn.slice(gate, fn.indexOf('if (missResolutionInFlightRef', gate));
    expect(enrolledBranch).toContain("status: 'FAILED'");
    expect(enrolledBranch).not.toContain('resolveMissedSession');
  });

  it('NOT ENROLLED: still performs the published single-flighted mutation', () => {
    const fn = resolveMissBody();
    expect(fn).toContain('if (missResolutionInFlightRef.current) return missResolutionInFlightRef.current;');
    expect(fn).toContain('await resolveMissedSession({');
    expect(fn).toContain('expected,');
    expect(fn).toContain('const resolution = await reload();');
    expect(fn).toContain('return classifyMissResolutionOutcome({ error: failure, expected, resolution });');
  });

  it('re-reads enrolment as a dependency, so a flag flip cannot be stale', () => {
    expect(resolveMissBody()).toContain('}, [enrolled, uid, programId, programInstanceId, sessionCount, effectiveScheduleMode, config, reload]);');
  });
});

describe('useWorkoutSchedule — the resolver fork itself', () => {
  it('runs the free resolver only for an enrolled account', () => {
    const fork = HOOK_CODE.indexOf('const pilotEnrolled = await loadWorkoutPilotEnrollment(uid);');
    expect(fork).toBeGreaterThan(-1);
    const branch = HOOK_CODE.indexOf('if (pilotEnrolled) {', fork);
    const free = HOOK_CODE.indexOf('resolveFreeSchedule({', fork);
    const legacy = HOOK_CODE.indexOf('result = await resolveTodaysSchedule({', fork);
    expect(branch).toBeGreaterThan(-1);
    // Free resolver inside the `if`, legacy resolver after it — i.e. in the
    // `else`. Both present: neither path may be deleted.
    expect(free).toBeGreaterThan(branch);
    expect(legacy).toBeGreaterThan(free);
  });

  it('defaults to legacy before any read resolves', () => {
    expect(HOOK_CODE).toContain('const [enrolled, setEnrolled] = useState(false);');
  });

  it('leaves suggestionVersion at 0 for a legacy account', () => {
    // This is what stops the client sending `startedFromSuggestionVersion` on
    // execution create, which the published Rules reject.
    expect(HOOK_CODE).toContain('let suggestionUpdate: { version: number; creditedToday: boolean } | null = null;');
    expect(HOOK_CODE).toContain('if (suggestionUpdate) setSuggestion(suggestionUpdate);');
  });

  it('refuses a suggestion write from a non-enrolled account', () => {
    const start = HOOK_CODE.indexOf('const selectSession = useCallback((');
    expect(start).toBeGreaterThan(-1);
    const fn = HOOK_CODE.slice(start, HOOK_CODE.indexOf('return {', start));
    const gate = fn.indexOf('if (!enrolled) return Promise.resolve(null);');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(fn.indexOf('selectWorkoutSession('));
  });

  it('single-flights the new intentional selection', () => {
    const start = HOOK_CODE.indexOf('const selectSession = useCallback((');
    const fn = HOOK_CODE.slice(start, HOOK_CODE.indexOf('return {', start));
    expect(fn).toContain('if (selectSessionInFlightRef.current) return selectSessionInFlightRef.current;');
    expect(fn).toContain('selectWorkoutSession(');
    // A failed write must reconcile from the server, never keep a local value.
    expect(fn).toContain('await reload();');
  });

  it('publishes enrolment to screens as a read-only fact', () => {
    expect(HOOK_CODE).toContain('pilotEnrolled: boolean;');
    expect(HOOK_CODE).toContain('pilotEnrolled: enrolled,');
  });
});
