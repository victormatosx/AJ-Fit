# Manual Transition Lifecycle QA (QA_TRANSITION)

Dev-only mechanism for manually exercising what happens **when a Workout
Lifecycle V2 evolution occurs** — new prescription, ProgramInstance,
Pending Evolution, evolution screens, prescription diff, defer, activate,
level/cycle changes — without waiting for real eligibility (active time,
adherence). See `README.md` in this directory for how this differs from
`QA_ACCELERATED` (which tests eligibility itself, on a compressed
calendar).

## What QA_TRANSITION does and does not do

**Falsifies exactly one thing:** "this account earned the right to request
its next evolution." Nothing else.

**Never falsifies:**
- `currentTrainingLevel` (never set directly).
- Earned cycle counts (never set directly).
- `PendingEvolution` (never written directly — only via the real PREPARE
  operation).
- The prescription content (always the real canonical output of the
  Prescription Evolution Engine, generated server-side).
- Active days, adherence, executions.

**Real pipeline used unmodified**, from the first safe point after
eligibility: `authorizeWorkoutLifecycleMutation` (`EARN` → `PREPARE` →
`DEFER`/`ACTIVATE`), the Prescription Evolution Engine, canonical plan
generation, ProgramInstance/TrainingCycle creation, the Schedule Engine, and
Home. None of these modules contain QA-specific branches — only
`authoritativeEarnedFact`'s eligibility check
(`functions/src/workoutLifecycle/authorizeMutation.ts`) does, and only to
skip the `activeDays >= minDays && adherence >= 70%` condition for accounts
whose `workoutLifecycleQaMode` is `TRANSITION`. The target level/cycle and
the prescription itself are still derived from the account's real current
state, exactly like a genuinely earned transition.

## Authorization

Same shape as QA_ACCELERATED: `users/{uid}.metadata.workoutLifecycleQaMode
= "TRANSITION"`, set only via the Firebase Console/Admin SDK. Mutually
exclusive with `"ACCELERATED"` — a single string field, never two
independent flags. See `README.md` for the legacy-boolean fallback (which
can never resolve to TRANSITION).

## Consequence: QA_TRANSITION accounts are disposable

Because the real activation pipeline is reused unmodified, an activated
QA-forced cycle gets `completionReason: EARNED_EVOLUTION` in
`trainingCycles/{id}` — **structurally indistinguishable from a real earned
cycle** at the Firestore data level (this is intentional — see
`src/services/workoutLifecycleApplication.ts`'s doc comment on
`prepareQaTransitionEvolution`; duplicating the activation pipeline just to
mark cycles differently would mean maintaining two lifecycle engines, which
this project explicitly avoids). The only markers distinguishing a
QA_TRANSITION-forced transition are:
- The `qaForced: true` / `triggerSource: 'QA_TRANSITION'` fields on the
  ephemeral EARN authorization request/grant (never persisted to the
  `workoutLifecycleEvents` domain ledger — that write picks an explicit
  6-field payload, so no `firestore.rules` schema change was needed).
- The `qaMode: 'QA_TRANSITION'` tag on trusted telemetry
  (`functions/src/telemetry/trustedWorkoutLifecycleTelemetry.ts`).

**Therefore: never reuse a QA_TRANSITION account as a real production
account, and never attempt to "convert" its career back to normal.** Treat
every QA_TRANSITION account as fully disposable from creation. Delete it
and create a fresh one for your next test.

## How the target is derived (never chosen by the tester)

Same branching `authoritativeEarnedFact` always uses:

| Current state | Target |
|---|---|
| BEGINNER, any cycle | `LEVEL_PROMOTION` → INTERMEDIATE |
| INTERMEDIATE, earned cycles + 1 < 4 | `CYCLE_EVOLUTION` → next INTERMEDIATE cycle |
| INTERMEDIATE, earned cycles + 1 >= 4 | `LEVEL_PROMOTION` → ADVANCED |
| ADVANCED, any cycle | `CYCLE_EVOLUTION` → next ADVANCED cycle (never a new terminal level) |

The Developer panel's "Expected transition" row shows this before you tap
anything.

## The action: "PREPARAR PRÓXIMA EVOLUÇÃO"

