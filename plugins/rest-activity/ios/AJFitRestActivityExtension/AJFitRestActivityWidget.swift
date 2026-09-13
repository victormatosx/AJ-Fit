import ActivityKit
import SwiftUI
import WidgetKit

private let activeWorkoutURL = URL(string: "ajfit://workout/active")!
private let ajFitBlue = Color(red: 0.16, green: 0.50, blue: 1.00)
private let ajFitBackground = Color(red: 0.01, green: 0.00, blue: 0.07)

private enum RestActivityCopy {
  static let restTitle: LocalizedStringKey = "rest_activity_lock_screen_title"
  static let expandedRestTitle: LocalizedStringKey = "rest_activity_title"
  static let nextSet: LocalizedStringKey = "rest_activity_next_set"
  static let nextSetCompact: LocalizedStringKey = "rest_activity_next_set_compact"
  static let nextExercise: LocalizedStringKey = "rest_activity_next_exercise"
  static let nextExerciseCompact: LocalizedStringKey = "rest_activity_next_exercise_compact"
  static let returnToWorkout: LocalizedStringKey = "rest_activity_return_to_workout"
  static let tapToContinue: LocalizedStringKey = "rest_activity_tap_to_continue"
  static let timeAccessibility: LocalizedStringKey = "rest_activity_time_accessibility"
  static let cardioTitle: LocalizedStringKey = "cardio_activity_title"
  static let cardioPaused: LocalizedStringKey = "cardio_activity_paused"
  static let cardioCompleted: LocalizedStringKey = "cardio_activity_completed"
  static let finishWorkout: LocalizedStringKey = "cardio_activity_finish_workout"
  static let cardioTimeAccessibility: LocalizedStringKey = "cardio_activity_time_accessibility"

  static func series(_ setIndex: Int, _ totalSets: Int) -> String {
    String(format: String(localized: "rest_activity_series_format"), setIndex, totalSets)
  }
}

private func cardioRemainingText(
  _ state: AJFitRestActivityAttributes.ContentState
) -> String {
  let seconds = max(0, Int(state.endsAt.timeIntervalSince(state.startedAt).rounded(.down)))
  let hours = seconds / 3_600
  let minutes = (seconds % 3_600) / 60
  let remainder = seconds % 60
  return hours > 0
    ? String(format: "%d:%02d:%02d", hours, minutes, remainder)
    : String(format: "%d:%02d", minutes, remainder)
}

private struct AJFitLogo: View {
  var body: some View {
    Image("AJFitLogo", bundle: .main)
      .renderingMode(.original)
      .resizable()
      .scaledToFit()
      .frame(width: 24, height: 24)
      .accessibilityLabel("AJ Fit")
  }
}

private struct RestSetProgressRing: View {
  let currentSet: Int
  let totalSets: Int
  let size: CGFloat
  private let maximumDiscreteSegments = 8

  private var safeTotalSets: Int { max(totalSets, 1) }
  private var safeCurrentSet: Int { min(max(currentSet, 0), safeTotalSets) }
  private var lineWidth: CGFloat { max(1.5, size * 0.09) }
  private var proportionalProgress: CGFloat {
    CGFloat(safeCurrentSet) / CGFloat(safeTotalSets)
  }

  private func segmentStart(_ index: Int) -> CGFloat {
    let segmentLength = 1 / CGFloat(safeTotalSets)
    let gap = min(0.035, segmentLength * 0.22)
    return (CGFloat(index) * segmentLength) + (gap / 2)
  }

  private func segmentEnd(_ index: Int) -> CGFloat {
    let segmentLength = 1 / CGFloat(safeTotalSets)
    let gap = min(0.035, segmentLength * 0.22)
    return (CGFloat(index + 1) * segmentLength) - (gap / 2)
  }

  private func segmentColor(_ index: Int) -> Color {
    if index + 1 == safeCurrentSet { return ajFitBlue }
    if index < safeCurrentSet { return ajFitBlue.opacity(0.68) }
    return .white.opacity(0.18)
  }

