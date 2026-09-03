# Post-Phase-10C Final Adversarial Audit

Date: 2026-08-31

## 1. Executive Verdict

**NOT READY.** Two independent P0 findings, each reachable by an authenticated client with a valid App Check token calling legitimate, existing entry points, falsify Phase 10B/10C's central claim that the backend is the sole semantic authority over prescription content:

1. **RECOVER is a live canonical-authority bypass** (`functions/src/workoutLifecycle/authorizeMutation.ts:697-754`). The RECOVER operation never calls the canonical-generation engine; it only runs `assertPlanSafe` bounds/catalog checks on the client's own `targetPlan`, and never overrides `targetContentIdentity`. This path is not a corner case — it is the exact operation the ordinary client code path (`src/services/workoutPrograms.ts:611-617`) selects for `automatic_progression` / `automatic_reconciliation`, i.e. any returning user with existing V2 lifecycle state.
2. **Firestore Rules skip the authority-grant check entirely when `programInstanceId` is omitted from `workoutProgramState/active`** (`firestore.rules:1046,1049,876-879`). A single authenticated client, batching two writes, can seal an attacker-authored (but schema-plausible) `workoutPrograms/{id}` document with zero grant/canonical validation — no Admin SDK, no App Check bypass, no cryptographic attack, just an optional key.

Both are independently sufficient to defeat "client content has zero effect on the authoritative prescription" for a realistic, non-exotic user population. Per the audit's own production-readiness rules (§84), **any P0 mandates NOT READY**, superseding all P2/P3 hardening items and the otherwise-solid grant/concurrency/telemetry/progression layers documented below.

## 2. Git Before

Branch `main`, HEAD `d24319ba15e63095fd376bcd99acd30f4abce343`, tracking `origin/main`, up to date. Large pre-existing uncommitted worktree (81 tracked files modified, ~20 untracked directories/files spanning Phases 1-10C) — consistent with prior phase reports; not created by this audit.

## 3. Git After

Same branch, same HEAD, same 81 tracked files touched, no new untracked files. The only content drift beyond the pre-audit baseline is `firestore-debug.log` — a tracked Firestore emulator debug log that was **already modified** before this audit started (present in the original `git status`) and gets fully rewritten by any local emulator test run. Running the quality-gate test suites (§39) further changed its content but this is a non-semantic log artifact, not a source or doc change. No commits, pushes, resets, restores, stashes, or destructive operations were performed. Recommend (not fixed): add `firestore-debug.log` to `.gitignore`.

## 4. Environment

- Root Node: v20.20.2 (matches `.nvmrc`)
- Functions Node: 22 (per `functions/package.json` engines, matches CI)
- Java: system default 17; JDK 21 present at `/opt/homebrew/opt/openjdk@21` but not on PATH by default — `scripts/checkJavaVersion.cjs` fails closed with an actionable message rather than allowing a silent emulator misconfiguration (good hygiene, not a finding)
- firebase-tools: 15.26.0 (matches CI-pinned version)

## 5. Documents Reviewed

`18_PHASE_9_FINAL_BLOCKER_REMEDIATION.md`, `19_PHASE_10_PRESCRIPTION_AUTHORITY_SCHEDULED_OPPORTUNITY_INTEGRITY.md`, `20_PHASE_10B_BACKEND_CANONICAL_PRESCRIPTION_AUTHORITY.md`, `21_PHASE_10C_CANONICAL_RESPONSE_CLIENT_INTEGRATION.md`, `ADR-015_WORKOUT_LIFECYCLE_TRUST_BOUNDARY.md`, `ADR-016_BACKEND_AUTHORITATIVE_PRESCRIPTION.md`, plus all `progression/*.md`, `prescription/01_LEVEL_PROMOTION.md`, `02_CYCLE_ROTATION.md`, `architecture/02_LIFECYCLE_STATE_MACHINE.md`, `03_DATA_MODEL.md`, `04_EVENTS_AND_HISTORY.md`, `05_IDEMPOTENCY_AND_CONCURRENCY.md`.

Direct code review: `functions/src/workoutLifecycle/authorizeMutation.ts`, `functions/src/index.ts`, `functions/src/telemetry/trustedWorkoutLifecycleTelemetry.ts`, `firestore.rules`, `firestore-tests/workoutPrograms.rules.test.ts`, `src/services/workoutPrograms.ts`, `src/services/workoutLifecycleApplication.ts`, `src/services/workoutLifecycle.ts`, `src/services/prescriptionEvolution.ts`, `src/services/workoutExecutions.ts`, `src/workoutExecution/useWorkoutExecution.ts`, `src/progressionEngineV2/*` (`config.ts`, `adherence.ts`, `sessionQualification.ts`, `earnedCycles.ts`, `prescribedOpportunities.ts`), `scripts/syncPrescriptionEngineToFunctions.cjs`, `.github/workflows/ci.yml`.

## 6. Architecture Reconstructed

