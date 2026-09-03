# Fase 8B — Lifecycle Authority & Concurrency — Relatório Final

> **HISTORICAL:** this report accurately records Phase 8B. Its client-side
> authority model was superseded by Phase 9 and ADR-015. The concurrency,
> V2-only hot-path and earned/pending preservation decisions remain applicable.

Date: 2026-08-29

## 1. Git

- Branch: `main`.
- Frozen HEAD: `d24319ba15e63095fd376bcd99acd30f4abce343` (`d24319b .`).
- Initial status: dirty worktree inherited from Fases 7/8A, 103 entries
  (65 tracked changes and 38 untracked paths).
- Final status: dirty worktree deliberately preserved, 105 entries after the
  two new Phase 8B documents (65 tracked and 40 untracked).
- No reset, stash, clean, checkout, rebase, merge, commit or push was run.

The required Expo document was verified before code changes at
`https://docs.expo.dev/versions/v56.0.0/` (version 56, updated 2026-07-29).

## 2. Fase 7 Findings Reproduced

| Finding | Reproduced | Evidence | Root cause |
|---|---|---|---|
| Real finish used V1 | yes | pre-fix call graph ended in `useWorkoutProgression.checkAndApply` | AppShell wired the older hook after schedule completion |
| V2 depended on UI mount | yes | only `useWorkoutEvolution` invoked reconciliation | service existed without operational hot-path ownership |
| V1 Beginner mutation survived V2 | yes | `applyProgression` gated normal rotation but exempted Stage 1→2→3 | historical dual-authority exception |
| Stale prepare/adaptation | yes by code trace and regression fixture | prepare computed outside transaction without all source identities | earned fact and prepared prescription were coupled |
| Partial migration unproved | yes | missing referents threw one generic error | no classifier/minimal repair policy |

The post-fix real-flow test starts with execution persistence, schedule
completion and the real orchestrator, creates a V2 Level Promotion pending and
asserts zero V1 `progressionEvents`, without mounting Progress/Evolution UI.

## 3. Hot Path Before

`WorkoutScreen → AppShell.onSessionCompleted → completeWorkoutSessionFlow →
execution.finish → schedule.completeSession →
useWorkoutProgression.checkAndApply(programId) → V1 applyProgression → V1
program generation`. V2 was reached laterally by `useWorkoutEvolution` mount.

## 4. Hot Path After

`WorkoutScreen → AppShell.onSessionCompleted → completeWorkoutSessionFlow →
execution.finish → schedule.completeSession →
processWorkoutLifecycleAfterSession(uid) → reconcileWorkoutLifecycle →
ensure/recover V2 → evaluate Progression V2 → persist earned fact → compute
prescription → CAS pending/activation`.

`completeWorkoutSessionFlow` returns `LIFECYCLE_FOLLOW_UP_FAILED` if the last
step fails; the terminal execution and completed schedule remain durable.

## 5. Progression Entry Point Audit

| Entry point | Caller | Engine | Writes | Production reachable | Authority |
|---|---|---:|---:|---:|---|
| `processWorkoutLifecycleAfterSession` | AppShell finish | V2 | yes, via reconcile | yes | sole post-workout authority |
| `reconcileWorkoutLifecycle` | post-workout, cold-start hook, adaptation follow-up | V2 | yes | yes | lifecycle recovery authority |
| `prepareEvolution` | reconcile | V2 | earned + pending | yes, internal | V2 transition authority |
| `activatePendingEvolution` | Evolution UI/reconcile | V2 | atomic activation | yes | V2 command |
| `deferPendingEvolution` | Evolution UI | V2 | pending + event | yes | V2 command |
| `adaptWorkoutProgram` | adaptation UI/service | V2 | atomic safe instance | yes | V2 command |
| `evaluateProgressionV2ForUser` | prepare + observer | V2 | no | yes | read-only decision |
| `useWorkoutEvolution` | AppShell | V2 | calls reconcile/commands | yes | observer/gateway, not sole authority |
| `evaluateActiveProgression` | old hook | V1 | no | no live caller | compatibility read |
| `applyProgression` | old hook | V1 | gated | no live caller | never authority for V2 |
| `useWorkoutProgression` | none | V1 | would call gated apply | no | retained compatibility code |
| `generateAndPersistWorkoutProgram` | onboarding/readiness/manual and gated V1 apply | shared | yes | yes | content writer, not progression decider |
| `activateProgramInstance` | tests/low-level API | V2 primitive | yes | no production caller | transaction primitive |

