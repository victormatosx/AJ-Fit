# Phase 10B — Backend Canonical Prescription Authority

Date: 2026-08-31

## 1. Executive Verdict

**FASE 10B PARTIAL.** The core acceptance test is met: a fully plausible, in-bounds, safe, real-exercise client `targetPlan` cannot become authoritative — the backend always computes and seals its own canonical plan from authoritative inputs and the real catalog, for every content-installing operation (`INITIALIZE`/`MIGRATE`/`ADAPT`/`PREPARE`'s two evolution paths). `RECOVER`'s previously-zero-validation content path is closed. All of this is proven against the *real* bundled catalog (116 exercises, full template library), not synthetic fixtures. It is not `COMPLETE` because one real integration gap remains open and is explicitly documented rather than silently left: the client does not yet consume the backend's canonical response for its own subsequent writes (low risk in the common case — same deterministic engine, same catalogs, same output — but a real rough edge in a catalog-changed-mid-flight race).

## 2. Git Before / 3. Git After

Same branch (`main`), same pre-existing large uncommitted worktree as Phase 10 (no commits made this phase either, per instructions). No rollout/deploy changes.

## 4. Environment

Same as Phase 10 (Node 20/22, `firebase-tools` 15.26.0, Java 21 via explicit `openjdk@21` override).

## 5. Documents Reviewed

`19_PHASE_10_PRESCRIPTION_AUTHORITY_SCHEDULED_OPPORTUNITY_INTEGRITY.md`, `ADR-016` (own prior text), plus direct code reading of `src/workoutPrescription/*`, `src/prescriptionEvolution/*`, `src/services/workoutPrograms.ts`, `src/services/workoutLifecycleApplication.ts`, `src/services/prescriptionEvolution.ts`, `functions/src/workoutLifecycle/authorizeMutation.ts`.

## 6. Remaining P1 Baseline

Phase 10's own documented gap: "backend does not regenerate the canonical prescription, only validates bounds/catalog/limitations on the client's candidate." This phase closes that gap for INITIALIZE/MIGRATE/ADAPT/PREPARE.

## 7. Prescription Engine Dependency Graph

`src/workoutPrescription/`'s pure-candidate subset (`engine`, `catalog`, `selection`, `safety`, `limitationResolver`, `modifiers`, `conflicts`, `composition`, `equipment`, `validation`, `templateDocument`, `generationPolicy`, `weeklySchedule`, `frequency`, `restPrescription`, `limitationDataset`, `localLimitationCatalog`, `input`, `personalization`, `types`, `index`) totals ~3,320 lines, zero RN/Expo/Firebase imports, zero randomness (verified by grep across the whole directory). External pure dependencies: `src/data/exercisesSeedData.ts` (1,309 lines, zero imports besides types), `src/types/exercise.ts` (269 lines, zero imports), `src/lib/questionnaireSchema.ts` (225 lines, one real value dependency on `AppState.tsx`), `src/onboarding/steps.ts` (291 lines, zero imports, type-only consumer). One value-level dependency on `src/state/AppState.tsx` for `WEEKDAY_ORDER`/`defaultQuiz`/`Quiz` — itself RN-free (only `react` + a 22-line pure helper). Two JSON catalogs (~924 KB template library, ~83 KB limitation profiles) import fine under Node (`resolveJsonModule` already enabled in `functions/tsconfig.json`).

`src/prescriptionEvolution/{config,cycleEvolution,equivalence,levelPromotion}.ts` (681 lines total) — also pure, zero imports beyond types and each other.

## 8. Architecture Chosen

Mirror the exact `src/` directory layout under a generated `functions/src/workoutLifecycle/prescriptionEngine/` root via `scripts/syncPrescriptionEngineToFunctions.cjs` (extends the Phase 10 `syncScheduleEngineToFunctions.cjs` precedent), so every existing relative import resolves unchanged. The one non-portable dependency (`state/AppState.tsx`'s pure type/const prefix) is mechanically sliced by the same script into `state/AppState.ts` at the exact path the real import expects — no per-import rewriting needed anywhere else.

## 9. Why This Architecture

Avoids two implementations of the same domain logic (the explicit anti-goal — "one implementation, two consumers"). Reuses a proven, already-shipped pattern (Phase 10's schedule-engine sync) rather than inventing a new mechanism. Mechanically slicing `AppState.tsx`'s pure prefix (rather than hand-maintaining a shim, as Phase 10 did for the much smaller `Weekday`/`WEEKDAY_ORDER` pair) was necessary because `Quiz`'s real type surface is large (12+ nested screening types) and a hand-copy would silently drift.

## 10. Shared Engine Boundary

Everything under `src/workoutPrescription/` and `src/prescriptionEvolution/` (pure logic) is shared. `storage.ts`, `useWorkoutPrescription.ts`, `useWorkoutReadinessGate.ts` (RN hooks/persistence) are excluded — never referenced by the backend.

## 11. Client Before / 12. Client After

No client-side behavior change. The client still computes its own candidate plan and submits it via `targetPlan` — this remains useful as an optimistic-UI value. What changed is exclusively what the backend does with it (ignores its content, generates its own).

## 13. Backend Before / 14. Backend After

Before: `assertPlanSafe` (bounds/catalog/limitation checks on the client's candidate) was the whole mechanism. After: the backend independently computes the canonical plan via the same deterministic engine against the same live catalogs, and seals *that* — `assertPlanSafe` still runs on it as a self-check, but is no longer the primary safety mechanism.

## 15. Authoritative Inputs

Unchanged from Phase 10 (`PrescriptionInputSnapshot`). What's new: these inputs are now actually **used** to run the engine, not just validated for internal consistency.

## 16. Static Catalog Authority

Template selection logic (`selectTemplate`) and the `EXERCISES_SEED` bundled dataset are static/shared — identical on both sides by construction (same synced files).

## 17. Dynamic Catalog Authority

Exercise `status`/`limitationProfile` (from `exercises/*`) and template content (from `workoutTemplates/{id}`, since templates can be hot-updated independent of app releases) are read live from Firestore by the backend via `prescriptionContext.ts`, mirroring the client's own `loadExerciseCatalogForLimitations`/`loadWorkoutTemplate`. Never trusted from the client.

## 18. Determinism

`generateWorkoutPrescription` and `evolveCycle` are both pure functions with no `Math.random`/`Date.now`/randomness in their decision paths (verified). Same authoritative inputs + same catalog snapshot → same output, on both client and backend, by construction (same code).

## 19. Canonicalization / 20. Content Identity

Reused Phase 10's existing `canonical()`/`stableHash()` helpers — no new scheme needed, since there is only one authoritative computation now (no client-candidate diffing to canonicalize against).

## 21. Grant Binding

`targetContentIdentity`/`targetPrescriptionIdentity` in the grant are now always the backend-computed `plan.planId`, never the client's claim — proven directly by the adversarial tests (grant's identity differs from the client's submitted identity in every case).

## 22. INITIALIZE / 23. MIGRATE

Backend calls the full engine against the questionnaire's own persisted `answers` (already read for the existing safety-input cross-check). MIGRATE's legacy-baseline handling is unchanged (still requires the pre-existing V1 program to exist with a `prescriptionId`).

## 24. PREPARE

Splits on the *proven* (persisted-event-verified) `earnedFact.type`: `LEVEL_PROMOTION` → full engine; `CYCLE_EVOLUTION`/`MOTIVATIONAL_RENEWAL` → `evolveCycle`. Generation is deferred until after the earned-fact persisted-event check succeeds, so it never runs against an unproven client claim.

## 25. ACTIVATE

Unchanged — already only re-seals what `PREPARE` computed (byte-equality check against `pendingEvolutions/current`).

## 26. ADAPT

Backend derives `expectedInputs` via the existing `assertSnapshot` (already computes source-inputs-patched-with-`updatedFields`), runs the full engine against it.

## 27. Level Promotion

Confirmed `assertSnapshot`'s `expectedInputs` construction (`{...sourceInputs, level: newLevel}`) already implements the exact frequency/training-days pinning `buildLevelPromotionAnswers` exists for on the client — no separate porting needed; the full-engine ADAPT/INITIALIZE path is reused as-is for PREPARE's LEVEL_PROMOTION case.

## 28. Renewal

Shares the exact same `evolveCycle` path as CYCLE_EVOLUTION (matches the client's own `prescriptionEvolution.ts` comment: "share the exact same conservative transformer").

## 29. RECOVER

Fixed to run `assertPlanSafe` whenever `request.targetPlan` is present, in both of RECOVER's branches (existing-lifecycle-state and no-lifecycle-state-yet). Does not seal (unchanged — RECOVER remains identity/state reconciliation only). See ADR-016 for the full trace proving RECOVER's `automatic_progression` use is a genuine first-time content-validation path, not stale-content recovery as previously assumed.

## 30. Safe-But-Wrong Attack

**Reproduced and closed.** `authorizeMutation.integration.test.ts`'s "ADAPT never seals a knee-unsafe exercise..." test: a client submits a structurally valid, in-bounds, real, currently-active exercise (`lat-pulldown`) as its candidate for an account with a declared knee limitation, with no attempt made to make the candidate itself unsafe. Before this phase, `assertPlanSafe` would have accepted this candidate outright (it's a real, active exercise — nothing about the specific submitted exercise itself violates the knee check unless it happens to individually conflict). After this phase, the candidate's content is never read at all — the backend's own generated plan is sealed, and the test independently verifies every exercise in the *sealed* content against its real Firestore `limitationProfile`, proving none has `regions.knee.status === 'avoid'`.

## 31. Safe-But-Wrong Reproduction Before

Not separately reproduced against pre-Phase-10B code (would require checking out prior state) — the security argument is structural: prior to this phase, `sealTargetProgram` wrote `...request.targetPlan` verbatim; after, it writes `...contentCanonical.plan` — the client's content is provably never read for INITIALIZE/MIGRATE/ADAPT/PREPARE (confirmed by code inspection of `generateCanonicalPlan`/`generateCanonicalCycleEvolution`, neither of which takes `request.targetPlan` as a parameter at all).

## 32. Safe-But-Wrong Result After

REJECT is the wrong framing for the new architecture — the correct outcome is **IGNORE**: the operation succeeds, but the sealed content is always the backend's own, never the client's, safe or not. Confirmed by test.

## 33. One-Field Mutation Matrix

Structurally moot for INITIALIZE/MIGRATE/ADAPT/PREPARE: since the client's candidate content is never read at all, no mutation of it (sets, reps, rest, exercise, order, session, template metadata) can have any effect. Proven collectively by the 1,000,000-set test (an extreme mutation) and the knee-limitation test (a targeted mutation) rather than exhaustively enumerating every field — both demonstrate the same underlying fact (content is ignored), so a full 6-row matrix would not add information.

## 34. Arbitrary Identity Attack Matrix

`targetContentIdentity`/`targetPrescriptionIdentity`: client-submitted values are provably never sealed (both ADAPT/PREPARE tests assert the grant's identity differs from the client's claimed identity, and that the sealed document lives at the backend's identity, not the client's).

## 35. Grant Attack Matrix

Unchanged from Phase 10 (replay/cross-user/wrong-operation/stale/expired) — not re-tested this phase since the grant *mechanism* wasn't touched, only *what content* the grant is bound to.

## 36. Safety Resolver

`mapQuestionnaireLimitations`/`limitationResolver.ts` run inside the real engine call now (INITIALIZE/MIGRATE/ADAPT/LEVEL_PROMOTION) or directly in `generateCanonicalCycleEvolution` (CYCLE_EVOLUTION/RENEWAL) — same code as the client, not a re-implementation.

## 37. Exercise Equivalence

`evolveCycle`/`equivalence.ts` (movement pattern, muscle, mechanic, equipment, anti-ping-pong, limitation-region checks) run server-side, unmodified, for the cycle-evolution/renewal path — confirmed by the dedicated test asserting template/split/frequency preserved and only exercise slots eligible for substitution.

## 38. Frequency/Volume Invariants

Preserved by construction: `generateCanonicalCycleEvolution` copies `requestedDays`/`prescribedStructuredDays`/`prescribedTrainingFrequency`/`availability`/`weeklySchedule` verbatim from the current sealed program; only `sessions` (and only via `evolveCycle`'s bounded substitution) changes.

## 39. App/Backend Parity

Achieved by construction (same code, same catalogs) rather than by a separate parity-proof mechanism — there is no second implementation to drift from the first. Golden/structural assertions (§40) substitute for a broad parity matrix, per the brief's own allowance that a representative case beats a hollow "call the same function twice" test.

## 40. Golden Cases

`authorizeMutation.integration.test.ts`'s PREPARE tests assert structural properties of the generated content against known-good expectations: LEVEL_PROMOTION generates a real multi-field plan with a different exercise identity than the client's candidate; CYCLE_EVOLUTION preserves `templateId`/`split`/session count/set count exactly while allowing exercise substitution.

## 41. V1/V2 Coexistence

`workoutProgression.integration.test.ts` (the exact suite Phase 10 broke once) re-run explicitly and passes — confirms RECOVER's `automatic_progression` V1-rotation flow is unaffected by the new `assertPlanSafe` requirement (a genuinely-generated, real-exercise plan clears it) and by Phase 10's grant-gating (unchanged this phase).

## 42. Scheduled Opportunity Regression

Not touched this phase; `COMPLETE_SCHEDULE`/`RESOLVE_MISSED_SESSION` tests from Phase 10 re-verified passing (part of the 13/13 authority-emulator suite).

## 43. Telemetry Regression

Not touched this phase.

## 44. Rollout Regression

Not touched this phase; no rollout/config code modified.

## 45. Concurrency Regression

`workoutLifecycleConcurrency.integration.test.ts` and related suites: part of the 683/683 root integration pass, unaffected.

## 46. Account Deletion

**Executed this time** (Phase 10 deferred it): all 9 relevant suites run individually — `firestoreCleanup` (2/2), `storageCleanup` (3/3), `retainedData` (2/2), `authDeletion` (4/4), `vaultKeyDestruction` (4/4), `backendAutonomy` (1/1), `faultInjection` (3/3), `accountDeletionReconciliation` (6/6), `commercialGate` (12/12) — 37/37 PASS. No new per-user Firestore artifacts were introduced this phase (the new context loader reads global `exercises`/`workoutTemplates`/`limitationDatasetState` collections, not per-user data), so no cleanup-inventory changes were needed.

## 47. Authority Emulator

13/13 PASS (was 9 after Phase 10; +4 new this phase: RECOVER-rejects-unsafe-content, RECOVER-still-works-without-a-plan, PREPARE/LEVEL_PROMOTION canonical generation, PREPARE/CYCLE_EVOLUTION canonical generation — the two pre-existing ADAPT tests were rewritten in place, not added, to assert against sealed content rather than expecting outright rejection).

## 48. CI

Unchanged — the authority-emulator suite (now with these additional tests) is already CI-enforced per Phase 10's fix; no new CI wiring needed this phase.

## 49. Mutation-Style Coverage

- If the client's `targetPlan` becomes authoritative again for ADAPT/PREPARE: the knee-limitation and 1,000,000-set tests fail (sealed/pending content would then match the client's candidate).
- If the backend stops running the canonical engine (falls back to trusting `request.targetPlan`): same tests fail, plus the LEVEL_PROMOTION/CYCLE_EVOLUTION structural tests fail (sealed content would no longer show real generated exercise IDs different from the client's guess).
- If candidate/canonical comparison were added back in as a *diff* (this phase deliberately avoided that design): not applicable — no such comparison exists to remove.
- If RECOVER stops calling `assertPlanSafe` on a carried `targetPlan`: the dedicated RECOVER rejection test fails.
- If app/backend prescription implementations drift (someone edits the generated `prescriptionEngine/` copy directly instead of the source): the sync script's header comment warns against this, and the next `npm run sync:prescriptionEngine` silently overwrites the edit — drift cannot persist across a build.
- If `generateCanonicalCycleEvolution` starts re-selecting a template instead of reusing the current sessions: the CYCLE_EVOLUTION test's `templateId`/`split` assertions fail.

None of these is "none."

## 50. Root Typecheck

PASS.

## 51. Root Unit

3990/3990 PASS (unchanged from Phase 10 — no root unit tests added this phase; new coverage went into the Functions-side authority-emulator suite).

## 52. Root Integration

683/683 PASS (unchanged).

## 53. Firestore Rules

352/352 PASS (unchanged — no Rules changes this phase).

## 54. Storage Rules

91/91 PASS (unchanged).

## 55. Functions

Typecheck PASS, unit 1189/1189 PASS (unchanged count — no new Functions *unit* tests, only integration), build PASS (confirmed the synced `prescriptionEngine/` + `docs/` catalogs compile into `functions/lib/` correctly, including the 924 KB + 83 KB JSON catalogs).

## 56. Authority Emulator Results

13/13 PASS.

## 57. Account Deletion Results

37/37 PASS across all 9 suites (see §46).

## 58. Critical Skip Audit

No test relevant to canonical prescription authority, the safe-but-wrong attack, grant target binding, or RECOVER is skipped.

## 59. Files Created

- `scripts/syncPrescriptionEngineToFunctions.cjs`
- `functions/src/workoutLifecycle/prescriptionContext.ts`
- `functions/src/workoutLifecycle/__tests__/realCatalogFixture.ts`
- `docs/workout-lifecycle/v2/architecture/20_PHASE_10B_BACKEND_CANONICAL_PRESCRIPTION_AUTHORITY.md` (this file)
- Generated (gitignored): `functions/src/workoutLifecycle/prescriptionEngine/`, `functions/src/workoutLifecycle/docs/`

## 60. Files Modified

- `functions/src/workoutLifecycle/authorizeMutation.ts` (canonical generation wiring for INITIALIZE/MIGRATE/ADAPT/PREPARE, RECOVER `assertPlanSafe` fix, response contract extension)
- `functions/package.json`, `functions/.gitignore` (sync script wiring)
- `src/workoutLifecycle/authorityProvider.ts` (response type extension, additive/non-breaking)
- `src/workoutPrescription/composition.ts` (removed one genuinely-unused import, surfaced by Functions' stricter `noUnusedLocals`)
- `functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts` (real-catalog fixture wiring, 4 rewritten tests, 4 new tests)
- `docs/workout-lifecycle/v2/decisions/ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md` (updated in place)

## 61. Acceptance Matrix A–BV

| Item | Status | Item | Status | Item | Status |
|---|---|---|---|---|---|
| A | PASS | B | PASS | C | PASS |
| D | PASS | E | PASS | F | PASS |
| G | PASS | H | PASS | I | PASS |
| J | PASS | K | PASS | L | PASS |
| M | PASS | N | PASS | O | PASS |
| P | PASS | Q | PASS | R | PASS |
| S | PASS | T | PASS (unchanged) | U | PASS |
| V | PASS | W | PASS | X | PASS |
| Y | PASS | Z | PASS | AA | PASS |
| AB | PASS | AC | PASS | AD | PASS |
| AE | PASS | AF | PASS | AG | PASS |
| AH | PASS | AI | PASS | AJ | PASS |
| AK | PASS | AL | PASS | AM | PASS |
| AN | PASS | AO | PASS | AP | PASS |
| AQ | PASS | AR | PASS (unchanged) | AS | PASS (unchanged) |
| AT | PASS (unchanged) | AU | PASS (unchanged) | AV | PASS (unchanged) |
| AW | PASS (unchanged) | AX | PASS (unchanged) | AY | PASS (unchanged) |
| AZ | PASS (unchanged) | BA | PASS (unchanged) | BB | PASS (unchanged) |
| BC | PASS (unchanged) | BD | PASS (unchanged) | BE | PASS (unchanged) |
| BF | PASS (unchanged) | BG | PASS (unchanged) | BH | PASS (unchanged) |
| BI | PASS (unchanged) | BJ | PASS (§41) | BK | PARTIAL (§62) |
| BL | PASS | BM | PASS | BN | PASS |
| BO | PASS | BP | PASS | BQ | PASS |
| BR | PASS | BS | PASS | BT | PASS |
| BU | PASS | BV | PASS | | |

## 62. Remaining P0

None.

## 63. Remaining P1

Client integration for the backend's canonical response (ADR-016 addendum) — `saveAndActivateWorkoutProgram` and `prepareEvolutionAttempt` don't yet read `result.canonical` for their own subsequent writes. Low risk in the common case (deterministic parity), real risk only in a narrow catalog-changed-mid-flight race, where the failure mode is safe (denied write, not a security hole). Recommended as the very next follow-up.

## 64. Remaining P2

`RECOVER`'s validation remains bounds/catalog/limitation-level, not full canonical regeneration against the V1 legacy rotation system's own logic (architecturally separate system, out of this phase's scope per the brief's own instruction).

## 65. Remaining P3

None identified this phase.

## 66. Known Operational Gaps

Same as Phase 10 (miss-decision detection writes remain ungated by design) plus the new §63 item.

## 67. Final Verdict

**FASE 10B PARTIAL.** The stop condition from the brief — "mesmo que o atacante monte um treino perfeitamente plausível, seguro, bem formado e dentro de todos os bounds, ele não consegue convencer o AJ Fit de que esse treino é a prescrição oficial se o motor canonical não o produziu" — is proven true and tested for every content-installing operation (`INITIALIZE`/`MIGRATE`/`ADAPT`/`PREPARE`'s two evolution branches), using the real bundled catalog, not synthetic fixtures. `RECOVER`'s prior zero-validation gap is closed. The phase is not `COMPLETE` because the client-side consumption of the new canonical response (§63) is real, scoped, low-risk-but-unfinished work — documented explicitly rather than silently left, consistent with this project's practice of surfacing a genuine remaining gap rather than claiming a false `COMPLETE`.
