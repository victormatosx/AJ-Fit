import Foundation

enum AJFitWeekday: String, Codable, CaseIterable {
  case mon = "MON", tue = "TUE", wed = "WED", thu = "THU", fri = "FRI", sat = "SAT", sun = "SUN"

  var shortLabel: String {
    switch self {
    case .mon: return "S"
    case .tue: return "T"
    case .wed: return "Q"
    case .thu: return "Q"
    case .fri: return "S"
    case .sat: return "S"
    case .sun: return "D"
    }
  }
}

enum AJFitDayStatus: String, Codable, CaseIterable {
  case completed = "COMPLETED"
  case todayCompleted = "TODAY_COMPLETED"
  case todayPending = "TODAY_PENDING"
  case missed = "MISSED"
  case upcoming = "UPCOMING"
  case fulfilledEarly = "FULFILLED_EARLY"
  case activeRecovery = "ACTIVE_RECOVERY"
  case rest = "REST"
  case beforeProgram = "BEFORE_PROGRAM"
}

struct AJFitStreak: Codable, Equatable {
  let scheduleMode: String
  let unit: String
  let current: Int
  let complete: Bool

  var unitLabel: String {
    if unit == "weeks" { return current == 1 ? "semana" : "semanas" }
    return current == 1 ? "treino" : "treinos"
  }

  var displayValue: String { complete ? String(current) : "\(current)+" }
}

struct AJFitWeekDay: Codable, Equatable {
  let localDate: String
  let weekday: AJFitWeekday
  let status: AJFitDayStatus
  let isToday: Bool
}

struct AJFitMonthlyActivity: Codable, Equatable {
  let year: Int
  let month: Int
  let daysInMonth: Int
  let startWeekday: AJFitWeekday
  let completedLocalDates: [String]
}

struct AJFitFrequencyWindow: Codable, Equatable {
  let startLocalDate: String
  let endLocalDate: String
  let startWeekday: AJFitWeekday
  let completedLocalDates: [String]
}

struct AJFitReadyFields: Codable, Equatable {
  let streak: AJFitStreak
  let weeklyActivity: [AJFitWeekDay]
  let monthlyActivity: AJFitMonthlyActivity
  let frequencyWindow: AJFitFrequencyWindow
}

struct AJFitWorkout: Codable, Equatable {
  let state: String
  let eyebrow: String
  let workoutName: String
  let exerciseCount: Int
  let setCount: Int
  let exercisesLabel: String
  let setsLabel: String
  let metricsLabel: String
  let dateLabel: String?
  let todayLabel: String?
  let dateBecomesTodayAtMs: Double?
  let bodyMap: AJFitWorkoutBodyMap?
  let staleAtMs: Double

  var isValid: Bool {
    ["NEXT", "IN_PROGRESS"].contains(state)
      && !eyebrow.isEmpty && !workoutName.isEmpty
      && exerciseCount >= 0 && setCount >= 0
      && (bodyMap?.isValid ?? true)
  }

  func displayedDateLabel(at date: Date) -> String? {
    guard let todayLabel, let dateBecomesTodayAtMs,
          date.timeIntervalSince1970 * 1000 >= dateBecomesTodayAtMs else {
      return dateLabel
    }
    return todayLabel
  }
}

struct AJFitWorkoutBodyMap: Codable, Equatable {
  let sex: String
  let primaryMuscles: [String]
  let secondaryMuscles: [String]

  private static let supportedMuscles: Set<String> = [
    "chest", "lats", "upper_back", "traps", "lower_back",
    "front_deltoid", "side_deltoid", "rear_deltoid", "biceps", "triceps",
    "forearms", "quads", "hamstrings", "glutes", "adductors", "abductors",
    "calves", "abs",
  ]

  var isValid: Bool {
    ["m", "f"].contains(sex)
      && !primaryMuscles.isEmpty
      && primaryMuscles.allSatisfy(Self.supportedMuscles.contains)
      && secondaryMuscles.allSatisfy(Self.supportedMuscles.contains)
  }
}

struct AJFitFutureEntry: Codable, Equatable {
  let effectiveLocalDate: String
  let effectiveAtMs: Double
  let streak: AJFitStreak
  let weeklyActivity: [AJFitWeekDay]
  let monthlyActivity: AJFitMonthlyActivity
  let frequencyWindow: AJFitFrequencyWindow

  var fields: AJFitReadyFields {
    AJFitReadyFields(streak: streak, weeklyActivity: weeklyActivity,
                     monthlyActivity: monthlyActivity, frequencyWindow: frequencyWindow)
  }
}

enum AJFitEmptyReason: Equatable {
  case unauthenticated, noProgram, unavailable
}

enum AJFitWidgetContent: Equatable {
  case ready(AJFitReadyFields)
  case empty(AJFitEmptyReason)
}

enum AJFitWorkoutWidgetContent: Equatable {
  case ready(AJFitWorkout)
  case empty(AJFitEmptyReason)
}

