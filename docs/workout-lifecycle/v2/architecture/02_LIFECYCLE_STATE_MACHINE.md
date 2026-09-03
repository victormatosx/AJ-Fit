# Lifecycle State Machine

**Implementation:** IMPLEMENTED for the service/state layer. UI presentation remains Phase 8D.

Conceptual states:

`PROGRAM_ACTIVE → ELIGIBILITY_PENDING → EVOLUTION_EARNED → [ACTIVATE | DEFER_1] → [ACTIVATE | DEFER_2] → AUTO_ACTIVATE`

Low adherence may follow:
`PROGRAM_ACTIVE → BELOW_TARGET → MOTIVATIONAL_RENEWAL_ELIGIBLE → RENEWED_PROGRAM_ACTIVE`.

Level transitions:
`BEGINNER → INTERMEDIATE` after earned Beginner completion; `INTERMEDIATE` increments earned-cycle credit until four cycles, then → `ADVANCED`; `ADVANCED` cycles indefinitely.

Inactivity pauses active-time accumulation but does not change career level/cycle. Program adaptation starts a new ProgramInstance while preserving career state.

## Persisted transition protocol (Phase 8B)

`EVOLUTION_EARNED`/`MOTIVATIONAL_RENEWAL_OFFERED` is the durable achievement
fact. `pendingEvolutions/current` is only the prepared prescription and may be
invalidated/recreated without erasing the fact. A pending is valid only while
its source ProgramInstance, TrainingCycle and authoritative input snapshot
still equal the active base. Reconciliation compare-deletes a stale pending,
re-prepares from the original earned fact and preserves `earnedAt`,
`deferralCount`, `nextPromptAt` and `autoActivateAt`.

Activation atomically supersedes the source, activates the deterministic
target, updates lifecycle/cycle pointers, appends the semantic activation
event and clears pending. Program Adaptation atomically activates a fresh safe
ProgramInstance and clears stale pending; reconciliation then regenerates the
earned target against the new safety inputs.