## 6. V1 Authority Before

V1 could perform normal rotation and generate/activate a prescription from the
real finish callback. Once V2 existed it blocked normal rotation, but still
allowed Beginner Stage transitions, leaving two engines capable of changing
the active program.

## 7. V1 Authority After

AppShell removed `useWorkoutProgression` and its feedback modal. For a valid V2
lifecycle, `applyProgression` rejects both normal rotation and every Beginner
stage transition with `V2_LIFECYCLE_OWNS_ELIGIBILITY`. The old evaluator/hook
remain read-only/unreachable compatibility code. Legacy state may initialize
V2 but cannot apply progression after convergence.

## 8. V2 Source of Truth

| Concept | Source of truth | Authoritative writer |
|---|---|---|
| career level/current pointers | `workoutLifecycleState/current` | V2 activation/earned transactions |
| cycle history | `trainingCycles/*` | V2 lifecycle transactions |
| active prescription interval | `programInstances/*` | `saveAndActivateWorkoutProgram`/bootstrap |
| effective inputs | active ProgramInstance snapshot | 8A generation/adaptation/activation |
| earned achievement | append-only lifecycle event | `persistEarnedFact` |
| prepared target/deferral | `pendingEvolutions/current` | prepare/defer/reconcile |
| content | `workoutPrograms/*` | shared deterministic program writer |
| legacy active pointer | compatibility mirror only | shared writer, never V2 input after convergence |

## 9. Post-Workout Orchestrator

`processWorkoutLifecycleAfterSession` is the explicit operational API. It
ensures/bootstrap-recovers V2, reconciles structural/pending state, evaluates
only when no pending exists, durably persists the earned fact, prepares the
target and activates an expired valid pending. Every sub-operation is
idempotent. Its failure is surfaced to AppShell but cannot unfinish the
workout; later cold-start/post-workout reconciliation retries it.

## 10. Reconciliation

It runs after workout completion, once per Evolution hook mount (cold start),
and after adaptation. Repeated calls repair missing V2 referents, bootstrap a
legacy-only baseline, recover earned-without-target, clear/reprepare stale
pending, clean an already-activated leftover pending and perform due automatic
activation. Three concurrent/repeated recovery calls produced one pending and
one earned event.

## 11. Cold Start

`useWorkoutEvolution` calls reconciliation with trigger `COLD_START`. A
legacy-only account is first loaded through the sole compatibility boundary,
creating the deterministic V2 baseline. Partial state is minimally repaired;
late deadlines activate; stale deadlines reprepare before activation. UI then
reads the resulting decision/pending and never needs to be present for earning.

## 12. Legacy Bootstrap

V1 active content plus immutable questionnaire level initializes one
`V1_MIGRATION_BASELINE` cycle and ProgramInstance with deterministic IDs and
`historyCompleteFrom`. Cycle number is always 1; prior history and earned
credit are not inferred. Concurrent cold/post-workout calls converge on the
same baseline. A later real qualifying finish creates only V2 pending state.

## 13. Partial Migration

| Partial State | Recoverable? | Recovery | History Invented? |
|---|---:|---|---:|
| no V2 docs + valid legacy active | yes | deterministic legacy baseline | no |
| state; baseline cycle + instance missing | yes if referenced content/questionnaire prove identity | recreate only both baseline referents | no |
| state; evolved/adapted referents missing | no | explicit `UNRECOVERABLE`; questionnaire fallback forbidden | no |
| state + baseline cycle; instance missing | yes | recreate referenced baseline instance | no |
| state + evolved/adapted cycle; instance missing | no | explicit `UNRECOVERABLE`; preserve 8A limitations | no |
| state + instance; cycle missing | yes | recreate referenced cycle | no |
| state missing; exactly one coherent active V2 pair | yes | recreate state pointer; derive starting/history boundary from earliest persisted cycle | no |
| cycle only; state and instance missing | no | explicit `UNRECOVERABLE` | no |
| instance only; state and cycle missing | no | explicit `UNRECOVERABLE` | no |
| multiple/incoherent active pairs | no | explicit `UNRECOVERABLE` | no |
| complete V2 + stale legacy mirror | yes/no-op | V2 wins; mirror ignored | no |

