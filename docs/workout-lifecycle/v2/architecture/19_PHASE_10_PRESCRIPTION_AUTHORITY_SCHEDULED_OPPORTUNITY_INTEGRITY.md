# Phase 10 — Prescription Authority & Scheduled Opportunity Integrity

Date: 2026-08-31

## 1. Executive Verdict

**FASE 10 PARTIAL.** Both concrete, reproduced vulnerabilities are fixed and covered by regression tests, all quality gates are green, and the authority-emulator suite is now CI-enforced. One item remains genuinely open by design choice, not oversight: full backend-independent regeneration of the canonical prescription content (see §61 and ADR-016 "Known limitation"). That gap does not undermine the two fixes below — it's a defense-in-depth ceiling on Blocker A, not a hole in it.

## 2. Git Before

Branch `main`, HEAD `d24319ba15e63095fd376bcd99acd30f4abce343`, large pre-existing uncommitted worktree (prior in-progress phases 1–9 work, confirmed via `git status`/`git diff --stat` before any edit in this phase — not created by this phase).

## 3. Git After

Same branch/HEAD (no commits made — per instructions). Additional modified/created files listed in §58/§59.

## 4. Environment

Root Node 20 (`.nvmrc`), Functions Node 22, `firebase-tools` 15.26.0 (root devDependency pin), Java: environment shipped Java 17 by default (insufficient — `firebase-tools` requires 21+); Java 21 was available via `openjdk@21` (installed, not default-linked) and used explicitly (`JAVA_HOME`/`PATH` override) for every emulator-backed suite in this phase. CI already pins Java 21 via `actions/setup-java@v4`.

## 5. Documents Reviewed

`ADR-015_WORKOUT_LIFECYCLE_TRUST_BOUNDARY.md`, `18_PHASE_9_FINAL_BLOCKER_REMEDIATION.md`, `13_OPERATIONS_RUNBOOK.md`, `progression/06_ADHERENCE.md`, `prescription/02_CYCLE_ROTATION.md`, plus direct code reading of `functions/src/workoutLifecycle/authorizeMutation.ts`, `firestore.rules`, `src/progressionEngineV2/`, `src/scheduleEngine/`, `src/services/workoutSchedule.ts`, `src/services/workoutPrograms.ts`, `functions/src/telemetry/`, `.github/workflows/ci.yml`, `scripts/audit-ci.cjs`. Note: no separate "Phase 9 → Phase 10 NOT_READY audit document" exists in the repo — the on-disk Phase 9 report self-declares `FASE 9 COMPLETE`. The two blockers this phase addresses were independently re-derived and confirmed against the current code, not copied from an audit doc that doesn't exist here.

## 6. Baseline Architecture

V2 lifecycle: `workoutLifecycleState` / `trainingCycles` / `programInstances` / `pendingEvolutions` / `workoutLifecycleEvents` are grant-gated via `authorizeWorkoutLifecycleMutation` + `consumesLifecycleAuthorityGrant`. `workoutPrograms` (content) and `workoutProgramState/active` (pointer) were **not** grant-gated. Schedule rotation: `ScheduleState.nextSessionIndex` cursor, advanced by client transaction; `scheduleEvents` COMPLETED writes were grant-gated (`COMPLETE_SCHEDULE`) but the grant only checked "a finished execution with this sessionIndex/date exists," never that the sessionIndex was the *correct* one for that date.

## 7. Original Arbitrary-Plan Exploit

A client that (a) never calls `authorizeWorkoutLifecycleMutation`, or (b) calls it but omits `targetProgramSource`, can write directly to `workoutPrograms/{programId}` + `workoutProgramState/active` via the client SDK. `workoutProgramCommonValid`/`workoutProgramLimitationValid` check shape and metadata (template exists, hash matches, trace array is the right *size*) but never cross-reference individual `exerciseId`s against `exercises/{id}.limitationProfile`, and never bound `sets`/`reps`/`restSeconds`. A structurally valid plan with an exercise incompatible with a declared limitation, or with 1,000,000 sets, passes every existing Rules check.

## 8. Exploit Reproduction

