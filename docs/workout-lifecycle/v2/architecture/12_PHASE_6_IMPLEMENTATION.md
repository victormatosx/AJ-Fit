# Phase 6 Implementation — Migration, Integration & Production Hardening

**Status:** IMPLEMENTED for Phase 6 scope
**Overall V2 Implementation:** PARTIAL (XP/gamification economy and the Program Adaptation questionnaire UI remain future work)

> Historical implementation record. Phase 8C supersedes its operational
> rollout, telemetry, Rules, CI, and toolchain recommendations; use
> `13_OPERATIONS_RUNBOOK.md` and `16_PHASE_8C_PRODUCTION_HARDENING.md` for the
> current production procedure.

> Fase 8D also supersedes the UI-hardening conclusion below: the linked
> `ConsistencyScreen` still contained a fixed July-2026 calendar. Fase 8D
> removed the route, replaced that screen with a truthful empty state, and
> removed the fixed Home/i18n preview data. See
> `17_PHASE_8D_UX_TRUTHFULNESS.md`.

## What this phase answers

> What happens when thousands of real users, including old accounts and two simultaneous devices, start using this?

## Audit result: most of the hard guarantees already existed

Phase 1 already built `ensureWorkoutLifecycleForLegacyActiveProgram` (`src/services/workoutLifecycle.ts`) as the lazy migration entry point, called from `loadActiveWorkoutProgram` (`src/services/workoutPrograms.ts`) exactly once per account, only when no V2 lifecycle exists yet. It was already:
- **Deterministic**: cycle/instance IDs derive from `v1-baseline:${contentIdentity}`, never `Math.random()`/`Date.now()`.
- **No-invented-history**: `cycleNumber: 1`, `progressionReason: 'V1_MIGRATION_BASELINE_NO_PRIOR_HISTORY_INFERRED'`, `historyCompleteFrom` recorded explicitly.
- **Concurrency-safe**: transaction-guarded, with a convergence catch for the emulator's PERMISSION_DENIED-instead-of-ABORTED edge case.
- **A true no-op once V2 exists**: the `!lifecycle` branch is the only caller, so an already-migrated account never re-enters this path.
- **Source-of-truth correct**: `loadActiveWorkoutProgram` always tries V2 first; the V1 pointer is only ever consulted to bootstrap.
- **Single progression authority**: `workoutProgression.ts`'s `applyProgression` already blocks V1's normal-rotation transition (`V2_LIFECYCLE_OWNS_ELIGIBILITY`) once a V2 lifecycle exists. Beginner Stage 1→2→3 (a within-Beginner volume ramp, not a cycle/level transition) stays ungated by design and flows through the same V2 `activateProgramInstance` deterministic-ID path, so it can never fork lifecycle identity.

Phase 6's job was therefore mostly **audit, test, and close gaps** — not rebuild.

## Real bugs found and fixed

Writing the dedicated concurrency suite (`workoutLifecycleConcurrency.integration.test.ts`) against the real emulator surfaced two genuine defects, not just missing test coverage:

1. **Defer/Defer**: two concurrent `deferPendingEvolution` calls can both pass the pure `canDefer` check against the same pre-write state. The loser's transaction commit is rejected by Firestore Rules (`deferralCount == resource.data.deferralCount + 1` no longer holds) as `PERMISSION_DENIED` — which the Firestore client SDK does **not** auto-retry (only `ABORTED` is retried). The function let this raw error escape uncaught. **Fix**: `deferPendingEvolution` now catches this, re-reads the shared `pendingEvolutions/current` doc, and converges on the winner's `DEFERRED` state instead of throwing — never inventing a second deferral.
2. **Adaptation vs Activation**: a concurrent safety-relevant `adaptWorkoutProgram` (LIMITATION) and `activatePendingEvolution` race for the same `programInstances`/`workoutLifecycleEvents` documents with genuinely different target content — `saveAndActivateWorkoutProgram`'s existing convergence check (built for identical-operation retries) correctly does *not* treat this as convergence, so the loser's raw error also escaped uncaught. **Fix**: `activatePendingEvolution` now catches this and re-checks whether its pending's source instance is now stale, returning `STALE_PENDING` (never activating superseded content) instead of crashing; `adaptWorkoutProgram` now catches it and safely retries once against the now-settled active instance (its `lifecycleIdempotencyKey` is derived only from the caller's own key, never a stale read), so the safety-relevant change is never silently dropped.

Both fixes were verified: the 4-race concurrency suite failed deterministically (not flakily) before the fix and passes deterministically after, with zero regressions across the full 657-test Firestore integration sweep.

## Migration Strategy

