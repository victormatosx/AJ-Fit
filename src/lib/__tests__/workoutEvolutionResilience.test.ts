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
    expect(HOOK_SRC).toMatch(
      /const isCurrent = \(\) => loadGenerationRef\.current === generation &&\s*programScopeGenerationRef\.current === programScopeGeneration;/,
    );
  });

  it('every state-mutating commit (success path, UNAVAILABLE early-return, and the catch) is gated by isCurrent()', () => {
    const loadFn = HOOK_SRC.slice(HOOK_SRC.indexOf('const load = useCallback'), HOOK_SRC.indexOf('useEffect(() => {\n    load();'));
    // UNAVAILABLE early return
    expect(loadFn).toMatch(/if \(!lifecycle\) {\s*if \(isCurrent\(\)\) {[\s\S]*?commitViewModel\(\{ kind: 'UNAVAILABLE' \}\);/);
    // main resolved view model commit
    expect(loadFn).toMatch(/if \(isCurrent\(\)\) {[\s\S]*?const authoritativeViewModel = buildEvolutionViewModel[\s\S]*?commitViewModel\(authoritativeViewModel\);/);
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

/**
 * Fase 2.2 — `load()` reuses the `ProgressionDecision` `reconcileWorkoutLifecycle`
 * already computed on its NO_ACTION path, instead of calling
 * `evaluateProgressionV2ForUser` a second time for the exact same uid/instant
 * (docs: empirical profiling showed the two calls were sequential — Fase 1.1's
 * in-flight dedupe cannot help two calls that never overlap in time).
 *
 * No hook-testing harness exists in this project (see the file header above),
 * so — same convention as every other `useWorkoutEvolution` behavior covered
 * in this file — these are source-level structural guards, not renders.
 */
describe('useWorkoutEvolution source — Fase 2.2 progressionDecision reuse', () => {
  const loadFnFull = HOOK_SRC.slice(
    HOOK_SRC.indexOf('const load = useCallback'),
    HOOK_SRC.indexOf('useEffect(() => {\n    load();'),
  );

  it('declares reconciledDecision OUTSIDE the skipReconcile guard, so it defaults to undefined whenever reconcile is skipped', () => {
    const declarationIndex = loadFnFull.indexOf('let reconciledDecision: ProgressionDecision | null | undefined;');
    const guardIndex = loadFnFull.indexOf('if (!options?.skipReconcile) {');
    expect(declarationIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(declarationIndex).toBeLessThan(guardIndex);
  });

  it('captures reconcileWorkoutLifecycle\'s return value and only assigns reconciledDecision from its progressionDecision field (no-op / stale-decision-safety scenario)', () => {
    expect(loadFnFull).toMatch(
      /const reconcileResult = await reconcileWorkoutLifecycle\(\{[\s\S]*?\}\);\s*reconciledDecision = reconcileResult\.progressionDecision;/,
    );
  });

  it('the initial batch Promise.all falls back to a fresh evaluateProgressionV2ForUser call whenever reconciledDecision is undefined ("programa ativo" / "transição pendente" / any non-NO_ACTION outcome), and only skips it when a real decision (including null) was captured', () => {
    expect(loadFnFull).toMatch(
      /reconciledDecision !== undefined\s*\?\s*Promise\.resolve\(reconciledDecision\)\s*:\s*evaluateProgressionV2ForUser\(user\.uid\)/,
    );
  });

  it('retry/convergence: the skipReconcile path (onSnapshot listeners, refreshProjection()) is untouched — reconcileWorkoutLifecycle is never called, so reconciledDecision can never become anything but undefined, and evaluateProgressionV2ForUser always runs fresh', () => {
    // reconcileWorkoutLifecycle call must live strictly inside the
    // `if (!options?.skipReconcile)` block — never reachable when skipped.
    const guardStart = loadFnFull.indexOf('if (!options?.skipReconcile) {');
    const guardBody = loadFnFull.slice(guardStart, loadFnFull.indexOf('\n      }\n', guardStart));
    expect(guardBody).toContain('await reconcileWorkoutLifecycle(');
    // refreshProjection / listener call sites still pass skipReconcile: true, unchanged.
    expect(HOOK_SRC).toContain("load({ skipReconcile: true, propagateError: true })");
    expect(HOOK_SRC).toContain('void load({ skipReconcile: true });');
  });

  it('erro de rede: the reconcile call and the new decision bookkeeping stay inside the EXISTING try — no new try/catch was introduced around it, so a throw is still caught by the one catch block that drives nextViewModelAfterLoad', () => {
    const tryIndex = loadFnFull.indexOf('try {');
    const catchIndex = loadFnFull.indexOf('} catch (error) {');
    const reconcileCallIndex = loadFnFull.indexOf('await reconcileWorkoutLifecycle(');
    const decisionAssignIndex = loadFnFull.indexOf('reconciledDecision = reconcileResult.progressionDecision;');
    expect(tryIndex).toBeGreaterThan(-1);
    expect(catchIndex).toBeGreaterThan(tryIndex);
    expect(reconcileCallIndex).toBeGreaterThan(tryIndex);
    expect(reconcileCallIndex).toBeLessThan(catchIndex);
    expect(decisionAssignIndex).toBeGreaterThan(tryIndex);
    expect(decisionAssignIndex).toBeLessThan(catchIndex);
    // Exactly one try/catch pair in the whole function — no nested try around reconcile.
    expect((loadFnFull.match(/\btry\s*{/g) ?? []).length).toBe(1);
    expect((loadFnFull.match(/}\s*catch\s*\(error\)\s*{/g) ?? []).length).toBe(1);
  });

  it('imports ProgressionDecision as a type-only import', () => {
    expect(HOOK_SRC).toContain("import type { ProgressionDecision } from '../progressionEngineV2/types';");
  });
});
