# XP Integration Contract

**Status:** TARGET_SPEC
**Implementation:** NOT IMPLEMENTED — no XP engine, balance, or transaction exists anywhere in the codebase (confirmed by residual audit, Fase 5 report §30). The Fase 1 `workoutLifecycleEvents` ledger (`LEVEL_PROMOTED`, `EVOLUTION_ACTIVATED`, `MOTIVATIONAL_RENEWAL_ACTIVATED`, `PROGRAM_ADAPTED`) already provides the durable facts a future Gamification Engine would consume; Fase 5 reads them for UI only, never writes XP.

Workout Progression must not own XP balances or reward economics. It emits durable semantic events that a future global Gamification Engine can consume.

Candidate facts: `WORKOUT_COMPLETED`, `HIGH_ADHERENCE_CYCLE_COMPLETED`, `TRAINING_CYCLE_COMPLETED`, `TRAINING_LEVEL_PROMOTED`, `MOTIVATIONAL_RENEWAL_ACTIVATED`, `PROGRAM_ADAPTED`.

The Gamification domain may later map these to XP, badges, global AJ Fit level, ranking or challenges. Changing XP values must not require changing prescription/progression logic. Events should be idempotent and carry stable IDs to prevent duplicate rewards.