## 14. Migration Convergence

Sequential, retried and two-device bootstrap use deterministic
`v1-baseline:<contentIdentity>` IDs and a state transaction. Partial recovery
re-reads state/referents inside the transaction and only creates documents
still absent. Emulator coverage proves Migration/Migration and simultaneous
cold/post-workout bootstrap result in one cycle, one instance and one pointer.

## 15. Pending Evolution State Machine

The one fixed document is either `READY, deferCount=0` or `DEFERRED` with count
1/2 and coherent prompt/auto deadlines. There is no persisted target instance
before activation. Start atomically removes pending. Adaptation atomically
removes stale pending and then recreates it from the durable earned fact.

## 16. Prepare Protocol

`load pending/earned → capture active instance+cycle+snapshot → compute
prescription outside transaction → transaction reads pending/state/source →
compare expected base → publish one deterministic pending`. Compute never runs
inside a Firestore transaction and no orphan ProgramInstance is created.

## 17. Stale Detection

Prepare and activation compare `sourceProgramInstanceId`, `sourceCycleId` and
`sourcePrescriptionInputSnapshotId`. Missing historical snapshots use
`legacy:<programInstanceId>`. Stale pending is compare-and-deleted only if its
exact `pendingEvolutionId` is still current; a concurrent newer pending cannot
be erased.

## 18. Prepare/Prepare Race

Two real emulator callers at the same threshold produced one
`EVOLUTION_EARNED`, one fixed pending, one deterministic target identity and
no prematurely persisted target instance. Both calls converged as PREPARED or
ALREADY_PENDING.

## 19. Adaptation vs Pending

Adaptation activates the new operational/safety prescription immediately and
clears the old prepared target. The original earned event, career level,
quality and timestamp remain. Reconciliation prepares a replacement target
from the newly active snapshot.

## 20. Adaptation/Prepare Race

Real concurrent limitation adaptation and prepare both settle without an
uncategorized error. Reconciliation leaves pending sourced from the final
active instance; its target snapshot contains `limits: ['knee']`; exactly one
earned event exists.

## 21. Adaptation/Activation Race

Concurrent Start and knee-limitation adaptation leave exactly one active
ProgramInstance. Start returns ACTIVATED or typed STALE_PENDING; adaptation
returns SUCCESS. If Start lands first, adaptation safely layers the new
constraint afterward. If adaptation lands first, stale activation fails CAS.

## 22. Safety Priority

The race uses the real 116-exercise catalog and canonical limitation profiles.
The final active ProgramInstance input snapshot always contains the new knee
limitation. Old pending content cannot remain the final active prescription.

## 23. Earned Fact Preservation

Level Promotion updates earned career level and writes the earned event before
prescription compute. After adaptation, the replacement pending retains the
same earned idempotency key, quality and exact `earnedAt`; the user never has
to earn the promotion again. Cycle Evolution uses the same fact/target split.

## 24. Deferral Preservation

Deferral events now store exact prompt/auto deadline milliseconds. Reprepare
reconstructs count and deadlines from those deterministic events (with a
backward-compatible occurredAt fallback). The adaptation-during-first-defer
test proves count remains 1, `nextPromptAt` is bit-for-bit unchanged and no
new auto deadline is invented.

## 25. Start/Start

Two emulator Start commands return the same deterministic activated
ProgramInstance. There are two total instances/cycles for the promotion, one
active instance, one `LEVEL_PROMOTED` event and no pending document.

## 26. Start/Defer

The activation wins or observes the single legal defer; final pending is
absent, exactly one target is active, and at most one defer event exists. The
invalid combination “target active and pending deferred” is impossible.

## 27. Defer/Defer

Two emulator calls consume exactly one defer. Final count is 1 and the ledger
contains exactly one deterministic `EVOLUTION_DEFERRED` event.

## 28. Manual/Auto

At the deadline, concurrent manual and automatic activation converge on the
same target instance. One promotion event exists; pending is absent; exactly
one instance is active.

