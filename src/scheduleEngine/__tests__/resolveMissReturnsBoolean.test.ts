import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HOOK = readFileSync('src/scheduleEngine/useWorkoutSchedule.ts', 'utf8');
const HOOK_CODE = HOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('useWorkoutSchedule — identity-scoped miss resolution contract', () => {
  it('requires the displayed decision identity and returns a classified outcome', () => {
    expect(HOOK_CODE).toMatch(/resolveMiss:\s*\(\s*decision: MissDecision,\s*expected: MissedSessionDecisionIdentity,\s*\) => Promise<MissResolutionOutcome>/);
  });

  it('single-flights the mutation and reloads before classifying its result', () => {
    const start = HOOK_CODE.indexOf('const resolveMiss = useCallback((');
    const end = HOOK_CODE.indexOf('}, [uid, programId, programInstanceId, sessionCount, config, reload]);', start);
    const fn = HOOK_CODE.slice(start, end);
    expect(fn).toContain('if (missResolutionInFlightRef.current) return missResolutionInFlightRef.current;');
    expect(fn).toContain('expected,');
    expect(fn).toContain('const resolution = await reload();');
    expect(fn).toContain('classifyMissResolutionOutcome({ error: failure, expected, resolution })');
  });
});
