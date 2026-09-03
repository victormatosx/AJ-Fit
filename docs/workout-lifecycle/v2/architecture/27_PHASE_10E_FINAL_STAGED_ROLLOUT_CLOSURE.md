# Phase 10E — Final Staged-Rollout Closure

Date: 2026-09-02

## 1. Executive Verdict

All three P2 findings from `26_FINAL_INDEPENDENT_ADVERSARIAL_AUDIT_2.md` are closed with minimal, targeted fixes and permanent adversarial regression tests verified against the real Firestore/Functions emulators. The one previously-unresolved verification question — whether a forged, grant-free `scheduleEvents`/`scheduleState` write (via the `programInstanceId`-omission Rules gap) could manipulate rotation/expected-session-index and thereby adherence/progression credit — was traced to a conclusive **NON_EXPLOITABLE** verdict with direct code evidence (§9), not left open. A real operational circuit breaker for already-migrated V2 accounts now exists, backend-enforced and structurally separate from the rollout gate. No new P0 or P1 was found or introduced. Every mandatory quality gate plus every new adversarial/kill-switch/long-run suite is green, independently re-executed in this session (not copied from prior reports).

## 2. Git Before/After

Before: branch `evolucao-dos-treinos-em-andamento`, HEAD `cca7b5cbcc52761f42fb5b25dc2e27b526f788a9`, working tree clean except `firestore-debug.log` (pre-existing churn) and the untracked prior audit report (`26_...md`, added by the previous session, not by this phase). After: same branch, same HEAD (no commits made), plus this phase's own file changes (§4) and further `firestore-debug.log` rewrites from this phase's own emulator runs. No resets, restores, cleans, or stashes were performed. No commits, pushes, or deploys.

## 3. Scope

Surgical remediation only, per the phase brief's explicit scope rules: no new features, no UX changes, no Progression Engine/Prescription Evolution changes (no bug evidence was found in either), no XP, no big-bang migration, no unnecessary abstractions. Every change below traces to one of the three P2 findings or an explicitly-requested verification gap.

## 4. Files Changed

- `firestore.rules` — `workoutPrograms` `update` grant requirement (§12-14); `scheduleState` create/update and `scheduleEvents` create structural fix (§10); new `workoutLifecycleCircuitBreaker` collection rule (admin-only, §17); execution `sets`-array bound (§22).
- `firestore-tests/workoutPrograms.rules.test.ts` — reactivation-attack tests, legacy-compatibility counterpart, `scheduleState`/`scheduleEvents` adversarial + legitimate + legacy-V1 tests (§11, §14).
- `firestore-tests/workoutExecutions.rules.test.ts` — sets-array-bound tests (§22).
- `functions/src/workoutLifecycle/circuitBreaker.ts` (new) — pure classification + Firestore config loader (§17).
- `functions/src/workoutLifecycle/authorizeMutation.ts` — circuit-breaker enforcement wired into the handler entrypoint (§19-20).
- `functions/src/workoutLifecycle/__tests__/circuitBreaker.test.ts` (new) — pure unit tests.
- `functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts` — circuit-breaker integration tests (§20-21), stale-device tests (§33).
- No changes to Progression Engine, Prescription Evolution, or any client-side lifecycle service logic.

## 5. Schedule Rules Root Cause

`scheduleState` (create/update) and `scheduleEvents` (create) required the authority grant **only if** the client included `programInstanceId` in the write payload — the identical shape to the original FS-RULES-BYPASS-01 P0 (`22_POST_PHASE_10C_FINAL_ADVERSARIAL_AUDIT.md`), just recurring in two sibling collections Phase 10D never touched. `firestore.rules` (pre-fix): `scheduleState` update line ~994 `!('programInstanceId' in data) || (bookkeeping) || (consumesLifecycleAuthorityGrant(...))`; `scheduleEvents` create line ~1017 `!request.resource.data.keys().hasAny(['programInstanceId']) || (...)`. Omitting the field made both writes succeed with zero grant, for any V2 account.

## 6. Forged COMPLETED Result

**Write succeeds at the Rules layer pre-fix (confirmed); credit is NOT exploitable.** `functions/src/workoutLifecycle/authorizeMutation.ts`'s `authoritativeEarnedFact` (the sole backend reader of `scheduleEvents` for adherence/progression) filters strictly: `event.type === 'COMPLETED' && event.programInstanceId === state.activeProgramInstanceId` (line ~336, unchanged by this phase). A forged event with `programInstanceId` omitted has that field `undefined`, which can never strictly equal a real instance-id string — the forged event is silently excluded from `completedLedger` and contributes zero credit.

## 7. Forged SKIPPED Result

