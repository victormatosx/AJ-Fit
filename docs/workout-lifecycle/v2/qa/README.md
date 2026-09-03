# Workout Lifecycle V2 — Manual QA modes

Three account modes exist, mutually exclusive, all derived from a single
Firestore field:

```
users/{uid}.metadata.workoutLifecycleQaMode: 'ACCELERATED' | 'TRANSITION' (absent = NORMAL)
```

Set exclusively via the Firebase Console or Admin SDK — never client-writable
(`firestore.rules`' `users/{userId}` update rule restricts client writes to
`metadata.updatedAt` only). The backend re-reads this same field on every
authorization decision; nothing about it is trusted from the client.

| Mode | Tests | Does not test |
|---|---|---|
| **NORMAL** | Real production behavior, real timelines, real eligibility. | No compression, no shortcuts. |
| **QA_ACCELERATED** | Whether a user genuinely earns evolution: active-time accrual, adherence (70%/85%), Valid Sessions, HIGH/STANDARD/renewal, the 4-earned-cycle rule — on a compressed calendar. See `MANUAL_ACCELERATED_LIFECYCLE_QA.md`. | Does NOT skip eligibility — every gate is real, just faster. Does not test what happens after a transition (UI, prescription diff, defer/activate) beyond what ACCELERATED's own natural pace reaches. |
| **QA_TRANSITION** | What happens when an evolution occurs: new prescription, ProgramInstance, Pending Evolution, evolution screens, prescription diff, defer, activate, level/cycle changes (Beginner→Intermediate, Intermediate cycle N→N+1, Intermediate→Advanced, Advanced cycle N→N+1). See `MANUAL_TRANSITION_LIFECYCLE_QA.md`. | Does NOT validate earned eligibility, minimum active time, adherence, or the 70%/85% rules — those are entirely bypassed for this mode by design. |

## Architecture, one paragraph

```
NORMAL           → real behavior throughout.
QA_ACCELERATED   → real behavior, real eligibility, compressed calendar only.
QA_TRANSITION    → eligibility is replaced by explicit QA authorization;
                    everything else (canonical prescription, ProgramInstance,
                    TrainingCycle, Pending Evolution, defer/activate, Schedule,
                    Home) is the exact same real pipeline a genuinely earned
                    transition uses.
```

Only ONE numeric threshold-affecting decision is ever touched by QA at all:
`authoritativeEarnedFact`'s eligibility check
(`functions/src/workoutLifecycle/authorizeMutation.ts`). QA_ACCELERATED
changes the *thresholds* that check compares against
(`src/progressionEngineV2/config.ts`); QA_TRANSITION skips the check
entirely for that one account, on that one call, and derives the transition
target from the account's real current level/cycle state — never from a
client-supplied value.

## Files in this directory

- `README.md` — this file.
- `MANUAL_ACCELERATED_LIFECYCLE_QA.md` — how to authorize/run QA_ACCELERATED.
- `MANUAL_TRANSITION_LIFECYCLE_QA.md` — how to authorize/run QA_TRANSITION.
- `MANUAL_QA_RESULTS.md` — log of real manual QA runs and their outcomes.

## Legacy field deprecation

Before `workoutLifecycleQaMode` existed, QA_ACCELERATED was granted via a
boolean: `metadata.workoutLifecycleQaAccelerated: true`. This boolean is
still honored as a fallback — **only** when `workoutLifecycleQaMode` is
absent — so no already-authorized account silently loses QA access
(`src/workoutLifecycle/qaPolicy.ts` / `functions/src/workoutLifecycle/qaPolicy.ts`,
`qaModeFromMetadata`/`resolveWorkoutLifecycleQaMode`). It can never resolve
to `QA_TRANSITION` — that mode never existed under the old boolean.

**Migration procedure for any account still using the old boolean:** in the
Firebase Console, add `metadata.workoutLifecycleQaMode = "ACCELERATED"` and
remove (or leave — it's ignored once the new field is present)
`metadata.workoutLifecycleQaAccelerated`. There is no automatic migration
script — the number of QA accounts has always been small and disposable
enough that a manual Console edit per account is safer than a migration
Cloud Function for a field this narrow.

Once no account relies on the old boolean, the fallback branch in both
`qaModeFromMetadata` functions and the `workoutLifecycleQaAccelerated`
key in `firestore.rules`' `metadataValid`/`workoutLifecycleQaModeIsAccelerated`
should be deleted.

## Mutual exclusivity

`workoutLifecycleQaMode` is single-valued — never two independent booleans.
A given account is at all times exactly one of `NORMAL` / `QA_ACCELERATED` /
`QA_TRANSITION`, both by field shape (one string field, not two flags) and
by test coverage (`functions/src/workoutLifecycle/__tests__/qaPolicy.test.ts`,
`functions/src/workoutLifecycle/__tests__/authorizeMutation.integration.test.ts`).

## Changing QA mode while a Pending Evolution exists

**Do not change `workoutLifecycleQaMode` for an account that currently has
an open `pendingEvolutions/current` document.** The Settings > Developer >
Workout Lifecycle panel shows an explicit warning banner whenever a pending
evolution exists under QA_TRANSITION. There is no automated technical lock
against this — the Console write bypasses all app code — so the safe
procedure is operational:

1. Before switching a QA account's mode, open the Developer panel and
   confirm there is no Pending Evolution outstanding.
2. If one exists, either activate it (real ACTIVATE, via the app) or let it
   run its course, before touching `workoutLifecycleQaMode` in the Console.
3. If you must switch anyway, treat the account as **compromised for QA
   purposes** — delete it and create a fresh one rather than trying to
   reason about a lifecycle whose pending transition was authorized under a
   different mode than the one now active.
