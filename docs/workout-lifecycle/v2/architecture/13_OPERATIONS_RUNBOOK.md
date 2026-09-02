# Workout Lifecycle V2 — Production Rollout Runbook

**Status:** OPERATIONAL — Phase 8C (rollout) and Phase 10E (circuit breaker). This is the single rollout and rollback runbook, and — from §"Circuit Breaker" onward — the single incident kill-switch runbook.

## Authority and safety boundary

The rollout flag controls only accounts that do not yet have
`users/{uid}/workoutLifecycleState/current`. An existing V2 lifecycle always
short-circuits the gate and remains under V2 authority. Turning rollout off,
lowering its percentage, or losing access to the config must never delete,
downgrade, or route an existing V2 account back to V1.

The authoritative Admin-owned document is
`workoutLifecycleRolloutConfig/active`:

```json
{ "schemaVersion": 1, "enabled": true, "percentage": 10 }
```

Those are the only accepted fields. `percentage` is an integer from 0 through
100. Missing, unreadable, or malformed config fails closed for new enrollment;
the legacy workout remains usable. There is deliberately no client cache: a
stale cached ON value would defeat the kill switch.

## Operator prerequisites

Use an approved operator identity with Application Default Credentials and
always provide the explicit Firebase project ID. Never paste credentials,
service-account JSON, access tokens, user data, or production document content
into this repository, a command line, or an incident ticket.

```bash
npm ci
npm run ops:lifecycle-rollout -- --project <project-id> --read
```

The helper is dry-run by default. Inspect its JSON before adding `--apply`.

## Enable or change a cohort

```bash
# Preview 10%
npm run ops:lifecycle-rollout -- --project <project-id> --set 10

# Apply 10%
npm run ops:lifecycle-rollout -- --project <project-id> --set 10 --apply

# Verify authoritative state
npm run ops:lifecycle-rollout -- --project <project-id> --read
```

Recommended sequence: internal accounts, then 1%, 5%, 10%, 25%, 50%, and
100%. Hold at least 24 hours at 1–10% and at least 48 hours at 25–50%, covering
a normal workout-completion window. Advance only after the health gates below
remain green and support has confirmed that workouts are not being blocked.
The UID-derived 0–99 bucket is deterministic: increasing the percentage adds
users; it never reshuffles or unenrolls an existing V2 user.

## Immediate kill switch

```bash
# Preview OFF
npm run ops:lifecycle-rollout -- --project <project-id> --off

# Stop new enrollment without an app deploy
npm run ops:lifecycle-rollout -- --project <project-id> --off --apply

# Verify
npm run ops:lifecycle-rollout -- --project <project-id> --read
```

OFF means `{schemaVersion: 1, enabled: false, percentage: 0}`. It prevents new
V1→V2 enrollment. Existing V2 accounts continue normally, including
progression, preparation, deferral, activation, adaptation, and reconciliation.

## Health gates and incident triggers

Client diagnostic telemetry is sent by the authenticated, App Check-enforced
`recordWorkoutLifecycleTelemetry` callable. Trusted domain success metrics are
projected only by `onTrustedWorkoutLifecycleEventCreated` after the matching
immutable lifecycle event persists. Both write structured Cloud Logging entries
with component `workout-lifecycle`; bounded payloads exclude names, email,
questionnaire answers, limitation text and UID. The client callable rejects
trusted-domain names (ADR-015).

Example Logs Explorer filter:

```text
jsonPayload.component="workout-lifecycle"
jsonPayload.event="migration_failed"
```

Before each ramp, evaluate at least one full hold window:

- `migration_failed / lifecycle_rollout_decision{decision=ENROLLED}` stays
  below 1% and has no sustained upward trend.
- `lifecycle_reconcile_failed / lifecycle_reconcile_started` stays below
  0.5%, with no repeated referent-missing or permission category.
- No successful activation/preparation event follows a failed domain write for
  the same attempted operation in controlled validation.
- No sustained increase in stale-transition conflicts beyond known converged
  races, permission denials, impossible-state diagnostics, crashes, or support
  reports that a workout is inaccessible.
- Config-read failures are zero during a planned ramp. A single sustained
  config outage is sufficient to pause the ramp even though new enrollment
  already fails closed.

