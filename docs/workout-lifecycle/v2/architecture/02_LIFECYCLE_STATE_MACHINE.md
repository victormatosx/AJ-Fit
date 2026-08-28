# Lifecycle State Machine

Conceptual states:

`PROGRAM_ACTIVE → ELIGIBILITY_PENDING → EVOLUTION_EARNED → [ACTIVATE | DEFER_1] → [ACTIVATE | DEFER_2] → AUTO_ACTIVATE`

Low adherence may follow:
`PROGRAM_ACTIVE → BELOW_TARGET → MOTIVATIONAL_RENEWAL_ELIGIBLE → RENEWED_PROGRAM_ACTIVE`.

Level transitions:
`BEGINNER → INTERMEDIATE` after earned Beginner completion; `INTERMEDIATE` increments earned-cycle credit until four cycles, then → `ADVANCED`; `ADVANCED` cycles indefinitely.

Inactivity pauses active-time accumulation but does not change career level/cycle. Program adaptation starts a new ProgramInstance while preserving career state.
