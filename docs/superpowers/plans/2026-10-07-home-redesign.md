# Home Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the new poster/HUD visual design to the Home screen and its evolution flow (preview sheet, celebration animation, new-workout reveal) without changing any hook, store, service, Firestore rule, domain type, or navigation behavior.

**Architecture:** Three layers, built bottom-up. (1) A small set of additive, read-only data exposures ("repasse") that surface values the engine already computes but currently drops before reaching the UI — zero new business rules. (2) New Home-only visual components (the existing `EvolutionTicker`/`WeeklyOverview` are shared with the in-progress `TreinoScreen.tsx`, so they are never edited — a new ticker is built instead). (3) A restyle of `HomeScreen.tsx` and `EvolutionUnlockScreen.tsx` in place, plus two new screens (celebration, new-workout reveal) orchestrated from `AppShell.tsx`.

**Tech Stack:** React Native + Expo SDK 56, `react-native-svg`, `expo-linear-gradient`, `react-native-reanimated` v4 (already installed), `expo-haptics` (new dependency), existing theme tokens (`src/theme/tokens.ts`), existing i18n (`react-i18next`, namespaces `home`/`evolution`).

**Context this plan assumes you've read:** `docs/superpowers/specs/2026-10-07-home-redesign-design.md` (the data-mapping spec) and the full visual spec in the originating conversation (section 1 tokens, section 2 Home structure, section 3 preview sheet, section 4 celebration, section 5 new-workout screen, section 6 reference prototype). This plan does not repeat the visual spec's exact pixel values — follow section 6's reference code for every style value not explicitly written out below.

---

## Phase 1 — Data exposure (repasse, no new rules)

### Task 1: Add new design tokens

**Files:**
- Modify: `src/theme/tokens.ts`

- [ ] **Step 1: Add the three missing palette primitives**

In `src/theme/tokens.ts`, inside the `palette` object (after `blue400: '#7db4ff',`), add:

```ts
  blue300: '#9fd6ff',
  amber500: '#f2c063',
  ink875: '#09071f',
```

- [ ] **Step 2: Do NOT add these to `semanticDarkColors`/`colors`**

