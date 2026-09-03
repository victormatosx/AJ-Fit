# Progression Rules

**Status:** TARGET_SPEC
**Implementation:** PARTIAL — the eligibility decision (`evaluateProgressionV2`, see architecture/08_PHASE_2_IMPLEMENTATION.md) is implemented; activation/deferral states are not.

Progression evaluates **active time + prescribed adherence**, never elapsed calendar time alone and never extra workouts. Earned evolution requires both the minimum active-time gate and adherence gate. Evaluation should be deterministic, auditable and idempotent.

Target thresholds: Beginner ≈28 active days and ≥70%; Intermediate/Advanced earliest ≈85 active days and ≥70%. ≥85% is a higher consistency tier for achievements/rewards, not faster progression. Exact expected-session counts derive from the prescription rather than a fixed monthly number.

Outcomes: `NOT_ELIGIBLE`, `EARNED_CYCLE_EVOLUTION`, `EARNED_LEVEL_PROMOTION`, `MOTIVATIONAL_RENEWAL_ELIGIBLE`, and activation/deferral states. Extra sessions must not accelerate any gate.

Implemented today as the `ProgressionDecision` union: `PROGRESS_CONTINUES`, `EVOLUTION_ELIGIBLE`, `MOTIVATIONAL_RENEWAL_AVAILABLE`, `LEVEL_PROMOTION_ELIGIBLE`, `NO_ACTION` (blocked on an in-progress execution). Activation/deferral states belong to a future phase.
