# Fase 8C — Production Hardening — Relatório Final

> **HISTORICAL:** rollout and toolchain evidence remains applicable. Phase 9
> supersedes the client-supplied trusted telemetry and owner-client lifecycle
> authority described in this report; see ADR-015 and Phase 9 report.

## 1. Git

- Branch: `main`.
- HEAD inicial/final: `d24319ba15e63095fd376bcd99acd30f4abce343`.
- Estado inicial: working tree já extensamente alterada pelas Fases 8A/8B e
  trabalho anterior, preservada sem descarte.
- Estado final: 118 entradas modificadas/não rastreadas, incluindo o conjunto
  herdado e os artefatos 8C; `git diff --check` passa quando excluído o
  `firestore-debug.log` gerado pelo emulador e já previamente modificado.
- Nenhum commit, push, merge, rebase, reset, stash ou clean foi executado.

## 2. Production Readiness Before 8C

| Capability | Exists | Integrated | Production-effective | Tested |
|---|---:|---:|---:|---:|
| Rollout/cohort | yes | no | no | pure only |
| Kill switch | code only | no | no | no hot-path proof |
| Telemetry types | yes | no-op | no | partial |
| Semantic Rules | partial | yes | partial | partial |
| Reproducible CI/toolchains | partial | mixed | partial | opt-ins omitted |

O código de domínio estava correto após 8A/8B, mas enrollment não consultava
a flag real, não havia destino de telemetria, config failure e migration failure
não eram observáveis de ponta a ponta, Rules aceitavam mapas/relacionamentos
semanticamente frágeis e CI não tornava todos os runtimes/suites explícitos.

## 3. Rollout Architecture Before

```text
loadActiveWorkoutProgram
  -> V2 exists? use V2
  -> otherwise call migration directly

rollout.ts + config reader (isolated, not authoritative)
telemetry.ts -> no-op logger
```

## 4. Rollout Architecture After

```text
load/generate active program
  -> V2 exists? --------------------------> use V2 (sticky; no config read)
  -> no V2 -> read versioned Admin config
              -> invalid/unavailable -----> legacy workout, no V2 enrollment
              -> OFF / bucket outside ----> legacy workout, no V2 enrollment
              -> ON / bucket inside ------> deterministic transactional V2 baseline

operational events -> callable (Auth + App Check) -> structured Cloud Logging
```

## 5. Enrollment Hot Path

`loadActiveWorkoutProgram` reads V2 first. Only inside `!lifecycle` it loads
`workoutLifecycleRolloutConfig/active` and calls `ensureWorkoutLifecycleV2`.
Initial `saveAndActivateWorkoutProgram` applies the same rule when no V2 state
exists. `NOT_ROLLED_OUT` returns usable legacy content without V2 IDs and does
not re-enable V1 progression authority.

## 6. Existing V2 Sticky Behavior

The durable fact is `workoutLifecycleState/current`, not current flag value.
Both hot paths skip config for existing V2. The real emulator test performs
OFF → ON enrollment → OFF and proves the same ProgramInstance and lifecycle
document remain active and unchanged.

## 7. Cohort Algorithm

`stickyRolloutBucket(uid) = parseInt(FNV1a("workout-lifecycle-v2-rollout:" +
uid), 16) % 100`. Buckets are 0–99 and enrollment is `bucket < percentage`.
Therefore 0% enrolls none, 100% enrolls all, and a UID never changes bucket.
Unit boundaries cover 0, 1, 10, 25, 50, 99 and 100 plus malformed values.

## 8. Kill Switch

`npm run ops:lifecycle-rollout -- --project <id> --off --apply` atomically
writes `{schemaVersion:1, enabled:false, percentage:0}` through Admin SDK.
New users stay legacy-compatible immediately, without app deploy. Existing V2
users bypass the flag. OFF/ON/OFF is proven in the real enrollment integration.

## 9. Config Failure

Missing, malformed, unknown-field, non-integer, out-of-range or unreadable
config resolves to fail-safe OFF for new enrollment and emits one bounded
failure reason (`MISSING`, `MALFORMED`, `UNAVAILABLE`). No cache is used.
Existing V2 never performs the read and is unaffected.

## 10. Rollback

Apply `--off`, verify with `--read`, retain V2 Rules/telemetry/reconciliation,
never delete or “unmigrate” V2 documents, prove one existing-V2 account still
reconciles and one new account remains usable without V2, then ship a forward
fix and resume at the last proven percentage. V1 never regains mutation
authority.

