import ActivityKit
import SwiftUI
import WidgetKit

private let activeWorkoutURL = URL(string: "ajfit://workout/active")!
private let ajFitBlue = Color(red: 0.16, green: 0.50, blue: 1.00)
private let ajFitBackground = Color(red: 0.01, green: 0.00, blue: 0.07)

private enum RestActivityCopy {
  static let workoutActive: LocalizedStringKey = "workout_activity_active"
  static let restTitle: LocalizedStringKey = "rest_activity_lock_screen_title"
  static let expandedRestTitle: LocalizedStringKey = "rest_activity_title"
  static let nextSet: LocalizedStringKey = "rest_activity_next_set"
  static let nextExercise: LocalizedStringKey = "rest_activity_next_exercise"
  static let returnToWorkout: LocalizedStringKey = "rest_activity_return_to_workout"
  static let tapToContinue: LocalizedStringKey = "rest_activity_tap_to_continue"
  static let finishRest: LocalizedStringKey = "rest_activity_finish_rest"
  static let addSeconds: LocalizedStringKey = "rest_activity_add_seconds"
  static let nextLabel: LocalizedStringKey = "rest_activity_next_label"
  static let backToWorkout: LocalizedStringKey = "rest_activity_back_to_workout"
  static let timeAccessibility: LocalizedStringKey = "rest_activity_time_accessibility"
  static let cardioTitle: LocalizedStringKey = "cardio_activity_title"
  static let cardioPaused: LocalizedStringKey = "cardio_activity_paused"
  static let cardioCompleted: LocalizedStringKey = "cardio_activity_completed"
  static let finishWorkout: LocalizedStringKey = "cardio_activity_finish_workout"
  static let cardioTimeAccessibility: LocalizedStringKey = "cardio_activity_time_accessibility"

  /// "Série: X/Y" — the set the user is about to perform, during rest.
  static func nextSeries(_ number: Int, _ total: Int) -> String {
    String(format: String(localized: "rest_activity_next_series_format"), number, total)
  }

  /// "Série X/Y" — the same set, once the rest is over.
  static func currentSeries(_ number: Int, _ total: Int) -> String {
    String(format: String(localized: "rest_activity_current_series_format"), number, total)
  }

  static func series(_ setIndex: Int, _ totalSets: Int) -> String {
    String(format: String(localized: "rest_activity_series_format"), setIndex, totalSets)
  }
}

private func cardioRemainingText(
  _ state: AJFitRestActivityAttributes.ContentState
) -> String {
  let seconds = max(0, Int(state.timerEndsAt.timeIntervalSince(state.startedAt).rounded(.down)))
  let hours = seconds / 3_600
  let minutes = (seconds % 3_600) / 60
  let remainder = seconds % 60
  return hours > 0
    ? String(format: "%d:%02d:%02d", hours, minutes, remainder)
    : String(format: "%d:%02d", minutes, remainder)
}

private struct AJFitLogo: View {
  /// Defaults to the Lock Screen size; the Dynamic Island passes a smaller one.
  var size: CGFloat = 24

  var body: some View {
    Image("AJFitLogo", bundle: .main)
      .renderingMode(.original)
      .resizable()
      .scaledToFit()
      .frame(width: size, height: size)
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
      timerInterval: state.timerRange,
      countsDown: true,
      showsHours: false
    )
    .font(.system(size: 42, weight: .bold, design: .monospaced))
    .monospacedDigit()
    .foregroundStyle(.white)
    .accessibilityLabel(Text(RestActivityCopy.timeAccessibility))
  }
}

/// Lock-Screen-sized countdown, smaller than the Dynamic Island's
/// `RestCountdownText` so the rest card's other blocks keep their room.
///
/// NEVER apply `.fixedSize()` here. Proven on device by binary isolation:
/// `.minimal` rendered, `.header` rendered, and adding this view with
/// `.fixedSize()` blanked the ENTIRE card (background drawn, zero content);
/// the identical view without `.fixedSize()` renders and counts down
/// correctly. `Text(timerInterval:)` is system-driven, so asking it for an
/// ideal size takes the whole widget render down with it.
private struct RestLockScreenCountdownText: View {
  let state: AJFitRestActivityAttributes.ContentState
  /// Defaults to the Lock Screen size; the Dynamic Island passes a smaller one.
  var size: CGFloat = 30

