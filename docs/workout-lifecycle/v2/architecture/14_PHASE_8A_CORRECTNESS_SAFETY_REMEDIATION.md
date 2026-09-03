# Fase 8A — Correctness & Safety — Relatório Final

Date: 2026-08-29  
Verdict: COMPLETE  
Scope: the seven correctness/safety findings explicitly authorized for Phase 8A.

## 1. Git

Branch `main`; frozen starting HEAD
`d24319ba15e63095fd376bcd99acd30f4abce343`. The worktree already contained
the uncommitted Phase 7 implementation/audit state. It was preserved; no
reset, checkout, cleanup or commit was performed.

## 2. Findings Reproduced Before Fix

New regressions were written before the fixes. The focused pre-fix run had 7
failures and 40 passes: ratios immediately below 70/85 were rounded upward;
starting/legacy Intermediate C1 was not credited after an earned successor;
and real hip-thrust → cable-glute-kickback was accepted despite crossing from
compound to isolation.

## 3. Architecture Before

Adaptation and evolution could re-read the origin questionnaire; progression
gathering aggregated a career cycle's ProgramInstances; adherence counted
valid executions; earned credit lived indirectly on successor entry reason;
and equivalence treated declared similarity/muscle-pattern proximity as enough
without a hard mechanic/slot-role gate.

## 4. Architecture After

The active ProgramInstance owns immutable effective inputs; a ProgramInstance
also defines the progression-window anchor. Adherence is the intersection of
qualifying executions and prescribed schedule opportunities. Earned completion
is explicit on the completed cycle. Equivalence applies role and slot context
before novelty ranking.

## 5. Authoritative Prescription Inputs

`PrescriptionInputSnapshot` embeds deterministic `snapshotId`, schema version,
source and normalized effective inputs. Adaptation and future evolution load
the active ProgramInstance snapshot. Pending evolution stores the target
snapshot it was prepared against.

## 6. Questionnaire Immutability

The questionnaire remains the immutable origin. Emulator coverage compares
the full document before/after limitation and consecutive adaptations. No
adaptation writer updates it.

## 7. Current Level Semantics

`WorkoutLifecycle.currentTrainingLevel` is overlaid in memory and wins over a
snapshot/questionnaire experience answer. Emulator coverage proves an original
Beginner origin produces an Advanced adaptation snapshot after the career fact
becomes Advanced.

## 8. Program Adaptation

Adaptation merges a partial patch over current effective answers, excludes
`level` from caller-writable fields, activates immediately and creates a fresh
ProgramInstance while preserving the TrainingCycle.

## 9. Limitation Persistence

The real 116-exercise catalog plus canonical limitation profiles proves knee
limitation persistence through limitation adaptation, duration adaptation,
goal adaptation, Level Promotion candidate and Cycle Evolution candidate. All
resulting prescribed exercises are knee-safe.

## 10. Progression Window Reset

Active time starts at active `ProgramInstance.activatedAt`; executions and
schedule opportunities are loaded only for that ProgramInstance. Immediately
after adaptation the emulator reports zero valid sessions and minimum time not
reached; new ProgramInstance history later advances normally.

## 11. Career Preservation

Adaptation does not change career level, current TrainingCycle ID/number or
earned completed cycles. Old executions and snapshots remain historical.

## 12. Adherence Before

The old numerator was the number of qualifying executions. Valid workouts on
extra days could therefore increase the ratio even without a prescribed
opportunity, and duplicates relied on incidental storage behavior.

## 13. Prescribed Opportunity Model

Credit requires a qualifying active-instance execution and a `COMPLETED`
schedule event with the same `(scheduledLocalDate, sessionIndex)`. Sets on
both sides deduplicate the key. The final ratio is still capped at 100%.

## 14. Extra Workout Regression

Unit and emulator cases prove 6 fulfilled prescribed opportunities plus 4
extra valid workouts remain 6/10 = 60%. Extra execution documents remain in
history.

## 15. Duplicate Opportunity Handling

Duplicate execution records and duplicate schedule events for one opportunity
produce exactly one credit. A schedule event without a qualifying execution,
or an execution without a completed opportunity, produces none.

## 16. Intermediate Earned Cycle Semantics

`TrainingCycle.completionReason = EARNED_EVOLUTION` is written when the cycle
actually completes. Renewal and adaptation never write it. Pre-8A history uses
only conservative exact-successor inference.

## 17. Starting Intermediate Journey

The emulator materializes starting Intermediate C1–C4, verifies three prior
credits before C4, obtains Intermediate→Advanced eligibility on C4, activates
the promotion and finishes with exactly four completed earned Intermediate
cycles.

## 18. Beginner→Intermediate Journey

The existing end-to-end promotion test remains green. Entering Intermediate
creates Intermediate C1 active and pre-awards no Intermediate completion.

## 19. Legacy Intermediate Journey

A lone legacy baseline counts zero. Once an exact C2 earned successor proves
C1's completion, conservative pre-8A inference counts one; unrelated,
non-adjacent or motivational records cannot invent credit.

## 20. 70% Boundary