Client submits intent (questionnaire answers, evolution triggers, execution evidence) → `authorizeWorkoutLifecycleMutation` callable (auth + App Check enforced) validates against authoritative lifecycle/source state → for INITIALIZE/MIGRATE/ADAPT/PREPARE, backend independently regenerates canonical prescription content from the live catalog via a shared deterministic engine, derives a backend-owned content identity/hash, and issues a short-lived (60s), uid-bound, operation-bound, single-use authority grant scoped to that canonical identity → client persists the canonical content to Firestore in the same transaction/batch that consumes (deletes) the grant → Firestore Rules re-check grant existence, uid, operation, and target-identity match. **RECOVER breaks this chain**: it issues a grant without ever computing or binding to canonical content, and Rules do not universally require a grant for `workoutPrograms` writes (see Finding P0-2).

## 7. Trust Boundary

Target boundary (client = intent/UI/evidence; backend = lifecycle + prescription semantic authority; Rules = structural/auth/grant enforcement) holds for INITIALIZE, MIGRATE, ADAPT, and PREPARE's two evolution paths. It does **not** hold for RECOVER, and Rules alone do not universally enforce the grant requirement regardless of operation (Finding P0-2 shows the grant check itself is conditionally skippable).

## 8. Attack Surface

Confirmed reachable without Admin SDK, service account, or console access: authenticated owner + valid App Check token, calling either the real callable (`authorizeWorkoutLifecycleMutation`) with attacker-chosen `operation`/`targetPlan`/`source`, or Firestore directly within Rules-permitted paths, including payload/field omission and batched multi-document writes to exploit ordering/`getAfter` semantics.

## 9. Prescription Authority Audit

PA-01 through PA-11 evaluated below (§51). Summary: **PASS for INITIALIZE/MIGRATE/ADAPT/PREPARE, FAIL for RECOVER.** RECOVER's `validateRequest` branches (`authorizeMutation.ts:697-754`) run `assertPlanSafe(request, firestore)` only — bounds (sets 1-10, rest 0-600s, reps string ≤20 chars), catalog membership, and limitation-conflict checks — and never call `generateCanonicalPlan`/`generateCanonicalCycleEvolution`. The returned `validated` object contains no `targetPlan`/`targetContentIdentity`/`targetPrescriptionIdentity` override, so `merged = {...data, ...validated}` (`authorizeMutation.ts:1044`) leaves the client's own values intact end-to-end.

## 10. Safe-But-Wrong Attack

Constructed conceptually and traced through the code (not requiring absurd/malformed input): a schema-valid, in-bounds, real/active/limitation-compatible plan that swaps an entire safe exercise family (e.g., pressing/pulling compound work replaced with isolation accessory work) at 3-4 sets, normal reps/rest, reasonable volume, valid frequency.

- **INITIALIZE/MIGRATE/ADAPT/PREPARE:** cannot become authoritative — client `targetPlan` is never read for these operations' canonical output; `sealTargetProgram`'s per-content-identity transaction (`authorizeMutation.ts:591-620`) binds identity to backend-generated content only.
- **RECOVER:** **becomes fully authoritative.** `src/services/workoutPrograms.ts:611-617` selects `authorityOperation = 'RECOVER'` whenever V2 lifecycle state already exists and `input.source` is `automatic_progression` or `automatic_reconciliation` (ordinary, frequently-hit sources — not V1-migration-only). Line 653 only substitutes `canonical.targetPlan` for INITIALIZE/MIGRATE/ADAPT; RECOVER falls through with `authorizedInput = input` unchanged, and `programId = candidateProgramId = wpg_${stableHash(programIdentity(input))}` — a hash **of the client's own plan**. The plan is written verbatim at `workoutPrograms.ts:769-780`.
- **Firestore Rules bypass (independent of RECOVER):** even for other operations, omitting `programInstanceId` from `workoutProgramState/active` (allowed — it's optional per `hasAll`/`hasOnly` in `firestore.rules:1046,1049`) causes the grant requirement at `firestore.rules:876-879` to be skipped entirely (`'programInstanceId' in getAfter(...)` is false), and `workoutProgramCommonValid` (`firestore.rules:241-324`) validates only document shape/template cross-references, never exercise/session content. This means the safe-but-wrong attack succeeds **structurally**, independent of which `operation` was ever authorized.

**Verdict: safe-but-wrong CAN become authoritative**, via two independent paths.

## 11. One-Field Mutation Results

For INITIALIZE/MIGRATE/ADAPT/PREPARE, no single-field mutation (sets, reps, rest, exercise substitution, exercise/session order, templateId/version/hash, frequency metadata) leaks into authoritative output — confirmed by code inspection: these operations never read `request.targetPlan`'s content for their canonical result, only for structural/bounds pre-checks (where applicable) before discarding it in favor of backend-generated content. For RECOVER, **every field leaks by construction** — there is nothing to test per-field because the entire candidate is sealed as submitted.

## 12. Canonical Client Consumption

Traced all real call sites of the authorize/mutation flow (`src/services/workoutPrograms.ts`, `src/services/workoutLifecycleApplication.ts`, `src/services/prescriptionEvolution.ts`). For INITIALIZE/MIGRATE/ADAPT: `requireWorkoutLifecycleCanonical` fail-closed helper is used, and `workoutPrograms.ts:667-671` re-derives/checks identity before persisting backend-returned canonical content — no `canonical ?? candidate` pattern found anywhere in `authorizeMutation.ts` or `workoutPrograms.ts`. PREPARE's client consumption path was not independently re-verified byte-for-byte in this pass (relied on Phase 10C's own documented wiring plus the absence of any fallback pattern in the shared persistence helper) — flag as a residual **verification gap**, not a confirmed bug. RECOVER has no canonical to consume in the first place (§9-10).