`src/theme/lightTokens.ts:216` defines `lightColors` with
`} as const satisfies { readonly [Key in keyof typeof colors]: string };` — a structural
mirror contract requiring every key added to `semanticDarkColors` (which `colors` is built
from) to also get a light-mode value in `lightTokens.ts`. The whole Home redesign (sections
1-6 of the design spec) is explicitly, exclusively dark/poster-styled — no light-mode
variant is ever described — matching the existing precedent in `HomeScreen.tsx`
(`TODAY_WORKOUT_THEME = darkTheme`, with its own comment: "the Today Workout poster keeps
the official Dark art direction in both app themes"). So these 3 new colors stay as plain
`palette` primitives only (Step 1) — never promoted into the dynamic `colors`/`theme.colors`
mirror. Any component that needs them imports `palette` directly:

```ts
import { palette } from '../../theme/tokens';
// palette.amber500, palette.blue300, palette.ink875
```

(This also means Task 12's `CycleProgressBlock` must reference `palette.amber500` directly
for the paused-ring/below-70%-adherence color, never a `theme.colors.*` alias — see Task 12's
code below, which already imports `palette` for this reason.)

- [ ] **Step 3: Verify the app still builds**

Run: `npx tsc --noEmit`
Expected: no new errors (the palette object itself isn't part of any light/dark structural mirror — only `semanticDarkColors`/`colors` is).

- [ ] **Step 4: Commit**

```bash
git add src/theme/tokens.ts
git commit -m "Adiciona tokens de cor do redesign da Home (amber, azul claro, fundo de sheet)"
```

---

### Task 2: Pure ring-metrics helper (duplicated constant lookup, not a new rule)

Why this file exists instead of exporting `minimumActiveDaysForLevel` from `progressionEngineV2/resolver.ts`: rule 2 forbids editing any file under `progressionEngineV2/`, including adding an `export` keyword to that private function. `PROGRESSION_V2_CONFIG` itself is already exported from `progressionEngineV2/config.ts`, so this file only **imports and reads** it — it duplicates the exact same one-line mapping the engine itself uses, it does not invent a new rule.

**Files:**
- Create: `src/home/evoRingMetrics.ts`
- Test: `src/home/__tests__/evoRingMetrics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { requiredActiveDaysForLevel, INTERMEDIATE_CYCLES_FOR_ADVANCED } from '../evoRingMetrics';

describe('requiredActiveDaysForLevel', () => {
  it('returns the beginner minimum for BEGINNER', () => {
    expect(requiredActiveDaysForLevel('BEGINNER')).toBe(28);
  });
  it('returns the intermediate/advanced minimum for INTERMEDIATE and ADVANCED', () => {
    expect(requiredActiveDaysForLevel('INTERMEDIATE')).toBe(85);
    expect(requiredActiveDaysForLevel('ADVANCED')).toBe(85);
  });
});

describe('INTERMEDIATE_CYCLES_FOR_ADVANCED', () => {
  it('matches the engine config constant', () => {
    expect(INTERMEDIATE_CYCLES_FOR_ADVANCED).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/home/__tests__/evoRingMetrics.test.ts`
Expected: FAIL — `Cannot find module '../evoRingMetrics'`

- [ ] **Step 3: Write the implementation**

```ts
import { PROGRESSION_V2_CONFIG } from '../progressionEngineV2/config';
import type { CurrentTrainingLevel } from '../workoutLifecycle/types';

/**
 * Same mapping `progressionEngineV2/resolver.ts`'s private
 * `minimumActiveDaysForLevel` uses, duplicated here (not imported — that
 * function isn't exported, and this file must never edit anything under
 * `progressionEngineV2/`) purely so the Home ring can show the real
 * denominator ("X of Y active days") without recomputing a new rule.
 */
export function requiredActiveDaysForLevel(level: CurrentTrainingLevel): number {
  return level === 'BEGINNER'
    ? PROGRESSION_V2_CONFIG.beginnerMinimumActiveDays
    : PROGRESSION_V2_CONFIG.intermediateAdvancedMinimumActiveDays;
}

/** Same cap the engine uses for Intermediate → Advanced ("Rumo ao Avançado X/4"). */
export const INTERMEDIATE_CYCLES_FOR_ADVANCED = PROGRESSION_V2_CONFIG.intermediateCyclesForPromotion;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/home/__tests__/evoRingMetrics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/home/evoRingMetrics.ts src/home/__tests__/evoRingMetrics.test.ts
git commit -m "Adiciona helper puro de metricas do anel de ciclo (dias necessarios, teto de ciclos)"
```

---

### Task 3: New Home-only streak hook

Why a new fetch is needed: `AppShell.tsx` already documents (comment near `useWidgetSnapshotSync`, line ~347-350) that Home's already-loaded state ("sua frequência"'s 30-day window, "esta semana") is **not** sufficient to compute a real streak — only the widget sync owns a bounded, incremental completion read for that purpose. The user confirmed (recommended option) to add a dedicated new read for Home, reusing the exact same already-exported pure/service functions the widget uses (`fetchWidgetStreakHistory`, `listCompletedWorkoutActivityDatesInRange`) — no new business logic, one additional Firestore read per Home load.

**Files:**
- Create: `src/home/useHomeStreak.ts`

- [ ] **Step 1: Write the implementation**

(This hook has no pure logic of its own to unit test — it is a thin composition of two already-tested functions (`fetchWidgetStreakHistory`, `computeStreak` inside it) wired to React lifecycle, mirroring `useWidgetSnapshotSync`'s existing pattern exactly. Covered by the manual verification in Task 21 and the existing `widgetStreakHistoryFetch.test.ts`/`streak.test.ts` suites that already cover the functions it calls.)

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../state/AuthContext';
import type { ScheduleMode, Weekday } from '../state/AppState';
import { localDateInTimezone } from '../scheduleEngine/localDate';
import { listCompletedWorkoutActivityDatesInRange } from '../services/workoutExecutions';
import { fetchWidgetStreakHistory } from '../widgets/widgetStreakHistoryFetch';
import type { Streak } from './streak';

export interface UseHomeStreakInput {
  timezone: string;
  hasActiveProgram: boolean;
  scheduleMode?: ScheduleMode;
  prescribedTrainingFrequency?: number;
  trainingDays: readonly Weekday[];
  activeRecoveryDays: readonly Weekday[];
}

/**
 * Home-only streak read — deliberately separate from `useWidgetSnapshotSync`
 * (never modifies it). Reuses the exact same pure/service functions the
 * widget already uses (`fetchWidgetStreakHistory`, which internally calls
 * `computeStreak`), so this introduces one new bounded Firestore read per
 * Home load/foreground, never a new calculation (docs: 2026-10-07 Home
 * redesign spec, "Sequência (streak)" decision).
 *
 * Returns `null` until the first successful read — the Home ticker/ring must
 * simply omit the streak item while this is `null`, never show a fabricated
 * 0.
 */
export function useHomeStreak(input: UseHomeStreakInput): Streak | null {
  const { user } = useAuth();
  const [streak, setStreak] = useState<Streak | null>(null);
  const uid = user?.uid ?? null;
  const trainingDaysKey = input.trainingDays.join(',');
  const activeRecoveryDaysKey = input.activeRecoveryDays.join(',');
  const streakRef = useRef<Streak | null>(null);

  const load = useCallback(async () => {
    if (!uid || !input.hasActiveProgram) {
      streakRef.current = null;
      setStreak(null);
      return;
    }
    try {
      const today = localDateInTimezone(new Date(), input.timezone);
      const result = await fetchWidgetStreakHistory({
        uid,
        todayLocalDate: today,
        streakInput: {
          scheduleMode: input.scheduleMode,
          prescribedTrainingFrequency: input.prescribedTrainingFrequency,
          trainingDays: input.trainingDays,
          activeRecoveryDays: input.activeRecoveryDays,
        },
        fetchRange: listCompletedWorkoutActivityDatesInRange,
      });
      streakRef.current = result.streak;
      setStreak(result.streak);
    } catch {
      // A transient failure must never blank an already-shown real streak —
      // same "never flash a worse state" contract the rest of Home follows.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    uid,
    input.hasActiveProgram,
    input.timezone,
    input.scheduleMode,
    input.prescribedTrainingFrequency,
    trainingDaysKey,
    activeRecoveryDaysKey,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  return streak;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/home/useHomeStreak.ts
git commit -m "Adiciona hook de sequencia (streak) dedicado a Home, reaproveitando fetchWidgetStreakHistory"
```

---

### Task 4: Extend `ProgressingSummary` and `EvolutionViewModelInput`

**Files:**
- Modify: `src/workoutEvolution/types.ts`

- [ ] **Step 1: Add the four new fields to `ProgressingSummary`**

In `src/workoutEvolution/types.ts`, change:

```ts
export interface ProgressingSummary {
  earnedLevel: CurrentTrainingLevel | null;
  activeLevel: CurrentTrainingLevel;
  cycleNumber: number;
  proximity: ProximityState | null;
  activeDays: number | null;
  sessionsCompleted: number | null;
  adherenceQuality: EvolutionQuality | null;
  isHistoryComplete: boolean;
}
```

to:

```ts
export interface ProgressingSummary {
  earnedLevel: CurrentTrainingLevel | null;
  activeLevel: CurrentTrainingLevel;
  cycleNumber: number;
  proximity: ProximityState | null;
  activeDays: number | null;
  sessionsCompleted: number | null;
  adherenceQuality: EvolutionQuality | null;
  isHistoryComplete: boolean;
  /** Same ratio the engine already computed (`ProgressionDecision.adherence.ratio`), 0-1, capped at 1. Null exactly when `adherenceQuality` is null (evaluation blocked). */
  adherenceRatio: number | null;
  /** `activeDays` denominator for `activeLevel` — same constant the engine itself uses (`progressionEngineV2/config.ts`), never recomputed as a new rule. Always known (static per level). */
  requiredActiveDays: number;
  /** Local date Active Time paused at (3 consecutive missed prescribed opportunities), or `null` when not paused. Sourced from `ProgressionSnapshotV2.activeTime.pausedAt`. */
  pausedAtLocalDate: string | null;
  /** Earned INTERMEDIATE cycles completed before the one being evaluated — only meaningful for `activeLevel === 'INTERMEDIATE'`. Null when not computed for this load (e.g. BEGINNER/ADVANCED, or evaluation blocked). */
  intermediateCyclesEarned: number | null;
}
```

- [ ] **Step 2: Type-check (expect failures — intentional, fixed in Task 5)**

Run: `npx tsc --noEmit`
Expected: FAIL — `buildProgressingSummary`/`buildSummary` in `viewModel.ts` no longer satisfy `ProgressingSummary` (missing the 4 new required fields).

- [ ] **Step 3: Commit**

```bash
git add src/workoutEvolution/types.ts
git commit -m "Estende ProgressingSummary com adherenceRatio, requiredActiveDays, pausa e ciclos intermediarios"
```

---

### Task 5: Thread the new fields through `viewModel.ts`

**Scope note (discovered while implementing Task 4):** extending `ProgressingSummary` breaks more
call sites than first anticipated — not just `viewModel.ts`. `src/workoutEvolution/presentationCachePolicy.ts`
builds a `ProgressingSummary` literal directly from the on-disk cache, and three existing test
files construct `ProgressingSummary`/`EvolutionViewModel` mock literals. All of these are now part
of this task (added as Steps 3.5/3.6 below) — do not split them into a separate task.

**Files:**
- Modify: `src/workoutEvolution/viewModel.ts`
- Modify: `src/workoutEvolution/presentationCachePolicy.ts`
- Modify: `src/workoutEvolution/__tests__/viewModel.test.ts`
- Modify: `src/workoutEvolution/__tests__/loadReducer.test.ts`
- Modify: `src/workoutEvolution/__tests__/tickerItems.test.ts`
- Modify: `src/lib/__tests__/evolutionSummaryPresentationCache.test.ts`

- [ ] **Step 1: Write the failing test additions**

Add to `src/workoutEvolution/__tests__/viewModel.test.ts` (inside the `'truthful lifecycle boundary'` describe block, after the existing `'surfaces real dimensions...'` test):

```ts
  it('surfaces the real adherence ratio and the engine-derived active-day requirement', () => {
    const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle(), pending: null, ...NO_NOTICE,
      decision: progressing({ activeDays: 12, validSessionCount: 8, adherence: { ratio: 0.64, quality: 'BELOW_TARGET' } }) });
    expect(vm.kind).toBe('PROGRESSING');
    if (vm.kind !== 'PROGRESSING') return;
    expect(vm.summary.adherenceRatio).toBe(0.64);
    expect(vm.summary.requiredActiveDays).toBe(28); // BEGINNER
  });

  it('surfaces pausedAtLocalDate and intermediateCyclesEarned only when the caller supplies them', () => {
    const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle({ activeLevel: 'INTERMEDIATE' }), pending: null, ...NO_NOTICE,
      decision: progressing(), pausedAtLocalDate: '2026-05-20', intermediateCyclesEarned: 2 });
    expect(vm.kind).toBe('PROGRESSING');
    if (vm.kind !== 'PROGRESSING') return;
    expect(vm.summary.pausedAtLocalDate).toBe('2026-05-20');
    expect(vm.summary.intermediateCyclesEarned).toBe(2);
    expect(vm.summary.requiredActiveDays).toBe(85); // INTERMEDIATE
  });

  it('defaults pausedAtLocalDate/intermediateCyclesEarned to null when the caller omits them', () => {
    const vm = buildEvolutionViewModel({ now: NOW, lifecycle: lifecycle(), pending: null, ...NO_NOTICE, decision: progressing() });
    expect(vm.kind).toBe('PROGRESSING');
    if (vm.kind !== 'PROGRESSING') return;
    expect(vm.summary.pausedAtLocalDate).toBeNull();
    expect(vm.summary.intermediateCyclesEarned).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/workoutEvolution/__tests__/viewModel.test.ts`
Expected: FAIL — `buildEvolutionViewModel` does not accept `pausedAtLocalDate`/`intermediateCyclesEarned`, and `summary.adherenceRatio`/`requiredActiveDays` are `undefined`.

- [ ] **Step 3: Implement — thread the new fields**

In `src/workoutEvolution/viewModel.ts`, replace `buildProgressingSummary`:

```ts
function buildProgressingSummary(
  decision: ProgressionDecision,
  lifecycle: LifecycleContext,
  extra: { pausedAtLocalDate: string | null; intermediateCyclesEarned: number | null },
): ProgressingSummary {
  const base = {
    earnedLevel: lifecycle.earnedLevel,
    activeLevel: lifecycle.activeLevel,
    cycleNumber: lifecycle.cycleNumber,
    isHistoryComplete: lifecycle.isHistoryComplete,
    requiredActiveDays: requiredActiveDaysForLevel(lifecycle.activeLevel),
    pausedAtLocalDate: extra.pausedAtLocalDate,
    intermediateCyclesEarned: extra.intermediateCyclesEarned,
  };
  if (decision.type === 'NO_ACTION') {
    return { ...base, proximity: null, activeDays: null, sessionsCompleted: null, adherenceQuality: null, adherenceRatio: null };
  }
  return {
    ...base,
    proximity: proximityFromDecision(decision),
    activeDays: decision.activeDays,
    sessionsCompleted: decision.validSessionCount,
    adherenceQuality: decision.adherence.quality,
    adherenceRatio: decision.adherence.ratio,
  };
}
```

Add the import at the top of the file:

```ts
import { requiredActiveDaysForLevel } from '../home/evoRingMetrics';
```

Replace `buildSummary`:

```ts
function buildSummary(
  decision: ProgressionDecision | null,
  lifecycle: LifecycleContext,
  extra: { pausedAtLocalDate: string | null; intermediateCyclesEarned: number | null },
): ProgressingSummary {
  return decision
    ? buildProgressingSummary(decision, lifecycle, extra)
    : {
        earnedLevel: lifecycle.earnedLevel,
        activeLevel: lifecycle.activeLevel,
        cycleNumber: lifecycle.cycleNumber,
        isHistoryComplete: lifecycle.isHistoryComplete,
        requiredActiveDays: requiredActiveDaysForLevel(lifecycle.activeLevel),
        pausedAtLocalDate: extra.pausedAtLocalDate,
        intermediateCyclesEarned: extra.intermediateCyclesEarned,
        proximity: null,
        activeDays: null,
        sessionsCompleted: null,
        adherenceQuality: null,
        adherenceRatio: null,
      };
}
```

Replace `EvolutionViewModelInput` and the two builder functions' signatures:

```ts
export interface EvolutionViewModelInput {
  now: Date;
  lifecycle: LifecycleContext | null;
  decision: ProgressionDecision | null;
  pending: PendingEvolutionSummary | null;
  autoActivationNotice: { eventId: string; type: PendingEvolutionType } | null;
  /** From a separate `evaluateProgressionV2ForUserFull` read — see `useWorkoutEvolution.ts`. Omitted/undefined is treated as `null` (not-yet-known), never as "not paused". */
  pausedAtLocalDate?: string | null;
  intermediateCyclesEarned?: number | null;
  error?: string;
}

export function buildProvisionalEvolutionViewModel(input: {
  lifecycle: LifecycleContext;
  decision: ProgressionDecision | null;
  pausedAtLocalDate?: string | null;
  intermediateCyclesEarned?: number | null;
}): EvolutionViewModel {
  return {
    kind: 'SUMMARY_READY',
    source: 'CURRENT_SESSION',
    summary: buildSummary(input.decision, input.lifecycle, {
      pausedAtLocalDate: input.pausedAtLocalDate ?? null,
      intermediateCyclesEarned: input.intermediateCyclesEarned ?? null,
    }),
  };
}

export function buildEvolutionViewModel(input: EvolutionViewModelInput): EvolutionViewModel {
  if (input.error) return { kind: 'ERROR', message: input.error };
  if (!input.lifecycle) return { kind: 'LOADING' };

  const extra = {
    pausedAtLocalDate: input.pausedAtLocalDate ?? null,
    intermediateCyclesEarned: input.intermediateCyclesEarned ?? null,
  };
  const summary = buildSummary(input.decision, input.lifecycle, extra);
  // ... rest of the function body is UNCHANGED from here (autoActivationNotice/pending/decision branches already use `summary`).
```

Leave every line after `const summary = buildSummary(...)` exactly as it already is — only the call to `buildSummary` itself changes.

- [ ] **Step 3.5: Fix `presentationCachePolicy.ts`'s cache-reconstructed summary**

`src/workoutEvolution/presentationCachePolicy.ts`'s `viewModelFromEvolutionPresentationCache`
builds a `ProgressingSummary` directly from the on-disk cache (`src/lib/evolutionSummaryPresentationCache.ts`).
That on-disk schema is a deliberately minimal, allow-listed shape (`hasOnlyKeys` validation) that
already omits some `ProgressingSummary` fields on purpose — e.g. `earnedLevel: null` and
`isHistoryComplete: false` are hardcoded there today, with a comment explaining the cached value is
presentation-only. Follow the exact same pattern for the 4 new fields — **do not** add them to
`EvolutionSummaryPresentationCache`'s on-disk schema in `src/lib/evolutionSummaryPresentationCache.ts`
(that file must not be touched by this task at all). Instead, change only the returned object in
`presentationCachePolicy.ts`:

```ts
import { requiredActiveDaysForLevel } from '../home/evoRingMetrics';

// ...inside viewModelFromEvolutionPresentationCache's returned `summary`, add:
      // Also deliberately absent from disk; Home does not render this flag.
      isHistoryComplete: false,
      // Deliberately absent from disk, same reasoning as earnedLevel/isHistoryComplete above —
      // a stale cached entry never claims a numeric adherence ratio, a pause, or a cycle count.
      adherenceRatio: null,
      requiredActiveDays: requiredActiveDaysForLevel(cache.summary.activeLevel),
      pausedAtLocalDate: null,
      intermediateCyclesEarned: null,
```

(`requiredActiveDays` is the one exception — it's never persisted either, but since it's a pure
function of `activeLevel`, which the cache already stores, it can always be freshly derived rather
than defaulted to a dummy number.)

- [ ] **Step 3.6: Update the three pre-existing test files with `ProgressingSummary`/`EvolutionViewModel` mock literals**

Add the same 4 fields to every mock summary object in:
- `src/workoutEvolution/__tests__/loadReducer.test.ts`
- `src/workoutEvolution/__tests__/tickerItems.test.ts`
- `src/lib/__tests__/evolutionSummaryPresentationCache.test.ts`

None of these tests are about the 4 new fields, so use neutral, inert values consistent with each
mock's existing scenario — typically `adherenceRatio: null, requiredActiveDays: 28, pausedAtLocalDate: null, intermediateCyclesEarned: null`
(or `requiredActiveDays: 85` if that particular mock's `activeLevel` is `'INTERMEDIATE'`/`'ADVANCED'`).
Do not change any other part of these tests' existing assertions or scenarios.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/workoutEvolution/__tests__/viewModel.test.ts src/workoutEvolution/__tests__/loadReducer.test.ts src/workoutEvolution/__tests__/tickerItems.test.ts src/lib/__tests__/evolutionSummaryPresentationCache.test.ts`
Expected: PASS (all tests, old and new, across all four files).

- [ ] **Step 5: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors remaining from Task 4's intentional break (across every file, not just `viewModel.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/workoutEvolution/viewModel.ts src/workoutEvolution/presentationCachePolicy.ts \
  src/workoutEvolution/__tests__/viewModel.test.ts src/workoutEvolution/__tests__/loadReducer.test.ts \
  src/workoutEvolution/__tests__/tickerItems.test.ts src/lib/__tests__/evolutionSummaryPresentationCache.test.ts
git commit -m "Propaga adherenceRatio/requiredActiveDays/pausa/ciclos intermediarios no view model de evolucao"
```

---

### Task 6: Expose `pendingPlan` and the paused/cycle-count fields from `useWorkoutEvolution`

Why a second evaluation call: the common reconcile path (`reconcileWorkoutLifecycle`) only returns `ProgressionDecision`, never the richer `ProgressionSnapshotV2` that carries `activeTime.pausedAt`/`earnedIntermediateCycleCount` — and that richer value is produced deep inside `prepareEvolutionAttempt` in `services/workoutLifecycleApplication.ts`, which also calls `persistEarnedFact` directly. That file sits inside the literally-protected chain from rule 2 (`processWorkoutLifecycleAfterSession → persistEarnedFact → evolvePrescription → activatePendingEvolution / deferPendingEvolution`), so this plan does not touch it at all. Instead, `useWorkoutEvolution.ts` (presentation hook, outside the protected chain) makes one additional call to the already-exported, already-unmodified `evaluateProgressionV2ForUserFull` — the exact same function the dev-only QA readout already uses — purely to read the two extra fields for display. This is an accepted extra read, the same category the user already approved for the streak.

**Files:**
- Modify: `src/workoutEvolution/useWorkoutEvolution.ts`

- [ ] **Step 1: Add the import**

At the top of `src/workoutEvolution/useWorkoutEvolution.ts`, change:

```ts
import { evaluateProgressionV2ForUser } from '../services/workoutProgressionV2';
```

to:

```ts
import { evaluateProgressionV2ForUser, evaluateProgressionV2ForUserFull } from '../services/workoutProgressionV2';
```

- [ ] **Step 2: Add `pendingPlan` state**

After the existing `const [diff, setDiff] = useState<PrescriptionDiffSummary | null>(null);` line, add:

```ts
  const [pendingPlan, setPendingPlan] = useState<FinalWorkoutPlan | null>(null);
```

- [ ] **Step 3: Fetch the extra snapshot fields in parallel**

Inside `load()`, change:

```ts
      const [lifecycle, pendingAfter, decision] = await Promise.all([
        reconciledLifecycle !== undefined
          ? Promise.resolve(reconciledLifecycle)
          : loadWorkoutLifecycleDeduped(user.uid),
        loadPendingEvolution(user.uid),
        reconciledDecision !== undefined
          ? Promise.resolve(reconciledDecision)
          : evaluateProgressionV2ForUser(user.uid),
      ]);
```

to:

```ts
      const [lifecycle, pendingAfter, decision, progressionFull] = await Promise.all([
        reconciledLifecycle !== undefined
          ? Promise.resolve(reconciledLifecycle)
          : loadWorkoutLifecycleDeduped(user.uid),
        loadPendingEvolution(user.uid),
        reconciledDecision !== undefined
          ? Promise.resolve(reconciledDecision)
          : evaluateProgressionV2ForUser(user.uid),
        // Home redesign (2026-10-07): the only place that reads
        // `ProgressionSnapshotV2.activeTime.pausedAt`/`earnedIntermediateCycleCount`
        // for display. Deliberately a SEPARATE call from `decision` above —
        // `reconcileWorkoutLifecycle`'s own internal evaluation (inside the
        // protected prepare/persist chain) never returns the full snapshot,
        // and this hook must not reach into that chain to get it.
        evaluateProgressionV2ForUserFull(user.uid),
      ]);
      const pausedAtLocalDate = progressionFull?.snapshot.activeTime.pausedAt ?? null;
      const intermediateCyclesEarned = progressionFull?.snapshot.earnedIntermediateCycleCount ?? null;
```

- [ ] **Step 4: Pass the two fields into both view-model builders**

Change:

```ts
      if (isCurrent() && isInitialLoad) {
        commitViewModel(buildProvisionalEvolutionViewModel({ lifecycle: lifecycleContext, decision }));
```

to:

```ts
      if (isCurrent() && isInitialLoad) {
        commitViewModel(buildProvisionalEvolutionViewModel({ lifecycle: lifecycleContext, decision, pausedAtLocalDate, intermediateCyclesEarned }));
```

Change:

```ts
        const authoritativeViewModel = buildEvolutionViewModel({
          now: new Date(),
          lifecycle: lifecycleContext,
          decision,
          pending: pendingAfter ? toPendingSummary(pendingAfter) : null,
          autoActivationNotice,
        });
```

to:

```ts
        const authoritativeViewModel = buildEvolutionViewModel({
          now: new Date(),
          lifecycle: lifecycleContext,
          decision,
          pending: pendingAfter ? toPendingSummary(pendingAfter) : null,
          autoActivationNotice,
          pausedAtLocalDate,
          intermediateCyclesEarned,
        });
```

- [ ] **Step 5: Set `pendingPlan` alongside `diff`**

Change:

```ts
      if (pendingAfter) {
        const currentProgram = await pendingProgramPromise;
        const pendingPlan = pendingAfter.plan as FinalWorkoutPlan;
        if (isCurrent()) {
          setDiff(currentProgram?.programInstanceId === pendingAfter.sourceProgramInstanceId
            ? computePrescriptionDiff({ current: currentProgram, pending: pendingPlan })
            : null);
        }
      } else if (autoActivationNotice && lifecycle.programInstance.previousProgramInstanceId) {
```

to:

```ts
      if (pendingAfter) {
        const currentProgram = await pendingProgramPromise;
        const pendingPlanValue = pendingAfter.plan as FinalWorkoutPlan;
        if (isCurrent()) {
          setDiff(currentProgram?.programInstanceId === pendingAfter.sourceProgramInstanceId
            ? computePrescriptionDiff({ current: currentProgram, pending: pendingPlanValue })
            : null);
          setPendingPlan(pendingPlanValue);
        }
      } else if (autoActivationNotice && lifecycle.programInstance.previousProgramInstanceId) {
```

And change the final `else if (isCurrent()) { setDiff(null); }` to also clear `pendingPlan`:

```ts
      } else if (isCurrent()) {
        setDiff(null);
        setPendingPlan(null);
      }
```

Also clear it in the two other branches that set `diff` to a value derived from `autoActivationNotice` (that branch has no pending plan, since it is already activated):

```ts
        if (isCurrent()) {
          setDiff(currentProgram?.programInstanceId === lifecycle.programInstance.programInstanceId && previousProgram
            ? computePrescriptionDiff({ current: previousProgram, pending: currentProgram })
            : null);
          setPendingPlan(null);
        }
```

- [ ] **Step 6: Expose it on the controller**

Change the `WorkoutEvolutionController` interface:

```ts
export interface WorkoutEvolutionController {
  viewModel: EvolutionViewModel;
  loading: boolean;
  actionPending: boolean;
  actionError: string | null;
  diff: PrescriptionDiffSummary | null;
  /** The pending plan's `FinalWorkoutPlan`, present only while a pending evolution exists — same object `diff` was computed from. Lets the UI resolve real exercise display names for the swap list (Home redesign, section 3/5) without any new fetch. */
  pendingPlan: FinalWorkoutPlan | null;
  start: () => Promise<boolean>;
  defer: () => Promise<boolean>;
  acknowledgeAutoActivation: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshProjection: () => Promise<void>;
}
```

Change the final return statement:

```ts
  return {
    viewModel: displayedViewModel, loading, actionPending, actionError, diff, pendingPlan, start, defer,
    acknowledgeAutoActivation, refresh: load, refreshProjection,
  };
```

- [ ] **Step 7: Type-check and run the existing suite**

Run: `npx tsc --noEmit && npx vitest run src/workoutEvolution`
Expected: no errors, all existing tests still pass (the parallel-fetch-ordering test only checks relative position of `pendingProgramPromise`/`listWorkoutLifecycleEventsForProgramInstance`, both untouched).

- [ ] **Step 8: Commit**

```bash
git add src/workoutEvolution/useWorkoutEvolution.ts
git commit -m "Expoe pendingPlan e os campos de pausa/ciclos intermediarios em useWorkoutEvolution"
```

---

### Task 7: Wire `useHomeStreak` into `AppShell.tsx`

**Files:**
- Modify: `src/screens/AppShell.tsx`

- [ ] **Step 1: Import the hook**

Near the other `widgets`/`home` imports in `AppShell.tsx`, add:

```ts
import { useHomeStreak } from '../home/useHomeStreak';
```

- [ ] **Step 2: Call it with the same resolved schedule inputs `useWidgetSnapshotSync` already uses**

Directly below the existing `widgetSnapshotSync` call (after its closing `});`), add:

```ts
  const homeStreak = useHomeStreak({
    timezone: schedule.config?.timezone ?? deviceTimezone(),
    hasActiveProgram: activeProgram !== null,
    scheduleMode: schedule.config?.scheduleMode ?? activeProgram?.scheduleMode ?? 'fixed',
    prescribedTrainingFrequency: activeProgram?.prescribedTrainingFrequency ?? activeProgram?.prescribedStructuredDays,
    trainingDays: schedule.config?.trainingDays ?? [],
    activeRecoveryDays: schedule.config?.activeRecoveryDays ?? [],
  });
```

- [ ] **Step 3: Pass it to `HomeScreen`**

Find the `<HomeScreen ... />` call site(s) and add the prop:

```tsx
            streak={homeStreak}
```

(This prop doesn't exist on `HomeScreen` yet — added in Task 16. Leave this edit here now; `tsc` will flag the unknown prop until Task 16 lands, which is expected and resolved in the same work session before any commit that includes both.)

- [ ] **Step 4: Commit**

```bash
git add src/screens/AppShell.tsx
git commit -m "Liga useHomeStreak ao AppShell"
```

(This commit will not type-check in isolation until Task 16 adds the `streak` prop to `HomeScreen` — that's fine, this plan's tasks are designed to land together in one PR; run the full `tsc --noEmit` only at the end, Task 21.)

---

## Phase 2 — New Home-only visual components

None of the files in this phase are imported by `TreinoScreen.tsx` or any screen other than the new `HomeScreen.tsx`/evolution screens — verified by grep before this plan was written. Do not import any of them from `TreinoScreen.tsx`.

### Task 8: `EvoRing` — reusable SVG ring

**Files:**
- Create: `src/components/home/EvoRing.tsx`

- [ ] **Step 1: Implement**

```tsx
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

/**
 * Pure visual primitive — no internal animation state. The parent
 * (`CycleProgressBlock`/`EvolutionCelebration`) already drives the number
 * with `CountUp`'s own animation loop, so this component never recomputes
 * what `progress` means or animates its own transition — it only draws the
 * value it's given, every render.
 */
export function EvoRing({
  size,
  strokeWidth,
  progress,
  color,
  trackColor = 'rgba(255,255,255,0.08)',
  children,
}: {
  size: number;
  strokeWidth: number;
  /** 0-100. Values outside this range are clamped. */
  progress: number;
  color: string;
  trackColor?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, progress));
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
        />
      </Svg>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/home/EvoRing.tsx
git commit -m "Adiciona EvoRing, anel SVG reutilizavel do redesign da Home"
```

---

### Task 9: `LitFlame` — streak flame icon

**Files:**
- Create: `src/components/home/LitFlame.tsx`

- [ ] **Step 1: Implement**

Translate the reference prototype's `LitFlame` (section 6.4) to `react-native-svg`. The web version's CSS `filter: drop-shadow` and `animation: he-flicker` become, respectively, a `shadow*`/no-op (SVG doesn't support `drop-shadow` the same way on RN — approximate with the surrounding `View`'s shadow) and a `react-native-reanimated` loop.

```tsx
import { useEffect } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';

export function LitFlame({ size = 40, lit = true }: { size?: number; lit?: boolean }) {
  const scaleX = useSharedValue(1);
  const scaleY = useSharedValue(1);

  useEffect(() => {
    if (!lit) {
      scaleX.value = 1; scaleY.value = 1;
      return;
    }
    scaleX.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: 720, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.98, { duration: 720, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 960, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
    scaleY.value = withRepeat(
      withSequence(
        withTiming(0.97, { duration: 720, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.04, { duration: 720, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 960, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    );
  }, [lit, scaleX, scaleY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }, { scaleY: scaleY.value }],
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, lit ? animatedStyle : undefined]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <LinearGradient id="flame" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#9fd6ff" />
            <Stop offset="0.55" stopColor="#2a8aff" />
            <Stop offset="1" stopColor="#0b55e0" />
          </LinearGradient>
        </Defs>
        <Path
          d="M12 2c2 5 6 6 6 11a6 6 0 11-12 0c0-3 2-5 2-8 1 3 3 3 4-3z"
          fill={lit ? 'url(#flame)' : 'none'}
          stroke={lit ? 'none' : 'rgba(255,255,255,0.3)'}
          strokeWidth={1.4}
        />
        {lit && (
          <Path
            d="M12 11c1 2.4 3 3 3 5.4a3 3 0 11-6 0c0-1.4.9-2.3.9-3.8.6 1.3 1.6 1.3 2.1-1.6z"
            fill="#eaf5ff"
            opacity={0.9}
          />
        )}
      </Svg>
    </Animated.View>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/home/LitFlame.tsx
git commit -m "Adiciona LitFlame, icone de sequencia animado do redesign da Home"
```

---

### Task 10: `CountUp` — animated number text

**Files:**
- Create: `src/components/home/CountUp.tsx`

- [ ] **Step 1: Implement**

Direct RN port of the reference prototype's `CountUp` (section 6.5) — a plain RAF-driven counter, no Reanimated needed since it drives a `Text` string, not a native-thread style.

```tsx
import { useEffect, useRef, useState } from 'react';
import { Text, type TextProps } from 'react-native';

export function CountUp({
  to,
  durationMs = 1200,
  ...textProps
}: { to: number; durationMs?: number } & TextProps) {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    let raf: number;
    let start: number | undefined;
    const step = (now: number) => {
      if (start === undefined) start = now;
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (to - from) * eased);
      fromRef.current = current;
      setValue(current);
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, durationMs]);

  return <Text {...textProps}>{value}</Text>;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/home/CountUp.tsx
git commit -m "Adiciona CountUp, texto numerico animado do redesign da Home"
```

---

### Task 11: `HomeEvoTicker` — new Home-only marquee (section 2.2)

This is a **new, separate** component from `EvolutionTicker.tsx` (never edited — shared with `TreinoScreen.tsx`). It reads the same `EvolutionViewModel` plus the new `Streak | null` prop.

**Files:**
- Create: `src/components/home/HomeEvoTicker.tsx`
- Modify: `src/i18n/resources/pt-BR/home.json`, `src/i18n/resources/en/home.json`, `src/i18n/resources/es/home.json` (done together in Task 15 — add the keys referenced below now, in this task, since the component needs them to compile against real copy during manual testing; Task 15 is the pass that also covers every other new key).

- [ ] **Step 1: Add the i18n keys this component needs**

In `src/i18n/resources/pt-BR/home.json`, add a new top-level key (after `"meta"`):

```json
  "evoTicker": {
    "streak": "SEQUÊNCIA {{count}} DIAS",
    "activeDays": "DIAS ATIVOS {{count}}/{{required}}",
    "adherence": "ADERÊNCIA {{percent}}%",
    "cycle": "CICLO {{number}}",
    "level": "NÍVEL {{level}}",
    "sessions30d": "TREINOS {{count}} NOS ÚLTIMOS 30 DIAS"
  },
```

Mirror the same key structure (translated) into `src/i18n/resources/en/home.json` and `src/i18n/resources/es/home.json`:

English (`en/home.json`):
```json
  "evoTicker": {
    "streak": "STREAK {{count}} DAYS",
    "activeDays": "ACTIVE DAYS {{count}}/{{required}}",
    "adherence": "ADHERENCE {{percent}}%",
    "cycle": "CYCLE {{number}}",
    "level": "LEVEL {{level}}",
    "sessions30d": "{{count}} WORKOUTS IN THE LAST 30 DAYS"
  },
```

Spanish (`es/home.json`):
```json
  "evoTicker": {
    "streak": "RACHA {{count}} DÍAS",
    "activeDays": "DÍAS ACTIVOS {{count}}/{{required}}",
    "adherence": "ADHERENCIA {{percent}}%",
    "cycle": "CICLO {{number}}",
    "level": "NIVEL {{level}}",
    "sessions30d": "{{count}} ENTRENAMIENTOS EN LOS ÚLTIMOS 30 DÍAS"
  },
```

- [ ] **Step 2: Implement the component**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { useIsScreenActive } from '../../state/ScreenActivity';
import type { EvolutionViewModel } from '../../workoutEvolution/types';
import type { Streak } from '../../home/streak';

const LOOP_DURATION_MS = 18000;
const ITEM_GAP = 36;

interface TickerValueItem {
  label: string;
  value: string;
}

/**
 * Home-only HUD marquee (section 2.2 of the Home redesign). Deliberately a
 * separate component from `EvolutionTicker` (shared with `TreinoScreen.tsx`,
 * never edited for this redesign) — same underlying `EvolutionViewModel`,
 * different visual treatment and a wider set of real fields (streak,
 * numeric adherence, 30-day session count) that `EvolutionTicker`'s compact
 * card treatment never needed.
 */
export function HomeEvoTicker({
  viewModel,
  streak,
  sessionsLast30Days,
}: {
  viewModel: EvolutionViewModel;
  /** `null` while the dedicated streak read (`useHomeStreak`) hasn't resolved yet — that item is simply omitted, never shown as 0. */
  streak: Streak | null;
  /** Real count from the already-loaded 30-day frequency window — `null` while unavailable, item omitted. */
  sessionsLast30Days: number | null;
}) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();

  const items = useMemo<TickerValueItem[]>(() => {
    if (viewModel.kind === 'LOADING' || viewModel.kind === 'ERROR' || viewModel.kind === 'UNAVAILABLE') return [];
    const { summary } = viewModel;
    const result: TickerValueItem[] = [];
    if (streak) {
      result.push({ label: '', value: t('evoTicker.streak', { count: streak.current }) });
    }
    if (summary.activeDays !== null) {
      result.push({ label: '', value: t('evoTicker.activeDays', { count: summary.activeDays, required: summary.requiredActiveDays }) });
    }
    if (summary.adherenceRatio !== null) {
      result.push({ label: '', value: t('evoTicker.adherence', { percent: Math.round(summary.adherenceRatio * 100) }) });
    }
    result.push({ label: '', value: t('evoTicker.cycle', { number: summary.cycleNumber }) });
    result.push({ label: '', value: t('evoTicker.level', { level: t(`evolution:level.${summary.activeLevel}`) }) });
    if (sessionsLast30Days !== null) {
      result.push({ label: '', value: t('evoTicker.sessions30d', { count: sessionsLast30Days }) });
    }
    return result;
  }, [viewModel, streak, sessionsLast30Days, t]);

  if (items.length === 0) return null;

  return (
    <View
      style={{
        marginHorizontal: -22,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: 'rgba(255,255,255,0.06)',
        paddingVertical: 8,
        overflow: 'hidden',
      }}
    >
      <TickerMarquee items={items} accentColor={theme.colors.primaryEmphasis} />
    </View>
  );
}

function TickerMarquee({ items, accentColor }: { items: TickerValueItem[]; accentColor: string }) {
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const isActive = useIsScreenActive();

  useEffect(() => {
    if (width === 0 || !isActive) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, { toValue: -width, duration: LOOP_DURATION_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [width, x, isActive]);

  const row = (onLayout?: (w: number) => void) => (
    <View
      onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.width) : undefined}
      style={{ flexDirection: 'row', gap: ITEM_GAP, paddingRight: ITEM_GAP }}
    >
      {items.map((item, i) => (
        <Text
          key={i}
          style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 2, color: accentColor }}
        >
          {item.value}
        </Text>
      ))}
    </View>
  );

  return (
    <Animated.View style={{ flexDirection: 'row', transform: [{ translateX: x }], paddingLeft: 22 }}>
      {row((w) => setWidth(w))}
      {row()}
    </Animated.View>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/components/home/HomeEvoTicker.tsx src/i18n/resources/pt-BR/home.json src/i18n/resources/en/home.json src/i18n/resources/es/home.json
git commit -m "Adiciona HomeEvoTicker, faixa HUD exclusiva da Home com sequencia/aderencia reais"
```

---

### Task 12: `CycleProgressBlock` — the ring block (section 2.3)

**Files:**
- Create: `src/components/home/CycleProgressBlock.tsx`

- [ ] **Step 1: Add the i18n keys**

In `src/i18n/resources/pt-BR/home.json`, add (sibling to `evoTicker`):

```json
  "evoRing": {
    "ofCycle": "DO CICLO",
    "daysLeft": "Faltam {{count}} dias",
    "paused": "Progresso pausado",
    "unlocked": "Evolução liberada",
    "streakLabel": "SEQUÊNCIA",
    "streakUnit": "dias",
    "adherenceLabel": "ADERÊNCIA",
    "towardAdvanced": "RUMO AO AVANÇADO",
    "towardAdvancedUnit": "/ {{count}} ciclos"
  },
```

English:
```json
  "evoRing": {
    "ofCycle": "OF CYCLE",
    "daysLeft": "{{count}} days left",
    "paused": "Progress paused",
    "unlocked": "Evolution unlocked",
    "streakLabel": "STREAK",
    "streakUnit": "days",
    "adherenceLabel": "ADHERENCE",
    "towardAdvanced": "TOWARD ADVANCED",
    "towardAdvancedUnit": "/ {{count}} cycles"
  },
```

Spanish:
```json
  "evoRing": {
    "ofCycle": "DEL CICLO",
    "daysLeft": "Faltan {{count}} días",
    "paused": "Progreso en pausa",
    "unlocked": "Evolución disponible",
    "streakLabel": "RACHA",
    "streakUnit": "días",
    "adherenceLabel": "ADHERENCIA",
    "towardAdvanced": "HACIA AVANZADO",
    "towardAdvancedUnit": "/ {{count}} ciclos"
  },
```

- [ ] **Step 2: Implement**

```tsx
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { palette } from '../../theme/tokens';
import { EvoRing } from './EvoRing';
import { LitFlame } from './LitFlame';
import { CountUp } from './CountUp';
import { INTERMEDIATE_CYCLES_FOR_ADVANCED } from '../../home/evoRingMetrics';
import type { EvolutionViewModel } from '../../workoutEvolution/types';
import type { Streak } from '../../home/streak';

const evCap = { fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 1.6, color: 'rgba(255,255,255,0.38)' } as const;

export function CycleProgressBlock({ viewModel, streak }: { viewModel: EvolutionViewModel; streak: Streak | null }) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();

  if (viewModel.kind === 'LOADING' || viewModel.kind === 'ERROR' || viewModel.kind === 'UNAVAILABLE') return null;

  const { summary } = viewModel;
  const pendingKind = viewModel.kind === 'EVOLUTION_READY' || viewModel.kind === 'EVOLUTION_DEFERRED'
    ? viewModel.pending.type
    : null;
  const paused = summary.pausedAtLocalDate !== null;
  const activeDays = summary.activeDays ?? 0;
  const cyclePct = pendingKind
    ? 100
    : summary.requiredActiveDays > 0
      ? Math.min(100, Math.round((activeDays / summary.requiredActiveDays) * 100))
      : 0;
  const daysLeft = Math.max(0, summary.requiredActiveDays - activeDays);
  const statusText = pendingKind
    ? t('evoRing.unlocked')
    : paused
      ? t('evoRing.paused')
      : t('evoRing.daysLeft', { count: daysLeft });
  const adherencePercent = summary.adherenceRatio !== null ? Math.round(summary.adherenceRatio * 100) : null;
  const adherenceColor = adherencePercent !== null && adherencePercent < 70 ? palette.amber500 : '#fff';
  const intermediate = summary.activeLevel === 'INTERMEDIATE';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22, marginTop: 32 }}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <EvoRing size={150} strokeWidth={11} progress={cyclePct} color={paused ? palette.amber500 : theme.colors.primaryEmphasis}>
          <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 40, color: '#fff', lineHeight: 40 }}>
            <CountUp to={cyclePct} style={{ fontFamily: 'Anton_400Regular', fontSize: 40, color: '#fff' }} />
            <Text style={{ fontSize: 18, color: 'rgba(255,255,255,0.45)' }}>%</Text>
          </Text>
          <Text style={[evCap, { marginTop: 6 }]}>{t('evoRing.ofCycle')}</Text>
        </EvoRing>
        <Text style={{ fontFamily: 'Archivo_600SemiBold', fontSize: 14, color: '#fff', textAlign: 'center' }}>
          {statusText}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Row last={!intermediate}>
          <Text style={evCap}>{t('evoRing.streakLabel')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <LitFlame size={42} lit={(streak?.current ?? 0) > 0} />
            <CountUp to={streak?.current ?? 0} style={{ fontFamily: 'Anton_400Regular', fontSize: 30, color: '#fff' }} />
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{t('evoRing.streakUnit')}</Text>
          </View>
        </Row>
        <Row last={!intermediate}>
          <Text style={evCap}>{t('evoRing.adherenceLabel')}</Text>
          <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 30, color: adherenceColor, marginTop: 8 }}>
            {adherencePercent !== null ? <CountUp to={adherencePercent} style={{ fontFamily: 'Anton_400Regular', fontSize: 30, color: adherenceColor }} /> : '—'}
            {adherencePercent !== null ? '%' : ''}
          </Text>
          {adherencePercent !== null && (
            <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 10, position: 'relative' }}>
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${adherencePercent}%`, borderRadius: 2, backgroundColor: adherenceColor === palette.amber500 ? palette.amber500 : theme.colors.primaryEmphasis }} />
              <View style={{ position: 'absolute', left: '70%', top: -3, width: 2, height: 10, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.6)' }} />
            </View>
          )}
        </Row>
        {intermediate && (
          <Row last>
            <Text style={evCap}>{t('evoRing.towardAdvanced')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 30, color: '#fff' }}>
                {summary.intermediateCyclesEarned ?? 0}
              </Text>
              <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
                {t('evoRing.towardAdvancedUnit', { count: INTERMEDIATE_CYCLES_FOR_ADVANCED })}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 10 }}>
              {Array.from({ length: INTERMEDIATE_CYCLES_FOR_ADVANCED }, (_, i) => (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: i < (summary.intermediateCyclesEarned ?? 0) ? theme.colors.primaryEmphasis : 'rgba(255,255,255,0.08)',
                  }}
                />
              ))}
            </View>
          </Row>
        )}
      </View>
    </View>
  );
}

