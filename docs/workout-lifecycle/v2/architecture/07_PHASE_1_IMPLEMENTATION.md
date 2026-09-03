# Phase 1 Implementation — Domain, Persistence and Integrity

**Status:** IMPLEMENTED for Phase 1 scope
**Overall V2 Implementation:** PARTIAL

## Persisted records

```text
users/{uid}/workoutLifecycleState/current
  startingLevel
  currentTrainingLevel
  currentCycleId / currentCycleNumber
  activeProgramInstanceId
  activeContentIdentity / activePrescriptionIdentity
  initializationOrigin / historyCompleteFrom

users/{uid}/trainingCycles/{cycleId}
  level / cycleNumber / status / origin
  programInstanceId / previousProgramInstanceId
  startedAt / eligibleAt / completedAt / progressionReason

users/{uid}/programInstances/{programInstanceId}
  cycleId
  contentIdentity / prescriptionIdentity / questionnaireId
  activatedAt / supersededAt / previousProgramInstanceId / activationReason

users/{uid}/workoutLifecycleEvents/{eventId}
  type / occurredAt / cycleId / programInstanceId
  idempotencyKey / payload / schemaVersion
```

All four structures use schema version 2. Training cycles and ProgramInstances
preserve immutable identity and timestamps; only their explicit lifecycle
transition fields may change under Firestore Rules. Events are append-only.

## Sources of truth

- Starting level, current level, current cycle and active ProgramInstance:
  `workoutLifecycleState/current`.
- Cycle history: `trainingCycles`.
- Activation/supersession history: `programInstances`.
- Prescription identity: immutable `FinalWorkoutPlan.planId`, copied as
  `WorkoutProgram.prescriptionId` and referenced by ProgramInstance.
- Content identity: deterministic `WorkoutProgram.programId`.
- Original questionnaire level: immutable historical evidence only.
- `workoutProgramState/active`: compatibility mirror for V1 readers/writers,
  not the V2 lifecycle authority. `metadata.activeWorkoutId` is legacy profile
  metadata and is not consulted by Workout Lifecycle.

## Compatibility and identity

New program persistence creates content, first cycle, ProgramInstance,
lifecycle state and compatibility pointer in one transaction. Existing users
are initialized lazily and deterministically as `V1_MIGRATION_BASELINE`.
Unknown pre-baseline history is never synthesized.

New execution IDs and schedule cursors are scoped by `programInstanceId`, so
two activations of identical content cannot collide. V1 documents without that
field continue to parse and are accepted by Rules.

## Integrity boundaries

`execution.finish()` flushes a serialized mutation queue. A failed set remains
an unreconciled deterministic key and blocks finish until a successful retry.
After finish, Schedule completion runs only when the execution service returns
a persisted terminal status; progression runs only after Schedule confirms its
write.

## Deliberately not implemented

Phase 1 does not evaluate V2 eligibility/adherence, pause active time, promote
levels, rotate prescriptions, perform motivational renewal, award XP, or add
unlock/deferral/gamification UI. The existing V1 Progression Engine remains
operational and now starts a distinct ProgramInstance when it renews identical
content.
