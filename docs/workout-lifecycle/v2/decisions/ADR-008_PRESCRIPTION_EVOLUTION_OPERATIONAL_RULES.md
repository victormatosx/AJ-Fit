# ADR-008 — Prescription Evolution Operational Rules

**Status:** Accepted and implemented in Fase 3

## Context

`docs/workout-lifecycle/v2/prescription/02_CYCLE_ROTATION.md` through
`05_VOLUME_INVARIANTS.md` set qualitative targets — "approximately 20–30%
renewal", "avoid immediately cycling back", "approximately equivalent
volume", "controlled ordering" — without pinning exact numbers or an
algorithm. Fase 3 must resolve these operationally, the same way ADR-007
resolved Active Time's "prolonged inactivity."

## Decisions

**Movement anchors.** The first exercise of every session is a hard anchor
and is never eligible for substitution (`src/prescriptionEvolution/cycleEvolution.ts`).
Every other slot is eligible. This is the smallest rule that guarantees a
session's priority movement never disappears (docs §37/§38/§43) without
needing a new `movementAnchor` field on the exercise schema.

**Novelty target.** `changedSlots / eligibleSlots`, target ratio 0.25 (the
midpoint of 20–30%), `targetChanges = clamp(round(eligibleSlots * 0.25), 1, eligibleSlots)`
when `eligibleSlots > 0`. Small sessions round sensibly (e.g. 2 eligible
slots → 1 changed) rather than forcing a fractional exercise.

**Selection order.** Eligible slots are processed in an order determined by
a stable hash of `slotKey:targetCycleIdentity`, stopping once the target
count is reached. This makes slot selection itself vary by target cycle
while staying exactly reproducible for the same cycle.

**Duplicate prevention scope.** Checked per session, not plan-wide. Real
multi-session splits legitimately reuse the same exercise across different
sessions (squats on both Lower A and Lower B); only a duplicate within the
same session is rejected (docs §89 — "já existe na sessão").

**Anti-ping-pong.** Window = 2 prior prescriptions. A candidate seen in the
same slot within that window is penalized (ranked after non-recent
candidates) but never hard-excluded — if it is the only safe/equivalent
option, it is still chosen (docs §36).

**Ranking priority (safety and equivalence already resolved before this
runs):** declared `similarExerciseIds` match, then not-recently-used, then
closest `difficulty`; ties break on a stable hash salted by
`targetCycleIdentity:slotKey`, then `localeCompare(exerciseId)`.

**Volume.** Cycle Evolution never touches `sets/reps/duration/cycles/
intensity/restSeconds` — only `exerciseId`/`sourceExerciseId` can change.
Volume is therefore not "approximately" preserved, it is exactly preserved,
which trivially satisfies the docs' tolerance requirement without needing a
tunable percentage band.

**Ordering.** Fase 3 does not implement any exercise reordering. The docs'
ordering invariants (no shuffle, preserve blocks/anchors) are satisfied
vacuously by never reordering at all. This is a deliberate scope
narrowing, not a bug — see `architecture/09_PHASE_3_IMPLEMENTATION.md`.

**Motivational Renewal.** `progression/08_MOTIVATIONAL_RENEWAL.md` says a
renewal "may use the same controlled 20–30% rotation rules" without
assigning prescription generation to a specific phase. Fase 3 treats
`MOTIVATIONAL_RENEWAL` as the exact same transformer as `CYCLE_EVOLUTION`
under a different mode tag — mechanically identical, documented as a
judgment call rather than silently assumed.

## Consequences

- These constants (`src/prescriptionEvolution/config.ts`) are tunable
  without changing the algorithm's shape.
- Intermediate → Advanced Level Promotion is honestly limited by the
  current template catalog: `selectTemplate`/`prescribeTrainingFrequency`
  have no level-specific branch beyond the 6–7-day-availability frequency
  bump (which Level Promotion pins away) and Beginner's `adaptationStage`
  caps. At the same frequency, an Advanced re-prescription can select the
  literal same template/content as the prior Intermediate one. This is
  classified `BLOCKED_BY_DATASET` in `09_PHASE_3_IMPLEMENTATION.md`, not
  silently hidden — the lifecycle metadata transition (level, cycle,
  ProgramInstance) is still fully correct; only structural content
  differentiation is limited by the catalog today.
