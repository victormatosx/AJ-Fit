# Phase 9 — Final Blocker Remediation

Date: 2026-08-31

## 1. Executive verdict

`FASE 9 COMPLETE`. All seven audited P1 blockers are fixed and the mandatory
quality gates are green. No commit, push, deploy or rollout change was made.

## 2. Git state before

Branch `main`, HEAD `d24319ba15e63095fd376bcd99acd30f4abce343`.
The inherited Phase 1–8 worktree was deliberately dirty: 78 tracked modified
and 48 untracked paths. Those changes were preserved.

## 3. Git state after

Branch and HEAD are unchanged. Phase 9 adds backend lifecycle authority,
trusted telemetry, security/application tests, account-deletion coverage,
ADR-015 and this report on top of the inherited worktree. No destructive Git
operation was used.

## 4. Environment

macOS, Node 20.20.2 at root, Node 22.23.2 for Functions validation, Java 21
from `/opt/homebrew/opt/openjdk@21`, Firebase CLI 15.26.0, Expo SDK 56 docs.

## 5. Documents reviewed

All `docs/workout-lifecycle/v2` specifications and reports, especially Phase
8A–8D, operations runbook, ADR-012–014, the post-remediation audit attachment,
Rules, lifecycle/progression/prescription/telemetry services, CI and Emulator
tests. Runtime behavior was treated as authoritative.

## 6. Runtime architecture before Phase 9

V2 was the application orchestrator, but the owner client still executed
critical transactions. Auth/App Check and structural Rules did not prove
progression, calendar, execution, prescription-safety or telemetry semantics.

## 7. P1 reproduction matrix

| Finding | Before | Reproduction evidence | After |
| --- | --- | --- | --- |
| P1-01 | adjacent level/cycle inconsistency allowed | malicious-owner Rules fixture | denied |
| P1-02 | owner could assert privileged semantics | direct lifecycle/cycle/event/pending/instance attacks | capability-bound |
| P1-03 | 34/49 could round to GOOD | adherence regression | BELOW_TARGET |
| P1-04 | execution could define its own denominator | omitted-exercise authority test | denied/unqualified |
| P1-05 | adaptation + pending denied | real Emulator integration | convergent |
| P1-06 | unrelated sessions paired by index | Lower→Push diff fixture | add/remove, no replacement |
| P1-07 | client could submit trusted success names | callable unit fixture | rejected |

## 8. AUD-P1-01 reproduction

The owner fixture attempted to change `BEGINNER` to `INTERMEDIATE` while
retaining the Beginner active cycle. The pre-remediation predicate admitted
adjacency without requiring a real cycle transition.

## 9. AUD-P1-01 fix

Rules bind lifecycle target level/cycle number/IDs to a backend grant, require
the old active cycle to become `COMPLETED`, the new cycle to carry the granted
level, and the old instance to receive `supersededAt=request.time`. Adjacent
forgeries and all regressions are denied.

## 10. AUD-P1-02 threat model

The attacker is authenticated, App-Checked, owns the UID, knows all schemas
and can call Firestore directly. All client claims are untrusted until checked
against persisted domain state by the backend.

## 11. Trust-boundary decision

ADR-015 adopts a backend-validated, short-lived, single-operation capability.
The client transaction remains for compatibility, but it must exactly match
and atomically consume the grant under Rules. Auth identifies; App Check
attests app context; neither proves domain truth.

## 12. Client-safe operations

| Operation | Client-safe portion | Backend required | Reason |
| --- | --- | --- | --- |
| record set | submit evidence | for V2 qualification | evidence is not prescription |
| finish execution | request | yes for V2 | exact snapshot comparison |
| complete schedule opportunity | request | yes for V2 | binds execution/opportunity |
| evaluate progression | request/read result | yes | multi-document semantics |
| complete cycle | none | yes | earned transition only |
| prepare evolution | intent | yes | earned fact and safe plan |
| promote level | intent | yes | adjacency/cycle/pending proof |
| defer | user choice | yes | exact pending/timeline/event |
| activate | intent | yes | exact pending/source/target |
| adaptation | changed answers | yes | safety re-derivation |
| lifecycle event creation | none independently | yes | event is a domain fact |

## 13. Backend-authoritative operations

`authorizeWorkoutLifecycleMutation` validates EARN, PREPARE, DEFER, ACTIVATE,
ADAPT, INITIALIZE, MIGRATE, RECOVER, FINISH_EXECUTION and COMPLETE_SCHEDULE as
applicable. It also seals immutable safe program content for target activation.

## 14. Firestore Rules changes