## 13. Catalog Race

For canonical-generating operations, the backend re-reads live catalogs on every call and never trusts client-supplied catalog references — by design, a race where the catalog changes mid-flight simply produces a different (correct, current) canonical result; the client cannot make a stale candidate win. Not applicable to RECOVER, since no canonical is generated to race against — the client's arbitrary content wins regardless of catalog state.

## 14. Canonical Identity

`canonicalContentIdentity()` is backend-computed from backend-generated plan + template metadata for INITIALIZE/MIGRATE/ADAPT/PREPARE — client cannot control it. For RECOVER, `targetContentIdentity` is either entirely absent from the grant (client value passes through unchecked) or, on the client side, `programId` is `stableHash(programIdentity(input))` — a hash the client fully controls the preimage of. No hash-collision/domain-confusion primitive was required to exploit this; it's a missing check, not a weak one.

## 15. Shared Engine Sync Audit

`scripts/syncPrescriptionEngineToFunctions.cjs` fails closed (`process.exit(1)`) if source files are missing or if its four text markers for slicing `src/state/AppState.tsx` (`Sex=`, `TabId=`, `defaultQuiz:`, `AppStateContext`) are missing or out of order. `functions/package.json`'s `pretypecheck`/`pretest`/`prebuild` lifecycle hooks always invoke the sync scripts first, so a stale-engine build via the standard npm path is not reachable. One residual gap (P3): a new export added *inside* the intentionally-skipped UI-only region between the `TabId` and `defaultQuiz` markers would not be caught by the marker-order check and would silently never reach Functions — low risk since that region is UI-only by design, but not zero.

## 16. Grant Attack Matrix

