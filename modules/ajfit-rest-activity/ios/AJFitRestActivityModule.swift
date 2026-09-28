import ActivityKit
import ExpoModulesCore
import Foundation
import OSLog

private let restLiveLogger = Logger(
  subsystem: Bundle.main.bundleIdentifier ?? "com.ajfit.app",
  category: "AJFitRestActivity"
)

private struct RestActivityStateRecord: Record {
  @Field var sessionId: String = ""
  @Field var startedAt: Int64 = 0
  @Field var endsAt: Int64?
  @Field var exerciseName: String = ""
  @Field var setIndex: Int = 0
  @Field var totalSets: Int = 0
  @Field var phase: String = ""
  @Field var nextAction: String = ""
  @Field var nextSetIndex: Int?
  @Field var nextExerciseName: String?

  func materializedState() -> MaterializedRestActivityState? {
    guard
      let materializedPhase = RestActivityPhase(rawValue: phase),
      let materializedNextAction = RestActivityNextAction(rawValue: nextAction)
    else {
      return nil
    }
    let trimmedNextExerciseName = nextExerciseName?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let hasValidNextAction = switch materializedNextAction {
    case .nextSet:
      nextSetIndex != nil &&
        nextSetIndex! == setIndex + 1 &&
        nextSetIndex! <= totalSets &&
        trimmedNextExerciseName == nil
    case .nextExercise:
      nextSetIndex == nil &&
        setIndex == totalSets &&
        !(trimmedNextExerciseName ?? "").isEmpty
    case .finishWorkout:
      nextSetIndex == nil &&
        trimmedNextExerciseName == nil &&
        [.cardioRunning, .cardioPaused, .cardioCompleted].contains(materializedPhase)
    }
    let hasValidTiming = materializedPhase == .workoutActive
      ? endsAt == nil
      : endsAt != nil && endsAt! > startedAt
    let hasValidSetProgress = materializedPhase == .workoutActive
      ? setIndex >= 0 && setIndex < totalSets
      : setIndex >= 1 && totalSets >= setIndex
    guard
      !sessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      startedAt >= 0,
      !exerciseName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      totalSets >= 1,
      hasValidTiming,
      hasValidSetProgress,
      materializedPhase == .workoutActive ||
        materializedPhase == .resting ||
        materializedPhase == materializedNextAction.phase ||
        (materializedNextAction == .finishWorkout && materializedPhase == .cardioRunning) ||
        (materializedNextAction == .finishWorkout && materializedPhase == .cardioPaused),
      hasValidNextAction
    else {
      return nil
    }

    return MaterializedRestActivityState(
      sessionId: sessionId,
      startedAt: Date(timeIntervalSince1970: Double(startedAt) / 1_000),
      endsAt: endsAt.map { Date(timeIntervalSince1970: Double($0) / 1_000) },
      exerciseName: exerciseName,
      setIndex: setIndex,
      totalSets: totalSets,
      phase: materializedPhase,
      nextAction: materializedNextAction,
      nextSetIndex: nextSetIndex,
      nextExerciseName: trimmedNextExerciseName
    )
  }
}

private struct MaterializedRestActivityState: Sendable {
  let sessionId: String
  let startedAt: Date
  let endsAt: Date?
  let exerciseName: String
  let setIndex: Int
  let totalSets: Int
  let phase: RestActivityPhase
  let nextAction: RestActivityNextAction
  let nextSetIndex: Int?
  let nextExerciseName: String?

  var contentState: AJFitRestActivityAttributes.ContentState {
    AJFitRestActivityAttributes.ContentState(
      startedAt: startedAt,
      endsAt: endsAt,
      exerciseName: exerciseName,
      setIndex: setIndex,
      totalSets: totalSets,
      phase: phase,
      nextAction: nextAction,
      nextSetIndex: nextSetIndex,
      nextExerciseName: nextExerciseName
    )
  }
}