## 11. Rollout Plan

Internal → 1% → 5% → 10% → 25% → 50% → 100%. Hold at least 24 hours at
1–10% and 48 hours at 25–50%, covering normal completion/reconciliation
traffic. Every advance requires green health gates and support confirmation.

## 12. Health Gates

- Migration failure/enrollment below 1%, without sustained increase.
- Reconciliation failure/start below 0.5%.
- No sustained permission/referent-missing, impossible-state or config failure.
- No false-success sequence and no user-facing workout blockage.
- Any authorization concern, integrity error or breached threshold triggers
  immediate OFF and investigation.

## 13. Rules Threat Model

An authenticated owner is not assumed honest. Attacks include identity
rewrites, level jumps, completed-cycle regression, illegal supersession,
fabricated promotion events, arbitrary embedded plans, pending evolutions based
on stale/cross-questionnaire sources, deferral jumps, unknown-field smuggling,
cross-user access and client rollout writes. Admin SDK remains a trusted
backend boundary and must validate before bypassing Rules.

## 14. Rules Architecture

Rules use closed key sets, ownership, exact types/enums, immutable identity,
bounded transitions and `get/getAfter/existsAfter` referential checks. They
enforce structural lifecycle integrity feasible at persistence time without
duplicating progression math or the prescription engine.

## 15. Lifecycle State Rules

Create requires `current`, coherent starting/current level, active cycle,
active ProgramInstance, content/prescription identities, and questionnaire
starting-level mapping. Updates preserve identity, forbid level skips and
require cycle/instance pointers coherent with atomic transition documents.

## 16. TrainingCycle Rules

Cycle identity, number, level, origin and timestamps are immutable. Create must
be the lifecycle current active cycle. Completion has coherent status,
completedAt/reason; `COMPLETED → ACTIVE` is rejected. New cycles must match
same/adjacent level and lifecycle pointer.

## 17. ProgramInstance Rules

Identity, cycle, content, prescription, questionnaire and input snapshot are
protected. Active create must match the lifecycle pointer; historical migration
baseline is explicitly bounded. Superseding requires atomic lifecycle pointer
movement, and a superseded instance cannot become active illegally.

## 18. Events Rules

Ledger entries are create-only and have closed, type-specific payload schemas.
Cycle and ProgramInstance referents must exist. `LEVEL_PROMOTED` must tie to
the active transition referents. Update/delete remain denied.

## 19. Pending Evolution Rules

Only `current` is allowed. Source cycle/instance and snapshot must equal active
state; target questionnaire/version/level and target ProgramInstance identity
must be coherent. Promotion is adjacent, cycle/renewal stays same level,
quality semantics are bounded, status changes are legal and deferral increments
exactly once with coherent 14-day windows.

## 20. Prescription Snapshot Rules

Snapshot identity/source/questionnaire version/level and bounded effective
inputs are closed and immutable inside ProgramInstance. Pending evolution must
reference the source snapshot when present. Embedded final plans validate
closed keys, sessions/exercises, IDs, sets/reps/rest/order and target program
relationships instead of accepting an arbitrary map.

## 21. Rollout Config Rules

Clients may read `workoutLifecycleRolloutConfig/active` but can never create,
update or delete it. The application accepts exactly `schemaVersion:1`, boolean
`enabled`, and integer `percentage` 0–100; Admin tooling is the write path.

## 22. Malicious Owner Tests

| Attack | Expected | Actual | Status |
|---|---|---|---|
| Skip level / fake promotion | deny | denied | PASS |
| Completed cycle → active | deny | denied | PASS |
| Illegal ProgramInstance reactivation | deny | denied | PASS |
| Arbitrary plan / invalid target | deny | denied | PASS |
| Stale pending source / deferral jump | deny | denied | PASS |
| Unknown field | deny | denied | PASS |

## 23. Cross-User Matrix

| Collection | Read | Create | Update | Delete |
|---|---|---|---|---|
| workoutLifecycleState | denied | denied | denied | denied |
| trainingCycles | denied | denied | denied | denied |
| programInstances | denied | denied | denied | denied |
| workoutLifecycleEvents | denied | denied | denied | denied |
| pendingEvolutions | denied | denied | denied | denied |

## 24. Telemetry Before

Events were typed but defaulted to a silent no-op and had no production
adapter/destination. Migration/config/reconciliation/stale failures were not a
complete operational contract.

