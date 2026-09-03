# ADR-011 — Production Rollout and Rollback Authority

**Status:** Accepted and implemented in Phase 6

## Decision

A deterministic, sticky-cohort rollout gate (`src/workoutLifecycle/rollout.ts`, `ensureWorkoutLifecycleV2` in `src/services/workoutLifecycle.ts`) is the only mechanism allowed to control *new* V1→V2 migrations. It is:

- **Deterministic per uid**: `stickyRolloutBucket` derives a stable 0-99 bucket from the existing `lifecycleStableHash`, so the same account never flips cohort when the percentage changes.
- **Structurally unable to un-migrate an account**: `ensureWorkoutLifecycleV2` checks `loadWorkoutLifecycle` before it ever reads the rollout config. An account with a valid V2 lifecycle returns `ALREADY_V2` immediately — the rollout percentage is never consulted for it. Lowering the percentage can only ever *shrink the set of new accounts admitted*, never move an existing one back.
- **Config-sourced, not code-sourced**: `workoutLifecycleRolloutConfig/active`, a single Firestore doc, Admin-SDK-write-only (same pattern as the existing `limitationDatasetState`). No new flag service was introduced for a single feature.
- **Fail-closed for new migrations only**: a missing/malformed config resolves to `{enabled: false, percentage: 0}` (`WORKOUT_LIFECYCLE_ROLLOUT_FAIL_SAFE_CONFIG`). This can never affect an existing V2 account for the same structural reason above.

The gate is fully implemented and tested but **not wired into `loadActiveWorkoutProgram`'s hot path**. The recommended posture is to ship at 100% (the unconditional path Phases 1-5 have always used, exercised by the full test suite on every run) and treat this gate as ready-to-wire infrastructure for an emergency "stop new enrollment" kill switch, not a staged percentage ramp.

## Rationale

This codebase has no V1-only execution/schedule/progression runtime — every consumer since Phase 1 treats `WorkoutProgramSnapshot.programInstanceId`/`trainingCycleId` as always-present once a program exists. Actually wiring a staged rollout below 100% would require either (a) building a second, parallel V1-only fallback stack across execution/schedule/progression — a competing architecture, explicitly forbidden by this project's standing rule to extend rather than redesign — or (b) accepting that a "not yet rolled out" account simply can't use the app's core loop, which is not a real rollout strategy. Given the migration path's existing test depth (8 dedicated integration tests plus implicit coverage from the entire Phase 1-5 suite), a staged ramp buys little safety relative to its cost.

## Consequences

- Production can ship Workout Lifecycle V2 at 100% today with the confidence the existing test suite already provides.
- If real-world telemetry (once wired past today's no-op logger) surfaces a migration failure pattern, the fastest safe mitigation is a code-level revert of the `loadActiveWorkoutProgram` call, not a flag flip — because the flag isn't live-wired.
- If the team later decides a genuine staged ramp is worth building a V1-only fallback stack for, this ADR's gate is the composition point to wire in; it does not need to be redesigned.
- Rollback (stopping the app's V2 path or reverting a deploy) must never delete or mutate an already-migrated account's `workoutLifecycleState`/`trainingCycles`/`programInstances`/`workoutLifecycleEvents`/`pendingEvolutions` — see architecture/13_OPERATIONS_RUNBOOK.md.
