# Phase 10D — Final Authority Bypass Remediation

Date: 2026-09-01

## 1. Verdict

**FASE 10D PARTIAL.** Both P0 canonical-authority bypasses found by the Post-Phase-10C adversarial audit are closed, with permanent regression tests proving each exploit is now denied, and every quality gate touched by this phase is green (root typecheck/unit/integration, Firestore Rules, Storage Rules, Functions typecheck/unit/build, CI audit). One of the two P2 findings (earned-cycle count drift) is fully resolved by eliminating the duplication. The other P2 (Adaptation-vs-Prepare race under load) is substantially improved (three consecutive clean full-integration-suite runs, previously reproducibly red) but not provably eliminated — the underlying race is inherently timing-dependent and cannot be certified fixed from a handful of local runs. Several of the audit's cheaper verification gaps (VG-A–VG-J: PREPARE canonical re-verification, MIGRATE adversarial paths, backdating boundary crossings, deferral races, long-run journeys) were **not executed this phase** due to scope/time — per this phase's own completion rule (§41 of the phase brief), their absence blocks a COMPLETE verdict regardless of how solid the P0 closures are. No new blocker was found or introduced.

## 2. Git Before / Git After

Same branch (`main`), same pre-existing large uncommitted worktree as prior phases (no commits made this phase, per instructions). `firestore-debug.log` was rewritten repeatedly by the emulator test runs in this phase (it was already dirty before this phase started) — this is a non-semantic log artifact, not a source or doc change; no other files outside this phase's explicit edits (§42) were touched. No resets, restores, cleans, stashes, commits, pushes, or deploys were performed.

## 3. Environment

- Root Node: v20.20.2 (`.nvmrc`)
- Functions Node: 22 (`functions/package.json` engines)
- Java: switched to 21 (`/opt/homebrew/opt/openjdk@21`) for all emulator-backed runs this phase — the system default (17) is insufficient; `scripts/checkJavaVersion.cjs` confirmed "Toolchain preflight OK (Node 20.20.2, Firebase 15.26.0, Java 21)" on every emulator invocation.
- firebase-tools: 15.26.0

## 4. Audit Findings Baseline

From `22_POST_PHASE_10C_FINAL_ADVERSARIAL_AUDIT.md`: P0 × 2 (PA-RECOVER-01, FS-RULES-BYPASS-01), P1 × 0, P2 × 3 (earned-cycle drift; Adaptation-vs-Prepare race flakiness; backdating boundary unresolved), P3 × 2 (grant-singleton race; sync-script AppState marker gap). This phase targeted the 2 P0s as mandatory, the first 2 P2s as requested remediation, and treated the backdating-boundary P2 and all VG items as scope-permitting stretch goals (not reached).

## 5. RECOVER Callers Found

Traced every real (non-test) call site of `operation: 'RECOVER'`:

1. `src/services/workoutPrograms.ts` (`saveAndActivateWorkoutProgram`) — selected RECOVER whenever V2 lifecycle state already existed and `input.source` was `onboarding`/`automatic_progression`/`automatic_reconciliation`, **always attaching a freshly client-generated `targetPlan`**. This is the exploited path (PA-RECOVER-01) — classified **content installation**, illegitimately.
2. `src/services/workoutLifecycle.ts` (`recoverWorkoutLifecyclePartialState`, two call sites) — reconciles `workoutLifecycleState/current`/`programInstances`/`trainingCycles` pointers to content that was **already sealed and persisted** under a real grant in the past; never sends a `targetPlan`. Classified **pure reconciliation** — legitimate as-is.
3. `src/services/workoutLifecycleApplication.ts` (`reconcileWorkoutLifecycle`, two call sites) — compare-and-delete cleanup of a stale/already-consumed pending evolution; sends only `sourceProgramInstanceId`/`sourceCycleId`(/`pendingEvolutionId`), never a plan or target identity. Classified **pure reconciliation** — legitimate as-is.

Only caller #1 needed correction.

## 6. RECOVER Root Cause