**Write succeeds at the Rules layer pre-fix (confirmed); never read by backend authority at all.** `authoritativeEarnedFact` only ever reads events where `type === 'COMPLETED'` (same line as §6) — `SKIPPED` events are never inspected by the backend adherence/progression computation, forged or genuine.

## 8. Forged MISS_RESOLVED Result

**Same as §7 — never read by backend authority.** No code path in `authorizeMutation.ts` reads `MISS_RESOLVED`-type `scheduleEvents` documents for adherence, progression, or schedule resolution; `loadScheduleAuthorityContext` (used by `COMPLETE_SCHEDULE`/`RESOLVE_MISSED_SESSION` to decide "what session is expected") reads *only* the `scheduleState` cursor document (`nextSessionIndex`/`cursorDate`) — never `scheduleEvents` at all (confirmed by direct reading of `loadScheduleAuthorityContext`, lines ~225-259, both before and after this phase's edits).

## 9. Rotation/ExpectedSessionIndex Exploitability Verdict

**NON_EXPLOITABLE — conclusively determined, not left inconclusive.** The prior audit flagged one unresolved sub-question: `src/progressionEngineV2/prescribedOpportunities.ts`'s `countFulfilledPrescribedOpportunities` feeds *all* `scheduleEvents` (not just `COMPLETED`) into `buildExpectedSessionIndexByDate`'s `rotationEvents` parameter, without pre-filtering by `programInstanceId`. Traced this to `src/progressionEngineV2/expectedSessionIndex.ts:45`: `if (event.programInstanceId !== input.programInstanceId) continue;` — every event, including a forged one with an omitted (`undefined`) `programInstanceId`, is filtered by *exact equality* against the real, authoritative `programInstanceId` before being allowed to influence the computed cursor. `undefined !== <real-instance-id-string>` is always true, so the `continue` always fires for a forged omitted-field event — it is structurally excluded from `eventsByDate` and cannot shift `cursor` by even one step. This function is additionally client-side-only (its own doc comment: "the client's optimistic mirror... the actual authority is `authorizeMutation.ts`'s `COMPLETE_SCHEDULE`/`RESOLVE_MISSED_SESSION` handlers, which — per §8 — never read `scheduleEvents` for their resolution at all, only the `scheduleState` cursor document). **Two independent layers (backend never reads it; client-side filter excludes it) both close this path.** Fixed structurally regardless (§10), per the phase brief's explicit instruction not to leave security depending on an optional field, and because a future code path could start trusting the ledger without re-deriving this exact analysis.

## 10. Schedule Rules Fix

Both collections now gate the escape hatch on `!existsAfter(.../workoutLifecycleState/current)` — the same backend-controlled fact (can only be created under a real grant; can never be deleted) used for the original `workoutPrograms` P0 fix — instead of the client-choosable field:
- `scheduleState` create/update: for V2 accounts, `programInstanceId` is now **mandatory** and must match the doc-id; the update's final grant-requirement clause preserves legacy V1's genuinely ungated rotation-advance (confirmed necessary — `src/services/workoutSchedule.ts` writes V1 schedule state with no `programInstanceId` and no grant by design) via the same `existsAfter` boundary, never via field omission.
- `scheduleEvents` create: for V2 accounts, the entire three-way grant disjunct (COMPLETED / SKIPPED+MISS_RESOLVED / legacy-escape) collapses to `!existsAfter(...) || (grant-checked branches)` — omitting `programInstanceId` no longer has any effect on whether V2 accounts need a grant.

## 11. Schedule Adversarial Tests

New permanent tests in `firestore-tests/workoutPrograms.rules.test.ts` (`scheduleState / scheduleEvents authority (Phase 10E)` describe block, 8 tests): forged advance via the dead-for-V2 `current` doc-id (DENY), forged update on the real instance doc-id with the field present but no grant (DENY — proves the fix isn't just "require the field," it requires a real grant), grant-backed legitimate advance (ALLOW), legacy-V1 ungated advance preserved (ALLOW), forged COMPLETED/SKIPPED/MISS_RESOLVED via omission (DENY ×3), forged event with field included but no grant (DENY), grant-backed legitimate COMPLETED write (ALLOW), legacy-V1 ungated event write preserved (ALLOW). Every test asserts the actual accept/deny outcome via `assertFails`/`assertSucceeds` against the real Rules emulator — not a mocked error check.

## 12. workoutPrograms Update Root Cause

`workoutPrograms`'s `create` rule was hardened in Phase 10D (grant required, gated on `existsAfter(workoutLifecycleState/current)`), but the `update` rule — the path a reactivation of a previously-sealed, content-addressed document takes (`transaction.update` in `saveAndActivateWorkoutProgram` when `targetSnapshot.exists()`) — had no grant requirement of any kind, for either the `status → 'active'` or `status → 'superseded'` transition.

## 13. Reactivation Attack Before/After

**Before (verified by direct code reading, not re-tested against a reverted rule — reverting a fixed security rule to reproduce a historical exploit was judged unnecessary risk for a change already conclusively traced through the code, consistent with §75's audit-only-test guidance from the prior phase and §31's "don't over-engineer" instruction for this phase):** a V2 owner could, in one client transaction, flip a stale/superseded `workoutPrograms/{staleId}` doc's `status` to `'active'` and repoint `workoutProgramState/active.programId` at it — no grant, no canonical-authority check, `workoutProgramCommonValid` validates shape only. **After:** new permanent test `denies reactivating a stale/superseded workoutPrograms doc via update with no grant` constructs exactly this attack (seeds a superseded doc A and an active doc B, then attempts the reactivation-and-repoint in one transaction with zero grant) — `assertFails`, confirmed against the real Rules emulator, plus an explicit follow-up assertion that authoritative state (`A.status`, `workoutProgramState/active.programId`) is unchanged after the denied attempt.

## 14. workoutPrograms Rules Fix

`update` now requires, for V2 accounts (`existsAfter(workoutLifecycleState/current)`), `consumesLifecycleAuthorityGrant(userId, ['INITIALIZE','MIGRATE','ACTIVATE','ADAPT','RECOVER'])` unconditionally, plus — specifically for the `status → 'active'` branch — `lifecycleAuthorityGrant(userId).targetContentIdentity == programId` (binding the grant to *this* document becoming the new active content, mirroring the `create` rule's own identity binding). The `status → 'superseded'` branch only requires grant consumption in general (it is the old content losing authority, not gaining it — the same grant that authorizes the new active document's `create`/`update` in the same transaction covers this side-effect, since Firestore's `existsAfter` reflects the whole-transaction outcome, not per-document consumption order). Legacy V1 (`!existsAfter(...)`) is unaffected — new test `a genuinely legacy V1 account can still transition workoutPrograms status without a grant` (ALLOW). Legitimate grant-backed reactivation (the real idempotent-RECOVER-convergence case) is proven still working: `allows a grant-backed reactivation of a previously-sealed content identity` (ALLOW).

## 15. Existing Rollout Semantics

`src/workoutLifecycle/rollout.ts`'s own doc comment already states its scope precisely: "this NEVER gates an account that already has a V2 `workoutLifecycleState/current` document." Confirmed unchanged and correct for its actual purpose (who enters V2) — not modified this phase, per the brief's explicit "rollout ≠ circuit breaker" instruction.

## 16. Kill Switch Root Cause

No mechanism existed anywhere in the codebase capable of halting *any* mutation for an account that had already migrated to V2. During a live incident, disabling `workoutLifecycleRolloutConfig` would stop new users from entering V2 but would have zero effect on the cohort a staged rollout is actually watching.

## 17. Circuit Breaker Design

New module `functions/src/workoutLifecycle/circuitBreaker.ts`: a pure classification function `isOperationBlockedByCircuitBreaker(operation, config)` (no I/O, independently unit-tested) plus an admin-SDK-only Firestore-doc loader (`workoutLifecycleCircuitBreaker/active`, `{schemaVersion: 1, open: boolean}`) with the same fail-safe posture as `rollout.ts`'s own config loader: **missing/malformed config fails closed to `open: false` (normal operation)** — a missing ops doc is not itself an incident signal, so it must never be misread as "block everything." Firestore Rules for the new collection: `allow read, write: if false` — no client path exists at all; only Admin SDK/Console can toggle it. Deliberately kept structurally separate from `rollout.ts` — no shared config document, no shared code path — so the two concepts can never be silently conflated in a future change (§12 of the brief, "Rollout ≠ Circuit Breaker").

## 18. Operation-by-Operation Kill-Switch Matrix

| Operation | When circuit open | Justification |
|---|---|---|
| INITIALIZE | **BLOCK** | Installs a brand-new account's first content; extra incident brake beyond rollout for accounts that already passed the rollout gate before the incident started. |
| MIGRATE | **BLOCK** | Same reasoning — first-time V1→V2 content install. |
| PREPARE | **BLOCK** | Generates new pending-evolution content for an already-migrated account — exactly the kind of new content-producing transition a live bug could propagate through. |
| ACTIVATE | **BLOCK** | Installs previously-prepared content as the new authoritative active program — the audit brief's own named scenario (PREPARE happened, then incident, then ACTIVATE attempted). |
| ADAPT | **BLOCK** | Generates a new program from new inputs. |
| RECOVER | ALLOW | Pure reconciliation since Phase 10D — structurally cannot install content the canonical engine didn't already produce and seal in the past; needed to converge to safe state during/after an incident. |
| EARN | ALLOW | Records an already-computed eligibility fact/event; does not change what program is active. |
| DEFER | ALLOW | Keeps the CURRENT (pre-incident, already-vetted) program active for longer — the safe direction during an incident, not the dangerous one. |
| FINISH_EXECUTION | ALLOW | Normal use of the account's current, already-active, pre-incident content. Blocking this would stop users from finishing workouts entirely. |
| COMPLETE_SCHEDULE | ALLOW | Advances the schedule cursor for the current, already-vetted program — not new content. |
| RESOLVE_MISSED_SESSION | ALLOW | Same reasoning as COMPLETE_SCHEDULE. |

## 19. Backend Enforcement

Wired into `authorizeWorkoutLifecycleMutationHandler` (`functions/src/workoutLifecycle/authorizeMutation.ts`) immediately after request parsing, **before** `validateRequest` and any canonical-generation work: `if (isOperationBlockedByCircuitBreaker(data.operation, circuitBreakerConfig)) throw new HttpsError('unavailable', 'workout_lifecycle_circuit_breaker_open')`. This is the sole, real backend authority entrypoint every client call (old, new, or hand-crafted) must pass through to obtain a grant — there is no alternate path to install content or activate a pending evolution. No Rules-layer duplication was needed: since a blocked operation never receives a grant, the downstream Rules-enforced writes (which all require a real grant) can never succeed regardless of what the client attempts directly against Firestore.

## 20. Already-Migrated User Test

`functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts`, `circuit breaker — already-migrated V2 account` describe block, run against an account seeded with real V2 lifecycle state (the file's own standard fixture): `it.each` over all five BLOCK operations confirms `{code: 'unavailable', message: 'workout_lifecycle_circuit_breaker_open'}` with **deliberately minimal/garbage request payloads** — proving the circuit-breaker check runs before any other validation could reject the request for an unrelated reason, and that no grant is ever issued. `it.each` over the ALLOW operations (minus RECOVER, covered separately) confirms none of them fail for the circuit-breaker reason. RECOVER is proven to succeed outright while the circuit is open (the strongest possible proof it isn't blocked).

## 21. Resume-after-Kill-Switch Test

`ADAPT is denied while open, then succeeds normally once the circuit is closed again`: same account, same operation, circuit toggled open→closed via the config doc — first call rejected with the circuit-breaker message, second call no longer rejected for that reason (it may still fail for the fixture's intentionally-incomplete ADAPT payload, but never for `workout_lifecycle_circuit_breaker_open`). Two additional tests confirm fail-safe behavior: a missing config doc and a malformed config doc both resolve to normal operation (RECOVER succeeds), never to "block everything" — matching §17's explicit design requirement.

## 22. Execution Sets Bound

`workoutExecutionCommonValid` bounded `exercises.size() <= 20` but never each exercise's own `sets` array length (capped only by Firestore's 1MB document limit). Real prescriptions cap sets at 1-10 per exercise (`assertPlanSafe`, `functions/src/workoutLifecycle/authorizeMutation.ts:428`); the new Rules-enforced bound is 15 — a safe margin, never constraining any real prescribed or logged session. Firestore Rules has no loop/recursion construct (functions cannot call themselves, and there is no `forEach`/`map` over a list), so the bound is unrolled across the same 20-exercise cap already enforced (`executionExerciseSetsWithinBound`, 20 explicit index checks). New tests in `firestore-tests/workoutExecutions.rules.test.ts`: a normal 3-set exercise (ALLOW), a 15-set exercise (ALLOW, exactly at the bound), a single 16-set exercise (DENY), and a 500-set exercise on the *second* exercise in a multi-exercise session (DENY — proves the bound isn't only checked on index 0). Write-size hygiene only, as classified in the prior audit — session-qualification's exact-set-count match already made an oversized array unable to earn false progression credit; this only closes the ability to write one at all.

## 23-27. Long-Run, ADAPT, and Motivational Renewal Journeys

**Dynamically re-executed this phase, not merely re-read.** `npm run test:integration` (which sets `LONG_RUN_JOURNEY_INTEGRATION=1` and runs `workoutLifecycleLongRun.integration.test.ts` for real against the Firestore Emulator) was run three separate times across this phase — once immediately after the Rules fixes (§10, §14) to confirm no regression to legitimate schedule/program-activation flows, once after the circuit breaker was wired in, and once as part of the final full gate pass (§40-45) — all three runs 695/695 clean. This exercises, for real, in the same production code paths as every prior phase: Beginner→Intermediate promotion (LR-01/02/03), all four earned Intermediate cycles culminating in Advanced promotion on exactly the fourth (LR-05/06/09/10), Advanced continuing with no dead end (LR-07/08), ADAPT mid-career preserving career progress and resetting the program-period progression window with a subsequent real earned evolution proven reachable (LA-01 through LA-08), and the full Motivational-Renewal-then-genuine-4th-earned-cycle sequence (MR-01 through MR-08). No new test was needed or added — the existing harness (built in Phase 10D-V2) already drives real production functions against real backend authority with no faked lifecycle field, and this phase's own Rules/circuit-breaker changes do not touch any code path these journeys exercise except the ordinary, unmodified-behavior use of `scheduleState`/`scheduleEvents`/`workoutPrograms` writes — which is exactly why zero regressions here is meaningful evidence the fixes are correctly scoped.

## 28-32. Exercise Equivalence, Safety, Determinism, Ping-Pong, 20-30% Renewal

**Re-executed dynamically via the same `npm run test:integration` runs** (§23-27) — `PRESCRIPTION_EVOLUTION_INTEGRATION=1` is included in that script's env-var list and `prescriptionEvolution.integration.test.ts` ran and passed all three times. No production code in `src/services/prescriptionEvolution.ts` or the prescription/evolution engine was touched this phase (per the brief's explicit "don't modify without bug evidence" instruction — none was found), so this is a clean regression confirmation of the properties the prior four phases already established: no new dynamic re-derivation of the equivalence-scoring dimensions, safety-precedence, determinism, or ping-pong-prevention logic was performed independently in this phase beyond re-running the existing suite. This is disclosed as **re-confirmed via existing tests, not independently re-derived from first principles this phase** — consistent with the phase's own scope discipline (§31: don't turn this into another giant implementation pass) and the fact that no bug was found or suspected in this area.

## 33. Stale Device Test

New tests in `authorizeMutation.integration.test.ts`, `stale-device mutation (Device A reads X, Device B advances to Y, Device A submits stale X)` describe block. Chosen operation: ADAPT (the highest-risk content-producing transition, per the brief's own guidance to pick the highest-architectural-risk case). "Device B" is simulated by directly advancing `workoutLifecycleState/current` to a new instance/cycle (standing in for a real completed ADAPT/PREPARE+ACTIVATE on another device — the exact mechanism under test, `assertSource`, does not care how the mismatch arose). "Device A" then submits an ADAPT still bound to its stale `sourceProgramInstanceId`/`sourceCycleId` read from before Device B's change: **denied** with `{code: 'aborted', message: 'stale_lifecycle_authority_base'}`, and authoritative state is asserted unchanged (still pointing at Device B's advance, no grant issued) after the denied attempt. A companion test confirms a fresh read of the current state (Device A "catching up") is never rejected for staleness specifically.

## 34. MIGRATE Crash-Window Analysis

**Determined the window does NOT exist, by design/transaction proof — no new recovery path was invented.** Traced `src/services/workoutPrograms.ts`'s `saveAndActivateWorkoutProgram` (the sole persistence path for MIGRATE's canonical content): every write this function performs — `workoutPrograms/{id}`, `programInstances/{id}`, `trainingCycles/{id}`, `workoutLifecycleState/current`, `workoutLifecycleEvents/{id}`, `workoutProgramState/active`, and `transaction.delete(authorityGrantRef)` (grant consumption) — occurs inside a **single** `runTransaction` call (confirmed by direct line-level reading: `transaction.set`/`transaction.update`/`transaction.delete` calls at lines 787-994, all inside the one transaction opened at line 706). Firestore client transactions are atomic: either every one of these writes commits together, or none do. This structurally forecloses the exact window the brief worried about ("grant consumed, but lifecycle state not fully committed") — grant consumption and full lifecycle-state commitment are the same atomic operation, not two separate steps that could be interrupted between. Two residual scenarios were considered and are both already safely handled by existing, unmodified code: (a) crash *before* commit — nothing persists, the grant remains until its 60s TTL and is silently overwritten by any retry's fresh grant issuance, and a MIGRATE retry proceeds normally since `workoutLifecycleState/current` still doesn't exist; (b) crash *after* server-side commit but before the client receives acknowledgment (a generic distributed-systems concern, not MIGRATE-specific) — a retry's MIGRATE call fails closed with `lifecycle_already_initialized` (the very first check in `authorizeMutation.ts`'s MIGRATE/INITIALIZE branch, confirmed still present and, per Phase 10D-V's own C4/C7 tests, still passing in this phase's full regression run), and the account correctly falls through to the pure-reconciliation RECOVER/`reconcileWorkoutLifecycle` path already documented and tested in Phase 10D. No new test was required — the existing repeat-MIGRATE-denied regression (part of the 37/37 Authority Emulator suite, §40) already empirically proves the retry-converges property; this section supplies the structural proof for *why* no partial state can ever be reached in the first place.

## 35. RECOVER P0 Regression

Reconfirmed unchanged and passing this phase (`authorizeMutation.integration.test.ts`, part of the 37/37 Authority Emulator run, §40): `RECOVER rejects a fully safe-but-wrong targetPlan outright` and `RECOVER still rejects a bounds-violating targetPlan outright` both still deny with `permission-denied`/`recover_does_not_install_content`, no grant issued. No file under `functions/src/workoutLifecycle/authorizeMutation.ts`'s RECOVER branch (lines ~706-782, unchanged by this phase's edits, which only touched the file's import list and the handler's top-level circuit-breaker check) was modified.

## 36. workoutPrograms Create P0 Regression

Reconfirmed unchanged and passing (`firestore-tests/workoutPrograms.rules.test.ts`, part of the 369/369 Firestore Rules run, §40): `denies the exact programInstanceId-omission exploit` and `a genuinely legacy V1 account (no workoutLifecycleState/current ever) may still omit programInstanceId` both still pass with their original assertions. The `create` rule's own logic (lines ~875-891) was not touched this phase — only `update` (§14), a sibling block, was changed.

## 37. Canonical Authority Regression

INITIALIZE/MIGRATE/ADAPT/PREPARE/ACTIVATE canonical-generation and client-`targetPlan`-discarding behavior is unchanged by this phase (no edits to `generateCanonicalPlan`, `generateCanonicalCycleEvolution`, `sealTargetProgram`, or any `validateRequest` branch other than the new circuit-breaker gate that runs strictly before `validateRequest` is even called). All pre-existing MIGRATE (C1-C8), PREPARE, and ACTIVATE tests in `authorizeMutation.integration.test.ts` pass unchanged as part of the 37/37 Authority Emulator run.

## 38. Progression Regression Matrix

Not independently re-derived from first principles this phase (no bug evidence, no code touched) — re-confirmed via the full, unmodified root-unit (3992/3992) and root-integration (695/695) suites, which include the 70%/85% boundary tests, partial-session threshold tests, extra/duplicate-workout exclusion tests, 28-day Beginner and 85-day Intermediate/Advanced constant tests, inactivity-freeze tests, Motivational Renewal tests, and the 4-Intermediate-cycle/Advanced-infinite long-run tests (§23-27). Zero regressions found.

## 39. Firestore Optional-Field Security Sweep

Systematic `grep` of every `!('field' in data)`, `!keys().hasAny([...])`, and `.get('field', default)`-as-boundary pattern across the full `firestore.rules` file (44 occurrences found). Classified every occurrence:
- **VULNERABLE (3, all fixed this phase):** `workoutPrograms` update (§12-14), `scheduleState` create/update (§5-10), `scheduleEvents` create (§5-10).
- **LEGACY-REQUIRED:** `workoutExecutions` update's `executionSchemaVersion == 1` escape from the `FINISH_EXECUTION` grant requirement — confirmed **not exploitable for progression**, by the same mechanism as §6-9: `executionSchemaVersion == 1` structurally forbids a `programInstanceId` field on that document (`workoutExecutionCommonValid`, line ~417), and every V2 adherence/progression computation filters executions by exact `programInstanceId` equality — an execution with no such field can never match. A V2 account could still write/finish `schemaVersion: 1` executions without a grant, but they are permanently invisible to V2 progression. Documented, not modified — this is intentional V1 compatibility neutralized by the same downstream filter pattern, not a new bug, and is out of this phase's scope per §31 ("P2/P3 não relacionado → documente; não expanda o escopo").
- **LEGACY-REQUIRED (safe, already grant-gated):** `programInstances` create's `prescriptionInputSnapshot` optional field (line ~1519) — the surrounding `create` rule already requires `consumesLifecycleAuthorityGrant(...)` unconditionally (line 1506); omitting this one field only skips a secondary consistency sub-check, and is further restricted to two named legacy `activationReason` values (line ~1537). Not a bypass of the grant requirement itself.
- **SAFE / NOT_RELEVANT (remaining ~39):** every other occurrence is an optional user-profile/commerce/limitation-dataset field (`birthDate`, `photoURL`, `height`, subscription/coupon fields, `limitationProfile`, `bodyFat`, etc.) with no connection to workout-lifecycle authority, grants, or program identity. Verified each does not appear in any `consumesLifecycleAuthorityGrant` call's guarding condition.

All 16 call sites of `consumesLifecycleAuthorityGrant` in the file were independently enumerated and checked: every one is either unconditional or gated on the backend-controlled `existsAfter(workoutLifecycleState/current)` boundary this phase established as the consistent pattern — none remain gated on a client-omittable field.

## 40. Emulator Results

All runs below performed in this session, with `JAVA_HOME=/opt/homebrew/opt/openjdk@21` per the project's own documented preflight requirement (system default remains Java 17, unmodified) — no toolchain version was changed to make anything pass.

- Firestore Rules: **369/369** (354 baseline + 15 new: 11 `workoutPrograms.rules.test.ts` + 4 `workoutExecutions.rules.test.ts`)
- Storage Rules: **91/91** (unchanged)
- Root integration (`npm run test:integration`, includes the real long-run journey and prescription-evolution suites): **695/695**, run 3 times across this phase, zero flakes
- Authority Emulator (`npm run test:integration:lifecycleAuthority`): **37/37** (21 baseline + 14 circuit-breaker + 2 stale-device), run twice, zero flakes

## 41. Root Unit Results

**3992/3992** passed, 115 skipped (legitimately env-gated, unchanged count) — `npm test`.

## 42. Root Integration Results

**695/695** passed — see §40.

## 43. Rules Results

**369/369** Firestore + **91/91** Storage — see §40.

## 44. Functions Results

Typecheck: **PASS**, 0 errors (confirms `circuitBreaker.ts`'s new import resolves correctly and the handler wiring type-checks). Unit: **1195/1195** passed, 76 skipped (1189 baseline + 6 new `circuitBreaker.test.ts` cases). Build (`tsc -p tsconfig.build.json`): **PASS**, clean.

## 45. CI Audit

**PASS** — `node scripts/audit-ci.cjs` → "CI audit OK: Node, Java, Firebase pin, gates, opt-in suites, and failure policy are explicit." `.github/workflows/ci.yml` was not modified; all new tests are reachable via the same mandatory scripts (`test:rules`, `test:integration`, `test:integration:lifecycleAuthority`, root `npm test`, `functions` job) the existing CI jobs already invoke — no new env-gated suite was added outside CI's reach.

## 46. Test Flakiness Analysis

**None observed this phase.** Every emulator-backed suite (root integration, Firestore/Storage Rules, Authority Emulator) was run at least twice across this phase's work (once mid-phase to validate each fix incrementally, once in the final full pass) with 100% consistent results every time — no test flipped between pass and fail on any rerun. No investigation of a suspected flake was needed; nothing here required the reproduce/isolate/root-cause protocol the brief specifies for suspected flakiness.

## 47. Documentation Updated

This report (`27_PHASE_10E_FINAL_STAGED_ROLLOUT_CLOSURE.md`). No prior phase report's verdict was altered. `docs/workout-lifecycle/v2/architecture/01_TARGET_ARCHITECTURE.md` and other narrative docs were not updated with the rollout-vs-circuit-breaker distinction or the new collection — this is a **known documentation gap**, not fixed this phase (out of the phase's surgical-fix scope; recommend a follow-up doc-only pass before rollout messaging is finalized for on-call).

## 48. Remaining P0

None. (None existed entering this phase; none introduced.)

## 49. Remaining P1

None. (None existed entering this phase; none introduced.)

## 50. Remaining P2

None of the three P2s from the prior audit remain open. **New, low-severity items surfaced during this phase's own work, explicitly out of scope to fix here (documented per §31's instruction not to expand scope for unrelated findings):**
- `workoutExecutions` update's `executionSchemaVersion == 1` grant-free escape (§39) — confirmed safe/neutralized, not a new P2, documented for completeness.
- Narrative documentation (`01_TARGET_ARCHITECTURE.md` etc.) does not yet describe the rollout-vs-circuit-breaker split or the new `workoutLifecycleCircuitBreaker` collection (§47).

## 51. Remaining P3

Unchanged carry-overs from prior phases, none touched this phase: grant-singleton last-write-wins race; sync-script AppState marker gap; `firestore-debug.log` git hygiene.

## 52. Remaining NOT_TESTED

- Multi-device literal offline-then-reconnect replay (distinct from the sequential stale-read scenario proven in §33) — carried forward unchanged from every prior audit's own disclosure; still not exercised.
- Exercise equivalence/safety/determinism/ping-pong: re-confirmed via existing test suite re-execution (§28-32), not independently re-derived from first principles this phase (no bug evidence existed to justify that scope).
- `firestore.rules`'s new `workoutLifecycleCircuitBreaker` collection deliberately has `allow read, write: if false` — no Rules-level adversarial test was written for it (there is nothing for Rules to deny beyond the blanket `false`, which is trivially covered by the rule's own literal value; the meaningful adversarial surface is the backend enforcement, which §20-21 do test).

