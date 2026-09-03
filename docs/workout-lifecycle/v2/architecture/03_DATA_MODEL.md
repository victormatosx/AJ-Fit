# Target Data Model

**Implementation:** IMPLEMENTED for the lifecycle records used by Phase 8B; XP/reward state remains out of scope.

This document defines conceptual records, not final Firestore paths.

### TrainingCareer
`startingLevel`, `currentTrainingLevel`, `earnedIntermediateCycles`, `currentCycleNumber`, durable promotion timestamps.

### TrainingCycle
Stable lifecycle identity, level, ordinal, type (`EARNED`/other as appropriate), start/end/activation history and outcome.

### ProgramInstance
Unique lifecycle instance linked to prescribed content/template, questionnaire/input snapshot, activation period and cycle.

### CycleProgress
Active-time accounting, expected/valid sessions, adherence tier, eligibility and deferral state.

### DomainEvent
Stable id, type, occurredAt, user/cycle/program references, semantic payload, schema version.

Phase 1 persistence paths and their precise authority are documented in
[`07_PHASE_1_IMPLEMENTATION.md`](./07_PHASE_1_IMPLEMENTATION.md). `CycleProgress`
and promotion-credit persistence remain intentionally deferred to Phase 2.

## Phase 8A correctness fields

`ProgramInstance.prescriptionInputSnapshot` is the immutable, versioned
prescription-input authority for that activation. It embeds
`snapshotId`, `schemaVersion`, `source`, and the normalized effective inputs;
it is not a pointer to the mutable/latest questionnaire. A prepared evolution
embeds the same shape as `targetPrescriptionInputSnapshot` until activation.

`TrainingCycle.completionReason = EARNED_EVOLUTION` records earned completion
on the cycle that actually completed. Entry `progressionReason` remains useful
history, but is no longer the primary credit marker. Pre-8A records remain
readable: missing snapshots use a deterministic read-only questionnaire
fallback, and missing completion reasons are inferred only when an exact
earned successor proves the transition. No historical document is rewritten.

## Phase 8B concurrency metadata

New pending writes require `sourcePrescriptionInputSnapshotId` alongside
`sourceProgramInstanceId` and `sourceCycleId`. Existing pre-8B pending records
remain readable; a source instance without a historical snapshot uses the
deterministic compatibility identity `legacy:<programInstanceId>`. Activation
and preparation compare all three identities. The target snapshot remains the
same authoritative 8A object; no second input/version source was introduced.

Deferral events record exact `nextPromptAtMs`/`autoActivateAtMs` values so a
stale-target reprepare preserves the original earned timeline exactly. These
numbers are history payload, not another operational pointer.

No new collection or account-deletion resource was added.
