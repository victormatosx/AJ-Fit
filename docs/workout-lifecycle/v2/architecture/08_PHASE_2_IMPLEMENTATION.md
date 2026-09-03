# Phase 2 Implementation — Progression Engine V2

> **HISTORICAL:** Phase 9 supersedes the proportional adherence denominator
> documented below. Current Progression V2 enumerates real prescribed calendar
> opportunities inside the ProgramInstance window; see ADR-015 and Phase 9.

**Status:** IMPLEMENTED for Phase 2 scope (pure decision engine only)
**Overall V2 Implementation:** PARTIAL

## What this phase answers

> Given everything known about this user's journey, has the user earned the
> right to evolve?

It answers this and stops. It never selects exercises, never generates a
prescription, never activates a Program Instance, and never awards XP.

## Architecture

```text
Executions / Schedule / Lifecycle (Phase 1)
            |
Session Qualification   (src/progressionEngineV2/sessionQualification.ts)
            |
Adherence                (src/progressionEngineV2/adherence.ts)
            |
Active Time              (src/progressionEngineV2/activeTime.ts, ADR-007)
            |
Cycle Progress / earned-cycle counting (src/progressionEngineV2/earnedCycles.ts)
            |
ProgressionSnapshotV2 -> evaluateProgressionV2()  (src/progressionEngineV2/resolver.ts, pure)
            |
ProgressionDecision
```

`src/services/workoutProgressionV2.ts#evaluateProgressionV2ForUser(uid, now?)`
is the only impure entry point: it gathers the current lifecycle bundle, every
Program Instance and execution belonging to the *current Training Cycle* only,
the prescribed schedule, calls the pure functions above, and returns a
`ProgressionDecision`. It performs no writes.

## Decision type

```ts
type ProgressionDecision =
  | { type: 'NO_ACTION'; reason }
  | { type: 'PROGRESS_CONTINUES'; reason; activeDays; adherence }
  | { type: 'EVOLUTION_ELIGIBLE'; level; quality; activeDays; adherence; reason }
  | { type: 'MOTIVATIONAL_RENEWAL_AVAILABLE'; level; activeDays; adherence; reason }
  | { type: 'LEVEL_PROMOTION_ELIGIBLE'; from; to; quality; activeDays; adherence; reason };
```

A single discriminated union — a decision can never simultaneously claim
earned eligibility and a motivational renewal.

## Domain constants (`src/progressionEngineV2/config.ts`)

| Constant | Value | Source |
|---|---|---|
| `beginnerMinimumActiveDays` | 28 | progression/02 |
| `intermediateAdvancedMinimumActiveDays` | 85 | progression/03-05 |
| `adherenceEarnedThresholdBp` | 7000 (70%) | progression/06 |
| `adherenceHighThresholdBp` | 8500 (85%) | progression/06 |
| `motivationalRenewalExtensionDays` | 30 | progression/08 |
| `intermediateCyclesForPromotion` | 4 | progression/04 |
| `inactivityMissedOpportunityThreshold` | 3 | ADR-007 |
| `partialSessionMinSetCompletionPercent` | 70 | progression/06 |

## Session Qualification

`COMPLETED` always counts. `PARTIALLY_COMPLETED` counts only when
`completedSets * 100 >= totalSets * 70` (integer comparison — no float
rounding at the boundary). `IN_PROGRESS`/`ABANDONED` never count. A session
below the threshold stays in history unchanged; nothing is retroactively
reclassified.

## Adherence

`ratio = min(1, validSessionCount / expectedSessions)`, where
`expectedSessions = trainingDaysPerWeek * activeDays / 7`. Extra workouts
cannot push the ratio above 1.0, and — because `expectedSessions` is
proportional to `activeDays`, not raw calendar days — extra workouts also
never reduce the *active-time* gate. Quality: `HIGH` ≥85%, `GOOD` [70%, 85%),
`BELOW_TARGET` <70%, using basis-point rounding to avoid boundary float bugs.

## Active Time

See ADR-007. Derived, not persisted — no separate mutable source of truth for
it exists.

## Earned cycle counting

`countEarnedIntermediateCycles` counts only `TrainingCycle`s with
`level === 'INTERMEDIATE'`, `status === 'COMPLETED'`, and
`progressionReason` in `{EARNED_CYCLE_EVOLUTION, EARNED_LEVEL_PROMOTION}`. It
never counts by `programId`, by `ProgramInstance` count, or by V1
`progressionEvents`. A V1 baseline's `V1_MIGRATION_BASELINE_NO_PRIOR_HISTORY_INFERRED`
reason never matches, so migrated accounts never inherit invented credit.

## V1 compatibility and the eligibility boundary

`src/services/workoutProgression.ts#applyProgression` still computes V1's
`NORMAL_ROTATION_AVAILABLE` resolution unchanged, but once the account has a
V2 lifecycle (true for essentially every account, since `loadActiveWorkoutProgram`
lazily bootstraps one), applying that resolution is blocked with
`{ applied: false, reason: 'V2_LIFECYCLE_OWNS_ELIGIBILITY' }`. V1's math (90
calendar days, ≥60% of all completed/partial sessions) is strictly looser
than V2's (≥85 active days, ≥70% of sessions meeting the 70%-of-sets bar), so
V1 could otherwise fire before V2 would ever agree — the gate prevents that
contradiction without re-deriving V2's opinion inline. Beginner Stage 1→2→3
(`BEGINNER_STAGE_PROGRESSION_AVAILABLE`) is a distinct, narrower concept — a
within-Beginner prescription volume ramp, not a cycle/level transition — and
is intentionally left ungated.

## Deliberately not implemented

Prescription Evolution (exercise rotation/substitution/equivalence/ordering),
Level Promotion prescription generation, new template activation, the 2+2
week Evolution Deferral mechanic, unlock/renewal UI, and any XP/ranking/badge
mutation. `EvolutionQuality.HIGH` is a fact the engine returns; nothing
consumes it for a reward in this phase.