  var body: some View {
    Text(
      timerInterval: state.timerRange,
      countsDown: true,
      showsHours: false
    )
    .font(.system(size: size, weight: .bold, design: .rounded))
    .monospacedDigit()
    .lineLimit(1)
    .foregroundStyle(.white)
    .accessibilityLabel(Text(RestActivityCopy.timeAccessibility))
  }
}

/// Session elapsed time for the header's trailing slot — the reference's
/// `3:05`. This is the WORKOUT's elapsed time, not this rest's duration, so
/// it counts UP from `workoutStartedAt`. Rendered only when that value was
/// carried; older Activities omit the slot instead of showing a wrong number.
/// Same rule as the countdown: no `.fixedSize()`.
private struct WorkoutElapsedText: View {
  let range: ClosedRange<Date>

  var body: some View {
    Text(timerInterval: range, countsDown: false, showsHours: false)
      .font(.system(size: 12, weight: .regular, design: .rounded))
      .monospacedDigit()
      .lineLimit(1)
      .foregroundStyle(.white.opacity(0.45))
  }
}

/// Live-updating without any native timer — `ProgressView(timerInterval:)`
/// is the system-ticking sibling of the `Text(timerInterval:)` the countdown
/// above already relies on; the system animates it toward empty on its own.
///
/// BOTH labels must be passed explicitly as `EmptyView`. The bare
/// `init(timerInterval:countsDown:)` resolves to the SwiftUI overload
/// constrained to `CurrentValueLabel == DefaultDateProgressLabel`, which
/// renders a SECOND countdown under the bar — the duplicate timer this card
/// must not have.
private struct RestLinearProgressBar: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    ProgressView(
      timerInterval: state.timerRange,
      countsDown: true
    ) {
      EmptyView()
    } currentValueLabel: {
      EmptyView()
    }
      .progressViewStyle(.linear)
      .tint(ajFitBlue)
      .accessibilityHidden(true)
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
      timerInterval: state.timerRange,
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
      timerInterval: state.timerRange,
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
        Text(timerInterval: state.timerRange, countsDown: true, showsHours: false)
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

/// The blue-circled "next" affordance, for every compact/minimal slot that
/// has no countdown to show. One component, one style — the former
/// `NextSet*`/`NextExercise*` pairs only differed by a text label that the
/// compact region should never have carried.
private struct NextActionCompactIcon: View {
  let phase: RestActivityPhase

  var body: some View {
    RestAdvanceIndicator(
      size: 20,
      accessibilityLabel: phase == .nextExercise
        ? RestActivityCopy.nextExercise
        : RestActivityCopy.nextSet
    )
  }
}

/// Hairline divider drawn as a fixed-color `Rectangle` rather than the
/// system `Divider()` — the latter's color isn't reliably visible against
/// this card's near-black background across contexts.
private struct RestHairlineDivider: View {
  var body: some View {
    Rectangle()
      .fill(Color.white.opacity(0.12))
      .frame(height: 1)
  }
}

/// Footer action label. The vertical padding, `.frame(maxWidth: .infinity)`
/// and `.contentShape` all live HERE, inside the button's own label, so the
/// entire half of the footer — not just the glyphs — is tappable. Applied to
/// the `Button` from the outside instead, the frame expands the laid-out
/// result while the hit region stays glued to the text.
///
/// The padding is what makes these comfortably tappable: the text is ~17pt
/// tall, so 11pt above and below brings each action to roughly a 40pt touch
/// height across the full half-width.
private struct RestFooterActionLabel: View {
  let systemImage: String
  let title: LocalizedStringKey
  let tint: Color
  /// Defaults to the Lock Screen's touch height; the Dynamic Island trims it
  /// slightly to fit its tighter budget while staying comfortably tappable.
  var verticalPadding: CGFloat = 10

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: systemImage)
        .font(.system(size: 13, weight: .bold))
      Text(title)
        .font(.system(size: 14, weight: .semibold, design: .rounded))
        .lineLimit(1)
        .minimumScaleFactor(0.85)
    }
    .foregroundStyle(tint)
    .padding(.vertical, verticalPadding)
    .frame(maxWidth: .infinity)
    .contentShape(Rectangle())
  }
}

private struct RestAddSecondsButton: View {
  let sessionId: String
  var verticalPadding: CGFloat = 10

