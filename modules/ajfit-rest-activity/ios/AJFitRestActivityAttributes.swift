import ActivityKit
import Foundation

public enum RestActivityPhase: String, Codable, Hashable, Sendable {
  case workoutActive = "workout_active"
  case resting
  case nextSet = "next_set"
  case nextExercise = "next_exercise"
  case cardioRunning = "cardio_running"
  case cardioPaused = "cardio_paused"
  case cardioCompleted = "cardio_completed"

  /// `set_ready` per `WorkoutExecutionProgression`. Only the completion CTA
  /// renders in this phase; reps/load belong exclusively to `.resting`.
  public var isSetReady: Bool {
    self == .workoutActive || self == .nextSet || self == .nextExercise
  }
}

public enum RestActivityNextAction: String, Codable, Hashable, Sendable {
  case nextSet = "next_set"
  case nextExercise = "next_exercise"
  case finishWorkout = "finish_workout"

  public var phase: RestActivityPhase {
    switch self {
    case .nextSet: return .nextSet
    case .nextExercise: return .nextExercise
    case .finishWorkout: return .cardioCompleted
    }
  }
}

public struct AJFitRestActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable, Sendable {
    public var startedAt: Date
    public var endsAt: Date?
    public var exerciseName: String
    /// One-based series number for presentation. Persisted set identities use
    /// the dedicated zero-based action fields instead.
    public var setIndex: Int
    public var totalSets: Int
    public var phase: RestActivityPhase
    public var nextAction: RestActivityNextAction
    public var nextSetIndex: Int?
    public var nextExerciseName: String?

    // External Set Completion (Live Activity): identifies the exact set a
    // `CompleteSetIntent`/`AdjustStepperIntent` acts on — the same
    // `(exerciseIndex, setIndex)` identity `completeWorkoutSet`
    // (`functions/src/workoutLifecycle/completeWorkoutSet.ts`) requires.
    // `nil` on a cardio-phase state, where there is no set to complete.
    public var exerciseIndex: Int?
    /// `adjustWorkoutLoadKg`'s step for the user's unit (`workoutLoadStep`, `src/units/workoutLoadConversions.ts`) — mirrored so the stepper never invents its own increment.
    public var weightStepKg: Double?
    /// Display unit only — the value sent to `completeWorkoutSet` is always kg.
    public var weightUnit: String?
    public var repsStep: Int?
    /// Last logged weight/reps for this exercise this session — prefill only, never a prescription, never auto-submitted.
    public var prefillWeightKg: Double?
    public var prefillReps: Int?
    /// Values currently shown by the rest-only steppers. Each change is
    /// persisted through the capability-gated authoritative endpoint.
    public var pendingWeightKg: Double?
    public var pendingReps: Int?
    public var prescribedReps: String?
    /// Exact completed-set identity used by rest-only edit controls. Kept
    /// separate from `exerciseIndex`, which points at the next actionable set.
    public var completedExerciseIndex: Int?
    public var completedSetIndex: Int?
    public var followingExerciseName: String?
    public var followingExercisePrescribedReps: String?
    public var followingExerciseTotalSets: Int?

    public init(
      startedAt: Date,
      endsAt: Date?,
      exerciseName: String,
      setIndex: Int,
      totalSets: Int,
      phase: RestActivityPhase,
      nextAction: RestActivityNextAction,
      nextSetIndex: Int? = nil,
      nextExerciseName: String? = nil,
      exerciseIndex: Int? = nil,
      weightStepKg: Double? = nil,
      weightUnit: String? = nil,
      repsStep: Int? = nil,
      prefillWeightKg: Double? = nil,
      prefillReps: Int? = nil,
      pendingWeightKg: Double? = nil,
      pendingReps: Int? = nil,
      prescribedReps: String? = nil,
      completedExerciseIndex: Int? = nil,
      completedSetIndex: Int? = nil,
      followingExerciseName: String? = nil,
      followingExercisePrescribedReps: String? = nil,
      followingExerciseTotalSets: Int? = nil
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
      self.exerciseIndex = exerciseIndex
      self.weightStepKg = weightStepKg
      self.weightUnit = weightUnit
      self.repsStep = repsStep
      self.prefillWeightKg = prefillWeightKg
      self.prefillReps = prefillReps
      self.pendingWeightKg = pendingWeightKg ?? prefillWeightKg
      self.pendingReps = pendingReps ?? prefillReps
      self.prescribedReps = prescribedReps
      self.completedExerciseIndex = completedExerciseIndex
      self.completedSetIndex = completedSetIndex
      self.followingExerciseName = followingExerciseName
      self.followingExercisePrescribedReps = followingExercisePrescribedReps
      self.followingExerciseTotalSets = followingExerciseTotalSets
    }

    public var timerEndsAt: Date { endsAt ?? startedAt }

    /**
     * `staleDate` may advance presentation while the app is suspended. The
     * destination is already materialized by the workout session; this method
     * never derives an action from set counts.
     */
    public func presentationPhase(isStale: Bool) -> RestActivityPhase {
      if phase == .resting && isStale {
        return nextAction.phase
      }
      if phase == .cardioRunning && isStale {
        return .cardioCompleted
      }
      return phase
    }
  }

  public let sessionId: String

  public init(sessionId: String) {
    self.sessionId = sessionId
  }
}