  var body: some View {
    ZStack {
      if safeTotalSets <= maximumDiscreteSegments {
        ForEach(0..<safeTotalSets, id: \.self) { index in
          Circle()
            .trim(from: segmentStart(index), to: segmentEnd(index))
            .stroke(
              segmentColor(index),
              style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
            )
            .rotationEffect(.degrees(-90))
        }
      } else {
        Circle()
          .stroke(
            Color.white.opacity(0.18),
            style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
          )
        Circle()
          .trim(from: 0, to: proportionalProgress)
          .stroke(
            ajFitBlue,
            style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
          )
          .rotationEffect(.degrees(-90))
      }
      Image(systemName: "stopwatch")
        .font(.system(size: size * 0.39, weight: .semibold))
        .foregroundStyle(.white)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

private struct RestCountdownText: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    Text(
      timerInterval: state.startedAt...state.endsAt,
      countsDown: true,
      showsHours: false
    )
    .font(.system(size: 42, weight: .bold, design: .monospaced))
    .monospacedDigit()
    .foregroundStyle(.white)
    .accessibilityLabel(Text(RestActivityCopy.timeAccessibility))
  }
}

private struct RestAdvanceIndicator: View {
  let size: CGFloat
  let accessibilityLabel: LocalizedStringKey

  private var lineWidth: CGFloat { max(1.5, size * 0.09) }

  var body: some View {
    ZStack {
      Circle()
        .strokeBorder(ajFitBlue, lineWidth: lineWidth)
      Image(systemName: "forward.end.fill")
        .font(.system(size: size * 0.42, weight: .bold))
        .foregroundStyle(.white)
    }
    .frame(width: size, height: size)
    .accessibilityLabel(Text(accessibilityLabel))
  }
}

private struct RestingCompactLeadingView: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    Text(
      timerInterval: state.startedAt...state.endsAt,
      countsDown: true,
      showsHours: false
    )
    .font(.system(size: 16, weight: .semibold, design: .monospaced))
    .monospacedDigit()
    .lineLimit(1)
    // Keep only the width needed by the supported compact formats (0:00–12:34).
    // `fixedSize(horizontal:)` made this timer refuse the compact region's
    // proposal and could cause iOS to drop compactLeading altogether.
    .frame(width: 48, alignment: .leading)
    .minimumScaleFactor(0.78)
    .foregroundStyle(.white)
    .accessibilityLabel(Text(RestActivityCopy.timeAccessibility))
  }
}

private struct RestingCompactTrailingView: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    RestSetProgressRing(currentSet: state.setIndex, totalSets: state.totalSets, size: 20)
      .fixedSize()
  }
}

private struct RestingMinimalView: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    Text(
      timerInterval: state.startedAt...state.endsAt,
      countsDown: true,
      showsHours: false
    )
    .font(.system(size: 13, weight: .bold, design: .monospaced))
    .monospacedDigit()
    .lineLimit(1)
    .minimumScaleFactor(0.72)
    .foregroundStyle(.white)
    .accessibilityLabel(Text(RestActivityCopy.timeAccessibility))
  }
}

private struct CardioTimerText: View {
  let state: AJFitRestActivityAttributes.ContentState
  let compact: Bool

  var body: some View {
    Group {
      if state.phase == .cardioRunning {
        Text(timerInterval: state.startedAt...state.endsAt, countsDown: true, showsHours: false)
      } else {
        Text(cardioRemainingText(state))
      }
    }
    .font(.system(size: compact ? 16 : 42, weight: .bold, design: .monospaced))
    .monospacedDigit()
    .lineLimit(1)
    .minimumScaleFactor(0.72)
    .foregroundStyle(.white)
    .accessibilityLabel(Text(RestActivityCopy.cardioTimeAccessibility))
  }
}

private struct CardioStatusIcon: View {
  let phase: RestActivityPhase
  let size: CGFloat

  var body: some View {
    Image(systemName: phase == .cardioCompleted
      ? "checkmark.circle.fill"
      : phase == .cardioPaused ? "pause.circle.fill" : "heart.fill")
      .font(.system(size: size, weight: .semibold))
      .foregroundStyle(ajFitBlue)
      .accessibilityHidden(true)
  }
}