Count-based classification uses integer cross multiplication. Resolver
eligibility compares the mathematical ratio directly. 0.699, 0.6999, 0.69995
and 0.69999 remain below target; exactly 0.70 qualifies.

## 21. 85% Boundary

Values 0.849, 0.8499, 0.84995 and 0.84999 remain GOOD; exactly 0.85 is HIGH.
Basis-point rounding remains allowed only for frozen display/history values,
never decisions.

## 22. Exercise Dataset Audit

The canonical catalog has 116 exercises. Real declared edges yield more than
20 accepted role-preserving alternatives and cover both compound and isolation
roles. Every accepted declared edge preserves pattern and mechanic.

## 23. Equivalence Before

The real dataset declared hip-thrust and cable-glute-kickback similar. Pattern
and primary muscle matched, so the compound anchor could become an isolation
accessory.

## 24. Equivalence After

Mechanic mismatch is a hard `ROLE_MISMATCH`; slot pattern/mechanic mismatch is
`SESSION_CONTEXT_MISMATCH`; movement anchors are immutable. Explicit similar
IDs cannot bypass any hard gate.

## 25. Positive Equivalence Cases

Real machine-shoulder-press → dumbbell-shoulder-press is accepted as a
compound→compound, same-pattern, equipment-valid alternative in a non-anchor
strength slot. Dataset-wide positive coverage remains available.

## 26. Safety Cases

Equipment and limitation gates run before ranking. Unknown limitation profiles
are unsafe when a region is declared. When no safe equivalent exists, the
current slot is preserved and a safety-constrained warning is emitted.

## 27. Determinism

Snapshot identity uses stable key ordering and hashing. Opportunity counting
uses deterministic keys. Equivalence ranking and cycle evolution remain stable
for the same input/cycle identity; repeated evaluations are equal.

## 28. Schema Changes

Added versioned effective-input snapshot types, optional pre-8A reader fields,
explicit earned completion reason and schedule-event ProgramInstance scope.
New writes always include the new snapshot/completion fields.

## 29. Firestore Rules

Rules validate snapshot top-level/input keys, source/schema basics, require a
target snapshot on new pending evolution, protect ProgramInstance snapshots
from mutation, validate earned completion reason, and continue denying
cross-user access. Result: 342/342 Firestore Rules tests passed.

## 30. Migration / Backfill

No destructive backfill is required. Missing snapshot reads use the historical
questionnaire plus authoritative current level, never write old history, and
persist a snapshot only on the next real activation. Missing completion reason
gets no credit unless an exact earned successor proves it.

## 31. Account Deletion

Snapshots are embedded in ProgramInstance/pending documents, so existing V2
collection cleanup deletes them atomically with their owners. The real cleanup
emulator fixture includes both snapshot locations and passed 2/2.

## 32. Files Changed

Core changes: `src/workoutLifecycle/{types,domain,prescriptionInputs}.ts`,
`src/services/{prescriptionInputs,prescriptionEvolution,workoutPrograms,workoutLifecycle,workoutLifecycleApplication,workoutProgressionV2}.ts`,
`src/progressionEngineV2/{adherence,earnedCycles,prescribedOpportunities,resolver}.ts`,
`src/prescriptionEvolution/{equivalence,cycleEvolution}.ts`, schedule event
types, Firestore Rules/tests, lifecycle/progression/equivalence integrations,
account-deletion fixture, ADR-012 and this report.

## 33. Test Matrix

- App typecheck: PASS.
- App unit suite: 244 files, 3,939 passed, 85 skipped.
- Functions typecheck/unit: 81 files, 1,173 passed, 39 skipped.
- Firestore Rules: 15 files, 342 passed.
- Lifecycle Application emulator: 10 passed.
- Progression V2 emulator: 7 passed.
- Cleanup emulator: 2 passed.
- Aggregate Firestore integration: 664/665 on first run; the sole 5s V1
  Advanced timeout reran green in isolation (8/8), with no assertion failure.

## 34. New Regression Tests

Added exhaustive 70/85 boundaries at classifier and resolver layers;
prescribed-vs-extra and duplicate-opportunity cases; starting/legacy
Intermediate credit; real role-negative hip-thrust case; real role-positive
and dataset-wide coverage; limitation persistence/consecutive adaptations;
questionnaire/snapshot history; adaptation reset/new progress; Rules mutation,
shape and cross-user denial; cleanup snapshots.

## 35. Acceptance Criteria

Every criterion is evaluated individually:

| ID | Status | Evidence summary |
|---|---|---|
| A | PASS | questionnaire deep-equality emulator assertion |
| B | PASS | versioned ProgramInstance snapshot |
| C | PASS | knee survives future paths |
| D | PASS | duration/goal adaptations retain knee |
| E | PASS | Advanced career level overrides Beginner origin |
| F | PASS | Cycle Evolution snapshot uses adapted inputs |
| G | PASS | Level Promotion snapshot uses adapted inputs |
| H | PASS | A/B/C snapshots retain distinct identities |
| I | PASS | canonical real-catalog knee-safe plans |
| J | PASS | adaptation creates fresh ProgramInstance |
| K | PASS | career level preserved |
| L | PASS | TrainingCycle ID preserved |
| M | PASS | active-instance window restarts |
| N | PASS | old executions excluded from numerator |
| O | PASS | old active time excluded by new anchor |
| P | PASS | expected sessions begin on new instance |
| Q | PASS | earned cycles remain in career history |
| R | PASS | numerator is opportunity intersection |
| S | PASS | 6 prescribed + 4 extra = 6 credits |
| T | PASS | set-key one-credit invariant |
| U | PASS | duplicate execution/event test |
| V | PASS | partial ≥70% qualification retained |
| W | PASS | partial below 70% rejected |
| X | PASS | extra execution records retained |
| Y | PASS | adherence cap regression remains green |
| Z | PASS | starting Intermediate C1 completion is #1 |
| AA | PASS | C4 produces Advanced eligibility/activation |
| AB | PASS | Beginner promotion creates active C1, zero prior |
| AC | PASS | lone legacy baseline is zero |
| AD | PASS | exact earned successor makes legacy C1 #1 |
| AE | PASS | renewal has no earned completion reason |
| AF | PASS | adaptation has no earned completion reason |
| AG | PASS | deterministic cycle identity/retry cannot duplicate |
| AH | PASS | exhaustive mathematical values below 70 |
| AI | PASS | exactly 70 qualifies |
| AJ | PASS | exhaustive mathematical values below 85 |
| AK | PASS | exactly 85 is HIGH |
| AL | PASS | display rounding removed from decisions |
| AM | PASS | partial-set threshold suite green |
| AN | PASS | pattern hard gate |
| AO | PASS | muscle/purpose hard gate |
| AP | PASS | mechanic/role hard gate |
| AQ | PASS | equipment hard gate |
| AR | PASS | limitation hard gate |
| AS | PASS | anchor and slot pattern/mechanic context |
| AT | PASS | declared similar cannot bypass role |
| AU | PASS | compound→isolation rejected |
| AV | PASS | hip-thrust regression rejected |
| AW | PASS | real compound→compound accepted |
| AX | PASS | preserve/warn safe fallback |
| AY | PASS | safety gate precedes novelty |
| AZ | PASS | deterministic evolution/ranking tests |
| BA | PASS | sets/reps/rest and total sets unchanged |
| BB | PASS | prescribed frequency invariant suite green |
| BC | PASS | TypeScript schemas compile |
| BD | PASS | writers/readers and pending compatibility aligned |
| BE | PASS | 342 Rules tests green |
| BF | PASS | deterministic read-only compatibility path |
| BG | PASS | no legacy earned history invented |
| BH | PASS | real cleanup deletes embedded snapshots |
| BI | PASS | cross-user Rules denial |
| BJ | PASS | historical snapshot mutation denied |
| BK | PASS | Phase 1/unit/integration coverage green |
| BL | PASS | Phase 2 progression coverage green |
| BM | PASS | Phase 3 evolution/dataset coverage green |
| BN | PASS | Phase 4 lifecycle application coverage green |
| BO | PASS | relevant Phase 5 UI/domain unit coverage green |
| BP | PASS | Rules and cleanup infrastructure green |
| BQ | PASS | adapted-input P0 no longer reproducible |
| BR | PASS | extra-workout inflation no longer reproducible |
| BS | PASS | fifth-cycle bug no longer reproducible |
| BT | PASS | 70/85 rounding bugs no longer reproducible |
| BU | PASS | role-equivalence counterexample rejected |

## 36. Residual Audit

Searches confirm no decision-layer `Math.round(ratio * 10000)` remains; the
only basis-point freeze is presentation/history. Progression gathers only the
active ProgramInstance. Adaptation/evolution no longer load the origin
questionnaire directly. Earned counting does not use ProgramInstance count.
Explicit similar IDs still enter the pool but cannot bypass role/safety gates.

## 37. Out of Scope

Unchanged by instruction: replacing V1 hot-path authority, rollout activation,
telemetry provider, full Firestore Rules hardening, adaptation UI, automatic
scheduler, full concurrency redesign, CI/lint cleanup, small-program novelty
ratio policy, exercise ordering, XP/achievement work.

## 38. Known Issues

The aggregate integration command experienced one emulator-only 5-second
timeout after a long serial run; the exact V1 Advanced file immediately passed
8/8 in isolation. This was not hidden or converted into a larger timeout.
Firebase emulator logs also print expected denied-rule traces. Neither is a
correctness failure in the seven Phase 8A objectives. `git diff --check` also
reports the pre-existing two-space Markdown hard-break lines on `**Status:**`
across the broad dirty Phase 7 documentation set; CI/lint cleanup was
explicitly out of scope and those unrelated lines were not mechanically
rewritten.

## 39. Fase 8A Verdict

FASE 8A COMPLETE. All seven central objectives are implemented and exercised:
authoritative adapted inputs, immutable versioned snapshots, adaptation-window
reset, prescribed-opportunity adherence, exactly four Intermediate earned
cycles, exact 70/85 boundaries, and role/session-aware equivalence. No commit
was created.
