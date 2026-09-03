# ADR-010 — Earned/Career Level vs. Active Prescription Level

**Status:** SUPERSEDED by ADR-015 (historical Fase 4 decision)

> Current runtime: `currentTrainingLevel` remains the level of the active
> `TrainingCycle` until activation. Eligibility/earned state is represented by
> the immutable earned lifecycle event and `pendingEvolutions/current`, not by
> an early lifecycle-level mutation. This prevents an owner from creating an
> incoherent level/cycle pair. The text below records the historical decision
> and must not be used as the current implementation contract.

## Context

A user can earn Level Promotion while still training on the old level's
Program Instance during a deferral window (docs §19-22, §96). The model
must represent both facts without a new field or a second source of truth.

## Decision

**`workoutLifecycleState/current.currentTrainingLevel` is the EARNED/career
level** — updated the instant a `LEVEL_PROMOTION` pending evolution is
created (`prepareEvolution`, same transaction as the pending doc itself),
independent of activation.

**The ACTIVE prescription level is never stored as its own field** — it is
`TrainingCycle(currentCycleId).level`, which only changes at activation
(`activateProgramInstance`'s `nextCycle` path). During a deferral, this
still resolves to the OLD level, because `currentCycleId` itself only
changes at activation.

```
Beginner
  currentTrainingLevel = BEGINNER
  currentCycleId -> Cycle(level=BEGINNER)

promotion earned (pending READY/DEFERRED)
  currentTrainingLevel = INTERMEDIATE   <- updated now
  currentCycleId -> Cycle(level=BEGINNER)  <- unchanged until activation

activation
  currentTrainingLevel = INTERMEDIATE   (re-affirmed, idempotent)
  currentCycleId -> Cycle(level=INTERMEDIATE, cycleNumber=1)
```

**Program Adaptation and Motivational Renewal never touch `currentTrainingLevel`** — only a `LEVEL_PROMOTION` pending evolution's creation does.

## Rationale

Adding a second field (e.g. `activePrescriptionLevel`) would create two
mutable places that could disagree. Deriving the active level from the
already-existing `currentCycleId -> TrainingCycle.level` relationship reuses
Fase 1's model exactly and cannot drift — the cycle pointer is the single
lever that also drives Program Instance/Schedule/Execution namespacing.

## Consequences

- Every reader that needs "what level is the user actually training under
  right now" must resolve it via the current cycle, not via
  `currentTrainingLevel` — documented explicitly in
  `architecture/10_PHASE_4_IMPLEMENTATION.md`.
- `lifecycleAt(uid, instant)` (Fase 1) continues to answer "what was
  active then"; a caller wanting "what was EARNED by then" must separately
  read the `workoutLifecycleEvents` ledger's `EVOLUTION_EARNED`/
  `LEVEL_PROMOTED` entries up to that instant — these are two different
  historical questions (docs §97) and the model does not conflate them.

## Adaptation vs. pending evolution precedence

A stale pending evolution (prepared against constraints that a Program
Adaptation has since changed) is always invalidated: `adaptWorkoutProgram`
unconditionally clears `pendingEvolutions/current` as part of its own
activation transaction. `activatePendingEvolution` additionally guards
against activating a pending whose `sourceProgramInstanceId` no longer
matches the currently active instance (`STALE_PENDING`), so even a pending
doc that somehow survives an adaptation can never be blindly activated. The
EARNED fact itself is never lost: for a Level Promotion it survives in
`currentTrainingLevel`; for any type it survives in the immutable
`EVOLUTION_EARNED`/`MOTIVATIONAL_RENEWAL_OFFERED` ledger event (docs
§72/§73/§108).
