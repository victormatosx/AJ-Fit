# Phase 4 Implementation — Lifecycle Real: Activation, Deferral, Adaptation

> **HISTORICAL:** this report records Phase 4. ADR-015 and Phase 9 supersede
> the early `currentTrainingLevel` mutation and owner-client authority shown
> below. Current runtime keeps lifecycle level coherent with the active cycle;
> earned state lives in immutable events/pending until activation.

**Status:** IMPLEMENTED for Phase 4 scope  
**Overall V2 Implementation:** PARTIAL

## What this phase answers

> How does an earned evolution become, safely and consistently, the user's
> next real training period?

## Orchestrator

`src/services/workoutLifecycleApplication.ts`:

```text
Workout Finish (Fase 1, unmodified)
        |
Progression V2 (Fase 2, unmodified, pure)
        |
prepareEvolution ---------- persists pendingEvolutions/current (READY)
        |                    + updates currentTrainingLevel (LEVEL_PROMOTION only)
        |                    + writes EVOLUTION_EARNED / MOTIVATIONAL_RENEWAL_OFFERED
Current Program Instance remains ACTIVE throughout
        |
deferPendingEvolution  (0->1->2 deferrals, ADR-009)
        |
activatePendingEvolution (MANUAL or AUTO via reconcile)
        |
saveAndActivateWorkoutProgram (Fase 1 primitive, extended)
   - writes workoutPrograms/{contentIdentity}
   - completes old TrainingCycle + starts new one (LEVEL_PROMOTION/CYCLE_EVOLUTION)
     or reuses the current cycle (MOTIVATIONAL_RENEWAL/PROGRAM_ADAPTATION)
   - flips workoutLifecycleState.activeProgramInstanceId
   - writes LEVEL_PROMOTED / EVOLUTION_ACTIVATED / MOTIVATIONAL_RENEWAL_ACTIVATED / PROGRAM_ADAPTED
   - atomically clears pendingEvolutions/current
        |
reconcileWorkoutLifecycle — safe to call from any trusted runtime entry;
  never depends on the app being open at a deadline (docs §30-32)
```

`prepareEvolution` and `evolvePrescription` (Fase 3) remain pure/impure-but-non-activating exactly as before — this phase adds ONE new impure orchestration layer on top, it does not modify either engine's decision logic.

## Source of truth

| Concept | Path | Notes |
|---|---|---|
| Active Program Instance | `workoutLifecycleState/current.activeProgramInstanceId` | unchanged from Fase 1 |
| Earned/career level | `workoutLifecycleState/current.currentTrainingLevel` | updated at EARN time for Level Promotion (ADR-010) |
| Active prescription level | `trainingCycles/{currentCycleId}.level` | only changes at activation |
| Current Training Cycle | `workoutLifecycleState/current.currentCycleId` | unchanged from Fase 1 |
| Pending evolution | `pendingEvolutions/current` | Fase 4, new — single fixed doc (ADR-009) |
| Deferral state | `pendingEvolutions/current.{status,deferralCount,nextPromptAt,autoActivateAt}` | ADR-009 |
| Lifecycle events | `workoutLifecycleEvents/{eventId}` | unchanged collection, no new event types needed |

## Pending Evolution

See ADR-009 for the full schema and state machine. Key primitives:
`src/workoutLifecycle/deferral.ts` (`isPromptable`, `canDefer`, `applyDefer`,
`isAutoActivationDue` — pure) and `src/workoutLifecycle/domain.ts`
(`evolutionIdempotencyKey`, `pendingEvolutionIdForOperation`,
`isPendingEvolution`).

## Earned vs. Active

See ADR-010. `currentTrainingLevel` is career/earned; the active cycle's
`level` is what's actually being trained. Beginner can earn Intermediate
while still training Beginner Program Instance A during a deferral window —
proven end-to-end in
`src/services/__tests__/workoutLifecycleApplication.integration.test.ts`.

## Activation

`saveAndActivateWorkoutProgram` (`src/services/workoutPrograms.ts`) gained
three additive, backward-compatible parameters:

- `nextCycle?: {level, cycleNumber, progressionReason}` — when present,
  completes the current `TrainingCycle` (`status: 'COMPLETED'`) and starts a
  new one; when absent, preserves the exact pre-Fase-4 behavior (same
  cycle, new Program Instance) — this is what Motivational Renewal and
  Program Adaptation both rely on to never fabricate a new cycle.
- `eventType?` / `eventPayload?` — the lifecycle event this activation
  writes; defaults to `PROGRAM_STARTED` (unchanged for every pre-Fase-4
  caller).
- `clearPendingEvolution?: boolean` — atomically deletes
  `pendingEvolutions/current` inside the SAME transaction as the
  content/instance/cycle/lifecycle writes, so a pending evolution's
  PREPARED state can never outlive its own activation (docs §11/§78).

No new write primitive was introduced for activation — Fase 1's
already-transactional, already-tested function does the whole thing
atomically.

## Motivational Renewal

`activatePendingEvolution` omits `nextCycle` for this type — same cycle,
new Program Instance, `MOTIVATIONAL_RENEWAL_ACTIVATED` event. Proven:
earned-cycle count/level/cycle number unchanged, no `LEVEL_PROMOTED` or
`CYCLE_COMPLETED`-adjacent artifact, fresh execution/schedule namespace
via the new `programInstanceId`.

## Program Adaptation

`adaptWorkoutProgram` (`src/services/workoutLifecycleApplication.ts`):
regenerates through the real prescription pipeline with updated inputs
(never `level`), activates through `saveAndActivateWorkoutProgram` with NO
`nextCycle` (same cycle preserved) and `source: 'program_adaptation'`.
Always synchronous/immediate — there is no deferral path in this function
at all, which is what makes a `LIMITATION` adaptation trivially "never
adiável" (docs §65/§66): the function has no notion of deferring in the
first place. Always clears any stale pending evolution (docs §72).
Idempotent via a caller-supplied `idempotencyKey`.

## Reconciliation

`reconcileWorkoutLifecycle(uid, now)`:
1. No lifecycle → no-op.
2. No pending evolution → attempt `prepareEvolution` (crash-before-prepare recovery, docs §76).
3. Pending exists and its target is already the active instance → clear the stale doc (crash-after-activation recovery, docs §77/§87). In practice this branch is close to unreachable given `clearPendingEvolution`'s atomicity, but is kept as a defensive backstop.
4. Pending exists and `autoActivateAt` has passed → activate.

## Firestore

New: `pendingEvolutions/current` collection (Rules: ownership, full schema
validation on create, narrow `affectedKeys` on update for defer-only,
owner-gated delete). `plan` is validated only as `is map` — the trusted
Prescription Evolution pipeline already validated its shape; it is
re-validated structurally again when it becomes the real
`workoutPrograms/{contentIdentity}` document at activation.

Widened enums (additive, backward compatible): `programInstances.activationReason`
(+`EVOLUTION_ACTIVATION`, +`PROGRAM_ADAPTATION`), `workoutPrograms.source`
(+`evolution_activation`, +`program_adaptation`) — both in Rules and in the
matching TS unions, plus the client-side `isProgramSnapshot`/`isProgramInstance`
validators (a real bug caught by the emulator-backed E2E tests: both
validators still had the OLD 4-value enum hardcoded and rejected the new
values until fixed).

No new indexes required (single-document reads/writes only).

## Account deletion

`deleteUserPendingEvolutions` added to `functions/src/accountDeletion/firestoreCleanup/{resources,engine}.ts`, proven cross-user in the real emulator (`engine.integration.test.ts`).

## Deliberately not implemented

Unlock/celebration UI, progress visualization, XP/ranking/badges/leaderboard,
push notifications for deferral prompts, the Program Adaptation questionnaire
UI, automatic load progression, RPE/RIR progression. Fase 3's two known
non-blocking limitations (controlled ordering, Intermediate→Advanced
template differentiation) were left untouched, as instructed.