```
V2 exists and valid  →  use V2 (source of truth, always)
V2 absent            →  inspect V1 (questionnaire experienceLevel + active program)
                      →  deterministic V2 baseline (cycle 1, V1_MIGRATION_BASELINE)
                      →  use V2
```

Already-implemented; Fase 6 added a migration matrix proving it for every starting level (`workoutLifecycle.integration.test.ts`: Beginner/Intermediate/Advanced baselines, "already-V2 is a no-op even if the V1 pointer drifts").

## Legacy Mapping

| Legacy state | Known facts | V2 baseline | Unknown preserved as |
|---|---|---|---|
| V1 Beginner (any adaptationStage) | `experienceLevel = beginner`, active program | `startingLevel = currentTrainingLevel = BEGINNER`, cycle 1 | `progressionReason: ..._NO_PRIOR_HISTORY_INFERRED` — adaptationStage is never read as a level/cycle signal |
| V1 Intermediate | `experienceLevel = intermediate`, active program | `startingLevel = currentTrainingLevel = INTERMEDIATE`, cycle 1 | earned-cycle count NOT fabricated — `earnedIntermediateCycleCount` starts at 0 for this baseline cycle |
| V1 Advanced | `experienceLevel = advanced`, active program | `startingLevel = currentTrainingLevel = ADVANCED`, cycle 1 | prior cycle count NOT fabricated |
| V1 reused `programId` (reactivated) | latest `programId`/`prescriptionId` | one baseline `ProgramInstance`/`TrainingCycle` for the current activation only | earlier activations are NOT reconstructed as separate historical instances |

## No-Invented-History Proof

`ensureWorkoutLifecycleForLegacyActiveProgram` writes exactly one cycle (`cycleNumber: 1`) and one instance per account, ever, regardless of how the input describes the account's real-world history. `rejects incomplete legacy input instead of inventing a starting level` (existing Phase 1 test) proves a missing `questionnaireExperienceLevel` throws rather than guessing. No code path anywhere derives a cycle count, earned-level count, or historical `ProgramInstance` list from `adaptationStage`, program age, or V1 progression events.

## ProgramId Reuse

V1 could reactivate the same `programId` across unrelated activation periods. V2's `ProgramInstance`/`TrainingCycle` identity is derived from the *current* activation's stable operation key (`v1-baseline:${contentIdentity}`), not from `programId` reuse — so a reused `programId` never collapses two real activation periods into one, nor fabricates two instances for one. The baseline only ever represents "the account's current activation, no earlier history claimed."

## Idempotency

All migration/activation/deferral IDs are FNV-1a hashes (`lifecycleStableHash`) of stable business keys (`v1-baseline:${contentIdentity}`, `activation:${idempotencyKey}`, evolution idempotency keys) — never `Math.random()`, never `Date.now()` as identity.

## Dual Read / Dual Write

Dual-read exists only at `loadActiveWorkoutProgram`'s bootstrap moment (V2 checked first, V1 consulted only if V2 absent) — documented above. No permanent dual-write exists or was introduced: once a `ProgramInstance` activates, `workoutProgramState/active` is written only as a compatibility mirror alongside the V2 write, in the same transaction, never as an independent V1 source of truth.

## Progression Authority

Already covered above (audit result). Fase 6 did not need to change this; it re-verified and documented it.

## Feature Flag / Rollout

`src/workoutLifecycle/rollout.ts` (pure) + `loadWorkoutLifecycleRolloutConfig`/`ensureWorkoutLifecycleV2` (`src/services/workoutLifecycle.ts`) implement a deterministic sticky-cohort gate:
- `stickyRolloutBucket(uid)`: deterministic 0-99 bucket via `lifecycleStableHash`, stable across launches and percentage changes.
- `isEligibleForNewMigration(uid, config)`: `enabled=false` or missing config → ineligible (fail-closed for new migrations only).
- Config source: `workoutLifecycleRolloutConfig/active` Firestore doc — same "Admin-SDK-write-only, client-readable" pattern as `limitationDatasetState`, reusing existing infra rather than a new flag service (docs §32).
- **Structural guarantee**: `ensureWorkoutLifecycleV2` checks `loadWorkoutLifecycle` *before* consulting the rollout config — an account with a valid V2 lifecycle short-circuits to `ALREADY_V2` and never reaches the rollout check. Reducing the rollout percentage can never move an already-migrated user back to V1 (this is enforced by control flow, not by convention).