  var body: some View {
    if #available(iOS 17.0, *) {
      Button(intent: AJFitAddRestSecondsIntent(sessionId: sessionId)) {
        RestFooterActionLabel(
          systemImage: "plus.circle.fill",
          title: RestActivityCopy.addSeconds,
          tint: .white.opacity(0.92),
          verticalPadding: verticalPadding
        )
      }
      .buttonStyle(.plain)
    } else {
      // iOS 16.4–16.x Live Activities cannot run an intent in place, so the
      // slot stays non-interactive rather than rendering a button that
      // silently does nothing. The in-app "+15s" is unaffected.
      RestFooterActionLabel(
        systemImage: "plus.circle.fill",
        title: RestActivityCopy.addSeconds,
        tint: .white.opacity(0.35),
        verticalPadding: verticalPadding
      )
    }
  }
}

private struct RestFinishButton: View {
  let sessionId: String
  var verticalPadding: CGFloat = 10

  var body: some View {
    if #available(iOS 17.0, *) {
      Button(intent: AJFitFinishRestIntent(sessionId: sessionId)) {
        RestFooterActionLabel(
          systemImage: "forward.end.fill",
          title: RestActivityCopy.finishRest,
          tint: ajFitBlue,
          verticalPadding: verticalPadding
        )
      }
      .buttonStyle(.plain)
    } else {
      // iOS 16.4–16.x Live Activities cannot run an intent in place; the
      // whole card's `widgetURL` (below) remains the way back into the app
      // to end rest there, same as every other state already does.
      RestFooterActionLabel(
        systemImage: "forward.end.fill",
        title: RestActivityCopy.finishRest,
        tint: ajFitBlue,
        verticalPadding: verticalPadding
      )
    }
  }
}

/// Blocks 2–8 of the approved rest card, shared verbatim by the Lock Screen
/// and the Dynamic Island's expanded bottom region. A `@ViewBuilder` function
/// returns a `TupleView`, so dropping it into the caller's `VStack` lays out
/// exactly as if the blocks had been written inline — the Dynamic Island
/// reuses the approved design instead of a second copy that could drift.
@ViewBuilder
private func restCardBlocks(
  state: AJFitRestActivityAttributes.ContentState,
  sessionId: String
) -> some View {
      // 2 — STATUS
      Text(RestActivityCopy.restTitle)
        .font(.system(size: 11, weight: .heavy, design: .rounded))
        .kerning(0.6)
        .foregroundStyle(ajFitBlue)
        .padding(.top, 4)
      // 3 — TIMER (never `.fixedSize()` — see RestLockScreenCountdownText)
      RestLockScreenCountdownText(state: state)
      // 4 — PROGRESS
      RestLinearProgressBar(state: state)
        .padding(.top, 4)
      // 5 — "Próximo" + exercise on one line, as in the reference. Dropped
      // whole when the exercise is unknown rather than leaving a bare label.
      if !state.upcomingExerciseName.isEmpty {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(RestActivityCopy.nextLabel)
            .font(.system(size: 11, weight: .regular, design: .rounded))
            .foregroundStyle(.white.opacity(0.5))
            .layoutPriority(1)
          Text(state.upcomingExerciseName)
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
            .truncationMode(.tail)
            .minimumScaleFactor(0.85)
        }
        .padding(.top, 5)
      }
      // 6 — Secondary line: the series about to be performed, plus the load
      // registered on the set that just finished. They share one line so the
      // new information costs no extra height; each half is independently
      // omitted (never "0 kg", never a placeholder dash).
      if state.upcomingSeries != nil || state.lastSetLoadLabel != nil {
        HStack(spacing: 5) {
          if let series = state.upcomingSeries {
            Text(RestActivityCopy.nextSeries(series.number, series.total))
          }
          if state.upcomingSeries != nil && state.lastSetLoadLabel != nil {
            Text(verbatim: "·")
          }
          if let lastSetLoadLabel = state.lastSetLoadLabel {
            Text(lastSetLoadLabel)
          }
        }
        .font(.system(size: 11, weight: .regular, design: .rounded))
        .foregroundStyle(.white.opacity(0.5))
        .lineLimit(1)
        .padding(.top, 1)
      }
      // 7 — DIVIDER
      RestHairlineDivider()
        .padding(.top, 5)
      // 8 — FOOTER: exactly two actions, split by a vertical rule.
      HStack(spacing: 0) {
        RestAddSecondsButton(sessionId: sessionId)
        Rectangle()
          .fill(Color.white.opacity(0.16))
          .frame(width: 1, height: 26)
        RestFinishButton(sessionId: sessionId)
      }
}