## 25. Telemetry After

`App.tsx` installs the Firebase callable adapter synchronously before React
mounts. `recordWorkoutLifecycleTelemetry` requires Auth, enforces App Check,
validates an exact centralized allowlist and writes structured Cloud Logging.
Unconfigured development use warns once; delivery failure is sanitized and
best-effort.

## 26. Telemetry Contract

| Event | Trigger | Provider | Payload | PII |
|---|---|---|---|---|
| progression_evaluated | evaluation | callable/logging | level, decision | none |
| evolution_eligible | earned decision | callable/logging | type, quality, levels, cycle | none |
| evolution_prepared/deferred/activated | durable transition | callable/logging | bounded type/count/trigger/quality | none |
| motivational_renewal/level_promoted | successful activation | callable/logging | bounded enums | none |
| progression_failed | failed stage | callable/logging | stage, category, retryable | none |
| migration_failed | migration exception | callable/logging | category, retryable | none |
| lifecycle_reconcile_* | reconciliation | callable/logging | trigger/outcome/category | none |
| rollout/config/stale/conflict/recovery | operational edge | callable/logging | bounded technical values | none |

## 27. Failure Telemetry

Migration emits `migration_failed` plus `progression_failed:MIGRATION`.
Preparation, deferral, activation, adaptation and reconciliation emit bounded
failure stages. Config read and stale CAS rejection have dedicated events.
Success events occur only after the corresponding durable operation succeeds.

## 28. Telemetry Failure Behavior

The logger catches synchronous provider exceptions and the adapter consumes
async rejection, logs only sanitized error class/code/event name and never
awaits delivery in domain flow. Unit proof shows rejected delivery neither
throws nor contains the provider's private message.

## 29. Node Architecture

Root/application/emulator scripts use Node 20 (`.nvmrc = 20`). Functions
declare Node 22 in `functions/package.json`; Functions tests/build and all nine
critical Functions integrations were executed under Node 22.23.2.

## 30. Firebase Tooling

`firebase-tools` is an exact root dev dependency at `15.26.0`, recorded in the
lockfile. Local scripts use the repository binary; Functions scripts use
`../node_modules/.bin/firebase`; CI asserts `15.26.0` with `npx --no-install`.

## 31. Java

Java 21+ is mandatory for Rules emulation. Local preflight verified OpenJDK
21.0.12 without changing global configuration; CI uses Temurin 21.

## 32. CI Architecture

Five timeout-bounded jobs: static, root unit, Firebase Rules+integration,
Functions typecheck/test/build, and Functions critical integrations. Root jobs
use `.nvmrc`, Functions jobs Node 22, emulator jobs Java 21, installs are
deterministic, failures are blocking, and debug logs upload only on failure
with seven-day retention.

## 33. CI Commands

- `npm ci`, `npm run quality:static`, `npm run test`.
- Firebase version assertion, preflight, `npm run test:rules`,
  `npm run test:integration`.
- `cd functions && npm ci`, then typecheck, test and build.
- Explicit Functions integrations: firestore cleanup, storage cleanup,
  retained data, auth deletion, vault-key destruction, backend autonomy,
  fault injection, account-deletion reconciliation and commercial gate.

## 34. Lint / Quality Gate

Expo 56 flat ESLint config runs on affected lifecycle production/test surfaces.
Final result: 0 errors and 17 baseline warnings; warnings are visible, not
suppressed by CI. Static gate also runs TypeScript, i18n audit and a structural
CI audit. Two React hook rules incompatible with the inherited App routing
architecture are explicitly documented in config, not hidden per-file.

## 35. Opt-in Test Audit

All env-gated root Firestore suites are enabled by the aggregate command. All
nine emulator-critical Functions suites are explicit CI steps. The only
relevant environment-owned skip is the real Cloud KMS round trip, which
requires provisioned KEK/credentials and is not emulatable.

## 36. Long-Run Journeys

Pure deterministic tests cover Beginner→Intermediate, four earned Intermediate
cycles with promotion exactly on the fourth, three continuing Advanced cycles,
idempotent reevaluation, and exclusion of low-adherence renewal from earned
credit. Emulator journeys cover consecutive evolution/adaptation and future
progress; active-time tests cover US DST spring-forward/fall-back civil dates.

## 37. 8A Regression

