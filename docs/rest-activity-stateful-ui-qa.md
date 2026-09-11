# Stateful Rest Activity — architecture and QA

## Contract and ownership

The Workout Engine remains the only owner of exercise order and workout
progress. `WorkoutScreen` projects the already-materialized workout session to
one of two next actions before starting a rest:

- `next_set`, with the one-based `nextSetIndex`;
- `next_exercise`, with the localized name resolved from the real next exercise
  in the current execution order.

`RestSessionContext` owns the absolute rest deadline and publishes the
presentation snapshot. Native code validates and renders that snapshot; it does
not inspect templates, catalogs, plans, or progression rules.

`setIndex` is one-based at the native boundary and identifies the set just
completed when rest begins. `totalSets` is the real number of sets for the
current materialized exercise. `nextSetIndex` is separately materialized, which
avoids an off-by-one decision in Swift/Kotlin.

No `workout_completed` presentation phase was added. The current architecture
already ends the activity when the workout session ends, which is safer than
leaving a terminal activity orphaned.

## Presentation matrix

| Phase | Compact leading | Compact trailing | Minimal | Expanded / Lock Screen |
| --- | --- | --- | --- | --- |
| `resting` | remaining time | stopwatch + segmented set ring | remaining time | countdown, current exercise, completed/current set context, ring |
| `next_set` | short localized next-set label | real next set / total | short next-set indicator | next set, real set number, current exercise, tap hint, ring on the upcoming set |
| `next_exercise` | short localized next-exercise label | transition arrow | short transition indicator | real next exercise and tap hint; old set progress is omitted |

The Lock Screen and every Dynamic Island family use the same resolved
presentation phase. The URL remains `ajfit://workout/active`.

The compact layout deliberately has no expanding `Spacer`, `GeometryReader`,
infinite width, horizontal padding, or width-increasing background. Only the
trailing progress control has a local 22-point frame.

## Deadline behavior

The countdown is rendered by the system from the absolute `endsAt`; there is no
native per-second timer, polling loop, or JS keepalive.

- Foreground: the deadline reconciler calls the existing idempotent
  `consumeExpiration`, the Workout Engine performs `advanceAfterRest`, and only
  then is the materialized next action published.
- Background while executable: the same sequence can run. A natural on-time
  transition asks ActivityKit for visual emphasis with `AlertConfiguration`.
  ActivityKit requires an `AlertSound`, so this uses the system default only;
  no custom/aggressive sound or separate haptic was added. iOS decides whether
  it presents an expanded island, banner, or no extra treatment.
- Fully suspended: `staleDate == endsAt` gives the system the semantic deadline.
  Once WidgetKit reports `context.isStale`, both surfaces present the already-
  materialized next action. This does not guarantee a re-render at the exact
  wall-clock instant, mutate `ContentState`, advance the Workout Engine, or emit
  an alert. An explicit state update and alert can happen only after the app is
  executable again (or with a future ActivityKit push-update architecture,
  which this project does not currently have).
- Cold start without a restorable workout execution: existing safe cleanup is
  preserved. No workout/session is fabricated for the activity.

`Skip` claims the existing rest transition, advances the Workout Engine, and
then publishes the same pre-materialized next action without an alert. `+15`
keeps the same session/activity and `resting` phase, changes only `endsAt`, and
never alerts. Natural expiration continues to use the existing exactly-once
claim, so the presentation update cannot duplicate workout advancement.

On Android, the same semantic phases update the same ongoing notification ID.
API 24–35 keeps the ordinary ongoing-notification fallback; API 36+ keeps the
promoted Live Update/progress style. Chronometer, `setWhen`, and countdown are
used only for `resting`. The existing silent channel, deep link,
`POST_NOTIFICATIONS`, promotion capability, and fallback remain intact. If the
Android app is fully suspended, there is no new alarm or service: the system
countdown expires and the current timeout removes the resting notification; a
semantic next-action update requires app execution.

## Multiple activities / Now Playing

Apple uses the minimal Dynamic Island presentation when another activity owns
the competing region. AJ Fit's minimal resting presentation is now the remaining
time rather than the progress/stopwatch glyph. This ensures useful information
whenever iOS elects to show AJ Fit in minimal form. Public APIs do not let AJ Fit
force expansion, displace Now Playing, or guarantee that its activity is the one
currently visible.

## Manual device QA still required

These checks require an iPhone with Dynamic Island (or an appropriate simulator
runtime) and cannot be proven by source/build tests:

- [ ] Resting compact: countdown left, 22-point progress/stopwatch right, normal
  status bar, no enlarged capsule.
- [ ] Start Now Playing during rest and capture Home and Lock Screen screenshots;
  confirm AJ Fit's minimal form shows remaining time whenever iOS presents it.
- [ ] Let set 2/4 expire: verify next set is 3/4 in compact, expanded, Lock Screen,
  segmented progress, and deep link.
- [ ] Let the final set expire: verify the real next exercise in expanded and Lock
  Screen, with no old 4/4 progress presented as an upcoming set.
- [ ] Tap `+15` three times: same activity/session, correct deadline, no alert.
- [ ] Skip to another set and to another exercise: verify the semantic transition
  and exactly one Workout Engine advance.
- [ ] Repeat natural expiration in foreground, background-executable, and fully
  suspended states; record when the explicit `ContentState` update arrives.
- [ ] Verify pt-BR, English, and Spanish on compact, expanded, and Lock Screen.

ActivityKit behavior referenced here follows Apple's public documentation for
[displaying live data](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities),
[updating Live Activities with ActivityKit push notifications](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications),
and [`Activity.update(_:alertConfiguration:)`](https://developer.apple.com/documentation/activitykit/activity/update(_:alertconfiguration:)).
