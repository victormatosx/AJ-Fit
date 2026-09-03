# Manual Accelerated Lifecycle QA

Dev-only mechanism for manually exercising the real Workout Lifecycle V2
Progression Engine — beginner → intermediate → 4 earned cycles → advanced,
deferral, motivational renewal — on a physical iPhone Development Build
against the real (remote) Firebase project, in a reasonable number of real
days instead of the production windows (~28/~85 active days, 2×14-day
deferral, +30-day renewal extension).

This is **not** a fake-evolution switch. There is no `__DEV__`-gated branch
that sets `evolutionStatus = READY` or fabricates `earnedCycles`. The only
thing that changes for a QA-authorized account is which set of **time-window
constants** the exact same Progression Engine V2 evaluates against — every
other rule (70%/85% adherence, the 4-earned-cycle requirement, backend
authority, canonical prescription generation, Firestore Rules) is byte-for-
byte identical between accounts.

## 1. How an account gets QA_ACCELERATED

There is no in-app switch that grants this. It is a Firestore field on the
account's own `users/{uid}` document, settable **only** via the Firebase
Console (or Admin SDK):

```
users/{uid}.metadata.workoutLifecycleQaMode = "ACCELERATED" (string)
```

(Superseded the older `metadata.workoutLifecycleQaAccelerated: true`
boolean — still honored as a fallback for accounts not yet migrated, see
`README.md`'s "Legacy field deprecation". Use the new field for any new
authorization.) This field is single-valued and mutually exclusive with
`"TRANSITION"` — see `README.md`.

- `firestore.rules`' `users/{userId}` **update** rule restricts every
  client-originated write to `metadata.updatedAt` only — a client can never
  set this field on itself, no matter what the app UI does.
- The backend (`functions/src/workoutLifecycle/qaPolicy.ts`,
  `resolveWorkoutLifecycleQaMode`) re-reads this exact same field from
  Firestore on every `authorizeWorkoutLifecycleMutation` EARN request — it
  never trusts anything the client sends. The mode a client believes it has
  is irrelevant; only the server's own read of this field matters.
- Absent, an unrecognized value, or any non-`"ACCELERATED"`/`"TRANSITION"`
  string (a tampered local cache, a forged request field) all resolve to
  `NORMAL`. There is no fallback that grants QA on ambiguity.

### To authorize a QA account (Firebase Console)

1. Create a disposable account in the app (any normal sign-up flow).
2. Firebase Console → Firestore Database → `users` collection → find the
   document by uid (Authentication tab has the uid next to the email).
3. Edit the document → add a field inside the `metadata` map:
   - Field: `workoutLifecycleQaMode`
   - Type: `string`
   - Value: `ACCELERATED`
4. Save. No redeploy, no Cloud Function call, no Admin SDK script required
   for this minimal case — the Console write is itself an Admin-SDK-level
   write and bypasses Firestore Rules by design.

### To revoke it

Delete the `workoutLifecycleQaMode` field from that document (or set it to
any value other than `"ACCELERATED"`/`"TRANSITION"`) via the Console. The
very next `authorizeWorkoutLifecycleMutation` call and the very next app
read of the profile both resolve to `NORMAL` immediately — there is no
cache to bust, no redeploy, and no per-device state to reset.

### Confirming the account is back to NORMAL

- In the app: Settings → Developer → Workout Lifecycle → **Backend policy**
  reads `NORMAL`.
- Directly: re-read `users/{uid}.metadata.workoutLifecycleQaMode` in the
  Console — it should be absent or not one of the two recognized values.

## 2. Architecture — NORMAL vs QA_ACCELERATED

Single source of truth: `src/progressionEngineV2/config.ts`.

```ts
PROGRESSION_V2_CONFIG                 // NORMAL (production, unchanged)
PROGRESSION_V2_CONFIG_QA_ACCELERATED  // QA-only, compressed time windows
resolveProgressionV2Config(mode)      // picks one of the above
```