private struct CardioLockScreenView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        AJFitLogo()
        Text(RestActivityCopy.cardioTitle)
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .foregroundStyle(ajFitBlue)
        Spacer()
        CardioStatusIcon(phase: phase, size: 22)
      }
      if phase == .cardioCompleted {
        Text(RestActivityCopy.cardioCompleted)
          .font(.system(size: 24, weight: .bold, design: .rounded))
          .foregroundStyle(.white)
        Text(RestActivityCopy.finishWorkout)
          .font(.system(size: 15, weight: .semibold, design: .rounded))
          .foregroundStyle(ajFitBlue)
      } else {
        CardioTimerText(state: state, compact: false)
        Text(phase == .cardioPaused ? RestActivityCopy.cardioPaused : RestActivityCopy.returnToWorkout)
          .font(.system(size: 13, weight: .medium, design: .rounded))
          .foregroundStyle(.white.opacity(0.68))
      }
      Text(state.exerciseName)
        .font(.system(size: 16, weight: .semibold, design: .rounded))
        .foregroundStyle(.white)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
    }
  }
}

private struct NextSetCompactLeadingView: View {
  var body: some View {
    Text(RestActivityCopy.nextSetCompact)
      .font(.system(size: 10, weight: .bold, design: .rounded))
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      .foregroundStyle(ajFitBlue)
  }
}

private struct NextSetCompactTrailingView: View {
  var body: some View {
    RestAdvanceIndicator(size: 20, accessibilityLabel: RestActivityCopy.nextSet)
  }
}

private struct NextExerciseCompactLeadingView: View {
  var body: some View {
    Text(RestActivityCopy.nextExerciseCompact)
      .font(.system(size: 9.5, weight: .bold, design: .rounded))
      .lineLimit(1)
      .minimumScaleFactor(0.68)
      .foregroundStyle(ajFitBlue)
  }
}

private struct NextExerciseCompactTrailingView: View {
  var body: some View {
    RestAdvanceIndicator(size: 20, accessibilityLabel: RestActivityCopy.nextExercise)
  }
}

private struct NextActionMinimalView: View {
  let phase: RestActivityPhase

  var body: some View {
    RestAdvanceIndicator(
      size: 20,
      accessibilityLabel: phase == .nextSet
        ? RestActivityCopy.nextSet
        : RestActivityCopy.nextExercise
    )
  }
}

private struct ReturnToWorkoutView: View {
  let copy: LocalizedStringKey

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "arrow.up.right.circle.fill")
      Text(copy)
    }
    .font(.system(size: 12, weight: .medium, design: .rounded))
    .foregroundStyle(.white.opacity(0.62))
  }
}

private struct RestingLockScreenView: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        AJFitLogo()
        Text(RestActivityCopy.restTitle)
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .foregroundStyle(ajFitBlue)
        Spacer()
        RestSetProgressRing(currentSet: state.setIndex, totalSets: state.totalSets, size: 20)
        Text(RestActivityCopy.series(state.setIndex, state.totalSets))
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .foregroundStyle(.white.opacity(0.72))
      }
      RestCountdownText(state: state)
      Text(state.exerciseName)
        .font(.system(size: 17, weight: .semibold, design: .rounded))
        .foregroundStyle(.white)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
      ReturnToWorkoutView(copy: RestActivityCopy.returnToWorkout)
    }
  }
}

private struct NextSetLockScreenView: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        AJFitLogo()
        Text(RestActivityCopy.nextSet)
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .foregroundStyle(ajFitBlue)
        Spacer()
        RestAdvanceIndicator(size: 24, accessibilityLabel: RestActivityCopy.nextSet)
      }
      if let nextSetIndex = state.nextSetIndex {
        Text(RestActivityCopy.series(nextSetIndex, state.totalSets))
          .font(.system(size: 22, weight: .bold, design: .rounded))
          .foregroundStyle(.white)
      }
      Text(state.exerciseName)
        .font(.system(size: 17, weight: .semibold, design: .rounded))
        .foregroundStyle(.white)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
      ReturnToWorkoutView(copy: RestActivityCopy.tapToContinue)
    }
  }
}

private struct NextExerciseLockScreenView: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        AJFitLogo()
        Text(RestActivityCopy.nextExercise)
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .foregroundStyle(ajFitBlue)
        Spacer()
        RestAdvanceIndicator(size: 24, accessibilityLabel: RestActivityCopy.nextExercise)
      }
      Text(state.nextExerciseName ?? "")
        .font(.system(size: 24, weight: .bold, design: .rounded))
        .foregroundStyle(.white)
        .lineLimit(2)
        .minimumScaleFactor(0.72)
      ReturnToWorkoutView(copy: RestActivityCopy.tapToContinue)
    }
  }
}