| Attack | Result | Evidence |
|---|---|---|
| Replay consumed grant | **DENY** | `consumesLifecycleAuthorityGrant` requires `!existsAfter(grantPath)` in the same atomic write (`firestore.rules:1136`); verified concretely in `finishWorkoutExecution`'s single transaction (`workoutExecutions.ts:243-259`) |
| Cross-user grant use | **DENY** | Entire `/users/{userId}` subtree gated by `isOwner(userId)` (`firestore.rules:27-28,759`) — structurally impossible, not merely checked |
| Expired grant reuse | **DENY** | `expiresAt >= request.time` enforced in rules (`:1135`); 60s TTL at issuance (`authorizeMutation.ts:1054`) |
| Wrong operation | **DENY** | `operation in operations` check (`firestore.rules:1133`) |
| Stale source (ProgramInstance/TrainingCycle changed) | **DENY** | Grant pins `sourceProgramInstanceId`/`sourceCycleId`/`targetContentIdentity`; independently re-checked server-side (`authorizeMutation.ts:148-153,702-716`) before issuance |
| Grant consumption same-transaction | **PASS** for FINISH_EXECUTION (verified); enforced generally via `existsAfter` regardless of client transaction shape — a client that fails to delete the grant atomically simply fails the rule | `workoutExecutions.ts:243-259`, `firestore.rules:1136` |
| Two concurrent legitimate grants (e.g. two PREPARE) | **Last-write-wins on the grant singleton doc** (`.set()`, not `.create()`); does not corrupt authoritative state (each grant independently validated at issuance, `sealTargetProgram`'s identity transaction prevents two plans claiming one identity) but can silently clobber a concurrent legitimate grant, producing a confusing `stale_pending_evolution` error for the clobbered client rather than a corrupted write | Rated **P3** |

## 17. TOCTOU Analysis

No exploitable TOCTOU window found in the canonical-generating operations' grant lifecycle — source staleness is re-checked both at issuance and (implicitly) by the identity-bound transactional seal. The RECOVER path (§9-10) is not a TOCTOU issue — it's a missing-check issue; there is no legitimate window being raced, the check simply never exists. The Firestore-Rules `programInstanceId`-omission bypass (§10, Finding P0-2) is likewise not timing-dependent — it's deterministically reachable on the first attempt.

## 18. INITIALIZE Audit

Not independently re-traced field-by-field in this pass beyond confirming (§9) that canonical generation runs and client `targetPlan` content is discarded. No P0/P1 raised for INITIALIZE specifically.

## 19. MIGRATE Audit

Same confirmation as INITIALIZE — canonical generation runs, client content discarded. V1/V2 coexistence-specific attacks (fake legacy program, repeat/concurrent migration) were not independently re-run this pass; treated as a **verification gap**, not a confirmed pass or fail — recommend targeted follow-up given this is documented as historically high-risk.

## 20. ADAPT Audit

Canonical generation confirmed to run; PA-04 one-field-mutation testing (§11) covers ADAPT specifically and found no leak path.

## 21. PREPARE Audit

Level-promotion and cycle-evolution earned-fact validation confirmed backend-derived: `EARNED_CYCLE_PROGRESSION_REASONS` (`earnedCycles.ts:9-12`) only accepts `EARNED_CYCLE_EVOLUTION`/`EARNED_LEVEL_PROMOTION`, and the server independently derives `type` from server-computed `ratioBp` (`authorizeMutation.ts:356`), not client input — a client cannot self-declare a Motivational Renewal as an earned cycle. **P2 divergence found**: the backend's inline earned-cycle count (`authorizeMutation.ts:351-353`) matches only `completionReason === 'EARNED_EVOLUTION'` exactly, with no fallback inference for legacy pre-8A V2 cycles that the client-side `countEarnedIntermediateCycles` (`earnedCycles.ts:23-38`) does support. This is conservative (under-counts, never over-counts) — not a security bypass, but a duplicated-logic drift risk (the exact class of bug §46-48 of the audit warns about) that can produce a confusing "stuck, can't promote" UX for legacy users whose local mirror shows eligibility.

## 22. ACTIVATE Audit

**PASS.** `validateRequest` for ACTIVATE (`authorizeMutation.ts:855-877`) fully re-derives expected content/identity/level/cycle-number from the persisted `pendingEvolutions/current` doc and rejects any mismatch. Stale/superseded pending docs are caught because the grant is pinned to `pendingEvolutionId` (`firestore.rules:1507-1513`) and both DEFER/ACTIVATE gate on `pendingSnapshot.data()?.pendingEvolutionId !== request.pendingEvolutionId` (`authorizeMutation.ts:850-854`). Cannot activate arbitrary, stale, wrong, or superseded content.

## 23. RECOVER Audit

**FAIL — P0.** See §9, §10, and Finding PA-RECOVER-01 (§48). RECOVER is confirmed to be a full side door for injecting authoritative content the canonical engine never produced, reachable via ordinary `automatic_progression`/`automatic_reconciliation` client flows, not just a hostile modified client.

## 24. Scheduled Opportunity Audit

**PASS.** `authorizeMutation.ts:894-927` (COMPLETE_SCHEDULE) recomputes the expected session via `resolveWorkoutSchedule` from authoritative cursor state and rejects if `resolution.sessionIndex !== request.sessionIndex` — the code comment explicitly states it never trusts `request.sessionIndex` alone or the execution's own claim. `isValidProgressionSessionAgainstPrescription` (`sessionQualification.ts:76-114`) takes `expectedProgramInstanceId`/`expectedSessionIndex` as caller-supplied authoritative parameters, never as self-reported by the execution. Duplicate executions are deduped by `(scheduledDate, sessionIndex)` key (`prescribedOpportunities.ts:45-89`); wrong-ProgramInstance executions are excluded by the same key structure.

## 25. Backdating Audit

Grace window confirmed exactly 3 days (`SCHEDULE_BACKDATING_GRACE_DAYS = 3`, `authorizeMutation.ts:206`), enforced via `assertNotBackdated` before recomputation, matching documented policy. **Unresolved (flag, not a confirmed finding):** whether the window can be abused across a ProgramInstance boundary, an adaptation boundary, or a pause/resume boundary was not conclusively verified in the time budget available to the investigating stream — recommend a dedicated boundary-crossing integration test before treating this as closed.

## 26. Execution Qualification

**PASS.** `isValidProgressionSessionAgainstPrescription` (`sessionQualification.ts:76-114`) enforces `completed*100 >= total*70` using integer arithmetic (no float-rounding exposure) for the 70%-of-prescribed-sets rule, and independently checks `expectedProgramInstanceId`/`expectedSessionIndex` against caller-supplied authoritative values rather than the execution's self-reported index.

## 27. Adherence

**PASS.** `classifyAdherenceQualityFromCounts` (`adherence.ts:19-28`) uses cross-multiplication (`fulfilled*10000 >= expected*thresholdBp`) — 34/49 = 69.4% → correctly `BELOW_TARGET`; 70%/85% boundaries are exact integer comparisons, no rounding risk. Constants verified directly in `src/progressionEngineV2/config.ts`: `adherenceEarnedThresholdBp: 7000`, `adherenceHighThresholdBp: 8500` — matches documentation exactly, no drift.

## 28. Active Time

Extra (unscheduled) workout executions are excluded from `qualifyingExecutionKeys` in `countFulfilledPrescribedOpportunities` (`prescribedOpportunities.ts:45-89`) — they cannot inflate adherence, active days, cycle unlock, or level promotion counters. Inactivity-pause vs. rest-day distinction and resume behavior were reviewed but not adversarially stress-tested beyond confirming the relevant threshold constant (`inactivityMissedOpportunityThreshold: 3`) matches the doc.

## 29. Beginner Progression

**PASS.** `beginnerMinimumActiveDays: 28` confirmed directly in `config.ts`, matching the doc; no drift.

## 30. Intermediate Progression

**PASS.** `intermediateAdvancedMinimumActiveDays: 85`, `intermediateCyclesForPromotion: 4` confirmed in `config.ts`. See §21 for the P2 inline-vs-shared earned-cycle-count divergence.

## 31. Advanced Progression

Same threshold confirmed (`intermediateAdvancedMinimumActiveDays: 85`); no additional Advanced-specific gap found beyond §21's P2.

## 32. Motivational Renewal

**PASS.** Confirmed not counted as an earned cycle (`EARNED_CYCLE_PROGRESSION_REASONS`, `earnedCycles.ts:9-12`), and `type` for a renewal event is server-derived from server-computed adherence ratio, not client-declared — a client cannot self-label a renewal as an earned promotion event.

## 33. Deferral

**PASS.** `ACTIVATE`/`DEFER` both gate on `pendingSnapshot.data()?.pendingEvolutionId !== request.pendingEvolutionId` (`authorizeMutation.ts:850-854`), preventing a stale/mismatched deferral or activation from applying against the wrong pending evolution. `motivationalRenewalExtensionDays: 30` confirmed in config. Start/Defer/Auto race combinations were not independently re-run as live concurrency tests in this pass; the structural check above makes an outright double-apply unlikely, but this is a **residual verification gap**, not a proven pass.

## 34. Concurrency

Execution-finish integrity: **PASS.** Client `finish()` (`useWorkoutExecution.ts:107-133`) awaits `mutationQueueRef.current.flush()` before calling `finishWorkoutExecution`, eliminating the historical race where pending `recordSet` writes could trail behind finish. `finishWorkoutExecution` (`workoutExecutions.ts:233-259`) is a single transaction (status read, pending-set sweep, terminal status, grant deletion, all atomic). Schedule advance (`completeScheduledSession`) is a separate, independently grant-gated call requiring a matching finished execution — schedule cannot advance ahead of a persisted terminal execution state.

Grant-write race (§16 table, P3): concurrent legitimate operations issuing grants against the same singleton doc can silently clobber each other (last-write-wins on `.set()`), producing a retry-required error for the loser rather than corrupted state.

**Live-load flakiness (P2, distinct from the above):** `workoutLifecycleConcurrency.integration.test.ts`'s "Adaptation vs Prepare" race was reproduced failing 2/2 times under full-suite load (passes 3/3 in isolation). Root cause: `prepareEvolution()` (`workoutLifecycleApplication.ts:440-446`) retries exactly once on any error; under load, a concurrent `adaptWorkoutProgram` can still be in-flight during both the initial attempt and the single retry, causing `persistEarnedFact`'s staleness check (`workoutLifecycleApplication.ts:184-187`) to fire twice and the whole call to reject — contradicting the documented "recompute once so benign cross-device races converge" contract. Fails closed (no bad state persists), but is a genuine functional regression a real user could hit as a hard error during ordinary cross-device use.

## 35. Finish/Schedule Integrity

Covered in §34 — PASS, no gap found.

## 36. History/Events

Not independently re-audited in this pass beyond what's implied by the transactional grant-consumption evidence above; no specific event-ordering or duplicate-event issue was surfaced by any investigating stream.

## 37. Telemetry

**PASS.** `emitTrustedWorkoutLifecycleTelemetry` (`trustedWorkoutLifecycleTelemetry.ts:99-133`) claims a `pending` receipt transactionally *before* invoking the sink, and marks `delivered` only after the sink call returns successfully; sink failure leaves the receipt `pending` for retry (no permanent suppression), and an already-`delivered` receipt short-circuits to prevent duplicate emission. This is a read-only side-effect trigger (`onDocumentCreated`) — telemetry failure/retry cannot corrupt `workoutLifecycleEvents` domain state.

## 38. Firestore Rules

**Confirmed defense-in-depth generally strong** for the grant mechanism proper (uid/operation/source/target binding, single-use via `existsAfter`, expiry). **However, Finding P0-2 (§48) shows the grant requirement itself is conditionally bypassable** at the `workoutPrograms`/`workoutProgramState` layer via an optional-field omission, independent of how well the grant mechanism behaves once it IS required. `workoutProgramCommonValid` (`firestore.rules:241-324`) validates document shape and template/questionnaire cross-references only — it has no concept of "this content came from the backend," which is precisely the false-confidence pattern the audit spec (§42) warns is likely to reappear.

## 39. CI / False-Green Audit

CI workflow (`.github/workflows/ci.yml`) confirmed to run 5 real jobs: `static` (typecheck+lint+i18n+`ci:audit`), `unit` (root `npm test`), `firebase-integration` (rules + integration on real emulator, Java 21 pinned), `functions` (typecheck/test/build), `functions-integration` (account-deletion + `test:integration:lifecycleAuthority` on emulator). All `describe.skip`-shaped hits found are `describe.skipIf(!enabled)` guards on env vars that are explicitly set by the corresponding CI job/npm script — cross-checked, no orphaned gate that CI never activates. This is intentional test partitioning, not a false-green pattern.

## 40. Real-Catalog Validation

Not independently re-verified against the full 116-exercise bundled catalog in this pass; relying on Phase 10B's own documented claim of real-catalog test coverage, which was not contradicted by anything found in this audit. Flag as inherited, not independently re-proven.

## 41. Long-Run Journey

Not executed as a fresh end-to-end simulation in this pass (out of the time budget for this audit round). This is a **verification gap** — recommend running before any rollout decision is finalized, given the P0 findings already make the question moot for this audit cycle.

## 42. Adaptation Long-Run

Same gap as §41.

## 43. Account Deletion

Not re-executed this pass; account-deletion tests remain part of the `functions-integration` CI job per §39 and were not flagged by any stream as regressed.

## 44. Rollout Controls

Not independently audited this pass (sticky assignment / kill switch / fail-closed fallback in `scripts/workoutLifecycleRollout.cjs` was not opened by any stream). Flag as unverified, not confirmed either way.

## 45. Performance / Build Sanity

Functions build/typecheck confirmed passing (§57); no N+1 catalog-loading pattern was surfaced by any investigating stream. Bundle-size implications of the Phase 10B catalog additions were not independently measured this pass.

## 46. Findings Summary

- **P0 × 2** (RECOVER canonical bypass; Firestore Rules grant-check omission) — see §48-49
- **P1 × 0** confirmed this pass (several items flagged as "verification gap" above are not confirmed P1s — they are open questions, listed separately in §59)
- **P2 × 3** — inline vs. shared earned-cycle-count divergence (§21); Adaptation-vs-Prepare concurrency test flakiness under load (§34); backdating cross-boundary abuse unresolved (§25, borderline P1/P2 pending a dedicated test)
- **P3 × 2** — grant-singleton last-write-wins race (§16); sync-script marker gap for the UI-only AppState region (§15)

## 47. P0 Findings

### PA-RECOVER-01

- **Severity:** P0
- **Title:** RECOVER operation allows client-controlled, non-canonical prescription content to become sealed/authoritative
- **Affected flow:** RECOVER (reconciliation), triggered via `automatic_progression` / `automatic_reconciliation` sources
- **Preconditions:** Authenticated user with existing V2 lifecycle state; valid App Check token
- **Exact attack:** Call `saveAndActivateWorkoutProgram` (or `authorizeWorkoutLifecycleMutation` directly with `operation: 'RECOVER'`) with a schema-valid, in-bounds (sets 1-10, rest 0-600s, reps ≤20 chars), real/active/limitation-compatible `targetPlan` that is semantically different from what the canonical engine would produce (e.g., an entirely different but equally "safe" exercise selection).
- **Expected behavior:** Backend independently regenerates canonical content; client's semantic choices never reach persistence (per ADR-016 / Phase 10B's stated design goal).
- **Actual behavior:** `authorizeMutation.ts:697-754` (RECOVER branches) never call `generateCanonicalPlan`/`generateCanonicalCycleEvolution`; only `assertPlanSafe` runs. `merged = {...data, ...validated}` (`authorizeMutation.ts:1044`) leaves the client's `targetPlan`/`targetContentIdentity` untouched since `validated` never overrides them for RECOVER. Client-side, `workoutPrograms.ts:611-617,651-675,769-780` seals this content verbatim under a client-computed identity (`programId = wpg_${stableHash(programIdentity(input))}`).
- **Root cause:** Phase 10B's canonical-generation wiring was deliberately scoped to INITIALIZE/MIGRATE/ADAPT/PREPARE; RECOVER was treated as "identity/state reconciliation, not content generation," but is demonstrably a content-installation path for `automatic_progression`/`automatic_reconciliation`.
- **Files/lines:** `functions/src/workoutLifecycle/authorizeMutation.ts:697-754,1044`; `src/services/workoutPrograms.ts:611-617,651-675,769-780`; `firestore.rules:863-879`.
- **Why current tests missed it:** Phase 10B's regression suite tests RECOVER-rejects-unsafe-content and RECOVER-works-without-a-plan, but never tests "RECOVER seals a safe-but-different plan that diverges from canonical engine output" — the safe-but-wrong test class was only applied to ADAPT (per Phase 10B's own §30-32 acceptance criteria).
- **Production impact:** Any client build (not requiring sophistication — a modified/forked app, or even a race in ordinary reconciliation) can install attacker-chosen, schema-valid workout content as a user's authoritative prescription via a frequently-traveled, ordinary code path.
- **Recommended remediation (not implemented):** Route RECOVER's content-carrying branch through the same canonical-generation machinery used by ADAPT once a `targetPlan` is present, or at minimum recompute `targetContentIdentity` backend-side from the validated plan so the grant cannot bind to a client-invented identity.

