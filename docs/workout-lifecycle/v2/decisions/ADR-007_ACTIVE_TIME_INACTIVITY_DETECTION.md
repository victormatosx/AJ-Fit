# ADR-007 — Active Time Inactivity Detection

**Status:** Accepted and implemented in Phase 2

## Context

`docs/workout-lifecycle/v2/progression/07_INACTIVITY_AND_PAUSES.md` and
ADR-002 deliberately leave the precise technical definition of "prolonged
inactivity" open, requiring only that: rest days prescribed by the schedule
are never mistaken for inactivity, a real gap freezes `ActiveTime`, and
returning resumes from the frozen point rather than resetting career
progress. The app has no canonical "last opened" or analytics signal to use
as source of truth — the only reliable, already-modeled signals are the
prescribed weekly cadence (`ScheduleConfig.trainingDays`) and recorded
`WorkoutExecution.scheduledLocalDate`s.

## Decision

Detect inactivity by counting **consecutive prescribed training opportunities
missed**, not consecutive calendar days and not any external engagement
signal.

Walking every calendar day of the current Training Cycle from its start to
"now":

- A day only increments `activeDays` while not paused.
- A prescribed day (per `trainingDays`) with no recorded execution increments
  a "consecutive missed opportunity" streak.
- Reaching `inactivityMissedOpportunityThreshold` (3, `progressionEngineV2/config.ts`)
  freezes `activeDays` and records `pausedAt`.
- A non-prescribed (rest) day never affects the streak.
- ANY recorded execution — prescribed day or not, any status — resets the
  streak and clears the pause; `activeDays` resumes counting from its frozen
  total, never resetting.

The threshold is expressed in opportunities, not wall-clock days, so a
2x/week and a 6x/week schedule are held to the same standard — "how many
expected sessions in a row were skipped" — rather than the same absolute gap.

## Rationale

- Rest days are definitionally excluded from the streak, so low-frequency
  schedules are never penalized (docs §22/§25).
- No dependency on analytics/presence data that the app doesn't have.
- Deterministic and replayable purely from `TrainingCycle.startedAt`,
  `ScheduleConfig.trainingDays`, and `WorkoutExecution.scheduledLocalDate` —
  the same three inputs already used for Session Qualification and Adherence.

## Consequences

- `computeActiveTime` (`src/progressionEngineV2/activeTime.ts`) is a pure
  function of these inputs; it is not persisted incrementally. Active Time is
  *derived*, not stored — there is no risk of a second, competing source of
  truth for it, and no cron job is needed to "count days."
- Expected sessions for Adherence are computed from `activeDays`, not raw
  calendar days, so a frozen window doesn't also inflate the expected-session
  denominator during a pause.
- The exact threshold (3 missed opportunities) is a domain constant and may
  be tuned without changing the algorithm's shape.