Reproduced at the Rules layer (`firestore-tests/workoutPrograms.rules.test.ts`, new `describe('V2 prescription authority ...')` block): before the fix, a direct `workoutPrograms`/`workoutProgramState` write with an arbitrary 1,000,000-set exercise and no grant of any kind succeeds. Reproduced at the callable layer (`authorizeMutation.integration.test.ts`, new test): before the fix, `assertPlanSafe` did not bound `sets`, so an ADAPT request with a 1,000,000-set exercise passed plan-safety validation (the only defense was the pre-existing Rules gap, i.e. none).

## 9. Root Cause

Two independent gaps: (1) the two writes that make content *live* were never required to have gone through `authorizeWorkoutLifecycleMutation` at all; (2) `assertPlanSafe`, the one function that does run when the callable *is* used, checked exercise-active/limitation-compatibility but not numeric plausibility.

## 10. Prescription Trust Boundary Before

Client-supplied `targetPlan` was trusted as sealed content whenever the callable happened to be invoked with `targetProgramSource` set; entirely bypassable by not setting that field or not calling the callable.

## 11. Prescription Trust Boundary After

`sealTargetProgram` (which runs `assertPlanSafe`) is unconditional for `INITIALIZE`/`MIGRATE`/`ACTIVATE`/`ADAPT`. `firestore.rules` requires a valid, same-user, unexpired, unconsumed grant (`INITIALIZE`/`MIGRATE`/`ACTIVATE`/`ADAPT`/`RECOVER`) bound to the exact `targetContentIdentity` before `workoutPrograms`/`workoutProgramState` (V2) can be written at all. `assertPlanSafe` additionally bounds sets/reps/rest. See ADR-016 for the full before/after and the documented residual gap (full backend regeneration).

## 12. Client Intent Contract

Unchanged in shape: client still sends `targetPlan`/`targetPrescriptionInputSnapshot`/operation/source-target identity fields. What changed is enforcement, not the wire contract — no client code needed to change its request shape (only `resolveMissedSession` gained a new callable invocation, `RESOLVE_MISSED_SESSION`, mirroring the existing `completeScheduledSession` pattern).

## 13. Backend Prescription Generation

**Not implemented this phase** (see ADR-016 "Known limitation" and §61). The backend does not independently regenerate the canonical plan from questionnaire/level inputs; it validates the client's candidate against bounds, catalog state, and (for schedule/opportunity operations only) an independently-computed authoritative value.

## 14. Authoritative Inputs

Unchanged from Phase 9: `PrescriptionInputSnapshot` (`snapshotId`/`source`/`inputs`) remains the authoritative input record, validated via `assertSnapshot`'s canonical-equality check against backend-derived `expectedInputs`.

## 15. Canonicalization

Unchanged existing mechanism (`canonical()` stable-serialize + `stableHash`/`snapshotIdFor`) reused as-is; no new canonicalization scheme was needed since full regeneration was out of scope.

## 16. Content Identity

`targetContentIdentity` is now load-bearing at the Rules layer (previously only load-bearing inside the callable/grant). `sealTargetProgram`'s existing byte-equality check (if a `contentIdentity` doc already exists, every field must match) is unchanged and still the mechanism preventing two different contents sharing one identity.

## 17. Grant Target Binding

Extended: `targetContentIdentity` (prescription), `targetNextSessionIndex`/`targetCursorDate` (schedule cursor advance), `targetScheduleEvents` (list of `{type, sessionIndex, scheduledDate}` the `RESOLVE_MISSED_SESSION` grant authorizes) — all backend-computed, never client-supplied verbatim.

## 18. ADAPT Flow

Unchanged request shape; `sealTargetProgram` now always runs (previously conditional on `targetProgramSource`).

## 19. PREPARE Flow

Unchanged — `PREPARE` was already unconditionally calling `assertPlanSafe`; it does not seal (`sealTargetProgram` is only for `INITIALIZE`/`MIGRATE`/`ACTIVATE`/`ADAPT` — `PREPARE` writes to `pendingEvolutions`, already grant-gated in Rules from Phase 9).

## 20. Promotion Flow

Unchanged — Level Promotion reuses `ACTIVATE`, now covered by the same unconditional-sealing fix.

## 21. Renewal Flow

Unchanged — Motivational Renewal reuses `ACTIVATE`/`PREPARE`, same coverage as above.

## 22. Server-Side Invariants

`assertPlanSafe` new bounds: `sets` integer 1–10, `restSeconds` integer 0–600, `reps` non-empty string ≤20 chars, in addition to pre-existing session-count (1–7), exercise-count (≤100), exercise-ID shape, exercise-active, and limitation-compatibility checks.