| Invariant | Result |
|---|---|
| Immutable effective input snapshot | PASS |
| ProgramInstance-scoped progression window | PASS |
| Prescribed-opportunity adherence | PASS |
| Exact 70/85 and four-cycle boundaries | PASS |
| Role/session-aware equivalence and adaptation safety | PASS |

## 38. 8B Regression

| Invariant | Result |
|---|---|
| V2-only lifecycle authority | PASS |
| Post-workout/cold-start shared reconciliation | PASS |
| Stale prepare/CAS rejection | PASS |
| Partial migration recovery | PASS |
| prepare/defer/activate/adapt race convergence | PASS |

## 39. Emulator Environment

```text
Root Node: 20.20.2
Functions Node: 22.23.2
Java: OpenJDK 21.0.12
Firebase CLI: 15.26.0
OS: macOS 26.5.2 (arm64)
Project fixture: ajfit-rules-test (emulators only)
```

## 40. Test Matrix

| Suite | Result | Passed | Failed | Skipped | Environment |
|---|---|---:|---:|---:|---|
| Root static quality | PASS | all gates | 0 | n/a | Node 20 |
| Root unit | PASS | 3,955 | 0 | 101 opt-in | Node 20 |
| Root Firestore integration | PASS | 681 | 0 | 0 | Node 20/Java 21/Firebase 15.26.0 |
| Firestore Rules | PASS | 345 | 0 | 0 | real emulator |
| Storage Rules | PASS | 91 | 0 | 0 | real emulator |
| Functions unit | PASS | 1,179 | 0 | 39 opt-in | Node 22 |
| Functions critical integrations | PASS | 37 | 0 | 0 | Node 22/Java 21/real emulators |
| Functions typecheck/build | PASS | both | 0 | 0 | Node 22 |

## 41. Rules Matrix

| Collection | Ownership | Schema | Semantic Protection | Tests |
|---|---|---|---|---|
| lifecycle state | owner | closed | pointers, levels, transition | real emulator |
| training cycles | owner | closed | status, identity, current pointer | real emulator |
| program instances | owner | closed | active/superseded, snapshot | real emulator |
| events | owner | per-type closed | referents, promotion, append-only | real emulator |
| pending evolution | owner/current | closed incl. plan | source/target/status/deferral | real emulator |
| rollout config | readable | versioned app validation | client writes denied | real emulator |

## 42. Rollout Test Matrix

| Case | Result |
|---|---|
| OFF blocks real new enrollment | PASS |
| ON/100 enrolls via real hot path | PASS |
| 0/1/10/25/50/99/100 boundaries | PASS |
| UID bucket deterministic/sticky | PASS |
| Missing/malformed config fail closed | PASS |
| Existing V2 survives OFF | PASS |

## 43. Telemetry Test Matrix

| Case | Result |
|---|---|
| All required event names reach one adapter | PASS |
| Migration/reconcile/stale failure events | PASS |
| Callable exact schema/unknown-field rejection | PASS |
| Auth required and UID omitted | PASS |
| Adapter rejection non-blocking and sanitized | PASS |
| Unconfigured provider diagnostic | PASS |

## 44. CI Test Matrix

| Gate | Runtime | Blocking | Result |
|---|---|---:|---|
| typecheck/lint/i18n/CI audit | Node 20 | yes | PASS local |
| root unit | Node 20 | yes | PASS local |
| Firestore+Storage Rules/integration | Node 20 + Java 21 | yes | PASS local |
| Functions typecheck/test/build | Node 22 | yes | PASS local |
| nine Functions integrations | Node 22 + Java 21 | yes | PASS local |

## 45. Skipped Tests

The default unit reports include 101 root and 39 Functions tests skipped
because real-emulator suites are opt-in by design; every critical emulator
suite was subsequently executed and passed explicitly. `Cloud KMS round trip
(real KEK)` remains skipped without `PHOTO_VAULT_KMS_INTEGRATION=1` and
external credentials. No lifecycle, Rules, Storage or critical Functions
emulator test remains silently skipped.

## 46. Residual Search

- No silent no-op logger; only intentional fixed `provider_not_configured`
  diagnostic remains.
- No `continue-on-error`; the CI audit asserts its absence.
- No global/unpinned Firebase install; exact `15.26.0` is asserted.
- `ensureWorkoutLifecycleForLegacyActiveProgram` remains the internal
  deterministic migration primitive and direct test fixture, while production
  enrollment calls the gated composition.
- Env-gated suites are enumerated and mapped to aggregate/CI commands.
- Direct writes found by search are test/admin fixtures; production lifecycle
  writes remain centralized transactional services.