private struct RestLockScreenView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    Group {
      switch phase {
      case .resting: RestingLockScreenView(state: state)
      case .nextSet: NextSetLockScreenView(state: state)
      case .nextExercise: NextExerciseLockScreenView(state: state)
      case .cardioRunning, .cardioPaused, .cardioCompleted:
        CardioLockScreenView(state: state, phase: phase)
      }
    }
    .padding(16)
    .widgetURL(activeWorkoutURL)
  }
}

private struct ExpandedLeadingView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    Group {
      if phase == .resting {
        HStack(spacing: 7) {
          RestSetProgressRing(currentSet: state.setIndex, totalSets: state.totalSets, size: 24)
          Text(RestActivityCopy.expandedRestTitle)
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundStyle(ajFitBlue)
        }
      } else {
        HStack(spacing: 7) {
          AJFitLogo()
          Text("AJ FIT")
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .foregroundStyle(ajFitBlue)
        }
      }
    }
  }
}

private struct ExpandedTrailingView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    Group {
      switch phase {
      case .resting:
        Text(RestActivityCopy.series(state.setIndex, state.totalSets))
      case .nextSet:
        HStack(spacing: 5) {
          if let nextSetIndex = state.nextSetIndex {
            Text(RestActivityCopy.series(nextSetIndex, state.totalSets))
          }
          RestAdvanceIndicator(size: 22, accessibilityLabel: RestActivityCopy.nextSet)
        }
      case .nextExercise:
        RestAdvanceIndicator(size: 22, accessibilityLabel: RestActivityCopy.nextExercise)
      case .cardioRunning, .cardioPaused, .cardioCompleted:
        CardioStatusIcon(phase: phase, size: 22)
      }
    }
    .font(.system(size: 12, weight: .semibold, design: .rounded))
    .foregroundStyle(.white.opacity(0.72))
  }
}

private struct ExpandedCenterView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    Group {
      switch phase {
      case .resting:
        RestCountdownText(state: state)
      case .nextSet:
        Text(RestActivityCopy.nextSet)
          .font(.system(size: 24, weight: .bold, design: .rounded))
          .foregroundStyle(.white)
      case .nextExercise:
        Text(RestActivityCopy.nextExercise)
          .font(.system(size: 22, weight: .bold, design: .rounded))
          .foregroundStyle(.white)
      case .cardioRunning, .cardioPaused:
        CardioTimerText(state: state, compact: false)
      case .cardioCompleted:
        Text(RestActivityCopy.cardioCompleted)
          .font(.system(size: 22, weight: .bold, design: .rounded))
          .foregroundStyle(.white)
      }
    }
  }
}

private struct ExpandedBottomView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase
  private var exerciseName: String {
    phase == .nextExercise ? state.nextExerciseName ?? "" : state.exerciseName
  }

  var body: some View {
    VStack(spacing: 5) {
      if phase == .nextSet {
        if let nextSetIndex = state.nextSetIndex {
          Text(RestActivityCopy.series(nextSetIndex, state.totalSets))
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundStyle(ajFitBlue)
        }
      }
      Text(exerciseName)
        .font(.system(size: 16, weight: .semibold, design: .rounded))
        .foregroundStyle(.white)
        .lineLimit(1)
        .minimumScaleFactor(0.72)
      Text(
        phase == .resting || phase == .cardioRunning
          ? RestActivityCopy.returnToWorkout
          : phase == .cardioPaused
            ? RestActivityCopy.cardioPaused
            : phase == .cardioCompleted
              ? RestActivityCopy.finishWorkout
              : RestActivityCopy.tapToContinue
      )
        .font(.system(size: 11, weight: .medium, design: .rounded))
        .foregroundStyle(.white.opacity(0.58))
    }
  }
}

