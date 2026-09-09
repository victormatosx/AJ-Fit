# Phase 5 — workout re-engagement notifications

## Product definition

Re-engagement is based on consecutive **prescribed training opportunities
missed**, not app opens or elapsed calendar days. A prescribed opportunity is
a `TRAINING` local date in the active Workout Program's canonical weekly
schedule. `REST`, `ACTIVE_RECOVERY` and the current local date never count as
missed.

The evaluator reads the same canonical model as the daily workout observer:

- `workoutLifecycleState/current` for the active content and Program Instance;
- the non-superseded active `programInstances/{id}`;
- the active `workoutPrograms/{id}.weeklySchedule`, with the same legacy
  `scheduleConfig.trainingDays` compatibility path;
- `workoutPrograms/{id}/scheduleState/{programInstanceId}.lastCompletedAt`;
- `workoutProgramState/scheduleConfig.timezone`, accepted only when it is a
  canonical IANA timezone.

`lastCompletedAt` is the stable completion cursor. It can advance only through
the protected schedule-completion path after a matching prescribed execution
has reached `COMPLETED` or `PARTIALLY_COMPLETED`. This makes a valid return to
training end the current absence episode without adding mutable
re-engagement state.

The Progression V2 active-time trace, prescribed-opportunity ledger and
adherence computation were audited. They remain the authority for progression
eligibility, but are not used as an alternate calendar here: active time
intentionally pauses after the third consecutive miss and therefore cannot
distinguish a later sixth miss. The re-engagement evaluator instead uses the
shared schedule calendar primitive `trainingDayOccurrences` over the same
active program and completion cursor.

## Thresholds and episode identity

- `RE_ENGAGEMENT_EARLY`: 3 missed prescribed opportunities. This is imported
  directly from Progression V2's existing
  `inactivityMissedOpportunityThreshold`, the point where the domain already
  considers continuous training time paused.
- `RE_ENGAGEMENT_LATE`: 6 missed prescribed opportunities, one additional
  complete inactivity block beyond EARLY.

These are opportunity thresholds. At two sessions per week EARLY takes longer
in calendar time than at six sessions per week; a normal weekend or prescribed
rest interval never accelerates either stage.

An episode is identified by:

`active Program Instance ID + first prescribed opportunity missed after the last valid completion`

The scheduler time is not part of identity. EARLY and LATE are separate
one-shot milestones under that episode. If the first evaluation occurs only
after six misses, LATE is sent directly; sending a stale EARLY first would not
match the user's current state. A subsequent valid completion changes the
cursor and closes the episode. A later absence has a new first-missed date and
can emit both stages again. Replacing/adapting the Program Instance also
changes identity.

## Scheduling, preference and collision policy

The existing `evaluateDailyWorkoutNotifications` scheduled Function remains
the only scheduler. Evaluation is confined to `08:00 <= local time < 10:00`
in `scheduleConfig.timezone`; no UTC fallback is used for product semantics.
A retry of an already-created dispatch revalidates mutable episode facts but
does not fail merely because it runs after 10:00.

Both types use `WORKOUTS_AND_REMINDERS` and therefore respect
`preferences.notificationPreferences.workoutsAndReminders`. The daily suite
applies this order:

1. current LATE or EARLY re-engagement stage;
2. `MISSED_WORKOUT`;
3. `WORKOUT_DAY` / `RECOVERY_DAY` and `EVOLUTION_APPROACHING`.

At six misses the context exposes only LATE, so LATE naturally supersedes
EARLY. While an inactive episode is current, a completed stage continues to
block lower daily reminders rather than allowing contradictory messages every
following day. `EVOLUTION_UNLOCKED` and `PROGRAM_UPDATED` are event-driven
facts: a completion or Program Instance replacement is rechecked immediately
before provider I/O and suppresses a stale re-engagement dispatch. Billing
notifications remain independent `OPERATIONAL` messages; their priority and
policy are unchanged.

## One-shot, rate limit and concurrency

No new collection was introduced. Each stage claims the existing backend-only
`notificationAchievementMilestones` projection with the episode-derived
source identity. Its transaction, claim token and claim version fence
concurrent scheduler runs. The central dispatch has its own semantic
idempotency and retry fencing.

The existing daily `notificationProductWindows` record is also claimed, so at
most one `WORKOUTS_AND_REMINDERS` product candidate owns a user's local day.
If another candidate already owns that day, the temporary stage claim is
released, preserving the one-shot for a later daily window. Once a central
dispatch exists—including a preference suppression or provider retry—the
stage and product window are completed and are not recreated.

Milestones intentionally have no TTL: deleting a completed marker could reopen
an old, long-running absence. Existing account deletion already removes all
`notificationAchievementMilestones` documents by UID. Product-window and
dispatch cleanup behavior is unchanged.

## Content, payload and QA

Canonical builders provide PT-BR, EN and ES copies with PT-BR fallback. They
emit no health data, identifiers or new intent/deep link. The Expo data payload
is the existing structured `{ type, notificationId }` contract.

The payload audit found that the native notification handler parser still
allowlisted only the Phase 1 `QA_TEST` type. Consequently both product sends
and product-type QA previews were delivered remotely, but appeared locally as
`payloadType = undefined` and `structuredPayload = false`. The parser now uses
an explicit allowlist of all currently implemented types. Unsupported future
types and malformed payloads still fail closed, and no navigation behavior was
added.

The development QA panel includes both stages. QA preview calls the exact same
builders, stays self-targeted and uses the central dispatcher in `QA_PREVIEW`
mode. It does not read or write real episode milestones, product windows,
schedule, lifecycle, Progression V2 or workout execution facts.

## Deployment scope

No native package, Expo config, Firestore Rules, index, TTL policy or new
scheduler is required. Publish only the Functions whose bundles own the new
scheduled evaluation, QA builder allowlist and retry-time schema/content:

```sh
firebase deploy --only functions:evaluateDailyWorkoutNotifications,functions:dispatchTestNotification,functions:retryNotificationDispatches --project ajfit-2f321
```

The client change is JavaScript/TypeScript only. An existing development build
with the validated `expo-notifications` module needs a normal JS update/Fast
Refresh, not a native rebuild.