/// Blocks 2–4 of the approved in-workout card, shared the same way.
@ViewBuilder
private func inWorkoutCardBlocks(
  state: AJFitRestActivityAttributes.ContentState
) -> some View {
      // 2 — "Próximo" + exercise. Same weight as the rest card's line, not an
      // oversized standalone title.
      if !state.upcomingExerciseName.isEmpty {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(RestActivityCopy.nextLabel)
            .font(.system(size: 11, weight: .regular, design: .rounded))
            .foregroundStyle(.white.opacity(0.5))
            .layoutPriority(1)
          Text(state.upcomingExerciseName)
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
            .truncationMode(.tail)
            .minimumScaleFactor(0.85)
        }
        .padding(.top, 8)
      }
      // 3 — The series about to be performed.
      if let series = state.upcomingSeries {
        Text(RestActivityCopy.currentSeries(series.number, series.total))
          .font(.system(size: 12, weight: .regular, design: .rounded))
          .foregroundStyle(.white.opacity(0.5))
          .lineLimit(1)
          .padding(.top, 2)
      }
      // 4 — Single action. No "Concluir série", no load/reps editing.
      RestHairlineDivider()
        .padding(.top, 8)
      BackToWorkoutButton()
}

/// Button that returns to the workout screen. Deliberately a `Link`, not an
/// intent: "go back to the app" is navigation, not workout mutation, and the
/// card's existing `widgetURL` deep link already resolves this exact route.
/// Reuses `RestFooterActionLabel`, so it inherits the rest card's footer
/// styling and its full-width padded touch target unchanged.
private struct BackToWorkoutButton: View {
  var verticalPadding: CGFloat = 10

  var body: some View {
    Link(destination: activeWorkoutURL) {
      RestFooterActionLabel(
        systemImage: "arrow.up.right",
        title: RestActivityCopy.backToWorkout,
        tint: ajFitBlue,
        verticalPadding: verticalPadding
      )
    }
  }
}

private struct RestingLockScreenView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let sessionId: String

  /// Compact by construction: `spacing: 0` with an explicit padding per gap
  /// keeps the vertical rhythm auditable instead of letting one stack spacing
  /// inflate every gap at once. No fixed height anywhere — the system sizes
  /// the Lock Screen card from this content.
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // 1 — HEADER: logo + workout name, workout elapsed time trailing.
      //
      // `Text(timerInterval:)` reserves the width of its widest possible
      // value. Giving the elapsed time `.layoutPriority(1)` therefore let it
      // claim that width FIRST and starved the workout name down to zero —
      // the header read as "[logo] 22:07" with the name invisible rather than
      // truncated. The name now holds the priority and the elapsed time is
      // bounded by an explicit width, which is the same pattern
      // `RestingCompactLeadingView` already uses successfully on device.
      // (An explicit `.frame(width:)` is NOT `.fixedSize()` — it hands the
      // timer a concrete width instead of asking it to compute an ideal one.)
      HStack(spacing: 6) {
        AJFitLogo()
        if !state.workoutName.isEmpty {
          Text(state.workoutName)
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
            .truncationMode(.tail)
            .layoutPriority(1)
        }
        Spacer(minLength: 6)
        if let workoutElapsedRange = state.workoutElapsedRange {
          WorkoutElapsedText(range: workoutElapsedRange)
            .frame(width: 54, alignment: .trailing)
        }
      }
      restCardBlocks(state: state, sessionId: sessionId)
    }
  }
}

/// Covers every "no rest running" phase — the initial workout and both forms
/// of "rest just ended" (`.nextSet` continues the same exercise,
/// `.nextExercise` moves to a new one).
private struct InWorkoutLockScreenView: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // 1 — HEADER: identical to the rest card's, including the elapsed time.
      HStack(spacing: 6) {
        AJFitLogo()
        if !state.workoutName.isEmpty {
          Text(state.workoutName)
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
            .truncationMode(.tail)
            .layoutPriority(1)
        }
        Spacer(minLength: 6)
        if let workoutElapsedRange = state.workoutElapsedRange {
          WorkoutElapsedText(range: workoutElapsedRange)
            .frame(width: 54, alignment: .trailing)
        }
      }
      inWorkoutCardBlocks(state: state)
    }
  }
}