## 47. Files Changed

- Rollout/runtime: `workoutPrograms`, `workoutLifecycle`, rollout algorithm,
  fixtures and hot-path tests.
- Observability: telemetry contract/provider, App bootstrap, callable handler,
  Functions export and tests.
- Security: `firestore.rules` and lifecycle Rules test matrix.
- Toolchain/CI: `.nvmrc`, exact dependency/lockfile, Expo ESLint config,
  preflight, CI audit, operator helper and workflow.
- Regression: long-run/DST journeys plus existing 8A/8B emulator suites.
- Documentation: current overview/architecture, runbook, ADR-014 and this
  report. Other dirty files are inherited Fases 1–8B work and were preserved.

## 48. Documentation

`13_OPERATIONS_RUNBOOK.md` is now executable and authoritative. ADR-014 records
rollout/telemetry/Rules/toolchain boundaries. Overview, target architecture and
ADR index point to the production-hardened state. This report records evidence,
risks, test matrices and final readiness without rewriting domain semantics.

## 49. Acceptance Criteria

| ID | Criterion | Status |
|---|---|---|
| A | rollout config affects real enrollment hot path | PASS |
| B | rollout OFF blocks new V2 enrollment | PASS |
| C | rollout ON allows eligible enrollment | PASS |
| D | percentage rollout works | PASS |
| E | cohort is sticky by UID | PASS |
| F | 0% works | PASS |
| G | 100% works | PASS |
| H | existing V2 remains V2 when rollout becomes OFF | PASS |
| I | config failure fails safe for new enrollment | PASS |
| J | config failure does not break existing V2 | PASS |
| K | kill switch works without app deploy | PASS |
| L | rollback does not delete V2 data | PASS |
| M | runbook accurately describes real behavior | PASS |
| N | lifecycle state ownership protected | PASS |
| O | startingLevel immutable | PASS |
| P | cycle identity immutable | PASS |
| Q | invalid cycle status regression rejected | PASS |
| R | ProgramInstance identity immutable | PASS |
| S | superseded instance cannot become active illegally | PASS |
| T | events remain append-only | PASS |
| U | event create schema is semantically validated | PASS |
| V | pending status transitions validated | PASS |
| W | deferralCount invalid jumps rejected | PASS |
| X | pending target relationships validated where feasible | PASS |
| Y | embedded plan is not arbitrary unvalidated map | PASS |
| Z | prescription input snapshot protected | PASS |
| AA | rollout config cannot be modified by client | PASS |
| AB | cross-user read denied where expected | PASS |
| AC | cross-user writes denied | PASS |
| AD | unknown fields rejected | PASS |
| AE | Rules tests run in real emulator | PASS |
| AF | production telemetry provider is real | PASS |
| AG | progression_evaluated reaches provider adapter | PASS |
| AH | evolution_eligible reaches provider | PASS |
| AI | evolution_prepared reaches provider | PASS |
| AJ | evolution_deferred reaches provider | PASS |
| AK | evolution_activated reaches provider | PASS |
| AL | motivational_renewal reaches provider | PASS |
| AM | level_promoted reaches provider | PASS |
| AN | progression_failed reaches provider | PASS |
| AO | migration failures observable | PASS |
| AP | reconciliation failures observable | PASS |
| AQ | stale transition diagnostics observable | PASS |
| AR | payloads contain no unnecessary PII | PASS |
| AS | telemetry failure never blocks lifecycle | PASS |
| AT | failed lifecycle does not emit false success | PASS |
| AU | event contracts centralized | PASS |
| AV | production no longer silently defaults to no-op | PASS |
| AW | root Node version explicitly defined | PASS |
| AX | Functions Node version explicitly defined | PASS |
| AY | CI uses correct root Node version | PASS |
| AZ | CI uses Node 22 for Functions if required | PASS |
| BA | Java 21 explicitly configured | PASS |
| BB | Firebase CLI is pinned to exact version | PASS |
| BC | local integration command uses pinned CLI | PASS |
| BD | CI uses same pinned CLI | PASS |
| BE | npm ci/deterministic install used | PASS |
| BF | typecheck runs | PASS |
| BG | lint/quality gate runs | PASS |
| BH | unit tests run | PASS |
| BI | i18n audit runs | PASS |
| BJ | Firestore Rules run | PASS |
| BK | Storage Rules run | PASS |
| BL | progression integrations run | PASS |
| BM | prescription integrations run | PASS |
| BN | lifecycle integrations run | PASS |
| BO | migration integrations run | PASS |
| BP | concurrency integrations run | PASS |
| BQ | Functions typecheck runs | PASS |
| BR | Functions tests run | PASS |
| BS | Functions build runs | PASS |
| BT | critical Functions integrations run | PASS |
| BU | no continue-on-error in critical gates | PASS |
| BV | critical opt-in suites are explicitly executed | PASS |
| BW | logs/artifacts handled safely | PASS |
| BX | real rollout hot-path integration tested | PASS |
| BY | kill switch tested | PASS |
| BZ | config failure tested | PASS |
| CA | malicious owner Rules tests added | PASS |
| CB | cross-user CRUD matrix tested | PASS |
| CC | telemetry wiring tested | PASS |
| CD | telemetry failure behavior tested | PASS |
| CE | migration failure telemetry tested | PASS |
| CF | long-run Beginner→Advanced journey tested | PASS |
| CG | multiple Advanced cycles tested | PASS |
| CH | low-adherence/renewal journey tested | PASS |
| CI | adaptation long-run journey tested | PASS |
| CJ | 8A regressions remain green | PASS |
| CK | 8B concurrency regressions remain green | PASS |
| CL | skipped critical tests audited | PASS |
| CM | no critical emulator test silently skipped | PASS |
| CN | rollout procedure documented | PASS |
| CO | kill-switch procedure documented | PASS |
| CP | rollback procedure documented | PASS |
| CQ | health metrics documented | PASS |
| CR | incident triggers documented | PASS |
| CS | existing-V2 behavior during rollback documented | PASS |
| CT | credentials/secrets not committed | PASS |
| CU | production data not needed for CI | PASS |
| CV | operational diagnostics identify impossible states | PASS |
| CW | rollout state can be inspected safely | PASS |
| CX | progression math unchanged | PASS |
| CY | 8A safety semantics preserved | PASS |
| CZ | 8B lifecycle authority preserved | PASS |
| DA | Exercise Equivalence not redesigned | PASS |
| DB | UI redesign not introduced | PASS |
| DC | XP not implemented | PASS |
| DD | load progression not implemented | PASS |
| DE | push notifications not implemented | PASS |
| DF | no unrelated architecture migration | PASS |

