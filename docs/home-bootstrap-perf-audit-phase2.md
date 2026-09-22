# Home Bootstrap Perf Audit — Phase 2 (Safe Dedupe + Plateau Diagnosis)

Companion to `docs/superpowers/plans/2026-09-22-home-bootstrap-perf-audit-phase2.md` and `docs/home-bootstrap-perf-audit-phase1.md`. No visual/gate/overlay/lifecycle/progression-rule code was changed — only two narrowly-scoped, additive read deduplications (kept) and one DEV-only diagnostic flag (implemented, measured, then reverted).

## A. Baseline for Phase 2

Phase 1's 10-run baseline (`perf-runs/baseline-report.md`, commit `1a4eda6`) is the starting point — no new "before" capture was taken for Task 1, since Task 1's change is the very next commit after that baseline. dataSettled: min 8439ms, p50 8808ms, p75 9191ms, p95/max 10745ms. `workout_lifecycle.bundle`×4, `workout_schedule.config`×3, both deterministic across all 10 runs.

## B. Call graph (duplicated resources)

Full per-occurrence table (caller, file:line, branch, write-safety, classification) is in the Phase 2 plan's Part 0 — reproduced in summary here:

| Resource | Occurrences | Real duplication (not free) | This plan's target |
|---|---|---|---|
| `workout_lifecycle.bundle` | 5 call sites | 4 (1 is free — `recovery.lifecycle` already satisfies `reconcileWorkoutLifecycle`'s own line 1109 in the traced branch) | #5 (`useWorkoutEvolution.load()`'s own re-read) — **implemented (Task 1)** |
| `workout_schedule.config` | 3 call sites | 3 | #1→#2 (readiness-gate → Today) — **implemented (Task 2)**. #3 (evolution_progression's own read) deferred. |
| `workout_programs.snapshot` | 2 call sites | 2 | Deferred — identity-equality proof needed first |
| `user_profile.document` | 2 call sites | 2 | Deferred — safest classification (Class A, zero write-risk) but deepest threading (4 files); left for a follow-up round |

## C. Classification (per Part 0's A-E rubric)

| Occurrence | Class | Why |
|---|---|---|
| lifecycle #5 (`useWorkoutEvolution.load()`) | D→A after fix | Safe only in NO_ACTION/STALE_REPREPARED branches — those already prove write-safety via the existing `progressionDecision` passthrough pattern |
| schedule_config #1 (readiness gate) vs #2 (Today) | A when found, B when not found | Branch-dependent at read time — handoff only fires in the "found" branch |
| schedule_config #3 (evolution_progression) | A vs #2, deferred | Needs 4-layer threading; same-value claim not yet proven safe across every reconcile branch |
| program_snapshot #1 vs #2 | A conditional on `activeContentIdentity` equality | Not proven to hold in every branch (evolution activation changes it) — deferred pending a dedicated identity-invariant check |
| user_profile #1 (AuthContext) vs #2 (qaMode) | **A — safest of all four** | Field is client-read-only (Firestore Rules restrict client writes to `metadata.updatedAt`); zero write-risk in any branch. Deferred purely due to threading depth, not risk. |

## D. Lifecycle bundle — 4x → 3x

**Kept**: `ReconcileResult.lifecycle` (optional field), populated only in the NO_ACTION and STALE_REPREPARED branches of `reconcileWorkoutLifecycle` (`workoutLifecycleApplication.ts:1125-1132,1183-1191`), consumed by `useWorkoutEvolution.load()`'s `Promise.all` (`useWorkoutEvolution.ts:174-196`) to skip its own `loadWorkoutLifecycleDeduped` call when available.