Settings → Developer → Workout Lifecycle (QA_TRANSITION accounts only)
shows:
- Current level / cycle / ProgramInstance / content identity.
- Expected transition (derived as above).
- If a Pending Evolution already exists: its type/status/deferralCount, and
  an explicit instruction to use the real app UI for Start/Defer, never
  this panel.
- Otherwise: a single button, **PREPARAR PRÓXIMA EVOLUÇÃO**.

Tapping it:
1. Requests EARN with a QA-forced candidate fact (real current
   adherence/valid-session numbers, target derived as above) — the backend
   independently re-derives the same target and only skips the
   activeDays/adherence check because this account's `workoutLifecycleQaMode`
   is `TRANSITION`.
2. Falls through to the real, unmodified PREPARE pipeline
   (`prepareEvolution`) — canonical prescription generation, ProgramInstance,
   Pending Evolution.

The button never auto-activates. After it succeeds, close the panel and use
the real app (Home / evolution unlock screen) to inspect the pending
evolution, compare old vs. new prescription, and Start/Defer/Activate for
real.

## Same-level cycle (Intermediate N → N+1, Advanced N → N+1)

Uses the exact same Prescription Evolution Engine cycle-evolution path a
real earned cycle uses — ~20-30% exercise variation, exercise equivalence,
movement-role preservation, anti ping-pong, same frequency/split, volume
kept approximately equivalent. No QA-specific prescription logic exists.

## Intermediate → Advanced without four real cycles

QA_TRANSITION does not fabricate `earnedIntermediateCycles`. To reach
ADVANCED, actually walk the four Intermediate transitions with QA_TRANSITION
(prepare → defer/observe → activate, four times) — each activation writes a
real `completionReason: EARNED_EVOLUTION` cycle, so by the fourth
`countEarnedIntermediateCycles` genuinely returns 3 (+1 = 4) and the same
real rule the production career uses decides ADVANCED. This is a handful of
manual passes, not four real cycles' worth of real training days — that's
exactly what QA_TRANSITION is for.

## Pending / Defer / Activate

Deliberately real, deliberately not sped up: QA_TRANSITION does not compress
the deferral window (that's QA_ACCELERATED's job, and it doesn't apply
here — `firestore.rules`' `workoutLifecycleQaModeIsAccelerated()` only
returns true for `ACCELERATED`). A QA_TRANSITION account's deferral uses
the real 13-15 day tolerance band. If you need to test defer/auto-activate
timing quickly, use QA_ACCELERATED for that specific scenario instead —
QA_TRANSITION's job is prescription/transition/UX, not timing.

## Changing QA mode while pending

See `README.md`'s "Changing QA mode while a Pending Evolution exists" — do
not switch a QA_TRANSITION account to ACCELERATED (or vice versa) while a
Pending Evolution is open.

## Manual QA guide for Victor

1. Crie uma conta nova (ou reutilize uma conta QA_TRANSITION descartável já
   em uso — nunca uma conta real).
2. Copie o UID (Firebase Console → Authentication).
3. Firestore → `users/{uid}` → dentro de `metadata`, adicione o campo
   `workoutLifecycleQaMode` (tipo `string`, valor `"TRANSITION"`).
4. Force-quit o app.
5. Abra o app novamente.
6. Settings → Developer → Workout Lifecycle.
7. Confirme: `Backend policy = QA_TRANSITION`.
8. Toque em **PREPARAR PRÓXIMA EVOLUÇÃO**.
9. Volte para o app (feche o painel Dev).
10. Valide a tela de evolução real: explicação, comparação treino
    antigo/novo.
11. **NÃO ative ainda** — teste primeiro o Defer real pelo app.
12. Depois teste o Activate real pelo app.
13. Confirme na Home que o novo programa está ativo e o Schedule reiniciou
    corretamente.
14. Repita o passo 8 para a próxima transição (Intermediate mesmo nível, ou
    Intermediate → Advanced na quarta vez, ou Advanced → próximo ciclo).

Nenhum passo aqui usa Java, Firebase Emulator, ou edição manual de
documentos de lifecycle — apenas o Firebase Console para autorizar o modo,
e o app real para todo o resto.