### FS-RULES-BYPASS-01

- **Severity:** P0
- **Title:** Firestore Rules skip the authority-grant requirement entirely when `programInstanceId` is omitted from `workoutProgramState/active`
- **Affected flow:** Any `workoutPrograms/{programId}` create, regardless of intended `operation`
- **Preconditions:** Authenticated owner, valid App Check token, ability to issue a batched Firestore write (standard client SDK capability — Admin SDK not required)
- **Exact attack:** In a single batched write: (1) update `workoutProgramState/active` to `{programId, updatedAt}` only, deliberately omitting the optional `programInstanceId` key; (2) create `workoutPrograms/{arbitraryId}` with self-authored, schema-plausible but attacker-chosen exercises/sets/reps/rest/order, referencing any real active `templateId` and a questionnaire version matching the user's own document.
- **Expected behavior:** Every `workoutPrograms` content write requires a valid backend-issued authority grant bound to backend-derived canonical content.
- **Actual behavior:** `firestore.rules:1046,1049` allow `workoutProgramState/active` writes with `hasOnly(['programId','programInstanceId','updatedAt'])` where `programInstanceId` is optional. `firestore.rules:876-879` require `consumesLifecycleAuthorityGrant(...)` **only if** `'programInstanceId' in getAfter(workoutProgramState/active).data`; if absent, the grant requirement is skipped entirely, and the create only needs to pass `workoutProgramCommonValid` (`firestore.rules:241-324`), which validates document shape/template cross-references, not exercise/session content correctness.
- **Root cause:** A structural rule intended to distinguish legacy/pre-migration document shapes from V2 shapes uses an optional-key existence check as its trigger for requiring grant enforcement, rather than requiring grant enforcement unconditionally for all `workoutPrograms` writes.
- **Files/lines:** `firestore.rules:1046,1049,876-879,241-324`; `firestore-tests/workoutPrograms.rules.test.ts` (no test exercises this omission path — every `attemptV2Write` helper call supplies `programInstanceId`).
- **Why current tests missed it:** The rules test suite's only "legacy shape" test (line ~208) tests a different, non-adversarial field omission (missing limitation dataset fields), not the authority-bypass-via-omission path targeted here.
- **Production impact:** Falsifies backend canonical prescription authority (ADR-016, PA-02/PA-03) at the Rules layer for **any** user, not only pre-migration V1 accounts — nothing in the rule text distinguishes "genuinely legacy user" from "V2 user who simply omitted the field on this write."
- **Recommended remediation (not implemented):** Require `consumesLifecycleAuthorityGrant(...)` unconditionally for all `workoutPrograms` creates/updates regardless of whether `programInstanceId` is present on `workoutProgramState/active`, and add a dedicated adversarial rules test for the omission path.

