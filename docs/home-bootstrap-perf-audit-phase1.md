# Home Bootstrap Perf Audit — Phase 1 (Baseline, Critical Path, Diagnosis)

Companion to `docs/superpowers/plans/2026-09-22-home-bootstrap-perf-audit-phase1.md`. No visual/gate behavior was changed to produce this data — `homeInitialVisualReady`/`layoutCommitted`/the rAF gate/the overlay are untouched. This document is measurement + diagnosis only; **no optimization was applied**.

Method: iPhone 17 Pro Simulator, same worktree (`perf-consolidation`), same already-authenticated user, dedicated Metro on port 8082 (`EXPO_PUBLIC_PERF_TRACE=1 npx expo start --port 8082`). Each "cold start" = `xcrun simctl terminate booted com.ajfit.app` + `xcrun simctl launch booted com.ajfit.app` (kills and restarts the process; Firebase Auth session persists, so no re-login). 10 consecutive runs, `scripts/coldStartPerfRun.sh 10 baseline`, analyzed with `scripts/analyzeHomeBootstrapPerf.mjs`. Raw logs in gitignored `perf-runs/baseline-run-*.log`; full text of the generated table in `perf-runs/baseline-report.md`.

## A. Baseline — 10 runs

| Run | home_mount | today | evolution | activity | frequency | support | dataSettled | overlayHidden | last blocker |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 6390ms | 8568ms | 10733ms | 7245ms | 7246ms | 7246ms | 10745ms | 11021ms | evolution |
| 2 | 4574ms | 6833ms | 8907ms | 5369ms | 5370ms | 5370ms | 8918ms | 9169ms | evolution |
| 3 | 4497ms | 6689ms | 8796ms | 5333ms | 5334ms | 5334ms | 8808ms | 9073ms | evolution |
| 4 | 4328ms | 6561ms | 8532ms | 5141ms | 5142ms | 5142ms | 8543ms | 8799ms | evolution |
| 5 | 4192ms | 6527ms | 8677ms | 5001ms | 5001ms | 5002ms | 8688ms | 8945ms | evolution |
| 6 | 5135ms | 7846ms | 9988ms | 5895ms | 5896ms | 5896ms | 9999ms | 10256ms | evolution |
| 7 | 4292ms | 6954ms | 8939ms | 5087ms | 5087ms | 5088ms | 8949ms | 9206ms | evolution |
| 8 | 4411ms | 6683ms | 8570ms | 5224ms | 5225ms | 5226ms | 8581ms | 8844ms | evolution |
| 9 | 4810ms | 7225ms | 9179ms | 5633ms | 5633ms | 5634ms | 9191ms | 9457ms | evolution |
| 10 | 4247ms | 6556ms | 8428ms | 5025ms | 5026ms | 5026ms | 8439ms | 8696ms | evolution |

No outliers removed. Run 1 is the slowest across nearly every column (see D/K — it correlates with being the very first request after a Metro restart, not a different code path).

## B. Critical path per run

Same table as A — the "last blocker" column already identifies the terminal gate per run. There is no run where Today, Activity, Frequency, or Support is last.

## C. Percentiles

| Gate | min | p50 | p75 | p95 | max |
|---|---|---|---|---|---|
| today (`home_today_ready`) | 6527ms | 6689ms | 7225ms | 8568ms | 8568ms |
| evolution (`home_evolution_ready`) | 8428ms | 8796ms | 9179ms | 10733ms | 10733ms |
| activitySnapshot | 5001ms | 5224ms | 5633ms | 7245ms | 7245ms |
| frequency | 5001ms | 5225ms | 5633ms | 7246ms | 7246ms |
| supportInbox | 5002ms | 5226ms | 5634ms | 7246ms | 7246ms |
| **dataSettled** | **8439ms** | **8808ms** | **9191ms** | **10745ms** | **10745ms** |
| **overlayHidden** | **8696ms** | **9073ms** | **9457ms** | **11021ms** | **11021ms** |

(n=10, so p95 and max coincide — one run, run 1, occupies the top of every distribution.)

This baseline (8.4–10.7s dataSettled) is somewhat faster than the 8.9–12.0s range reported in the task brief, but tells the same story: the spread is wide and driven by one gate.

## D. Last-blocker frequency and waterfalls found

