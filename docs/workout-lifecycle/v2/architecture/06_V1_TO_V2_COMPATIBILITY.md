# V1 → V2 Compatibility

V1 already provides prescription snapshots, active pointer, schedule, executions, load history, Beginner adaptationStage and progression events. V2 should reuse proven infrastructure where semantics remain valid.

Migration must not reinterpret historical questionnaire `level` as mutable current level. Existing users need a deterministic bootstrap for `startingLevel`, `currentTrainingLevel`, cycle state and ProgramInstance identity.

Firestore Rules currently restrict program keys; target fields cannot simply be written without coordinated types, Rules, writers and tests. Integration suites are opt-in in the audited repository, so migration validation must explicitly include emulator/integration coverage.