function Row({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
      {children}
    </View>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/components/home/CycleProgressBlock.tsx src/i18n/resources/pt-BR/home.json src/i18n/resources/en/home.json src/i18n/resources/es/home.json
git commit -m "Adiciona CycleProgressBlock, bloco do anel de ciclo do redesign da Home"
```

---

### Task 13: `PendingEvolutionBanner` (section 2.4)

**Files:**
- Create: `src/components/home/PendingEvolutionBanner.tsx`

- [ ] **Step 1: Add i18n keys**

In `src/i18n/resources/pt-BR/home.json`, add:

```json
  "evoPending": {
    "cycleTitle": "{{count}} exercícios novos no ciclo {{number}}",
    "levelTitle": "Novo nível: {{level}}",
    "renewalTitle": "Renovar ciclo",
    "subtitle": "Veja o que muda antes de ativar",
    "deferredLink": "Evolução adiada · ver e ativar"
  },
```

English:
```json
  "evoPending": {
    "cycleTitle": "{{count}} new exercises in cycle {{number}}",
    "levelTitle": "New level: {{level}}",
    "renewalTitle": "Renew cycle",
    "subtitle": "See what changes before activating",
    "deferredLink": "Evolution deferred · view and activate"
  },
```

Spanish:
```json
  "evoPending": {
    "cycleTitle": "{{count}} ejercicios nuevos en el ciclo {{number}}",
    "levelTitle": "Nuevo nivel: {{level}}",
    "renewalTitle": "Renovar ciclo",
    "subtitle": "Mira qué cambia antes de activar",
    "deferredLink": "Evolución aplazada · ver y activar"
  },
```

- [ ] **Step 2: Implement**

```tsx
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme';
import { Icon } from '../ui/Icon';
import type { EvolutionViewModel } from '../../workoutEvolution/types';
import type { PrescriptionDiffSummary } from '../../workoutEvolution/diff';

export function PendingEvolutionBanner({
  viewModel,
  diff,
  onPress,
}: {
  viewModel: Extract<EvolutionViewModel, { kind: 'EVOLUTION_READY' | 'EVOLUTION_DEFERRED' }>;
  diff: PrescriptionDiffSummary | null;
  onPress: () => void;
}) {
  const { t } = useTranslation(['home', 'evolution']);
  const { theme } = useTheme();
  const { pending, summary } = viewModel;
  const isDeferred = viewModel.kind === 'EVOLUTION_DEFERRED';

  const title = pending.type === 'LEVEL_PROMOTION'
    ? t('home:evoPending.levelTitle', { level: t(`evolution:level.${pending.toLevel}`) })
    : pending.type === 'MOTIVATIONAL_RENEWAL'
      ? t('home:evoPending.renewalTitle')
      : t('home:evoPending.cycleTitle', { count: diff?.exerciseReplacements.length ?? 0, number: summary.cycleNumber + 1 });

  if (isDeferred) {
    return (
      <Pressable onPress={onPress} style={{ marginTop: 14 }}>
        <Text style={{ fontSize: 13, color: theme.colors.primaryEmphasis, fontFamily: 'Archivo_600SemiBold' }}>
          {t('home:evoPending.deferredLink')}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        width: '100%',
        marginTop: 20,
        padding: 16,
        paddingVertical: 15,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: 'rgba(11,112,249,0.1)',
        borderWidth: 1,
        borderColor: 'rgba(11,112,249,0.45)',
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14.5, fontFamily: 'Archivo_600SemiBold', color: '#fff' }}>{title}</Text>
        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>{t('home:evoPending.subtitle')}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={theme.colors.primaryEmphasis} />
    </Pressable>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/components/home/PendingEvolutionBanner.tsx src/i18n/resources/pt-BR/home.json src/i18n/resources/en/home.json src/i18n/resources/es/home.json
git commit -m "Adiciona PendingEvolutionBanner do redesign da Home"
```

---

### Task 14: Restyle `FrequencyHeatmap.tsx` to the GitHub-grid look (section 2.6)

Home-exclusive component (verified by grep — not used by `TreinoScreen.tsx` or anywhere else), safe to edit in place. Same underlying `FrequencyWindowViewModel`/`buildFrequencyWindow` (30-day window, binary `completed`) — this task only transposes the render order (weeks as columns, weekdays as rows, matching the real GitHub contribution-graph orientation the design asks for) and restyles colors/legend. No change to `src/home/frequencyHeatmap.ts`.

**Files:**
- Modify: `src/components/home/FrequencyHeatmap.tsx`

- [ ] **Step 1: Replace the grid-rendering JSX**

Replace the whole block from `<View style={{ paddingHorizontal: 22, ...}}>` (the component's returned JSX) with:

```tsx
  return (
    <View style={{ paddingHorizontal: 22, paddingVertical: 12, opacity: loading ? 0.55 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <MonoLabel>{t('activity.frequency.title').toUpperCase()}</MonoLabel>
        <Animated.View style={{ opacity: fade }}>
          <MonoLabel color={theme.colors.textSecondary}>{summary}</MonoLabel>
        </Animated.View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 10 }}>
        <Pressable
          onPress={source === 'AUTHORITATIVE' ? onPrev : undefined}
          disabled={source !== 'AUTHORITATIVE'}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('activity.frequency.prev')}
        >
          <Icon name="arrow-left" size={14} color={theme.colors.textSecondary} />
        </Pressable>
        <Animated.View style={{ opacity: fade }}>
          <MonoLabel color={theme.colors.textSecondary}>{rangeLabel}</MonoLabel>
        </Animated.View>
        <Pressable
          onPress={source === 'AUTHORITATIVE' && canGoNext ? onNext : undefined}
          disabled={source !== 'AUTHORITATIVE' || !canGoNext}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('activity.frequency.next')}
          accessibilityState={{ disabled: source !== 'AUTHORITATIVE' || !canGoNext }}
          style={{ opacity: canGoNext ? 1 : 0.25 }}
        >
          <Icon name="arrow-right" size={14} color={theme.colors.textSecondary} />
        </Pressable>
      </View>

      <Animated.View style={{ marginTop: 14, opacity: fade, flexDirection: 'row', gap: 3 }}>
        {cellSize > 0 && freqWindow && (
          <>
            <View style={{ width: 14, justifyContent: 'space-between' }}>
              {[0, 1, 2, 3, 4, 5, 6].map((row) => (
                <View key={row} style={{ height: cellSize, justifyContent: 'center' }}>
                  {(row === 0 || row === 2 || row === 4 || row === 6) && (
                    <MonoLabel size={8} color={theme.colors.textFaint}>{weekdayLetter(row, locale)}</MonoLabel>
                  )}
                </View>
              ))}
            </View>
            {freqWindow.weeks.map((week, columnIndex) => (
              <View key={columnIndex} style={{ gap: 3 }}>
                {week.map((day, rowIndex) => (
                  <View
                    key={rowIndex}
                    accessibilityLabel={day && (source !== 'CACHE' || !knownThroughLocalDate || day.localDate <= knownThroughLocalDate)
                      ? (day.completed
                          ? t('activity.frequency.cellCompleted', { date: formatLocalDate(day.localDate, locale, { day: 'numeric', month: 'long' }) })
                          : t('activity.frequency.cellEmpty', { date: formatLocalDate(day.localDate, locale, { day: 'numeric', month: 'long' }) }))
                      : undefined}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 3,
                      backgroundColor: source === 'CACHE' && day && knownThroughLocalDate && day.localDate > knownThroughLocalDate
                        ? 'rgba(255,255,255,0.05)'
                        : day?.completed ? theme.colors.primaryEmphasis : 'rgba(255,255,255,0.05)',
                      borderWidth: day?.isToday ? 1 : 0,
                      borderColor: 'rgba(77,163,255,0.8)',
                      opacity: day ? (source === 'CACHE' && knownThroughLocalDate && day.localDate > knownThroughLocalDate ? 0.45 : 1) : 0,
                    }}
                  />
                ))}
              </View>
            ))}
          </>
        )}
      </Animated.View>

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 12 }}>
        <MonoLabel size={9} color={theme.colors.textFaint}>{t('activity.frequency.less').toUpperCase()}</MonoLabel>
        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.05)' }} />
        <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: theme.colors.primaryEmphasis }} />
        <MonoLabel size={9} color={theme.colors.textFaint}>{t('activity.frequency.more').toUpperCase()}</MonoLabel>
      </View>
    </View>
  );
}
```

Note: `freqWindow.weeks` is already `GRID_ROWS` rows × `GRID_COLUMNS` columns, where each row = one calendar week and each column = one weekday (Monday-first) — this is unchanged data. The code above indexes it as `freqWindow.weeks[columnIndex][rowIndex]`, i.e. reads `weeks` (an array-of-weeks, each a 7-long weekday array) and draws one `View` column per week, one cell per weekday inside it — the transpose happens purely in iteration order, not in the data itself.

- [ ] **Step 2: Add the two new legend i18n keys**

In `src/i18n/resources/pt-BR/home.json`, inside `activity.frequency`, add:

```json
      "less": "menos",
      "more": "mais",