`saveAndActivateWorkoutProgram`'s operation-selection ternary treated "V2 lifecycle exists and the source isn't `evolution_activation`/`program_adaptation`/`manual_regeneration`" as sufficient reason to route through RECOVER — without checking whether the candidate content actually differed from what was already active. Combined with the function unconditionally attaching `targetPlan` to every authorize call, and the backend's RECOVER handler only bounds-checking (never rejecting) a carried plan, this let `automatic_progression`/`automatic_reconciliation` install client-computed content once V2 already owned the account, bypassing canonical generation entirely (`functions/src/workoutLifecycle/authorizeMutation.ts:697-754`, pre-fix).

## 7. RECOVER Before

```
RECOVER (targetPlan present)
  → assertPlanSafe(bounds/catalog/limitation only)
  → validated response never overrides targetPlan/targetContentIdentity/targetPrescriptionIdentity
  → merged = {...clientData, ...validated} keeps the CLIENT's plan + identities
  → grant issued bound to client-chosen identity
  → client seals workoutPrograms/{clientComputedId} with its own content
```

## 8. RECOVER After

```
RECOVER (any targetPlan present, at all)
  → HttpsError('permission-denied', 'recover_does_not_install_content') — no grant issued, no bounds-check performed on the content at all (there is no bounds-checked content path anymore)

RECOVER (no targetPlan)
  → identity fields (targetProgramInstanceId/targetCycleId/targetContentIdentity/targetPrescriptionIdentity/targetTrainingLevel/targetCycleNumber) are ALWAYS independently re-derived from persisted workoutLifecycleState/programInstances/trainingCycles — never taken from the client, even when the client's own value happens to already be correct
```

Client-side (`src/services/workoutPrograms.ts`): the operation-selection guard now only routes through RECOVER when the candidate content is **identical** to what's already active (`preflightSameContent`) — a genuine idempotent re-run, for which `targetPlan` is now omitted from the authorize call entirely. Any `onboarding`/`automatic_progression`/`automatic_reconciliation` call that resolves to **different** content while V2 lifecycle already exists now fails fast client-side with `Error('WORKOUT_LIFECYCLE_V2_OWNS_CONTENT')`, mirroring the existing `V2_LIFECYCLE_OWNS_ELIGIBILITY` precedent in `workoutProgression.ts`, before ever reaching the (now-hardened) backend.

## 9. RECOVER Safe-But-Wrong Attack

New test `functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts` — `'RECOVER rejects a fully safe-but-wrong targetPlan outright (no bounds-checked content path)'`: a schema-valid, in-bounds, real-exercise plan (3 sets, "10-12" reps, 90s rest, real `lat-pulldown` exercise) submitted via RECOVER is rejected with `permission-denied` / `recover_does_not_install_content`, and no grant is issued. Verified passing against the real Firestore Emulator.

## 10. RECOVER Identity Attack

New test `'RECOVER never lets a client-chosen targetContentIdentity/targetPrescriptionIdentity into the grant'`: a RECOVER request with attacker-chosen `targetContentIdentity`/`targetPrescriptionIdentity` (no plan) still results in a grant bound to the real, backend-derived, already-active identity (`wpg_active`/`rx_active` from seeded state) — the client's values are silently overridden, never honored. Verified passing.

## 11. RECOVER Regression Matrix

