# Home Bootstrap Perf Audit — Phase 2 (Safe Dedupe + Plateau Diagnosis)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate only provably-safe duplicate Firestore reads inside Evolution's own resolution (2A), then diagnose — without changing production behavior — why 5 "parallel" reads inside `evolution_progression` each cost ~1.0–1.5s (2B). No visual/overlay change, no authority change, no pre-mount work.

**Architecture:** Two narrowly-scoped dedupes, each mirroring an already-proven pattern in this codebase (the `useWorkoutPrescription` bootstrap handoff) rather than introducing a new caching layer. Both are additive/optional — when the handed-off value is unavailable, behavior is byte-identical to today. 2B adds a DEV-only, env-flag-gated code path (default off, zero production effect) to directly A/B "5 reads in parallel" vs "the same 5 reads run sequentially," since Phase 1's existing trace data already proves the 5 reads start within 0–12ms of each other (true concurrency, not disguised serialization) but doesn't yet show whether concurrency itself adds contention.

**Tech Stack:** TypeScript, `src/services/workoutLifecycleApplication.ts`, `src/workoutEvolution/useWorkoutEvolution.ts`, `src/workoutPrescription/useWorkoutReadinessGate.ts`, `src/scheduleEngine/useWorkoutSchedule.ts`, `src/services/workoutProgressionV2.ts`, same cold-start tooling from Phase 1 (`scripts/coldStartPerfRun.sh`, `scripts/analyzeHomeBootstrapPerf.mjs`).

---

## Scope decision (read before executing)

Phase 1 found 4 duplicated resources. This plan implements the **2 highest-confidence, most narrowly-scoped fixes** and explicitly defers the other 2 candidates — mirroring how Phase 1 itself scoped down from the user's full 20-step ask. Rationale below (Part 0). Per the user's own Part 8/22 rules, each fix gets its own 5-cold-start A/B and can be independently reverted; nothing here is a batch, all-or-nothing change.

**Implemented in this plan:**
1. Lifecycle-bundle passthrough (`ReconcileResult.lifecycle`) — removes 1 of 4 `workout_lifecycle.bundle` reads.
2. Schedule-config bootstrap handoff (readiness-gate → Today) — removes 1 of 3 `workout_schedule.config` reads.

**Explicitly deferred (documented, not implemented — see Part 0):**
- `user_profile.document` dedupe (qaMode passthrough) — Class A, zero write-risk, but needs 4-file signature threading (deepest change of all candidates). Do in a follow-up round after seeing whether 1+2 already move the numbers enough to justify the added surface area.
- `workout_programs.snapshot` dedupe — needs a runtime `activeContentIdentity` equality check the investigation could not confirm holds in every branch; not safe to implement without that proof first.
- `evolution_progression`'s own `schedule_config` read (the 3rd of 3) — same deep-threading shape as the profile dedupe; deferred alongside it.

---

## Part 0: Call graph (grounded, corrects/completes Phase 1's provisional attribution)

### `workout_lifecycle.bundle` (4 reads)

| # | Caller | file:line | Branch | Write between this read and the next? | Class |
|---|---|---|---|---|---|
| 1 | `loadActiveWorkoutProgram` | `workoutPrograms.ts:403` | Prescription, pre-mount | No (only if `NO_V2_STATE` migration branch runs — not the traced path) | D |
| 2 | `reconcileWorkoutLifecycle`'s own `lifecycle` | `workoutLifecycleApplication.ts:1109` | Every reconcile call | **Usually none** — `recovery.lifecycle` already satisfies this in the traced path, so this line frequently does NOT issue a fresh read at all (confirmed: no `workout_lifecycle.bundle` count increment immediately after `evolution_reconcile_lifecycle_ready` in the traced runs) | — (not a real 3rd/4th occurrence; already free) |
| 3 | `loadOutstandingEarnedFact` (inside `prepareEvolutionAttempt`'s `!pending` branch) | `workoutLifecycleApplication.ts:122-125` | NO_ACTION path (traced 10/10) | None in this branch — `prepareEvolutionAttempt` returns immediately at line 368 once `noAction` is true, before any write | **A** |
| 4 | `evaluateProgressionV2ForUserFull`'s own bundle read | `workoutProgressionV2.ts:199-218`, via `loadWorkoutLifecycleDeduped` | Same NO_ACTION path, called from `prepareEvolutionAttempt:358` | None (same branch, no write yet) | **A**, same value as #3 (~350-450ms apart, sequential — `createInFlightDedupe`'s in-flight map has already cleared by the time this runs, so the existing dedupe infra does NOT catch this) |
| 5 | `useWorkoutEvolution.load()`'s own `loadWorkoutLifecycleDeduped` | `useWorkoutEvolution.ts:185` | Runs unconditionally after `reconcileWorkoutLifecycle` returns | **Branch-dependent** — safe (no write occurred) in the NO_ACTION (`ReconcileResult` line 1125-1132) and STALE_REPREPARED (line 1183-1188) branches, since those are the exact two branches that already thread `progressionDecision` back for the identical reason. **Unsafe** in the auto-activation branch (`activatePendingEvolution` just wrote a new active instance) and the plain cleanup branch (transaction just ran) — those two don't currently expose `progressionDecision` either, so this read already stays fresh there by the existing fallback (`reconciledDecision === undefined`). | **D** in NO_ACTION/STALE_REPREPARED only |

