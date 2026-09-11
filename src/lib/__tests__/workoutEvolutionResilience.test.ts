import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Workout Evolution resilience hardening regression guard (docs 2026-09).
 * Before this fix, `useWorkoutEvolution.load()` unconditionally overwrote
 * the current view model with `ERROR` on ANY failure, including a transient
 * offline refresh with a perfectly good cycle already on screen, and had no
 * generation/staleness guard around concurrent `load()` calls (COLD_START,
 * Firestore listeners, FOREGROUND, and manual actions can all legitimately
 * race each other — nothing upstream serializes them).
 *
 * `nextViewModelAfterLoad`'s actual decision logic is covered exhaustively
 * as pure TS in `workoutEvolution/__tests__/loadReducer.test.ts`. This file
 * covers the parts of the fix that only exist inside the hook itself — the
 * generation guard and the AppState/foreground wiring — via lightweight
 * source checks, same convention as `workoutLogicIntact.test.ts` /
 * `workoutExitFlow.test.ts` (no RN runtime import, no hook-testing harness
 * exists in this project).
 */
const HOOK_SRC = readFileSync(
  resolve(__dirname, '../../workoutEvolution/useWorkoutEvolution.ts'),
  'utf8',
);

describe('useWorkoutEvolution source — stale-result guard (concurrent load() calls)', () => {
  it('declares a generation counter and captures it per-call', () => {
    expect(HOOK_SRC).toContain('const loadGenerationRef = useRef(0);');
    expect(HOOK_SRC).toContain('const generation = ++loadGenerationRef.current;');
    expect(HOOK_SRC).toContain('const isCurrent = () => loadGenerationRef.current === generation;');
  });

  it('every state-mutating commit (success path, UNAVAILABLE early-return, and the catch) is gated by isCurrent()', () => {
    const loadFn = HOOK_SRC.slice(HOOK_SRC.indexOf('const load = useCallback'), HOOK_SRC.indexOf('useEffect(() => {\n    load();'));
    // UNAVAILABLE early return
    expect(loadFn).toMatch(/if \(!lifecycle\) {\s*if \(isCurrent\(\)\) {\s*commitViewModel\(\{ kind: 'UNAVAILABLE' \}\);/);
    // main resolved view model commit
    expect(loadFn).toMatch(/if \(isCurrent\(\)\) {\s*commitViewModel\(buildEvolutionViewModel/);
    // catch branch
    expect(loadFn).toContain('if (isCurrent()) {');
    expect(loadFn).toContain('const next = nextViewModelAfterLoad(previous, { status: \'failure\' });');
  });

  it('viewModelRef stays in sync with every committed view model via a single commitViewModel wrapper', () => {
    expect(HOOK_SRC).toContain('const viewModelRef = useRef<EvolutionViewModel>(viewModel);');
    expect(HOOK_SRC).toContain('viewModelRef.current = next;');
    expect(HOOK_SRC).toContain('setViewModel(next);');
    // No direct setViewModel(...) call anywhere outside the wrapper itself —
    // every other write path goes through commitViewModel(...).
    const directCalls = (HOOK_SRC.match(/\bsetViewModel\(/g) ?? []).length;
    const commitCalls = (HOOK_SRC.match(/\bcommitViewModel\(/g) ?? []).length;
    expect(directCalls).toBe(1); // the one inside commitViewModel's own body
    expect(commitCalls).toBeGreaterThan(1); // every other call site uses the wrapper
  });
});

describe('useWorkoutEvolution source — ERROR gets an immediate foreground retry opportunity', () => {
  it('passes isRecoveringFromError computed from the live viewModelRef, not stale render state', () => {
    const appStateEffect = HOOK_SRC.slice(
      HOOK_SRC.indexOf("AppState.addEventListener('change'"),
      HOOK_SRC.indexOf('return () => subscription.remove();'),
    );
    expect(appStateEffect).toContain("isRecoveringFromError: viewModelRef.current.kind === 'ERROR',");
  });

  it('still routes through the same shouldReconcileOnForeground/throttle bookkeeping — no separate polling path introduced', () => {
    expect(HOOK_SRC).not.toMatch(/setInterval/);
    expect(HOOK_SRC).not.toMatch(/NetInfo/);
    expect(HOOK_SRC).toContain('shouldReconcileOnForeground({');
    expect(HOOK_SRC).toContain('lastForegroundReconcileAtRef.current = now;');
  });
});

describe('useWorkoutEvolution source — resilience decision delegates to the pure reducer', () => {
  it('imports and calls nextViewModelAfterLoad instead of reimplementing the ERROR/preserve branching inline', () => {
    expect(HOOK_SRC).toContain("import { nextViewModelAfterLoad } from './loadReducer';");
    expect(HOOK_SRC).toContain('nextViewModelAfterLoad(previous, { status: \'failure\' })');
  });
});
