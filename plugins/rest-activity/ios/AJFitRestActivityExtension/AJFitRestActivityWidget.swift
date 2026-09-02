import ActivityKit
import SwiftUI
import WidgetKit

private let activeWorkoutURL = URL(string: "ajfit://workout/active")!
private let ajFitBlue = Color(red: 0.16, green: 0.50, blue: 1.00)
private let ajFitBackground = Color(red: 0.01, green: 0.00, blue: 0.07)

private enum RestActivityCopy {
  static let title: LocalizedStringKey = "rest_activity_title"
  static let lockScreenTitle: LocalizedStringKey = "rest_activity_lock_screen_title"
  static let returnToWorkout: LocalizedStringKey = "rest_activity_return_to_workout"
  static let timeAccessibility: LocalizedStringKey = "rest_activity_time_accessibility"
  static let completedAccessibility: LocalizedStringKey =
    "rest_activity_completed_accessibility"

  static func series(_ setIndex: Int, _ totalSets: Int) -> String {
    String(
      format: String(localized: "rest_activity_series_format"),
      setIndex,
      totalSets
    )
  }
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

  private var safeTotalSets: Int {
    max(totalSets, 1)
  }

  private var safeCurrentSet: Int {
    min(max(currentSet, 0), safeTotalSets)
  }

  private var lineWidth: CGFloat {
    max(1.5, size * 0.09)
  }

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
    if index + 1 == safeCurrentSet {
      return ajFitBlue
    }
    if index < safeCurrentSet {
      return ajFitBlue.opacity(0.68)
    }
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
    Group {
      if state.isResting {
        Text(
          timerInterval: state.startedAt...state.endsAt,
          countsDown: true,
          showsHours: false
        )
      } else {
        Text("0:00")
      }
    }
    .font(
      .system(
        size: 42,
        weight: .bold,
        design: .monospaced
      )
    )
    .monospacedDigit()
    .foregroundStyle(.white)
    .accessibilityLabel(
      Text(
        state.isResting
          ? RestActivityCopy.timeAccessibility
          : RestActivityCopy.completedAccessibility
      )
    )
  }
}

private struct RestLockScreenView: View {
  let context: ActivityViewContext<AJFitRestActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        AJFitLogo()
        Text(RestActivityCopy.lockScreenTitle)
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .foregroundStyle(ajFitBlue)
        Spacer()
        RestSetProgressRing(
          currentSet: context.state.setIndex,
          totalSets: context.state.totalSets,
          size: 20
        )
        Text(RestActivityCopy.series(context.state.setIndex, context.state.totalSets))
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .foregroundStyle(.white.opacity(0.72))
      }

      RestCountdownText(state: context.state)

      Text(context.state.exerciseName)
        .font(.system(size: 17, weight: .semibold, design: .rounded))
        .foregroundStyle(.white)
        .lineLimit(1)
        .minimumScaleFactor(0.75)

      HStack(spacing: 6) {
        Image(systemName: "arrow.up.right.circle.fill")
        Text(RestActivityCopy.returnToWorkout)
      }
      .font(.system(size: 12, weight: .medium, design: .rounded))
      .foregroundStyle(.white.opacity(0.62))
    }
    .padding(16)
    .widgetURL(activeWorkoutURL)
  }
}

struct AJFitRestActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AJFitRestActivityAttributes.self) { context in
      RestLockScreenView(context: context)
        .activityBackgroundTint(ajFitBackground)
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 7) {
            RestSetProgressRing(
              currentSet: context.state.setIndex,
              totalSets: context.state.totalSets,
              size: 24
            )
            Text(RestActivityCopy.title)
              .font(.system(size: 12, weight: .bold, design: .rounded))
              .foregroundStyle(ajFitBlue)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(RestActivityCopy.series(context.state.setIndex, context.state.totalSets))
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundStyle(.white.opacity(0.72))
        }
        DynamicIslandExpandedRegion(.center) {
          RestCountdownText(state: context.state)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 5) {
            Text(context.state.exerciseName)
              .font(.system(size: 16, weight: .semibold, design: .rounded))
              .foregroundStyle(.white)
              .lineLimit(1)
              .minimumScaleFactor(0.72)
            Text(RestActivityCopy.returnToWorkout)
              .font(.system(size: 11, weight: .medium, design: .rounded))
              .foregroundStyle(.white.opacity(0.58))
          }
        }
      } compactLeading: {
        RestSetProgressRing(
          currentSet: context.state.setIndex,
          totalSets: context.state.totalSets,
          size: 24
        )
      } compactTrailing: {
        Group {
          if context.state.isResting {
            Text(
              timerInterval: context.state.startedAt...context.state.endsAt,
              countsDown: true,
              showsHours: false
            )
          } else {
            Text("0:00")
          }
        }
        .font(.system(size: 16, weight: .semibold, design: .monospaced))
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: 40, alignment: .trailing)
        .foregroundStyle(.white)
        .accessibilityLabel(
          Text(
            context.state.isResting
              ? RestActivityCopy.timeAccessibility
              : RestActivityCopy.completedAccessibility
          )
        )
      } minimal: {
        RestSetProgressRing(
          currentSet: context.state.setIndex,
          totalSets: context.state.totalSets,
          size: 20
        )
      }
      .widgetURL(activeWorkoutURL)
    }
  }
}

#if DEBUG
private struct RestSetProgressRingPreviews: PreviewProvider {
  static var previews: some View {
    Group {
      preview(currentSet: 1, totalSets: 4)
        .previewDisplayName("1 / 4")
      preview(currentSet: 2, totalSets: 4)
        .previewDisplayName("2 / 4")
      preview(currentSet: 3, totalSets: 4)
        .previewDisplayName("3 / 4")
      preview(currentSet: 4, totalSets: 4)
        .previewDisplayName("4 / 4")
      preview(currentSet: 1, totalSets: 3)
        .previewDisplayName("1 / 3")
      preview(currentSet: 3, totalSets: 3)
        .previewDisplayName("3 / 3")
    }
  }

  private static func preview(currentSet: Int, totalSets: Int) -> some View {
    RestSetProgressRing(
      currentSet: currentSet,
      totalSets: totalSets,
      size: 40
    )
    .padding(12)
    .background(ajFitBackground)
    .previewLayout(.sizeThatFits)
  }
}
#endif
