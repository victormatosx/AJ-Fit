# Phase 10C — Canonical Response Client Integration

Date: 2026-08-31

## 1. Verdict

**FASE 10C COMPLETE.** After a backend-authoritative content-generating operation, the complete canonical response is the sole source for subsequent authoritative client persistence. No required path falls back to the pre-authorization candidate.

## 2. Git Before / After

- Before: branch `main`, HEAD `d24319ba15e63095fd376bcd99acd30f4abce343`, large pre-existing dirty worktree (`81 files changed, 16003 insertions, 13938 deletions` in the recorded baseline).
- After: branch and HEAD unchanged. The large dirty worktree remains preserved; no reset, restore, clean, stash, commit, push, rollout, or deploy was performed.

## 3. Call Sites Found

All production callers of `authorizeWorkoutLifecycleMutation` were traced:

- `saveAndActivateWorkoutProgram`: dynamic `INITIALIZE`/`MIGRATE`/`ADAPT`/`ACTIVATE`/`RECOVER`.
- `prepareEvolutionAttempt`: `PREPARE`.
- `ensureWorkoutLifecycleForLegacyActiveProgram`: direct `MIGRATE` bootstrap.
- `invalidatePendingEvolutionForAdaptation`: `ADAPT` used only to authorize removal of stale pending state; the later save call independently authorizes and consumes canonical content.
- Lifecycle ledger/reconciliation: `EARN`, `DEFER`, `ACTIVATE`, `RECOVER`.
- Schedule/execution: `COMPLETE_SCHEDULE`, `RESOLVE_MISSED_SESSION`, `FINISH_EXECUTION`.

Only `INITIALIZE`, `MIGRATE`, content-generating `ADAPT`, and `PREPARE` return newly generated canonical prescription content. The other operations do not create a new prescription and therefore must not be forced into this contract.

## 4. Root Cause

Phase 10B made backend generation authoritative but left candidate-shaped variables alive after authorization. The backend returned canonical B while some client transactions continued writing candidate A or identities derived from A. This was safe in the usual deterministic/same-catalog case but incorrect under catalog drift and allowed identity/content mixing.

## 5. Canonical Response Contract

`WorkoutLifecycleAuthorityResult.canonical` is typed as `WorkoutLifecycleAuthorityCanonicalContent`; `targetPlan` is the existing `FinalWorkoutPlan`, not a second plan format. It carries the complete plan plus canonical prescription/content identities and template metadata. The provider validates and deep-clones the payload before returning it. `requireWorkoutLifecycleCanonical` makes the operation requirement explicit and fails with `WORKOUT_LIFECYCLE_CANONICAL_RESPONSE_MISSING:<operation>` when absent.

The backend now emits the same `wpg_<hash>` content-identity shape as the client and derives INITIALIZE/MIGRATE/content-changing ADAPT bindings from that canonical identity. The client validates `targetPrescriptionIdentity === targetPlan.planId`; save/PREPARE also independently recompute and validate the expected content identity.

## 6. `saveAndActivateWorkoutProgram` Before / After

- Before: authorization received canonical B, but the transaction could retain candidate A, A's `programId`, and A-derived instance/cycle/event bindings.
- After: INITIALIZE/MIGRATE/ADAPT require canonical B and use B's full plan, template metadata, prescription identity, content identity, `workoutPrograms` document, `ProgramInstance`, lifecycle state, active pointer, and convergence checks. ACTIVATE continues from the already-canonical pending evolution. RECOVER remains reconciliation.

## 7. `prepareEvolutionAttempt` Before / After

- Before: `pendingEvolution` was assembled from the locally evolved candidate after PREPARE authorization.
- After: its plan, target content/prescription identities, and template metadata come from PREPARE's canonical response. Earned fact, deferral, source snapshot, and cycle semantics remain unchanged.

## 8. Other Call Sites

The direct legacy MIGRATE bootstrap now installs and activates the backend-sealed canonical program when B differs from legacy A, superseding A and binding the new lifecycle/cycle/instance to B. ADAPT's preliminary stale-pending invalidation does not persist prescription content; the subsequent save is the authoritative content write and consumes its own ADAPT canonical response. EARN/DEFER/ACTIVATE/RECOVER/schedule/execution operations are not new-canonical generators and are correctly N/A.

## 9. Catalog Race Test

INITIALIZE, PREPARE promotion, PREPARE cycle evolution, ADAPT, and MIGRATE integration cases inject a divergent canonical B after candidate A exists. The completed flows persist/reference B, bind identities to B, and prove A is absent or superseded as appropriate. The operation succeeds despite the stale candidate.

## 10. Post-Response Mutation Test

The authority-provider unit test mutates candidate A after the provider returns. The cloned canonical B remains unchanged, proving candidate aliases cannot influence subsequent persistence.