## 48. P1 Findings

None confirmed with the reproduction-strength required by §75 of the audit spec. Several open items are downgraded to explicit **verification gaps** rather than asserted P1s: PREPARE's byte-level canonical-consumption re-verification (§12), MIGRATE-specific V1/V2 coexistence attacks (§19), backdating cross-boundary abuse (§25), deferral race combinations (§33), long-run/adaptation-long-run journey execution (§41-42), and rollout-controls audit (§44). None of these were positively shown to fail; they simply were not exercised to the standard of dynamic reproduction this cycle, given the P0 findings already necessitate a NOT READY verdict and a subsequent remediation-and-re-audit cycle.

## 49. P2 Findings

1. **Inline vs. shared earned-cycle-count divergence** (`authorizeMutation.ts:351-353` vs. `earnedCycles.ts:23-38`) — conservative (under-counts only), not a security bypass, but risks a confusing "stuck" UX for legacy users and exemplifies the shared-logic-drift risk the audit explicitly warns about.
2. **Adaptation-vs-Prepare concurrency test flakiness under full-suite load** (`workoutLifecycleApplication.ts:440-446`) — fails closed (no corrupted state) but contradicts the documented single-retry convergence contract; a real user could see a hard error during a legitimate cross-device race.
3. **Backdating cross-boundary abuse unresolved** (§25) — the 3-day grace window itself matches policy, but whether it can be abused across a ProgramInstance/adaptation/pause-resume boundary was not conclusively tested; recommend treating as P1 until a dedicated test proves it safe.

