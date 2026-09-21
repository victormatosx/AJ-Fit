import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const hook = read('src/workoutEvolution/useWorkoutEvolution.ts');
const shell = read('src/screens/AppShell.tsx');
const auth = read('src/state/AuthContext.tsx');
const perf = read('src/lib/perf.ts');

describe('Evolution presentation cache orchestration', () => {
  it('uses the authoritative active ProgramInstance identity already available to Home', () => {
    expect(shell).toContain('useWorkoutEvolution(activeProgram?.programInstanceId ?? null)');
    expect(hook).toContain('readEvolutionSummaryPresentationCache(uid, activeProgramInstanceId)');
  });

  it('runs local hydration in an independent effect and never awaits it before remote load', () => {
    expect(hook).toContain('void readEvolutionSummaryPresentationCache(uid, activeProgramInstanceId).then');
    expect(hook).not.toContain('await readEvolutionSummaryPresentationCache');
    expect(hook.indexOf('void readEvolutionSummaryPresentationCache(uid, activeProgramInstanceId).then'))
      .toBeLessThan(hook.indexOf('useEffect(() => {\n    load();'));
  });

  it('guards late cache responses and only paints over LOADING/ERROR', () => {
    expect(hook).toContain('cacheReadGenerationRef.current !== generation');
    expect(hook).toContain('currentScope.uid !== uid');
    expect(hook).toContain('currentScope.programInstanceId !== activeProgramInstanceId');
    expect(hook).toContain("current.kind !== 'LOADING' && current.kind !== 'ERROR'");
  });

  it('invalidates a visible summary immediately when ProgramInstance changes', () => {
    expect(hook).toContain('visibleProgramInstanceIdRef.current !== activeProgramInstanceId');
    expect(hook).toMatch(/visibleProgramInstanceIdRef\.current = null;\s*commitViewModel\(\{ kind: 'LOADING' \}\);/);
  });

  it('writes through only after the authoritative terminal commit', () => {
    const terminalCommit = hook.indexOf('commitViewModel(authoritativeViewModel)');
    const authoritativeMark = hook.indexOf("recordPerfMark('evolution_authoritative_ready')", terminalCommit);
    const write = hook.indexOf('writeEvolutionSummaryPresentationCache(', terminalCommit);
    expect(terminalCommit).toBeGreaterThan(-1);
    expect(authoritativeMark).toBeGreaterThan(terminalCommit);
    expect(write).toBeGreaterThan(authoritativeMark);
    expect(hook.match(/writeEvolutionSummaryPresentationCache\(/g)?.length).toBe(1);
  });

  it('guards lifecycle actions at the controller boundary as well as hiding cached CTAs', () => {
    expect(hook.match(/visibleProgramInstanceIdRef\.current !== activeProgramInstanceId/g)?.length)
      .toBeGreaterThanOrEqual(3);
    expect(hook).toContain("current.kind !== 'EVOLUTION_READY' && current.kind !== 'EVOLUTION_DEFERRED'");
    expect(hook).toContain("current.kind !== 'EVOLUTION_READY' || !current.canDefer");
  });

  it('removes the outgoing UID cache on logout and never uses a global key', () => {
    expect(auth).toContain('removeEvolutionSummaryPresentationCache(outgoingUid)');
    expect(read('src/lib/evolutionSummaryPresentationCache.ts'))
      .toContain('ajfit:evolution-summary-presentation:v1:${uid}');
  });

  it('declares all additive DEV+PERF marks without renaming the existing marks', () => {
    for (const mark of [
      'evolution_cache_read_start', 'evolution_cache_hit', 'evolution_cache_miss',
      'evolution_cached_summary_visible', 'evolution_current_summary_visible',
      'evolution_first_useful_content', 'evolution_authoritative_ready',
    ]) expect(perf).toContain(`'${mark}'`);
  });
});
