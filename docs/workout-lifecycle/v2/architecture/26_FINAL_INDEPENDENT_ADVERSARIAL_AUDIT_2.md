# Final Independent Adversarial Audit #2

Date: 2026-09-02

Independent, clean-context re-audit of Workout Lifecycle V2. Prior phase reports (docs 14-25) were used only to locate requirements, risk areas, and existing tests — never as evidence. Every PASS below is backed by this pass's own code reading, quality-gate re-execution, or test-body critique.

## 1. Executive Verdict

**No P0 or P1 was found in this pass.** The two historical P0s (RECOVER canonical-authority bypass; Firestore Rules `programInstanceId`-omission grant bypass) were independently re-verified as still fixed, with no regression, by direct re-reading of `authorizeMutation.ts` and `firestore.rules` against the current commit (not by trusting docs 23-25). All eight mandatory quality gates were independently re-executed in this session (not copied from prior reports) and are green, matching the previously-claimed counts exactly.

This pass surfaced **three new P2 findings** neither of the four prior remediation phases documented:
1. `workoutPrograms`'s Firestore Rules `allow update` branch has no authority-grant requirement — only `allow create` was hardened in Phase 10D. A user can reactivate a stale/superseded `workoutPrograms` document and repoint `workoutProgramState/active` at it without any grant. Bounded: the real backend authority (`workoutLifecycleState/current`) is untouched by this, so progression/adherence/execution credit is not affected — the exposure is display/content drift, not authority corruption.
2. The rollout kill switch (`src/workoutLifecycle/rollout.ts`) only gates **new V1→V2 migrations**. Once a user has `workoutLifecycleState/current`, no flag stops their ADAPT/PREPARE/ACTIVATE/RECOVER mutations. This is precisely the failure mode the audit brief's own kill-switch scenario (§58-59) asks about, and it is not covered.
3. The exact optional-field-omission Rules pattern that caused the original FS-RULES-BYPASS-01 P0 recurs, unfixed, in `scheduleState`/`scheduleEvents` writes. One investigation pass traced only the `COMPLETED`-adherence path and found it neutralized by an exact-match filter downstream; a second, deeper pass found that forged `SKIPPED`/`MISS_RESOLVED` events (which the Rules gap also permits grant-free) feed the rotation/expected-session-index computation through a path that was not conclusively resolved before time ran out — classified **PLAUSIBLE, not CONFIRMED**, and flagged as the top-priority follow-up item rather than closed as harmless.

Plus one new P3 (no per-exercise `sets` array length bound in `workoutExecutionCommonValid` — write-size hygiene only, no credit impact).

Per the audit's own blocking rule (§72), P0/hot-path-P1 findings force NOT READY; none were **confirmed** in this pass (finding #3 above is disclosed as plausible-unconfirmed, not asserted as P0/P1, per the audit's own evidence standard). Per §74's staged-rollout bar, "rollout/kill switch: PASS" is a mandatory precondition, and finding #2 means that bar is not cleanly met as documented today — the kill switch is real but narrower than its name implies.

## 2. Final Authorization

```
FINAL AUTHORIZATION: READY FOR INTERNAL TESTING ONLY
```

Rationale in §97.

## 3. Git State

