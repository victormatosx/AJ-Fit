# Intermediate Cycles

**Status:** TARGET_SPEC
**Implementation:** IMPLEMENTED for eligibility, activation and exact earned-credit persistence (`countEarnedIntermediateCycles`, `TrainingCycle.completionReason`, architecture/08_PHASE_2_IMPLEMENTATION.md and Phase 8A report). UI scheduling remains outside this document.

Intermediate contains earned cycles. Each targets approximately three active months, with earliest normal eligibility around 85 active days plus ≥70% adherence. A cycle evolution remains Intermediate and should refresh the program conservatively.

Only **earned** Intermediate cycles increment promotion credit. Motivational renewals and user-requested adaptations do not. After four earned Intermediate cycles, the next earned transition is a Level Promotion to Advanced.

The credit is written on the cycle that actually completes as
`completionReason = EARNED_EVOLUTION`. Starting Intermediate C1 earns credit
#1 only when C1 completes. Beginner → Intermediate creates Intermediate C1
with zero pre-awarded credit. A legacy Intermediate baseline invents no
history; a pre-8A completed cycle is inferred only when its exact earned
successor proves that transition. Thus C4 eligibility is the fourth, not the
fifth, earned completion.
