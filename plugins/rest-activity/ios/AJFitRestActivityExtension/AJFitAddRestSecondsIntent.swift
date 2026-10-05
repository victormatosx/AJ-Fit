import ActivityKit
import AppIntents
import Foundation
// Same dual-target story as `AJFitFinishRestIntent.swift` — see that file's
// header comment for why this import is both `canImport`-guarded and
// explicitly `internal`.
#if canImport(AJFitRestActivity)
internal import AJFitRestActivity
#endif

/**
 * Backs the Lock Screen "+15s" button. Mirrors the in-app one exactly:
 * `addRestSeconds` (`src/lib/restTimer.ts`) only ever extends `endsAt` by a
 * fixed amount, never touches `startedAt` — same here, so the countdown and
 * the linear progress bar (`endsAt - startedAt` as the denominator) both
 * extend consistently. Runs in-process with the app not launched, so it can
 * only update this Activity's own presentation and leave a one-shot,
 * accumulating marker (`AJFitRestActivityStorage`) for the main app to
 * replay its real `addSeconds(15)` next time it's foregrounded.
 */
@available(iOS 17.0, *)
struct AJFitAddRestSecondsIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "+15s"
  static var isDiscoverable: Bool = false

  private static let secondsPerTap = 15

  @Parameter(title: "Session ID")
  var sessionId: String

  init() {
    sessionId = ""
  }

  init(sessionId: String) {
    self.sessionId = sessionId
  }

  func perform() async throws -> some IntentResult {
    let matchingActivities = Activity<AJFitRestActivityAttributes>.activities.filter { activity in
      activity.attributes.sessionId == sessionId && activity.content.state.phase == .resting
    }
    for activity in matchingActivities {
      var state = activity.content.state
      guard let endsAt = state.endsAt else { continue }
      let extendedEndsAt = endsAt.addingTimeInterval(TimeInterval(Self.secondsPerTap))
      state.endsAt = extendedEndsAt
      await activity.update(ActivityContent(state: state, staleDate: extendedEndsAt, relevanceScore: 100))
    }
    if !matchingActivities.isEmpty {
      AJFitRestActivityStorage.markPendingAddSeconds(sessionId: sessionId, seconds: Self.secondsPerTap)
    }
    return .result()
  }
}
