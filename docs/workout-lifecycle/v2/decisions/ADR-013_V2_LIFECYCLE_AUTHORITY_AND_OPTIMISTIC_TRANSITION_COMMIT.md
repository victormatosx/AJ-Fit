# ADR-013 — V2 Lifecycle Authority and Optimistic Transition Commit

- Status: HISTORICAL; client-authority portions SUPERSEDED by ADR-015
- Date: 2026-08-29
- Scope: Workout Lifecycle V2 authority/concurrency remediation (Phase 8B)

## Context

> Phase 9 retains the concurrency and V2-only decisions in this ADR but
> supersedes its assumption that an authenticated client transaction can be
> semantic authority. Critical writes now require a backend-validated,
> short-lived capability bound and consumed under Firestore Rules.

The implemented V2 evaluator/orchestrator was not the real post-workout
authority. AppShell finished execution and schedule, then invoked the V1
progression hook; V2 preparation was reached primarily through a mounted UI
hook. V1 could still mutate Beginner stages. Preparation also computed a
target outside a transaction without binding publication to every
authoritative source identity, so adaptation could make a result stale.
Partial V2 persistence had no explicit minimal-repair policy.

## Decision

`processWorkoutLifecycleAfterSession` is the single operational post-workout
entry. It delegates to `reconcileWorkoutLifecycle`, also used by cold start.
Reconciliation ensures/bootstrap-recovers V2 before evaluation. A valid V2
account is exclusively V2-owned; V1 may supply legacy bootstrap input but its
mutation path is inert for that account, including Beginner stages.

An earned evolution is a durable event fact distinct from its prepared
prescription. The fact is persisted before expensive computation. Preparation
captures the expected source ProgramInstance, TrainingCycle and authoritative
`PrescriptionInputSnapshot.snapshotId`, computes outside Firestore, and uses a
transactional compare-and-set before publishing `pendingEvolutions/current`.
Logical transition, pending and target identities are deterministic.

Program Adaptation invalidates prepared content, not the earned fact. It
atomically activates a new safe instance and clears pending. Reconciliation
re-prepares the same earned transition from the new input snapshot while
preserving earned quality/timestamp and exact deferral timeline. Activation
revalidates the same expected base, so stale content cannot win against new
safety constraints.

Partial-state recovery is minimal and V2-first. Missing referents may be
reconstructed only from existing V2 state identities and current content; a
missing state pointer may be reconstructed only from exactly one coherent
active V2 cycle/instance pair. Ambiguous state fails explicitly without V1
rebootstrap, deletion or invented history.

## Compatibility

Pre-8B pending documents without `sourcePrescriptionInputSnapshotId` remain
readable. New writes always include it. A historical ProgramInstance without
an 8A snapshot uses `legacy:<programInstanceId>` as a deterministic comparison
identity until the next real activation writes a full snapshot. No destructive
backfill is required.

## Consequences

- workout and schedule facts remain durable if lifecycle follow-up fails;
- cold start/retry recovers earned-without-target and stale pending states;
- UI hooks observe/reconcile but are not the sole domain authority;
- Prepare/Prepare and activation races converge on one effective truth;
- new limitations always beat an old prepared prescription;
- no new collection or account-deletion handler is required;
- Firestore Rules validate new pending source-snapshot metadata;
- offline transactions remain unsupported: failure is safe and retryable on
  reconnect, not claimed as an offline activation guarantee.