```

English equivalent in `en/home.json`: `"less": "less", "more": "more"`.
Spanish equivalent in `es/home.json`: `"less": "menos", "more": "más"`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Run the existing frequency tests**

Run: `npx vitest run src/home/__tests__ --grep frequency`
Expected: PASS — `buildFrequencyWindow`/`frequencyWindowBounds` are untouched; only the consuming component changed.

- [ ] **Step 5: Commit**

```bash
git add src/components/home/FrequencyHeatmap.tsx src/i18n/resources/pt-BR/home.json src/i18n/resources/en/home.json src/i18n/resources/es/home.json
git commit -m "Restyle do FrequencyHeatmap para grade estilo GitHub (semanas em colunas)"
```

---

### Task 15: Remaining i18n additions (header, greeting already covered by existing keys)

**Files:**
- Modify: `src/i18n/resources/pt-BR/home.json`, `en/home.json`, `es/home.json`

- [ ] **Step 1: Verify no further new keys are needed**

The header (2.1) reuses `home:meta.todayLine` and `home:greeting.casual` (both already exist — just restyled in Task 16, no new copy). The start-CTA card (2.5) reuses `home:todayCard.*`/`home:activeWorkout.*`/`home:schedule.*` (all already exist, restyled in place). Sections 3/4/5 copy is added in Tasks 17-19. No action needed here beyond what Tasks 11-14 already added — this step exists to make that explicit and avoid a redundant pass.

- [ ] **Step 2: Lint the three JSON files for valid syntax**

Run: `node -e "require('./src/i18n/resources/pt-BR/home.json'); require('./src/i18n/resources/en/home.json'); require('./src/i18n/resources/es/home.json'); console.log('ok')"`
Expected: prints `ok` (catches any trailing comma/syntax mistake from Tasks 11-14).

- [ ] **Step 3: Commit (only if Step 2 required a fix)**

```bash
git add src/i18n/resources
git commit -m "Corrige sintaxe dos JSON de i18n do redesign da Home" --allow-empty
```

---

## Phase 3 — `HomeScreen.tsx` integration

### Task 16: Restyle Home's structure and wire the new sections

**Files:**
- Modify: `src/screens/HomeScreen.tsx`

- [ ] **Step 1: Remove the three sections dropped from Home (per user decision)**

Delete these imports (no longer used by `HomeScreen.tsx`; leave the component files themselves untouched — they may still be useful elsewhere later):

```ts
import { ProgramProgressStrip } from '../components/home/ProgramProgressStrip';
import { WeeklyOverview } from '../components/home/WeeklyOverview';
import { UpcomingWorkouts } from '../components/home/UpcomingWorkouts';
import { UpcomingWorkoutDetailModal } from '../components/home/UpcomingWorkoutDetailModal';
import { buildUpcomingWorkouts, type UpcomingWorkoutViewModel } from '../home/upcomingWorkouts';
import type { WeekOverviewViewModel } from '../home/weekOverview';
```

Delete the `upcomingWorkouts`/`selectedUpcoming` memo and state, the `<ProgramProgressStrip ... />` render call, the `weekOverview ? <WeeklyOverview .../> : ...` block, the `{upcomingWorkouts.length > 0 ? <UpcomingWorkouts .../> : ...}` block, and the `<UpcomingWorkoutDetailModal .../>` render call. Also remove the now-unused `weekOverview`/`onFrequencyPrev`'s sibling props that only fed those sections — **keep** every prop still used by `FrequencyHeatmap`/the Today card (do not remove `frequencyWindow`, `frequencyLoading`, etc.).

Also remove the `weekOverview` prop from the component's prop type and destructuring (it has no other consumer in this file after this change).

- [ ] **Step 2: Add the two new props**

Add to the destructured props and the prop type:

```ts
  streak = null,
