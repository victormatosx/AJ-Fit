import ActivityKit
import AppIntents
import Foundation
// This same file is compiled into two targets (see `plugins/rest-activity/
// index.js`): the widget extension, where `AJFitRestActivityAttributes`/
// `AJFitRestActivityStorage` are loose sibling source files (no import
// needed), and the main `AJFit` app target — the one `LiveActivityIntent.
// perform()` actually runs in — where those same types only exist behind
// the `AJFitRestActivity` CocoaPod. `canImport` picks the right form per
// target instead of forking the source.
// Explicit `internal` (SE-0409 access-level-on-import) because
// `ExpoModulesProvider.swift` (Expo autolinking codegen, same app target)
// already imports this same pod module as `internal` — a plain `import`
// here is ambiguous against that, not a conflict with it.
#if canImport(AJFitRestActivity)
internal import AJFitRestActivity
#endif

/**
 * Backs the Lock Screen "Finalizar descanso" button. Runs in-process
 * (ActivityKit's interactive-widget contract) with the device still locked
 * and the app not launched — so it can only do two deliberately small things:
 * flip THIS Activity's own presentation to the same "resting ended" look the
 * app already produces when a rest completes naturally (`dormantContent` in
 * `AJFitRestActivityModule.swift`), and leave a one-shot marker
 * (`AJFitRestActivityStorage`) for the main app to replay its real
 * `skipRest()` next time it's foregrounded. It never touches the workout
 * engine, any backend, or any auth — that stays exclusively in JS.
 */
@available(iOS 17.0, *)
struct AJFitFinishRestIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Finalizar descanso"
  static var isDiscoverable: Bool = false

  @Parameter(title: "Session ID")
  var sessionId: String

  init() {
    sessionId = ""
  }

  init(sessionId: String) {
    self.sessionId = sessionId
  }

  func perform() async throws -> some IntentResult {
    let now = Date()
    let matchingActivities = Activity<AJFitRestActivityAttributes>.activities.filter { activity in
      activity.attributes.sessionId == sessionId && activity.content.state.phase == .resting
    }
    for activity in matchingActivities {
      var state = activity.content.state
      state.startedAt = now
      state.endsAt = now
      state.phase = state.nextAction.phase
      await activity.update(ActivityContent(state: state, staleDate: now, relevanceScore: 100))
    }
    if !matchingActivities.isEmpty {
      AJFitRestActivityStorage.markPendingFinish(sessionId: sessionId)
    }
    return .result()
  }
}