private struct RestLockScreenView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase
  let sessionId: String

  var body: some View {
    Group {
      switch phase {
      case .workoutActive, .nextSet, .nextExercise:
        InWorkoutLockScreenView(state: state)
      case .resting:
        RestingLockScreenView(state: state, sessionId: sessionId)
      case .cardioRunning, .cardioPaused, .cardioCompleted:
        CardioLockScreenView(state: state, phase: phase)
      }
    }
    .padding(.horizontal, 14)
    .padding(.top, 9)
    .padding(.bottom, 4)
    .widgetURL(activeWorkoutURL)
  }
}

/// Expanded leading — the card's identity, same primitives as the Lock Screen
/// header's left side (logo + workout name), at Dynamic Island scale.
private struct ExpandedLeadingView: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 6) {
      AJFitLogo(size: 22)
      if !state.workoutName.isEmpty {
        Text(state.workoutName)
          .font(.system(size: 13, weight: .semibold, design: .rounded))
          .foregroundStyle(.white)
          .lineLimit(1)
          .truncationMode(.tail)
      }
    }
  }
}

/// Expanded trailing — session elapsed time, the same value and treatment as
/// the Lock Screen header's right side. Cardio keeps its status glyph.
private struct ExpandedTrailingView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    Group {
      switch phase {
      case .cardioRunning, .cardioPaused, .cardioCompleted:
        CardioStatusIcon(phase: phase, size: 20)
      case .workoutActive, .resting, .nextSet, .nextExercise:
        if let workoutElapsedRange = state.workoutElapsedRange {
          WorkoutElapsedText(range: workoutElapsedRange)
            .frame(width: 54, alignment: .trailing)
        }
      }
    }
  }
}

/// Expanded center shares its row with leading and trailing, so it stays
/// empty for rest/workout — their content is full-width and belongs in
/// `.bottom`. Only cardio, which has no bottom composition, uses it.
private struct ExpandedCenterView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    Group {
      switch phase {
      case .cardioRunning, .cardioPaused:
        CardioTimerText(state: state, compact: false)
      case .cardioCompleted:
        Text(RestActivityCopy.cardioCompleted)
          .font(.system(size: 20, weight: .bold, design: .rounded))
          .foregroundStyle(.white)
      case .workoutActive, .resting, .nextSet, .nextExercise:
        EmptyView()
      }
    }
  }
}

