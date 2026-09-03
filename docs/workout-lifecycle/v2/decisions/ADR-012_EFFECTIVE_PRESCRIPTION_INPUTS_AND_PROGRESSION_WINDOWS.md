# ADR-012 — Effective Prescription Inputs and Progression Windows

- Status: Accepted
- Date: 2026-08-29
- Scope: Workout Lifecycle V2 correctness remediation (Phase 8A)

## Context

The historical questionnaire was still being re-read by adaptation and future
evolution paths. That could silently discard a newly adapted limitation or
allow the historical experience answer to override an earned career level.
Program Adaptation also preserved the career cycle correctly but progression
gathering aggregated executions and active time across ProgramInstances,
allowing progress from the superseded prescription to leak into the new one.

## Decision

Each ProgramInstance embeds an immutable, versioned
`prescriptionInputSnapshot`. It contains only effective prescription inputs,
an explicit source, schema version and deterministic identity. A pending
evolution embeds its target snapshot. There is no mutable "current inputs"
document and no new collection.

The active ProgramInstance snapshot is authoritative for adaptation and future
evolution. `WorkoutLifecycle.currentTrainingLevel` overrides the snapshot's
historical level in memory. An adaptation merges its patch over those current
effective answers, activates a new ProgramInstance immediately, and never
updates the origin questionnaire or an older snapshot.

Progression-window inputs are scoped to the active ProgramInstance. Its
`activatedAt` is the active-time anchor; only its executions and matching
schedule-ledger opportunities feed adherence. The career TrainingCycle and
earned completion history remain independent and are not reset.

Earned Intermediate completion is persisted on the completed cycle through
`completionReason = EARNED_EVOLUTION`. Pre-8A successor inference is accepted
only when exact ordinal adjacency and an earned successor reason prove it.

## Compatibility

Pre-8A ProgramInstances without a snapshot remain readable through a
deterministic, read-only fallback to their historical questionnaire, with only
the authoritative career level overlaid. The fallback does not backfill or
rewrite history; the next real activation writes its own snapshot. No earned
history is synthesized for a lone legacy baseline.

## Consequences

- adapted safety inputs cannot revert during later adaptation/evolution;
- historical ProgramInstances retain their exact input identity;
- adaptation restarts progress without erasing career history;
- account deletion needs no new resource handler because snapshots are
  embedded in already-deleted ProgramInstance/pending documents;
- Firestore Rules must validate snapshot shape and prevent historical mutation.