struct AJFitRestActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AJFitRestActivityAttributes.self) { context in
      let phase = context.state.presentationPhase(isStale: context.isStale)
      RestLockScreenView(state: context.state, phase: phase)
        .activityBackgroundTint(ajFitBackground)
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let phase = context.state.presentationPhase(isStale: context.isStale)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ExpandedLeadingView(state: context.state, phase: phase)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ExpandedTrailingView(state: context.state, phase: phase)
        }
        DynamicIslandExpandedRegion(.center) {
          ExpandedCenterView(state: context.state, phase: phase)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ExpandedBottomView(state: context.state, phase: phase)
        }
      } compactLeading: {
        switch phase {
        case .resting: RestingCompactLeadingView(state: context.state)
        case .nextSet: NextSetCompactLeadingView()
        case .nextExercise: NextExerciseCompactLeadingView()
        case .cardioRunning, .cardioPaused:
          CardioTimerText(state: context.state, compact: true)
            .frame(width: 48, alignment: .leading)
        case .cardioCompleted:
          Text(RestActivityCopy.cardioCompleted)
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundStyle(ajFitBlue)
        }
      } compactTrailing: {
        switch phase {
        case .resting: RestingCompactTrailingView(state: context.state)
        case .nextSet: NextSetCompactTrailingView()
        case .nextExercise: NextExerciseCompactTrailingView()
        case .cardioRunning, .cardioPaused, .cardioCompleted:
          CardioStatusIcon(phase: phase, size: 19)
        }
      } minimal: {
        if phase == .resting {
          RestingMinimalView(state: context.state)
        } else if phase == .cardioRunning || phase == .cardioPaused {
          CardioTimerText(state: context.state, compact: true)
        } else if phase == .cardioCompleted {
          CardioStatusIcon(phase: phase, size: 19)
        } else {
          NextActionMinimalView(phase: phase)
        }
      }
      .widgetURL(activeWorkoutURL)
    }
  }
}

#if DEBUG
private enum RestActivityPreviewData {
  private static let start = Date(timeIntervalSinceNow: -18)
  private static let end = Date(timeIntervalSinceNow: 42)

  static func restingNextSet(
    setIndex: Int,
    totalSets: Int,
    nextSetIndex: Int
  ) -> AJFitRestActivityAttributes.ContentState {
    .init(
      startedAt: start, endsAt: end, exerciseName: "Supino reto máquina",
      setIndex: setIndex, totalSets: totalSets, phase: .resting,
      nextAction: .nextSet, nextSetIndex: nextSetIndex
    )
  }

  static let restingNextExercise = AJFitRestActivityAttributes.ContentState(
      startedAt: start, endsAt: end, exerciseName: "Supino reto máquina",
      setIndex: 4, totalSets: 4, phase: .resting,
      nextAction: .nextExercise, nextExerciseName: "Puxada alta"
    )

  static func nextSet(setIndex: Int, totalSets: Int) -> AJFitRestActivityAttributes.ContentState {
    .init(
      startedAt: start, endsAt: end, exerciseName: "Supino reto máquina",
      setIndex: setIndex - 1, totalSets: totalSets, phase: .nextSet,
      nextAction: .nextSet, nextSetIndex: setIndex
    )
  }

  static let nextExercise = AJFitRestActivityAttributes.ContentState(
    startedAt: start, endsAt: end, exerciseName: "Supino reto máquina",
    setIndex: 4, totalSets: 4, phase: .nextExercise,
    nextAction: .nextExercise, nextExerciseName: "Puxada alta"
  )
}

private struct CompactPreview: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    HStack(spacing: 42) {
      switch phase {
      case .resting: RestingCompactLeadingView(state: state)
      case .nextSet: NextSetCompactLeadingView()
      case .nextExercise: NextExerciseCompactLeadingView()
      case .cardioRunning, .cardioPaused:
        CardioTimerText(state: state, compact: true)
      case .cardioCompleted:
        Text(RestActivityCopy.cardioCompleted)
      }
      switch phase {
      case .resting: RestingCompactTrailingView(state: state)
      case .nextSet: NextSetCompactTrailingView()
      case .nextExercise: NextExerciseCompactTrailingView()
      case .cardioRunning, .cardioPaused, .cardioCompleted:
        CardioStatusIcon(phase: phase, size: 19)
      }
    }
    .padding(8)
    .background(ajFitBackground)
  }
}

private struct CompactComparisonPreview: View {
  let resting: AJFitRestActivityAttributes.ContentState
  let nextSet: AJFitRestActivityAttributes.ContentState

  private struct Sample: View {
    let title: LocalizedStringKey
    let leading: AnyView
    let trailing: AnyView

    var body: some View {
      VStack(alignment: .leading, spacing: 5) {
        Text(title)
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.6))
        HStack(spacing: 8) {
          leading
          trailing
        }
        .padding(6)
        .background(ajFitBackground)
      }
    }
  }

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      Sample(
        title: "resting",
        leading: AnyView(RestingCompactLeadingView(state: resting)),
        trailing: AnyView(RestingCompactTrailingView(state: resting))
      )
      Sample(
        title: "next_set",
        leading: AnyView(NextSetCompactLeadingView()),
        trailing: AnyView(NextSetCompactTrailingView())
      )
    }
    .padding(8)
    .background(ajFitBackground)
  }
}

