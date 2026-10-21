> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../../../removal-physical-limitations/REPORT.md).

# Phase 3 Implementation — Prescription Evolution Engine

**Status:** IMPLEMENTED for Phase 3 scope (pure "next prescription candidate" generation only)
**Overall V2 Implementation:** PARTIAL

## What this phase answers

> Given an already-made progression decision and the current prescription,
> what should the NEXT prescription be?

It answers this and stops. It never activates the result, never supersedes
the current Program Instance, never writes a lifecycle event, and never
implements deferral/UI/XP.

## Architecture

```text
ProgressionDecision (Fase 2, informational only)
            |
      LEVEL_PROMOTION ---------------- CYCLE_EVOLUTION / MOTIVATIONAL_RENEWAL
            |                                     |
buildLevelPromotionAnswers (pure)        evolveCycle (pure)
src/prescriptionEvolution/                src/prescriptionEvolution/
  levelPromotion.ts                         cycleEvolution.ts + equivalence.ts
            |                                     |
prepareWorkoutProgram (existing pipeline)   catalog + limitationRegions +
  — real template selection/composition       equipmentContext + recent history
            |                                     |
            +-------------------+-----------------+
                                 |
                    src/services/prescriptionEvolution.ts
                       evolvePrescription() — impure gather, NO writes
                                 |
                          Next Prescription (FinalWorkoutPlan)
```

## Level Promotion

`buildLevelPromotionAnswers` (pure) clones the immutable questionnaire's
answers, overrides `level` to the target lifecycle level, and pins `days`/
`trainingDays` to the CURRENT prescription's actual
`prescribedTrainingFrequency` — never raw availability. The synthetic
answers are never persisted back to `questionnaires/{id}`.

`evolvePrescription({mode:'LEVEL_PROMOTION', targetLevel})`
(`src/services/prescriptionEvolution.ts`) then runs the exact existing
`prepareWorkoutProgram` pipeline (real template selection, composition,
safety resolver, validators) with these synthetic answers — Level Promotion
is a genuine re-prescription through the real pipeline, not a rotation. It
double-checks the resulting plan's frequency still equals the pinned value
before returning `SUCCESS`.

**Dataset limitation, documented not hidden (ADR-008):** `selectTemplate`/
`prescribeTrainingFrequency` have no level-specific branch beyond the
6–7-day frequency bump (neutralized by pinning) and Beginner's
`adaptationStage` caps. Classification:

| Transition | Support |
|---|---|
| BEGINNER → INTERMEDIATE | SUPPORTED — `adaptationStage` caps are lifted, a real behavioral difference |
| INTERMEDIATE → ADVANCED | PARTIALLY_SUPPORTED / BLOCKED_BY_DATASET — lifecycle metadata (level/cycle/instance) transitions correctly, but at equal frequency the template catalog has no Advanced-specific content differentiation from Intermediate today |

## Cycle Evolution / Motivational Renewal

`evolveCycle` (pure, `src/prescriptionEvolution/cycleEvolution.ts`) starts
from the CURRENT prescription's `sessions` — never a fresh template
selection. See ADR-008 for the exact operational rules (movement anchors,
novelty target, selection order, duplicate scope, anti-ping-pong, ranking,
volume, ordering).

`evaluateEquivalenceCandidate`/`purposePreserved`/`isLimitationSafe`
(`src/prescriptionEvolution/equivalence.ts`) reuse the existing safety
infrastructure directly: `validateLimitationProfile` and
`isExerciseExecutable`/`equipmentContextFor` from
`src/workoutPrescription/{limitationResolver,equipment}.ts` — no second,
competing safety taxonomy was created. `purposePreserved` mirrors
`limitationResolver.ts`'s private hard-equivalence gate (same movement
pattern AND (same primary muscle OR explicitly declared limitation
variant)) — same-muscle-only substitution is structurally impossible.

Motivational Renewal (`mode: 'MOTIVATIONAL_RENEWAL'`) calls the identical
transformer under a different mode tag — see ADR-008 for why this is a
documented judgment call rather than a separate implementation.

## Side effects

`evolvePrescription` never calls `saveAndActivateWorkoutProgram`,
`activateProgramInstance`, or writes any lifecycle event. It reads
(`loadActiveWorkoutProgram`, `getQuestionnaireById`, `loadWorkoutLifecycle`,
`listProgramInstances`, the real template/limitation-dataset loaders for
Level Promotion) and returns a `FinalWorkoutPlan` candidate. Confirmed by
integration test: Program Instance/Training Cycle/lifecycle event counts
are identical before and after calling it.

## Determinism

Both modes are pure functions of their inputs — no `Date.now()`, no
`Math.random()`. `evolveCycle`'s `targetCycleIdentity` (an explicit,
caller-supplied string, defaulting to
`${currentCycleId}:${activeProgramInstanceId}`) salts both slot-processing
order and tie-breaks, so the same cycle always re-resolves identically
while a different one can legitimately choose differently.

## Firestore

No new persisted fields or paths. `evolvePrescription` computes a new
`planId` for the Cycle Evolution/Motivational Renewal candidate
(`wpe_<hash>`, derived from the base plan's `planId` + `targetCycleIdentity`
+ resulting sessions) purely for identity/debugging — it is never written
to Firestore by this phase.

## Deliberately not implemented

Exercise reordering, activation of the produced prescription, superseding
the current Program Instance, the 2+2 week Evolution Deferral mechanic,
unlock/renewal UI, and any XP/ranking/badge mutation.