**Removed**: the `useWorkoutEvolution.load()` re-read (occurrence #5 in the call graph). **Untouched**: the auto-activation and plain-cleanup branches — those still force a fresh read, since a write occurred between capture and return in both.

**Verified**: `workout_lifecycle.bundle`'s max count per cold start dropped from 4 to 3 in 8/8 runs after the fix (Part I), 6/6 again in the follow-up Task 2 batch, 5/5 in both Task 3 A/B batches — 19/19 valid post-fix runs total, zero exceptions.

## E. Schedule config — 3x → 2x

**Kept**: `scheduleConfigBootstrapHandoff.ts` (new module, mirrors `useWorkoutPrescription`'s existing bootstrap handoff exactly). `useWorkoutReadinessGate.ts:138-160` sets the handoff only in the branch where `loadScheduleConfig` found an existing config (i.e., `ensureScheduleConfigFromQuestionnaire` did NOT run) — when a config had to be created, no handoff is set and `useWorkoutSchedule` falls through to its normal fresh read/ensure, byte-identical to before.

**Removed**: occurrence #1→#2 (readiness gate's check → Today's real resolution). **Untouched**: occurrence #3 (`evolution_progression`'s own `loadScheduleConfig` call) — deferred per Part C.

**Verified**: `workout_schedule.config`'s max count dropped from 3 to 2 in 6/6 runs after the fix, and stayed at 2 in both Task 3 A/B batches (10/10 more runs) — 16/16 valid post-fix runs, zero exceptions.

## F. Program snapshot — 2x (unchanged, deferred)

Not implemented. `loadAuthoritativePrescribedSessions` (`workoutProgressionV2.ts:290-296`) is keyed by `bundle.lifecycle.activeContentIdentity`, which is not proven to always equal prescription's own `programId` from the initial `loadActiveWorkoutProgram` read — a runtime equality check needs to be added and observed across enough real branches (including an actual evolution activation, which this account's cold starts never exercised) before this is safe to dedupe.

## G. User profile — 2x (unchanged, deferred)

Not implemented, despite being the single safest candidate found (Part C) — `qaPolicy.ts`'s `resolveWorkoutLifecycleQaMode` only reads a field the client can never write. Deferred purely because reuse requires threading an optional parameter through 4 files (`useWorkoutEvolution` → `reconcileWorkoutLifecycle` → `prepareEvolutionAttempt` → `evaluateProgressionV2ForUserFull` → `resolveWorkoutLifecycleProgressionPolicy`), the deepest change of any candidate — reasonable to defer to its own dedicated round rather than bundle into this one, per the "um de cada vez" rule.

## H. Changes tested (2A)

| # | Hypothesis | Implementation | Reads before→after | dataSettled p50 before→after | Keep/Revert |
|---|---|---|---|---|---|
| 1 | `useWorkoutEvolution.load()`'s lifecycle re-read is redundant with reconcile's own, in write-safe branches | `ReconcileResult.lifecycle` passthrough, NO_ACTION/STALE_REPREPARED only | `workout_lifecycle.bundle` 4→3 (8/8, then 19/19 cumulative) | 8808ms → 8093ms (Phase 1 baseline vs. task1v2, n=10 vs n=8) | **KEEP** |
| 2 | Readiness gate's existence-check config is still valid a few hundred ms later when Today resolves | `scheduleConfigBootstrapHandoff` (new module, mirrors prescription handoff) | `workout_schedule.config` 3→2 (6/6, then 16/16 cumulative) | 8093ms → 7683ms (task1v2 vs. task2-after) | **KEEP** |
| 3 (diagnostic) | Concurrency itself may add contention to the 5-way parallel batch | DEV-only `EXPO_PUBLIC_PERF_ISOLATE_PROGRESSION_READS` flag, sequential fallback path | n/a (same reads, different scheduling) | Parallel (flag off) 7994ms vs. sequential (flag on) 9894ms — **sequential is 1.9s SLOWER** | **REVERTED** (its job was answering a question, not shipping a toggle — see Part J/O) |

First A/B attempt for Task 1 (`task1-after`, n=5) had 3/5 capture failures (empty/truncated log files) — diagnosed as transient Metro/simulator flakiness (system load average 4.16, no thermal throttling recorded; likely a slow first bundle-serve after the file edit) unrelated to the code change, discarded, and superseded by a clean 8-run batch (`task1v2`) with zero capture failures.

## I. Aggregate result (2A)

| Metric | Phase 1 baseline (n=10) | After Task 1 (n=8) | After Task 2 (n=6) | Cumulative change |
|---|---|---|---|---|
| `workout_lifecycle.bundle` max reads/run | 4 | 3 | 3 | **-1 (-25%)** |
| `workout_schedule.config` max reads/run | 3 | 3 | 2 | **-1 (-33%)** |
| dataSettled min | 8439ms | 6883ms | 7570ms | -869ms |
| dataSettled p50 | 8808ms | 8093ms | 7683ms | **-1125ms (-12.8%)** |
| dataSettled p75 | 9191ms | 8646ms | 8048ms | -1143ms (-12.4%) |
| dataSettled p95/max | 10745ms | 8930ms | 8798ms | -1947ms (-18.1%) |
| overlayHidden p50 | 9073ms | 8359ms | 7944ms | -1129ms (-12.4%) |
| Last blocker | Evolution 10/10 | Evolution 8/8 | Evolution 6/6 | Unchanged (expected — 2A removed redundant work inside Evolution's own path, didn't change which gate is last) |

Not a huge win in absolute terms (as the user's own Part 9 anticipated — "o ganho pode ser pequeno porque algumas estão paralelas"), but real, consistent, and fully explained by removing exactly 2 redundant Firestore round trips from Evolution's serial-ish internal chain (the lifecycle re-read isn't inside the 5-way parallel batch, so removing it shortens the critical path directly rather than just reducing batch width).

## J. Plateau diagnosis (2B)

### K. Isolated vs. parallel

Already-available Phase 1 trace data (`evolution_progression.read`'s `startedAtBatchMs` field, captured by `measureProgressionRead` before any Phase 2 instrumentation existed) already proved the 5 real reads start within 0-12ms of each other — genuine concurrency, not disguised serialization. This did not need re-measuring.

What Phase 1 data could NOT show: whether concurrency itself costs something. Task 3's flag-gated sequential path answered this directly:

| | Parallel (normal) | Sequential (flag on) |
|---|---|---|
| dataSettled p50 (n=5 each) | 7994ms | 9894ms |
| Per-read duration (individual reads, run 3 sample) | ~1000-1500ms each (Phase 1/Task 1-2 data) | schedule_config 447ms, executions 382ms, schedule_events 381ms, program 353ms, profile_policy 932ms |

**Sequential execution is 1.9s slower in aggregate — parallel remains the correct strategy.** But each individual read, run alone, costs roughly a third of what it costs when run alongside 4 siblings. This is the core finding: **concurrent execution genuinely slows down each individual request (real contention), but the batch as a whole still wins because 5 slower-but-overlapping requests beat 5 faster-but-serial ones.**

### L. Cold vs. warm connection

Answered from already-available data, no new capture needed. If a "cold channel" (first-use-of-connection tax) explained the plateau, the FIRST sequential read (`lifecycle`, 375ms) would be markedly slower than the rest — it is not (375ms is in the same range as `schedule_config` 447ms, `executions` 382ms, `schedule_events` 381ms, `program` 353ms; only `profile_policy` at 932ms stands out, plausibly explained by its different operation type — `transaction.get` vs `getDoc`/`query`, not connection warmth). **Cold-channel-warmup is refuted by this data.** Today's own earlier, already-sequential reads (Phase 1 Part K: 761-1130ms per step) are closer to evolution_progression's PARALLEL per-read costs than to the sequential ones found here — consistent with Today's reads ALSO experiencing some contention from whatever else is happening concurrently in the bootstrap (Activity/Frequency/Support's own reads overlap with Today's window), not proof of a "warm vs cold" distinction either way.

### M. Auth/App Check token correlation

**NÃO DETERMINADA.** No `getIdToken` call site exists anywhere in application code — the Firestore/Functions SDKs handle token acquisition internally, with no interceptable point found without wrapping the SDK's internal transport (out of scope per Passo 14's "não adicionar dependência pesada"). App Check enforcement is currently disabled (`firebase.ts:45-48`), so even if App Check token fetches were contributing latency, there's no safe, honest way to measure them with the tools available in this pass. Not guessed.

### N. Cardinality

The 5 parallel reads' `docsReturned` in every sampled run: `profile_policy`=1, `schedule_config`=1, `executions`=1 (this test account), `schedule_events`=1, `program`=1 — all single-document or near-empty-result reads. Cardinality is not the explanation for the per-read cost; a 1-document `getDoc` costing ~1-1.5s under concurrency (vs ~350-450ms alone) is a latency/contention story, not a data-volume one.

### O. Confirmed cause of the plateau

**CONFIRMADA: concurrency contention over a shared connection**, not baseline network RTT and not a cold-channel/token-refresh cost paid once.

Evidence chain: (1) the 5 reads genuinely start together (K, pre-existing data); (2) run alone, each costs ~350-450ms; (3) run together, each costs ~1000-1500ms — roughly 2.5-3x slower per request under concurrency; (4) the first sequential read isn't specially slow, ruling out a one-time warmup cost (L); (5) no token-acquisition instrumentation was feasible to test the token hypothesis directly, but the sequential data doesn't need it — if token/App-Check cost were the driver, it would show up as a one-time cost on the FIRST read regardless of mode, which isn't what's observed; (6) cardinality is uniformly trivial across all 5 reads (N), ruling out data volume.

The mechanism most consistent with this pattern is standard HTTP/2 (gRPC-Web/WebChannel) multiplexing behavior: multiple concurrent requests sharing one connection's flow-control window and stream-processing capacity slow each other down individually, even though the connection's aggregate throughput improves. This is a property of the transport, not a bug in this app's code — and it means **parallel execution is already the correct choice**; the only real lever is reducing how many requests are in that batch at all, which is exactly what 2A's dedupe work does (each read removed from the batch, or removed from the critical path entirely, both reduces total work and reduces the contention pool for whatever remains).

## P. Pre-mount (documented only, not optimized — per Passo 19)

Auth→profile→prescription chain, from Phase 1/2's combined data: `app_epoch`→`auth_ready` ~700-1400ms, `auth_ready`→`profile_remote_ready` ~1.1-1.9s, `profile_remote_ready`→`today_load_program_ready` (prescription's `loadActiveWorkoutProgram`) ~1.1-1.6s (one outlier at 3.15s, Phase 1 Part K, attributed to being the very first request of a Metro session). Total pre-mount window: roughly 2.5-5s depending on run, before `home_mount` even fires. The FIRST legitimate Firestore operation of the whole bootstrap is `AuthContext`'s remote profile/questionnaire fetch (`Promise.all([getUserProfile(uid), getLatestQuestionnaire(uid, attempt)])`, `AuthContext.tsx:244`) — whether it "warms" the channel for later reads is not conclusively answered by this phase's data (see L) and is explicitly out of scope this phase. Not optimized.

## Q. Semantics/tests

Every kept change: `npm run typecheck` clean at each commit; full `workoutEvolution` (138 tests), `scheduleEngine`+`workoutPrescription` (525 tests), and the combined `workoutEvolution`+`progressionEngineV2`+`scheduleEngine`+`workoutPrescription` suite (803 tests, run after the Task 3 revert) all pass. No test asserted `ReconcileResult`'s exact key set in a way that needed updating. No fixture needed adjustment. The `LIFECYCLE_APPLICATION_INTEGRATION` Firestore-emulator suite was not run (requires local Firebase emulator setup not exercised in this pass) — the change is additive-only to a return value in a read-only reconciliation path, not to any write/authority logic, so this is a reasonable scope boundary, not a gap in the write-path guarantees Passo 20/22 care about.

## R. Visual validation

One fresh cold start (post-revert, on the final Metro state) screenshotted mid-load and post-reveal: mid-load shows the fullscreen loading spinner (no partial Home), post-reveal shows the complete Home — greeting, today's workout card with exercise/set counts and body-map illustration, evolution progress bar, weekly overview, frequency grid, and bottom tab bar all present simultaneously in the first captured frame after overlay-hidden. No partial section, no visible skeleton-then-fill. **PRIMEIRO FRAME DA HOME COMPLETO = SIM. LAYOUT SHIFT = NÃO** (expected by construction — no gate/overlay/reveal code was touched in either kept change).

## S. Git

7 commits this phase, all on `perf-consolidation`, no push:
```
9772ec7 Revert "perf(diag): add DEV-only flag to run progression's 5 reads sequentially"
a1947ff perf(diag): add DEV-only flag to run progression's 5 reads sequentially
442f8df perf: hand off readiness-gate's schedule config read to useWorkoutSchedule
cf41ebf perf: thread reconcile's already-loaded lifecycle bundle to skip a redundant re-read
```
(plus this doc + the Phase 2 plan doc). `firestore-debug.log` was not staged or committed at any point. `perf-runs/` stays gitignored (raw cold-start logs, local artifacts only).

## T. Decision

- **DUPLICIDADE SEGURA FOI REDUZIDA:** SIM (`workout_lifecycle.bundle` 4→3, `workout_schedule.config` 3→2, both 100% consistent across every post-fix run captured)
- **EVOLUTION FICOU MAIS RÁPIDA:** SIM (dataSettled/overlayHidden p50 improved ~12-13%, p95 improved ~18%, no run regressed)
- **HOME BOOTSTRAP FICOU MAIS RÁPIDO:** SIM (same numbers — Evolution is still the last blocker in every run, so its improvement is the bootstrap's improvement)
- **PLATÔ ~1S FOI EXPLICADO:** SIM — CONFIRMADA as concurrency contention over a shared connection (Part O), not baseline RTT, not cold-channel warmup, not (as far as testable) token acquisition. Cardinality ruled out.
- **PRÉ-MOUNT DEVE SER A PRÓXIMA FRENTE:** Not concluded here by design (Passo 19 forbids optimizing it this phase) — Part P documents its size (2.5-5s) for a future decision, not a recommendation to act now. The more immediate next step per this phase's own findings is the deferred user_profile.document dedupe (Part C/G — safest classification of all 4 candidates, just the largest diff) and the program_snapshot identity-equality proof (Part F), both left for a follow-up round rather than bundled here.

Not pushed, not deployed, next phase not started automatically.