Rules deny client grant writes and require a live matching grant for critical
V2 writes. Source/target lifecycle, cycle, instance, pending, event, execution
and schedule identities are bound. Starting level and history stay immutable.

## 15. Malicious-owner attack matrix

| Attack | Before | After | Test |
| --- | --- | --- | --- |
| adjacent promotion | ALLOW | DENY | `workoutLifecycle.rules.test.ts` |
| fake earned cycle | ALLOW | DENY | same |
| fake lifecycle event | structurally reachable | DENY | same |
| fake activation | structurally reachable | DENY | same |
| arbitrary pending | structurally reachable | DENY | same |
| arbitrary active instance | structurally reachable | DENY | same |
| incoherent supersession | structurally reachable | DENY | same |
| unsafe structurally valid plan | client-derived | backend rejects/seals | `authorizeMutation.integration.test.ts` + Rules |
| corrupted execution | could qualify | rejected | authority/session qualification tests |
| omitted exercise | could qualify | rejected | authority/session qualification tests |
| extra workout | excluded | excluded | progression tests |
| stale unsafe target | could race/fail | rejected | lifecycle concurrency tests |
| fake trusted telemetry | accepted | rejected | Functions telemetry tests |

## 16. AUD-P1-03 reproduction

The old proportional estimate could turn 34 valid sessions over 49 concrete
opportunities into an apparent 70%. The exact fraction is 0.693877551.

## 17. Old adherence denominator

`frequency × activeDays / 7` was an approximation and could not represent
weekday alignment, non-seven-day windows, pauses or ProgramInstance resets.

## 18. New prescribed-opportunity denominator

`prescribedOpportunities.ts` enumerates `{date, sessionIndex,
programInstanceId}` from authoritative training weekdays inside the active
window. Fulfillment is a unique match to a qualifying execution.

## 19. Calendar boundary tests

Unit/integration tests cover 2–6 sessions/week, different starting weekdays,
28- and 85-day windows, pause/resume, adaptation reset, duplicates and 34/49.

## 20. AUD-P1-04 reproduction

A payload containing only one complete exercise from a three-exercise,
nine-set prescription could previously shrink its own denominator to 3/3.

## 21. Authoritative session qualification

The evaluator loads the immutable active ProgramInstance plan, selects the
exact prescribed session and counts prescribed sets. Execution records only
supply completion evidence; they cannot add or remove prescription slots.

## 22. Corrupted execution matrix

9/6 fails, 10/7 passes, 10/6 fails; omitted/empty/unknown/wrong-session/
wrong-instance fail; extra exercises add no credit; duplicate exercise/set
evidence is rejected or deduplicated conservatively; PARTIAL uses the same
exact 70% threshold.

## 23. Legacy execution policy

Historical records lacking enough ProgramInstance/session/set identity do not
qualify by assumption. Compatibility reads remain, but absence of evidence is
never upgraded to completed prescribed work.

## 24. AUD-P1-05 root cause

Adaptation invalidated pending content in one step while Rules/CAS expected a
coherent source during activation. Phase 9's single-use grant also exposed a
legitimate cross-command grant race. The denied write was the stale pending/
activation transaction whose grant or pending source no longer matched.

## 25. Adaptation + pending fix

Adaptation is authorized against source instance/cycle/snapshot and exact new
inputs, invalidates stale pending, activates a safe instance, then reconciliation
re-prepares from the new snapshot. A lost grant race recomputes once.

## 26. Adaptation concurrency matrix

READY, DEFERRED(1), DEFERRED(2), manual activation, autoactivation,
prepare, duplicate/retry and unknown-result recovery all run against the real
Firestore Emulator and converge without stale activation.

## 27. Safety preservation proof

Backend re-derives the adaptation inputs, validates the plan against exercise
catalog/limitation profiles and seals target content. Activation additionally
CAS-checks the pending/source snapshot. A new limitation always wins.

## 28. Earned-state preservation proof

Earned facts live in immutable `EVOLUTION_EARNED` or
`MOTIVATIONAL_RENEWAL_OFFERED` events. Adaptation removes only the stale target;
reconciliation reconstructs pending from the same earned timestamp/quality.

## 29. Deferral preservation proof

Earned-event reconstruction derives prior deferral events, preserving count,
next prompt and autoactivation deadline. Tests parameterize 0, 1 and 2 consumed
deferrals, preventing an infinite reset.

## 30. AUD-P1-06 reproduction

At the same array index, Lower/Squat and Push/Bench were treated as a
replacement even though no logical-session relation existed.

## 31. Session identity strategy