**Not wired into the live `loadActiveWorkoutProgram` hot path.** This codebase has no parallel V1-only execution/schedule/progression runtime — `WorkoutProgramSnapshot.programInstanceId`/`trainingCycleId` are relied on throughout Phases 1-5 as always-present once a program exists. Building a genuine V1-only fallback stack to make the gate safe to flip off mid-migration would be a second, competing architecture (forbidden by docs §0) and disproportionate to what a pre-100%-rollout posture actually needs for this app. The gate is fully implemented, tested (11 pure unit tests + 2 Rules tests), and ready to wire in at the one call site (`workoutPrograms.ts:373`) if/when the team decides to stage rollout below 100% for new accounts; today's honest recommendation (see Rollout below) is to ship at 100% given the extensive existing test coverage, and treat the flag as the mechanism for an emergency "stop new enrollment" kill switch rather than a staged percentage ramp.

## Rollout Strategy (recommended)

```
100% (recommended) — every new account gets `ensureWorkoutLifecycleForLegacyActiveProgram`
  unconditionally, exactly as it has since Phase 1. Justification: the
  migration path has 8 dedicated integration tests (concurrency, no-invented-
  history, all 3 starting levels, already-V2 no-op) plus the entire Phase
  1-5 test suite exercising it indirectly on every single test run.
```

If the team wants a staged ramp instead, wire `ensureWorkoutLifecycleV2` into `loadActiveWorkoutProgram`'s `!lifecycle` branch and set `workoutLifecycleRolloutConfig/active` to `{enabled: true, percentage: N}`, raising `N` while watching the health signals below.

**Health signals to watch before raising rollout:**
- `progression_failed` rate with `stage: 'MIGRATION'` (once wired — see Telemetry).
- Firestore Rules permission-denied rate on `workoutLifecycleState`/`programInstances`/`trainingCycles` writes.
- Any `workoutLifecycleState` document failing `isWorkoutLifecycle` validation on read (`WORKOUT_LIFECYCLE_INVALID`) or a missing referent (`WORKOUT_LIFECYCLE_REFERENT_MISSING`).

## Rollback Strategy

**Stop new enrollment**: set `workoutLifecycleRolloutConfig/active.enabled = false` (if wired) — never deletes or mutates any already-migrated account's `workoutLifecycleState`/`trainingCycles`/`programInstances`/`workoutLifecycleEvents`. No schema rollback is required or safe: Firestore Rules validating these collections must stay in place for as long as any V2 document exists, which is permanent once the first account migrates.

**Never**: delete a user's V2 lifecycle documents, revert `firestore.rules`' V2 collections, or force a migrated account's `loadActiveWorkoutProgram` back onto the V1-only path — none of these are reversible without genuine data loss (the V1 `workoutProgramState/active` mirror is not re-derived retroactively for old activations).

## Firestore Rules Audit

| Collection | `hasOnly` | Ownership | Immutable identity | Cross-user tested | Tested this phase |
|---|---|---|---|---|---|
| `workoutLifecycleState` | yes | `isOwner` | `startingLevel` (pre-existing test) | yes (pre-existing) | re-verified |
| `trainingCycles` | yes | `isOwner` | `cycleId`/`level`/`cycleNumber`/`origin`/`startedAt`/`createdAt` | via lifecycle | re-verified |
| `programInstances` | yes | `isOwner` | all but `supersededAt`/`updatedAt` | via lifecycle | re-verified |
| `workoutLifecycleEvents` | yes | `isOwner` | append-only (`allow update, delete: if false`) | pre-existing test | re-verified |
| `pendingEvolutions` | yes | `isOwner`, `pendingId=='current'` | `pendingEvolutionId`, deferral increments by exactly 1 | **new this phase** | **new**: unknown-field rejection, invalid status/type/deferralCount rejection, cross-user read/write rejection, deferral-skip rejection |
| `workoutLifecycleRolloutConfig` | n/a (single scalar doc) | Admin-SDK-write-only | n/a | **new this phase** | **new**: client read-only, client write rejected |

## Account Deletion

Deletion is origin-agnostic by construction (`resources.ts` deletes by collection membership, not by `initializationOrigin`), so the existing `seedFullUser` proof already covers a migrated account — its `workoutLifecycleState` doc has the exact same shape whether `initializationOrigin` is `V1_MIGRATION_BASELINE` or `V2_NATIVE`. No new test was needed to prove this.

## Emulator Infrastructure

