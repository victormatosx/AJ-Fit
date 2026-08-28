# XP Integration Contract

Workout Progression must not own XP balances or reward economics. It emits durable semantic events that a future global Gamification Engine can consume.

Candidate facts: `WORKOUT_COMPLETED`, `HIGH_ADHERENCE_CYCLE_COMPLETED`, `TRAINING_CYCLE_COMPLETED`, `TRAINING_LEVEL_PROMOTED`, `MOTIVATIONAL_RENEWAL_ACTIVATED`, `PROGRAM_ADAPTED`.

The Gamification domain may later map these to XP, badges, global AJ Fit level, ranking or challenges. Changing XP values must not require changing prescription/progression logic. Events should be idempotent and carry stable IDs to prevent duplicate rewards.
