# Workout Lifecycle V2 — Production Rollout Runbook

**Status:** OPERATIONAL — Phase 8C. This is the single rollout and rollback runbook.

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
