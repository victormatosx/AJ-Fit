# Push Notifications — Phase 4 progression and weekly audit

## Outcome

`EVOLUTION_APPROACHING` is implementable from current authoritative facts and is connected to the existing hourly daily engine. `WEEK_COMPLETED` and `WEEK_STREAK` are deliberately not registered or dispatched: the current domain cannot establish their required facts across schedule changes without inventing product semantics.

No cloud resource is changed by this phase.

## EVOLUTION_APPROACHING source of truth

The observer uses the same pure Progression V2 modules as the app and the lifecycle authority backend:

- `computeActiveTimeTrace` for active calendar time and inactivity pause/resume;
- `buildPrescribedOpportunities` for prescribed opportunities inside that active window;
- `countFulfilledPrescribedOpportunities` for execution plus immutable schedule-ledger qualification;
- `computeAdherence` for the real 70% threshold;
- `evaluateProgressionV2` for the final decision.

Those modules are copied by the existing generated-engine synchronization step. There is no notification-owned progress counter.

The observer reads the current lifecycle pointer, active training cycle, active Program Instance, active program, the Program Instance's immutable prescription input snapshot, bounded executions and bounded schedule events. It suppresses invalid/missing histories rather than falling back to an estimate. Accelerated/forced lifecycle QA modes cannot create a product candidate.

## Formal approaching rule

A cycle is approaching only when all of the following hold:

1. the normal Progression V2 decision is `PROGRESS_CONTINUES`;
2. active time is not paused;
3. adherence is at least the existing earned threshold (70%);
4. the progression window is between one and three **active days** before its real minimum (28 for Beginner, 85 for Intermediate/Advanced);
5. no pending evolution exists;
6. the cycle has no earned/offered/activated/promotion lifecycle fact;
7. the current local time is within the existing 08:00–10:00 daily window;
8. the account and active program references are valid.

The copy intentionally gives no exact day/session promise. Low-adherence motivational renewal is treated separately and never mapped to approaching because the domain has no pre-offer motivational-renewal fact.

## Idempotency, concurrency and retention

The semantic dispatch identity is:

`uid + EVOLUTION_APPROACHING + sha256(activeProgramInstanceId)`

The active Program Instance is the real Progression V2 window: adaptation and motivational renewal may restart active time without creating a new career cycle. Its raw ID is not placed in the payload. Central dispatch idempotency remains unchanged and its dispatch records retain the existing 90-day TTL.

A backend-only `notificationAchievementMilestones/{hash}` projection provides the longer-lived one-per-progression-window invariant. It contains the UID, category, type, hashed source identity, fenced claim state and timestamps—no copy, token, workout detail or PII. Claims expire after 15 minutes and stale workers cannot complete a newer claim. Completed milestones remain until account deletion, because deleting them on a time TTL could reopen a progression window after a long inactivity pause.

Immediately after the central dispatch claim and before device selection/Expo, a preflight re-reads the active Program Instance and lifecycle facts. A pending evolution or an earned/offered event belonging to that same progression window produces terminal `SUPPRESSED_BY_POLICY` with `EVOLUTION_UNLOCKED_PRIORITY`. A replaced window produces `PROGRESSION_WINDOW_CHANGED`. Activation/promotion events that opened the current window are not misclassified as a new earned fact. Retries execute the same preflight. This is the final backend boundary before the external provider request; a lifecycle fact committed after that boundary cannot recall an already-issued provider request.

## Scheduler and scale

The existing `evaluateDailyWorkoutNotifications` hourly scheduler and `notificationDailyUsers` projection are reused. One claimed user evaluation runs the workout-day observer and the approaching observer independently. Any failure schedules the existing bounded 45-minute evaluation retry; successful/suppressed evaluation advances to the next local 08:00 window.

No user fanout or second cron was added. Existing limits remain 100 registrations per page, concurrency 10, and 2,000 users per run. Approaching history reads are capped at 512 executions and 512 schedule events; current-cycle lifecycle events are capped at 128. Overflow suppresses with `HISTORY_LIMIT`.

The new milestone is addressed directly for dispatch claims. Account deletion uses the same paginated owner query pattern as other private notification projections. No composite index or TTL field override is required.

## Preference, localization and payload

Category: `EVOLUTION_AND_ACHIEVEMENTS`, controlled by the existing `evolutionAndAchievements` preference. The central policy layer persists preference suppression; the observer does not bypass it.

Copies are fixed allowlisted PT-BR, EN and ES strings. PT-BR remains the locale fallback.

Provider data is exactly:

```text
type: EVOLUTION_APPROACHING
notificationId: EVOLUTION_APPROACHING:<sha256-cycle-id>
```

The type builder contributes an empty `data` object. No UID, program/cycle ID, workout detail or free client text is sent. No product deep link is added because the current push tap parser has no stable domain intent for this destination.

## Product rate limiting and collisions

No broad `EVOLUTION_AND_ACHIEVEMENTS` daily rate limit is added. The one-per-window milestone is sufficient for approaching, while a broad category window could incorrectly suppress the stronger event-driven `EVOLUTION_UNLOCKED`. Operational billing notifications remain entirely independent.

- approaching × unlocked: unlocked wins through context checks and dispatch preflight;
- week completed × streak: not implemented because both facts are blocked;
- weekly × evolution: no policy is invented while weekly facts are absent.

## Why WEEK_COMPLETED is blocked

The domain has current `scheduleConfig`, immutable activation-time prescription inputs, rotation state/events and workout executions, but no immutable effective-dated ledger of every schedule change. The current mutable schedule cannot answer which sessions were required earlier in a calendar week after a mid-week schedule change or program adaptation. Therefore “all required sessions” cannot be proven for the historical week without either requiring removed sessions or retroactively requiring newly added sessions.

The product also has no canonical week identity/start rule tied to user timezone and program lifecycle. Existing UI comments explicitly avoid fabricating a weekly completion count.

Required domain decision before implementation:

- canonical week boundary;
- effective-dated schedule history;
- treatment of partial completion;
- treatment of mid-week program starts/adaptations;
- authoritative event or aggregate declaring a week complete.

## Why WEEK_STREAK is blocked

There is no weekly completion fact, completed-week aggregate, achievement/streak state or product milestone policy. Existing UI removed hardcoded streak data specifically because no tracking infrastructure exists. A streak cannot be derived safely until `WEEK_COMPLETED` is authoritative.

Required product/domain decisions include:

- milestone sequence (for example 2/4/8/12) versus every completed week;
- incomplete-week break rule;
- zero-prescribed-session and legitimate pause behavior;
- continuity across Program Instances and new programs;
- retention/rebuild contract for the weekly aggregate.

Only after those decisions should a bounded incremental weekly projection be designed. No placeholder types, copies, projection, rule or index are added in this phase.

## Production requirements

To activate only the implemented Phase 4 work later:

- redeploy the modified `evaluateDailyWorkoutNotifications` Function (it retains the existing schedule and region configuration);
- no new Scheduler job;
- no Firestore Rules change (the existing default-deny rule protects the new backend-only collection; the Rules suite explicitly verifies denial);
- no composite index;
- no TTL configuration.

The account-deletion Function must be redeployed together with the code version that owns cleanup before Phase 4 is considered production-ready, so `notificationAchievementMilestones` cannot outlive account deletion.
