# Adherence

Adherence measures consistency against the user's own prescription.

- `COMPLETED`: counts as one valid prescribed session.
- `PARTIALLY_COMPLETED`: target rule is to count only when at least 70% of prescribed sets were completed.
- Below that threshold: retained in history but does not count toward progression.
- Extra workouts do not increase progression credit beyond prescribed opportunities.

Suggested reward tiers: `HIGH` ≥85%, `GOOD` 70–84%, `BELOW_TARGET` <70%. HIGH and GOOD both qualify for earned evolution when time gates are satisfied; HIGH may produce a richer achievement/XP event later.

The exact formula must handle schedule changes and avoid double-counting partial/completed records.