```
```ts
  /** Home-only dedicated streak read (`useHomeStreak`) — `null` until the first successful read. */
  streak?: import('../home/streak').Streak | null;
```

(`evolutionViewModel`, `onOpenEvolution`, `frequencyWindow`, etc. already exist — reused as-is.)

- [ ] **Step 3: Replace the header block (section 2.1)**

Replace the existing greeting `<View>` block (the one containing `MonoLabel`/`Display`/`WorkoutRestHeaderStatus`/`SupportInboxButton`/`ProfileAvatar`) with:

```tsx
          <View
            style={{
              paddingHorizontal: 24,
              paddingTop: 70 - 10, // screen padding target is 70 total; SafeAreaView already contributes top inset
              paddingBottom: 12,
              flexDirection: 'row',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flex: 1, marginRight: 12 }}>
              <MonoLabel>{todayLine.toUpperCase()}</MonoLabel>
              <Display size={34} style={{ marginTop: 8 }} numberOfLines={2}>
                {`${t('home:greeting.casual')} ${localizedFirstName}.`.toUpperCase()}
              </Display>
            </View>
            {todayActionsReady ? <WorkoutRestHeaderStatus
              workoutInProgress={workoutInProgress}
              rest={activeRest}
              resting={restRunning}
              onPress={onStart}
            /> : null}
            {onOpenSupportCases && unreadSupportCasesCount > 0 && (
              <SupportInboxButton unreadCasesCount={unreadSupportCasesCount} onPress={onOpenSupportCases} />
            )}
            <Pressable onPress={onOpenProfile} hitSlop={8}>
              <ProfileAvatar
                displayName={profile?.profile.name || firstName}
                photoURL={profile?.profile.photoURL}
                photoVersion={profile?.profile.photoVersion}
                size={46}
              />
            </Pressable>
          </View>
