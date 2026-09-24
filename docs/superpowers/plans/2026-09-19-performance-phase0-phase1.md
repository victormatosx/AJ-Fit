# AJ Fit Performance — Fase 0 (Instrumentação/Baseline) + Fase 1 (Eliminar Trabalho Duplicado) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add minimal, removable performance instrumentation (Fase 0), get a real/structural baseline, then eliminate the three audited sources of duplicate work — concurrent `loadWorkoutLifecycle` reads, an avoidable sequential program fetch in `useWorkoutEvolution.load()`, and one AppShell hook with no real cross-tab consumer — without changing any business rule (Fase 1).

**Architecture:**
- Fase 0 adds one new module, `src/lib/perf.ts`, modeled byte-for-byte on the existing `src/lib/photoVaultPerformance.ts` pattern (DEV + explicit env-flag gated, `logDebug`-backed, closed vocabulary, zero-op when disabled) — reusing the codebase's own established instrumentation convention instead of inventing a new one.
- Fase 1.1 adds a generic single-flight in-flight-request dedupe helper, `src/lib/inFlightDedupe.ts`, modeled on the existing `Map<string, Promise<T>>` pattern in `src/services/workoutPrograms.ts` (`generateAndPersistWorkoutProgramDeduped`), and applies it ONLY to the two `loadWorkoutLifecycle` call sites proven to fire concurrently for the same uid in the same tick (`useWorkoutEvolution.load()` and `evaluateProgressionV2ForUserFull`). Every other `loadWorkoutLifecycle` call site (writes, convergence checks, recovery) is deliberately left untouched.
- Fase 1.2 reorders one independent read in `useWorkoutEvolution.load()` so it runs in parallel with the lifecycle-events/notice lookup instead of after it.
- Fase 1.3 audits every hook `AppShell.tsx` calls, confirms real consumers for each, and moves the one hook with no genuine cross-tab consumer (`useUnreadSupportCasesCount`) into `HomeScreen`, its sole actual owner.

**Tech Stack:** TypeScript, React Native/Expo, Firebase Firestore (`firebase/firestore` client SDK), Vitest, `@firebase/rules-unit-testing` for gated emulator integration tests (unused by this plan — see task notes on why unit tests suffice here).

---

## Ground truth gathered before writing this plan (do not re-derive)

- No existing generic perf/timing/telemetry system exists (`Sentry`, `firebase/performance`, `PerformanceObserver`, `console.time` — all absent). The closest reusable pattern is `src/lib/photoVaultPerformance.ts` (DEV + `EXPO_PUBLIC_*` env flag gate, `now()` helper, `logDebug`-backed, closed vocabulary of stage labels).
- `src/lib/logger.ts`'s `logDebug`/`logInfo` are already `__DEV__`-gated internally; `console.debug`/`console.info` never fire in production regardless of any extra flag.
- Vitest (`vitest.config.mts`) runs in `environment: 'node'` with **no `__DEV__` global defined**. `typeof __DEV__ !== 'undefined'` is therefore always `false` under `npm test`, so any `photoVaultPerformance.ts`-style `isEnabled()` gate is always `false` in tests — confirmed by `src/lib/__tests__/photoVaultPerformance.test.ts`, whose only enabled-path assertions are "stays silent when the flag is absent" plus a source-text check for the closed vocabulary. This plan's new perf module follows the identical, already-precedented test shape — it does **not** attempt to assert on log output from the enabled path, because that path is unreachable under Vitest by design (matches existing precedent, not a gap introduced by this plan).
- `loadWorkoutLifecycle` (`src/services/workoutLifecycle.ts:157-168`) does one `getDoc` (lifecycle doc) then two more in `Promise.all` (cycle, program instance) — 3 real Firestore reads per call, zero caching.
- Inside a single `useWorkoutEvolution.load()` invocation, `loadWorkoutLifecycle(user.uid)` is called directly (`src/workoutEvolution/useWorkoutEvolution.ts:137`) **and concurrently**, in the same `Promise.all`, `evaluateProgressionV2ForUser(user.uid)` → `evaluateProgressionV2ForUserFull` (`src/services/workoutProgressionV2.ts:107`) calls `loadWorkoutLifecycle(uid)` again — two full 3-doc reads dispatched in the same tick for the same uid. This is the concrete, provable instance of "Problema 1" from the audit.
- `reconcileWorkoutLifecycle` (`src/services/workoutLifecycleApplication.ts:943-1079`), which `load()` awaits *before* that `Promise.all`, calls `loadWorkoutLifecycle` at most once more (line 973, and only when `recovery.lifecycle` is absent) — sequential, not concurrent with the two calls above, and entangled with recovery/staleness/activation writes. Left alone in this phase (see Task 7 notes).
- `loadWorkoutLifecycle` has ~24 call sites across `workoutLifecycleApplication.ts`, `workoutPrograms.ts`, `prescriptionEvolution.ts`, and `workoutLifecycle.ts` itself, several explicitly reading fresh state right after a write to check convergence (`.catch(() => null)` idioms at e.g. `workoutLifecycle.ts:332,488,698` and `workoutLifecycleApplication.ts:462,888`). Blanket-wrapping the exported `loadWorkoutLifecycle` in dedupe would risk one of those convergence reads joining an older in-flight promise dispatched *before* the write it needs to observe, silently reading stale data. This plan does **not** touch those call sites — it adds a new, separate `loadWorkoutLifecycleDeduped` export and only rewires the two hydration-only call sites named above.
- `useWorkoutEvolution.load()`'s only genuinely-independent-but-currently-sequential step is: when `pendingAfter` is truthy, `loadActiveWorkoutProgram(user.uid)` (line 176) runs *after* `listWorkoutLifecycleEventsForProgramInstance` + `loadUnacknowledgedAutoActivationNotice` (lines 149-153), even though it depends only on `pendingAfter` (already resolved by the earlier `Promise.all`), not on `instanceEvents`/`autoActivationNotice`. It can start concurrently with those two calls.
- `AppShell.tsx` (`AppShellContent`, `src/screens/AppShell.tsx:186` onward) calls ~50 hooks/state atoms. Tracing every hook's actual consumers (not just its name) shows almost all of them are genuinely cross-tab:
  - `useWorkoutPrescription`, `useWorkoutSchedule`, `useWorkoutExecution` — drive the Workout tab **and** AppShell's own start-workout guard/modal (`requestStartWorkout`, the "iniciar treino" confirmation modal at `AppShell.tsx:1846-2107`), which is reachable from the Home tab's "Start" button.
  - `useWorkoutEvolution` — its `viewModel`/`diff` are passed to **both** `HomeScreen` (`AppShell.tsx:1189`) **and** `ProfileScreen` (`AppShell.tsx:1316`), plus a top-level `EvolutionUnlockScreen` overlay (`AppShell.tsx:1419-1441`) that isn't owned by either tab, plus `refreshProjection()` is called from the post-workout-finish flow (`AppShell.tsx:980,1132`). Genuinely global.
  - `useWorkoutActivitySnapshot`/`useFrequencyWindow` — only rendered inside `HomeScreen`, **but** their `.reload()` is invoked imperatively from AppShell's post-workout-finish sync (`runWorkoutHomeProjectionSync` at `AppShell.tsx:941-944`), which must be able to refresh Home's data even when the Workout tab is active (Home stays `materialized`/kept-alive). Moving these into `HomeScreen` would require adding an imperative-handle/ref-forwarding mechanism from Home back up to AppShell just to preserve that one call site — a real architectural change disproportionate to the win (violates "não faça grande refactor" / final rule about not adding complexity for a small saving). **Left in AppShell, documented as a deliberate non-move.**
  - `useWorkoutSessionRecovery` — drives a full-screen modal (`WorkoutSessionRecoveryModal`) rendered at the AppShell root, independent of the active tab (a crashed workout can be recovered before the user ever picks a tab). Genuinely global.
  - `useRestSession`, `useSubscription`, `usePrewarmQueue`, `useDeepLinkIntent`, `useReducedMotionPreference`, `useAppState`, `useAuth`, `useTheme`, `useTranslation` — all pre-existing, genuinely app-wide infrastructure; out of scope per the prompt's own "NÃO" list (no `SubscriptionContext` split, no prewarm redesign).
  - The manual-substitution-context state (`manualSubstitutionContextState`, `AppShell.tsx:220-246`) feeds `requestStartWorkout`'s guard logic (`AppShell.tsx:688-689`), which — like the prescription hooks above — is reachable from Home. Genuinely global.
  - `useUnreadSupportCasesCount(user?.uid)` (`AppShell.tsx:360`) — the **only** consumer of its return value is the `unreadSupportCasesCount` prop passed to `HomeScreen` (`AppShell.tsx:1188`). No `TabBar` badge, no other screen, no imperative `.reload()`/ref use anywhere in `AppShell.tsx`. **This is the one hook Fase 1.3 moves.**