/// Dynamic Island expanded content for a running rest.
///
/// Deliberately NOT `restCardBlocks`. That stack costs ~143pt and the island's
/// bottom region only has ~135pt once the leading/trailing row is paid for, so
/// reusing it pushed the footer actions — the last children — out of the
/// visible area entirely (the series line was already clipping). Same
/// components, same data, same styling; the arrangement is what differs:
/// status+countdown and next-exercise+series sit side by side instead of
/// stacked, which buys back the ~45pt the actions need.
private struct ExpandedRestingContent: View {
  let state: AJFitRestActivityAttributes.ContentState
  let sessionId: String

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // The status/countdown column is width-BOUNDED rather than
      // layout-prioritised. `Text(timerInterval:)` reserves the width of its
      // widest possible value, so giving it priority let it claim that width
      // first and shove the next-exercise column off the right edge — the
      // same starvation that once hid the workout name in the header. An
      // explicit width is the pattern already proven safe here (it is NOT
      // `.fixedSize()`, which asks the timer to compute an ideal size).
      HStack(alignment: .top, spacing: 8) {
        VStack(alignment: .leading, spacing: 0) {
          Text(RestActivityCopy.restTitle)
            .font(.system(size: 11, weight: .heavy, design: .rounded))
            .kerning(0.6)
            .foregroundStyle(ajFitBlue)
            .lineLimit(1)
          RestLockScreenCountdownText(state: state, size: 26)
        }
        .frame(width: 74, alignment: .leading)
        // No `Spacer` and leading alignment: the column starts right after the
        // countdown instead of being pushed against the card's right edge.
        VStack(alignment: .leading, spacing: 1) {
          if !state.upcomingExerciseName.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
              Text(RestActivityCopy.nextLabel)
                .font(.system(size: 10, weight: .regular, design: .rounded))
                .foregroundStyle(.white.opacity(0.5))
                .lineLimit(1)
              // The variable-length part is the one that must flex and
              // truncate; the fixed label keeps its natural size.
              Text(state.upcomingExerciseName)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .truncationMode(.tail)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
          }
          if let series = state.upcomingSeries {
            Text(RestActivityCopy.currentSeries(series.number, series.total))
              .font(.system(size: 10, weight: .regular, design: .rounded))
              .foregroundStyle(.white.opacity(0.5))
              .lineLimit(1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      RestLinearProgressBar(state: state)
        .padding(.top, 5)
      HStack(spacing: 0) {
        RestAddSecondsButton(sessionId: sessionId, verticalPadding: 8)
        Rectangle()
          .fill(Color.white.opacity(0.16))
          .frame(width: 1, height: 22)
        RestFinishButton(sessionId: sessionId, verticalPadding: 8)
      }
      .padding(.top, 1)
    }
  }
}

/// Same reasoning as `ExpandedRestingContent`, for the post-rest state.
private struct ExpandedInWorkoutContent: View {
  let state: AJFitRestActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if !state.upcomingExerciseName.isEmpty {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(RestActivityCopy.nextLabel)
            .font(.system(size: 11, weight: .regular, design: .rounded))
            .foregroundStyle(.white.opacity(0.5))
            .layoutPriority(1)
          Text(state.upcomingExerciseName)
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
            .truncationMode(.tail)
            .minimumScaleFactor(0.85)
        }
      }
      if let series = state.upcomingSeries {
        Text(RestActivityCopy.currentSeries(series.number, series.total))
          .font(.system(size: 12, weight: .regular, design: .rounded))
          .foregroundStyle(.white.opacity(0.5))
          .lineLimit(1)
          .padding(.top, 1)
      }
      BackToWorkoutButton(verticalPadding: 8)
        .padding(.top, 2)
    }
  }
}

/// Expanded bottom is the only full-width region, so the action-bearing
/// content goes here.
private struct ExpandedBottomView: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase
  let sessionId: String

  var body: some View {
    switch phase {
    case .resting:
      ExpandedRestingContent(state: state, sessionId: sessionId)
    case .workoutActive, .nextSet, .nextExercise:
      ExpandedInWorkoutContent(state: state)
    case .cardioRunning, .cardioPaused, .cardioCompleted:
      VStack(spacing: 4) {
        Text(state.exerciseName)
          .font(.system(size: 15, weight: .semibold, design: .rounded))
          .foregroundStyle(.white)
          .lineLimit(1)
          .minimumScaleFactor(0.72)
        Text(
          phase == .cardioPaused
            ? RestActivityCopy.cardioPaused
            : phase == .cardioCompleted
              ? RestActivityCopy.finishWorkout
              : RestActivityCopy.returnToWorkout
        )
          .font(.system(size: 11, weight: .medium, design: .rounded))
          .foregroundStyle(.white.opacity(0.58))
      }
    }
  }
}