Matching prefers stable `sessionId`; otherwise a deterministic structural key
uses normalized session name/type. Positional fallback is permitted only when
both sides lack identity and the overall split is unchanged.

## 32. New diff algorithm

Program → logical session → slot → exercise is compared hierarchically.
Unmatched sessions become added/removed; replacements and sets/reps/rest claims
occur only inside a matched session. Results are deterministic.

## 33. What Changed adversarial tests

`workoutEvolution/__tests__/diff.test.ts` covers identical plans, true
replacement, reorder, session add/remove/count, split changes, Lower→Push,
stable IDs across display-name changes and sets/reps/rest changes.

## 34. AUD-P1-07 reproduction

The former client callable accepted operational names such as promotion and
activation after Auth/App Check/schema validation, allowing poisoned health
metrics.

## 35. Telemetry trust model

Events are split into `CLIENT_DIAGNOSTIC` and `TRUSTED_DOMAIN`. Client
diagnostics describe local observations only; rollout-relevant success facts
come from persisted immutable lifecycle events.

## 36. Trusted-domain telemetry implementation

`onTrustedWorkoutLifecycleEventCreated` maps supported Firestore lifecycle
events after persistence. Per-user receipt documents deduplicate each event.

## 37. Client diagnostics policy

The App-Check/Auth callable accepts only allowlisted diagnostic names and
bounded payloads. Unknown, oversized and trusted-domain attempts are rejected.

## 38. Telemetry abuse/rate-limit/dedup

Payload keys/sizes and names are bounded; no unnecessary PII is accepted.
Immutable event IDs plus receipt creation provide trusted deduplication.
App Check provides an abuse layer; trusted metrics never rely on it alone.

## 39. lifecycle_transition_conflict resolution

The unused schema-only event was removed. CAS failures remain diagnostic
failure categories; no nonexistent producer is advertised as an operational
metric.

## 40. Lifecycle authority regression audit

Post-workout and cold-start still use V2 reconciliation. Critical V2 writes
now require backend capability; no V1 progression writer returned to the path.

## 41. V1 residual search

`applyProgression`/`checkAndApply` remain only as gated compatibility code and
tests; `NORMAL_ROTATION` remains historical V1 vocabulary. No live V2 authority
calls them.

| Search token | Classification | Result |
| --- | --- | --- |
| `applyProgression`, `checkAndApply`, `NORMAL_ROTATION` | LEGITIMATE compatibility / HISTORICAL / TEST_ONLY | V1 writer is gated for V2; no hot-path caller |
| `adaptationStage` | LEGITIMATE | prescription personalization and legacy compatibility metadata |
| `currentTrainingLevel` | LEGITIMATE + HISTORICAL docs | active-cycle coherent in current runtime; ADR-010 marked superseded |
| `EARNED_EVOLUTION`, `LEVEL_PROMOTED`, `EVOLUTION_ACTIVATED` | LEGITIMATE / TEST_ONLY / HISTORICAL | typed ledger facts, Rules, backend validation and trusted projection |
| `pendingEvolutions`, `completionReason` | LEGITIMATE | current state machine, backend/Rules constraints and deletion inventory |
| `frequency * activeDays` | no current literal occurrence | old approximation absent from V2 authority |
| `expectedSessions` | LEGITIMATE V2; LEGITIMATE gated V1 compatibility | V2 value equals concrete opportunity count; old formula remains only in V1 resolver |
| `COMPLETED`, `sessionIndex` | LEGITIMATE / TEST_ONLY | execution/schedule/cycle schemas and exact snapshot/opportunity matching |
| `lifecycle_transition_conflict` | HISTORICAL report mention only | removed from runtime contract |
| `telemetry` | LEGITIMATE / HISTORICAL docs | diagnostics and trusted projection are separated; old reports marked historical |
| `Math.random` | LEGITIMATE security comments / TEST_ONLY | no lifecycle identity uses randomness |
| `TODO`, `FIXME` | HISTORICAL search prose or unrelated Portuguese word | no Phase 9 production marker |
| `mock`, `fake` | TEST_ONLY / DEV_ONLY / unrelated domain language | no lifecycle production truth source |
| `placeholder` | LEGITIMATE UI/data fallback or TEST_ONLY | no Phase 9 authority placeholder |

No P1-related `UNEXPECTED` occurrence remains.

## 42. Prescription inputs regression

Every new ProgramInstance retains an immutable effective-input snapshot.
Adaptation and later evolution load the active snapshot; limitation tests stay
green.

## 43. Four-cycle regression

Intermediate→Advanced continues to require exactly four earned Intermediate
cycles. Renewal is excluded by event/cycle semantics and regression tests.

## 44. Threshold regression