This file is synced verbatim into `functions/` by
`scripts/syncPrescriptionEngineToFunctions.cjs` (the same file-copy
mechanism that already keeps the deterministic prescription engine and
`earnedCycles.ts` identical between client and backend) — the backend does
**not** hold a second, independently maintained copy of these numbers.
`functions/src/workoutLifecycle/authorizeMutation.ts`'s
`authoritativeEarnedFact` — the actual authority the Cloud Function
enforces — imports this exact module and calls
`resolveProgressionV2Config(mode)`, where `mode` comes from
`progressionPolicyModeFor(resolveWorkoutLifecycleQaMode(uid, firestore))`
(`functions/src/workoutLifecycle/qaPolicy.ts`), which re-reads
`users/{uid}.metadata.workoutLifecycleQaMode` fresh on every call.

Deferral timing is a separate, smaller constant
(`src/workoutLifecycle/deferral.ts`, `DEFERRAL_CONFIG` /
`DEFERRAL_CONFIG_QA_ACCELERATED`) because it isn't gated by
`authorizeMutation.ts` at all — the 14-day window there is enforced
entirely by `firestore.rules`' `pendingEvolutions` **update** rule
(`nextPromptAt`/`autoActivateAt` must land within a tolerance band of
`request.time`). That rule now branches on a `workoutLifecycleQaModeIsAccelerated(userId)`
Rules helper (same field, same shape as `isAdmin()`) to allow a QA-only
8-12 minute band instead of the NORMAL 13-15 day band — only for
`ACCELERATED`, never for `TRANSITION` (see
`MANUAL_TRANSITION_LIFECYCLE_QA.md`). Nothing else about
the deferral state machine changes.

**What's compressed (QA_ACCELERATED only):**

| Field | NORMAL | QA_ACCELERATED |
|---|---|---|
| `beginnerMinimumActiveDays` | 28 | 7 |
| `intermediateAdvancedMinimumActiveDays` | 85 | 10 |
| `motivationalRenewalExtensionDays` | 30 | 5 |
| Deferral window (per defer) | 14 days | 10 minutes |

**What's identical in both (never touched):**

- `adherenceEarnedThresholdBp` — 70% in both.
- `adherenceHighThresholdBp` — 85% in both.
- `intermediateCyclesForPromotion` — 4 earned cycles in both.
- `inactivityMissedOpportunityThreshold` — 3 consecutive missed
  opportunities in both.
- `partialSessionMinSetCompletionPercent` — 70% of prescribed sets in both.
- `maxDeferrals` — exactly 2 in both.
- Canonical prescription generation, exercise equivalence, cycle-evolution
  ratio (20-30%), backend authority/trust-boundary enforcement,
  `assertNotBackdated`'s offline-sync grace window — all identical.

Why 7/10 days and not something smaller: opportunities are `trainingDays ∩
countedActiveDates` (`src/progressionEngineV2/prescribedOpportunities.ts`),
so the adherence denominator scales with the account's own training
frequency, not a fixed weekly count. At a typical QA testing frequency of
4-6 training days/week, a 7-day beginner window yields 4-6 prescribed
opportunities and a 10-day intermediate/advanced window yields 6-9 — enough
to land cleanly on either side of the unchanged 70%/85% boundaries (see
worked examples below). Shrinking these further would make the boundaries
too coarse to test distinctly (e.g. 3 opportunities can't express "71%" at
all). **Active day still means one real calendar day everywhere** — there
is no virtual/compressed clock. A QA tester still needs to open the app and
train on separate real days; only the *count* of days required is smaller.

## 3. Worked examples — HIGH / STANDARD / LOW / INSUFFICIENT

Assume a QA account training 6×/week (MON-SAT), Beginner level,
`beginnerMinimumActiveDays = 7`. Over a 7-day window with 6 training days,
that's 6 prescribed opportunities.

| Sessions completed / 6 | Adherence | Quality | Outcome at day 7 |
|---|---|---|---|
| 6/6 | 100% | HIGH | `LEVEL_PROMOTION_ELIGIBLE`, quality HIGH |
| 5/6 | 83.3% | GOOD (STANDARD) | `LEVEL_PROMOTION_ELIGIBLE`, quality GOOD |
| 4/6 | 66.7% | BELOW_TARGET | `PROGRESS_CONTINUES` (adherence not yet earned) |

For Intermediate/Advanced (`intermediateAdvancedMinimumActiveDays = 10`,
same 6×/week frequency → 8-9 opportunities in 10 days):

| Sessions completed / 9 | Adherence | Quality |
|---|---|---|
| 8/9 | 88.9% | HIGH |
| 7/9 | 77.8% | GOOD (STANDARD) |
| 6/9 | 66.7% | BELOW_TARGET |