## 50. Known Issues

- **SECURITY / NON-BLOCKING:** `npm audit --omit=dev` reports 20 transitive
  advisories (14 moderate, 6 high, 0 critical), primarily Expo/Metro build-time
  parsers plus nanoid/shell-quote. No direct lifecycle dependency or exposed
  server handler is implicated. Track an Expo-compatible upstream upgrade;
  do not force a breaking SDK resolution in 8C.
- **ENVIRONMENT:** real Cloud KMS round trip needs a provisioned test KEK and
  credentials; emulator-critical deletion/vault tests passed.
- **NON-BLOCKING:** lint has 0 errors and 17 visible baseline warnings; CI fails
  on errors and does not hide warnings.
- **ENVIRONMENT / FUTURE:** no device automation infrastructure exists; visual,
  accessibility and truthful UI verification belongs to 8D.
- **ROLLBACK:** no destructive rollback exists by design; rollback means stop
  new enrollment and preserve every V2 user.
- **OBSERVABILITY:** live rate/soak evidence cannot exist until staged traffic;
  thresholds and destination are ready.

No Phase 8C blocker remains.

## 51. Production Readiness

```text
Safe for internal testing? YES
```

All deterministic, unit, emulator, Rules, Functions and toolchain gates pass.

```text
Safe for staged rollout? YES
```

Enrollment is controlled, sticky, observable and reversible for new users;
semantic Rules and operational procedures are in place. Begin with internal/1%
and obey the documented holds and gates.

```text
Safe for 100% rollout? NO
```

Not immediately: first collect the prescribed staged soak, validate live Cloud
Logging rates/support signals and triage the transitive dependency advisories.
This is an operational promotion gate, not missing 8C implementation.

## 52. Remaining Scope for 8D

Device-level truthfulness of progress/evolution surfaces, loading/error/empty
states, accessibility, layout across supported screen sizes, animation/motion
comfort, localization visual QA and confirmation that copy never overstates
physiological progress. No progression math, rollout, telemetry, XP, load
progression or push feature belongs to 8D.

## 53. Final Verdict

FASE 8C COMPLETA
