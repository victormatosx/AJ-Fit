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
    /// Start of the WORKOUT (not of this rest), so the header can show session
    /// elapsed time. Optional: Activities started before this field existed
    /// simply omit the value instead of showing the rest duration in its place.
    public var workoutStartedAt: Date?
    /// Already resolved via `resolveSessionDisplayName` on the JS side — never a raw T001-T090 `name`/`type`.
    public var workoutName: String
    public var exerciseName: String
    /// Display-ready load of the set just completed (e.g. `"20 kg"`), already
    /// converted/formatted for the user's unit by the workout layer. `nil`
    /// when nothing was registered — the surface omits the line entirely.
    public var lastSetLoadLabel: String?
    /// One-based series number for presentation. Persisted set identities use
    /// the dedicated zero-based action fields instead.
    public var setIndex: Int
    public var totalSets: Int
    public var phase: RestActivityPhase
    public var nextAction: RestActivityNextAction
    public var nextSetIndex: Int?
    public var nextExerciseName: String?
    /// The NEXT exercise's own set count. `totalSets` still describes the
    /// exercise that just finished, so this is what "Série 1/N" needs when
    /// the rest ends on an exercise change. Optional for schema tolerance.
    public var nextExerciseTotalSets: Int?

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
      workoutStartedAt: Date? = nil,
      workoutName: String,
      exerciseName: String,
      lastSetLoadLabel: String? = nil,
      setIndex: Int,
      totalSets: Int,
      phase: RestActivityPhase,
      nextAction: RestActivityNextAction,
      nextSetIndex: Int? = nil,
      nextExerciseName: String? = nil,
      nextExerciseTotalSets: Int? = nil,
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
      self.workoutStartedAt = workoutStartedAt
      self.workoutName = workoutName
      self.exerciseName = exerciseName
      self.lastSetLoadLabel = lastSetLoadLabel
      self.setIndex = setIndex
      self.totalSets = totalSets
      self.phase = phase
      self.nextAction = nextAction
      self.nextSetIndex = nextSetIndex
      self.nextExerciseName = nextExerciseName
      self.nextExerciseTotalSets = nextExerciseTotalSets
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
     * The interval every `Text(timerInterval:)`/`ProgressView(timerInterval:)`
     * on this surface must use.
     *
     * `startedAt...timerEndsAt` is NOT safe to build inline: a persisted state
     * whose `endsAt` ended up earlier than `startedAt` (clock change, a stale
     * record, a future encoder bug) makes that a reversed `ClosedRange`, which
     * is a runtime trap — and a trapped widget process renders as an empty
     * card, not as a partial one. Collapsing to an empty interval degrades to
     * "0:00" instead.
     */
    public var timerRange: ClosedRange<Date> {
      let end = timerEndsAt
      return end >= startedAt ? startedAt...end : startedAt...startedAt
    }

    /**
     * The exercise the user is about to perform.
     *
     * The decision is NOT made here: `materializeRestNextAction`
     * (`src/workoutExecution/restActivityProjection.ts`) already resolved
     * whether the rest ends on another set of the same exercise or on a new
     * one. Swift only reads that verdict.
     */
    public var upcomingExerciseName: String {
      nextAction == .nextExercise ? (nextExerciseName ?? exerciseName) : exerciseName
    }

    /**
     * The series the user is about to perform, as `(number, total)`.
     *
     * Also read straight from what the projection materialized — no set
     * arithmetic is invented here. `nil` when the surface has nothing
     * truthful to show (cardio, or an older payload without the next
     * exercise's set count), in which case the line is omitted.
     */
    public var upcomingSeries: (number: Int, total: Int)? {
      switch nextAction {
      case .nextSet:
        guard let nextSetIndex, nextSetIndex >= 1, totalSets >= nextSetIndex else { return nil }
        return (nextSetIndex, totalSets)
      case .nextExercise:
        guard let nextExerciseTotalSets, nextExerciseTotalSets >= 1 else { return nil }
        return (1, nextExerciseTotalSets)
      case .finishWorkout:
        return nil
      }
    }

    /**
     * Count-up interval for the workout's own elapsed time, for the header.
     *
     * `nil` when the workout start was not carried (an Activity from before
     * the field existed), so the surface omits the value rather than showing
     * this rest's duration in its place — they are different quantities.
     *
     * Bounded instead of `.distantFuture`: a finite upper bound keeps the
     * range valid and is already far longer than any real session.
     */
    public var workoutElapsedRange: ClosedRange<Date>? {
      guard let workoutStartedAt else { return nil }
      return workoutStartedAt...workoutStartedAt.addingTimeInterval(86_400)
    }

    /**
     * Decoding is deliberately total: it never throws on a missing key.
     *
     * ActivityKit persists this state in the system daemon and decodes it with
     * whatever version of this type the currently-installed build ships. A
     * required key added later therefore breaks every Activity started by an
     * older build — and the damage is worse than a blank card: the throw also
     * makes `Activity.activities` skip that Activity, so `cleanup()`/`end()`
     * can never see it and it survives reinstalls until the system expires it.
     *
     * Verified: a pre-`workoutName` payload fails with the synthesized
     * initializer and decodes cleanly with this one. Every field added from
     * here on must keep a default here for the same reason.
     */
    public init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      startedAt = try container.decodeIfPresent(Date.self, forKey: .startedAt) ?? Date()
      endsAt = try container.decodeIfPresent(Date.self, forKey: .endsAt)
      workoutStartedAt = try container.decodeIfPresent(Date.self, forKey: .workoutStartedAt)
      workoutName = try container.decodeIfPresent(String.self, forKey: .workoutName) ?? ""
      exerciseName = try container.decodeIfPresent(String.self, forKey: .exerciseName) ?? ""
      lastSetLoadLabel = try container.decodeIfPresent(String.self, forKey: .lastSetLoadLabel)
      setIndex = try container.decodeIfPresent(Int.self, forKey: .setIndex) ?? 0
      totalSets = try container.decodeIfPresent(Int.self, forKey: .totalSets) ?? 1
      phase = try container.decodeIfPresent(RestActivityPhase.self, forKey: .phase) ?? .workoutActive
      nextAction = try container.decodeIfPresent(RestActivityNextAction.self, forKey: .nextAction) ?? .nextSet
      nextSetIndex = try container.decodeIfPresent(Int.self, forKey: .nextSetIndex)
      nextExerciseName = try container.decodeIfPresent(String.self, forKey: .nextExerciseName)
      nextExerciseTotalSets = try container.decodeIfPresent(Int.self, forKey: .nextExerciseTotalSets)
      exerciseIndex = try container.decodeIfPresent(Int.self, forKey: .exerciseIndex)
      weightStepKg = try container.decodeIfPresent(Double.self, forKey: .weightStepKg)
      weightUnit = try container.decodeIfPresent(String.self, forKey: .weightUnit)
      repsStep = try container.decodeIfPresent(Int.self, forKey: .repsStep)
      prefillWeightKg = try container.decodeIfPresent(Double.self, forKey: .prefillWeightKg)
      prefillReps = try container.decodeIfPresent(Int.self, forKey: .prefillReps)
      pendingWeightKg = try container.decodeIfPresent(Double.self, forKey: .pendingWeightKg)
      pendingReps = try container.decodeIfPresent(Int.self, forKey: .pendingReps)
      prescribedReps = try container.decodeIfPresent(String.self, forKey: .prescribedReps)
      completedExerciseIndex = try container.decodeIfPresent(Int.self, forKey: .completedExerciseIndex)
      completedSetIndex = try container.decodeIfPresent(Int.self, forKey: .completedSetIndex)
      followingExerciseName = try container.decodeIfPresent(String.self, forKey: .followingExerciseName)
      followingExercisePrescribedReps = try container.decodeIfPresent(
        String.self, forKey: .followingExercisePrescribedReps
      )
      followingExerciseTotalSets = try container.decodeIfPresent(Int.self, forKey: .followingExerciseTotalSets)
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
