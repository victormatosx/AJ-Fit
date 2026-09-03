# Volume Invariants

**Status:** TARGET_SPEC
**Implementation:** IMPLEMENTED (stronger than "approximately") — Cycle Evolution never modifies `sets/reps/duration/cycles/intensity/restSeconds`, only `exerciseId`; volume is exactly preserved, not just within a tolerance band (ADR-008).

Same-level cycle evolution should keep total prescribed workload approximately equivalent. Small changes in set distribution are allowed when technically coherent, but there must be no abrupt volume increase/decrease solely to signal progress.

Level Promotion may legitimately change volume according to the promoted level's prescription rules. Same-level novelty must never become an uncontrolled progressive-overload algorithm.