private actor RestLiveActivityController {
  static let shared = RestLiveActivityController()

  typealias RestActivity = Activity<AJFitRestActivityAttributes>

  func start(_ state: MaterializedRestActivityState) async {
    await upsert(state, operation: "start", shouldAlert: false)
  }

  func update(_ state: MaterializedRestActivityState, shouldAlert: Bool) async {
    await upsert(state, operation: "update", shouldAlert: shouldAlert)
  }

  func end(sessionId: String, reason: String) async {
    guard ["completed", "cancelled", "workout_ended"].contains(reason) else {
      restLiveLogger.error("[rest-live:ios] native_error operation=end reason=invalid_reason")
      return
    }

    guard let activity = activity(for: sessionId) else { return }

    if reason == "workout_ended" {
      let finalContent = dormantContent(for: activity, reason: reason)
      await activity.end(finalContent, dismissalPolicy: .immediate)
      restLiveLogger.info("[rest-live:ios] ended reason=workout_ended")
      return
    }

    // ActivityKit cannot reactivate an Activity after end(). Keeping it alive
    // in a dormant presentation lets the next rest in the same workout update
    // the same logical/system Activity instead of causing per-set flicker.
    await activity.update(dormantContent(for: activity, reason: reason))
    restLiveLogger.info("[rest-live:ios] ended reason=\(reason, privacy: .public)")
  }

  func cleanup() async {
    let activities = RestActivity.activities
    for activity in activities {
      let finalContent = dormantContent(for: activity, reason: "cleanup")
      await activity.end(finalContent, dismissalPolicy: .immediate)
    }
    if !activities.isEmpty {
      restLiveLogger.info("[rest-live:ios] ended reason=cleanup count=\(activities.count, privacy: .public)")
    }
  }

  private func upsert(
    _ state: MaterializedRestActivityState,
    operation: String,
    shouldAlert: Bool
  ) async {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      restLiveLogger.info("[rest-live:ios] unsupported reason=activities_disabled operation=\(operation, privacy: .public)")
      return
    }

    let content = activeContent(for: state)
    if let existingActivity = activity(for: state.sessionId) {
      let isRelevantTransition =
        existingActivity.content.state.phase == .resting &&
        state.phase == state.nextAction.phase
      let alert = shouldAlert && isRelevantTransition
        ? alertConfiguration(for: state)
        : nil
      await existingActivity.update(content, alertConfiguration: alert)
      let event = operation == "start" ? "started" : "updated"
      restLiveLogger.info("[rest-live:ios] \(event, privacy: .public) reused=true")
      return
    }

    // A new workout supersedes presentation state left by an older session.
    // This is visual cleanup only; it never mutates workout state.
    for staleActivity in RestActivity.activities {
      let finalContent = dormantContent(for: staleActivity, reason: "workout_ended")
      await staleActivity.end(finalContent, dismissalPolicy: .immediate)
    }

    do {
      _ = try RestActivity.request(
        attributes: AJFitRestActivityAttributes(sessionId: state.sessionId),
        content: content,
        pushType: nil
      )
      restLiveLogger.info("[rest-live:ios] started reused=false")
    } catch {
      restLiveLogger.error("[rest-live:ios] native_error operation=\(operation, privacy: .public)")
    }
  }

  private func activity(for sessionId: String) -> RestActivity? {
    RestActivity.activities.first { activity in
      activity.attributes.sessionId == sessionId
    }
  }

  private func activeContent(
    for state: MaterializedRestActivityState
  ) -> ActivityContent<AJFitRestActivityAttributes.ContentState> {
    ActivityContent(
      state: state.contentState,
      staleDate: state.phase == .resting || state.phase == .cardioRunning
        ? state.endsAt
        : nil,
      relevanceScore: 100
    )
  }

  private func dormantContent(
    for activity: RestActivity,
    reason: String
  ) -> ActivityContent<AJFitRestActivityAttributes.ContentState> {
    let now = Date()
    var state = activity.content.state
    state.startedAt = now
    state.endsAt = now
    state.phase = state.nextAction.phase
    return ActivityContent(state: state, staleDate: now, relevanceScore: 10)
  }

  private func alertConfiguration(
    for state: MaterializedRestActivityState
  ) -> AlertConfiguration {
    let body = state.nextAction == .nextExercise
      ? state.nextExerciseName ?? state.exerciseName
      : state.exerciseName
    return AlertConfiguration(
      title: "AJ Fit",
      body: LocalizedStringResource(stringLiteral: body),
      // ActivityKit requires an AlertSound when emphasis is requested. Use
      // only the system default; no custom/aggressive sound is introduced.
      sound: .default
    )
  }
}

public final class AJFitRestActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AJFitRestActivity")

    Function("getCapabilities") {
      let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
      if !enabled {
        restLiveLogger.info("[rest-live:ios] unsupported reason=activities_disabled")
      }
      return [
        "available": enabled,
        "surface": enabled ? "ios-live-activity" : "none",
      ] as [String: Any]
    }

    AsyncFunction("start") { (record: RestActivityStateRecord) async -> Void in
      guard let state = record.materializedState() else {
        restLiveLogger.error("[rest-live:ios] native_error operation=start reason=invalid_payload")
        return
      }
      await RestLiveActivityController.shared.start(state)
    }

    AsyncFunction("update") {
      (record: RestActivityStateRecord, shouldAlert: Bool) async -> Void in
      guard let state = record.materializedState() else {
        restLiveLogger.error("[rest-live:ios] native_error operation=update reason=invalid_payload")
        return
      }
      await RestLiveActivityController.shared.update(state, shouldAlert: shouldAlert)
    }

    AsyncFunction("end") { (sessionId: String, reason: String) async -> Void in
      guard !sessionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        restLiveLogger.error("[rest-live:ios] native_error operation=end reason=invalid_session")
        return
      }
      await RestLiveActivityController.shared.end(sessionId: sessionId, reason: reason)
    }

    AsyncFunction("cleanup") { () async -> Void in
      await RestLiveActivityController.shared.cleanup()
    }
  }
}