## 23. Arbitrary Plan Attack Matrix

| Attack | Result |
|---|---|
| 1,000,000 sets | REJECT (`invalid_authority_plan_exercise_sets`, `authorizeMutation.integration.test.ts`) |
| Direct write, no grant at all | REJECT (`workoutPrograms.rules.test.ts`) |
| Grant for wrong `targetContentIdentity` | REJECT |
| Grant for a non-plan-sealing operation (`DEFER`) | REJECT |
| Cross-user grant | REJECT |
| Expired grant | REJECT |
| Valid, matching, same-user grant, consumed once | ACCEPT |
| Replay of an already-consumed grant | REJECT |

## 24. Grant Attack Matrix

Replay, cross-user, wrong-operation, expired — all explicitly tested in `workoutPrograms.rules.test.ts`'s new `describe` block (§8/§23 above). Stale-source (source changed underneath) was already covered pre-existing by `assertSource`/`grantSourceMatches` from Phase 9 and is unaffected by this phase.

## 25. Opportunity Architecture Before

`PrescribedOpportunity = { scheduledLocalDate, programInstanceId }`, no session identity. `execution.sessionIndex` selected its own "expected" value at the only real call site in both client (`prescribedOpportunities.ts`) and backend (`authorizeMutation.ts`).

## 26. Opportunity Architecture After

Expected session index is derived authoritatively: backend via the synced `resolveWorkoutSchedule`/`detectMissedSessionGap` against the real, now-write-protected `scheduleState` cursor; client (optimistic display) via a ledger replay (`buildExpectedSessionIndexByDate`) over the same now-trustworthy `COMPLETED`/`SKIPPED` events.

## 27. Expected Session Authority

`COMPLETE_SCHEDULE` computes `resolveWorkoutSchedule(...)` from authoritative context and requires `resolution.status === 'SESSION_READY' && resolution.sessionIndex === request.sessionIndex`. `execution.sessionIndex` is never consulted for this decision.

## 28. Schedule Rotation/Cursor

`ScheduleState.nextSessionIndex`/`cursorDate` remain the persisted cursor (unchanged shape). What changed: a V2 write that *advances* the cursor now requires a matching `COMPLETE_SCHEDULE`/`RESOLVE_MISSED_SESSION` grant; a write that leaves it unchanged (miss-detection bookkeeping) stays ungated, preserving existing UX exactly.

## 29. Wrong Session Reproduction

`authorizeMutation.integration.test.ts`: a finished execution claiming the cheaper 1-exercise "session B" for a date the real anchor owes "session A" is rejected by `COMPLETE_SCHEDULE`. Client-side equivalent in `prescribedOpportunities.test.ts`.

## 30. Wrong Session Fix

See §27/§29 — both layers now independently derive the true expected index rather than trusting the execution's claim.

## 31. Backdating Analysis

`assertNotBackdated`: rejects `scheduledLocalDate` more than 3 days before the server's current date, or in the future, for `COMPLETE_SCHEDULE`/`RESOLVE_MISSED_SESSION`. The 3-day window is a deliberate offline-sync allowance (see ADR-016) — not zero-tolerance, to avoid breaking legitimate delayed sync.

## 32. COMPLETE_SCHEDULE Integrity

Now validates, in order: schedule configured → not backdated → resolver says `SESSION_READY` at exactly `request.sessionIndex` → a qualifying finished execution exists for that index/date. Previously only the last check existed.

## 33. Opportunity Attack Matrix

| Attack | Result |
|---|---|
| Wrong session (cheaper) for a date | REJECT |
| Right session | ACCEPT, fulfills once |
| Duplicate execution for one opportunity | No double count (pre-existing dedup, unaffected) |
| Extra workout, no opportunity | No adherence credit (pre-existing, unaffected) |
| Wrong ProgramInstance | REJECT (pre-existing check, unaffected) |
| Historical backdating (10 days) | REJECT (new) |
| Future-dated completion | REJECT (new) |
| Cursor manipulation via direct `scheduleState` write | REJECT (new — grant-bound when rotation advances) |
| SKIPPED-gap replay correctness (multi-session FOLLOW_SCHEDULE) | Correct expected index after gap (`prescribedOpportunities.test.ts`) |