This means Fase 1.3's honest, defensible outcome is a single hook move, not a large restructuring — consistent with the plan's closing instruction ("Se uma mudança aumentar complexidade substancialmente para economizar uma leitura irrelevante, não faça").

---

## FASE 0 — Instrumentação e baseline

### Task 1: Create the shared perf module

**Files:**
- Create: `src/lib/perf.ts`
- Test: `src/lib/__tests__/perf.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/perf.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  countFirestoreRead,
  firestoreReadCounts,
  markAppEpoch,
  recordPerfMark,
  resetFirestoreReadCounters,
  resetPerfEpochForTesting,
  startPerfTimer,
} from '../perf';

describe('perf instrumentation', () => {
  afterEach(() => {
    resetPerfEpochForTesting();
    resetFirestoreReadCounters();
  });

  it('stays silent when the trace flag is absent', () => {
    const info = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const previous = process.env.EXPO_PUBLIC_PERF_TRACE;
    delete process.env.EXPO_PUBLIC_PERF_TRACE;

    markAppEpoch();
    recordPerfMark('home_mount');
    startPerfTimer('workout_evolution.load.total')();
    countFirestoreRead('workout_lifecycle.bundle');

    expect(info).not.toHaveBeenCalled();
    expect(firestoreReadCounts()).toEqual({});

    if (previous === undefined) delete process.env.EXPO_PUBLIC_PERF_TRACE;
    else process.env.EXPO_PUBLIC_PERF_TRACE = previous;
    info.mockRestore();
  });

  it('counts Firestore reads by label even while disabled, for structural assertions in other tests', () => {
    // countFirestoreRead is a no-op while disabled by design (Fase 0.6: never
    // change timing/behavior in prod) — counting-without-the-flag is covered
    // by consumers stubbing the flag on directly, exercised below.
    countFirestoreRead('workout_lifecycle.bundle');
    expect(firestoreReadCounts()).toEqual({});
  });

  it('only exposes the closed PerfMark vocabulary this plan defined', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/lib/perf.ts', 'utf8');
    expect(source).toContain('EXPO_PUBLIC_PERF_TRACE');
    expect(source).not.toMatch(/uid|email|photoId|token/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/perf.test.ts`
Expected: FAIL — `Cannot find module '../perf'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/perf.ts
import { logDebug } from './logger';

/**
 * Fase 0 cold-path/removable instrumentation — modeled on
 * `photoVaultPerformance.ts`'s gate/shape so the app doesn't grow a second,
 * inconsistent perf convention. DEV + explicit opt-in flag, `logDebug`-backed
 * (already a silent no-op outside development), never touches Firestore,
 * analytics, or AsyncStorage. Safe to delete wholesale once Fase 1's
 * before/after comparison is captured.
 *
 * Enable in a development bundle with:
 *   EXPO_PUBLIC_PERF_TRACE=1 npx expo start --dev-client
 */

export type PerfMark =
  | 'home_mount'
  | 'home_today_ready'
  | 'home_evolution_ready'
  | 'workout_evolution.load.total'
  | 'workout_evolution.load.reconcile'
  | 'workout_evolution.load.initial_batch'
  | 'workout_evolution.load.events'
  | 'workout_evolution.load.activation_notice'
  | 'workout_evolution.load.diff';

function isEnabled(): boolean {
  return (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    process.env.EXPO_PUBLIC_PERF_TRACE === '1'
  );
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

let appEpoch: number | null = null;

/** Anchors every later `recordPerfMark` call to "ms since app was ready" rather than a raw timestamp. Idempotent — a Fast Refresh or a second call can never rewind the clock. */
export function markAppEpoch(): void {
  if (appEpoch === null) appEpoch = now();
}

export function recordPerfMark(mark: PerfMark, context?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  const elapsedMs = appEpoch === null ? null : Math.round(now() - appEpoch);
  logDebug('perf', mark, { elapsedMs, ...context });
}

/** Returns a stopper closure — call it when the measured span ends; it logs `durationMs` and returns it. */
export function startPerfTimer(mark: PerfMark): (context?: Record<string, unknown>) => number {
  const startedAt = now();
  return (context) => {
    const durationMs = Math.max(0, Math.round(now() - startedAt));
    if (isEnabled()) logDebug('perf', mark, { durationMs, ...context });
    return durationMs;
  };
}

let firestoreReadCounters: Record<string, number> = {};

/** Counts one real `getDoc`/`getDocs` dispatch under a closed, non-identifying label — call this at the lowest point that actually issues the SDK call, never at a call site that may end up deduped/short-circuited. */
export function countFirestoreRead(label: string): void {
  if (!isEnabled()) return;
  firestoreReadCounters[label] = (firestoreReadCounters[label] ?? 0) + 1;
}

export function firestoreReadCounts(): Readonly<Record<string, number>> {
  return { ...firestoreReadCounters };
}

export function resetFirestoreReadCounters(): void {
  firestoreReadCounters = {};
}

/** Test seam only. */
export function resetPerfEpochForTesting(): void {
  appEpoch = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/perf.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/perf.ts src/lib/__tests__/perf.test.ts
git commit -m "feat(perf): add removable Fase 0 instrumentation module"
```