Integer evidence is compared without threshold-crossing rounding: below 70%
is BELOW_TARGET, 70–<85% GOOD and at least 85% HIGH.

## 45. Extra-workout regression

Only unique prescribed opportunities with matching instance/session qualify.
Extra sessions remain excluded and cannot accelerate progression.

## 46. Migration regression

V1 bootstrap remains deterministic and compatibility-only. Partial-state
repair is minimal; ambiguous state fails instead of inventing history.

## 47. Rollout/kill-switch regression

Sticky enrollment and kill-switch behavior are unchanged and unit/integration
tests pass. Phase 9 did not alter remote config or production rollout.

## 48. UX truthfulness regression

Home/Profile/Evolution continue to derive progress and changes from persisted
facts. No synthetic percentage, XP, streak, PR, volume, calendar or next
workout was introduced.

## 49. Account deletion impact

`workoutLifecycleAuthorityGrants` and
`workoutLifecycleTrustedTelemetryReceipts` were added to idempotent per-user
cleanup, resource inventory and real Emulator reconciliation/cleanup tests.

## 50. Schema/index impact

Two per-user operational subcollections were added. No composite Firestore
index is required. Rules deny owner writes to grants; receipts are backend-only.

## 51. Files created

Principal Phase 9 files: Functions authority and integration test, client
authority provider/fixture, trusted telemetry implementation/tests, ADR-015
and this report. The inherited untracked files from earlier phases remain.

## 52. Files modified

Rules; lifecycle/application/program/execution/schedule/progression services;
progression qualification/opportunity/diff tests; Functions index/telemetry;
account-deletion resources/tests; package scripts; ADR index and supersession
markers. See `git status --short` for the preserved aggregate worktree.

## 53. Files removed

None.

## 54. Root unit results

248 files passed, 14 skipped; 3,988 tests passed, 103 skipped; zero failures.
The skips are existing opt-in Emulator suites, not hidden critical tests.

## 55. Root integration results

50 files and 683 tests passed; zero failed; no critical test skipped. The
previous adaptation+pending failure remains included and green.

## 56. Firestore Rules results

15 files and 346 tests passed under Java 21, including 15 malicious-owner
lifecycle tests and the full repository Rules suite.

## 57. Storage Rules results

3 files and 91 tests passed under the full Firestore+Storage Emulator command.

## 58. Functions results

TypeScript PASS; 83 files passed/11 opt-in skipped, 1,188 tests passed/44
skipped; build PASS. Lifecycle authority integration: 5/5 PASS.

## 59. Account deletion results

Reconciliation integration 6/6 PASS; Firestore cleanup integration 2/2 PASS;
unit resource inventory/cleanup is included in the 1,188 Functions tests.

## 60. Adversarial suite results

Rules malicious-owner attacks 15/15 PASS; backend authority 5/5 PASS;
application concurrency 7/7 PASS; telemetry and corrupted-execution matrices
pass in unit/Functions suites.

## 61. Acceptance criteria A–CR