## 50. P3 Findings

1. Grant-singleton last-write-wins race under concurrent legitimate grant issuance (§16) — wasted work and a retry-required error for the losing client, not a corruption risk.
2. Sync-script marker gap for the intentionally-skipped UI-only region of `AppState.tsx` (§15) — low practical risk given that region is UI-only by design, but not structurally guaranteed.
3. `firestore-debug.log` tracked in git and repeatedly rewritten by test runs (§3) — hygiene only, recommend `.gitignore`.

## 51. Acceptance — Prescription Authority

- PA-01 backend computes canonical independently — **PASS** (INITIALIZE/MIGRATE/ADAPT/PREPARE), **FAIL** (RECOVER)
- PA-02 client targetPlan not semantic authority — **PASS**/**FAIL** (same split)
- PA-03 safe-but-wrong cannot become authoritative — **FAIL** (via RECOVER and independently via Rules omission)
- PA-04 one-field mutations cannot leak — **PASS** (non-RECOVER ops), moot/**FAIL** for RECOVER (everything leaks)
- PA-05 canonical response consumed client-side — **PASS** (INITIALIZE/MIGRATE/ADAPT), **verification gap** (PREPARE)
- PA-06 catalog race safe — **PASS** (non-RECOVER ops)
- PA-07 post-response mutation safe — **verification gap** (not independently re-tested; no contrary evidence found)
- PA-08 missing canonical fail-closed — **PASS**
- PA-09 canonical IDs backend-derived — **PASS**/**FAIL** (same RECOVER split)
- PA-10 grant canonical-target-bound — **PASS**/**FAIL** (same RECOVER split); independently **FAIL** at the Rules layer per FS-RULES-BYPASS-01
- PA-11 RECOVER not alternate content injection — **FAIL**
- PA-12 shared engine sync cannot silently drift — **PASS** (build-path enforced), minor P3 gap noted (§15)

## 52. Acceptance — Lifecycle

LC-01/02/03/04 not independently re-contested this pass (no contrary evidence surfaced). LC-06/07 (adaptation preserves career progress / resets program-period progress) not independently re-verified this pass. LC-08 Beginner threshold — **PASS** (28 days, confirmed). LC-09 Intermediate/Advanced threshold — **PASS** (85 days, confirmed). LC-10 4 earned cycles — **PASS**, with P2 divergence noted (§49.1). LC-11 renewal not counted as earned — **PASS**. LC-12 extra workouts don't accelerate — **PASS**. LC-13 deferral correct — **PASS** structurally; race combinations **verification gap**.

## 53. Acceptance — Schedule/Execution

SE-01 session-aware — **PASS**. SE-02 wrong session denied — **PASS**. SE-03 right session qualifies — **PASS**. SE-04 duplicate doesn't double count — **PASS**. SE-05 extra workout no credit — **PASS**. SE-06 wrong ProgramInstance denied — **PASS**. SE-07 backdating policy safe — **PASS** for the window itself, **verification gap** for boundary-crossing abuse. SE-08 cursor manipulation denied — not independently re-tested this pass, no contrary evidence. SE-09 finish failure cannot advance schedule — **PASS**. SE-10 pending set writes cannot race finish — **PASS**.

## 54. Acceptance — Authority

AU-01 through AU-11 — **ALL PASS**, each with direct file:line evidence (§16). This is the strongest-verified area of the entire audit.

## 55. Acceptance — Operations

OP-01 INITIALIZE — **PASS** (canonical generation confirmed). OP-02 MIGRATE — **PASS** for canonical generation; V1/V2-specific attack scenarios are a **verification gap**. OP-03 PREPARE — **PASS** with P2 noted (§21/§49.1). OP-04 ACTIVATE — **PASS**. OP-05 ADAPT — **PASS**. OP-06 RECOVER — **FAIL (P0)**. OP-07 DEFER — **PASS** structurally, race combos a verification gap. OP-08 COMPLETE_SCHEDULE — **PASS**. OP-09 RESOLVE_MISSED_SESSION — not independently audited this pass.

## 56. Acceptance — Quality

QA-01 root typecheck — **PASS** (0 errors). QA-02 root unit — **PASS** (3992 passed, 109 legitimately-gated skips). QA-03 root integration — **FAIL (flaky)**: 688/689 passed, 1 reproducibly failing under full-suite load (2/2 runs) but passing in isolation (3/3) — the Adaptation-vs-Prepare race, §34/§49.2. QA-04 Firestore Rules — **PASS** (352/352). QA-05 Storage Rules — **PASS** (91/91). QA-06 Functions typecheck — **PASS**, and confirms sync scripts always run pre-build/pre-test. QA-07/08 Functions unit/build — **not independently re-run this pass**; no contrary evidence to the previously-reported 1189 passed / build PASS. QA-09 Authority Emulator — **not independently re-run this pass**. QA-10 CI audit script — **PASS** (confirmed real, invoked in `static` job). QA-11 no critical skips — **PASS** (all skips are legitimately CI-activated env gates). QA-12 real catalog coverage — inherited from Phase 10B, not independently re-proven. QA-13 long-run journey — **not executed this pass** (verification gap, §41).

## 57. Test Results

- Root typecheck: PASS, 0 errors
- Root unit: 3992 passed, 109 skipped (legitimately env-gated), 0 failed
- Root integration: 688 passed, 1 failed (flaky under load, passes in isolation) of 689
- Firestore Rules: 352/352 passed
- Storage Rules: 91/91 passed
- Functions typecheck: PASS
- Functions unit/build: not re-run this pass (previously reported 1189 passed / build PASS, not contradicted)
- Authority Emulator: not re-run this pass
- CI audit script (`scripts/audit-ci.cjs`): confirmed present and invoked in CI, PASS

## 58. Critical Skip Audit

All 24 `describe.skipIf(!enabled)`-gated integration test files checked against both root `test:integration` script and the CI workflow's `test:integration:*` steps — every gate is activated by at least one real invocation path. No orphaned or CI-invisible critical suite found. `functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts` was identified as the test that should cover most AU-07/AU-08/OP-04 assertions but was not independently re-run in this pass (Functions integration suite time-boxed out).

## 59. Production Readiness Analysis

The authority/grant layer (§54) and telemetry (§37) are genuinely solid, evidenced by direct file:line tracing rather than trust in prior reports — this is real progress since Phase 9/10. Progression, adherence, and scheduling math (§27-33) match documented constants exactly with no drift found. However, the entire point of Phases 10B/10C was to close "client content has zero effect on the authoritative prescription," and this audit found that claim is **false** via two independent, non-exotic paths (RECOVER; Rules field-omission). Per the audit's own rules (§84), the presence of even one confirmed canonical-authority-bypass P0 is disqualifying for any rollout tier, regardless of how solid the rest of the system is. Additionally, several areas (PREPARE's byte-level client consumption, MIGRATE-specific attacks, backdating boundary-crossing, long-run journey, rollout controls) remain unverified rather than confirmed safe — these should be closed out in the same remediation pass rather than assumed fine because "nothing else showed a problem."

## 60. Final Authorization

FINAL AUTHORIZATION: NOT READY