Branch `evolucao-dos-treinos-em-andamento`, HEAD `cca7b5cbcc52761f42fb5b25dc2e27b526f788a9`. Working tree clean except `firestore-debug.log` (modified by this audit's own emulator runs — non-semantic, pre-existing hygiene item, not fixed per audit rules). `cca7b5c` is a single commit on top of `d24319b` (the commit prior phase reports describe as "large pre-existing uncommitted worktree") that mechanically commits that same worktree — confirmed via `git diff --stat d24319b cca7b5c`, which shows exactly the Workout Lifecycle V2 source/test/doc tree with no unexplained content. This is the same code the prior four phases audited, now committed; not a divergent branch. No commits, resets, restores, cleans, or stashes were performed by this audit.

## 4. Environment

Root Node v20.20.2 (`.nvmrc`), Functions Node 22, firebase-tools 15.26.0, Java: system default 17 (insufficient), JDK 21 at `/opt/homebrew/opt/openjdk@21` used explicitly for all emulator-backed commands this pass (`JAVA_HOME`/`PATH` scoped per-command, matching the project's own preflight script's documented workaround). `node scripts/audit-ci.cjs` confirmed PASS.

## 5. Audit Independence

This pass treated docs 14-25 as a map of what to re-check, not as evidence. Every P0/P1 closure claim was independently re-traced to current file:line; every quality-gate count was independently re-executed in this session rather than copied. Four parallel investigation streams (canonical authority/Rules; progression math/long-run; migration/concurrency/multi-device; execution authority/deferral/rollout/CI/test-quality) worked from the same instruction to distrust prior PASS verdicts and actively hunt for regressions or missed cases. Three streams (canonical authority/Rules; migration/concurrency; execution/rollout/test-quality) returned complete, on-scope reports. The stream tasked with progression math/long-run journeys instead independently re-derived a second, deeper pass over canonical-authority/Rules territory (overlapping the first stream) and surfaced the §49 finding below — valuable, but it means progression math/long-run was never returned to after this lead auditor's own direct check (§16). This is disclosed rather than papered over: §92 lists the resulting gap.

## 6. Documents Reviewed

`00_OVERVIEW.md`, `02_DOMAIN_MODEL.md`, `architecture/01_TARGET_ARCHITECTURE.md`, `architecture/22_POST_PHASE_10C_FINAL_ADVERSARIAL_AUDIT.md`, `architecture/23_PHASE_10D_FINAL_AUTHORITY_BYPASS_REMEDIATION.md`, `architecture/24_PHASE_10DV_VERIFICATION_CLOSURE.md`, `architecture/25_PHASE_10DV2_LONG_RUN_JOURNEY_CLOSURE.md`, ADR-016, plus (by the investigation streams) `progression/*`, `prescription/01_LEVEL_PROMOTION.md`, `decisions/ADR-009_PENDING_EVOLUTION_AND_DEFERRAL.md`. Direct code review covered `functions/src/workoutLifecycle/authorizeMutation.ts` (full, 1098 lines), `firestore.rules` (full V2 sections, 2027 lines), `src/services/workoutPrograms.ts`, `src/services/workoutLifecycleApplication.ts`, `src/services/workoutExecutions.ts`, `src/workoutLifecycle/{deferral,rollout,mutationQueue,finishFlow}.ts`, `src/progressionEngineV2/{config,adherence}.ts`, `firestore-tests/workoutPrograms.rules.test.ts`, `functions/src/accountDeletion/firestoreCleanup/{resources,engine}.ts`, `.github/workflows/ci.yml`.

## 7-15. Architecture, Source-of-Truth, Trust Boundary, Hot Path, Domain Identity, StartingLevel/CurrentTrainingLevel/TrainingCycle/ProgramInstance Authority

**PASS**, consistent with the architecture reconstructed in prior audits and independently re-confirmed by the canonical-authority stream: `Questionnaire → Prescription Engine → Program Content/Instance → Schedule → Execution → Progression Evaluation → Evolution Decision → Prescription/Activation`, with `workoutLifecycleState/current` as the single backend-controlled authoritative pointer (`activeContentIdentity`/`activeProgramInstanceId`) that all real progression/adherence/execution logic reads — never `workoutProgramState/active`, which is display-layer only (this distinction is exactly what makes finding P2-1 in §48 bounded rather than critical). `StartingLevel` immutability, `CurrentTrainingLevel`/`TrainingCycle`/`ProgramInstance` separation were independently re-confirmed by the progression-math check (§16) and the long-run journey's own assertions (`startingLevel === 'BEGINNER'` held after two promotions).

## 16. Progression Mathematics — Independently Re-Verified

Read `src/progressionEngineV2/config.ts` and `adherence.ts` directly this pass (not inherited). Current exact values, confirmed against source, unchanged from all prior audits: `beginnerMinimumActiveDays: 28`, `intermediateAdvancedMinimumActiveDays: 85`, `intermediateCyclesForPromotion: 4`, `adherenceEarnedThresholdBp: 7000` (70.00%), `adherenceHighThresholdBp: 8500` (85.00%), `motivationalRenewalExtensionDays: 30`, `inactivityMissedOpportunityThreshold: 3`, `partialSessionMinSetCompletionPercent: 70`. Boundary math: `classifyAdherenceQualityFromCounts` uses integer cross-multiplication (`fulfilled*10000 >= expected*thresholdBp`) — no float rounding exposure, exact 70%/85% boundary. `computeAdherence` caps the ratio at 1.0, so extra workouts structurally cannot push adherence past 100%. No hardcoded cycle-number ceiling, array-index-by-cycle, or switch/enum with a fixed case count was found anywhere in `src/progressionEngineV2/` or the ADAPT/PREPARE cycle-number logic (`cycleNumber: currentCycleNumber + 1`, unbounded successor arithmetic, confirmed by the migration/concurrency stream at `workoutLifecycleApplication.ts:644-645`).

## 17-29. Boundary/Adherence/Active-Time/Backdating/Promotion/Frequency/4-Cycle/Advanced/Renewal (Long-Run Coverage)

Per the audit's own §92 rule, marking rather than fabricating: **this pass did not independently re-execute the long-run Beginner→Intermediate→Advanced→ADAPT→Renewal integration journeys itself** — the dedicated fork tasked with this did not return a completed report within the session budget. The lead auditor independently confirmed the underlying constants (§16) and, from the migration/concurrency stream's independent reading of `prepareEvolution`/`persistEarnedFact`/`evaluateProgressionV2ForUser`, confirmed the ADAPT-resets-progress contract holds by direct code tracing (§30) — which is the core mechanism the long-run ADAPT journey (VG-I) depends on. Backdating boundary behavior (cross-ProgramInstance, cross-ADAPT, future-dating) was not independently re-executed this pass; Phase 10D-V's own dynamic tests for this were read only in passing. **Classification: NOT_TESTED this pass for the full dynamic long-run re-execution** (VG-H/I/J/F equivalents) — inherited from Phase 10D-V2's own claimed PASS, not independently reproduced. This is disclosed as a residual verification gap, not asserted as a fresh PASS, and factors into the internal-only (not staged-rollout) authorization in §97.

Exercise equivalence, safety precedence, ping-pong prevention, and determinism (audit §23-27) were likewise not independently re-verified by a completed stream this pass — same NOT_TESTED disclosure, same residual-gap status. No evidence contradicting prior PASS claims was found, but none was independently generated either.

## 30. ADAPT × PREPARE Concurrency — Independently Re-Judged, Not Cited

The migration/concurrency stream did not take Phase 10D-V2's "the old test's assertion was wrong, not production" conclusion on faith. It independently read `prepareEvolutionAttempt`/`persistEarnedFact`/`loadOutstandingEarnedFact` (`workoutLifecycleApplication.ts:145-467`) and confirmed the mechanism: an earned fact is persisted as an immutable ledger entry *before* pending-evolution content generation; if that fact exists before a concurrent ADAPT commits, PREPARE correctly re-scopes to the new post-ADAPT instance (not stale); if ADAPT commits first, `evaluateProgressionV2ForUser` legitimately re-evaluates against the reset-clock new instance and correctly returns `NO_ACTION`. Retries are bounded at 3 attempts, never infinite, always failing closed to a typed outcome — no unhandled-rejection path exists. **Independent verdict: the corrected contract is genuinely correct, not a rationalized-away bug.** PASS, confirmed by this pass's own reading, not by trusting the prior doc's narrative.

## 31-37. Migration, Multi-Device, History Reconstruction

**MIGRATE: PASS.** `authorizeMutation.ts:632-705` hard-fails repeat/concurrent MIGRATE with `lifecycle_already_initialized` before any content generation (closing duplication at the root), and fails closed with `legacy_baseline_program_missing` if no real V1 baseline exists. Client `targetPlan` is always discarded for MIGRATE. Independently confirmed via direct code reading, not doc citation.

**Partial migration/crash recovery: PASS structurally, one narrow window NOT_TESTED.** `recoverWorkoutLifecycle PartialState` and `reconcileWorkoutLifecycle` are pure reconciliation (never write new content), and MIGRATE's own `lifecycle_already_initialized` guard means a retry after a crash either cleanly re-runs MIGRATE or converges via read-only RECOVER — no duplication path was found. The exact window between grant consumption and lifecycle-state write during MIGRATE has no dedicated crash-simulation test; disclosed as NOT_TESTED (small, structurally bounded exposure, not a confirmed defect).

**Multi-device / offline-online: NOT_TESTED**, consistent with every prior phase's own disclosure. No test simulates literal offline-then-reconnect stale-mutation replay; concurrent-caller races (`Promise.all`/`allSettled`) are a reasonable proxy but not the same as offline replay. Carried forward, not newly resolved.

**Account deletion: PASS.** `functions/src/accountDeletion/firestoreCleanup/{resources,engine}.ts` confirmed (via direct import/wiring check, not just presence of a constant) to include and invoke cleanup for `workoutLifecycleState`, `trainingCycles`, `programInstances`, `workoutLifecycleEvents`, `pendingEvolutions`, `workoutLifecycleAuthorityGrants`, `workoutLifecycleTrustedTelemetryReceipts`. No orphaned V2 PII collection found.

## 38-50. Backend Canonical Authority — INITIALIZE/MIGRATE/ADAPT/PREPARE/ACTIVATE/RECOVER

**PASS across all six operations, independently re-derived this pass, not cited from docs 23-25.**

- **RECOVER (P0 area):** `authorizeMutation.ts:719-721` — any `request.targetPlan != null` throws `permission-denied/recover_does_not_install_content` unconditionally, before any bounds-check runs. Identity fields are always re-derived from `workoutLifecycleState/current` or the unique active `(trainingCycles, programInstances)` pair, never from client input. All RECOVER callers were re-derived from scratch this pass (not the old caller list): `src/services/workoutPrograms.ts:638,671` (gated by `preflightSameContent`), `src/services/workoutLifecycleApplication.ts:802-806,831-836` (pure reconciliation). No new call site exists. `sealTargetProgram` (the only function that persists content under a grant) is never invoked for RECOVER — confirmed at the dispatch site (`authorizeWorkoutLifecycleMutationHandler:1067`, scoped to `['INITIALIZE','MIGRATE','ACTIVATE','ADAPT']` only). **No exploitable variant found; the P0 fix is solid and unregressed.**
- **INITIALIZE/MIGRATE/ADAPT/PREPARE:** `generateCanonicalPlan`/`generateCanonicalCycleEvolution` always called; client `targetPlan` never read for output; `merged = {...data, ...validated}` (`:1061`) ensures backend values win.
- **ACTIVATE:** full `pendingEvolutionId` match required against `pendingEvolutions/current` (plan/identity/level/cycle-number), server-checked (`:868,876-891`).
- **Grant attack matrix (replay, cross-user, wrong-operation, stale-source, expiry): PASS, unchanged**, re-verified statically against current line numbers (`existsAfter(grantPath)` replay guard `:1148`; owner-scoped path structurally prevents cross-user; per-collection `operation in operations` allowlists; `assertSource` staleness checks `:151-156,726-734`).

## 48. NEW FINDING — `workoutPrograms` Firestore Rules `allow update` Has No Grant Requirement

- **Severity: P2**
- **Title:** Stale/superseded `workoutPrograms` document can be reactivated and repointed without an authority grant
- **Evidence:** `firestore.rules` — Phase 10D's fix (doc 23 §12-14) hardened only the `create` rule (`:875-891`). The `update` branch (`:893-914`) requires only that the diff touch `status`/`activatedAt`/`updatedAt` and that `workoutProgramState/active` stay internally consistent — **`consumesLifecycleAuthorityGrant` is never called in the update branch.**
- **Attack:** In one batch, a user can flip a previously-sealed, now-`superseded` `workoutPrograms` document's `status` back to `active` (self-authored, no grant, diff restricted to allowed keys) and repoint `workoutProgramState/active.programId` at it.
- **Why it's bounded, not a canonical-authority break:** The real backend authority (`activeBundle` in `authorizeMutation.ts:158-182`) reads exclusively from `workoutLifecycleState/current.activeContentIdentity`/`activeProgramInstanceId` — never `workoutProgramState/active`. Progression, adherence, and `FINISH_EXECUTION`'s session-qualification check (`:895-909`, `execution.programInstanceId === bundle.state.activeProgramInstanceId`) are all unaffected by this rule gap.
- **Actual impact:** A user's *displayed* program content can drift from their *authoritative* lifecycle content — a stale/wrong-content UI/schedule-display bug, not a progression or security exploit.
- **Test coverage gap:** `firestore-tests/workoutPrograms.rules.test.ts`'s `attemptV2Write` helper family exercises `create`, not this `update` shape — confirmed by direct reading of the 484-line file; no test would catch a regression here.
- **Recommendation (not implemented, per audit rules):** require `consumesLifecycleAuthorityGrant` unconditionally on `workoutPrograms` `update` as well as `create`, mirroring the Phase 10D `create` fix; add the corresponding adversarial rules test.

## 49. NEW FINDING — Repeated Optional-Field-Omission Pattern in `scheduleState`/`scheduleEvents`/`workoutProgramState`

- **Severity: P2** (escalated from an initial P3 read after a second, deeper independent pass — see below; recommend treating as P1-pending-confirmation, not closed as hygiene-only)
- **Confirmed structural violation:** the exact shape that caused the original FS-RULES-BYPASS-01 P0 (`!('field' in data) || (...)`) is reused, unfixed by any of Phases 10D/10D-V/10D-V2, at `scheduleState` update (`firestore.rules:964,971-978` — omitting `programInstanceId` skips the entire `consumesLifecycleAuthorityGrant(...COMPLETE_SCHEDULE/RESOLVE_MISSED_SESSION...)` check) and `scheduleEvents` create (`:987-1014`, specifically `995`'s `!request.resource.data.keys().hasAny(['programInstanceId']) || (...)` — omitting the field skips the entire grant-and-target-match disjunct at `:996-1008`). A client can create an unauthorized `scheduleEvents` ledger entry (`type`, `sessionIndex`, `scheduledDate`, `occurredAt`, no grant) with zero backend authorization.
- **Two independent investigation passes reached different depths on exploitability, and neither fully closes the question:**
  - One pass traced only the `COMPLETED`-adherence path: `authoritativeEarnedFact` (`authorizeMutation.ts:335-337`) requires an *exact* `programInstanceId` match, so an omitted-field forged event cannot directly inflate adherence credit — concluded "dead for V2."
  - A second, later pass traced further into `src/progressionEngineV2/prescribedOpportunities.ts:57-67`, and found that `buildExpectedSessionIndexByDate`'s `rotationEvents` input is **not** restricted to `COMPLETED` events — it also ingests `SKIPPED`/`MISS_RESOLVED` entries, which is exactly the class of forged grant-free write the Rules gap permits. Whether a forged `SKIPPED`/`MISS_RESOLVED` `scheduleEvents` entry can shift the computed rotation/expected-session-index for subsequent *real* completions (potentially manipulating what session a later legitimate execution is credited against) was traced into `expectedSessionIndex.ts` but not conclusively resolved before this pass's time budget ran out.
- **Classification: PLAUSIBLE, not CONFIRMED**, per this audit's own evidence standard (§91) — the adherence-inflation angle via forged non-`COMPLETED` rotation events was not proven exploitable, but was also not ruled out. This is exactly the kind of gap the audit brief warns against closing prematurely with an unearned PASS.
- `workoutProgramState/active` omission is the already-classified finding at §48 (bounded, confirmed impact).
- **Recommendation (not implemented, per audit rules):** treat as the top-priority item for a dedicated follow-up pass — trace `expectedSessionIndex.ts`'s handling of forged non-`COMPLETED` rotation events to a definitive conclusion before relying on the "dead code" read. Independent of that outcome, close the Rules pattern structurally (unconditional grant requirement on `scheduleState`/`scheduleEvents` writes, mirroring the `workoutPrograms` `create` fix) rather than depending on downstream consumers happening to filter correctly — this exact reasoning ("a future code path might start trusting this") is what the original P0 already taught this codebase once.

## 50. NEW FINDING — Rollout Kill Switch Does Not Cover Already-Migrated Users

- **Severity: P2**
- **Title:** `src/workoutLifecycle/rollout.ts` only gates new V1→V2 migrations, not mutations for accounts already on V2
- **Evidence:** The module's own scope, confirmed by direct reading — it decides whether a fresh V1 account is allowed to *begin* migrating to V2 (deterministic UID cohort + versioned config). Once `workoutLifecycleState/current` exists, rollout config is never consulted again; ADAPT/PREPARE/ACTIVATE/RECOVER proceed unconditionally for that account regardless of the flag's state.
- **Why this matters:** The audit brief's own kill-switch scenario (§58-59: "if V2 begins failing during staged rollout, does the kill switch prevent new dangerous transitions?") is about the cohort *already on V2* — that is precisely the population a staged rollout is actively watching. The kill switch as implemented cannot stop that cohort's mutations if a defect surfaces mid-rollout; it can only stop the rollout from growing.
- **Not a security bypass** — this is an operational/rollback-authority gap, not a client-side exploit. But it does not meet a naive reading of "kill switch" and materially changes the operational plan for staged rollout (see §96).
- **Recommendation (not implemented):** either document this scope limit explicitly in rollout messaging/runbooks so on-call does not believe it can freeze existing V2 users mid-incident, or add a genuine circuit-breaker that can suspend content-producing mutations for already-migrated accounts.

## 51-70. Execution Authority, Finish Ordering, Pending Evolution/Deferral, CI, Test Quality, UI Truthfulness — PASS

**Execution authority: PASS.** `isValidProgressionSessionAgainstPrescription` (`src/progressionEngineV2/sessionQualification.ts:76-114`) requires exact set-count/exercise-count/index match against the real prescribed session — a 1,000,000-set attack fails this exact-match check and earns zero credit, not merely "capped." `finishWorkoutExecution` is idempotent (`workoutExecutions.ts:233-259`) — duplicate finish returns existing terminal status, no double-count. One **new P3**: `workoutExecutionCommonValid` (`firestore.rules:352-386`) bounds the top-level `exercises` array (`<=20`) but not each exercise's `sets` array length — an unbounded-write hygiene gap (capped only by Firestore's 1MB doc limit), with zero progression/credit impact since session-qualification's exact-match check neutralizes any inflated array.

**Finish ordering: PASS.** `WorkoutMutationQueue.flush()` is awaited before `finishWorkoutExecution`; a failed finish returns `null` and `completeWorkoutSessionFlow` short-circuits before ever calling `completeSchedule()` — a failed finish structurally cannot advance schedule/progression.

**Deferral: PASS, constants independently confirmed.** `DEFERRAL_CONFIG = { windowDays: 14, maxDeferrals: 2 }` (`src/workoutLifecycle/deferral.ts:4-7`) matches the documented "two weeks, then two more, four weeks total." Firestore Rules independently re-enforce the same 13-15-day window server-side (`:1596-1615`), so a client cannot shorten/lengthen it by direct write. Earned-target-level vs. active-program-level separation is structural: `pendingEvolutions/current` is a distinct document from the active pointer, no field aliasing found.

**CI/reachability: PASS.** 5-job workflow confirmed (`static`, `unit`, `firebase-integration`, `functions`, `functions-integration`); all `describe.skipIf` hits are env-gated and reachable; `LONG_RUN_JOURNEY_INTEGRATION=1` confirmed present in `package.json`'s `test:integration` env-var list. No `.only`/hard `.skip`/`xit`/`xdescribe` found in lifecycle-related test files.

**Test quality: PASS on the 8+ tests spot-checked this pass** (RECOVER safe-but-wrong, RECOVER identity-attack, Rules omission-exploit, MIGRATE C1-C8, deferral races) — each genuinely exercises the attacker-controlled path and asserts on resulting state (e.g. grant identity equals the *seeded backend value*, not merely "not the attacker's value"), not weak existence checks. One coverage gap identified: no test for the §48 finding's `update`-path shape.

**UI truthfulness: PARTIAL.** No hardcoded percentage/streak/XP found in `EvolutionUnlockScreen.tsx`. `ConsistencyScreen.tsx` and `src/workoutEvolution/` were not fully swept — disclosed as NOT_TESTED for full coverage, not asserted PASS.

**XP boundary (ADR-005): PASS** on the areas checked — no XP-balance/ranking-point/reward-amount logic found inside the lifecycle domain files reviewed.

## 71. Severity Rubric

Used exactly as defined in the audit brief (P0 = exploit/canonical-authority break/security-critical; P1 = reproducible hot-path functional break; P2 = bounded/contained; P3 = polish/hygiene). No severity was downgraded to ease approval.

## 86. Security Attack Table

| Attack | Entry point | Attacker capability | Expected defense | Actual result | Evidence | Severity |
|---|---|---|---|---|---|---|
| RECOVER safe-but-wrong plan | `authorizeWorkoutLifecycleMutation` op=RECOVER | Authenticated owner, valid App Check | Deny, no content installed | **DENY** — unconditional `targetPlan != null` rejection | `authorizeMutation.ts:719-721` | — (fixed, re-confirmed) |
| workoutPrograms create, no grant | Direct Firestore write | Authenticated owner | Deny | **DENY** | `firestore.rules:875-891` | — (fixed, re-confirmed) |
| **workoutPrograms update, reactivate stale doc, no grant** | Direct Firestore batch write | Authenticated owner | Deny | **ALLOW — display drift only, authority unaffected** | `firestore.rules:893-914` | **P2 (new)** |
| Grant replay | Direct Firestore write | Authenticated owner | Deny | **DENY** (`existsAfter` guard) | `firestore.rules:1148` | — |
| Cross-user grant | Direct Firestore write | Authenticated owner | Deny | **DENY** (structural, `/users/{userId}` scoping) | — | — |
| 1,000,000-set execution | `finishWorkoutExecution` | Authenticated owner | Zero credit | **DENY** (exact-match session qualification) | `sessionQualification.ts:76-114` | — |
| Duplicate finish | `finishWorkoutExecution` | Authenticated owner | Idempotent, no double-credit | **PASS** | `workoutExecutions.ts:233-259` | — |
| Kill switch during active incident (already-migrated cohort) | Operational | N/A | Halt new dangerous transitions | **NOT COVERED for already-migrated users** | `rollout.ts` scope | **P2 (new)** |
| ADAPT × PREPARE race | Concurrent calls | Authenticated owner, 2 devices | Bounded convergence, no corruption | **PASS**, independently re-derived (not cited) | `workoutLifecycleApplication.ts:145-467` | — |
| Forged grant-free `scheduleEvents`/`scheduleState` write (omitted `programInstanceId`) | Direct Firestore write | Authenticated owner | Deny (unconditional grant requirement) | **ALLOW at Rules layer** — COMPLETED-adherence path neutralized by exact-match filter downstream; SKIPPED/MISS_RESOLVED rotation-index manipulation path traced but not conclusively resolved | `firestore.rules:964,971-978,995-1008`; `prescribedOpportunities.ts:57-67` | **P2 (new), PLAUSIBLE not CONFIRMED escalation path** |

## 87. Requirement Matrix (Condensed)

| Requirement | Status |
|---|---|
| Canonical authority (INITIALIZE/MIGRATE/ADAPT/PREPARE/ACTIVATE) | PASS |
| RECOVER | PASS (re-confirmed, no regression) |
| Firestore Rules — create paths | PASS |
| Firestore Rules — update paths | **PARTIAL (new P2, §48 + §49)** |
| Execution authority | PASS |
| Finish ordering | PASS |
| Deferral / pending evolution | PASS |
| ADAPT × PREPARE concurrency | PASS (independently re-judged) |
| MIGRATE adversarial | PASS |
| Multi-device / offline | NOT_TESTED (carried forward) |
| Account deletion | PASS |
| Progression math / boundaries | PASS (constants re-verified) |
| Long-run journeys (VG-H/I/J/F) | NOT_TESTED this pass (inherited PASS, not reproduced) |
| Exercise equivalence / safety / determinism | NOT_TESTED this pass (inherited PASS, not reproduced) |
| Rollout / kill switch | **PARTIAL (new P2, §50)** |
| CI / test reachability | PASS |
| Quality gates (all 8) | PASS, independently re-executed |

## 88-89. P0/P1 Findings

None found in this pass.

## 90. P2 Findings

1. `workoutPrograms` Firestore Rules `allow update` lacks a grant requirement — stale/superseded content can be reactivated, bounded to display/content drift (§48).
2. Rollout kill switch only gates new migrations, not already-migrated V2 users' mutations (§50).
3. Optional-field-omission Rules pattern (the FS-RULES-BYPASS-01 shape) recurs, unfixed, in `scheduleState`/`scheduleEvents` writes; the `COMPLETED`-adherence path is neutralized by a downstream exact-match filter, but a forged-`SKIPPED`/`MISS_RESOLVED`-event rotation-index-manipulation angle was traced but not conclusively resolved — PLAUSIBLE not CONFIRMED, top-priority follow-up item (§49).

## 91. P3 Findings

1. No per-exercise `sets` array length bound in `workoutExecutionCommonValid` — write-size hygiene only (§51).
2. Carried forward, unchanged from prior phases: grant-singleton last-write-wins race; sync-script AppState marker gap; `firestore-debug.log` git hygiene.

## 92. NOT_TESTED Items (This Pass)

- Full dynamic re-execution of the long-run journeys (VG-H/I/J/F equivalents) — inherited from Phase 10D-V2's own claimed PASS, not independently reproduced this pass (§17-29).
- Exercise equivalence / safety-precedence / ping-pong / determinism dynamic re-verification (§17-29).
- Multi-device offline-then-reconnect replay (carried forward from every prior audit, §31-37).
- Narrow MIGRATE crash window between grant consumption and lifecycle-state write (§31-37).
- Full UI-truthfulness sweep beyond `EvolutionUnlockScreen.tsx` (§51-70).
- Rules test coverage for the §48 `update`-path finding.

## 93. Documentation Drift

None found beyond the items above. Constants in `config.ts` match documentation exactly; no drift.

## 94. Residual Risks

The two new P2s are real but bounded: neither allows progression manipulation, content-authority bypass, or credential/grant exploitation. The larger residual risk is coverage, not correctness — the long-run journey and exercise-safety claims inherited from Phase 10D-V2 were not independently reproduced this pass, so this audit cannot certify them at the same evidentiary bar it applied to canonical authority and execution.

## 95. Rollout Preconditions

Before any staged (non-internal) rollout: (a) fix or explicitly accept-and-document the `workoutPrograms` update-path grant gap (§48); (b) resolve the §49 `scheduleEvents`/`scheduleState` rotation-index-manipulation question to CONFIRMED-safe or CONFIRMED-exploitable — this is the single highest-priority open item in this report, since an unresolved adherence/credit-manipulation path is exactly the class of defect that must be closed before any external user is exposed; (c) either implement a genuine circuit-breaker for already-migrated users or rewrite rollout/kill-switch documentation and runbooks to state its real scope so on-call does not over-trust it mid-incident; (d) independently re-execute the long-run journey and exercise-safety claims this pass could not reproduce, since staged rollout is precisely when a multi-cycle identity-corruption bug would surface.

## 96. Recommended Rollout Shape

Not yet applicable — see §97. Once the above preconditions are met: internal cohort → small deterministic-UID external percentage (the existing rollout infrastructure already supports this for new migrations) → observe telemetry → increase gradually, with an explicit incident runbook that accounts for the kill switch's real (narrower) scope in the interim.

## 97. Final Authorization Rationale

No P0 or hot-path P1 was found, so NOT READY is not mandated. However, §74's staged-rollout bar requires "rollout/kill switch: PASS" and implicitly requires long-run/exercise-safety coverage this pass could not independently reproduce (§92). The two new P2s are real, previously-undocumented gaps — one of them (kill switch scope) directly touches the exact operational safety net a staged rollout depends on. Per §73, internal-only is appropriate when no P0/P1 is confirmed but important verification remains open and/or a critical rollout-safety item needs closing first.

## 98. Final Verdict

```
FINAL AUTHORIZATION: READY FOR INTERNAL TESTING ONLY
```