```

This keeps every existing handler/state (`onOpenProfile`, `onOpenSupportCases`, `unreadSupportCasesCount`, `workoutInProgress`, `activeRest`, `restRunning`, `onStart`) — only layout/typography/sizes changed (34px display, 46px avatar, `flex-end` alignment per design 2.1).

- [ ] **Step 4: Replace the ticker with the new Home-only ticker + ring block + pending banner**

Replace the existing:

```tsx
          <View style={{ marginBottom: 18, minHeight: snapshotFrequencyThrough ? 44 : undefined }}>
            <EvolutionTicker viewModel={evolutionViewModel} onPress={onOpenEvolution} />
          </View>
```

with:

```tsx
          <View style={{ marginTop: 22, marginBottom: 18 }}>
            <HomeEvoTicker
              viewModel={evolutionViewModel}
              streak={streak}
              sessionsLast30Days={frequencyWindow?.completedCount ?? null}
            />
          </View>

          <View style={{ paddingHorizontal: 24 }}>
            <CycleProgressBlock viewModel={evolutionViewModel} streak={streak} />
            {(evolutionViewModel.kind === 'EVOLUTION_READY' || evolutionViewModel.kind === 'EVOLUTION_DEFERRED') && onOpenEvolution ? (
              <PendingEvolutionBanner viewModel={evolutionViewModel} diff={null} onPress={onOpenEvolution} />
            ) : null}
          </View>