private struct ExpandedPreview: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    VStack(spacing: 10) {
      HStack {
        ExpandedLeadingView(state: state, phase: phase)
        Spacer()
        ExpandedTrailingView(state: state, phase: phase)
      }
      ExpandedCenterView(state: state, phase: phase)
      ExpandedBottomView(state: state, phase: phase)
    }
    .padding(14)
    .background(ajFitBackground)
  }
}

private struct RestActivityStatePreviews: PreviewProvider {
  static var previews: some View {
    Group {
      RestLockScreenView(
        state: RestActivityPreviewData.restingNextSet(
          setIndex: 1, totalSets: 4, nextSetIndex: 2
        ),
        phase: .resting
      ).background(ajFitBackground).previewDisplayName("resting 1/4")
      RestLockScreenView(
        state: RestActivityPreviewData.restingNextSet(
          setIndex: 3, totalSets: 4, nextSetIndex: 4
        ),
        phase: .resting
      ).background(ajFitBackground).previewDisplayName("resting 3/4")
      RestLockScreenView(state: RestActivityPreviewData.restingNextExercise, phase: .resting)
        .background(ajFitBackground).previewDisplayName("resting 4/4")
      RestLockScreenView(
        state: RestActivityPreviewData.nextSet(setIndex: 2, totalSets: 4),
        phase: .nextSet
      ).background(ajFitBackground).previewDisplayName("next_set 2/4")
      RestLockScreenView(
        state: RestActivityPreviewData.nextSet(setIndex: 3, totalSets: 4),
        phase: .nextSet
      ).background(ajFitBackground).previewDisplayName("next_set 3/4")
      CompactPreview(
        state: RestActivityPreviewData.restingNextSet(
          setIndex: 1, totalSets: 4, nextSetIndex: 2
        ),
        phase: .resting
      )
        .previewDisplayName("compact resting")
      CompactComparisonPreview(
        resting: RestActivityPreviewData.restingNextSet(
          setIndex: 1, totalSets: 4, nextSetIndex: 2
        ),
        nextSet: RestActivityPreviewData.nextSet(setIndex: 2, totalSets: 4)
      )
        .previewDisplayName("compact resting vs next_set")
      RestingMinimalView(
        state: RestActivityPreviewData.restingNextSet(
          setIndex: 1, totalSets: 4, nextSetIndex: 2
        )
      )
        .padding(8).background(ajFitBackground).previewDisplayName("minimal resting")
      ExpandedPreview(
        state: RestActivityPreviewData.restingNextSet(
          setIndex: 3, totalSets: 4, nextSetIndex: 4
        ),
        phase: .resting
      )
        .previewDisplayName("expanded resting")
      CompactPreview(state: RestActivityPreviewData.nextSet(setIndex: 3, totalSets: 4), phase: .nextSet)
        .previewDisplayName("compact next_set")
      ExpandedPreview(state: RestActivityPreviewData.nextSet(setIndex: 3, totalSets: 4), phase: .nextSet)
        .previewDisplayName("expanded next_set")
      CompactPreview(state: RestActivityPreviewData.nextExercise, phase: .nextExercise)
        .previewDisplayName("compact next_exercise")
      ExpandedPreview(state: RestActivityPreviewData.nextExercise, phase: .nextExercise)
        .previewDisplayName("expanded next_exercise")
      RestLockScreenView(
        state: RestActivityPreviewData.restingNextSet(
          setIndex: 3, totalSets: 4, nextSetIndex: 4
        ),
        phase: .resting
      )
        .background(ajFitBackground).previewDisplayName("Lock Screen resting")
      RestLockScreenView(state: RestActivityPreviewData.nextSet(setIndex: 3, totalSets: 4), phase: .nextSet)
        .background(ajFitBackground).previewDisplayName("Lock Screen next_set")
      RestLockScreenView(state: RestActivityPreviewData.nextExercise, phase: .nextExercise)
        .background(ajFitBackground).previewDisplayName("Lock Screen next_exercise")
    }
    .previewLayout(.sizeThatFits)
  }

}
#endif