## 29. Auto/Auto

Two concurrent cold-start reconciliations after the deadline yield one
activation event, one active target and no pending. At least one caller reports
the activation; the other safely observes/converges.

## 30. Double Finish

Phase 1 finish/execution integration remains green. The same execution finish
is terminal/idempotent, schedule event identity prevents a second completion,
and progression opportunity keys deduplicate the session. The aggregate
emulator suite includes this regression and produced one effective fact.

## 31. Simultaneous Progression

Two callers evaluating the exact qualifying threshold share deterministic
earned/target identities. Firestore contains one earned fact and one pending;
workouts during an existing pending short-circuit preparation and cannot stack
a second transition.

## 32. Crash Recovery

| Boundary | Result |
|---|---|
| earned committed; target absent | emulator deletes only pending fixture; three reconciles restore one pending and retain one earned event |
| prepared target; pointer incomplete | not a persistable boundary: prepare publishes one self-contained fixed pending and persists no target instance |
| activation committed; response lost | repeating Start converges to the same active deterministic instance/event |
| adaptation committed; cleanup response lost | pending deletion is in the adaptation activation transaction; reconcile additionally detects/reprepares stale state |

## 33. Event Cardinality

| Race | Earned | Defer | Activation/Promotion | Adapted |
|---|---:|---:|---:|---:|
| Prepare/Prepare | 1 | 0 | 0 | 0 |
| Defer/Defer | 1 | 1 | 0 | 0 |
| Start/Defer | 1 | ≤1 | 1 | 0 |
| Start/Start | 1 | 0 | 1 | 0 |
| Manual/Auto | 1 | 2 | 1 | 0 |
| Auto/Auto | 1 | 2 | 1 | 0 |
| Adaptation/Prepare | 1 | 0 | 0 | 1 |
| Adaptation/Activation | 1 | 0 | ≤1 | 1 |

There is intentionally no persisted `EVOLUTION_PREPARED` domain event; one
fixed pending document is the prepared-state truth. `evolution_prepared` is
operational telemetry only.

## 34. ProgramInstance Integrity

Activation supersedes source, creates/activates target and updates the pointer
in one transaction. Every concurrency assertion counts active instances;
Prepare never persists a target instance; Adaptation/Activation ends with one
unsuperseded instance whose ID matches the lifecycle pointer.

## 35. Schedule/Execution Namespace

Pending content has no active ProgramInstance and receives no schedule events
or executions. While pending, all records use source A. Activation gives B its
ProgramInstance ID atomically; the first subsequent execution/schedule event
uses B. Existing namespace-switch/late-record regressions passed in the
aggregate integration run.

## 36. History Reconstruction

Activation intervals and cycles are append-oriented. The complex
Adaptation/Activation race asserts `lifecycleAt(beforeRace)` resolves the
original source and `lifecycleAt(afterRace)` resolves the single final safe
instance. Normal earned/deferred/activated history still reconstructs the
completed Beginner cycle and active Intermediate cycle without rewriting old
timestamps.

## 37. Offline/Retry Semantics

Firestore transactions require connectivity; prepare/activation/migration are
not claimed to work offline. If execution/schedule persistence succeeds but
the lifecycle transaction cannot run, the UI receives
`LIFECYCLE_FOLLOW_UP_FAILED`; workout facts remain durable and cold start or a
later finish retries reconciliation. Offline activation fails safely: source
remains active and pending remains recoverable. Unknown-result retries use
deterministic IDs and state convergence checks.

## 38. Firestore Schema Changes

Before 8B, pending linked source instance/cycle but not the 8A input snapshot.
After 8B, new pending writes also contain
`sourcePrescriptionInputSnapshotId`. Existing readers accept absence and use
instance/cycle validation; new legacy-snapshot writes use the deterministic
sentinel. Deferral event payloads add optional deadline millisecond values.
No new collection, index or destructive backfill exists.

## 39. Rules Changes

Pending create Rules require/validate the source snapshot identity against the
current ProgramInstance (or exact legacy sentinel), accept only coherent
READY/DEFERRED timeline shapes and allow the preserved historical `earnedAt`.
Readers/writers/types were updated together. Firestore Rules result: 15 files,
343/343 tests passed.