struct AJFitRestActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AJFitRestActivityAttributes.self) { context in
      let phase = context.state.presentationPhase(isStale: context.isStale)
      RestLockScreenView(state: context.state, phase: phase, sessionId: context.attributes.sessionId)
        .activityBackgroundTint(ajFitBackground)
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let phase = context.state.presentationPhase(isStale: context.isStale)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ExpandedLeadingView(state: context.state)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ExpandedTrailingView(state: context.state, phase: phase)
        }
        DynamicIslandExpandedRegion(.center) {
          ExpandedCenterView(state: context.state, phase: phase)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ExpandedBottomView(
            state: context.state,
            phase: phase,
            sessionId: context.attributes.sessionId
          )
        }
      } compactLeading: {
        // Only a running countdown earns the compact leading slot. Every other
        // state shows the logo — the former "AJ FIT"/"PROX. EX." labels were
        // text the compact region is too small to carry legibly.
        switch phase {
        case .resting:
          RestingCompactLeadingView(state: context.state)
        case .cardioRunning, .cardioPaused:
          CardioTimerText(state: context.state, compact: true)
            .frame(width: 48, alignment: .leading)
        case .workoutActive, .nextSet, .nextExercise, .cardioCompleted:
          AJFitLogo(size: 21)
        }
      } compactTrailing: {
        switch phase {
        case .resting:
          RestingCompactTrailingView(state: context.state)
        case .workoutActive, .nextSet, .nextExercise:
          NextActionCompactIcon(phase: phase)
        case .cardioRunning, .cardioPaused, .cardioCompleted:
          CardioStatusIcon(phase: phase, size: 19)
        }
      } minimal: {
        switch phase {
        case .resting:
          RestingMinimalView(state: context.state)
        case .cardioRunning, .cardioPaused:
          CardioTimerText(state: context.state, compact: true)
        case .cardioCompleted:
          CardioStatusIcon(phase: phase, size: 19)
        case .workoutActive, .nextSet, .nextExercise:
          NextActionCompactIcon(phase: phase)
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
      startedAt: start, endsAt: end, workoutName: "Treino 02 - Full body", exerciseName: "Supino reto máquina",
      setIndex: setIndex, totalSets: totalSets, phase: .resting,
      nextAction: .nextSet, nextSetIndex: nextSetIndex
    )
  }

  static let restingNextExercise = AJFitRestActivityAttributes.ContentState(
      startedAt: start, endsAt: end, workoutName: "Treino 02 - Full body", exerciseName: "Supino reto máquina",
      setIndex: 4, totalSets: 4, phase: .resting,
      nextAction: .nextExercise, nextExerciseName: "Puxada alta"
    )

  static func nextSet(setIndex: Int, totalSets: Int) -> AJFitRestActivityAttributes.ContentState {
    .init(
      startedAt: start, endsAt: end, workoutName: "Treino 02 - Full body", exerciseName: "Supino reto máquina",
      setIndex: setIndex - 1, totalSets: totalSets, phase: .nextSet,
      nextAction: .nextSet, nextSetIndex: setIndex
    )
  }

  static let nextExercise = AJFitRestActivityAttributes.ContentState(
    startedAt: start, endsAt: end, workoutName: "Treino 02 - Full body", exerciseName: "Supino reto máquina",
    setIndex: 4, totalSets: 4, phase: .nextExercise,
    nextAction: .nextExercise, nextExerciseName: "Puxada alta"
  )

  /// Reference composition: still mid-exercise, so "Próximo" repeats the
  /// current exercise, and the set that just finished carries a load.
  static let restingWithLoad = AJFitRestActivityAttributes.ContentState(
    startedAt: start, endsAt: end,
    workoutStartedAt: Date(timeIntervalSinceNow: -185),
    workoutName: "Treino 02 - Full body",
    exerciseName: "Remada iso-lateral na máquina", lastSetLoadLabel: "20 kg",
    setIndex: 1, totalSets: 3, phase: .resting,
    nextAction: .nextSet, nextSetIndex: 2
  )

  /// No load was registered for the completed set — the line must disappear,
  /// never render "0 kg".
  static let restingWithoutLoad = AJFitRestActivityAttributes.ContentState(
    startedAt: start, endsAt: end, workoutName: "Treino 02 - Full body",
    exerciseName: "Remada iso-lateral na máquina",
    setIndex: 1, totalSets: 3, phase: .resting,
    nextAction: .nextSet, nextSetIndex: 2
  )

  /// What an Activity started by a pre-`workoutName` build now decodes to.
  /// This is the case that used to render as a completely empty card; it must
  /// still produce a readable card.
  static let restingLegacyDecode = AJFitRestActivityAttributes.ContentState(
    startedAt: start, endsAt: end, workoutName: "",
    exerciseName: "Remada iso-lateral na máquina",
    setIndex: 1, totalSets: 3, phase: .resting,
    nextAction: .nextSet, nextSetIndex: 2
  )

  /// Expired/already-elapsed rest: the countdown interval collapses rather
  /// than inverting, so `timerRange` must stay a valid ClosedRange.
  static let restingExpired = AJFitRestActivityAttributes.ContentState(
    startedAt: Date(timeIntervalSinceNow: -120), endsAt: Date(timeIntervalSinceNow: -60),
    workoutName: "Treino 02 - Full body", exerciseName: "Remada iso-lateral na máquina",
    lastSetLoadLabel: "20 kg",
    setIndex: 1, totalSets: 3, phase: .resting,
    nextAction: .nextSet, nextSetIndex: 2
  )

  /// Pathological `endsAt` BEFORE `startedAt` — the reversed-range trap that
  /// would crash the extension and blank the card if built inline.
  static let restingInvertedInterval = AJFitRestActivityAttributes.ContentState(
    startedAt: Date(timeIntervalSinceNow: 60), endsAt: Date(timeIntervalSinceNow: -60),
    workoutName: "Treino 02 - Full body", exerciseName: "Remada iso-lateral na máquina",
    setIndex: 1, totalSets: 3, phase: .resting,
    nextAction: .nextSet, nextSetIndex: 2
  )
}