```

Replace the `import { EvolutionTicker } from '../components/evolution/EvolutionTicker';` import with:

```ts
import { HomeEvoTicker } from '../components/home/HomeEvoTicker';
import { CycleProgressBlock } from '../components/home/CycleProgressBlock';
import { PendingEvolutionBanner } from '../components/home/PendingEvolutionBanner';
```

Note on `diff={null}` above: `HomeScreen` itself never had access to `PrescriptionDiffSummary` (that lives in `useWorkoutEvolution`, owned by `AppShell`). `PendingEvolutionBanner`'s cycle-title falls back to `0` new exercises when `diff` is `null` — acceptable for the banner (it only needs the count for copy), but **Task 20** passes the real `diff` through from `AppShell` once that wiring exists; revisit this prop there rather than leaving `null` as the final state. (Tracked explicitly so it isn't silently forgotten — see Task 20 Step 4.)

- [ ] **Step 5: Leave the "Today" start-CTA card (section 2.5) exactly as-is**

The existing poster card (`LinearGradient` block starting at `{/* TODAY POSTER */}`) already implements every state the design's section 2.5 needs to preserve (loading, generating, rest day, active recovery, completed today, setup required, missed-pending notice, advance-workout, body muscle map) — none of that logic changes. Only cosmetic alignment with the new design tokens is in scope, and the existing styling (`theme.gradients.poster`, `borderRadius: 16`, etc.) already matches the design's dark/blue palette closely enough that no structural edit is required here. **Do not restructure this block** — the risk of silently dropping one of its many conditional states outweighs the cosmetic gain.

- [ ] **Step 6: Remove the old ticker's now-unused import guard**

Confirm `EvolutionTicker` is no longer imported anywhere in this file (`grep -n "EvolutionTicker" src/screens/HomeScreen.tsx` should return nothing).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (this also resolves the intentional break left open at the end of Task 7).

- [ ] **Step 8: Run existing Home tests**

Run: `npx vitest run src/screens/__tests__/homeScreenMissedPendingNotice.test.ts src/screens/__tests__/homeInitialVisualReadyStructure.test.ts`
Expected: PASS — these test the missed-pending notice and initial-visual-ready layout markers, both untouched by this task.

- [ ] **Step 9: Commit**

```bash
git add src/screens/HomeScreen.tsx
git commit -m "Redesenha cabecalho, ticker, anel de ciclo e evolucao pendente da Home; remove secoes fora do novo escopo"
```

---

## Phase 4 — Evolution preview sheet reskin (section 3)

### Task 17: Restyle `EvolutionUnlockScreen.tsx` and add the real exercise swap list

**Files:**
- Modify: `src/screens/EvolutionUnlockScreen.tsx`
- Modify: `src/i18n/resources/pt-BR/evolution.json`, `en/evolution.json`, `es/evolution.json`

- [ ] **Step 1: Add the props needed to resolve exercise names**

Change the component's props to accept the plan pair:

```ts
export function EvolutionUnlockScreen({
  viewModel,
  diff,
  currentPlan,
  pendingPlan,
  actionPending,
  actionError,
  onStart,
  onDefer,
  onClose,
}: {
  viewModel: Extract<EvolutionViewModel, { kind: 'EVOLUTION_READY' | 'EVOLUTION_DEFERRED' | 'AUTO_ACTIVATION_NOTICE' }>;
  diff: PrescriptionDiffSummary | null;
  /** The plan active when this evolution was offered — `null` only for AUTO_ACTIVATION_NOTICE, where there is no pending plan to diff against here (that screen already shows `diff` only). */
  currentPlan: FinalWorkoutPlan | null;
  pendingPlan: FinalWorkoutPlan | null;
  actionPending: boolean;
  actionError: string | null;
  onStart: () => void;
  onDefer: () => void;
  onClose: () => void;
}) {
```

Add the import:

```ts
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import { workoutExercisesFromPlan } from './workoutScreenPlan';
import { useTranslation as useI18nTranslation } from 'react-i18next'; // already imported as useTranslation below; do not duplicate — use the existing `i18n` instance from the existing `useTranslation('evolution')` call for the locale.
```

(Remove the placeholder duplicate import line above — the file already calls `const { t } = useTranslation('evolution');`; get `i18n.language` from a second destructure on that same call: `const { t, i18n } = useTranslation('evolution');`.)

- [ ] **Step 2: Pass `currentPlan`/`pendingPlan` into `WhatChanged`**

Change every `<WhatChanged diff={diff} framing={...} />` call site to also pass `currentPlan`/`pendingPlan`/`locale`:

```tsx
          <WhatChanged
            diff={diff}
            currentPlan={currentPlan}
            pendingPlan={pendingPlan}
            locale={i18n.language}
            framing={isMotivationalRenewal ? 'renewal' : isLevelPromotion ? 'level' : 'cycle'}
          />
```

(and the `AUTO_ACTIVATION_NOTICE` branch's `<WhatChanged diff={diff} framing="auto" />` similarly, passing `currentPlan={null} pendingPlan={null}` there since that path never has a pending plan.)

- [ ] **Step 3: Extend `WhatChanged` to render the real swap list**

Replace the `WhatChanged` function with:

```tsx
function WhatChanged({
  diff,
  currentPlan,
  pendingPlan,
  locale,
  framing,
}: {
  diff: PrescriptionDiffSummary | null;
  currentPlan: FinalWorkoutPlan | null;
  pendingPlan: FinalWorkoutPlan | null;
  locale: string;
  framing: 'level' | 'cycle' | 'renewal' | 'auto';
}) {
  const { t } = useTranslation('evolution');
  const { theme } = useTheme();
  if (!diff) return null;
  const rows: { icon: 'swap' | 'check' | 'calendar' | 'list' | 'sparkles'; text: string }[] = [];
  if (diff.addedExerciseCount > 0) rows.push({ icon: 'list', text: t('diff.added', { count: diff.addedExerciseCount }) });
  if (diff.removedExerciseCount > 0) rows.push({ icon: 'list', text: t('diff.removed', { count: diff.removedExerciseCount }) });
  if (diff.reorderedSessionCount > 0) rows.push({ icon: 'swap', text: t('diff.reordered', { count: diff.reorderedSessionCount }) });
  if (diff.setsChangedCount > 0) rows.push({ icon: 'list', text: t('diff.sets', { count: diff.setsChangedCount }) });
  if (diff.repsChangedCount > 0) rows.push({ icon: 'list', text: t('diff.reps', { count: diff.repsChangedCount }) });
  if (diff.restChangedCount > 0) rows.push({ icon: 'list', text: t('diff.rest', { count: diff.restChangedCount }) });
  if (diff.frequencyChange) rows.push({ icon: 'calendar', text: t('diff.frequencyChanged', diff.frequencyChange) });
  if (diff.sessionCountChange) rows.push({ icon: 'calendar', text: t('diff.sessionCountChanged', diff.sessionCountChange) });
  if (diff.splitChanged || diff.addedSessionCount > 0 || diff.removedSessionCount > 0) {
    rows.push({ icon: 'list', text: t('diff.structureChanged') });
  }
  if (!diff.hasObservableChanges) rows.push({ icon: 'check', text: t('diff.noObservableChange') });

  const swapRows = currentPlan && pendingPlan
    ? diff.exerciseReplacements.map((replacement) => {
        const oldExercises = workoutExercisesFromPlan(currentPlan, locale, replacement.sessionIndex);
        const newExercises = workoutExercisesFromPlan(pendingPlan, locale, replacement.sessionIndex);
        const sessionLetter = String.fromCharCode(65 + replacement.sessionIndex); // A, B, C...
        return {
          key: `${replacement.sessionIndex}:${replacement.slotIndex}`,
          sessionLetter,
          oldName: oldExercises[replacement.slotIndex]?.name ?? replacement.fromExerciseId,
          newName: newExercises[replacement.slotIndex]?.name ?? replacement.toExerciseId,
        };
      })
    : [];

  return (
    <Card style={{ padding: 20, marginTop: 16 }}>
      <Slash>{t(`diff.title.${framing}`).toUpperCase()}</Slash>
      {swapRows.length > 0 && (
        <View style={{ marginTop: 14 }}>
          {swapRows.map((row) => (
            <View key={row.key} style={{ flexDirection: 'row', gap: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 15, width: 16, color: 'rgba(255,255,255,0.35)' }}>
                {row.sessionLetter}
              </Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', textDecorationLine: 'line-through' }}>{row.oldName}</Text>
                <Text style={{ fontSize: 14, fontFamily: 'Archivo_600SemiBold', color: theme.colors.textPrimary, marginTop: 3 }}>{row.newName}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      <View style={{ marginTop: 12, gap: 8 }}>
        {rows.map((row, index) => <DiffRow key={`${row.text}:${index}`} {...row} />)}
      </View>
    </Card>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: fails until Task 20 updates the AppShell call site to pass `currentPlan`/`pendingPlan` — acceptable at this point in the sequence (same pattern as Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/screens/EvolutionUnlockScreen.tsx
git commit -m "Adiciona lista real de troca de exercicios na prevista de evolucao (nome antigo/novo por sessao)"
```

---

## Phase 5 — Celebration animation + new-workout reveal (sections 4-5)

### Task 18: `EvolutionCelebration` — full-screen animation

**Files:**
- Create: `src/components/evolution/EvolutionCelebration.tsx`
- Modify: `package.json` (add `expo-haptics`)

- [ ] **Step 1: Install `expo-haptics`**

Run: `npx expo install expo-haptics`
Expected: adds `expo-haptics` to `package.json` at the version compatible with the project's Expo SDK 56.

- [ ] **Step 2: Add i18n keys**

In `src/i18n/resources/pt-BR/evolution.json`, add a new top-level key:

```json
  "celebration": {
    "cycleDone": "CICLO {{number}} CONCLUÍDO",
    "levelDone": "NÍVEL DE INICIANTE CONCLUÍDO",
    "renewalDone": "NOVO COMEÇO",
    "cycleBigTop": "CICLO",
    "levelBigTop": "NÍVEL",
    "renewalBigTop": "CICLO",
    "renewalBigBottom": "RENOVADO",
    "cycleSub": "{{count}} exercícios novos no seu treino",
    "levelSub": "Seu programa ganhou uma nova estrutura",
    "renewalSub": "Os dias ativos voltam a contar",
    "tapHint": "Toque para ver seu novo treino"
  },
```

English:
```json
  "celebration": {
    "cycleDone": "CYCLE {{number}} COMPLETE",
    "levelDone": "BEGINNER LEVEL COMPLETE",
    "renewalDone": "A FRESH START",
    "cycleBigTop": "CYCLE",
    "levelBigTop": "LEVEL",
    "renewalBigTop": "CYCLE",
    "renewalBigBottom": "RENEWED",
    "cycleSub": "{{count}} new exercises in your workout",
    "levelSub": "Your program got a new structure",
    "renewalSub": "Active days start counting again",
    "tapHint": "Tap to see your new workout"
  },
```

Spanish:
```json
  "celebration": {
    "cycleDone": "CICLO {{number}} COMPLETADO",
    "levelDone": "NIVEL PRINCIPIANTE COMPLETADO",
    "renewalDone": "UN NUEVO COMIENZO",
    "cycleBigTop": "CICLO",
    "levelBigTop": "NIVEL",
    "renewalBigTop": "CICLO",
    "renewalBigBottom": "RENOVADO",
    "cycleSub": "{{count}} ejercicios nuevos en tu entrenamiento",
    "levelSub": "Tu programa tiene una nueva estructura",
    "renewalSub": "Los días activos vuelven a contar",
    "tapHint": "Toca para ver tu nuevo entrenamiento"
  },
```

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { CountUp } from '../home/CountUp';
import { Icon } from '../ui/Icon';
import type { PendingEvolutionType } from '../../workoutLifecycle/types';

type Phase = 0 | 1 | 2 | 3;

/**
 * Fires strictly after `activatePendingEvolution` has already returned
 * success (the caller, `AppShell.tsx`, only mounts this component once that
 * resolved) — this component never calls any activation logic itself, it is
 * pure presentation of an event that already happened. `onDone` hands off to
 * the new-workout reveal screen (Task 19).
 */
export function EvolutionCelebration({
  type,
  cycleNumber,
  swapCount,
  onDone,
}: {
  type: PendingEvolutionType;
  cycleNumber: number;
  swapCount: number;
  onDone: () => void;
}) {
  const { t } = useTranslation('evolution');
  const [phase, setPhase] = useState<Phase>(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setPhase(3);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const toExplosion = setTimeout(() => {
      setPhase(1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }, 1700);
    const toTitle = setTimeout(() => setPhase(2), 2500);
    const toDone = setTimeout(() => onDone(), 5200);
    return () => { clearTimeout(toExplosion); clearTimeout(toTitle); clearTimeout(toDone); };
  }, [reduceMotion, onDone]);

  if (phase === 3 || reduceMotion) {
    // Reduced-motion / final-phase shortcut: skip straight to the outcome
    // (Task 19 mounts immediately after `onDone`), per the design's own
    // "respect reduce motion" rule.
    useEffect(() => { onDone(); }, []); // eslint-disable-line react-hooks/rules-of-hooks
    return null;
  }

  const isRenewal = type === 'MOTIVATIONAL_RENEWAL';
  const isPromo = type === 'LEVEL_PROMOTION';
  const doneLabel = isPromo ? t('celebration.levelDone') : isRenewal ? t('celebration.renewalDone') : t('celebration.cycleDone', { number: cycleNumber });
  const bigTop = isPromo ? t('celebration.levelBigTop') : isRenewal ? t('celebration.renewalBigTop') : t('celebration.cycleBigTop');
  const bigBottom = isPromo ? t('evolution:level.INTERMEDIATE') : isRenewal ? t('celebration.renewalBigBottom') : String(cycleNumber).padStart(2, '0');
  const sub = isPromo ? t('celebration.levelSub') : isRenewal ? t('celebration.renewalSub') : t('celebration.cycleSub', { count: swapCount });

  return (
    <Pressable
      onPress={() => setPhase(3)}
      style={{ flex: 1, backgroundColor: '#020010', alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 210, height: 210, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={210} height={210} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Defs>
            <SvgLinearGradient id="celebrationRing" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#9fd6ff" />
              <Stop offset="1" stopColor="#0b70f9" />
            </SvgLinearGradient>
          </Defs>
          <Circle cx={105} cy={105} r={100} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} />
          <Circle cx={105} cy={105} r={100} fill="none" stroke="url(#celebrationRing)" strokeWidth={10} strokeLinecap="round" />
        </Svg>
        {phase === 0 ? (
          <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 54, color: '#fff' }}>
            <CountUp to={100} durationMs={1600} style={{ fontFamily: 'Anton_400Regular', fontSize: 54, color: '#fff' }} />
            <Text style={{ fontSize: 22, color: 'rgba(255,255,255,0.5)' }}>%</Text>
          </Text>
        ) : (
          <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: '#0b70f9', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={46} color="#fff" stroke={3} />
          </View>
        )}
      </View>

      <View style={{ alignItems: 'center', marginTop: 44, minHeight: 150 }}>
        {phase >= 1 && (
          <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 11, letterSpacing: 3, color: '#4da3ff' }}>
            {doneLabel}
          </Text>
        )}
        {phase >= 2 && (
          <>
            <View style={{ marginTop: 14, alignItems: 'center' }}>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 22, color: 'rgba(255,255,255,0.55)' }}>{bigTop}</Text>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: bigBottom.length > 6 ? 40 : 64, color: '#fff' }}>{bigBottom}</Text>
            </View>
            <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 16, textAlign: 'center' }}>{sub}</Text>
          </>
        )}
      </View>

      {phase >= 2 && (
        <Text style={{ position: 'absolute', bottom: 40, fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          {t('celebration.tapHint')}
        </Text>
      )}
    </Pressable>
  );
}
```

Note: the design's explosion-ring/particle burst (section 4, step 2) is a pure cosmetic flourish layered on top of the same phase machine above. It is intentionally left out of this first pass to keep the component's correctness easy to verify (phase timing, haptics, reduce-motion, hand-off to Task 19 are the parts with real behavior); adding the particle burst is a safe, isolated follow-up (purely decorative `View`s with `react-native-reanimated` `withTiming`/`withDelay`, no state/logic impact) that can be layered in without touching anything else in this file.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/evolution/EvolutionCelebration.tsx src/i18n/resources/pt-BR/evolution.json src/i18n/resources/en/evolution.json src/i18n/resources/es/evolution.json package.json package-lock.json
git commit -m "Adiciona EvolutionCelebration (animacao de evolucao atingida) e expo-haptics"
```

---

### Task 19: `NewPlanRevealScreen` — section 5

**Files:**
- Create: `src/screens/NewPlanRevealScreen.tsx`

- [ ] **Step 1: Add i18n keys**

In `src/i18n/resources/pt-BR/evolution.json`, add:

```json
  "reveal": {
    "kicker": "SEU NOVO TREINO",
    "cycleTitle": "CICLO {{number}}.",
    "levelTitle": "{{level}}.",
    "renewalTitle": "CICLO RENOVADO.",
    "cycleSubtitle": "Mesmas séries, repetições e descanso · exercícios renovados",
    "levelSubtitle": "Nova divisão · frequência semanal mantida",
    "renewalSubtitle": "Mesmo plano · contador reiniciado",
    "newCount": "NOVOS",
    "exerciseCount": "EXERCÍCIOS",
    "perWeek": "X POR SEMANA",
    "exercisesLabel": "exercícios",
    "newLabel": "NOVO",
    "before": "antes: {{name}}",
    "ctaCycle": "Começar ciclo {{number}} →",
    "ctaLevel": "Começar nível {{level}} →",
    "ctaRenewal": "Começar ciclo renovado →"
  },
```

English:
```json
  "reveal": {
    "kicker": "YOUR NEW WORKOUT",
    "cycleTitle": "CYCLE {{number}}.",
    "levelTitle": "{{level}}.",
    "renewalTitle": "CYCLE RENEWED.",
    "cycleSubtitle": "Same sets, reps and rest · refreshed exercises",
    "levelSubtitle": "New split · weekly frequency kept",
    "renewalSubtitle": "Same plan · counter reset",
    "newCount": "NEW",
    "exerciseCount": "EXERCISES",
    "perWeek": "X PER WEEK",
    "exercisesLabel": "exercises",
    "newLabel": "NEW",
    "before": "before: {{name}}",
    "ctaCycle": "Start cycle {{number}} →",
    "ctaLevel": "Start {{level}} level →",
    "ctaRenewal": "Start renewed cycle →"
  },
```

Spanish:
```json
  "reveal": {
    "kicker": "TU NUEVO ENTRENAMIENTO",
    "cycleTitle": "CICLO {{number}}.",
    "levelTitle": "{{level}}.",
    "renewalTitle": "CICLO RENOVADO.",
    "cycleSubtitle": "Mismas series, repeticiones y descanso · ejercicios renovados",
    "levelSubtitle": "Nueva división · frecuencia semanal mantenida",
    "renewalSubtitle": "Mismo plan · contador reiniciado",
    "newCount": "NUEVOS",
    "exerciseCount": "EJERCICIOS",
    "perWeek": "X POR SEMANA",
    "exercisesLabel": "ejercicios",
    "newLabel": "NUEVO",
    "before": "antes: {{name}}",
    "ctaCycle": "Comenzar ciclo {{number}} →",
    "ctaLevel": "Comenzar nivel {{level}} →",
    "ctaRenewal": "Comenzar ciclo renovado →"
  },
```

- [ ] **Step 2: Implement**

```tsx
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme';
import { Icon } from '../components/ui/Icon';
import { workoutExercisesFromPlan } from './workoutScreenPlan';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import type { PendingEvolutionType } from '../workoutLifecycle/types';

export function NewPlanRevealScreen({
  type,
  cycleNumber,
  levelLabel,
  currentPlan,
  newPlan,
  locale,
  exerciseReplacements,
  onClose,
  onBegin,
}: {
  type: PendingEvolutionType;
  cycleNumber: number;
  levelLabel: string;
  currentPlan: FinalWorkoutPlan;
  newPlan: FinalWorkoutPlan;
  locale: string;
  exerciseReplacements: readonly { sessionIndex: number; slotIndex: number }[];
  onClose: () => void;
  onBegin: () => void;
}) {
  const { t } = useTranslation('evolution');
  const { theme } = useTheme();
  const isPromo = type === 'LEVEL_PROMOTION';
  const isRenewal = type === 'MOTIVATIONAL_RENEWAL';
  const [openSession, setOpenSession] = useState(0);

  const title = isPromo
    ? t('reveal.levelTitle', { level: levelLabel.toUpperCase() })
    : isRenewal
      ? t('reveal.renewalTitle')
      : t('reveal.cycleTitle', { number: cycleNumber });
  const subtitle = isPromo ? t('reveal.levelSubtitle') : isRenewal ? t('reveal.renewalSubtitle') : t('reveal.cycleSubtitle');
  const newSlotsBySession = new Map<number, Set<number>>();
  exerciseReplacements.forEach((r) => {
    if (!newSlotsBySession.has(r.sessionIndex)) newSlotsBySession.set(r.sessionIndex, new Set());
    newSlotsBySession.get(r.sessionIndex)!.add(r.slotIndex);
  });
  const totalExercises = newPlan.sessions.reduce((sum, session) => sum + session.exercises.length, 0);
  const newCount = isPromo ? totalExercises : exerciseReplacements.length;
  const cta = isPromo
    ? t('reveal.ctaLevel', { level: levelLabel })
    : isRenewal
      ? t('reveal.ctaRenewal')
      : t('reveal.ctaCycle', { number: cycleNumber });

  return (
    <View style={{ flex: 1, backgroundColor: '#020010' }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 62, paddingBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 2.5, color: 'rgba(255,255,255,0.32)' }}>
            // {t('reveal.kicker')}
          </Text>
          <Pressable
            onPress={onClose}
            style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="x" size={15} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 46, color: '#fff', marginTop: 14 }}>{title}</Text>
        <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', marginTop: 10 }}>{subtitle}</Text>

        <View style={{ flexDirection: 'row', marginTop: 26, paddingVertical: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
          {[
            [String(newCount), t('reveal.newCount')],
            [String(totalExercises), t('reveal.exerciseCount')],
            [`${newPlan.sessions.length}X`, t('reveal.perWeek')],
          ].map(([value, label], index) => (
            <View key={label} style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 28, color: index === 0 && newCount > 0 ? '#4da3ff' : '#fff' }}>{value}</Text>
              <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 10, letterSpacing: 1.6, color: 'rgba(255,255,255,0.38)', marginTop: 4 }}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={{ marginTop: 10 }}>
          {newPlan.sessions.map((session, sessionIndex) => {
            const isOpen = openSession === sessionIndex;
            const newSlots = newSlotsBySession.get(sessionIndex) ?? new Set<number>();
            const exercises = workoutExercisesFromPlan(newPlan, locale, sessionIndex);
            const oldExercises = workoutExercisesFromPlan(currentPlan, locale, sessionIndex);
            return (
              <View key={session.sessionId ?? sessionIndex} style={{ borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' }}>
                <Pressable
                  onPress={() => setOpenSession(isOpen ? -1 : sessionIndex)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 }}
                >
                  <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 22, width: 18, color: isOpen ? '#fff' : 'rgba(255,255,255,0.45)' }}>
                    {String.fromCharCode(65 + sessionIndex)}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15.5, fontFamily: 'Archivo_700Bold', color: '#fff' }}>{session.name ?? ''}</Text>
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
                      {session.exercises.length} {t('reveal.exercisesLabel')}
                      {newSlots.size > 0 ? ` · ${newSlots.size} ${t('reveal.newLabel').toLowerCase()}` : ''}
                    </Text>
                  </View>
                  <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color="rgba(255,255,255,0.45)" />
                </Pressable>
                {isOpen && (
                  <View style={{ paddingLeft: 32, paddingBottom: 14 }}>
                    {exercises.map((exercise, slotIndex) => {
                      const isNew = newSlots.has(slotIndex);
                      const oldName = oldExercises[slotIndex]?.name;
                      return (
                        <View key={slotIndex} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
                          <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 11, color: 'rgba(255,255,255,0.35)', width: 18 }}>
                            {String(slotIndex + 1).padStart(2, '0')}
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontFamily: 'Archivo_600SemiBold', color: isNew || isPromo ? '#fff' : 'rgba(255,255,255,0.75)' }}>
                              {exercise.name}
                            </Text>
                            {isNew && oldName && (
                              <Text style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                                {t('reveal.before', { name: oldName })}
                              </Text>
                            )}
                          </View>
                          {(isNew || isPromo) && (
                            <Text style={{ fontFamily: 'JetBrainsMono_400Regular', fontSize: 9, letterSpacing: 1.2, color: '#4da3ff', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(11,112,249,0.14)', borderWidth: 1, borderColor: 'rgba(77,163,255,0.4)' }}>
                              {t('reveal.newLabel')}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ padding: 24 }}>
        <Pressable
          onPress={onBegin}
          style={{ height: 58, borderRadius: 12, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontFamily: 'Anton_400Regular', fontSize: 17, letterSpacing: 1.5, color: '#fff' }}>{cta.toUpperCase()}</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/screens/NewPlanRevealScreen.tsx src/i18n/resources/pt-BR/evolution.json src/i18n/resources/en/evolution.json src/i18n/resources/es/evolution.json
git commit -m "Adiciona NewPlanRevealScreen (tela do novo treino, secao 5 do redesign)"
```

---

### Task 20: Orchestrate the full flow from `AppShell.tsx`

**Files:**
- Modify: `src/screens/AppShell.tsx`

- [ ] **Step 1: Add the celebration/reveal state machine**

Near the other `showEvolutionUnlock` state, add:

```ts
  const [evolutionCelebration, setEvolutionCelebration] = useState<{
    type: PendingEvolutionType;
    cycleNumber: number;
    levelLabel: string;
    currentPlan: FinalWorkoutPlan;
    newPlan: FinalWorkoutPlan;
    exerciseReplacements: PrescriptionDiffSummary['exerciseReplacements'];
    swapCount: number;
    phase: 'celebrating' | 'reveal';
  } | null>(null);
```

Add the two necessary imports:

```ts
import { EvolutionCelebration } from '../components/evolution/EvolutionCelebration';
import { NewPlanRevealScreen } from './NewPlanRevealScreen';
import type { PendingEvolutionType } from '../workoutLifecycle/types';
import type { FinalWorkoutPlan } from '../workoutPrescription/types';
import type { PrescriptionDiffSummary } from '../workoutEvolution/diff';
```

- [ ] **Step 2: Capture the plan pair before activating, trigger the celebration instead of closing immediately**

Replace the existing `onStart` on `<EvolutionUnlockScreen ... />`:

```tsx
            onStart={() => {
              void evolution.start().then(async (activated) => {
                if (!activated) return;
                await reloadPrescription();
                setShowEvolutionUnlock(false);
              });
            }}
```

with:

```tsx
            onStart={() => {
              // Capture the plan pair BEFORE activating — once `evolution.start()`
              // resolves, `prescription.plan` will already be the new plan and
              // `evolution.pendingPlan` will be cleared, so the celebration/reveal
              // flow needs its own frozen snapshot, not a live read.
              const capturedCurrentPlan = prescription.status === 'SUCCESS' ? prescription.plan : null;
              const capturedPendingPlan = evolution.pendingPlan;
              const capturedDiff = evolution.diff;
              const capturedViewModel = evolution.viewModel;
              void evolution.start().then(async (activated) => {
                if (!activated) return;
                await reloadPrescription();
                setShowEvolutionUnlock(false);
                if (capturedCurrentPlan && capturedPendingPlan
                  && (capturedViewModel.kind === 'EVOLUTION_READY' || capturedViewModel.kind === 'EVOLUTION_DEFERRED')) {
                  setEvolutionCelebration({
                    type: capturedViewModel.pending.type,
                    cycleNumber: capturedViewModel.summary.cycleNumber,
                    levelLabel: capturedViewModel.pending.toLevel,
                    currentPlan: capturedCurrentPlan,
                    newPlan: capturedPendingPlan,
                    exerciseReplacements: capturedDiff?.exerciseReplacements ?? [],
                    swapCount: capturedDiff?.exerciseReplacements.length ?? 0,
                    phase: 'celebrating',
                  });
                }
              });
            }}
```

- [ ] **Step 3: Pass the plan pair into `EvolutionUnlockScreen` (resolves Task 17's props)**

Change:

```tsx
          <EvolutionUnlockScreen
            viewModel={evolution.viewModel}
            diff={evolution.diff}
```

to:

```tsx
          <EvolutionUnlockScreen
            viewModel={evolution.viewModel}
            diff={evolution.diff}
            currentPlan={prescription.status === 'SUCCESS' ? prescription.plan : null}
            pendingPlan={evolution.pendingPlan}
```

- [ ] **Step 4: Pass the real `diff` into `PendingEvolutionBanner` (resolves Task 16 Step 4's `diff={null}` placeholder)**

In the `<HomeScreen ... />` call site(s), the `evolutionViewModel` prop is already `evolution.viewModel` — `HomeScreen` itself renders `PendingEvolutionBanner` internally (Task 16), which currently hardcodes `diff={null}`. Add a `diff` prop to `HomeScreen`'s own prop type and pass it through from here:

```tsx
            evolutionViewModel={evolution.viewModel}
            evolutionDiff={evolution.diff}
```

Then in `src/screens/HomeScreen.tsx`, add `evolutionDiff?: PrescriptionDiffSummary | null;` to the prop type (default `null`), destructure it, and change the Task 16 Step 4 call site from `diff={null}` to `diff={evolutionDiff}`.

- [ ] **Step 5: Mount the celebration and reveal screens**

Add, near the other full-screen modals in `AppShell.tsx` (after the `<Modal visible={showEvolutionUnlock} ...>` block):

```tsx
      {evolutionCelebration?.phase === 'celebrating' && (
        <View style={{ position: 'absolute', inset: 0 }}>
          <EvolutionCelebration
            type={evolutionCelebration.type}
            cycleNumber={evolutionCelebration.cycleNumber}
            swapCount={evolutionCelebration.swapCount}
            onDone={() => setEvolutionCelebration((current) => current ? { ...current, phase: 'reveal' } : null)}
          />
        </View>
      )}
      {evolutionCelebration?.phase === 'reveal' && (
        <View style={{ position: 'absolute', inset: 0 }}>
          <NewPlanRevealScreen
            type={evolutionCelebration.type}
            cycleNumber={evolutionCelebration.cycleNumber}
            levelLabel={evolutionCelebration.levelLabel}
            currentPlan={evolutionCelebration.currentPlan}
            newPlan={evolutionCelebration.newPlan}
            locale={i18n.language}
            exerciseReplacements={evolutionCelebration.exerciseReplacements}
            onClose={() => setEvolutionCelebration(null)}
            onBegin={() => setEvolutionCelebration(null)}
          />
        </View>
      )}
```

(`i18n` must already be in scope in `AppShell.tsx` via its own `useTranslation()` call — if the existing call destructures only `{ t }`, change it to `{ t, i18n }`.)

- [ ] **Step 6: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors — this resolves every intentional break left open since Tasks 7 and 17.

- [ ] **Step 7: Commit**

```bash
git add src/screens/AppShell.tsx src/screens/HomeScreen.tsx
git commit -m "Orquestra celebracao de evolucao e tela de novo treino a partir do AppShell"
```

---

## Phase 6 — Verification

### Task 21: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Lint**

Run: `npx eslint src --ext .ts,.tsx`
Expected: zero errors (warnings acceptable only if they already existed before this plan — compare against `git stash`/`main` if unsure).

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including every test file touched/added in this plan (`evoRingMetrics.test.ts`, `viewModel.test.ts`) and every pre-existing suite (especially `src/workoutEvolution/__tests__/*`, `src/home/__tests__/*`, `src/screens/__tests__/homeScreenMissedPendingNotice.test.ts`, `src/screens/__tests__/homeInitialVisualReadyStructure.test.ts`, and `src/lib/__tests__/workoutLogicIntact.test.ts`).

- [ ] **Step 4: Manually run the app and walk the golden path**

Using the `run` skill or `npx expo start`, verify on a simulator/device:
1. Home renders the new header, HUD ticker, cycle ring (with real % and status text), streak flame (lit if `streak.current > 0`), adherence bar, frequency heatmap (GitHub-grid orientation), and the existing Today card/start CTA unchanged in behavior.
2. If an evolution is pending on the test account, the pending banner appears and opens the restyled preview sheet with the real exercise swap list.
3. Activating it (`Ativar ciclo N`) plays the celebration sequence, then the new-workout reveal screen, then returns to Home showing the new cycle at 0%.
4. `TreinoScreen.tsx` (the in-progress, uncommitted work) still renders its own `EvolutionTicker`/`WeeklyOverview` exactly as before — confirm no visual regression there, proving the shared-component boundary (rule 8) held.

- [ ] **Step 5: Fix any fallout, re-run Steps 1-3, then do a final commit if anything changed**

```bash
git add -A
git commit -m "Ajustes finais de verificacao do redesign da Home" --allow-empty
```

---

## Summary of data repassed/exposed (rule 4/10 compliance record)

Keep this section in the final PR description:

- `ProgressingSummary.adherenceRatio` — `ProgressionDecision.adherence.ratio`, already computed by the engine, previously dropped by `buildProgressingSummary`.
- `ProgressingSummary.requiredActiveDays` — same per-level constant (`PROGRESSION_V2_CONFIG.beginnerMinimumActiveDays`/`intermediateAdvancedMinimumActiveDays`) the engine's own (private, unexported) `minimumActiveDaysForLevel` uses — duplicated in `src/home/evoRingMetrics.ts` rather than exporting the engine's private helper, to avoid editing any file under `progressionEngineV2/`.
- `ProgressingSummary.pausedAtLocalDate` / `intermediateCyclesEarned` — `ProgressionSnapshotV2.activeTime.pausedAt` / `.earnedIntermediateCycleCount`, already computed by `services/workoutProgressionV2.ts`, read via a new, separate call to the already-exported `evaluateProgressionV2ForUserFull` from `useWorkoutEvolution.ts` — a second evaluation per Home load, accepted cost, never touches `progressionEngineV2/` or the protected `persistEarnedFact`/`evolvePrescription`/`activatePendingEvolution`/`deferPendingEvolution` chain in `services/workoutLifecycleApplication.ts`.
- `WorkoutEvolutionController.pendingPlan` — the same `FinalWorkoutPlan` object `diff` was already computed from inside `useWorkoutEvolution.ts`, simply also returned.
- Home's real streak — a new, dedicated bounded Firestore read (`useHomeStreak.ts`, reusing `fetchWidgetStreakHistory`/`computeStreak` unmodified) — the one genuinely new read this redesign introduces, approved explicitly by the user after confirming no existing Home data was sufficient.
- Exercise display names in the swap list (sections 3 and 5) — `workoutExercisesFromPlan` (already exported, already used by `WorkoutScreen.tsx`), applied to the already-available `currentPlan`/`pendingPlan` pair.

## Explicit omissions (per user decisions during spec)

- "SEMANA 07" in the header — omitted; no cycle-start-date concept exists anywhere.
- Frequency heatmap intensity — binary (2-level), not 5-level; no intensity data source exists.
- Frequency heatmap window — kept at the existing 30 days, not extended to 18 weeks; reskinned to the GitHub-grid orientation only.
- `ProgramProgressStrip`, `WeeklyOverview`, `UpcomingWorkouts`/`UpcomingWorkoutDetailModal` — removed from `HomeScreen.tsx`'s render tree only; the components/hooks themselves are untouched and still available if needed elsewhere later.
