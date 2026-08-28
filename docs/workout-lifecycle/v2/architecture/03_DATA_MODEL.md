# Target Data Model

This document defines conceptual records, not final Firestore paths.

### TrainingCareer
`startingLevel`, `currentTrainingLevel`, `earnedIntermediateCycles`, `currentCycleNumber`, durable promotion timestamps.

### TrainingCycle
Stable lifecycle identity, level, ordinal, type (`EARNED`/other as appropriate), start/end/activation history and outcome.

### ProgramInstance
Unique lifecycle instance linked to prescribed content/template, questionnaire/input snapshot, activation period and cycle.

### CycleProgress
Active-time accounting, expected/valid sessions, adherence tier, eligibility and deferral state.

### DomainEvent
Stable id, type, occurredAt, user/cycle/program references, semantic payload, schema version.

Final persistence design must preserve V1 compatibility, Firestore Rules, migrations and deterministic/idempotent writes. Do not add fields until an implementation plan defines the migration.
