# V1 → V2 Compatibility

**Implementation:** IMPLEMENTED for the live 100% V2 authority boundary. Rollout controls remain future operational work.

V1 already provides prescription snapshots, active pointer, schedule, executions, load history, Beginner adaptationStage and progression events. V2 should reuse proven infrastructure where semantics remain valid.

Migration must not reinterpret historical questionnaire `level` as mutable current level. Existing users need a deterministic bootstrap for `startingLevel`, `currentTrainingLevel`, cycle state and ProgramInstance identity.

The Phase 1 client lazily initializes a deterministic `V1_MIGRATION_BASELINE`
from the active V1 program and immutable questionnaire level. It records cycle
number 1 as a baseline—not an inferred historical count—and marks
`historyCompleteFrom`. Legacy execution/schedule records remain readable; new
records are scoped to `programInstanceId`. Rules and emulator coverage were
updated with the writers.

## Phase 8B authority and partial recovery

Both cold start and the post-workout orchestrator first run structural
recovery. If there is no V2 state, `loadActiveWorkoutProgram` may read the
legacy active pointer exactly once to create the deterministic baseline;
progression then continues only through V2. Once any valid V2 state exists,
the legacy mirror cannot overwrite it.

V1 normal rotation and Beginner Stage mutation are both denied by
`applyProgression` for V2 accounts. The old hook has no production caller and
is retained only as compatibility code; AppShell no longer imports it.

Partial recovery preserves V2 identities. Missing referenced cycle/instance
documents are rebuilt minimally from the existing V2 state and content;
missing state is rebuilt only when exactly one coherent active V2 pair proves
the pointers. Ambiguous/incoherent combinations return `UNRECOVERABLE` and do
not fall back to V1, erase V2 data, invent cycle ordinals or award history.