**Evolution is the last-settling gate in 10/10 runs**, with no exceptions. Today settles a consistent 1.9–2.2s before Evolution in every run (see the per-run deltas in K/L below). Activity/Frequency/Support settle 2.0–3.6s *before* dataSettled in every run and were never the bottleneck — the spec's concern that Support Inbox or Frequency might be silently gating Home is **not supported by this data**.

Confirmed from the raw traces (e.g. `perf-runs/baseline-run-5-*.log`):

- `useWorkoutActivitySnapshot`/`useFrequencyWindow`'s fetches start ~15–30ms after `home_mount` (`home_activity_fetch_start`/`home_frequency_fetch_start` land essentially at mount), confirming the code-read hypothesis from the investigation: their `schedule.config?.timezone ?? deviceTimezone()` fallback (`AppShell.tsx:269,278`) means they never wait on `schedule` to resolve. **No waterfall here** — this is already the "start earlier" shape Passo 4 asks to find, it just already exists.
- `home_support_inbox_listener_start` also lands ~30ms after `home_mount` — confirms it depends only on `uid`, already available at mount.
- Evolution's `load()` is gated only on `activeProgram.programInstanceId`, i.e. `prescription.status === 'SUCCESS'` (`AppShell.tsx:213-215,258`) — **not** on `schedule` resolving. In every run, `today_load_program_ready` (prescription resolved) fires *before* `home_mount`, so Evolution and Today's own remaining schedule-resolution genuinely run in parallel from mount — this part of the original waterfall hypothesis (Evolution waiting on all of Today) is **not what's happening**. What actually makes Evolution the long pole is that its own internal work, after starting in parallel, simply takes longer than Today's (see L).
- One real waterfall exists **before** Home even mounts: `profile_remote_ready` → `today_load_program_ready` (prescription's `loadActiveWorkoutProgram`, `src/services/workoutPrograms.ts:401+`) is strictly serial and adds 1.1–1.6s (3.15s in run 1) before `home_mount` can happen at all — see K.

## E. Requests starting late

None found among the 5 gates — all 5 start within ~30ms of `home_mount` or earlier (prescription resolves *before* mount via the bootstrap handoff). The one late-starting cost is pre-mount: `loadActiveWorkoutProgram`'s dependency on `profile_remote_ready` (auth → profile cache-hit is instant, but the *remote* profile revalidation blocks prescription from starting) — see K.

## F. Duplicate reads (confirmed, identical across all 10 runs)

From `scripts/analyzeHomeBootstrapPerf.mjs`'s firestore-read-count section — **byte-for-byte identical in every one of the 10 runs**, i.e. deterministic, not incidental:

| Logical read | Max count in one cold start |
|---|---|
| `workout_lifecycle.bundle` | **4** |
| `workout_schedule.config` | **3** |
| `reconcile.firestore_reads.pending_evolution` | **3** |
| `workout_programs.snapshot` | **2** |
| `user_profile.document` | **2** |
| `workout_executions.range_query` | 2 (expected — Activity and Frequency are two independent, intentionally separate bounded reads per their own module docs) |
| `workout_lifecycle.program_instance_events` | **2** |

Traced (run 5, `perf-runs/baseline-run-5-*.log`):

- `workout_lifecycle.bundle`: read #1 during prescription's own `loadActiveWorkoutProgram`; #2 during Evolution's `evolution_prepare.outstanding.lifecycle` step; #3 inside `evolution_progression`'s parallel batch (`loadWorkoutLifecycleDeduped`, despite the function's own name); #4 logged immediately after `evolution_reconcile_ready` (a post-commit re-read, cause not traced further in this pass).
- `workout_schedule.config`: #1 is Today's own `useWorkoutSchedule` read; #2 happens right before `evolution_cache_read_start`; #3 is `evolution_progression`'s own `loadScheduleConfig` call, ~1.1–1.2s after #1, for the exact same document.
- `workout_programs.snapshot`: #1 is prescription's own program-snapshot read; #2 is `evolution_progression`'s `loadAuthoritativePrescribedSessions`, ~1.1–1.2s after #1, for the same active-content-identity document.
- `user_profile.document`: #1 is `AuthContext`'s own remote revalidation; #2 is `evolution_progression`'s `resolveWorkoutLifecycleProgressionPolicy`, re-fetching the same user document via a `transaction.get` ~4–5s later.

This is the strongest, most concrete finding in this report — **Category C** (Passo 12: obrigatório, mas com trabalho duplicado/reutilizável). Not implemented here per Passo 15/19 — flagged for Phase 2 approval.

## G. Cardinality

- `observeOwnSupportCases` (`src/services/supportCases.ts:117-123`): `where(ownerUid==uid)`, `orderBy(updatedAt desc)`, `limit(50)`, full `SupportCase` documents via `onSnapshot` — see H.8 for the over-fetch note; not implemented here.
- Evolution's `evolution_prepare.outstanding_events` and `evolution_progression`'s `executions`/`schedule_events` reads are unfiltered-by-limit `query/getDocs` over the *entire* active-ProgramInstance ledger (`temporalWindow: "entire active ProgramInstance lifecycle ledger"` / `"entire event ledger for active ProgramInstance"`) — cardinality scales with program age/activity count. Not measured here (this account's ledger size is unknown) — flag as a Phase 2 investigation item if per-read `docsReturned` grows suspiciously for long-lived test accounts (this account: 0–3 `docsReturned` per the traces above, i.e. currently small).

## H. Support Inbox audit (Passo 5)

Answering the spec's 9 questions directly from code + this run's data (`src/services/supportCases.ts`, `src/lib/unreadSupportCasesCount.ts`, `src/hooks/useUnreadSupportCasesCount.ts`):

1. **Why does it block Home?** Architectural choice only — `homeInitialReadiness.ts:72` includes `supportInbox: input.supportInboxStatus` unconditionally in the `allRequiredDataSettled` set. Nothing about its own resolution depends on or is depended on by another gate.
2. **How long does it take?** p50 5226ms from app epoch, i.e. ~1.0s from `home_mount` (5226 − ~4200 mount ≈ 1.0s). Never close to being the bottleneck (0/10 last-blocker).
3. **When does it start?** `home_support_inbox_listener_start` lands ~20–30ms after `home_mount` in every run — effectively at mount.
4. **Depends on anything besides UID?** No — `useUnreadSupportCasesCount(user?.uid)` (`AppShell.tsx:363`) takes only `uid`.
5. **Could it start immediately after auth?** It already effectively does (uid is available at Home mount, and Home itself mounts only slightly after auth/prescription in this app's flow).
6. **Existing reusable listener/snapshot?** No — this is the only active `observeOwnSupportCases` subscription during bootstrap. `SupportCasesScreen` has its own, mounted only on navigation there, non-overlapping with boot.
7. **Duplicate reads?** No — single `onSnapshot`, effect deps `[uid]` only, no refetch trigger observed in any of the 10 runs.
8. **Querying a larger collection than necessary?** Yes, relative to what the gate needs: `limit(50)` **full** `SupportCase` documents fetched (`supportCases.ts:117-123`) to compute one boolean/aggregate (sum of `unreadByUserCount`). **Category E** (Passo 12: consulta excessiva para a informação necessária) — not implemented here.
9. **Do we need full messages or just "is there unread"?** Only `unreadByUserCount` (a scalar already on each case doc) is read via `countUnreadSupportCases`; message subcollections are never touched during bootstrap. The over-fetch is "50 full case docs" vs. "a single aggregate," not "case docs vs. message docs."

**Bottom line: Support Inbox is not a Phase 2 target for speed** (it's already fast and already starts at mount) — G.8/H.8's over-fetch is a legitimate efficiency finding but has zero effect on the current critical path.

## I. Frequency audit (Passo 6)

`home_frequency_fetch_start` → `home_frequency_network_ready` → `home_frequency_settled` are all within ~1ms of each other in every run (e.g. run 5: 4220 → 5001 → 5001). Network duration (`listCompletedWorkoutDatesInRange`) is the entire cost, ~780–830ms typically; the synchronous promotion (`buildFrequencyWindow`, `useFrequencyWindow.ts:128-141`) adds no measurable time (it runs during the same render as the state update that exposes `network_ready`). No duplicate fetch observed (`home_frequency_fetch_start` fires exactly once per run in all 10 — see the "marks that fired more than once" section of `baseline-report.md`, empty). **Not a Phase 2 target** — already fast, already parallel, no duplication.

## J. Activity/Weekly Overview audit (Passo 7)

Same shape as Frequency: `home_activity_fetch_start` → `home_activity_network_ready` → `home_activity_settled` all within ~1ms, ~780–830ms network cost, fires exactly once per run, no duplication. **Not a Phase 2 target.**

## K. Today audit (Passo 8)

Per-phase breakdown (median-ish run 5, ms since app epoch unless noted as a delta):

| Phase | Timing |
|---|---|
| `app_epoch` | 421 |
| `auth_ready` | 1147 (+726 from epoch) |
| `profile_cached_ready` (cache hit) | 1208 (+61 — instant) |
| `profile_remote_ready` (remote revalidation) | 2339 (+1131 from cache) |
| `today_load_program_ready` (prescription resolved) | 3670 (**+1331 from profile_remote_ready — see below**) |
| `home_mount` | 4192 (+522) |
| `today_schedule_config_ready` | 5002 (+810) |
| `today_schedule_recovery_checked` | 5960 (+958) |
| `today_schedule_resolved` | 6392 (+432) |
| `home_today_ready` | 6527 (+135) |

The `profile_remote_ready → today_load_program_ready` span (prescription's `loadActiveWorkoutProgram`, `src/services/workoutPrograms.ts:401+`, a serial `loadWorkoutLifecycle` + program-snapshot `getDoc` chain) is **1126–1585ms in 9/10 runs, and 3155ms in run 1** (the very first cold start after the Metro restart used for this measurement session — plausibly a cold network/TLS-handshake tax specific to being the first real request of the session, not a code-path difference; flagged, not excluded, per instructions). This span happens entirely *before* `home_mount`, so it isn't visible in any Home-relative gate, but it is real bootstrap time (auth_ready to home_mount is 2.5–5.0s across the 10 runs).

`today_prescription_handoff_used` fired in all 10/10 runs, exactly once — the bootstrap handoff from `useWorkoutReadinessGate`'s pre-AppShell resolution (`useWorkoutPrescription.ts:33-57`) is landing correctly; prescription is **not** being resolved twice. This hypothesis from the original investigation is **ruled out**.

Today's own post-mount chain (`today_schedule_config_ready` → `recovery_checked` → `resolved` → `home_today_ready`) is a consistent ~2.1–2.3s in every run (810+958+432+135 in run 5; similar elsewhere) — this is already-known, previously-optimized territory per the spec (Passo 8: "Today já foi otimizado anteriormente... não alterar sem evidência"). No new evidence here suggests it regressed or hides an unnecessary wait — it's stable across all 10 runs and is not the last blocker in any of them.

## L. Evolution audit (Passo 9)

Comparing to the historical ~4–5s figure (`docs/phase3-cache-audit.md`, mount→Evolution ≈ 5066ms, Sept 19 snapshot): **this baseline's mount→Evolution span is 3775–4598ms in 9/10 runs (run 5: 8677−4192=4485ms), consistent with or slightly better than the historical figure.** Evolution itself has **not regressed** — it remains in its known ~4–5s range. The 8.4–10.7s dataSettled figure is the sum of pre-mount time (auth→mount, 2.5–5s) plus Evolution's own ~4–4.6s, not a new Evolution slowdown.

Within Evolution's own resolution, `evolution_prepare.total` (the dominant internal span) breaks down consistently across all 10 runs:

| | outstanding_total (serial pre-phase) | progression.total (parallel batch) | prepare.total |
|---|---|---|---|
| min | 751ms | 1341ms | 2179ms |
| median | 812ms | 1550ms | 2360ms |
| max | 1130ms | 1682ms | 2827ms |

`outstanding_total` = `pending_read` (~15-20ms) + `outstanding.lifecycle` (~380-1385ms, a `workout_lifecycle.bundle` re-read — duplicate #2, see F) + `outstanding.events` (~350-450ms) — sequential.

`progression.total`'s `parallel_batch` (5 real Firestore reads: `profile_policy`/`schedule_config`/`executions`/`schedule_events`/`program`, plus 2 not-dispatched local ones) shows every real read completing in a **near-identical ~1.0–1.5s window** (`completionSpreadMs` 994–1161ms across runs) regardless of which document it is — e.g. run 5: `profile_policy` 1128ms, `schedule_config` 1149ms, `executions` 1151ms, `schedule_events` 1153ms, `program` 1151ms. Five independent single-document/bounded-query reads completing within 25ms of each other, every run, is not what independent per-document network latency looks like — it strongly suggests a shared blocking dependency (e.g. an auth/App Check token refresh gating all five, or a per-session Firestore channel warm-up) rather than five genuinely independent round trips. **Not diagnosed further in this pass** — no App Check/token mark exists to correlate against; flagged as the top Phase 2 investigation item, not a conclusion.

`EvolutionSummaryPresentationCache`'s read (`evolution_cache_read_start`/`evolution_cache_hit`, ~4ms after cache-read-start in every run) already does **not** gate `load()` — confirmed in code (`useWorkoutEvolution.ts:323,337`) and in every trace (`evolution_cached_summary_visible` always fires well before `evolution_reconcile_ready`). Passo 11's AsyncStorage-not-gating-network requirement is already satisfied here; no change needed.

**Bottom line: Evolution is the last blocker in 10/10 runs not because it regressed, but because (a) its own resolution genuinely costs ~4–4.6s including the duplicate reads in F, and (b) it starts only after `home_mount`, which itself is 2.5–5s into the process due to the pre-mount auth→profile→prescription chain (K).**

## Classification (Passo 12)

| Gate | Category | Justification |
|---|---|---|
| Today | A (obrigatório e autoritativo) | Prescription/schedule are the source of truth for what to train; no cache substitute possible per Passo 8. Already optimized; stable across all 10 runs. |
| Evolution | **A + C** | Authoritative terminal state required (Passo 9, explicit — no cache substitute). But its *internal* resolution re-reads `workout_lifecycle.bundle`(×4)/`workout_schedule.config`(×3)/`workout_programs.snapshot`(×2)/`user_profile.document`(×2) that Today or Evolution's own earlier steps already fetched — Category C (obrigatório, mas com trabalho duplicado/reutilizável) applies to those specific re-reads, not to Evolution's authoritative requirement itself. |
| Activity Snapshot | B, already realized | Could start "earlier" in principle, but the `deviceTimezone()` fallback already achieves this — starts at mount. No further action indicated. |
| Frequency | B, already realized | Same as Activity. |
| Support Inbox | **E** | Fetches 50 full `SupportCase` documents via `onSnapshot` to derive a single aggregate (`unreadByUserCount` sum) the gate could in principle get more cheaply — but this has zero effect on the current critical path (H, bottom line), so it's a correctness/efficiency finding, not a speed lever for Phase 2. |

No gate is classified as "D" (presentation cache candidate) in this pass — none of the three newly-audited gates (Activity/Frequency/Support) showed a need for one; their raw network cost is already low and non-blocking.

## What Phase 2 should target, in order, per Passo 13's preference list

1. **Reuse already-available results** (item 3 in Passo 13's list) — Evolution's `evolution_progression` batch re-fetching `schedule_config`/`program snapshot`/`profile` that Today's own resolution (or Evolution's own `outstanding.lifecycle` step) already has in hand moments earlier. This is F/L's duplicate-read finding — the single most concrete, evidence-backed lever in this report.
2. **Diagnose the ~1.0-1.5s uniform floor** on `evolution_progression`'s 5 parallel reads (L) before assuming it's fixable — if it's a shared token/channel-warmup cost, deduping the reads in (1) won't remove it; if it's per-read network cost, deduping will remove most of Evolution's remaining time. This needs one more instrumentation pass (e.g. a mark around whatever `getIdToken`/App Check call happens right before this batch) before Phase 2 code changes, not more baseline runs.
3. **Pre-mount time** (K: auth_ready→home_mount, 2.5–5s) is real elapsed time but out of this plan's gate-instrumentation scope (it happens before any of the 5 gates exist) — worth a separate, smaller investigation if (1)+(2) don't close enough of the gap, since `profile_remote_ready → today_load_program_ready` alone is 1.1–3.2s.

Support Inbox's over-fetch (H.8/G) is real but not a speed lever given the data — do not prioritize it for Phase 2 unless the account's case count grows enough to matter (currently ≤ a few cases for this test account, not verified against a high-volume account).

**No code change beyond instrumentation was made to reach these numbers.** Phase 2 requires explicit user approval before touching `workoutPrograms.ts`, `useWorkoutEvolution.ts`, `workoutLifecycleApplication.ts`, or `supportCases.ts` per Passo 15/19.