(Renumbered from Phase 1's provisional 1-4 to this 1-5 list because #2 usually isn't a real fetch — the actual 4 observed reads per cold start are #1, #3, #4, #5.)

**This plan implements: #3→#4 reuse is already free in practice once #4 doesn't refetch (see Task 1 below — the fix targets #5, the `useWorkoutEvolution.load()` read, since that's the one with no in-scope alternative today). #3/#4 are only ~350-450ms apart and already low-value to dedupe further given the complexity; the highest-value, safest single fix is #5.**

### `workout_schedule.config` (3 reads)

| # | Caller | file:line | Purpose | Write between reads? | Class |
|---|---|---|---|---|---|
| 1 | `useWorkoutReadinessGate` | `useWorkoutReadinessGate.ts:140` | Pre-mount existence check only — `existingConfig`'s value is discarded either way (`if (!existingConfig)` creates one; if found, the value itself is never used further) | If not found: `ensureScheduleConfigFromQuestionnaire` writes one (line 142-150) → next read (#2) MUST be fresh. If found: no write. | **A when found, B when not found** — branch-dependent, decided at read time |
| 2 | `useWorkoutSchedule` (Today) | `useWorkoutSchedule.ts:144` | Today's real resolution | Possible internal `ensureScheduleConfigFromQuestionnaire` (line 154/161) only if #1 also found nothing — same identity as #1's write | — |
| 3 | `evaluateProgressionV2ForUserFull` | `workoutProgressionV2.ts:229` | Progression's adherence/timezone input | None between #2 and #3 in the traced NO_ACTION path | A vs #2, but needs deep threading (deferred — see Scope decision) |

**This plan implements the #1→#2 handoff** (Task 2), conditional on #1 having found an existing config (the common case for this test account and any already-onboarded user).

### `workout_programs.snapshot` (2 reads) — deferred, not implemented here

`loadActiveWorkoutProgram` (`workoutPrograms.ts:417`) vs. `loadAuthoritativePrescribedSessions` (`workoutProgressionV2.ts:290-296`, keyed by `bundle.lifecycle.activeContentIdentity`). Safe reuse requires confirming `activeContentIdentity` at read #2 always equals prescription's own `programId` at read #1 — true in the steady state, **not proven for every branch** (evolution activation changes `activeContentIdentity`). Needs a dedicated identity-equality investigation before any fix — out of scope for this plan.

### `user_profile.document` (2 reads) — deferred, not implemented here

Both via the exact same `getUserProfile(uid)` (`userProfile.ts:361-373`). Read #2 (`resolveWorkoutLifecycleProgressionPolicy` → `qaPolicy.ts:38-44`) only consumes `metadata.workoutLifecycleQaMode`/`workoutLifecycleQaAccelerated` — fields the client can never write (Firestore Rules restrict `users/{uid}` client updates to `metadata.updatedAt` only). **Class A, zero write-risk** — the safest classification of any candidate in this report — but `AuthContext`'s already-resolved `profile` lives in React/`AppShell` scope, while `resolveWorkoutLifecycleProgressionPolicy` is a plain function 3 call-layers below `useWorkoutEvolution.load()`. Reuse needs an optional parameter threaded through `useWorkoutEvolution` → `reconcileWorkoutLifecycle` → `prepareEvolutionAttempt` → `evaluateProgressionV2ForUserFull` → `resolveWorkoutLifecycleProgressionPolicy` (4 files). Deferred to a follow-up round per the Scope decision above, not because it's risky, but because it's the largest single diff of all candidates and deserves its own dedicated pass + A/B rather than being bundled here.

### In-flight dedupe infra (`src/lib/inFlightDedupe.ts`)

`createInFlightDedupe<T>()` only helps **concurrent** callers sharing a key; it provides zero benefit here because every duplicate pair above is **sequential** (hundreds of ms apart, map entry already cleared). Not a fix for any of these — noted so no one reaches for it as a shortcut.

---

## Task 1: Lifecycle-bundle passthrough (removes `workout_lifecycle.bundle` read #5)

**Files:**
- Modify: `src/services/workoutLifecycleApplication.ts` (`ReconcileResult` type + the NO_ACTION and STALE_REPREPARED return statements)
- Modify: `src/workoutEvolution/useWorkoutEvolution.ts:174-191`

- [ ] **Step 1: Find and read the `ReconcileResult` type definition**

Run: `grep -n "interface ReconcileResult\|type ReconcileResult" src/services/workoutLifecycleApplication.ts`

Confirm its current shape (expected, per Phase 1/2 investigation: `{ prepared: boolean; autoActivated: boolean; staleClearedPendingEvolution: boolean; progressionDecision?: ProgressionDecision | null; program?: ... }`). Add one optional field:

```typescript
  /**
   * The lifecycle bundle this reconciliation already loaded internally —
   * populated ONLY in branches that are provably still valid when reconcile
   * returns (no write happened after this exact object was captured). Lets
   * `useWorkoutEvolution.load()` skip its own re-read instead of trusting a
   * potentially-stale value blindly. Absent (not just null) in every branch
   * where a write occurred after the bundle was captured — the caller MUST
   * treat "absent" as "re-fetch", never substitute a stale one.
   */
  lifecycle?: NonNullable<Awaited<ReturnType<typeof loadWorkoutLifecycle>>>;
```

- [ ] **Step 2: Populate it in the NO_ACTION branch only**

In `reconcileWorkoutLifecycle`, the NO_ACTION branch currently (around line 1125-1132):

```typescript
      const response: ReconcileResult = {
        prepared: result.status === 'PREPARED',
        autoActivated: false,
        staleClearedPendingEvolution: false,
        ...(result.status === 'NO_ACTION' ? { progressionDecision: result.decision ?? null } : {}),
      };
```

Change to also carry `lifecycle` — but ONLY in the exact same `NO_ACTION` conditional (never in the `PREPARED` case, since `prepareEvolutionAttempt`'s PREPARED path writes a pending evolution and re-reads lifecycle itself at line 406-409, meaning the `lifecycle` captured at the top of `reconcileWorkoutLifecycle` could be stale relative to that write):

```typescript
      const response: ReconcileResult = {
        prepared: result.status === 'PREPARED',
        autoActivated: false,
        staleClearedPendingEvolution: false,
        ...(result.status === 'NO_ACTION' ? { progressionDecision: result.decision ?? null, lifecycle } : {}),
      };
```

(`lifecycle` here is the same in-scope variable from line 1109 — no new read.)

- [ ] **Step 3: Populate it in the STALE_REPREPARED branch, same guard**

Around line 1183-1188:

```typescript
      const response: ReconcileResult = {
        prepared: reprepared.status === 'PREPARED' || reprepared.status === 'ALREADY_PENDING',
        autoActivated: false,
        staleClearedPendingEvolution: true,
        ...(reprepared.status === 'NO_ACTION' ? { progressionDecision: reprepared.decision ?? null } : {}),
      };
```

Change identically:

```typescript
      const response: ReconcileResult = {
        prepared: reprepared.status === 'PREPARED' || reprepared.status === 'ALREADY_PENDING',
        autoActivated: false,
        staleClearedPendingEvolution: true,
        ...(reprepared.status === 'NO_ACTION' ? { progressionDecision: reprepared.decision ?? null, lifecycle } : {}),
      };
```

Do **not** touch the auto-activation branch (line 1207-1213) or the plain cleanup branch (line 1135-1150) — leave them exactly as-is. This is the entire safety boundary of this task; do not extend it without re-deriving write-safety for those branches first.

- [ ] **Step 4: Consume it in `useWorkoutEvolution.load()`**

Current (`useWorkoutEvolution.ts:174-191`):

```typescript
      let reconciledDecision: ProgressionDecision | null | undefined;
      if (!options?.skipReconcile) {
        const reconcileResult = await reconcileWorkoutLifecycle({
          uid: user.uid,
          trigger: options?.trigger ?? (hasLoadedOnce.current ? 'RECOVERY' : 'COLD_START'),
        });
        reconciledDecision = reconcileResult.progressionDecision;
      }
      recordPerfMark('evolution_reconcile_ready');

      const [lifecycle, pendingAfter, decision] = await Promise.all([
        loadWorkoutLifecycleDeduped(user.uid),
        loadPendingEvolution(user.uid),
        reconciledDecision !== undefined
          ? Promise.resolve(reconciledDecision)
          : evaluateProgressionV2ForUser(user.uid),
      ]);
      recordPerfMark('evolution_lifecycle_pending_progression_ready');
```

Change to:

```typescript
      let reconciledDecision: ProgressionDecision | null | undefined;
      let reconciledLifecycle: Awaited<ReturnType<typeof loadWorkoutLifecycleDeduped>> | undefined;
      if (!options?.skipReconcile) {
        const reconcileResult = await reconcileWorkoutLifecycle({
          uid: user.uid,
          trigger: options?.trigger ?? (hasLoadedOnce.current ? 'RECOVERY' : 'COLD_START'),
        });
        reconciledDecision = reconcileResult.progressionDecision;
        reconciledLifecycle = reconcileResult.lifecycle;
      }
      recordPerfMark('evolution_reconcile_ready');

      const [lifecycle, pendingAfter, decision] = await Promise.all([
        reconciledLifecycle !== undefined
          ? Promise.resolve(reconciledLifecycle)
          : loadWorkoutLifecycleDeduped(user.uid),
        loadPendingEvolution(user.uid),
        reconciledDecision !== undefined
          ? Promise.resolve(reconciledDecision)
          : evaluateProgressionV2ForUser(user.uid),
      ]);
      recordPerfMark('evolution_lifecycle_pending_progression_ready');
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `ReconcileResult`'s exact current field names differ from what's assumed above (Step 1's grep result), adjust the diff to match — do not guess field names without checking.

- [ ] **Step 6: Run the existing lifecycle/evolution test suites**

Run: `npx vitest run src/workoutEvolution src/services/__tests__/workoutLifecycleApplication* 2>&1 | tail -60` (adjust the glob once Step 1 confirms exact test file locations via `find src -iname "*workoutLifecycleApplication*test*" -o -iname "*useWorkoutEvolution*test*"`)
Expected: PASS. If any test asserts `ReconcileResult`'s exact shape (e.g. a snapshot of its keys), update the fixture to include the new optional `lifecycle` field — do not weaken the assertion, extend it.

- [ ] **Step 7: Commit**

```bash
git add src/services/workoutLifecycleApplication.ts src/workoutEvolution/useWorkoutEvolution.ts
git commit -m "perf: thread reconcile's already-loaded lifecycle bundle to skip a redundant re-read

Only in the NO_ACTION and STALE_REPREPARED branches, mirroring the
existing progressionDecision passthrough for the same write-safety reason.
Every other branch (auto-activation, plain cleanup) keeps its fresh read
unchanged."
```

- [ ] **Step 8: A/B — 5 cold starts before, 5 after**

This step requires the Metro dev server running with `EXPO_PUBLIC_PERF_TRACE=1` on the port the dev client expects (confirmed in Phase 1: port 8082) and the iPhone 17 Pro Simulator booted with an already-authenticated session — same setup as Phase 1 Task 5.

Before implementing (i.e., run this on the commit immediately BEFORE Task 1's changes — `git stash` or check out the prior commit into a throwaway state, run, then restore):
```bash
scripts/coldStartPerfRun.sh 5 task1-before /tmp/metro-perf-8082.log
node scripts/analyzeHomeBootstrapPerf.mjs perf-runs/task1-before-run-*.log
```

After (on Task 1's actual commit):
```bash
scripts/coldStartPerfRun.sh 5 task1-after /tmp/metro-perf-8082.log
node scripts/analyzeHomeBootstrapPerf.mjs perf-runs/task1-after-run-*.log
```

Compare, for both sets: max count of `workout_lifecycle.bundle` per run (expect 4→3), `home_evolution_ready`/`home_initial_data_settled` percentiles, and last-blocker distribution. Record the comparison in the Phase 2 report (Part H/I) — do not just eyeball it.

**Keep if:** `workout_lifecycle.bundle`'s max count actually drops to 3 in every after-run, no test failures, no new error in `evolution_authoritative_ready`'s reach rate (must still hit 5/5). **Revert if:** the count doesn't drop (means the guard conditions weren't hit in these particular runs — try again before concluding, since NO_ACTION should be the common branch per Phase 1's 10/10) or any semantic difference appears.

---

## Task 2: Schedule-config bootstrap handoff (removes `workout_schedule.config` read #1→#2 duplication)

**Files:**
- Create: `src/scheduleEngine/scheduleConfigBootstrapHandoff.ts` (mirrors the existing prescription handoff's shape)
- Modify: `src/workoutPrescription/useWorkoutReadinessGate.ts:138-157`
- Modify: `src/scheduleEngine/useWorkoutSchedule.ts:142-144`

- [ ] **Step 1: Read the exact existing prescription handoff to mirror its shape precisely**

Run: `sed -n '1,60p' src/workoutPrescription/useWorkoutPrescription.ts` and find `setWorkoutPrescriptionBootstrapHandoff`/`takeWorkoutPrescriptionBootstrapHandoff`'s definition (likely in the same file or a sibling module — confirm with `grep -rn "WorkoutPrescriptionBootstrapHandoff" src`). Copy its exact module-variable + uid-matching + clear-after-take shape for the new module below — do not invent a different mechanism.

- [ ] **Step 2: Create the new handoff module**

Create `src/scheduleEngine/scheduleConfigBootstrapHandoff.ts`:

```typescript
import type { ScheduleConfig } from './types';

/**
 * Bootstrap-only handoff (NOT a cache — see docs/superpowers/plans/
 * 2026-09-22-home-bootstrap-perf-audit-phase2.md Task 2): lets
 * `useWorkoutReadinessGate`'s pre-mount existence check pass its already-
 * resolved `ScheduleConfig` to `useWorkoutSchedule`'s first resolve,
 * avoiding a second read of the same document a few hundred ms later.
 *
 * ONLY ever set when the readiness gate found an EXISTING config (i.e. it
 * did NOT write one) — the caller is responsible for never setting this
 * when `ensureScheduleConfigFromQuestionnaire` ran, since that write makes
 * any earlier read stale. Consumed exactly once per uid, then cleared, so a
 * later `useWorkoutSchedule` remount (identity switch, logout/login) always
 * re-fetches.
 */
let handoff: { uid: string; config: ScheduleConfig } | null = null;

export function setScheduleConfigBootstrapHandoff(uid: string, config: ScheduleConfig): void {
  handoff = { uid, config };
}

export function takeScheduleConfigBootstrapHandoff(uid: string): ScheduleConfig | undefined {
  if (!handoff || handoff.uid !== uid) return undefined;
  const { config } = handoff;
  handoff = null;
  return config;
}
```

(Adjust the `ScheduleConfig` import path if Step 1's exploration finds the type lives elsewhere than `./types` — confirm with `grep -n "export.*type ScheduleConfig\|export interface ScheduleConfig" src/scheduleEngine/*.ts` before finalizing.)

- [ ] **Step 3: Set the handoff in `useWorkoutReadinessGate`, only in the "found" branch**

Current (`useWorkoutReadinessGate.ts:138-157`):

```typescript
      if (questionnaire && (scheduleMode === 'flexible' || prescribedTrainingDays.length > 0 || trainingDaysValid(questionnaire.answers))) {
        try {
          const existingConfig = await loadScheduleConfig(uid);
          if (!existingConfig) {
            await ensureScheduleConfigFromQuestionnaire(
              uid,
              prescribedTrainingDays.length > 0
                ? prescribedTrainingDays
                : normalizeWeekdays(questionnaire.answers.trainingDays ?? []),
              deviceTimezone(),
              scheduleMode,
            );
          }
        } catch (error) {
          // Non-fatal — `useWorkoutSchedule` retries this same idempotent
          // call on AppShell mount; a legacy/unset schedule degrades to
          // SCHEDULE_SETUP_REQUIRED, never a crash.
          logWarn('workout_schedule', 'first_app_entry_schedule_config_failed', { error });
        }
      }
```

Change to:

```typescript
      if (questionnaire && (scheduleMode === 'flexible' || prescribedTrainingDays.length > 0 || trainingDaysValid(questionnaire.answers))) {
        try {
          const existingConfig = await loadScheduleConfig(uid);
          if (!existingConfig) {
            await ensureScheduleConfigFromQuestionnaire(
              uid,
              prescribedTrainingDays.length > 0
                ? prescribedTrainingDays
                : normalizeWeekdays(questionnaire.answers.trainingDays ?? []),
              deviceTimezone(),
              scheduleMode,
            );
            // A config was just created — do NOT hand it off. The value
            // this branch has (`undefined`) is stale by definition; let
            // `useWorkoutSchedule` do its own fresh read/ensure.
          } else {
            // Nothing written — this exact config is still valid a few
            // hundred ms later when `useWorkoutSchedule` mounts.
            setScheduleConfigBootstrapHandoff(uid, existingConfig);
          }
        } catch (error) {
          // Non-fatal — `useWorkoutSchedule` retries this same idempotent
          // call on AppShell mount; a legacy/unset schedule degrades to
          // SCHEDULE_SETUP_REQUIRED, never a crash.
          logWarn('workout_schedule', 'first_app_entry_schedule_config_failed', { error });
        }
      }
```

Add the import at the top of the file: `import { setScheduleConfigBootstrapHandoff } from '../scheduleEngine/scheduleConfigBootstrapHandoff';` (confirm the relative path matches this file's actual location — `src/workoutPrescription/` per the investigation).

- [ ] **Step 4: Consume it in `useWorkoutSchedule`**

Current (`useWorkoutSchedule.ts:142-144`):

```typescript
    setLoading(true);
    try {
      let loadedConfig = await loadScheduleConfig(uid);
```

Change to:

```typescript
    setLoading(true);
    try {
      let loadedConfig = takeScheduleConfigBootstrapHandoff(uid) ?? await loadScheduleConfig(uid);
```

Add the import: `import { takeScheduleConfigBootstrapHandoff } from './scheduleConfigBootstrapHandoff';`

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 6: Run the schedule engine test suite**

Run: `npx vitest run src/scheduleEngine src/workoutPrescription 2>&1 | tail -60`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/scheduleEngine/scheduleConfigBootstrapHandoff.ts src/workoutPrescription/useWorkoutReadinessGate.ts src/scheduleEngine/useWorkoutSchedule.ts
git commit -m "perf: hand off readiness-gate's schedule config read to useWorkoutSchedule

Only when the gate found an existing config (no write followed) — mirrors
the existing prescription bootstrap handoff. When the gate had to create a
config, no handoff is set and useWorkoutSchedule does its normal fresh
read/ensure, unchanged."
```

- [ ] **Step 8: A/B — 5 cold starts before, 5 after** (same procedure as Task 1 Step 8)

```bash
scripts/coldStartPerfRun.sh 5 task2-before /tmp/metro-perf-8082.log
node scripts/analyzeHomeBootstrapPerf.mjs perf-runs/task2-before-run-*.log
# implement, commit
scripts/coldStartPerfRun.sh 5 task2-after /tmp/metro-perf-8082.log
node scripts/analyzeHomeBootstrapPerf.mjs perf-runs/task2-after-run-*.log
```

Compare `workout_schedule.config`'s max count per run (expect 3→2), `today_schedule_config_ready`/`home_today_ready` percentiles. **Keep if** the count drops and no semantic change; **revert if not**.

---

## Part 2B: Plateau diagnosis (only after Task 1 + Task 2 are decided — keep or revert — per the user's explicit ordering)

### What Phase 1 data already answers (no new instrumentation needed)

`evolution_progression.read` trace lines already carry `startedAtBatchMs` (captured via `perfNowMsSinceAppEpoch()` immediately before `await input.operation()`, in `measureProgressionRead`, `workoutProgressionV2.ts:98-101`). Re-examine the EXISTING `perf-runs/baseline-run-*.log` files (Phase 1's, still on disk) rather than capturing new data for this specific question:

```bash
grep "evolution_progression.read" perf-runs/baseline-run-5-*.log
```

Confirmed already (run 5): `profile_policy` startedAtBatchMs=12, `schedule_config`=0, `executions`=0, `schedule_events`=7, `program`=10 — all 5 real reads start within 0-12ms of each other. **This directly answers §10/§11's first question: yes, they genuinely start together; this is real concurrency, not disguised serialization.** Do not re-instrument for this — cite the existing data in the report (Part J/K).

### Task 3: Sequential-vs-parallel A/B (the one new diagnostic this plan adds)

**Files:**
- Modify: `src/services/workoutProgressionV2.ts` (the `Promise.all` at line 223, DEV-only branch)

- [ ] **Step 1: Add a DEV-only env flag to run the same 5 reads sequentially instead of via `Promise.all`**

Read the full current `Promise.all` block (`workoutProgressionV2.ts:223-306`) before editing — the exact array/destructuring must be preserved for the parallel path; the sequential path is an alternate branch, not a rewrite.

```typescript
    const batchStartedAtMs = perfNowMsSinceAppEpoch();
    const completions: ProgressionReadCompletion[] = [];
    const runSequentially = __DEV__ && process.env.EXPO_PUBLIC_PERF_ISOLATE_PROGRESSION_READS === '1';
    const scheduleConfigRead = () => measureProgressionRead({
      label: 'evolution_progression.schedule_config', name: 'schedule_config',
      functionName: 'loadScheduleConfig', logicalPath: 'users/{uid}/workoutProgramState/scheduleConfig',
      operationType: 'getDoc', filters: 'fixed document id', orderBy: 'none', limit: '1 document',
      temporalWindow: 'current user preference', readCounterLabel: 'workout_schedule.config',
      batchStartedAtMs, completions, operation: () => loadScheduleConfig(uid),
      summarize: (result: Awaited<ReturnType<typeof loadScheduleConfig>>) => ({ docsReturned: result ? 1 : 0, docsUsed: result ? 1 : 0, docsDiscarded: 0, firestoreDispatches: 1 }),
    });
    // ... (repeat the same extraction for executions/relevantCycles/scheduleEvents/authoritativeInputs/prescribedSessions/policyMode —
    // each becomes a zero-arg thunk with EXACTLY the same body currently inline in the Promise.all array below, no logic change)
    const [config, { executions }, relevantCycles, scheduleEvents, authoritativeInputs, prescribedSessions, policyMode] = runSequentially
      ? [
          await scheduleConfigRead(),
          await executionsRead(),
          await relevantCyclesRead(),
          await scheduleEventsRead(),
          await authoritativeInputsRead(),
          await prescribedSessionsRead(),
          await policyRead(),
        ]
      : await Promise.all([
          scheduleConfigRead(),
          executionsRead(),
          relevantCyclesRead(),
          scheduleEventsRead(),
          authoritativeInputsRead(),
          prescribedSessionsRead(),
          policyRead(),
        ]);
```

Every `measureProgressionRead({...})` call inside the array becomes a `() => measureProgressionRead({...})` thunk definition just above, with **identical** `label`/`name`/`functionName`/`operation`/`summarize` bodies to what's currently inline — this step is a pure refactor (extract-to-thunk) for 6 of the 7 reads (relevant_cycles, prescription_inputs unchanged in position; the plan's illustrative excerpt above shows the pattern for `schedule_config` — apply the same extraction to all 7 current array entries, do not skip any or the destructuring order will break). Confirm the final destructured variable names (`config, { executions }, relevantCycles, scheduleEvents, authoritativeInputs, prescribedSessions, policyMode`) exactly match what the rest of the function body (below line 306) already expects — do not rename.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Confirm default (flag off) behavior is byte-identical**

Run: `npx vitest run src/services/__tests__/workoutProgressionV2* 2>&1 | tail -60` (find the exact test file via `find src -iname "*workoutProgressionV2*test*"` first)
Expected: PASS, with the flag unset (default) — confirms the `Promise.all` branch is untouched in shape.

- [ ] **Step 4: Commit**

```bash
git add src/services/workoutProgressionV2.ts
git commit -m "perf(diag): add DEV-only flag to run progression's 5 reads sequentially

EXPO_PUBLIC_PERF_ISOLATE_PROGRESSION_READS=1, __DEV__ only, default off —
existing parallel Promise.all path is unchanged in shape. For Phase 2B's
isolated-vs-parallel diagnostic only; not a production toggle."
```

- [ ] **Step 5: 5 cold starts with the flag OFF (parallel, baseline — same as Task 1/2's "after" data, can reuse if Task 1+2 are both kept and this is captured right after), then 5 with the flag ON**

```bash
# parallel (normal)
scripts/coldStartPerfRun.sh 5 diag-parallel /tmp/metro-perf-8082.log

# restart Metro with the flag added
kill %1 2>/dev/null  # or find the Metro PID and kill it
EXPO_PUBLIC_PERF_TRACE=1 EXPO_PUBLIC_PERF_ISOLATE_PROGRESSION_READS=1 npx expo start --port 8082 > /tmp/metro-perf-8082-isolated.log 2>&1 &
# wait for it to come up (curl http://localhost:8082/status), then:
scripts/coldStartPerfRun.sh 5 diag-sequential /tmp/metro-perf-8082-isolated.log

node scripts/analyzeHomeBootstrapPerf.mjs perf-runs/diag-parallel-run-*.log
node scripts/analyzeHomeBootstrapPerf.mjs perf-runs/diag-sequential-run-*.log
```

For the sequential runs, also directly inspect each run's `evolution_progression.read` lines' `durationMs` per read (`grep "evolution_progression.read" perf-runs/diag-sequential-run-1-*.log`) — the question is whether each individual read STILL takes ~1.0-1.5s when run alone (supporting "this is baseline per-request RTT in this environment, concurrency isn't adding cost") or whether only the FIRST sequential read pays ~1s and the rest become fast (supporting "a shared warmup/token cost paid once, that parallel execution just makes 5 callers pay simultaneously instead of only the first").

- [ ] **Step 6: Revert Task 3's code AFTER the diagnostic data is captured and written into the report** — per the user's explicit Passo 18 (no dummy-read workaround) and the general "diagnostic only, not production" framing: this flag's purpose is answering a question, not shipping a toggle. Once Part J/K/O of the report is written using this data, revert the commit from Step 4:

```bash
git revert --no-edit <task-3-commit-sha>
npm run typecheck
```

Confirm the revert compiles clean, then this task is done. If the user later wants the flag kept for future diagnostics, that's a separate explicit decision — default assumption here is revert.

### Token/App Check timing (§13) — likely NOT DETERMINED, document honestly

No `getIdToken` call site exists anywhere in application code (Firestore/Functions SDKs call it internally) — confirmed by the investigation. There is no safe interception point without wrapping the Firestore SDK's internal transport, which is out of scope ("não adicionar dependência pesada", Passo 14). Write Part M of the report as **NÃO DETERMINADA**, citing this — do not force an instrumentation that isn't feasible, and do not guess.

### Cold vs warm connection (§12) — answerable from already-available data, no new capture

Compare evolution_progression's ~1.0-1.5s per-read cost against Today's own earlier, already-sequential single-document reads (`today_schedule_config_ready` phase, Phase 1's Part K: 761-1130ms) and against `profile_remote_ready`'s cost (the FIRST real Firestore-adjacent network operation of the whole bootstrap, 1.1-1.9s after `auth_ready`). If Today's own individual reads — which happen strictly BEFORE evolution_progression's batch, on an already-"warm" (been-used-once) connection — show similar ~0.8-1.1s per-operation costs, that's evidence AGAINST a pure "cold channel" explanation specific to the parallel batch, and FOR "this is just this environment's baseline per-Firestore-round-trip latency" (simulator + whatever network path it takes to the backend). Write this comparison directly into Part L using Phase 1's existing numbers — no new cold starts needed for this part.

---

## Explicitly out of scope for this plan

- `user_profile.document` and `workout_programs.snapshot` dedupe (Part 0 — deferred, not risky, just larger; candidates for a follow-up round after seeing this plan's real A/B results).
- Pre-mount optimization (Passo 19 — explicitly forbidden this phase).
- Any change to overlay/readiness gate, FrequencyHeatmap, progression/lifecycle rules, Functions, Firestore Rules, App Check enforcement, RevenueCat, billing, entitlement (Passo 23).
- Making the sequential-reads diagnostic flag (Task 3) a permanent, shippable toggle — it's revert-after-use per Passo 18's spirit (no production workarounds from a diagnostic finding alone).

## Self-review notes

- Spec coverage: Part 0 (§1 call graph, all 4 resources) → done above with corrected/completed attribution (schedule_config's 3 call sites, lifecycle's actual 4 real occurrences vs. Phase 1's provisional 4). §2 (lifecycle 4x audit) → Task 1 + Part 0's table, explicit per-branch write analysis. §3 (schedule config 3x) → Task 2. §4 (program snapshot 2x) → deferred with reason. §5 (profile 2x) → deferred with reason. §6 (technique choice) → both tasks use "parameter/optional-field threading mirroring the existing handoff," not a new cache, matching §6/§7's preference order. §8 (A/B per change) → Task 1 Step 8, Task 2 Step 8, separately. §9 (no invented time goal) → not stated as a target anywhere in this plan. §10/§11 (isolated vs parallel) → Task 3, plus the already-available `startedAtBatchMs` data cited directly. §12 (cold vs warm) → answered from existing data, no new task. §13 (token/AppCheck) → documented as likely NOT DETERMINED with reason, not forced. §17/§18 (warm-connection experiment, no dummy read) → Task 3 is the legitimate version of this (real progression reads run sequentially, not a fake warmup query), and Step 6 reverts it — never shipped as a workaround. §19 (no pre-mount) → respected throughout; pre-mount only cited for comparison data in the cold/warm analysis, never optimized. §22 (revert criteria) → Task 1/2's Step 8 keep/revert criteria stated explicitly; Task 3 always reverts by design.
- No placeholders: Task 1/2 give complete before/after code. Task 3's thunk-extraction step describes a mechanical, fully-specified transformation (not "add appropriate refactoring") but does leave the other 6 thunks' bodies as "copy the existing inline body verbatim" rather than re-printing ~80 lines of already-quoted code from Part 0/the file read above — acceptable since the source is being read fresh in Step 1 of that task, not invented.
- Type consistency: `ReconcileResult.lifecycle`'s type (`Awaited<ReturnType<typeof loadWorkoutLifecycle>>`, NonNullable) matches the type `useWorkoutEvolution.ts`'s existing `lifecycle` destructured variable already expects (same as `loadWorkoutLifecycleDeduped`'s return type, which wraps the same underlying bundle type) — flagged for confirmation in Task 1 Step 1/5 rather than asserted blindly, since the exact type alias name wasn't independently re-verified in this planning pass.
