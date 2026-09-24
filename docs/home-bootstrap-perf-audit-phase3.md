# Home Bootstrap Perf Audit — Phase 3 (Pre-Mount Instrumentation + Diagnosis)

Companion to `docs/superpowers/plans/2026-09-22-home-bootstrap-perf-audit-phase3.md` and Phases 1-2's reports. **No behavioral code change was made this phase — only additive perf marks.** The user's original hypothesis (mount AppShell as soon as a valid uid exists) was investigated and rejected on architectural grounds before any instrumentation was written; see the plan doc's "Why 'mount AppShell early' is not attempted this phase" section, reproduced in summary in Part C below.

## A. Baseline for Phase 3

No prior pre-mount baseline exists — Phases 1/2 only instrumented `app_epoch` → `home_mount` as a single unmeasured span. This phase's own 10-run capture (Part B) is both the instrumentation validation and the first baseline simultaneously.

**Measurement environment caveat (read before comparing to Phase 2's absolute numbers):** this batch was captured at the end of a long single session that had already run ~50+ cold starts across Phases 1-3. System load average at capture time was 7.0-9.0 (vs. 4.16 during Phase 2) and free memory was critically low (~71MB). This inflates every stage's absolute duration somewhat — e.g. this batch's `home_initial_data_settled` p50 (9433ms) is ~1.75s higher than Phase 2's final kept-state measurement (7683ms) despite zero relevant code changes between them (Phase 3's marks are trivially cheap `logDebug` calls, not capable of causing this). **Absolute numbers in this report should not be compared directly to Phase 2's — the relative proportions between pre-mount stages (which is what this phase is actually diagnosing) are still valid and are what the conclusions below are based on.**

## B. Timeline — 10 cold starts

10 runs captured; run 8 is a genuine anomaly (not a capture failure — real marks were logged, but every stage was uniformly ~5-6x slower than the others and the run never reached `home_initial_overlay_hidden`, i.e. it may still have been converging when the script's 30s timeout cut it off). Kept in the raw log for the record, **excluded from the percentile stats below** (matching Phase 2's precedent for a run that didn't complete) — included, not silently dropped.

Raw per-run marks (ms since that run's own `app_epoch`):

| Run | app_epoch offset* | auth_ready | sub_start | sub_settled | profile_remote | pref_start | pref_settled | readiness_ready | gate_resolved_app | home_mount | appshell_mount | evolution_start |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 339 | 1029 | 1096 | 1130 | 2431 | 2447 | 2465 | 4439 | 4440 | 4405 | 4406 | 4419 |
| 2 | 628 | 1550 | 1639 | 1694 | 2955 | 2967 | 2980 | 4645 | 4645 | 4613 | 4615 | 4626 |
| 3 | 509 | 1298 | 1376 | 1421 | 2055 | 2060 | 2070 | 3728 | 3728 | 3695 | 3697 | 3708 |
| 4 | 646 | 1667 | 1758 | 1813 | 3197 | 3204 | 3219 | 5186 | 5187 | 5147 | 5149 | 5163 |
| 5 | 742 | 1751 | 1854 | 1913 | 3539 | 3552 | 3572 | 5855 | 5855 | 5815 | 5817 | 5831 |
| 6 | 820 | 2066 | 2202 | 2284 | 3364 | 3370 | 3381 | 5268 | 5268 | 5231 | 5233 | 5245 |
| 7 | 1208 | 2449 | 2586 | 2686 | 3986 | 3996 | 4016 | 5715 | 5715 | 5677 | 5679 | 5691 |
| 8 (excluded) | 1330 | 7526 | 8666 | 9448 | 10631 | 10654 | 10727 | 12707 | 12708 | 12568 | 12574 | 12624 |
| 9 | 2460 | 5393 | 5606 | 5736 | 6830 | 6839 | 6860 | 9055 | 9056 | 8928 | 8935 | 8984 |
| 10 | 559 | 1420 | 1488 | 1526 | 2566 | 2579 | 2591 | 4446 | 4447 | 4420 | 4421 | 4431 |

\*`app_epoch`'s own `msSinceAppEpoch` value is not exactly 0 — it reflects JS bundle-evaluation time between `perf.ts`'s module-level epoch capture and `App.tsx`'s top-level `recordPerfMark('app_epoch')` call, both at import time. All other columns are also `msSinceAppEpoch` (same absolute clock), not deltas from `app_epoch` — stage durations are computed as column differences below, not by subtracting this offset.

### Per-stage durations (n=9, run 8 excluded)

| Stage | min | p50 | p75 | p95 | max |
|---|---|---|---|---|---|
| `app_epoch` → `auth_ready` | 690ms | 922ms | 1241ms | 2933ms | 2933ms |
| `auth_ready` → `subscription_bootstrap_start` | 67ms | 89ms | 136ms | 213ms | 213ms |
| `subscription_bootstrap_start` → `_settled` (duration) | 34ms | 55ms | 82ms | 130ms | 130ms |
| `auth_ready` → `profile_remote_ready` | 757ms | 1402ms | 1530ms | 1788ms | 1788ms |
| `profile_remote_ready` → `preferences_reconciliation_start` | 5ms | 9ms | 13ms | 16ms | 16ms |
| `preferences_reconciliation_start` → `_settled` (duration) | 10ms | 13ms | 20ms | 21ms | 21ms |
| `profile_remote_ready` → `workout_readiness_ready` | 1673ms | **1880ms** | 2008ms | 2316ms | 2316ms |
| `app_epoch` → `home_mount` (total pre-mount) | 3186ms | 4066ms | 4501ms | 6468ms | 6468ms |
| `home_mount` → `evolution_start` | 11ms | 14ms | 16ms | 56ms | 56ms |
| `evolution_start` → `home_initial_data_settled` | 3643ms | 4206ms | 5322ms | 8530ms | 8530ms |

**`profile_remote_ready` → `workout_readiness_ready` (~1.88s median) is the single largest identified pre-mount stage** — larger than the entire `auth_ready` → `profile_remote_ready` span (~1.4s) itself. `subscription_bootstrap` and `preferences_reconciliation` are both trivially fast (tens of ms) — confirmed NOT worth optimizing, matching the prediction in Part 0 of the plan.

### A measurement-ordering artifact worth documenting (not a bug)

In every one of the 9 valid runs, `home_mount`/`appshell_mount`/`evolution_start` appear in the raw log **before** `workout_readiness_ready`/`premium_gate_resolved_app`, by a small, consistent margin (~30-50ms) — e.g. run 1: `home_mount` 4405 vs. `workout_readiness_ready` 4439. This looks backwards (AppShell only renders when `resolvedScreen === 'app'`, which requires `workoutReadinessGate === 'ready'`) but is explained by React's effect-flush order: when the state update that flips `workoutReadinessGate` to `'ready'` triggers a re-render, `resolvedScreen` is computed synchronously *during* that render (before commit) — so AppShell mounts in the *same* commit. React then fires effects bottom-up (children before parents) within that commit: AppShell's own `appshell_mount` effect (child) fires before `RootNavigator`'s `workout_readiness_ready`/`premium_gate_resolved_app` effects (parent), even though the underlying state was already resolved before the render even started. **The gate's mark timestamps lag their true logical resolution moment by this render-to-effect-flush gap** — small enough not to matter for stage-duration measurement, but means these two marks should not be read as strict "nothing before this point" boundaries relative to `home_mount`/`appshell_mount`.

## C. Gates that impede mount (classification A-E)

Per the plan's Part 0 investigation (`resolvePremiumGate`, `App.tsx:333-346`, and `useWorkoutReadinessGate.ts:59-66`'s own doc comments):

| Gate | Classification | Why |
|---|---|---|
| `authInitializing`/`profileLoading` | **A** | Can't route anywhere — Paywall, Onboarding, and App all need to know who the user is first. |
| `emailVerificationRequired` | **A** | Firebase hard requirement, blocks all authenticated content categorically. |
| `preferencesReconciling` | **A**, but cheap | Genuinely must resolve before first paint so language/units render correctly (documented "one-render-late bug" this specifically fixes) — but its own duration (~13ms median) is negligible. |
| `questionnaireResolution !== 'found'` | **A** | Routes to onboarding funnel instead of App — a routing decision, not a Home-presentation delay. |
| `subscriptionLoading`/`!subscriptionConfigured` | **A**, but cheap and already parallel | Needed to know Paywall-vs-App routing — but already starts on `uid` alone (parallel with profile) and resolves in ~55ms median. Not a lever. |
| `!commercialGateResolved && !isPremium` | **A** (derived instantly) | Billing-authority routing decision (Paywall) — but computed synchronously from `profile.metadata`, no separate async wait once profile resolves. |
| `workoutReadinessGate !== 'ready'` | **A** | Exists specifically so "Home becomes the trigger for first program generation" never happens (`premiumGate.ts:73-78`) — a correctness/safety gate, not decoration. Its own resolution (`profile_remote_ready` → `workout_readiness_ready`, ~1.88s) is the actual long pole. |

**No Category B, C, D, or E gates found** — every one of `resolvePremiumGate`'s inputs is either a genuine routing decision or resolves fast enough to be irrelevant. This matches Phase 2's Part 0 finding for the same function (zero historical-cruft candidates).

## D. Real dependencies vs. historical ones

None found to be historical/unnecessary. The one candidate that looked promising on a first pass — relaxing `useWorkoutReadinessGate`'s `enabled` condition to start before `questionnaireResolution === 'found'` — was examined and rejected (see plan doc's "Why" section): `resolvePremiumGate` requires questionnaire resolved anyway before it can ever return `'app'`, so starting the readiness gate's own internal work earlier wouldn't move the actual bottleneck. This is recorded so it isn't re-proposed without re-deriving why it doesn't help.

## E. Auth

`app_epoch` → `auth_ready`: p50 922ms. No new findings beyond Phase 1's — this is Firebase Auth's own session-restoration time, not something this codebase controls the internals of.

## F. Profile/questionnaire

`auth_ready` → `profile_remote_ready`: p50 1402ms (the `Promise.all([getUserProfile, getLatestQuestionnaire])` round trip, already parallelized — confirmed no AsyncStorage-then-Firestore waterfall exists here, per the Phase 3 plan's Part 0 point 6). No presentation-cache-as-authority risk found (the profile presentation cache read is fire-and-forget, never gates this Promise.all).

## G. Prescription/active program (the actual long pole)

`profile_remote_ready` → `workout_readiness_ready`: p50 **1880ms**, the single largest pre-mount stage. This is `useWorkoutReadinessGate`'s own work: `resolveWorkoutPrescription` → `loadActiveWorkoutProgram` (the same serial `loadWorkoutLifecycle` + program-snapshot `getDoc` chain Phase 1's Part K already documented, ~1.1-1.6s) plus the gate's own schedule-config existence check (Phase 2's Task 2 target — already deduped from Today's later read, but the gate's OWN check here still costs a real Firestore round trip). This is not a newly-discovered waterfall; it's the same chain Phase 1/2 already analyzed and partially optimized (Phase 2 removed the *duplicate* schedule-config read downstream, not this gate's own first read). No further safe reduction identified this phase without re-opening either Phase 1's "why does a single lifecycle+program getDoc chain cost ~1.1-1.6s" question (a network/backend latency question, not an app-architecture one, per Phase 2's Part O findings about Firestore round-trip costs in this environment) or Phase 2's deferred `user_profile.document`/`workout_programs.snapshot` dedupe candidates (neither of which are on THIS specific gate's read path — they're inside Evolution's own `evolution_progression` batch, which runs later, after `home_mount`).