## 40. Account Deletion

The new source identity is embedded in the already-covered pending document;
deferral metadata is embedded in the already-covered event. No cleanup path
was added. Functions unit tests passed and the real Firestore cleanup emulator
passed 2/2 with lifecycle collections included.

## 41. Files Changed

Phase 8B core: `src/screens/AppShell.tsx`,
`src/workoutLifecycle/{finishFlow,types,domain,telemetry}.ts`,
`src/workoutEvolution/useWorkoutEvolution.ts`,
`src/services/{workoutLifecycleApplication,workoutLifecycle,workoutPrograms,workoutProgression}.ts`,
their lifecycle/progression/concurrency integration tests,
`firestore.rules`, `firestore-tests/workoutLifecycle.rules.test.ts`,
architecture docs 01–06, ADR-013 and this report. All earlier dirty files were
preserved.

## 42. Regression Tests Added

- real finish→schedule→V2 hot path without UI/V1;
- legacy cold-start/post-workout migration race followed by real V2 finish;
- durable workout despite lifecycle follow-up failure;
- V1 Beginner/normal-rotation mutation denial;
- earned-without-target crash recovery with three reconciles;
- partial migration recovery matrix, historical-boundary preservation and ambiguous failure;
- safe failure when an adapted/evolved ProgramInstance is missing;
- Prepare/Prepare + simultaneous progression;
- Auto/Auto;
- Adaptation/Prepare with real knee safety input;
- Adaptation/Activation with real knee safety input and historical lookup;
- exact deferral timeline preservation across reprepare;
- event cardinality assertions for all critical races.

## 43. Test Matrix

| Suite | Result | Passed | Failed | Skipped | Environment |
|---|---|---:|---:|---:|---|
| App typecheck | PASS | n/a | 0 | 0 | TypeScript |
| App unit | PASS | 3,940 | 0 | 98 | Vitest; 244 pass/14 opt-in files skipped |
| Aggregate app integration | PASS | 678 | 0 | 0 | Firestore Emulator, 50 files |
| Lifecycle Application isolated | PASS | 14 | 0 | 0 | Firestore Emulator |
| Lifecycle concurrency isolated | PASS | 7 | 0 | 0 | Firestore Emulator |
| V1 progression authority | PASS | 8 | 0 | 0 | Firestore Emulator |
| Lifecycle/partial migration isolated | PASS | 14 | 0 | 0 | Firestore Emulator |
| Firestore Rules | PASS | 343 | 0 | 0 | Firestore Emulator, 15 files |
| Firestore cleanup | PASS | 2 | 0 | 0 | Firestore Emulator |
| Functions typecheck/build | PASS | n/a | 0 | 0 | TypeScript |
| Functions unit | PASS | 1,173 | 0 | 39 | Vitest; 81 pass/10 opt-in files skipped |

Java 21.0.12 and Firebase CLI 15.26.0 were explicitly recorded. The default
shell Java 17 was not used for emulator commands. The aggregate integration
run completed without timeout; no isolated retry was needed for an assertion.

## 44. Emulator Concurrency Matrix

| Race | Calls | Final State | Events | Status |
|---|---:|---|---:|---|
| Prepare/Prepare | 2 | one pending, source active | earned 1 | PASS |
| Start/Start | 2 | one active target | promotion 1 | PASS |
| Start/Defer | 2 | active target, no pending | promotion 1, defer ≤1 | PASS |
| Defer/Defer | 2 | count 1 | defer 1 | PASS |
| Manual/Auto | 2 | one active target | promotion 1 | PASS |
| Auto/Auto | 2 | one active target | promotion 1 | PASS |
| Adaptation/Prepare | 2 + reconcile | new safe source + regenerated pending | earned 1, adapted 1 | PASS |
| Adaptation/Activation | 2 | one knee-safe active | adapted 1, promotion ≤1 | PASS |
| Migration/Migration | 2 | one baseline pair | no invented event | PASS |
| Migration/post-workout | 2 | one V2 baseline, later V2 pending | earned 1 after qualifying finish | PASS |
| Simultaneous progression | 2 | one pending | earned 1 | PASS |

## 45. 8A Regression Matrix

