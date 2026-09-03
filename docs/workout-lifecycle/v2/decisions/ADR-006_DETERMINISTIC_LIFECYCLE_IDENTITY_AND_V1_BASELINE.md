# ADR-006 — Deterministic Lifecycle Identity and Explicit V1 Baseline

**Status:** Accepted and partially implemented in Phase 1

## Decision

Keep the existing deterministic `FinalWorkoutPlan.planId` and persisted
`WorkoutProgram.programId` as prescription/content identities. Create separate
deterministic `ProgramInstance` and `TrainingCycle` IDs from stable logical
operation keys. A caller that intentionally starts a new lifecycle period with
the same content must supply a stable idempotency key.

For a user with only V1 data, lazily create one deterministic
`V1_MIGRATION_BASELINE` cycle and ProgramInstance. Set the baseline cycle number
to 1 and record `historyCompleteFrom`; do not derive a prior cycle count from
`adaptationStage`, program age, or progression events.

## Rationale

Random IDs would weaken retry and multi-device convergence. Reusing
`programId` would continue conflating content with an activation interval.
Historical V1 data cannot reliably reconstruct every earlier lifecycle period,
so an explicit baseline is the only auditable representation.

## Consequences

- Equivalent content can back multiple distinct ProgramInstances.
- Schedule and execution V2 namespaces use `programInstanceId`; V1 identifiers
  remain accepted for compatibility.
- `workoutLifecycleState/current` is authoritative after initialization.
  `workoutProgramState/active` remains a compatibility mirror, and
  `metadata.activeWorkoutId` is not a lifecycle authority.
- Exact retries converge on existing deterministic records; transitions from a
  stale active instance are rejected.