| Case | Result |
|---|---|
| RECOVER with no targetPlan | PASS — succeeds, pure reconciliation (existing test, still passing) |
| RECOVER with existing authoritative plan reference (no new content) | PASS — covered by caller #2/#3 above, unaffected by this phase |
| RECOVER with safe-but-wrong targetPlan | PASS — denied outright (new test, §9) |
| RECOVER with unsafe (bounds-violating) targetPlan | PASS — denied with the same `recover_does_not_install_content` (new test, updated from the old `invalid-argument` expectation) |
| RECOVER with arbitrary content identity | PASS — denied/overridden (new test, §10) |
| RECOVER with wrong prescription identity | PASS — same override as above |
| RECOVER with existing lifecycle | PASS — identity fields re-derived from `workoutLifecycleState/current` |
| RECOVER with missing lifecycle (bootstrap pairing) | PASS — identity fields re-derived from the unique active `trainingCycles`/`programInstances` pair; unaffected by this phase |
| RECOVER after migration | Not independently re-tested this phase (caller #2/#3 unaffected by the change; no MIGRATE-specific RECOVER interaction found) |
| RECOVER via `automatic_progression` (content differs) | PASS — now denied client-side before reaching the backend (`WORKOUT_LIFECYCLE_V2_OWNS_CONTENT`); regression-tested indirectly via the fixed `workoutProgression.integration.test.ts` §74/§90 test, which now exercises INITIALIZE instead of hitting this dead path |
| RECOVER via `automatic_reconciliation` (content unchanged, idempotent re-run) | PASS — now routes through RECOVER **without** a plan and succeeds as a no-op (new test scenario proven by `workoutProgramReconciliation.integration.test.ts` "(D) reconciliation runs again..." — was a regression introduced mid-phase and fixed, see §46) |

## 12. Rules Root Cause

`workoutPrograms/{programId}`'s `create` rule (`firestore.rules`) required the one-time authority grant **only if** `workoutProgramState/active` carried a `programInstanceId` key in the same write — an optional key the client chooses whether to send on that exact write, not a backend-controlled fact. Omitting it made the grant requirement vanish entirely, for any user, not just genuinely pre-V2 (legacy) accounts.

## 13. Rules Before

```
allow create: if ...
  && (
       !('programInstanceId' in getAfter(workoutProgramState/active).data)
       || (consumesLifecycleAuthorityGrant(...) && grant.targetContentIdentity == programId)
     );
```

## 14. Rules After

```
allow create: if ...
  && (
       !existsAfter(workoutLifecycleState/current)
       || (consumesLifecycleAuthorityGrant(...) && grant.targetContentIdentity == programId)
     );
```

`workoutLifecycleState/current` can only ever be created under a real authority grant (its own `create` rule requires `consumesLifecycleAuthorityGrant(userId, ['INITIALIZE','MIGRATE','RECOVER'])`) and can never be deleted (`allow delete: if false`) — its existence is a fact the backend controls, not something a client can toggle per write by omitting an unrelated field on a different document in the same batch. Genuinely legacy V1-only accounts (which never had this document, before or after) are unaffected.

## 15. programInstanceId Omission Attack

New test in `firestore-tests/workoutPrograms.rules.test.ts` — `'denies the exact programInstanceId-omission exploit: a V2 user cannot skip the grant by omitting the field'`: seeds `workoutLifecycleState/current` (i.e., simulates a V2 account), then attempts the exact FS-RULES-BYPASS-01 shape (arbitrary attacker plan + `workoutProgramState/active` write that omits `programInstanceId`) with no grant present — `assertFails`, confirmed against the real Firestore Rules emulator. A companion test — `'a genuinely legacy V1 account (no workoutLifecycleState/current ever) may still omit programInstanceId'` — proves the legacy compatibility path still works (`assertSucceeds`) for an account that has never had V2 lifecycle state.

## 16. Direct Firestore Attack Matrix

All pre-existing tests in the `'V2 prescription authority (backend grant required)'` describe block continue to pass unmodified: no grant at all (deny), grant for a different contentIdentity/operation (deny), cross-user grant (deny), expired grant (deny), valid matching grant (allow), non-atomic grant consumption / replay (deny). The two new tests above (§15) extend this matrix with the field-omission shape specifically. 354/354 Firestore Rules tests pass (was 352 before this phase's 2 new tests).

## 17. Legacy Compatibility

Confirmed via the new "genuinely legacy V1 account" test (§15) that the fix does not regress true V1-only accounts — the escape hatch is now gated on a backend-controlled fact (`workoutLifecycleState/current` existence) rather than a client-choosable field, exactly per the phase brief's guidance (§12: use a condition impossible for the client to freely choose).

## 18. Grant/Canonical Binding

Not re-audited from scratch this phase — the Post-Phase-10C audit's grant/concurrency work-stream already verified AU-01 through AU-11 as PASS with direct file:line evidence, and this phase's changes do not touch the grant consumption mechanism (replay guard, expiry, cross-user, source binding). The two P0 fixes only change (a) what content/identity a RECOVER grant can carry, and (b) when the `workoutPrograms` create rule requires a grant at all — both strictly narrowing, never loosening, existing protections.

## 19. PREPARE Verification

**NOT_TESTED this phase** (VG-A/VG-B). Scope/time did not allow an explicit new test proving PREPARE's pending-evolution content survives client mutation of the local candidate after the backend response. This is unchanged from the Post-Phase-10C audit's own "verification gap" classification — no regression introduced, but not newly proven either.

## 20. MIGRATE Verification

**NOT_TESTED this phase** (VG-C). No MIGRATE-specific adversarial paths (fake legacy candidate, repeat/concurrent migration, partial V2 state) were newly exercised. MIGRATE's canonical-generation code path is unchanged by this phase's edits.

## 21. Backdating Boundary Verification

**NOT_TESTED this phase** (VG-D/VG-E/VG-F). The 3-day grace window itself was not modified. Cross-ProgramInstance/ADAPT/pause-resume boundary abuse remains an open question from the original audit.

## 22. Deferral Race Verification

**NOT_TESTED this phase** (VG-G). No new tests for Start+Defer/Defer+Auto/Auto+Auto races were added.

## 23. Adaptation-vs-Prepare Race

Root cause confirmed: `prepareEvolution()` (`src/services/workoutLifecycleApplication.ts`) previously made exactly one retry attempt; under real full-suite load (not reproducible in isolation — 3/3 clean standalone runs both before and after this phase's fix, confirming the race requires genuine system load to manifest), a concurrent `adaptWorkoutProgram` could still be mid-transaction across both attempts, causing `persistEarnedFact`'s staleness check to fail twice and the whole call to reject with an unhandled rejection.

Fix: bounded 3-attempt loop (`PREPARE_EVOLUTION_MAX_ATTEMPTS = 3`, still finite, never infinite retry) with the same "did we already converge to a pending evolution" check applied after exhausting all attempts, returning the existing typed `PREPARATION_FAILED` / `ALREADY_PENDING` outcomes instead of ever letting an unhandled rejection reach the caller.

Verification: ran the full `npm run test:integration` suite (689 tests) three consecutive times after the fix — all three runs passed 689/689 with zero flakes, versus reproducibly failing under the same conditions before the fix (confirmed by reproducing the original failure once at the start of this phase's verification pass). This is strong evidence of improvement but **not a mathematical proof the race is eliminated** — it is inherently timing-dependent, and the phase brief's own instruction not to "hide a real error" is respected: the bounded-attempt fallback still surfaces an explicit, honest `PREPARATION_FAILED` if genuinely exhausted, rather than fabricating a success.

## 24. Earned-Cycle Drift

Fully resolved by eliminating the duplication, per the phase brief's explicit preference ("elimine a duplicação... não crie outra implementação"). `src/progressionEngineV2/earnedCycles.ts` (the client's shared `countEarnedIntermediateCycles`, including its legacy pre-8A fallback inference) is now added to `scripts/syncPrescriptionEngineToFunctions.cjs`'s synced file list and imported directly by `functions/src/workoutLifecycle/authorizeMutation.ts`, replacing the previous inline `completionReason === 'EARNED_EVOLUTION'`-only filter. Functions typecheck and build both pass with the new import resolving correctly (the sync mirrors `src/progressionEngineV2/earnedCycles.ts`'s relative import of `../workoutLifecycle/types`, which was already synced).

## 25. Long-Run Journey

**NOT_TESTED this phase** (VG-H). No new Beginner→Intermediate→Advanced integration run was executed; existing long-run coverage (if any) was not re-verified.

## 26. Long-Run Adaptation

**NOT_TESTED this phase** (VG-I).

## 27. Motivational Renewal Journey

**NOT_TESTED this phase** (VG-J).

## 28. Real-Catalog Validation

The new RECOVER safe-but-wrong test (§9) runs against `seedRealPrescriptionCatalog` — the same real, 116-exercise bundled catalog fixture the rest of `authorizeMutation.integration.test.ts` uses (`lat-pulldown` is a real catalog exercise, not a synthetic placeholder). The new Firestore Rules tests (§15) use the existing `programDocument`/`arbitraryAttackerPlan` fixtures already established in that test file (schema-realistic, not synthetic-only).

## 29. Authority Attack Matrix A01–A20

Only the RECOVER-relevant rows were newly exercised this phase:

- A06 safe-but-wrong RECOVER — **DENIED** (§9)
- A11 arbitrary content identity (RECOVER) — **DENIED/overridden** (§10)
- A12 arbitrary prescription identity (RECOVER) — **DENIED/overridden** (§10)
- A13 no-grant Firestore write — **DENIED** (pre-existing test, still passing)
- A14 programInstanceId omission exploit — **DENIED** (§15, new)

A01–A05, A07–A10, A15–A20 were not re-run this phase (unchanged code paths per the Post-Phase-10C audit's own PASS verdicts, per §18 above).

## 30. Regression Results

See §31–38 for exact counts. Summary: every gate run this phase is green except one pre-existing, unrelated, date-dependent flaky test discovered incidentally (§39) — confirmed present both before and after this phase's changes, isolated to a different code branch (COMPLETE_SCHEDULE, not RECOVER), and out of this phase's scope to fix.

## 31. Root Typecheck

PASS — `tsc --noEmit`, 0 errors.

## 32. Root Unit

PASS — 3992 passed, 109 skipped (unchanged from baseline).

## 33. Root Integration

PASS — 689/689 passed, run three consecutive times with zero failures (previously 688/689 with a reproducible Adaptation-vs-Prepare failure under load before this phase's P2 fix, and briefly 687/689 mid-phase from the P0-1 client fix before the two affected fixtures were corrected — see §46).

## 34. Firestore Rules

PASS — 354/354 passed (352 baseline + 2 new tests from this phase).

## 35. Storage Rules

PASS — 91/91 passed (unchanged).

## 36. Functions Typecheck/Unit/Build

PASS — typecheck 0 errors (confirms the new `earnedCycles` sync + import resolve correctly); unit 1189 passed, 54 skipped (unchanged from baseline); build (`tsc -p tsconfig.build.json`) clean.

## 37. Authority Emulator

`npm run test:integration:lifecycleAuthority` (the CI job's actual "Authority Emulator" gate, `functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts`): 14/15 passed. The 1 failure (`'accepts the real rotation-owed session (index 0, the anchor) for a fresh program'`, in the unrelated `COMPLETE_SCHEDULE` describe block) is a **pre-existing, date-dependent test bug** — it computes "today" via `new Date()` rather than a fixed date, confirmed reproducible identically before and after every change made in this phase, and isolated to a code path (`COMPLETE_SCHEDULE`/schedule-cursor resolution) this phase never touched. Documented here rather than silently left out; not fixed, as it is out of this phase's P0/P2 scope (§41 of the phase brief scopes COMPLETE against the Adaptation-vs-Prepare failure specifically, not this unrelated pre-existing flake — but it is flagged as a P3 for a future phase, see §49).

## 38. CI Audit

PASS — `node scripts/audit-ci.cjs` → "CI audit OK: Node, Java, Firebase pin, gates, opt-in suites, and failure policy are explicit."

## 39. Critical Skip Audit

No new skips introduced. The one pre-existing failing test (§37) is not skipped — it is a genuine (if unrelated) red in the Authority Emulator gate today; flagged, not hidden.

## 40. Mutation-Style Proof

- **What fails if RECOVER trusts `targetPlan` again?** `'RECOVER rejects a fully safe-but-wrong targetPlan outright'` and `'RECOVER still rejects a bounds-violating targetPlan outright'` (both in `authorizeMutation.integration.test.ts`) — either would immediately start resolving instead of rejecting.
- **What fails if RECOVER trusts `targetContentIdentity`/`targetPrescriptionIdentity` again?** `'RECOVER never lets a client-chosen targetContentIdentity/targetPrescriptionIdentity into the grant'` — the grant's identity fields would stop matching the seeded authoritative values.
- **What fails if `workoutPrograms` writes stop requiring grants (for V2 accounts)?** `'denies an arbitrary V2 targetPlan sealed with no backend grant at all'` (pre-existing) plus the new `'denies the exact programInstanceId-omission exploit'` test — both would start `assertSucceeds` instead of `assertFails`.
- **What fails if `programInstanceId` becomes the grant-enforcement switch again?** The new omission-exploit test specifically, plus the new legacy-compatibility test would need re-verification that it still passes for the right reason (it currently passes because `workoutLifecycleState/current` was never seeded, not because of the field).
- **What fails if a legitimate grant for canonical B is used to write safe-but-wrong A?** Pre-existing tests in the "V2 prescription authority" describe block (grant-for-different-contentIdentity denial) — unaffected by this phase, still passing.
- **What fails if PREPARE persists candidate A instead of canonical B?** No new test this phase (VG-A, §19) — this remains covered only by whatever Phase 10C-era test exists, not independently re-verified here.
- **What fails if MIGRATE accepts client-authored legacy replacement content?** No new test this phase (VG-C, §20).
- **What fails if backdating crosses a ProgramInstance boundary?** No new test this phase (VG-D, §21).

## 41. Files Created

None (no new source files) — this phase only added tests to existing files and modified existing implementation/rules files.

## 42. Files Modified

- `functions/src/workoutLifecycle/authorizeMutation.ts` — RECOVER hardening (P0-1); earned-cycle shared-logic import (P2)
- `src/services/workoutPrograms.ts` — RECOVER/ADAPT operation-selection guard and conditional `targetPlan` (P0-1)
- `src/services/workoutLifecycleApplication.ts` — bounded 3-attempt `prepareEvolution` convergence (P2)
- `firestore.rules` — `workoutPrograms` create rule's escape hatch now gated on `existsAfter(workoutLifecycleState/current)` instead of `programInstanceId` presence (P0-2)
- `scripts/syncPrescriptionEngineToFunctions.cjs` — added `progressionEngineV2/earnedCycles` to the synced file list (P2)
- `functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts` — new RECOVER safe-but-wrong, bounds-violation, and identity-attack regression tests; seed fixture now includes `activePrescriptionIdentity`
- `firestore-tests/workoutPrograms.rules.test.ts` — new programInstanceId-omission exploit test and legacy-compatibility counterpart
- `src/services/__tests__/workoutProgression.integration.test.ts` — fixture fix (§46): the "§74/§90" test's stage-3 setup previously depended on the now-closed RECOVER content-installation path
- (incidentally, `src/services/__tests__/workoutProgramReconciliation.integration.test.ts` required no source change — it started passing once the client-side same-content/different-content distinction was added, see §46)

## 43. Acceptance P0-A–P0-L

- P0-A (RECOVER callers classified) — **PASS** (§5)
- P0-B (pure reconciliation rejects new arbitrary content) — **PASS** (§7-8; any `targetPlan` is rejected outright, not just bounds-checked)
- P0-C (content-installing RECOVER path uses canonical authority) — **N/A** — no legitimate content-installing RECOVER caller was found (§5); the one illegitimate caller was redirected to fail fast client-side instead, per the phase brief's own Option A preference for RECOVER
- P0-D (safe-but-wrong attack fails) — **PASS** (§9)
- P0-E (client identity cannot define new authoritative content) — **PASS** (§10)
- P0-F (no-targetPlan RECOVER still works) — **PASS** (existing test unaffected)
- P0-G (every workoutPrograms create requires a grant, for V2 accounts) — **PASS** (§14, §16)
- P0-H (authority enforcement independent of programInstanceId) — **PASS** (§14)
- P0-I (omission exploit denied) — **PASS** (§15)
- P0-J (direct no-grant write denied) — **PASS** (pre-existing test, still passing)
- P0-K (grant for B cannot write attacker content A) — **PASS** (pre-existing test, still passing; unaffected by this phase)
- P0-L (legacy compatibility preserved, no client-controlled bypass) — **PASS** (§17)

## 44. Acceptance VG-A–VG-J

- VG-A (PREPARE canonical consumption tested) — **NOT_TESTED**
- VG-B (PREPARE post-response mutation tested) — **NOT_TESTED**
- VG-C (MIGRATE adversarial paths tested) — **NOT_TESTED**
- VG-D (backdating ProgramInstance boundary tested) — **NOT_TESTED**
- VG-E (backdating ADAPT boundary tested) — **NOT_TESTED**
- VG-F (backdating pause/resume tested) — **NOT_TESTED**
- VG-G (deferral races tested) — **NOT_TESTED**
- VG-H (long-run Beginner→Intermediate→Advanced executed) — **NOT_TESTED**
- VG-I (long-run adaptation executed) — **NOT_TESTED**
- VG-J (Motivational Renewal long-run executed) — **NOT_TESTED**

## 45. Acceptance P2-A–P2-C

- P2-A (earned-cycle divergence fixed via shared logic) — **PASS** (§24)
- P2-B (Adaptation-vs-Prepare full-suite race no longer reproducibly failing) — **PARTIAL** — 3/3 clean full-suite runs post-fix versus reproducible failure pre-fix; substantively improved, not provably eliminated (§23)
- P2-C (backdating boundary question resolved with tests) — **NOT_TESTED** (unchanged from the original audit)

## 46. Remaining P0

None. Both PA-RECOVER-01 and FS-RULES-BYPASS-01 are closed with permanent regression tests, verified against the real Firestore/Firestore-Rules emulators.

(Mid-phase note for transparency: the initial P0-1 client-side fix was too strict on the first pass — it unconditionally blocked ALL `automatic_progression`/`automatic_reconciliation` calls once V2 lifecycle existed, which broke two legitimate pre-existing tests that rely on idempotent re-reconciliation returning the SAME already-active content as a no-op. This was caught by running the full integration suite, root-caused, and fixed by distinguishing "candidate content identical to what's already active" — legitimate, routed through a plan-less RECOVER — from "candidate content genuinely different" — illegitimate, now blocked. One test's fixture setup (`workoutProgression.integration.test.ts` §74/§90) was also adjusted, since its own setup step had been relying on the now-closed vulnerable path as a convenience shortcut to reach its fixture state; the adjustment reaches the identical fixture state through a legitimate path (`onboarding` as the account's first-ever program) without touching the test's actual assertions.)

## 47. Remaining P1

None (unchanged from the Post-Phase-10C audit — none were found there either).

## 48. Remaining P2

- P2-B (Adaptation-vs-Prepare race): improved, not provably eliminated — recommend a dedicated stress-test harness (e.g. repeated `Promise.all` races under artificial Firestore transaction delay) before the next full audit, rather than relying on incidental full-suite timing.
- P2-C (backdating boundary): unresolved, carried over unchanged from the original audit.

## 49. Remaining P3

- Grant-singleton last-write-wins race (unchanged, carried over — not a corruption risk).
- Sync-script AppState marker gap for the UI-only region (unchanged, carried over — low practical risk).
- `firestore-debug.log` tracked in git (unchanged, carried over — hygiene only, recommend `.gitignore`).
- **New this phase:** `authorizeMutation.integration.test.ts`'s `'accepts the real rotation-owed session (index 0, the anchor) for a fresh program'` test uses `new Date()` for "today" instead of a fixed/injected date, making it date/timing-fragile in a way unrelated to RECOVER or any Phase 10D change — confirmed present before this phase started and after it ended, isolated to the `COMPLETE_SCHEDULE` code path. Recommend fixing the test (inject a deterministic date) in a future pass; it is a real, if minor, gap in the "Authority Emulator" CI gate's reliability.

## 50. Final Verdict

FASE 10D PARTIAL