| 8A invariant | Result |
|---|---|
| authoritative ProgramInstance snapshots | PASS |
| limitations persist through adaptation/evolution | PASS |
| adaptation progression window resets | PASS |
| prescribed-opportunity adherence excludes extras/duplicates | PASS |
| Intermediate→Advanced at exactly four earned cycles | PASS |
| exact 70%/85% mathematical boundaries | PASS |
| role/session-aware exercise equivalence | PASS |
| frequency/volume invariants | PASS |

## 46. Acceptance Criteria

| ID | Status | Evidence |
|---|---|---|
| A | PASS | real finish invokes `processWorkoutLifecycleAfterSession` |
| B | PASS | no-UI-mount hot-path integration |
| C | PASS | real finish creates V2 pending |
| D | PASS | finish-flow durable-follow-up regression |
| E | PASS | earned crash recovery/reconcile |
| F | PASS | hook calls cold-start reconcile |
| G | PASS | AppShell has only V2 authority |
| H | PASS | V1 normal rotation gated |
| I | PASS | legacy read creates V2 baseline first |
| J | PASS | stale mirror recovery test |
| K | PASS | zero V1 events in real hot path |
| L | PASS | post-activation namespace/V2 integration |
| M | PASS | entry-point table in §5 |
| N | PASS | repeatable reconcile |
| O | PASS | three-call cardinality proof |
| P | PASS | earned-without-target emulator recovery |
| Q | PASS | prepare is one atomic self-contained pending; activated leftover cleanup exists |
| R | PASS | late-open auto-activation E2E |
| S | PASS | three-identity stale detection |
| T | PASS | stale target re-prepared before deadline activation |
| U | PASS | source ProgramInstance CAS |
| V | PASS | source TrainingCycle CAS |
| W | PASS | source snapshot CAS |
| X | PASS | stale compute rejected/reconciled |
| Y | PASS | Prepare/Prepare emulator race |
| Z | PASS | earned/pending deterministic keys |
| AA | PASS | deterministic target ProgramInstance ID |
| AB | PASS | adaptation clears old prepared target |
| AC | PASS | append-only earned fact survives |
| AD | PASS | replacement uses newest active snapshot |
| AE | PASS | Beginner→Intermediate remains earned |
| AF | PASS | shared fact/target protocol covers cycle evolution |
| AG | PASS | Adaptation/Prepare emulator race |
| AH | PASS | Adaptation/Activation emulator race |
| AI | PASS | final real knee limitation assertion |
| AJ | PASS | exact defer deadline preserved |
| AK | PASS | V2-first recovery/no stale mirror overwrite |
| AL | PASS | explicit partial-state union/classifier |
| AM | PASS | three recoverable matrix cases |
| AN | PASS | ambiguous partial state explicit failure |
| AO | PASS | no ordinal/earned history inferred |
| AP | PASS | sequential/concurrent recovery converges |
| AQ | PASS | Migration/Migration emulator proof |
| AR | PASS | legacy race then real V2 finish |
| AS | PASS | stale legacy mirror ignored |
| AT | PASS | minimal referent repair preserves V2 IDs/facts |
| AU | PASS | Start/Start one activation |
| AV | PASS | Start/Defer one legal state |
| AW | PASS | Defer/Defer count/event 1 |
| AX | PASS | Manual/Auto one target/event |
| AY | PASS | Auto/Auto one target/event |
| AZ | PASS | Prepare/Prepare one target |
| BA | PASS | stale pre-adaptation target cannot win |
| BB | PASS | one safe final active state |
| BC | PASS | one deterministic baseline |
| BD | PASS | finish/schedule idempotency regressions green |
| BE | PASS | one earned fact under simultaneous evaluation |
| BF | PASS | Start retry/unknown-result convergence |
| BG | PASS | races count at most one active instance |
| BH | PASS | pointer equals active winner |
| BI | PASS | pending source/target/state validation |
| BJ | PASS | source superseded in activation transaction |
| BK | PASS | earned event count 1 |
| BL | PASS | one fixed pending; no persisted prepared-event duplication |
| BM | PASS | activation/promotion event count 1 |
| BN | PASS | earned cycle credit regressions green |
| BO | PASS | defer count/event 1 |
| BP | PASS | no target instance/execution before activation |
| BQ | PASS | activated instance namespace regression green |
| BR | PASS | `lifecycleAt` before/after complex race |
| BS | PASS | adapted limitation future-evolution regression |
| BT | PASS | ProgramInstance progression reset regression |
| BU | PASS | prescribed opportunity adherence regression |
| BV | PASS | four earned Intermediate cycles regression |
| BW | PASS | exact 70/85 unit boundaries |
| BX | PASS | real role/session equivalence regressions |
| BY | PASS | aggregate frequency tests green |
| BZ | PASS | aggregate prescription/volume tests green |
| CA | PASS | app/functions typechecks |
| CB | PASS | pending/event readers and writers aligned |
| CC | PASS | Rules require/validate new pending field |
| CD | PASS | 343/343 Rules tests |
| CE | PASS | no new path; cleanup emulator 2/2 |
| CF | PASS | Java 21.0.12 emulator executions |
| CG | PASS | Functions typecheck, 1,173 tests and build |
| CH | PASS | all simulable critical races use Firestore Emulator |

