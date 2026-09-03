# ADR-009 — Pending Evolution Representation and Deferral State Machine

**Status:** Accepted and implemented in Fase 4

## Context

Fase 4 needs to represent "earned but not yet active" durably (docs §9/§11)
and a bounded, deterministic deferral window (docs §25-30) without
depending on the app being open at any specific deadline.

## Decision

**Single fixed-id document.** `users/{uid}/pendingEvolutions/current`
(`src/workoutLifecycle/types.ts#PendingEvolution`). At most one pending
evolution can exist per user — guaranteed structurally by using one fixed
document id, not by an extra invariant check. It is deleted (not archived)
the instant activation completes; the durable audit trail lives in the
immutable `workoutLifecycleEvents` ledger, not in this operational doc.

**Content lives in the pending doc, not in `workoutPrograms` yet.** The
Fase 3 `FinalWorkoutPlan` is stored as-is inside `pendingEvolutions/current`
(`plan` field). `workoutPrograms/{contentIdentity}` — whose Rules require
`status == 'active'` on create — is only written at activation, by the
existing `saveAndActivateWorkoutProgram`. This avoids widening that
collection's Rules to support a "prepared" status and avoids a second,
competing content store.

**Deferral state machine — two persisted states, not a five-state enum.**
`status: 'READY' | 'DEFERRED'` plus `deferralCount: 0 | 1 | 2` plus
`nextPromptAt`/`autoActivateAt`. "Promptable again" after the first window
elapses is *derived* (`isPromptable`, `src/workoutLifecycle/deferral.ts`),
not a third persisted status — fewer states means fewer invalid
combinations are representable at all (docs §13).

```
deferralCount=0, status=READY           -> always promptable
  --defer-->
deferralCount=1, status=DEFERRED, nextPromptAt=+14d
  --time elapses--> promptable again (derived, not a status change)
  --defer-->
deferralCount=2, status=DEFERRED, autoActivateAt=+14d, nextPromptAt=null
  -> never promptable again; only auto-activation applies
  --activation--> document deleted
```

`DEFERRAL_CONFIG = { windowDays: 14, maxDeferrals: 2 }` — the only two
domain constants, never inlined elsewhere.

**Reconciliation, not a scheduler.** `reconcileWorkoutLifecycle` (docs
§30-32) is a plain read-then-maybe-write function, safe to call from any
trusted runtime entry (app start, readiness gate, post-workout). It never
depends on being invoked exactly at `autoActivateAt` — a check at
`now >= autoActivateAt` fires correctly whether `now` is one second or many
days past the deadline. No Cloud Scheduler/cron was introduced.

## Consequences

- `activatePendingEvolution` and `deferPendingEvolution` are the only
  writers of this document; both operate inside a Firestore transaction
  keyed off the single fixed id, so two concurrent calls trivially converge
  (Firestore's own transaction retry, plus this ADR's structural
  single-document guarantee).
- Crash recovery is simple: if `pendingEvolutions/current` is absent and no
  earned decision is pending, `reconcileWorkoutLifecycle` calls
  `prepareEvolution` again (idempotent). If it is present and the target
  Program Instance is already active, the document is stale-cleared.