private struct CompactPreview: View {
  let state: AJFitRestActivityAttributes.ContentState
  let phase: RestActivityPhase

  var body: some View {
    HStack(spacing: 42) {
      switch phase {
      case .resting: RestingCompactLeadingView(state: state)
      case .cardioRunning, .cardioPaused:
        CardioTimerText(state: state, compact: true)
      case .workoutActive, .nextSet, .nextExercise, .cardioCompleted:
        AJFitLogo(size: 21)
      }
      switch phase {
      case .resting: RestingCompactTrailingView(state: state)
      case .workoutActive, .nextSet, .nextExercise:
        NextActionCompactIcon(phase: phase)
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
        leading: AnyView(AJFitLogo(size: 21)),
        trailing: AnyView(NextActionCompactIcon(phase: .nextSet))
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
        ExpandedLeadingView(state: state)
        Spacer()
        ExpandedTrailingView(state: state, phase: phase)
      }
      ExpandedCenterView(state: state, phase: phase)
      ExpandedBottomView(state: state, phase: phase, sessionId: "preview-session")
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
        phase: .resting, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("resting 1/4")
      RestLockScreenView(
        state: RestActivityPreviewData.restingNextSet(
          setIndex: 3, totalSets: 4, nextSetIndex: 4
        ),
        phase: .resting, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("resting 3/4")
      RestLockScreenView(state: RestActivityPreviewData.restingNextExercise, phase: .resting, sessionId: "preview-session")
        .background(ajFitBackground).previewDisplayName("resting 4/4")
      RestLockScreenView(
        state: RestActivityPreviewData.nextSet(setIndex: 2, totalSets: 4),
        phase: .nextSet, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("next_set 2/4")
      RestLockScreenView(
        state: RestActivityPreviewData.nextSet(setIndex: 3, totalSets: 4),
        phase: .nextSet, sessionId: "preview-session"
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
        phase: .resting, sessionId: "preview-session"
      )
        .background(ajFitBackground).previewDisplayName("Lock Screen resting")
      RestLockScreenView(state: RestActivityPreviewData.nextSet(setIndex: 3, totalSets: 4), phase: .nextSet, sessionId: "preview-session")
        .background(ajFitBackground).previewDisplayName("Lock Screen next_set")
      RestLockScreenView(state: RestActivityPreviewData.nextExercise, phase: .nextExercise, sessionId: "preview-session")
        .background(ajFitBackground).previewDisplayName("Lock Screen next_exercise")

      // Reference composition and the degraded states that must never blank.
      RestLockScreenView(
        state: RestActivityPreviewData.restingWithLoad, phase: .resting, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("rest reference — next_set + load")
      RestLockScreenView(
        state: RestActivityPreviewData.restingWithoutLoad, phase: .resting, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("rest — no load line")
      RestLockScreenView(
        state: RestActivityPreviewData.restingNextExercise, phase: .resting, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("rest — next_exercise")
      RestLockScreenView(
        state: RestActivityPreviewData.restingLegacyDecode, phase: .resting, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("rest — legacy decode, no workoutName")
      RestLockScreenView(
        state: RestActivityPreviewData.restingExpired, phase: .resting, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("rest — expired timer")
      RestLockScreenView(
        state: RestActivityPreviewData.restingInvertedInterval, phase: .resting, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("rest — inverted interval (clamped)")
      RestLockScreenView(
        state: RestActivityPreviewData.restingWithLoad, phase: .nextSet, sessionId: "preview-session"
      ).background(ajFitBackground).previewDisplayName("in-workout — after finishing rest")
    }
    .previewLayout(.sizeThatFits)
  }

}
#endif