| Criterion | Status | Evidence |
| --- | --- | --- |
| A | PASS | adjacent promotion denied by lifecycle Rules suite |
| B | PASS | Advanced→Intermediate and Intermediate→Beginner denied |
| C | PASS | fake earned cycle denied |
| D | PASS | fake `LEVEL_PROMOTED` denied |
| E | PASS | fake activation denied |
| F | PASS | arbitrary pending denied |
| G | PASS | arbitrary active ProgramInstance denied |
| H | PASS | full Rules owner isolation suite |
| I | PASS | startingLevel immutable Rules coverage |
| J | PASS | lifecycle history immutable/append-only coverage |
| K | PASS | enumerated prescribed opportunities |
| L | PASS | approximation removed from authority path |
| M | PASS | explicit 34/49 regression |
| N | PASS | extra-workout exclusion tests |
| O | PASS | unique opportunity dedup tests |
| P | PASS | ProgramInstance-bound window |
| Q | PASS | adaptation reset integration |
| R | PASS | pause/resume calendar tests |
| S | PASS | weekday/frequency boundary matrix |
| T | PASS | exact 70% GOOD test |
| U | PASS | below-70% tests |
| V | PASS | immutable session snapshot denominator |
| W | PASS | omitted exercise stays in denominator |
| X | PASS | empty COMPLETED rejected |
| Y | PASS | unknown exercise gives no credit/rejected |
| Z | PASS | extra exercise gives no credit |
| AA | PASS | duplicate set cannot increase credit |
| AB | PASS | wrong session rejected |
| AC | PASS | wrong ProgramInstance rejected |
| AD | PASS | PARTIAL ≥70% qualifies |
| AE | PASS | PARTIAL <70% fails |
| AF | PASS | adaptation + READY integration |
| AG | PASS | adaptation + DEFERRED(1) integration |
| AH | PASS | adaptation + DEFERRED(2) integration |
| AI | PASS | immutable earned event preserved |
| AJ | PASS | reprepare uses newest snapshot |
| AK | PASS | limitation persists through evolution |
| AL | PASS | stale pending activation rejected |
| AM | PASS | deferral count/timeline preserved |
| AN | PASS | manual activation race |
| AO | PASS | autoactivation race |
| AP | PASS | idempotent retry/unknown-result coverage |
| AQ | PASS | aggregate integration zero failures |
| AR | PASS | semantic session matching |
| AS | PASS | added session count |
| AT | PASS | removed session count |
| AU | PASS | replacement only in matched session |
| AV | PASS | true reorder detection |
| AW | PASS | sets/reps/rest counters |
| AX | PASS | conservative no-identity claim policy |
| AY | PASS | Lower→Push test emits no replacement |
| AZ | PASS | deterministic diff test |
| BA | PASS | telemetry callable requires Auth |
| BB | PASS | callable enforces App Check |
| BC | PASS | trusted names rejected from client |
| BD | PASS | explicit client diagnostic allowlist |
| BE | PASS | success projected only from persisted event |
| BF | PASS | backend Firestore trigger after persistence |
| BG | PASS | per-user receipt dedup test |
| BH | PASS | bounded allowlisted payload/no PII |
| BI | PASS | provider-failure non-blocking test |
| BJ | PASS | unused event removed from contract |
| BK | PASS | snapshot tests/integration |
| BL | PASS | limitation persistence tests |
| BM | PASS | instance-window reset tests |
| BN | PASS | extra-workout tests |
| BO | PASS | four Intermediate cycles tests |
| BP | PASS | exact 70/85 tests |
| BQ | PASS | V2 orchestrator remains sole authority |
| BR | PASS | residual V1 path gated |
| BS | PASS | prepare/prepare race |
| BT | PASS | start/start race |
| BU | PASS | start/defer race |
| BV | PASS | manual/auto race |
| BW | PASS | auto/auto race |
| BX | PASS | partial migration repair tests |
| BY | PASS | sticky rollout tests |
| BZ | PASS | kill-switch tests |
| CA | PASS | UX/unit checks reject synthetic progress |
| CB | PASS | renewal does not earn cycle |
| CC | PASS | manual start remains available while deferred |
| CD | PASS | persistent autoactivation acknowledgement tests |
| CE | PASS | Home/Profile runtime tests use real lifecycle data |
| CF | PASS | i18n audit: zero blocking issues |
| CG | PASS | root `tsc --noEmit` |
| CH | PASS | 3,988 root unit tests |
| CI | PASS | 683/683 root integration tests |
| CJ | PASS | 346/346 Firestore Rules tests |
| CK | PASS | 91/91 Storage Rules tests |
| CL | PASS | Functions typecheck |
| CM | PASS | 1,188 Functions unit tests |
| CN | PASS | Functions build |
| CO | PASS | authority 5/5 and relevant critical integrations |
| CP | PASS | deletion reconciliation 6/6 + cleanup 2/2 |
| CQ | PASS | opt-in suites explicitly run; no critical silent skip |
| CR | PASS | all seven P1 findings fixed |

## 62. P2 findings intentionally deferred

Small-N variation, Active Time return-day semantics, dependency advisories,
visual/alert/soak evidence and the 3,660-day Active Time cap remain outside
Phase 9. P2-04 stale docs and P2-06 unused conflict event were resolved.

## 63. Documentation reconciliation

ADR-015 is CURRENT. ADR-010 is explicitly SUPERSEDED. ADR-013 and the Phase
8B report are marked HISTORICAL where they assumed client semantic authority.
Historical implementation evidence was retained.

## 64. Remaining known issues

The intentionally deferred P2 items above remain. Static lint reports 14
non-blocking pre-existing warnings and zero errors. Dependency audit remains
governed by the repository's passing CI policy; no dependency redesign was
attempted.

## 65. Remaining blockers

None for the Phase 9 acceptance scope.

## 66. Production-readiness impact

The seven audit blockers no longer authorize a `NOT READY` result on the tested
runtime. This phase does not itself authorize rollout: production changes,
alert configuration and soak remain separate operational decisions.

## 67. Final Phase 9 verdict

`FASE 9 COMPLETE` — AUD-P1-01 through AUD-P1-07 fixed; CG–CR PASS.