Stop new enrollment immediately for breached thresholds, an unexplained
integrity error, cross-user authorization concern, false-success telemetry,
or any user-facing workout blockage.

## Roll back safely

1. Apply and verify `--off`.
2. Keep the V2 Rules, schemas, telemetry callable, and reconciliation code
   deployed. Do not restore V1 as lifecycle authority.
3. Do not delete or edit lifecycle, cycle, instance, event, pending-evolution,
   or prescription-input documents to “unmigrate” users.
4. Validate one already-V2 account: its state and active referents still load
   and a normal reconciliation remains idempotent.
5. Validate one not-yet-V2 account: its active legacy workout still loads and
   no new V2 documents are created.
6. Diagnose the incident, ship a forward fix, rerun the full local/CI gate,
   then resume from the previous proven percentage rather than 100%.

Account deletion remains the only authorized whole-user cleanup path. An old
client may read compatible data, but must not regain lifecycle mutation
authority.

## Circuit Breaker — incident kill switch for already-migrated V2 users

### Rollout ≠ Circuit Breaker

These are two separate mechanisms. Do not confuse them, and do not use one where the other is needed.

| | Rollout (`workoutLifecycleRolloutConfig/active`) | Circuit Breaker (`workoutLifecycleCircuitBreaker/active`) |
|---|---|---|
| Controls | Who is allowed to **enter** V2 (new V1→V2 migrations only) | Whether specific **already-migrated** V2 accounts' mutations may proceed **right now** |
| Effect on an existing V2 account | None — a V2 account always short-circuits the rollout gate | Blocks specific operations for every V2 account while open |
| Use for a lifecycle-correctness incident affecting current V2 users | **No effect** | **Yes — this is the tool** |
| Use to stop new users from joining V2 | Yes — this is the tool | No effect on new enrollment |

Turning rollout off during an incident does **not** protect any account that already has `workoutLifecycleState/current`. If the incident affects the already-migrated population — the population a staged rollout is actively watching — the circuit breaker is the only lever that does anything.

### What it is, with evidence