struct AJFitDecodedSnapshot: Codable {
  let schemaVersion: Int
  let status: String
  let localDate: String?
  let generatedAtMs: Double?
  let effectiveAtMs: Double?
  let streak: AJFitStreak?
  let weeklyActivity: [AJFitWeekDay]?
  let monthlyActivity: AJFitMonthlyActivity?
  let frequencyWindow: AJFitFrequencyWindow?
  let futureEntries: [AJFitFutureEntry]?
  let workout: AJFitWorkout?

  func currentFields() -> AJFitReadyFields? {
    guard let streak, let weeklyActivity, weeklyActivity.count == 7,
          let monthlyActivity, (1...12).contains(monthlyActivity.month),
          (28...31).contains(monthlyActivity.daysInMonth),
          let frequencyWindow else { return nil }
    return AJFitReadyFields(streak: streak, weeklyActivity: weeklyActivity,
                            monthlyActivity: monthlyActivity, frequencyWindow: frequencyWindow)
  }
}

enum AJFitSnapshotDecoder {
  static let supportedSchemaVersions: Set<Int> = [1, 2]

  static func decode(_ json: String?) -> AJFitDecodedSnapshot? {
    guard let json, let data = json.data(using: .utf8),
          let snapshot = try? JSONDecoder().decode(AJFitDecodedSnapshot.self, from: data),
          supportedSchemaVersions.contains(snapshot.schemaVersion),
          ["UNAUTHENTICATED", "NO_PROGRAM", "READY"].contains(snapshot.status) else { return nil }
    if snapshot.status == "READY" {
      guard snapshot.effectiveAtMs != nil, snapshot.currentFields() != nil else { return nil }
    }
    return snapshot
  }
}

enum AJFitWorkoutResolver {
  static func resolve(snapshot: AJFitDecodedSnapshot?, now: Date) -> AJFitWorkoutWidgetContent {
    guard let snapshot else { return .empty(.unavailable) }
    if snapshot.status == "UNAUTHENTICATED" { return .empty(.unauthenticated) }
    if snapshot.status == "NO_PROGRAM" { return .empty(.noProgram) }
    guard let workout = snapshot.workout, workout.isValid,
          now.timeIntervalSince1970 * 1000 < workout.staleAtMs else {
      return .empty(.unavailable)
    }
    return .ready(workout)
  }
}

struct AJFitResolvedEntry: Equatable {
  let date: Date
  let content: AJFitWidgetContent
}

enum AJFitTimelineResolver {
  static func resolve(snapshot: AJFitDecodedSnapshot?, now: Date) -> [AJFitResolvedEntry] {
    guard let snapshot else { return [AJFitResolvedEntry(date: now, content: .empty(.unavailable))] }
    if snapshot.status == "UNAUTHENTICATED" {
      return [AJFitResolvedEntry(date: now, content: .empty(.unauthenticated))]
    }
    if snapshot.status == "NO_PROGRAM" {
      return [AJFitResolvedEntry(date: now, content: .empty(.noProgram))]
    }
    guard let effectiveAtMs = snapshot.effectiveAtMs, let fields = snapshot.currentFields() else {
      return [AJFitResolvedEntry(date: now, content: .empty(.unavailable))]
    }

    var candidates = [AJFitResolvedEntry(
      date: Date(timeIntervalSince1970: effectiveAtMs / 1000), content: .ready(fields)
    )]
    candidates += (snapshot.futureEntries ?? []).map {
      AJFitResolvedEntry(date: Date(timeIntervalSince1970: $0.effectiveAtMs / 1000), content: .ready($0.fields))
    }
    candidates.sort { $0.date < $1.date }

    let current = candidates.last(where: { $0.date <= now }) ?? candidates[0]
    return [AJFitResolvedEntry(date: now, content: current.content)] + candidates.filter { $0.date > now }
  }
}

/// Presentation-only calendar geometry. The snapshot remains authoritative
/// for month length and first weekday; this helper merely creates stable,
/// uniquely identified grid slots for SwiftUI.
struct AJFitCalendarSlot: Identifiable, Equatable {
  enum Content: Equatable { case empty, day(Int) }
  let id: String
  let content: Content
}

enum AJFitCalendarLayout {
  static let weekdayOrder: [AJFitWeekday] = [.sun, .mon, .tue, .wed, .thu, .fri, .sat]

  static func slots(daysInMonth: Int, startWeekday: AJFitWeekday) -> [AJFitCalendarSlot] {
    let leading = weekdayOrder.firstIndex(of: startWeekday) ?? 0
    let occupied = leading + daysInMonth
    let trailing = (7 - occupied % 7) % 7
    return (0..<leading).map { AJFitCalendarSlot(id: "leading-\($0)", content: .empty) }
      + (1...daysInMonth).map { AJFitCalendarSlot(id: "day-\($0)", content: .day($0)) }
      + (0..<trailing).map { AJFitCalendarSlot(id: "trailing-\($0)", content: .empty) }
  }
}
