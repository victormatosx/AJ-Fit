# Adherence

**Status:** TARGET_SPEC
**Implementation:** IMPLEMENTED for the calculation and quality classification (`src/progressionEngineV2/adherence.ts`, `sessionQualification.ts`). Consuming `HIGH` for an achievement/XP event remains future work outside the Workout Lifecycle boundary (ADR-005).

Adherence measures consistency against the user's own prescription.

- `COMPLETED`: counts as one valid prescribed session.
- `PARTIALLY_COMPLETED`: target rule is to count only when at least 70% of prescribed sets were completed.
- Below that threshold: retained in history but does not count toward progression.
- Extra workouts do not increase progression credit beyond prescribed opportunities.

Suggested reward tiers: `HIGH` ≥85%, `GOOD` 70–84%, `BELOW_TARGET` <70%. HIGH and GOOD both qualify for earned evolution when time gates are satisfied; HIGH may produce a richer achievement/XP event later.

The exact formula must handle schedule changes and avoid double-counting partial/completed records.

## Phase 8A operational definition

The numerator is the count of fulfilled prescribed opportunities, not the
count of otherwise-valid executions. A credit exists only when a qualifying
execution and a `COMPLETED` schedule-ledger event match on active
`programInstanceId + scheduled local date + session index`. Both sides are
deduplicated by that key, so one opportunity contributes at most one credit
and an extra workout remains historical without inflating adherence.

The 70% and 85% decisions use exact mathematical comparisons. Display
rounding is presentation-only and never feeds eligibility or quality.