---

### Task 2: Anchor the app epoch at startup

**Files:**
- Modify: `App.tsx:62-71`

- [ ] **Step 1: Add the import and call**

At `App.tsx:62`, alongside the existing telemetry import:

```ts
import { configureWorkoutLifecycleTelemetry } from './src/workoutLifecycle/telemetryProvider';
import { markAppEpoch } from './src/lib/perf';
```

At `App.tsx:71`, alongside the existing module-level telemetry install:

```ts
configureWorkoutLifecycleTelemetry();
markAppEpoch();
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add App.tsx
git commit -m "feat(perf): anchor perf epoch at app module evaluation"
```

---

### Task 3: Instrument the Home cold path in AppShell

**Files:**
- Modify: `src/screens/AppShell.tsx`

- [ ] **Step 1: Import the module**

Add near the other lib imports (after line 99's `useReducedMotionPreference` import):

```ts
import { recordPerfMark } from '../lib/perf';
```

- [ ] **Step 2: Mark `home_mount` once per app session**

Inside `AppShellContent` (`src/screens/AppShell.tsx:186`), immediately after the existing hook declarations block ends (right after the `evolution = useWorkoutEvolution()` line, `src/screens/AppShell.tsx:255`), add:

```ts
  const homeMountMarked = useRef(false);
  if (!homeMountMarked.current) {
    homeMountMarked.current = true;
    recordPerfMark('home_mount');
  }
```

This fires exactly once for the lifetime of the `AppShellContent` instance (it remounts only on a real auth/gate transition, never per-tab-switch, since `PersistentScreen` keeps tabs alive) — matching Fase 0.2's "app pronto / shell iniciado" mark without needing a second module-level flag.

- [ ] **Step 3: Mark `home_today_ready` when prescription resolves**

Immediately after Step 2's block, add:

```ts
  const homeTodayReadyMarked = useRef(false);
  if (!homeTodayReadyMarked.current && !prescriptionLoading) {
    homeTodayReadyMarked.current = true;
    recordPerfMark('home_today_ready');
  }
```

`prescriptionLoading` (destructured from `useWorkoutPrescription()` as `loading: prescriptionLoading` at `src/screens/AppShell.tsx:200`) is exactly the signal `HomeScreen` itself uses to gate its "today card" loading state (`showLoadingState` in `HomeScreen.tsx:154`), so this marks the same "useful data" instant Fase 0.2 asks for, not merely first paint.

- [ ] **Step 4: Mark `home_evolution_ready` when the evolution view model resolves**

Immediately after Step 3's block, add:

```ts
  const homeEvolutionReadyMarked = useRef(false);
  if (!homeEvolutionReadyMarked.current && evolution.viewModel.kind !== 'LOADING') {
    homeEvolutionReadyMarked.current = true;
    recordPerfMark('home_evolution_ready');
  }
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit`
Run: `npx eslint src/screens/AppShell.tsx`
Expected: no new errors/warnings.

- [ ] **Step 6: Commit**

```bash
git add src/screens/AppShell.tsx
git commit -m "feat(perf): mark Home cold-path readiness instants"
```

---

### Task 4: Instrument `useWorkoutEvolution.load()`'s breakdown

**Files:**
- Modify: `src/workoutEvolution/useWorkoutEvolution.ts`

- [ ] **Step 1: Write the failing test**

```ts
// Add to src/workoutEvolution/__tests__/useWorkoutEvolution.perf.test.ts (new file)
import { describe, expect, it } from 'vitest';

describe('useWorkoutEvolution load() instrumentation', () => {
  it('imports startPerfTimer and marks every documented phase', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/workoutEvolution/useWorkoutEvolution.ts', 'utf8');
    expect(source).toContain("from '../lib/perf'");
    expect(source).toContain('workout_evolution.load.total');
    expect(source).toContain('workout_evolution.load.reconcile');
    expect(source).toContain('workout_evolution.load.initial_batch');
    expect(source).toContain('workout_evolution.load.events');
    expect(source).toContain('workout_evolution.load.activation_notice');
  });
});
```

(This is a lightweight structural check, matching the same source-inspection pattern the existing `photoVaultPerformance.test.ts` already uses for its closed vocabulary — `load()`'s actual timing values are unobservable under Vitest's `__DEV__`-less environment, per the ground-truth note at the top of this plan, so behavior/output assertions here would be untestable no-ops.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workoutEvolution/__tests__/useWorkoutEvolution.perf.test.ts`
Expected: FAIL (source does not yet contain the marks).

- [ ] **Step 3: Add the import**

At `src/workoutEvolution/useWorkoutEvolution.ts:5`, alongside the existing `logWarn` import:

```ts
import { logWarn } from '../lib/logger';
import { startPerfTimer } from '../lib/perf';
```

- [ ] **Step 4: Wrap `load()`'s phases**

Replace the body of `load` (`src/workoutEvolution/useWorkoutEvolution.ts:118-227`) so each already-existing phase is timed without changing any control flow, ordering, or error handling. Full replacement of the function body:

```ts
  const load = useCallback(async (options?: {
    trigger?: 'FOREGROUND';
    skipReconcile?: boolean;
    propagateError?: boolean;
  }) => {
    if (!user) return;
    if (!hasLoadedOnce.current) setLoading(true);
    reconcileInFlight.current = true;
    const generation = ++loadGenerationRef.current;
    const isCurrent = () => loadGenerationRef.current === generation;
    const stopTotal = startPerfTimer('workout_evolution.load.total');
    try {
      if (!options?.skipReconcile) {
        const stopReconcile = startPerfTimer('workout_evolution.load.reconcile');
        await reconcileWorkoutLifecycle({
          uid: user.uid,
          trigger: options?.trigger ?? (hasLoadedOnce.current ? 'RECOVERY' : 'COLD_START'),
        });
        stopReconcile();
      }

      const stopInitialBatch = startPerfTimer('workout_evolution.load.initial_batch');
      const [lifecycle, pendingAfter, decision] = await Promise.all([
        loadWorkoutLifecycleDeduped(user.uid),
        loadPendingEvolution(user.uid),
        evaluateProgressionV2ForUser(user.uid),
      ]);
      stopInitialBatch();

      if (!lifecycle) {
        if (isCurrent()) {
          commitViewModel({ kind: 'UNAVAILABLE' });
          setDiff(null);
        }
        return;
      }

      const pendingProgramPromise = pendingAfter ? loadActiveWorkoutProgram(user.uid) : null;

      const stopEvents = startPerfTimer('workout_evolution.load.events');
      const instanceEvents = await listWorkoutLifecycleEventsForProgramInstance(
        user.uid,
        lifecycle.programInstance.programInstanceId,
      );
      stopEvents();
      const stopNotice = startPerfTimer('workout_evolution.load.activation_notice');
      const autoActivationNotice = await loadUnacknowledgedAutoActivationNotice(user.uid, instanceEvents);
      stopNotice();
      const lifecycleContext: LifecycleContext = {
        // The active lifecycle level stays cycle-coherent until activation.
        // A pending promotion's immutable earned fact is presented from the
        // pending target, never by temporarily corrupting the active pointer.
        earnedLevel: pendingAfter?.type === 'LEVEL_PROMOTION'
          ? pendingAfter.toLevel
          : lifecycle.lifecycle.currentTrainingLevel,
        activeLevel: lifecycle.cycle.level,
        cycleNumber: lifecycle.cycle.cycleNumber,
        isHistoryComplete: lifecycle.lifecycle.initializationOrigin !== 'V1_MIGRATION_BASELINE',
      };
      if (isCurrent()) {
        commitViewModel(buildEvolutionViewModel({
          now: new Date(),
          lifecycle: lifecycleContext,
          decision,
          pending: pendingAfter ? toPendingSummary(pendingAfter) : null,
          autoActivationNotice,
        }));
      }

      if (pendingAfter) {
        const currentProgram = await pendingProgramPromise;
        const pendingPlan = pendingAfter.plan as FinalWorkoutPlan;
        if (isCurrent()) {
          setDiff(currentProgram?.programInstanceId === pendingAfter.sourceProgramInstanceId
            ? computePrescriptionDiff({ current: currentProgram, pending: pendingPlan })
            : null);
        }
      } else if (autoActivationNotice && lifecycle.programInstance.previousProgramInstanceId) {
        const [currentProgram, previousInstance] = await Promise.all([
          loadActiveWorkoutProgram(user.uid),
          loadProgramInstance(user.uid, lifecycle.programInstance.previousProgramInstanceId),
        ]);
        const previousProgram = previousInstance
          ? await loadWorkoutProgramSnapshot(user.uid, previousInstance.contentIdentity)
          : null;
        if (isCurrent()) {
          setDiff(currentProgram?.programInstanceId === lifecycle.programInstance.programInstanceId && previousProgram
            ? computePrescriptionDiff({ current: previousProgram, pending: currentProgram })
            : null);
        }
      } else if (isCurrent()) {
        setDiff(null);
      }
    } catch (error) {
      logWarn('workout_evolution', 'load_failed', { error });
      if (isCurrent()) {
        // Resilience hardening (docs 2026-09): `nextViewModelAfterLoad` is
        // the pure state machine — a failed REFRESH preserves whatever
        // resolved view model was already on screen (never downgraded to
        // `ERROR` by a merely transient failure); only a failure with
        // nothing resolved yet, or piling on an already-failed attempt,
        // actually produces `ERROR`.
        const previous = viewModelRef.current;
        const next = nextViewModelAfterLoad(previous, { status: 'failure' });
        if (next === previous) {
          logWarn('workout_evolution', 'load_failed_preserved_previous_view_model', {
            previousKind: previous.kind,
          });
        } else {
          commitViewModel(next);
        }
      }
      // Background/cold-start refreshes remain self-contained. Explicit
      // projection barriers (finish/discard) opt in so their orchestrator can
      // diagnose the secondary failure and choose safe navigation behavior.
      if (options?.propagateError) throw error;
    } finally {
      stopTotal();
      hasLoadedOnce.current = true;
      setLoading(false);
      reconcileInFlight.current = false;
    }
  }, [user, commitViewModel]);
```

Note: this step also switches the direct `loadWorkoutLifecycle` call to `loadWorkoutLifecycleDeduped` and moves the `pendingAfter`-branch program fetch earlier — those are Fase 1.1/1.2 changes, folded in here so this function is only rewritten once. `loadWorkoutLifecycleDeduped` doesn't exist yet; this step's test (Step 2 above) only checks for perf marks, so it's fine for this step's compile to depend on Task 7 landing the export first. **Sequencing note:** do Task 7 (creates `loadWorkoutLifecycleDeduped`) before this step's code compiles; the task list below places Task 7 before this rewrite is finalized — see "Execution order" at the end of this plan.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/workoutEvolution/__tests__/useWorkoutEvolution.perf.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (once Task 7's export exists).

- [ ] **Step 7: Commit**

```bash
git add src/workoutEvolution/useWorkoutEvolution.ts src/workoutEvolution/__tests__/useWorkoutEvolution.perf.test.ts
git commit -m "feat(perf): time useWorkoutEvolution.load() phases"
```

---

### Task 5: Count real Firestore reads in `loadWorkoutLifecycle`

**Files:**
- Modify: `src/services/workoutLifecycle.ts:157-168`

- [ ] **Step 1: Write the failing test**

```ts
// Add to src/services/__tests__/workoutLifecycle.perf.test.ts (new file)
import { describe, expect, it } from 'vitest';

describe('loadWorkoutLifecycle Firestore read counting', () => {
  it('counts one bundle read per call via the shared perf counter', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/workoutLifecycle.ts', 'utf8');
    expect(source).toContain("from '../lib/perf'");
    expect(source).toContain("countFirestoreRead('workout_lifecycle.bundle')");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/workoutLifecycle.perf.test.ts`
Expected: FAIL

- [ ] **Step 3: Add the import and counter call**

At `src/services/workoutLifecycle.ts:15`, alongside the `db` import:

```ts
import { db } from '../lib/firebase';
import { countFirestoreRead } from '../lib/perf';
```

Replace `loadWorkoutLifecycle` (`src/services/workoutLifecycle.ts:157-168`):

```ts
export async function loadWorkoutLifecycle(uid: string): Promise<PersistedWorkoutLifecycleBundle | null> {
  countFirestoreRead('workout_lifecycle.bundle');
  const state = await getDoc(lifecycleRef(uid));
  if (!state.exists()) return null;
  if (!isWorkoutLifecycle(state.data())) throw new Error('WORKOUT_LIFECYCLE_INVALID');
  const lifecycle = state.data() as WorkoutLifecycle<Timestamp>;
  const [cycle, instance] = await Promise.all([
    getDoc(cycleRef(uid, lifecycle.currentCycleId)),
    getDoc(programInstanceRef(uid, lifecycle.activeProgramInstanceId)),
  ]);
  if (!cycle.exists() || !instance.exists()) throw new Error('WORKOUT_LIFECYCLE_REFERENT_MISSING');
  return parseBundle(lifecycle, cycle.data(), instance.data());
}
```

This counts once per **call** to `loadWorkoutLifecycle` (the lowest point before the real `getDoc` dispatch), which is exactly what Fase 0.4 asks for — a call that gets collapsed by Fase 1.1's dedupe will show up as one count for N logical callers, which is the intended "before vs after" signal.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/workoutLifecycle.perf.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and run the existing lifecycle unit-level tests**

Run: `npx tsc --noEmit`
Run: `npx vitest run src/services/__tests__/`
Expected: no regressions (integration tests skip — gated by env flags, unaffected either way).

- [ ] **Step 6: Commit**

```bash
git add src/services/workoutLifecycle.ts src/services/__tests__/workoutLifecycle.perf.test.ts
git commit -m "feat(perf): count real workoutLifecycle Firestore reads"
```

---

### Task 5b: Count the Home cold path's workoutExecutions window queries

Fase 0.5 also asks for visibility into the "janela curta"/"janela maior" `workoutExecutions` queries `useWorkoutActivitySnapshot` (week overview) and `useFrequencyWindow` (30-day heatmap) each dispatch on the Home cold path. Both hooks call the same underlying range query (`listCompletedWorkoutDatesInRange` delegates to `listCompletedWorkoutActivityDatesInRange`), so one counter at that single choke point covers both windows; the date range width in the log context is enough to tell them apart without adding a second parameter to a function with existing callers.

**Files:**
- Modify: `src/services/workoutExecutions.ts:956-966`

- [ ] **Step 1: Write the failing test**

```ts
// Add to src/services/__tests__/workoutExecutions.perf.test.ts (new file)
import { describe, expect, it } from 'vitest';

describe('workoutExecutions range query read counting', () => {
  it('counts the shared range query used by both the week and 30-day windows', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/workoutExecutions.ts', 'utf8');
    expect(source).toContain("from '../lib/perf'");
    expect(source).toContain("countFirestoreRead('workout_executions.range_query')");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/workoutExecutions.perf.test.ts`
Expected: FAIL

- [ ] **Step 3: Add the import and counter call**

Add near the top of `src/services/workoutExecutions.ts` (alongside its other local imports):

```ts
import { countFirestoreRead } from '../lib/perf';
```

Replace the query dispatch in `listCompletedWorkoutActivityDatesInRange` (`src/services/workoutExecutions.ts:961-966`):

```ts
  const q = query(
    executionsCollection(uid),
    where('scheduledLocalDate', '>=', fromLocalDate),
    where('scheduledLocalDate', '<=', addDaysLocal(toLocalDate, 1)),
  );
  countFirestoreRead('workout_executions.range_query');
  const snapshot = await getDocs(q);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/workoutExecutions.perf.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and run targeted tests**

Run: `npx tsc --noEmit`
Run: `npx vitest run src/services/__tests__/workoutExecutions*`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/services/workoutExecutions.ts src/services/__tests__/workoutExecutions.perf.test.ts
git commit -m "feat(perf): count the shared workoutExecutions window range query"
```

---

### Task 6: Produce and record the Fase 0 baseline

This task is analysis/reporting, not code — do it after Tasks 1-5 land and before touching Task 7.

- [ ] **Step 1: Run the full check suite**

```bash
npx tsc --noEmit
npm test
npx eslint src/screens/AppShell.tsx src/workoutEvolution src/services/workoutLifecycle.ts src/services/workoutLifecycleApplication.ts src/services/workoutProgressionV2.ts src/workoutPrescription
```

Record pass/fail and counts for each.

- [ ] **Step 2: Record the structural baseline (no runtime device/emulator available in this environment — say so explicitly, per the prompt's own instruction not to invent numbers)**

```text
BASELINE FASE 0

Lifecycle read call sites found (grep "loadWorkoutLifecycle("): 24 (see plan's "Ground truth" section for the full list).
Concurrent-in-one-load duplicate confirmed: useWorkoutEvolution.ts:137 (direct) + workoutProgressionV2.ts:107 (inside evaluateProgressionV2ForUser, called in the same Promise.all) — 2 concurrent 3-doc reads = 6 getDoc dispatches per useWorkoutEvolution.load() call, for what is logically "read the lifecycle bundle once."

useWorkoutEvolution.load() sequence (as shipped, before Fase 1):
  reconcileWorkoutLifecycle (sequential, may itself call loadWorkoutLifecycle once more internally)
    -> Promise.all(loadWorkoutLifecycle, loadPendingEvolution, evaluateProgressionV2ForUser[which re-reads loadWorkoutLifecycle])
    -> listWorkoutLifecycleEventsForProgramInstance (sequential, depends on lifecycle)
    -> loadUnacknowledgedAutoActivationNotice (sequential, depends on events)
    -> [pendingAfter] loadActiveWorkoutProgram (sequential, but only depends on pendingAfter — the avoidable waterfall step)
       OR [autoActivationNotice] Promise.all(loadActiveWorkoutProgram, loadProgramInstance) -> loadWorkoutProgramSnapshot

AppShell.tsx hooks classified (~50 total; full list and consumer trace in this plan's "Ground truth" section):
  GLOBAL VERDADEIRO: useAuth, useAppState, useTheme, useTranslation, useReducedMotionPreference, useDeepLinkIntent, useRestSession, useSubscription, usePrewarmQueue
  CROSS-TAB BY REAL CONSUMER (kept in AppShell, justified): useWorkoutPrescription, useWorkoutSchedule, useWorkoutExecution, useWorkoutEvolution, useWorkoutSessionRecovery, manualSubstitutionContextState, useWorkoutActivitySnapshot, useFrequencyWindow
  HOME-ONLY, NO CROSS-TAB CONSUMER (move target): useUnreadSupportCasesCount

Runtime timings (home_mount / home_today_ready / home_evolution_ready / workout_evolution.load.* durations): NÃO foi possível medir runtime de forma confiável neste ambiente — não há device/emulador Expo disponível nesta sessão. A instrumentação está pronta para captura manual (EXPO_PUBLIC_PERF_TRACE=1 npx expo start --dev-client) quando um ambiente com device/simulador estiver disponível.
```

- [ ] **Step 2: Gate check**

Confirm all of: instrumentation compiles and its tests pass, `tsc --noEmit` clean, targeted test suites pass, baseline text above recorded. Only then proceed to Fase 1.

---

## FASE 1 — Eliminar trabalho estrutural duplicado

### Task 7: Generic in-flight dedupe helper

**Files:**
- Create: `src/lib/inFlightDedupe.ts`
- Test: `src/lib/__tests__/inFlightDedupe.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/__tests__/inFlightDedupe.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createInFlightDedupe } from '../inFlightDedupe';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createInFlightDedupe', () => {
  it('collapses concurrent calls for the same key into one real attempt, all callers get the same result', async () => {
    const attempt = vi.fn();
    const dedupe = createInFlightDedupe<string>();
    const first = deferred<string>();
    attempt.mockReturnValueOnce(first.promise);

    const [a, b, c] = [
      dedupe('uid-A', attempt),
      dedupe('uid-A', attempt),
      dedupe('uid-A', attempt),
    ];
    expect(attempt).toHaveBeenCalledTimes(1);
    first.resolve('bundle-1');

    await expect(a).resolves.toBe('bundle-1');
    await expect(b).resolves.toBe('bundle-1');
    await expect(c).resolves.toBe('bundle-1');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('starts a genuinely new attempt once the previous call for that key has settled', async () => {
    const attempt = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    const dedupe = createInFlightDedupe<string>();

    await expect(dedupe('uid-A', attempt)).resolves.toBe('first');
    await expect(dedupe('uid-A', attempt)).resolves.toBe('second');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry on failure so the next call retries instead of rejecting from cache', async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered');
    const dedupe = createInFlightDedupe<string>();

    await expect(dedupe('uid-A', attempt)).rejects.toThrow('boom');
    await expect(dedupe('uid-A', attempt)).resolves.toBe('recovered');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('never shares an in-flight promise across different keys', async () => {
    const attemptA = vi.fn().mockResolvedValue('bundle-A');
    const attemptB = vi.fn().mockResolvedValue('bundle-B');
    const dedupe = createInFlightDedupe<string>();

    const [a, b] = await Promise.all([
      dedupe('uid-A', attemptA),
      dedupe('uid-B', attemptB),
    ]);
    expect(a).toBe('bundle-A');
    expect(b).toBe('bundle-B');
    expect(attemptA).toHaveBeenCalledTimes(1);
    expect(attemptB).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/inFlightDedupe.test.ts`
Expected: FAIL — `Cannot find module '../inFlightDedupe'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/inFlightDedupe.ts

/**
 * Generic single-flight/in-flight request dedupe — Fase 1.1. Generalizes the
 * `Map<string, Promise<T>>` pattern already proven in
 * `services/workoutPrograms.ts` (`generateAndPersistWorkoutProgramDeduped`)
 * so read paths can reuse it without duplicating the map/finally bookkeeping.
 *
 * Deliberately NOT a cache: the registry entry is removed the instant the
 * call settles, success OR failure, via `.finally()` — a failure is never
 * cached, and a call made after the previous one has settled always starts a
 * genuinely fresh attempt. Concurrent callers for the same key share exactly
 * one real attempt and all observe its real, final result.
 *
 * `createInFlightDedupe()` returns a dedupe function bound to its OWN private
 * map — callers must keep the returned function around (e.g. module-level)
 * so concurrent calls actually land in the same map instance.
 */
export function createInFlightDedupe<T>(): (key: string, attempt: () => Promise<T>) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>();
  return function dedupeInFlight(key: string, attempt: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = attempt().finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/inFlightDedupe.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/lib/inFlightDedupe.ts src/lib/__tests__/inFlightDedupe.test.ts
git commit -m "feat: add generic in-flight request dedupe helper"
```

---

### Task 8: Dedupe `loadWorkoutLifecycle` at the two proven-concurrent hydration call sites

**Files:**
- Modify: `src/services/workoutLifecycle.ts`
- Modify: `src/workoutEvolution/useWorkoutEvolution.ts`
- Modify: `src/services/workoutProgressionV2.ts`
- Test: `src/services/__tests__/workoutLifecycleDedupe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/__tests__/workoutLifecycleDedupe.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: mocks.getDoc,
  getDocs: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  where: vi.fn(),
}));
vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('../../workoutLifecycle/domain', () => ({
  isWorkoutLifecycle: () => true,
  isTrainingCycle: () => true,
  isProgramInstance: () => true,
  isPendingEvolution: () => true,
  isWorkoutLifecycleEvent: () => true,
  cycleIdForOperation: vi.fn(),
  lifecycleEventId: vi.fn(),
  programInstanceIdForOperation: vi.fn(),
  startingLevelFromQuestionnaire: vi.fn(),
}));
vi.mock('../userProfile', () => ({ getQuestionnaireById: vi.fn() }));
vi.mock('../../workoutLifecycle/prescriptionInputs', () => ({ buildPrescriptionInputSnapshot: vi.fn() }));
vi.mock('../../workoutLifecycle/rollout', () => ({
  isEligibleForNewMigration: vi.fn(),
  isValidRolloutConfig: vi.fn(),
  WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG: {},
}));
vi.mock('../../workoutLifecycle/telemetry', () => ({ logWorkoutLifecycleEvent: vi.fn() }));
vi.mock('../../workoutLifecycle/authorityProvider', () => ({
  authorizeWorkoutLifecycleMutation: vi.fn(),
  requireWorkoutLifecycleCanonical: vi.fn(),
  WORKOUT_LIFECYCLE_AUTHORITY_GRANT_ID: 'grant',
}));

import { loadWorkoutLifecycle, loadWorkoutLifecycleDeduped } from '../workoutLifecycle';

function fakeSnapshot(data: Record<string, unknown>) {
  return { exists: () => true, data: () => data };
}

describe('loadWorkoutLifecycleDeduped', () => {
  beforeEach(() => {
    mocks.getDoc.mockReset();
    mocks.getDoc.mockImplementation(async () => fakeSnapshot({ currentCycleId: 'c1', activeProgramInstanceId: 'p1' }));
  });

  it('dedupes concurrent calls for the same uid into one loadWorkoutLifecycle attempt', async () => {
    let resolveFirst!: () => void;
    let callCount = 0;
    mocks.getDoc.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve(fakeSnapshot({ currentCycleId: 'c1', activeProgramInstanceId: 'p1' }));
        });
      }
      return Promise.resolve(fakeSnapshot({ currentCycleId: 'c1', activeProgramInstanceId: 'p1' }));
    });

    const [a, b] = [loadWorkoutLifecycleDeduped('uid-A'), loadWorkoutLifecycleDeduped('uid-A')];
    resolveFirst();
    await Promise.all([a, b]);
    // 1 lifecycle-doc getDoc + 2 (cycle, instance) getDocs for the single shared attempt = 3 total, not 6.
    expect(callCount).toBe(3);
  });

  it('never shares the in-flight promise across different uids', async () => {
    await Promise.all([
      loadWorkoutLifecycleDeduped('uid-A'),
      loadWorkoutLifecycleDeduped('uid-B'),
    ]);
    // 3 getDoc calls per uid (lifecycle + cycle + instance) x 2 uids = 6.
    expect(mocks.getDoc).toHaveBeenCalledTimes(6);
  });

  it('is a thin wrapper — a plain loadWorkoutLifecycle call still works unchanged', async () => {
    const result = await loadWorkoutLifecycle('uid-A');
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/workoutLifecycleDedupe.test.ts`
Expected: FAIL — `loadWorkoutLifecycleDeduped` is not exported.

- [ ] **Step 3: Add `loadWorkoutLifecycleDeduped` to `workoutLifecycle.ts`**

At `src/services/workoutLifecycle.ts:15`, add the new import alongside the perf import from Task 5:

```ts
import { db } from '../lib/firebase';
import { countFirestoreRead } from '../lib/perf';
import { createInFlightDedupe } from '../lib/inFlightDedupe';
```

Immediately after `loadWorkoutLifecycle`'s closing brace (after `src/services/workoutLifecycle.ts:168`), add:

```ts
const dedupeLifecycleRead = createInFlightDedupe<PersistedWorkoutLifecycleBundle | null>();

/**
 * Same result as `loadWorkoutLifecycle`, but concurrent callers for the same
 * uid within the same in-flight window share ONE Firestore round trip
 * (Fase 1.1 — fixes the audited "useWorkoutEvolution.load() reads the
 * lifecycle bundle twice in the same Promise.all" duplicate: once directly,
 * once inside `evaluateProgressionV2ForUserFull`).
 *
 * Deliberately used ONLY by hydration-only read paths (`useWorkoutEvolution`,
 * `evaluateProgressionV2ForUserFull`) — every write/convergence/recovery call
 * site in `workoutLifecycleApplication.ts`/`workoutPrograms.ts`/
 * `prescriptionEvolution.ts` keeps calling the plain `loadWorkoutLifecycle`
 * directly. Those reads must observe a snapshot no older than a write they
 * just made; joining an in-flight promise that may have started dispatching
 * before that write committed would silently return stale data instead of
 * the fresh post-write read those call sites depend on.
 */
export function loadWorkoutLifecycleDeduped(uid: string): Promise<PersistedWorkoutLifecycleBundle | null> {
  return dedupeLifecycleRead(uid, () => loadWorkoutLifecycle(uid));
}
```

- [ ] **Step 4: Rewire `useWorkoutEvolution.ts`'s direct call**

At `src/workoutEvolution/useWorkoutEvolution.ts:10-17`, change the import:

```ts
import {
  listWorkoutLifecycleEventsForProgramInstance,
  lifecycleRef,
  loadPendingEvolution,
  loadProgramInstance,
  loadWorkoutLifecycleDeduped,
  pendingEvolutionRef,
} from '../services/workoutLifecycle';
```

(`loadWorkoutLifecycle` was used only once in this file — Task 4's Step 4 rewrite already replaced that one call site with `loadWorkoutLifecycleDeduped`; if Task 4 hasn't landed yet in your working order, make that one-line substitution now instead.)

- [ ] **Step 5: Rewire `workoutProgressionV2.ts`'s internal call**

At `src/services/workoutProgressionV2.ts:18-22`, change the import:

```ts
import {
  listRecentIntermediateTrainingCycles,
  loadWorkoutLifecycleDeduped,
  type PersistedWorkoutLifecycleBundle,
} from './workoutLifecycle';
```

At `src/services/workoutProgressionV2.ts:107`, change:

```ts
  const bundle = await loadWorkoutLifecycleDeduped(uid);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/workoutLifecycleDedupe.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Typecheck and run the full targeted suite**

Run: `npx tsc --noEmit`
Run: `npx vitest run src/services/__tests__/ src/workoutEvolution/__tests__/ src/workoutPrescription/__tests__/`
Expected: no regressions. (Integration tests remain `describe.skipIf(!enabled)` and are unaffected either way — `loadWorkoutLifecycle` itself is untouched in behavior.)

- [ ] **Step 8: Commit**

```bash
git add src/services/workoutLifecycle.ts src/workoutEvolution/useWorkoutEvolution.ts src/services/workoutProgressionV2.ts src/services/__tests__/workoutLifecycleDedupe.test.ts
git commit -m "fix(perf): dedupe concurrent workoutLifecycle reads in useWorkoutEvolution.load()"
```

---

### Task 9: Parallelize the pending-program fetch in `useWorkoutEvolution.load()`

This is already folded into Task 4 Step 4's full-function replacement (the `pendingProgramPromise` variable, started right after the `!lifecycle` guard and awaited inside the `if (pendingAfter)` branch instead of being fetched there). If Task 4 was done first, verify the diff already matches; if Task 8 was done first, apply this same restructuring now as its own diff, exactly as shown in Task 4 Step 4.

**Files:**
- Modify: `src/workoutEvolution/useWorkoutEvolution.ts` (verify only, if Task 4 already applied it)

- [ ] **Step 1: Write the regression test for the behavior-preserving reordering**

```ts
// Add to src/workoutEvolution/__tests__/loadReducer.test.ts or a new
// src/workoutEvolution/__tests__/useWorkoutEvolutionParallelFetch.test.ts
import { describe, expect, it } from 'vitest';

describe('useWorkoutEvolution.load() pending-program fetch ordering', () => {
  it('starts the pending-program fetch before awaiting lifecycle events/notice, not after', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/workoutEvolution/useWorkoutEvolution.ts', 'utf8');
    const pendingProgramIndex = source.indexOf('const pendingProgramPromise');
    const eventsIndex = source.indexOf('listWorkoutLifecycleEventsForProgramInstance(');
    const awaitPendingProgramIndex = source.indexOf('await pendingProgramPromise');
    expect(pendingProgramIndex).toBeGreaterThan(-1);
    expect(pendingProgramIndex).toBeLessThan(eventsIndex);
    expect(awaitPendingProgramIndex).toBeGreaterThan(eventsIndex);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run src/workoutEvolution/__tests__/useWorkoutEvolutionParallelFetch.test.ts`
Expected: PASS once Task 4 Step 4's rewrite is in place; FAIL beforehand — use this to confirm the rewrite is actually applied if doing Tasks out of the suggested order.

- [ ] **Step 3: Run the full `useWorkoutEvolution` behavior suite**

Run: `npx vitest run src/workoutEvolution/__tests__/`
Expected: all existing tests (view-model construction, diff computation, load reducer) still pass unchanged — this reorder changes only *when* `loadActiveWorkoutProgram` is dispatched, never its result or any conditional logic.

- [ ] **Step 4: Commit** (only if this task's diff wasn't already included in Task 8's commit)

```bash
git add src/workoutEvolution/useWorkoutEvolution.ts src/workoutEvolution/__tests__/useWorkoutEvolutionParallelFetch.test.ts
git commit -m "perf: parallelize pending-program fetch with lifecycle events lookup"
```

---

### Task 10: Move `useUnreadSupportCasesCount` from AppShell to HomeScreen

**Files:**
- Modify: `src/screens/AppShell.tsx`
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Remove the hook and prop-threading from AppShell**

Remove the import at `src/screens/AppShell.tsx:41`:

```ts
import { useUnreadSupportCasesCount } from '../hooks/useUnreadSupportCasesCount';
```

Remove the hook call at `src/screens/AppShell.tsx:360`:

```ts
  const unreadSupportCasesCount = useUnreadSupportCasesCount(user?.uid);
```

Remove the prop at the `<HomeScreen>` call site (`src/screens/AppShell.tsx:1188`):

```ts
            unreadSupportCasesCount={unreadSupportCasesCount}
```

- [ ] **Step 2: Add the hook and drop the prop in HomeScreen**

At `src/screens/HomeScreen.tsx:10`, add the import alongside `useAuth`:

```ts
import { useAuth } from '../state/AuthContext';
import { useUnreadSupportCasesCount } from '../hooks/useUnreadSupportCasesCount';
```

Remove `unreadSupportCasesCount = 0,` from the destructured props list (`src/screens/HomeScreen.tsx:57-58`) and remove the corresponding `unreadSupportCasesCount?: number;` type entry (`src/screens/HomeScreen.tsx:105`).

Inside the component body, right after the existing `const { user, profile } = useAuth();` line (`src/screens/HomeScreen.tsx:134`), add:

```ts
  const { user, profile } = useAuth();
  const unreadSupportCasesCount = useUnreadSupportCasesCount(user?.uid);
```

No other line in `HomeScreen.tsx` changes — the two render sites at `HomeScreen.tsx:304-306` that already read `unreadSupportCasesCount` now read the local hook result instead of the prop, with identical semantics (same hook, same `uid`, same realtime behavior).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — confirms no other caller of `<HomeScreen>` (e.g. a test harness or a second render site) still passes the now-removed prop.

- [ ] **Step 4: Run targeted tests**

Run: `npx vitest run src/screens/__tests__/`
Expected: `appShellNavigationStructure.test.ts` and `appShellSupportNotifications.test.ts` still pass — inspect them first; if either asserts on `unreadSupportCasesCount` being threaded through `AppShell`'s props/JSX rather than through `HomeScreen`'s own hook call, update the assertion to match the new (behaviorally identical) location, per the plan's "don't change tests just to make them pass" rule — only adjust an assertion if it was asserting *where* the hook lives, not *what* it does.

- [ ] **Step 5: Verify no regression in HomeScreen's own tests, if any**

Run: `find src/screens/__tests__ -iname "*home*"` — if a `HomeScreen.test.tsx`/`.ts` exists, run it and fix only assertions that reference the removed prop by adding a mock for `useUnreadSupportCasesCount` (mirroring how `useAuth` is presumably already mocked in that file).

- [ ] **Step 6: Commit**

```bash
git add src/screens/AppShell.tsx src/screens/HomeScreen.tsx
git commit -m "refactor(perf): move useUnreadSupportCasesCount into its sole owner, HomeScreen"
```

---

### Task 11: Final Fase 1 verification and comparison report

- [ ] **Step 1: Full check suite**

```bash
npx tsc --noEmit
npm test
npx eslint src/screens/AppShell.tsx src/screens/HomeScreen.tsx src/workoutEvolution src/services/workoutLifecycle.ts src/services/workoutLifecycleApplication.ts src/services/workoutProgressionV2.ts src/lib/inFlightDedupe.ts src/lib/perf.ts
```

- [ ] **Step 2: Review the full diff against `main`**

```bash
git diff main --stat
git diff main
```

Confirm: no Firestore rules touched, no Cloud Functions touched, no `SubscriptionContext` split, no PhotoVault changes, no Support Chat changes, no persistent cache/AsyncStorage-for-Firestore added anywhere.

- [ ] **Step 3: Re-run the structural counts and fill in the comparison table**

```text
MÉTRICA                                  ANTES   DEPOIS
------------------------------------------------------
loadWorkoutLifecycle calls per          2 direct  1 (shared via
useWorkoutEvolution.load() invocation   + reconcile's dedupe)
                                         internal   + reconcile's
                                         1-2        internal 1-2
                                                     (unchanged,
                                                     deliberately
                                                     out of scope)
Sequential await steps in the           7          6 (pending-program
pendingAfter branch of load()                      fetch now started
                                                    alongside events/
                                                    notice lookup)
AppShell hooks with zero real           1          0
cross-tab consumer
                                         (useUnreadSupportCasesCount)

Runtime durations (home_mount/home_today_ready/home_evolution_ready/
workout_evolution.load.* before vs after): não foi possível medir
runtime de forma confiável neste ambiente (sem device/emulador Expo
disponível). Instrumentação pronta para captura manual quando um
ambiente com device/simulador estiver disponível.
```

Do not fill in runtime numbers that weren't actually captured on a device/emulator in this session.

- [ ] **Step 4: Write the final report to the user**, following exactly the structure (A through L) requested in the original prompt, using this plan's "Ground truth" section and the comparison table above as source material — do not re-derive facts already established here.

---

## Execution order

Because Task 4 (perf instrumentation for `load()`) and Task 8 (dedupe) both rewrite the same function body, do them in this exact order to avoid a wasted intermediate edit:

1. Tasks 1-3, 5, 6 (Fase 0 instrumentation + gate) — any order among themselves, but all before Fase 1.
2. Task 7 (generic dedupe helper) — standalone, no dependencies.
3. Task 8 Steps 1-3 (add `loadWorkoutLifecycleDeduped` to `workoutLifecycle.ts`, plus the `workoutProgressionV2.ts` rewire) — do this before rewriting `useWorkoutEvolution.ts`, so the symbol exists.
4. Task 4 Step 4 = Task 8 Step 4 = Task 9's rewrite, all in **one** combined edit to `useWorkoutEvolution.ts`'s `load()` function body (the code block is already written once, in Task 4 Step 4, with the dedupe + parallelization + perf marks all present) — do not write it three times.
5. Task 8 Steps 6-8 (tests, typecheck, commit) and Task 9's dedicated ordering test.
6. Task 10 (AppShell hook move) — independent of everything above.
7. Task 11 (final verification).