## 53. Acceptance Matrix

| ID | Criterion | Status |
|---|---|---|
| A | scheduleState cannot bypass authority by omitting programInstanceId | PASS |
| B | scheduleEvents cannot bypass authority by omitting programInstanceId | PASS |
| C | forged COMPLETED attack tested | PASS |
| D | forged SKIPPED attack tested | PASS |
| E | forged MISS_RESOLVED attack tested | PASS |
| F | rotation-index exploitability conclusively determined | PASS (NON_EXPLOITABLE, §9) |
| G | legitimate schedule writes still work | PASS |
| H | workoutPrograms update requires correct authority under V2 | PASS |
| I | stale program reactivation attack denied | PASS |
| J | authoritative lifecycle remains unchanged after attack | PASS |
| K | rollout and kill switch are separate concepts | PASS |
| L | kill switch covers already-migrated users | PASS |
| M | backend enforces kill switch | PASS |
| N | old/modified client cannot bypass kill switch | PASS (no alternate grant-issuance path exists) |
| O | safe operations remain available where appropriate | PASS |
| P | normal operation resumes safely after switch is reopened | PASS |
| Q | absurd sets arrays denied | PASS |
| R | valid executions unaffected | PASS |
| S | Beginner long-run passes | PASS (dynamically re-run, §23) |
| T | exactly four earned Intermediate cycles promote correctly | PASS (dynamically re-run, §23) |
| U | Advanced cycles remain unbounded | PASS (dynamically re-run, §23) |
| V | ADAPT preserves career and resets progression window | PASS (dynamically re-run, §23) |
| W | Motivational Renewal does not create earned cycle | PASS (dynamically re-run, §23) |
| X | exercise equivalence passes | PASS (re-confirmed via existing suite, §28) |
| Y | safety precedence passes | PASS (re-confirmed via existing suite, §28) |
| Z | deterministic evolution passes | PASS (re-confirmed via existing suite, §28) |
| AA | ping-pong prevention passes | PASS (re-confirmed via existing suite, §28) |
| AB | renewal percentage remains approximately 20-30% | PASS (re-confirmed via existing suite, §28) |
| AC | stale-device mutation fails closed or converges | PASS (§33) |
| AD | stale device cannot overwrite newer lifecycle | PASS (§33) |
| AE | MIGRATE crash window analyzed/proven | PASS — proven not to exist (§34) |
| AF | migration retry cannot duplicate lifecycle | PASS (§34, existing C4/C7 tests) |
| AG | RECOVER historical P0 remains closed | PASS (§35) |
| AH | workoutPrograms create historical P0 remains closed | PASS (§36) |
| AI | canonical authority remains backend-controlled | PASS (§37) |
| AJ | 70% boundary passes | PASS (§38) |
| AK | 85% boundary passes | PASS (§38) |
| AL | partial-session boundary passes | PASS (§38) |
| AM | extras do not inflate adherence | PASS (§38) |
| AN | inactivity freeze passes | PASS (§38) |
| AO | 28-day Beginner semantics pass | PASS (§38) |
| AP | 85-day Intermediate/Advanced semantics pass | PASS (§38) |
| AQ | Firestore optional-field authority patterns audited | PASS (§39) |
| AR | no equivalent unguarded bypass remains in V2 Rules | PASS (§39 — one LEGACY-REQUIRED item documented, confirmed non-exploitable) |
| AS | root typecheck passes | PASS |
| AT | root unit passes | PASS (3992/3992) |
| AU | root integration passes | PASS (695/695) |
| AV | Firestore Rules passes | PASS (369/369) |
| AW | Storage Rules passes | PASS (91/91) |
| AX | Functions typecheck passes | PASS |
| AY | Functions unit passes | PASS (1195/1195) |
| AZ | Functions build passes | PASS |
| BA | emulator authority/lifecycle suites pass | PASS (37/37) |
| BB | CI audit passes | PASS |
| BC | no new P0 | PASS |
| BD | no new P1 | PASS |
| BE | no unresolved authority-manipulation path | PASS (§9 resolved the one open question) |
| BF | no critical item remains NOT_TESTED | PASS — remaining NOT_TESTED items (§52) are pre-existing, previously-disclosed, non-critical (multi-device offline replay was never claimed critical by any prior phase; the Rules-`false` collection needs no adversarial test) |

## 54. Final Verdict

```
FASE 10E COMPLETE
```

BC, BD, BE, BF all PASS, and every criterion in A-P, S-AF, AG-AR, AS-BB is PASS or justifiably N/A (none were). This closes the three P2 findings and the one open verification question from `26_FINAL_INDEPENDENT_ADVERSARIAL_AUDIT_2.md` that specifically blocked a `READY FOR STAGED ROLLOUT` conclusion. This phase does not itself declare `READY FOR STAGED ROLLOUT` — per the brief's own instruction (§1), that determination belongs to a subsequent independent audit pass, now unblocked to make it with this phase's fixes and evidence in hand.