## 47. Residual Search

The required searches covered V1/V2 evaluators, hooks, pending fields,
snapshot/CAS identities, nondeterministic identity APIs and every Firestore
write primitive. Results:

- `useWorkoutProgression` and `ProgressionFeedbackModal` have no production
  caller; AppShell imports only V2 evolution/reconciliation.
- `NORMAL_ROTATION_AVAILABLE` remains in the V1 pure resolver and dead
  compatibility hook. Its sole mutator, `applyProgression`, refuses all V2
  transitions.
- `adaptationStage` remains legacy data/evaluation input; it is not a V2
  lifecycle writer.
- `Date.now` is used for time comparison/fixtures, never critical identity.
  No lifecycle transition identity uses `Math.random`/`randomUUID`.
- prepare, defer, activation, adaptation, bootstrap and partial recovery use
  transactions/deterministic IDs. The UI has no concurrency guard authority.

Writer classification:

| Field/Document | Writers Before | Writers After | Authoritative Writer |
|---|---|---|---|
| lifecycle active pointer | V2 shared activation + V1-triggered generation | V2 activation/adaptation/bootstrap only for live flow | lifecycle transaction |
| active ProgramInstance | shared program writer, V1/V2 callers | V2 orchestrator/adaptation/onboarding | `saveAndActivateWorkoutProgram` |
| current cycle | lifecycle activation primitives | same, guarded by V2 decision/CAS | lifecycle transaction |
| pending evolution | prepare/defer/activation | prepare/defer/reconcile/atomic activation | Lifecycle Application |
| earned event | prepare coupled to target | durable `persistEarnedFact` before compute | Lifecycle Application transaction |
| legacy active pointer | shared writer | compatibility mirror, never reverse authority | shared program writer |
| V1 progression event | V1 apply from real finish | no production caller; blocked for V2 | legacy-only compatibility |

Final answer to the mandatory question: **No.** No production path found can
modify progression/lifecycle for a V2 user without the V2 authority boundary.

## 48. Known Issues

- Firestore transactions require network connectivity; offline activation or
  preparation is safe-but-not-completed until retry/reconciliation.
- The unused V1 hook/resolver remains as compatibility/deletion debt. It is
  gated and has no production caller, so it is not a second authority.
- Ambiguous partial V2 data intentionally requires operational intervention;
  automatic guessing would invent history.
- Operational telemetry is no-op until Phase 8C selects a provider.
- Expected transaction abort/Rules-denial retries are noisy in Firestore
  Emulator logs, but all assertions and convergence checks pass.

## 49. Explicitly Out of Scope

Phase 8C: provider-backed telemetry, rollout/kill switch, CI hardening and full
Rules hardening. Phase 8D: UI/copy. Also unchanged: XP, load progression,
RPE/RIR, rep tracking, new thresholds, prescription/equivalence redesign and
offline Firestore transaction support.

## 50. Remaining Production Blockers

None for Phase 8B scope. The limitations in §48 are documented behavior or
future-phase work, not an unresolved dual-authority/stale-safety race.

## 51. Final Verdict

FASE 8B COMPLETA
