import ActivityKit
import Foundation

public enum RestActivityPhase: String, Codable, Hashable, Sendable {
  case resting
  case nextSet = "next_set"
  case nextExercise = "next_exercise"
}

public enum RestActivityNextAction: String, Codable, Hashable, Sendable {
  case nextSet = "next_set"
  case nextExercise = "next_exercise"

  public var phase: RestActivityPhase {
    switch self {
    case .nextSet: return .nextSet
    case .nextExercise: return .nextExercise
    }
  }
}

public struct AJFitRestActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable, Sendable {
    public var startedAt: Date
    public var endsAt: Date
    public var exerciseName: String
    public var setIndex: Int
    public var totalSets: Int
    public var phase: RestActivityPhase
    public var nextAction: RestActivityNextAction
    public var nextSetIndex: Int?
    public var nextExerciseName: String?

    public init(
      startedAt: Date,
      endsAt: Date,
      exerciseName: String,
      setIndex: Int,
      totalSets: Int,
      phase: RestActivityPhase,
      nextAction: RestActivityNextAction,
      nextSetIndex: Int? = nil,
      nextExerciseName: String? = nil
    ) {
      self.startedAt = startedAt
      self.endsAt = endsAt
      self.exerciseName = exerciseName
      self.setIndex = setIndex
      self.totalSets = totalSets
      self.phase = phase
      self.nextAction = nextAction
      self.nextSetIndex = nextSetIndex
      self.nextExerciseName = nextExerciseName
    }

    /**
     * `staleDate` may advance presentation while the app is suspended. The
     * destination is already materialized by the workout session; this method
     * never derives an action from set counts.
     */
    public func presentationPhase(isStale: Bool) -> RestActivityPhase {
      if phase == .resting && isStale {
        return nextAction.phase
      }
      return phase
    }
  }

  public let sessionId: String

  public init(sessionId: String) {
    self.sessionId = sessionId
  }
}
