import ActivityKit
import Foundation

public struct AJFitRestActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable, Sendable {
    public var startedAt: Date
    public var endsAt: Date
    public var exerciseName: String
    public var setIndex: Int
    public var totalSets: Int

    // Presentation-only lifecycle state. It is intentionally not part of the
    // TypeScript contract or the workout domain.
    public var isResting: Bool
    public var endReason: String?

    public init(
      startedAt: Date,
      endsAt: Date,
      exerciseName: String,
      setIndex: Int,
      totalSets: Int,
      isResting: Bool,
      endReason: String? = nil
    ) {
      self.startedAt = startedAt
      self.endsAt = endsAt
      self.exerciseName = exerciseName
      self.setIndex = setIndex
      self.totalSets = totalSets
      self.isResting = isResting
      self.endReason = endReason
    }
  }

  public let sessionId: String

  public init(sessionId: String) {
    self.sessionId = sessionId
  }
}