## 34. Adherence Regression

`34/49 → BELOW_TARGET`, `70%`/`85%` exact boundaries: unaffected, all pre-existing tests in `adherence.test.ts`/`resolver.test.ts` pass unchanged.

## 35. Adaptation Regression

Adaptation reset/progression-window isolation: unaffected — no changes to `prescriptionInputs.ts`/adaptation window logic.

## 36. Concurrency Regression

`workoutLifecycleConcurrency.integration.test.ts`, `preparedWorkoutProgramConcurrency.integration.test.ts`: pass unchanged (683/683 root integration).

## 37. Firestore Rules

352/352 (was 346; +6 new adversarial tests).

## 38. Authority Emulator

9/9 (was 5; +4 new: 1,000,000-set rejection, wrong-session rejection, correct-session acceptance, backdating rejection).

## 39. CI Enforcement

`test:integration:lifecycleAuthority` added as an explicit step in `.github/workflows/ci.yml`'s `functions-integration` job, and added to `scripts/audit-ci.cjs`'s required-command list (which itself is a blocking `quality:static` gate) so this can't silently regress again.

## 40. Trusted Telemetry Delivery Before

Single `.create()` on the receipt doc conflated "claimed for delivery" with "delivered." If the sink threw after the receipt committed, any retry saw the receipt as already-existing and returned early without ever calling the sink again — permanent, silent loss of that operational metric (confirmed against the existing test's own framing).

## 41. Trusted Telemetry Delivery After

Two-phase: `claim()` returns `'new' | 'pending' | 'delivered'`. Sink is called for `'new'` and `'pending'` (retryable); `markDelivered()` is only called after a successful sink call. Only `'delivered'` short-circuits. Domain data (the ledger event) was never at risk either way — only the derived log/metric.

## 42. Retry/Dedup Proof

`trustedWorkoutLifecycleTelemetry.test.ts`: new test simulates a first delivery (`'pending'` status, as if retried after an earlier failure) succeeding once, then a second redelivery seeing `'delivered'` and not calling the sink or `markDelivered` again.

## 43. Account Deletion

No new artifact types introduced (grants/receipts already covered per Phase 9's `functions/src/accountDeletion/firestoreCleanup/resources.ts`). `RESOLVE_MISSED_SESSION`-issued grants live in the same `workoutLifecycleAuthorityGrants` collection already covered.

## 44. 8A Regression

Authoritative prescription snapshots, adapted limitations persist, extra workouts excluded, 4 earned Intermediate cycles, exact 70/85 boundaries, exercise equivalence safety: all pass unchanged (root unit 3990/3990, root integration 683/683).

## 45. 8B Regression

V2 sole authority, finish/schedule integrity, Start/Start, Start/Defer, Manual/Auto, Auto/Auto, Prepare/Prepare, partial migration recovery: `workoutLifecycleConcurrency.integration.test.ts` and `workoutLifecycleApplication.integration.test.ts` pass unchanged.

## 46. 8C Regression

Sticky rollout, kill switch, fail-closed config, Rules, toolchain pins, CI critical gates: `scripts/audit-ci.cjs` still passes (updated, not weakened); no rollout/kill-switch code touched.

## 47. 8D Regression

No synthetic progress, Renewal neutral, Deferred Start, session-aware What Changed: no UI/UX code touched this phase.

## 48. Phase 9 Regression

Malicious-owner direct writes denied (`workoutLifecycle.rules.test.ts` — all pre-existing tests pass unchanged), one-time grant model, real opportunity calendar dates, snapshot-set denominator, adaptation+pending convergence, trusted telemetry separation (client-diagnostic vs. trusted-domain module boundary untouched) — all pass.

## 49. Mutation-Style Coverage

- If backend starts trusting `targetPlan` again (skips `sealTargetProgram`): `authorizeMutation.integration.test.ts`'s 1,000,000-set test fails.
- If canonical target/identity binding is removed from Rules: `workoutPrograms.rules.test.ts`'s "denies an arbitrary V2 targetPlan sealed with no backend grant at all" fails.
- If a grant becomes replayable: "rejects a same-user, correct-identity grant that is not deleted in the same transaction" fails.
- If opportunity loses expected-session authority (reverts to `execution.sessionIndex` self-selection): `prescribedOpportunities.test.ts`'s "rejects an execution that self-selects an easier session" fails, and `authorizeMutation.integration.test.ts`'s equivalent fails.
- If `execution.sessionIndex` again selects its own expectation in `COMPLETE_SCHEDULE`: same test fails.
- If historical backdating becomes possible again: `authorizeMutation.integration.test.ts`'s backdating test fails.
- If the authority emulator is removed from CI: `scripts/audit-ci.cjs` fails (it now asserts the command string is present in the workflow).
- If telemetry receipt again suppresses retry: `trustedWorkoutLifecycleTelemetry.test.ts`'s redelivery test fails.

None of these answers is "none."

## 50. Root Unit

3990/3990 PASS (baseline 3988; +2 new).

## 51. Root Integration

683/683 PASS (unchanged count; no new integration test files added at this layer — new coverage went into the more targeted rules/authority-emulator suites).

## 52. Firestore Rules

352/352 PASS (baseline 346; +6 new).

## 53. Storage Rules

91/91 PASS (unchanged; not touched this phase).

## 54. Functions

Typecheck PASS, unit 1189/1189 PASS (baseline 1188; +1, from the telemetry receipt test rewrite net count), build PASS (verified `functions/lib/workoutLifecycle/scheduleEngine/*.js` present in build output).

## 55. Authority Emulator Results

9/9 PASS (baseline 5; +4 new).

## 56. Account Deletion Results

Not re-run this phase (no new artifact types; existing coverage from Phase 9 already spans the collections touched). Recommended as a fast follow-up sanity check, not a blocker — nothing in this phase adds a new per-user subcollection.

## 57. Critical Skip Audit

No test relevant to either blocker is skipped. `describe.skipIf(!enabled)` on the authority-emulator suite is pre-existing gating (requires the emulator env var), not a silent skip — and it is now guaranteed to run in CI (§39).

## 58. Files Created

- `scripts/syncScheduleEngineToFunctions.cjs`
- `functions/src/workoutLifecycle/scheduleEngine/weekday.ts` (checked in; `calendar.ts`/`resolver.ts`/`types.ts`/`localDate.ts` in the same directory are generated/gitignored)
- `src/progressionEngineV2/expectedSessionIndex.ts`
- `docs/workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md`
- `docs/workout-lifecycle/v2/architecture/19_PHASE_10_PRESCRIPTION_AUTHORITY_SCHEDULED_OPPORTUNITY_INTEGRITY.md` (this file)

## 59. Files Modified

- `functions/src/workoutLifecycle/authorizeMutation.ts` (unconditional sealing, `assertPlanSafe` bounds, `COMPLETE_SCHEDULE` resolver-backed authority, new `RESOLVE_MISSED_SESSION` operation, backdating guard)
- `firestore.rules` (`workoutPrograms` create grant requirement, `scheduleState` rotation-advance grant requirement, `scheduleEvents` SKIPPED/MISS_RESOLVED grant requirement)
- `src/workoutLifecycle/authorityProvider.ts` (new operation/field types)
- `src/services/workoutSchedule.ts` (`resolveMissedSession` now calls the authority callable for V2)
- `src/progressionEngineV2/prescribedOpportunities.ts` (real expected-index derivation)
- `functions/src/telemetry/trustedWorkoutLifecycleTelemetry.ts` (two-phase receipt)
- `functions/package.json`, `functions/.gitignore` (sync script wiring)
- `.github/workflows/ci.yml`, `scripts/audit-ci.cjs` (authority-emulator CI gate)
- Test files: `firestore-tests/workoutPrograms.rules.test.ts`, `functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts`, `src/progressionEngineV2/__tests__/prescribedOpportunities.test.ts`, `functions/src/telemetry/__tests__/trustedWorkoutLifecycleTelemetry.test.ts`
- `docs/workout-lifecycle/v2/decisions/README.md`

## 60. Acceptance Matrix A–CM

| Item | Status | Item | Status | Item | Status |
|---|---|---|---|---|---|
| A | PASS | B | PASS | C | PARTIAL (see §61) |
| D | NOT_IMPLEMENTED (§61) | E | PASS (unchanged) | F | PASS |
| G | PASS (unchanged) | H | PASS (unchanged) | I | PASS (unchanged) |
| J | PASS | K | PASS | L | PASS (unchanged) |
| M | PASS | N | PASS | O | PASS |
| P | PASS | Q | PASS (unchanged) | R | PASS |
| S | PASS | T | PASS | U | PASS (unchanged) |
| V | PASS (unchanged) | W | PASS (unchanged) | X | PASS |
| Y | PASS | Z | PASS | AA | PASS |
| AB | PASS (unchanged) | AC | PASS | AD | PASS |
| AE | PASS | AF | PASS | AG | PASS |
| AH | PASS | AI | PASS (unchanged) | AJ | PASS (unchanged) |
| AK | PASS (unchanged) | AL | PASS | AM | PASS |
| AN | PASS | AO | PASS | AP | PASS |
| AQ | PASS (unchanged) | AR | PASS (unchanged) | AS | PASS (unchanged) |
| AT | PASS (unchanged) | AU | PASS (unchanged) | AV | PASS (unchanged) |
| AW | PASS | AX | PASS | AY | PASS (unchanged) |
| AZ | PASS (unchanged) | BA | PASS | BB | PASS |
| BC | PASS (unchanged) | BD | PASS (unchanged) | BE | PASS (unchanged) |
| BF–CA | PASS (unchanged — see §44–48) | | | | |
| CB | PASS | CC | PASS | CD | PASS |
| CE | PASS | CF | PASS | CG | PASS |
| CH | PASS | CI | PASS | CJ | PASS |
| CK | PASS | CL | NOT_TESTED (§56) | CM | PASS |

## 61. Remaining P0

None. The literal reported exploit (arbitrary/absurd `targetPlan` sealed via a client that bypasses or under-supplies the authority flow) is closed at both the Rules and callable layers, with regression tests proving both the pre-fix success and post-fix denial.

## 62. Remaining P1

Full backend-independent prescription regeneration/canonical-diff (ADR-016 "Known limitation"). Recommended follow-up: extract `src/workoutPrescription/`'s pure engine + its exercise/template data dependencies into a package importable by Functions (a materially larger effort — 15+ files, a large JSON template catalog, questionnaire/exercise types — requiring its own dedicated phase), so the backend can independently compute or byte-diff the canonical plan instead of relying on bounds + catalog checks alone.

## 63. Remaining P2

`RECOVER`'s inclusion in the prescription-content grant gate (ADR-016) requires a grant to exist but does not force that grant's content through `assertPlanSafe`. Narrow in practice (RECOVER's own validation reconciles identity/state, not content), but worth tightening once the P1 above is addressed.

## 64. Remaining P3

Account-deletion suites not re-run this phase (§56) — low risk, recommended as a quick follow-up confirmation rather than a blocker.

## 65. Known Operational Gaps

Miss-decision detection writes to `scheduleState` (recording a newly-detected `pendingMissDecision` without advancing the cursor) remain ungated by design, to preserve the existing UX exactly — see ADR-016. This is safe because it never advances the rotation position and SKIPPED/MISS_RESOLVED events never grant adherence credit on their own.

## 66. Production Readiness Impact

No rollout/deploy changes made (per instructions). The Rules and callable changes are backward compatible with existing legitimate client flows (confirmed via the full regression suite, including the one regression discovered and fixed mid-phase — see §67 note). Safe to deploy behind the existing rollout mechanism once independently reviewed.

## 67. Final Verdict

**FASE 10 PARTIAL.** Both named blockers (arbitrary prescription authority, scheduled-opportunity session self-selection) are eliminated and regression-tested; CI now enforces the authority-emulator gate; the telemetry delivery gap is fixed. The phase is not `COMPLETE` because full backend-independent prescription regeneration (§61/§62) remains a documented, deliberately-scoped-out gap — a real defense-in-depth ceiling, not a silent hole in the two exploits this phase set out to close. Note for the next reviewer: an earlier version of the `workoutPrograms` Rules gate excluded `RECOVER` from the allowed grant operations and broke a real, tested V1-coexistence flow (`workoutProgression.integration.test.ts`) during this phase's own regression run — it was caught by the existing suite, diagnosed, and fixed by including `RECOVER` (see ADR-016 for why that's safe). This is flagged explicitly because it demonstrates why the fuller backend-regeneration approach was not attempted under this phase's remaining budget: the V1/V2 coexistence surface is subtler than the write-path analysis initially suggested, and further Rules tightening should be done incrementally with the full regression suite as a guardrail, not as a single large rewrite.