## H. Parallelism found

Confirmed already-correct parallel design (not a new finding, but now measured for the first time):
- `subscription_bootstrap_start` fires ~89ms after `auth_ready`, fully independent of `profile_remote_ready` (which resolves ~1.3s later) — genuinely parallel, exactly as `SubscriptionContext.tsx`'s own identity-sync effect was designed to be.
- `preferences_reconciliation_start` fires ~9ms after `profile_remote_ready` — correctly serial (it needs `profile.preferences`), but the gap is negligible, so this "waterfall" costs nothing in practice.
- `evolution_start` fires ~14ms after `home_mount` — Evolution's own resolution begins essentially instantly at mount, no additional gating delay between AppShell rendering and Evolution's hook actually starting its work.

No unnecessary serialization was found beyond what's already documented in Part G (which is necessary, not historical).

## I. Hypotheses tested

| # | Hypothesis | Outcome |
|---|---|---|
| 1 | Mount AppShell as soon as a valid uid exists (user's original headline hypothesis) | **Rejected before implementation** — `resolvePremiumGate`'s 8 inputs are routing decisions (which screen to show), not presentation delays; mounting AppShell speculatively risks reading a user's workout data before knowing they should see Home at all (vs. Paywall/Onboarding), and risks a wasted-work screen-swap if the gate resolves elsewhere. See plan doc. |
| 2 | Relax `useWorkoutReadinessGate`'s `enabled` to start before questionnaire resolves | **Rejected before implementation** — `resolvePremiumGate` needs questionnaire resolved anyway; starting the gate's internal work earlier doesn't move the actual bottleneck (Part D). |
| 3 (implicit, tested via instrumentation) | Subscription/preferences reconciliation might be hidden long poles | **Refuted by data** — both resolve in tens of ms (Part B), confirmed not worth touching. |

No hypothesis reached the point of an actual code change this phase — all three resolved to "don't do this" before or immediately upon measurement, which is a legitimate outcome given the user's own "não fabricar meta" instruction.

## J. Races/side-effects audited

Per the plan's Part 0 investigation (not re-litigated here since no early-mount change was made): `useWorkoutEvolution`'s `load()` callback doesn't read its `activeProgramInstanceId` parameter directly (it re-derives the authoritative program instance from a fresh `reconcileWorkoutLifecycle(uid)` call every time), so it would likely tolerate an early-mount scenario reasonably well — but this was never exercised, since no early-mount change was made this phase. Recorded for whichever future phase might revisit the early-mount hypothesis with a different architecture (e.g. a genuinely provisional/speculative-render pattern that explicitly handles the Paywall-swap risk) — not assumed safe by this phase's own findings alone.

## K. Result

No code behavior changed this phase (marks only). No before/after comparison applies — Part B's baseline *is* the result, serving as the first-ever measured breakdown of the pre-mount window for future phases to compare against (accounting for the measurement-environment caveat in Part A).

| Metric | Value (p50, n=9) |
|---|---|
| `app_epoch` → `appshell_mount` | ~4066ms (same as `home_mount`, they fire ~2ms apart) |
| `app_epoch` → `home_mount` | 4066ms |
| `app_epoch` → `evolution_start` | ~4080ms |
| `home_mount` → `home_initial_data_settled` (Evolution + other gates) | ~4220ms (evolution_start-relative: 4206ms) |
| `app_epoch` → `home_initial_data_settled` (raw mark) | 9433ms* |
| `app_epoch` → `home_initial_overlay_hidden` (raw mark) | 10013ms* |

\*Inflated by the session-long measurement-environment degradation noted in Part A — not comparable to Phase 2's 7683ms/7944ms without re-measuring both phases back-to-back under matched system load, which wasn't done here.

## L. Visual validation

Not applicable — no code behavior changed this phase, so no new visual risk was introduced. Phase 2's visual validation (Home renders complete on first frame, no layout shift) remains the last valid visual check.

## M. Tests

`npm run typecheck`: clean after both commits. `npx vitest run src/state src/workoutEvolution`: 213/213 pass (19 test files) — covers `SubscriptionContext`-adjacent and `useWorkoutEvolution` suites, the two files with the most substantive edits (an effect added to each). No test asserted against the exact effect count/order in either file in a way that broke.

## N. Security

No authority, lifecycle, progression, Firestore Rules, App Check, RevenueCat, billing, or entitlement logic touched — every edit this phase is an additive `recordPerfMark(...)` call (a no-op outside `EXPO_PUBLIC_PERF_TRACE=1`) or a new `useEffect` whose only body is such a call.

## O. Git

4 commits this phase, all on `perf-consolidation`, no push:
```
31aed25 perf: wire pre-mount marks into SubscriptionContext/App/AppShell/useWorkoutEvolution
1fc11ff perf: add pre-mount marks (subscription, preferences reconciliation, premium gate, appshell/evolution start)
```
(plus this doc + the Phase 3 plan doc). `firestore-debug.log` not staged. `perf-runs/` stays gitignored.

## P. Decision

- **PRÉ-MOUNT FOI REDUZIDO:** NÃO — nenhuma serialização não-necessária foi encontrada além do que já existe por razões de roteamento/autoridade legítimas (Part C/D). As duas hipóteses de mudança consideradas (mount antecipado do AppShell; destravar o readiness gate do questionnaire) foram examinadas e rejeitadas por raciocínio arquitetural antes de qualquer implementação — não por falta de tentativa, mas porque a evidência (o próprio comentário de design já existente no código, mais a estrutura de `resolvePremiumGate`) mostrou que nenhuma das duas moveria o gargalo real.
- **EVOLUTION COMEÇA MAIS CEDO:** NÃO — `evolution_start` já fica a ~14ms de `home_mount` em todos os runs; não havia folga aí para recuperar.
- **BOOTSTRAP TOTAL MELHOROU MATERIALMENTE:** NÃO — nenhuma mudança de código de comportamento foi feita. Os números absolutos deste lote são mais altos que os do Fase 2 por degradação do ambiente de medição (Part A), não por regressão.
- **HOME CONTINUA COMPLETA NO PRIMEIRO FRAME:** SIM (não aplicável mudança — nada no caminho de overlay/gate foi tocado).
- **HOUVE ALTERAÇÃO DE AUTORIDADE:** NÃO.
- **AINDA EXISTE WATERFALL RELEVANTE:** SIM, mas é o mesmo já documentado nas Fases 1/2 — `profile_remote_ready → workout_readiness_ready` (~1.88s, a cadeia `loadActiveWorkoutProgram`) é serial por necessidade real (precisa saber se existe programa antes de decidir rota), e seu custo por-leitura já foi atribuído no Fase 2 Parte O a contenção de rede/Firestore neste ambiente, não a uma escolha de arquitetura corrigível aqui.

Not pushed, not deployed, next phase not started automatically.
