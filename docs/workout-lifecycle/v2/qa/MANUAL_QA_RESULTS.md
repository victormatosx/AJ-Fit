# Manual QA Results — Workout Lifecycle V2

Log of real manual QA runs on physical devices against the real (remote)
Firebase project. See `MANUAL_ACCELERATED_LIFECYCLE_QA.md` for how to
authorize/run these; this file only records outcomes.

---

## RUN-001 — First end-to-end baseline (Beginner Cycle 1, QA_ACCELERATED)

**STATUS: PASS**
**Date:** 2026-09-03
**Environment:** iPhone físico / Development Build / Firebase real (`ajfit-2f321`)
**Account:** new disposable account (UID not recorded here — see operator notes if needed)

### Account state
- `initializationOrigin`: `V2_NATIVE`
- `startingLevel`: `BEGINNER`
- `currentTrainingLevel`: `BEGINNER`
- `currentCycleNumber`: `1`
- Policy: `QA_ACCELERATED`

### Questionnaire scenario
Male, 22, hypertrophy, beginner, 4x/week, 60 min, gym, no limitations.

### Prescription
- Program generated correctly (T003, Upper/Lower x2).
- Workout Lifecycle V2 state created automatically at generation time (no
  manual intervention) — this is the fix validated by this run (see
  "Bugs fixed and validated by this run" below).
- `ProgramInstance` created.
- Schedule created/resolved (`SESSION_READY`).

### Before the workout
| Field | Value |
|---|---|
| Current level | BEGINNER |
| Cycle | 1 |
| Active days | 1 |
| Prescribed opportunities | 1 |
| Valid sessions | 0 |
| Adherence | 0% |

### Action
Prescribed session started from Home → all sets completed for real (not a
rushed click-through) → session finished via the real app flow (not a
test harness, not a manually-written Firestore document).

### After the workout
| Field | Value |
|---|---|
| Valid sessions | 1 |
| Adherence | 100% (HIGH) |
| Evolution | `PROGRESS_CONTINUES` / `MINIMUM_ACTIVE_TIME_NOT_REACHED` |
| Home | Shows workout completed; does not re-offer the same session; next session resolved correctly |

### What this run proves, end to end
```
WorkoutExecution (real, 100% sets COMPLETED)
→ session qualification (isValidProgressionSessionAgainstPrescription)
→ authorizeWorkoutLifecycleMutation(COMPLETE_SCHEDULE) — backend authority granted
→ scheduleEvent COMPLETED written
→ scheduleState advanced (nextSessionIndex, cursorDate, lastCompletedAt)
→ Home resolves TODAY_COMPLETED (not SESSION_READY again)
→ Valid Session counted by authoritativeEarnedFact (backend-recomputed)
→ Progression V2 snapshot reflects the real completion
```

### Bugs fixed and validated by this run
- **`SESSION_INDEX_OUT_OF_SEQUENCE`** on the first-ever completion of a
  `ProgramInstance` whose anchored first session isn't index 0 (e.g.
  activation lands on a `trainingDay` other than the first one in the
  ordered list). Root cause: `completeScheduledSession`'s expected-index
  fallback used a hardcoded `?? 0` instead of the same anchor derivation
  the Schedule Engine itself uses (`initialSessionIndexFor` /
  `anchorSessionIndex`, `src/scheduleEngine/resolver.ts`). Fixed in
  `src/services/workoutSchedule.ts`; regression-tested against the real
  Firestore Emulator (`src/services/__tests__/workoutExecutions.integration.test.ts`).
- New-account bootstrap into Workout Lifecycle V2 no longer depends on the
  legacy V1→V2 rollout gate (`workoutLifecycleRolloutConfig/active`) —
  confirmed working on this run's account, which enrolled in V2 directly
  at generation time.
- App Check debug-token attestation on a physical Development Build
  confirmed working (`authorizeWorkoutLifecycleMutation` /
  `recordWorkoutLifecycleTelemetry` both succeeded).

### Notes
No credentials, tokens, or full UIDs are recorded in this file.