Extra workouts beyond what's prescribed never inflate these ratios —
`countFulfilledPrescribedOpportunities` dedupes by
`(programInstanceId, scheduledLocalDate, sessionIndex)`, so training twice
on the same prescribed day still counts once (this logic is untouched by
QA_ACCELERATED).

## 4. Step-by-step guide for Victor

**PASSO 1 — Crie uma conta descartável**
Abra a Development Build no iPhone físico e crie uma conta nova (fluxo
normal de cadastro).

**PASSO 2 — Copie o UID**
Firebase Console → Authentication → encontre o e-mail usado → copie o
`User UID`.

**PASSO 3 — Firebase Console → Firestore Database**
Vá em `users` → abra o documento com esse UID.

**PASSO 4 — Ative QA**
Dentro do mapa `metadata`, adicione o campo
`workoutLifecycleQaMode` (tipo `string`, valor `ACCELERATED`) e salve.

**PASSO 5 — Feche e reabra o app**
Force-close a Development Build e abra de novo (garante um fetch novo do
perfil).

**PASSO 6 — Settings → Developer → Workout Lifecycle**
Esse item só aparece se a build tiver
`EXPO_PUBLIC_ENABLE_DEV_WORKOUT_LIFECYCLE_QA_PANEL=1` no `.env` (além de ser
uma Development Build/`__DEV__`).

**PASSO 7 — Confirme**
O painel deve mostrar `Backend policy: QA_ACCELERATED`. Se mostrar
`NORMAL`, revise o PASSO 4 (o campo precisa estar dentro de `metadata`, com
esse nome exato, como `boolean`).

**PASSO 8 — Complete o questionário e comece a treinar**
Use o fluxo normal do app. Complete sessões reais nos dias prescritos.

**PASSO 9 — Beginner → Intermediate**
Após ~7 dias ativos reais com adherence ≥70%, a Progression Engine deve
retornar `LEVEL_PROMOTION_ELIGIBLE` (visível no painel de Developer e no
fluxo real de evolução do app — mesma UI de produção).

**PASSO 10 — Teste HIGH vs STANDARD vs LOW**
Repita um novo ciclo (após uma evolução) variando quantas sessões
prescritas você completa, usando a tabela da seção 3 acima como guia.

**PASSO 11 — Teste Motivational Renewal**
Em vez de treinar o suficiente, deixe a adherence abaixo de 70% e continue
abrindo o app até `activeDays >= minDays + 5` (QA). O app deve oferecer
`MOTIVATIONAL_RENEWAL_AVAILABLE` — nunca conte como earned cycle.

**PASSO 12 — Teste os 4 ciclos Intermediate**
Repita earned cycles no nível Intermediate. Somente o 4º ciclo *earned*
(não Motivational Renewal, não Program Adaptation) deve liberar Advanced.

**PASSO 13 — Teste Deferral**
Ao receber uma evolução pronta, adie (defer) em vez de ativar. O primeiro
defer deve reabrir o prompt em ~8-12 minutos (QA); o segundo defer deve
ativar automaticamente ~8-12 minutos depois disso, sem qualquer ação manual
— feche e reabra o app perto desse horário para acionar a reconciliação.

**PASSO 14 — Advanced**
Confirme que o nível permanece Advanced indefinidamente, apenas repetindo
ciclos, sem criar um nível novo.

**PASSO 15 — Revogue o acesso QA**
Volte ao Firestore Console e apague o campo (ou defina `false`). Confirme
no painel Developer que `Backend policy` voltou para `NORMAL`.

## 5. Removing QA authorization

See "To revoke it" in section 1. There is no cleanup script needed — the
field is the entire authorization surface, and removing it is instantaneous
and has no side effects on the account's real lifecycle state (cycles,
executions, and history remain exactly as they were; only future
`authorizeWorkoutLifecycleMutation` calls and the Rules-checked deferral
window revert to NORMAL).

## 6. Telemetry

Trusted lifecycle telemetry (`functions/src/telemetry/trustedWorkoutLifecycleTelemetry.ts`)
now tags every emitted event with `progressionPolicy: 'NORMAL' | 'QA_ACCELERATED'`,
resolved server-side from the same field — a QA account's compressed-window
`evolution_eligible`/`level_promoted`/etc. events are never mistaken for
real production timelines downstream. No additional PII is included.