## 11. Fail-Closed Behavior

Canonical-required operations use `requireWorkoutLifecycleCanonical`; no `canonical ?? candidate` fallback exists. The INITIALIZE integration test proves missing canonical aborts before authoritative persistence. Identity disagreement also fails with `WORKOUT_LIFECYCLE_CANONICAL_IDENTITY_INVALID`.

## 12. Regression Results

Safe-but-wrong, 1,000,000 sets, grant target binding, RECOVER, wrong-session, backdating, and Scheduled Opportunity coverage all pass in the 13/13 authority-emulator suite and related integration/rules suites. V1/V2 coexistence and lifecycle concurrency pass in the 689/689 root integration suite.

Account deletion was not rerun: Phase 10C creates no user collection, storage artifact, retention rule, or cleanup semantic. The prior Phase 10B result remains 37/37; this phase only changes which already-existing prescription payload is selected for already-existing writes.

## 13. Quality Gates

| Gate | Result |
|---|---:|
| Root typecheck | PASS |
| Root unit | 3992 passed; 109 skipped |
| Root integration | 689 passed |
| Firestore Rules | 352 passed |
| Storage Rules | 91 passed |
| Functions typecheck | PASS |
| Functions unit | 1189 passed; 52 skipped |
| Functions build | PASS |
| Authority Emulator | 13 passed |
| CI audit | PASS |

Final emulator toolchains: root Rules on Node 20.20.2 + Java 21.0.12; Functions authority on Node 22.23.2 + Java 21.0.12.

## 14. CI Coverage

No workflow edit was needed. Root unit coverage includes the provider clone/fail-closed tests; mandatory root integration includes the catalog-race/client-consumption cases; the separately mandatory lifecycle-authority emulator includes backend canonical identity, safe-but-wrong, extreme sets, grant binding, RECOVER, wrong-session, and backdating checks. `npm run ci:audit` confirms the Node/Java/Firebase pins, required gates, opt-in suites, and failure policy remain explicit.

## 15. Files Changed for Phase 10C

- `functions/src/workoutLifecycle/authorizeMutation.ts`
- `functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts`
- `src/workoutLifecycle/authorityProvider.ts`
- `src/workoutLifecycle/__tests__/authorityProvider.test.ts` (new)
- `src/services/workoutPrograms.ts`
- `src/services/workoutLifecycleApplication.ts`
- `src/services/workoutLifecycle.ts`
- `src/services/__tests__/workoutLifecycleAuthorityFixture.ts`
- `src/services/__tests__/firstProgramGeneration.integration.test.ts`
- `src/services/__tests__/workoutLifecycleApplication.integration.test.ts`
- `docs/workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md`
- `docs/workout-lifecycle/v2/architecture/21_PHASE_10C_CANONICAL_RESPONSE_CLIENT_INTEGRATION.md` (new)

## 16. Acceptance Matrix A–Z

| Item | Status | Evidence |
|---|---|---|
| A | PASS | All authority callers traced and classified. |
| B | PASS | Save/activate consumes full canonical response. |
| C | PASS | PREPARE stores canonical response. |
| D | PASS | ADAPT's subsequent prescription write consumes canonical. |
| E | PASS | PREPARE promotion divergent-B test. |
| F | PASS | PREPARE cycle-evolution divergent-B test. |
| G | PASS | INITIALIZE and both MIGRATE paths audited/corrected. |
| H | PASS | Candidate is not post-response persistence authority. |
| I | PASS | Canonical identities drive persistence/bindings. |
| J | PASS | Required canonical omission fails closed. |
| K | PASS | Catalog race A to B persists B. |
| L | PASS | Post-response mutation cannot alter cloned B. |
| M | PASS | Safe-but-wrong regression passes. |
| N | PASS | 1,000,000 sets regression passes. |
| O | PASS | Grant remains canonical-target-bound. |
| P | PASS | RECOVER regressions pass; no false canonical requirement. |
| Q | PASS | Scheduled Opportunity regressions pass. |
| R | PASS | V1/V2 coexistence passes. |
| S | PASS | Root typecheck. |
| T | PASS | Root unit 3992. |
| U | PASS | Root integration 689. |
| V | PASS | Firestore Rules 352. |
| W | PASS | Storage Rules 91. |
| X | PASS | Functions typecheck/unit/build. |
| Y | PASS | Authority Emulator 13. |
| Z | PASS | Critical tests remain CI-enforced. |

## 17. Remaining P0

None.

## 18. Remaining P1

None.

## 19. Remaining P2/P3

None introduced or remaining within Phase 10C scope. RECOVER's intentionally narrower reconciliation contract is documented in ADR-016 and is not a canonical-response client gap.

## 20. Final Verdict

**FASE 10C COMPLETE**