- **Config document:** `workoutLifecycleCircuitBreaker/active` (Firestore, top-level collection, not user-scoped).
- **Schema:** `{ schemaVersion: 1, open: boolean }`. No other fields are accepted (`functions/src/workoutLifecycle/circuitBreaker.ts`, `isValidCircuitBreakerConfig`).
- **Meaning of the field:** `open: true` = circuit OPEN = block the operations in the matrix below. `open: false` (or the document absent/malformed) = normal operation.
- **Default when missing/malformed:** fails closed to **normal operation** (`open: false`), never to "block everything" — a missing ops document is not itself an incident signal (`CIRCUIT_BREAKER_FAIL_SAFE_CONFIG`, `circuitBreaker.ts`).
- **Who can modify it:** nobody via the client SDK. `firestore.rules` — `match /workoutLifecycleCircuitBreaker/{configId} { allow read, write: if false; }`. Only Admin SDK / Firebase Console access can change it. There is no dedicated operator npm script for this document today (unlike rollout's `scripts/workoutLifecycleRollout.cjs`) — see "How to open" below for the two real, currently-available procedures.
- **Cache:** none. Every call to `authorizeWorkoutLifecycleMutation` reads the document fresh (`loadWorkoutLifecycleCircuitBreakerConfig`, a plain `firestore.collection(...).doc('active').get()` with no in-memory memoization) — there is no propagation delay and no stale-cache risk to reason about.
- **Backend entrypoint that enforces it:** `functions/src/workoutLifecycle/authorizeMutation.ts`, inside `authorizeWorkoutLifecycleMutationHandler` — the circuit-breaker check runs immediately after auth/request-parsing and strictly before any request validation or authority-grant issuance. This is the sole function that ever issues a lifecycle authority grant; there is no other path to install content or activate a pending evolution. An old or modified client cannot opt out — the check is unconditional and server-side, not a UI affordance.

### Operation matrix (confirmed against current code, `circuitBreaker.ts`)

| Operation | Circuit open | Reason |
|---|---|---|
| INITIALIZE | **BLOCK** | Installs a brand-new account's first V2 content. Rollout already gates who reaches this; blocking it here too is an extra incident brake for accounts that passed the rollout gate before the incident started. |
| MIGRATE | **BLOCK** | Same reasoning — first-time V1→V2 content install. |
| PREPARE | **BLOCK** | Generates new pending-evolution content for an already-migrated account. |
| ACTIVATE | **BLOCK** | Installs previously-prepared content as the new authoritative active program — covers the "PREPARE happened before the incident, ACTIVATE attempted during it" case explicitly. |
| ADAPT | **BLOCK** | Generates a new program from new inputs. |
| RECOVER | ALLOW | Pure reconciliation since Phase 10D — structurally cannot install content the canonical engine didn't already produce and seal in the past. Needed so accounts can still converge to safe state during/after the incident. |
| EARN | ALLOW | Records an already-computed eligibility fact/event ledger entry; does not change what program is active. |
| DEFER | ALLOW | Keeps the account's CURRENT (pre-incident, already-vetted) program active for longer — the safe direction, not the dangerous one. |
| FINISH_EXECUTION | ALLOW | Normal use of the account's current, already-active, pre-incident content. |
| COMPLETE_SCHEDULE | ALLOW | Advances the schedule cursor for the current, already-vetted program — not new content. |
| RESOLVE_MISSED_SESSION | ALLOW | Same reasoning as COMPLETE_SCHEDULE. |

### What happens to users during an incident (derived from the operation matrix above, not speculated)

- **User is already mid-workout:** unaffected. `FINISH_EXECUTION` is allowed; they can finish and get credit normally.
- **User finishes a workout and becomes eligible for an evolution:** `EARN` (recording the eligibility fact) is allowed. `PREPARE` (generating the actual new content) is blocked — the eligibility is durably recorded, but no new program is generated until the circuit closes. This does not need to be redone manually: the same `prepareEvolution` call a client retries later, or the next cold-start reconciliation, will pick it up once the circuit is closed (see "Recovery" below).
- **A pending evolution already exists from before the incident:** `ACTIVATE` is blocked — the user keeps training on their current active program and cannot install the pending content until the circuit closes. Nothing about the pending evolution itself is lost or corrupted; it simply cannot be activated yet.
- **User requests an adaptation (e.g. a new limitation):** `ADAPT` is blocked. They keep their current program until the circuit closes.
- **User's client needs to reconcile/recover state (app relaunch, partial-write cleanup):** `RECOVER` is allowed — this is intentional, so accounts can still converge to a consistent, already-sealed state during the incident.
- **User has not yet migrated to V2:** entirely unaffected by the circuit breaker — governed only by rollout, which is a separate mechanism (see above). If rollout is left on, new users can still migrate to V2 while the circuit is open (their first `INITIALIZE`/`MIGRATE` call, however, will itself be blocked once they reach the backend — so in practice a new user attempting to start V2 during an open circuit gets a blocked INITIALIZE/MIGRATE, same as anyone else attempting those operations).

### Circuit Breaker ≠ rollback

Opening the circuit breaker does **not**: roll back or delete any data, downgrade any account from V2 back to V1, delete or alter any lifecycle/cycle/instance/pending-evolution document, or disable the app. It only causes the backend to reject the five listed operations with a typed error until closed. V2 accounts remain V2 accounts throughout.

### When to open it

Open the circuit for a genuine Workout Lifecycle V2 correctness/integrity incident, for example:

- an abnormal spike in progression/evaluation failures;
- prescriptions being prepared/activated that are wrong, unsafe, or not canonical;
- any suspected canonical-authority or authority-grant bypass;
- lifecycle data inconsistency (duplicate active instances/cycles, corrupted pointers — see "Production invariant diagnostics" below);
- a systemic failure in ACTIVATE;
- a problem discovered in in-flight migrations;
- a serious bug newly discovered in ADAPT.

Do **not** open it for: an isolated visual/UI bug, a cosmetic issue, incorrect copy/translation, or a bug unrelated to the lifecycle authority/progression/prescription path. Opening the circuit does not fix or hide any of those, and unnecessarily blocks PREPARE/ACTIVATE/ADAPT/INITIALIZE/MIGRATE for real users.

### How to open it

There is no dedicated ops npm script for this document yet (unlike rollout). Two real, currently-available procedures — pick whichever matches operator access:

**A. Firebase Console (no local setup required):**
1. Firebase Console → Firestore Database → select the production project.
2. Navigate to (or create, if it doesn't exist yet) the top-level collection `workoutLifecycleCircuitBreaker`, document id `active`.
3. Set fields: `schemaVersion` (number) = `1`, `open` (boolean) = `true`.
4. Save.

**B. One-off Admin SDK command (uses the `firebase-admin` dependency already present at the project root — no new script is added to the repo):**

```bash
node -e "
const { applicationDefault, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ credential: applicationDefault(), projectId: '<project-id>' });
getFirestore().doc('workoutLifecycleCircuitBreaker/active')
  .set({ schemaVersion: 1, open: true })
  .then(() => console.log('circuit breaker OPEN'));
"
```

Requires the same Application Default Credentials access as the rollout script above. Before: document likely absent (or `{schemaVersion: 1, open: false}`). After: `{schemaVersion: 1, open: true}`. There is no `reason`/`operator`/`timestamp` metadata field in the current schema — record who opened it and why in your incident ticket, not in the document itself (the schema is deliberately minimal and validated strictly: `isValidCircuitBreakerConfig` rejects any document with extra keys, so do not add ad hoc fields — an unrecognized shape fails closed to normal operation, i.e. it would silently **not** open the circuit).

### How to confirm it opened

There is no dedicated circuit-breaker telemetry event today — this rejection does not flow through the trusted `workout-lifecycle` structured-telemetry system the rollout section's Logs Explorer example above uses (that system only projects *successful* domain events). Do not assume that dashboard shows circuit-breaker activity. Real, currently-available signals:

1. **Read the document back** (Console, or `--read`-equivalent via the same `node -e` pattern with `.get()` instead of `.set()`) — the fastest, most authoritative confirmation.
2. **Cloud Functions error logs for `authorizeWorkoutLifecycleMutation`:** every blocked call throws `HttpsError('unavailable', 'workout_lifecycle_circuit_breaker_open')`, which Cloud Functions logs as a function execution error. Logs Explorer filter:
   ```text
   resource.type="cloud_function"
   resource.labels.function_name="authorizeWorkoutLifecycleMutation"
   textPayload:"workout_lifecycle_circuit_breaker_open"
   ```
   A rising rate of this specific message across INITIALIZE/MIGRATE/PREPARE/ACTIVATE/ADAPT calls is the real-time confirmation signal. A **complete absence** of this message despite the config being set to `open: true` is itself a signal something is wrong (stale credentials pointed at the wrong project, a typo in the document id, etc.) — verify step 1 first.
3. **User-facing symptom (secondary, slower):** support reports of "can't start a new program" / "can't activate my new plan" / "adaptation isn't going through" for already-V2 users, with no corresponding rollout change, is consistent with the circuit being open.

### How to close it

Set `open: false` (same procedures as opening, with `open: true` → `open: false`), or delete the document (its absence also fails closed to normal operation).

Checklist before closing — do not close on "seems fine now" alone:

```text
[ ] Root cause of the incident identified, or the residual risk is well understood and accepted
[ ] The triggering error/failure rate is no longer increasing
[ ] Any code/config fix has been validated (not just deployed)
[ ] Spot-checked lifecycle state for at least one affected account is internally consistent
    (see "Production invariant diagnostics" below)
[ ] Circuit-breaker rejection rate in Cloud Functions logs (see above) has been reviewed for the
    incident window, not just silenced
[ ] Team is prepared to re-open the circuit immediately if the same symptom recurs
```

### Recovery after closing

Derived from the code, per operation:

- **PREPARE / ADAPT / INITIALIZE / MIGRATE / ACTIVATE (the blocked ones):** these are not automatically retried by the backend — the client must call the operation again. In practice, the app's normal reconciliation-on-launch path (`reconcileWorkoutLifecycle`) and the user's own next relevant action (opening the app, finishing a workout that triggers a fresh eligibility check, tapping "activate") will naturally re-attempt them once the circuit is closed; no server-side backlog or queue exists to drain.
- **An `EARN` fact recorded during the incident is not lost:** it is a durable, already-persisted ledger entry (`workoutLifecycleEvents`). The corresponding `PREPARE` that was blocked simply has to run again after closing — it will find the same eligibility fact and proceed normally.
- **A pending evolution that existed before the incident is not lost or altered by the circuit being open:** `ACTIVATE` was blocked, not the pending-evolution document itself. It remains exactly as it was and can be activated normally once the circuit closes.
- **RECOVER remained available throughout:** any account that needed reconciliation during the incident already had that avenue; no special post-incident RECOVER sweep is required because of the circuit breaker specifically.

### Security

A regular authenticated user — including one who calls the `authorizeWorkoutLifecycleMutation` callable directly, or writes to Firestore directly, rather than through the app UI — **cannot** read or write `workoutLifecycleCircuitBreaker/active` (`firestore.rules`: `allow read, write: if false`). Changing it requires Firebase Console access or Application Default Credentials with the appropriate project role — the same operator trust level already required for the rollout config. No secrets are referenced in this runbook; use your organization's normal credential-access process to obtain Console/ADC access.

### Do NOT, during an incident

Regardless of how urgent it feels, do not use direct Firestore edits to work around a blocked operation instead of using the circuit breaker as designed:

```text
- Do not manually edit workoutLifecycleState/current, programInstances, or trainingCycles documents.
- Do not manually force the active-program pointer (workoutProgramState/active) to a different value.
- Do not fabricate or hand-write a workoutLifecycleAuthorityGrants/current document.
- Do not delete a pendingEvolutions/current document to "clear" a stuck state.
- Do not attempt to downgrade a V2 account back to V1.
- Do not manually edit currentTrainingLevel or any other lifecycle field.
```

None of these are supported operator procedures. Every one of them writes outside the backend-authoritative path this system depends on, and (per the Rules described throughout this doc) most are not even achievable without Admin SDK access — using Admin SDK access to force them anyway defeats the entire canonical-authority design this project's security audits verified. If you believe you need to touch lifecycle documents directly, treat that as its own incident and escalate before acting, not as a routine part of circuit-breaker operation.

### Emergency — 60 seconds

```text
1. Open Firebase Console → Firestore → workoutLifecycleCircuitBreaker → active
   (create the document if it does not exist).
2. Set: schemaVersion = 1, open = true. Save.
3. Confirm: re-read the document — open must show true.
4. Verify: Cloud Logging → resource.labels.function_name="authorizeWorkoutLifecycleMutation"
   → filter textPayload:"workout_lifecycle_circuit_breaker_open" → rejections should appear
   within moments of the next blocked-operation attempt (there is no cache/propagation delay).
5. Investigate the underlying incident using "Production invariant diagnostics" below and the
   existing rollout-section telemetry. Do not attempt manual document edits (see "Do NOT" above).
6. Close only after the checklist under "How to close it" is satisfied.
```

## Production invariant diagnostics

Treat these as integrity incidents:

- lifecycle active cycle or program-instance referent is missing;
- two active cycles or two active program instances exist for one lifecycle;
- an active instance points to a cycle other than the lifecycle active cycle;
- a pending evolution source snapshot differs from the active base;
- a level promotion skips a level or an earned cycle is credited twice;
- a completed cycle becomes active, an event changes after creation, or a
  superseded program becomes active without the atomic pointer transition;
- rollout config was written by a client or contains unknown fields;
- V1 mutation is attempted after V2 exists.

Use aggregate telemetry first. Inspect individual user documents only through
approved least-privilege support procedures; do not add identifiers to the
telemetry contract.

## Reproducible local verification

The root project uses Node 20 from `.nvmrc`; Functions use Node 22; Firebase
CLI is pinned to `15.26.0`; emulator Rules require Java 21 or newer.

```bash
npm ci
npm run ci:audit
npm run quality:static
npm run test
npm run test:integration:preflight
npm run test:rules
npm run test:integration
npm --prefix functions ci
npm --prefix functions run typecheck
npm --prefix functions run test
npm --prefix functions run build
```

The real KMS round-trip suite requires an externally provisioned test KEK and
credentials. It is an environment-owned security validation, not a reason to
weaken or silently skip emulator-critical CI gates.