- `scripts/checkJavaVersion.cjs` — preflight that fails fast with an actionable message (not a cryptic emulator crash) if `java -version` resolves to below JDK 21. Never touches the machine's global Java config.
- `npm run test:integration:preflight` runs it standalone; `npm run test:rules` and the new `npm run test:integration` both run it first automatically.
- `npm run test:integration` — the reproducible local command this phase's spec asked for (§63): one emulator session, all 13 root Firestore-emulator integration suites (including the new concurrency and migration-matrix tests) run serialized (`--no-file-parallelism`, required — parallel vitest workers against one shared emulator caused cross-file transaction-lock contention). Verified: 50 files, 661 tests, all pass.
- `.nvmrc` pins Node 20 for reproducible `actions/setup-node` resolution in CI.
- Documented here (this file) rather than a new root `README.md`, consistent with this project's existing convention of keeping Workout Lifecycle documentation under `docs/workout-lifecycle/v2/`.

## CI

`.github/workflows/ci.yml` (new — none existed before this phase): `static` (typecheck + i18n), `unit` (root vitest), `firebase-integration` (Rules + `test:integration`, JDK 21 via `actions/setup-java`, a repository-pinned Firebase CLI), `functions` (typecheck/test/build), `functions-integration` (account-deletion Firestore/Storage/Auth emulator suites). No job depends on production Firebase credentials — every job uses the emulator suite and the `ajfit-rules-test` fixture project. No `continue-on-error` on any test step. Phase 8C later fixed that CLI to exact version `15.26.0` and expanded the explicit suites.

## Telemetry

`src/workoutLifecycle/telemetry.ts` — mirrors the existing no-op pluggable-logger pattern from `src/onboarding/onboardingAnalytics.ts` (this codebase has no analytics provider wired up yet for either surface). `logWorkoutLifecycleEvent` never throws, so a broken/misconfigured logger can never break a real lifecycle transition.

| Event | Trigger | Payload | PII? |
|---|---|---|---|
| `progression_evaluated` | every `evaluateProgressionV2ForUser` call | `trainingLevel`, `decisionType` | no |
| `evolution_eligible` | `prepareEvolution` finds a real decision | `type`, `quality`, `fromLevel`, `toLevel`, `cycleNumber` | no |
| `evolution_prepared` | pending evolution persisted | `evolutionType` | no |
| `evolution_deferred` | `deferPendingEvolution` succeeds (including the converged-race case) | `deferralCount`, `evolutionType` | no |
| `evolution_activated` | `activatePendingEvolution` succeeds | `trigger` (MANUAL/AUTO), `evolutionType`, `quality` | no |
| `level_promoted` | activation type is LEVEL_PROMOTION | `from`, `to` | no |
| `motivational_renewal` | activation type is MOTIVATIONAL_RENEWAL | `trigger` | no |
| `progression_failed` | `prepareEvolution`'s `evolvePrescription` fails | `stage: 'PREPARATION'`, `errorCategory`, `retryable` | no |

Only technical IDs/enums/booleans — no name, email, free-form limitation text, or questionnaire content in any payload. `workoutLifecycleEvents` (the domain ledger) remains the only source of historical truth; nothing here is ever read back to make a domain decision.

## UI Hardening — CONSISTENCY_MOCK / MOCK_DATE resolved

Both Fase 5 Known Issues are now resolved, not re-deferred:
- **`MOCK_DATE`**: replaced with today's real date, locale-formatted via `Intl.DateTimeFormat` (same pattern already used in `SubscriptionCenterScreen.tsx`). The fabricated "Semana 04/12" program-week counter was **removed**, not replaced with a real number — Cycle Evolution has no fixed week-count duration to report honestly.
- **`CONSISTENCY_MOCK`/`CONSISTENCY_MOCK_STATES`**: the fake done/rest/today/future weekly strip and the fake "4/5" completion count were **removed**. HomeScreen has no real per-day completion data wired in (that would need a new week-scoped executions query — genuine new feature work, out of a hardening phase's scope per docs §137/§140). Rather than fabricate it, the card is now a plain entry point into `ConsistencyScreen`, which was confirmed (via source audit — zero MOCK markers) to already render real data.

## Residual Placeholder Audit

Grepped for `MOCK`, `HARDCODED`, `TODO`, `FIXME`, `TEMP`, `FAKE`, `Math.random`, XP/streak/PR/volume/consistency/nextLevel literals across `src/`. Zero remaining production-visible fakes in the Workout Lifecycle surfaces. The 11 pre-existing hardcoded strings flagged by `npm run i18n:audit` (Paywall promo-code UI, Settings developer-menu label, a dev-only picker sheet) are unrelated to Workout Lifecycle and explicitly out of scope for this phase.

## Deliberately not implemented

XP engine, achievement persistence, leaderboards, push notifications, the Program Adaptation questionnaire UI, automatic load progression, RPE/RIR progression — none exist anywhere in the codebase (confirmed by the same residual audit). Progression math, prescription evolution rules, and deferral semantics (28/14-day windows, 70%/85% thresholds, 4 earned Intermediate cycles) were not touched.
