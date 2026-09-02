# Milestones and Achievements

**Status:** TARGET_SPEC
**Implementation:** NOT IMPLEMENTED — no milestone/achievement persistence exists. `pending.quality` (`HIGH`/`GOOD`/`BELOW_TARGET`) is the only fact-based hook Fase 5 exposes (drives the unlock screen's visual tier); it is not stored as an "achievement." See architecture/11_PHASE_5_IMPLEMENTATION.md.

Potential workout-lifecycle milestones include first valid workout, high-adherence cycle, earned cycle completion, Beginner→Intermediate, Intermediate→Advanced, long-term cycle counts and return-to-training milestones.

Achievements describe facts; they do not own XP amounts. High adherence (target ≥85%) may emit a stronger achievement tier than normal qualifying adherence (70–84%). Low-adherence motivational renewal emits no earned-evolution achievement.
