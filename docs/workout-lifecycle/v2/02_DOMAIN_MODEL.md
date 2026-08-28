# Domain Model

**Status:** TARGET_SPEC  
**Implementation:** NOT_IMPLEMENTED

## Canonical concepts

### StartingLevel
Immutable historical level at the beginning of the AJ Fit journey. Preserves where the user started.

### CurrentTrainingLevel
Current prescription tier: `BEGINNER`, `INTERMEDIATE`, `ADVANCED`. Unlike the original questionnaire answer, this can change through earned level promotion.

### TrainingCycle
A lifecycle unit inside a training level. Intermediate earned cycles contribute toward promotion; Advanced cycles are unbounded.

### ProgramInstance
A concrete prescribed program active for a lifecycle period. It must be conceptually distinct from reusable/deterministic program content identity.

### CycleProgress
Progress toward eligibility: active time, expected sessions, valid completed sessions, adherence and deferral state.

### ActiveTime
Time that counts toward the current program lifecycle. Prolonged inactivity pauses it. Rest days are not inactivity.

### ValidSession
A `COMPLETED` session, or a `PARTIALLY_COMPLETED` session meeting the agreed completion threshold. Target threshold: at least 70% of prescribed sets completed.

### Adherence
Valid prescribed sessions completed divided by expected prescribed sessions for the counted active period. Extra sessions do not improve the numerator beyond prescribed opportunity.

### EarnedEvolution
Eligibility reached through active time and adherence. Can produce Cycle Evolution or Level Promotion.

### MotivationalRenewal
Program refresh after prolonged low adherence. Does not increment earned-cycle credit and should not award evolution achievement semantics.

### LevelPromotion
`BEGINNER→INTERMEDIATE` or `INTERMEDIATE→ADVANCED`. Intermediate→Advanced requires four earned Intermediate cycles.

### ProgramAdaptation
Future user-requested re-prescription due to availability, goal, environment, limitation or preference changes. Career progress remains; the current program period restarts.

### Achievement / Reward
Domain event consumers may celebrate progression. XP amount is intentionally outside this domain.
