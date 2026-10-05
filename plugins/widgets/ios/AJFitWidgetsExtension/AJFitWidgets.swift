import SwiftUI
import WidgetKit
import CoreText

private enum AJFitColors {
  static let background = Color(red: 2/255, green: 0, blue: 16/255)
  static let surface = Color.white.opacity(0.04)
  static let border = Color.white.opacity(0.07)
  static let primary = Color(red: 11/255, green: 112/255, blue: 249/255)
  static let primaryEmphasis = Color(red: 77/255, green: 163/255, blue: 255/255)
  static let success = Color(red: 34/255, green: 197/255, blue: 94/255)
  static let warning = Color(red: 255/255, green: 168/255, blue: 64/255)
}

struct AJFitWidgetEntry: TimelineEntry {
  let date: Date
  let content: AJFitWidgetContent
}

struct AJFitWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> AJFitWidgetEntry {
    AJFitWidgetEntry(date: Date(), content: .empty(.unavailable))
  }

  func getSnapshot(in context: Context, completion: @escaping (AJFitWidgetEntry) -> Void) {
    completion(entries(now: Date()).first ?? placeholder(in: context))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<AJFitWidgetEntry>) -> Void) {
    completion(Timeline(entries: entries(now: Date()), policy: .never))
  }

  private func entries(now: Date) -> [AJFitWidgetEntry] {
    let snapshot = AJFitSnapshotDecoder.decode(AJFitWidgetsStorage.readRaw())
    return AJFitTimelineResolver.resolve(snapshot: snapshot, now: now).map {
      AJFitWidgetEntry(date: $0.date, content: $0.content)
    }
  }
}

struct AJFitWorkoutWidgetEntry: TimelineEntry {
  let date: Date
  let content: AJFitWorkoutWidgetContent
}

struct AJFitWorkoutWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> AJFitWorkoutWidgetEntry {
    AJFitWorkoutWidgetEntry(date: Date(), content: .empty(.unavailable))
  }

  func getSnapshot(in context: Context, completion: @escaping (AJFitWorkoutWidgetEntry) -> Void) {
    completion(entry(now: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<AJFitWorkoutWidgetEntry>) -> Void) {
    let now = Date()
    let snapshot = AJFitSnapshotDecoder.decode(AJFitWidgetsStorage.readRaw())
    var entries = [AJFitWorkoutWidgetEntry(date: now, content: AJFitWorkoutResolver.resolve(snapshot: snapshot, now: now))]
    if let workout = snapshot?.workout {
      let transitionDates = [workout.dateBecomesTodayAtMs, workout.staleAtMs]
        .compactMap { $0 }
        .map { Date(timeIntervalSince1970: $0 / 1000) }
        .filter { $0 > now }
        .sorted()
      entries.append(contentsOf: transitionDates.map {
        AJFitWorkoutWidgetEntry(date: $0, content: AJFitWorkoutResolver.resolve(snapshot: snapshot, now: $0))
      })
    }
    completion(Timeline(entries: entries, policy: .never))
  }

  private func entry(now: Date) -> AJFitWorkoutWidgetEntry {
    let snapshot = AJFitSnapshotDecoder.decode(AJFitWidgetsStorage.readRaw())
    return AJFitWorkoutWidgetEntry(date: now, content: AJFitWorkoutResolver.resolve(snapshot: snapshot, now: now))
  }
}

private struct AJFitCanvas<Content: View>: View {
  @ViewBuilder let content: Content
  var body: some View {
    content
      .padding(16)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// The direct root returned by every StaticConfiguration. Keeping the
/// WidgetKit container marker here (instead of inside a content/layout view)
/// makes background adoption independent of READY/empty branches and of the
/// concrete hierarchy used by each widget family.
private struct AJFitWidgetRoot<Content: View>: View {
  @ViewBuilder let content: Content
  var body: some View {
    content.ajFitWidgetBackground()
  }
}

private extension View {
  @ViewBuilder
  func ajFitWidgetBackground() -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(for: .widget) {
        AJFitColors.background
      }
    } else {
      background(AJFitColors.background)
    }
  }
}

private struct EmptyWidgetView: View {
  let reason: AJFitEmptyReason
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Image(systemName: reason == .unavailable ? "arrow.clockwise" : "figure.strengthtraining.traditional")
        .font(.system(size: 22, weight: .semibold)).foregroundColor(AJFitColors.primaryEmphasis)
      Text(title).font(.custom("Archivo-SemiBold", size: 15)).foregroundColor(.white)
      Text(detail).font(.custom("Archivo-Regular", size: 11)).foregroundColor(.white.opacity(0.62))
        .lineLimit(3)
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
  private var title: String {
    switch reason { case .unauthenticated: return "Entre no AJ Fit"; case .noProgram: return "Ative seu treino"; case .unavailable: return "Abra o AJ Fit" }
  }
  private var detail: String {
    switch reason { case .unauthenticated: return "Faça login para acompanhar sua rotina."; case .noProgram: return "Escolha um programa para começar."; case .unavailable: return "Atualize seus dados no app." }
  }
}

private struct WidgetContentView<Ready: View>: View {
  let content: AJFitWidgetContent
  @ViewBuilder let ready: (AJFitReadyFields) -> Ready
  var body: some View {
    AJFitCanvas {
      switch content { case .ready(let fields): ready(fields); case .empty(let reason): EmptyWidgetView(reason: reason) }
    }
  }
}

private struct WorkoutBodyMapView: View {
  let bodyMap: AJFitWorkoutBodyMap

  var body: some View {
    ZStack {
      Image("AJFitBodyMap_\(bodyMap.sex)_base")
        .resizable().interpolation(.high).scaledToFit()
      ForEach(bodyMap.secondaryMuscles, id: \.self) { muscle in
        layer(muscle, opacity: 0.35)
      }
      ForEach(bodyMap.primaryMuscles, id: \.self) { muscle in
        layer(muscle, opacity: 1)
      }
    }
    .aspectRatio(2112 / 1536, contentMode: .fit)
    .accessibilityHidden(true)
  }

  private func layer(_ muscle: String, opacity: Double) -> some View {
    Image("AJFitBodyMap_\(bodyMap.sex)_\(muscle)")
      .resizable().interpolation(.high).renderingMode(.template).scaledToFit()
      .foregroundColor(AJFitColors.primaryEmphasis.opacity(opacity))
  }
}

private struct WorkoutWidgetView: View {
  let content: AJFitWorkoutWidgetContent
  let date: Date
  @Environment(\.widgetFamily) private var family

  var body: some View {
    AJFitCanvas {
      switch content {
      case .ready(let workout): workoutBody(workout)
      case .empty(let reason): EmptyWidgetView(reason: reason)
      }
    }
  }

  @ViewBuilder
  private func workoutBody(_ workout: AJFitWorkout) -> some View {
    if family == .systemMedium {
      medium(workout)
    } else {
      small(workout)
    }
  }

  private func header(_ workout: AJFitWorkout, logoSize: CGFloat) -> some View {
    HStack(spacing: 7) {
      if workout.state == "IN_PROGRESS" {
        Circle().fill(AJFitColors.primary).frame(width: 7, height: 7)
      }
      Text(workout.eyebrow)
        .font(.custom("Archivo-SemiBold", size: 9)).tracking(0.8)
        .foregroundColor(AJFitColors.primaryEmphasis).lineLimit(1)
      Spacer(minLength: 5)
      Image("AJFitLogo").resizable().scaledToFit().frame(width: logoSize, height: logoSize)
        .accessibilityHidden(true)
    }
  }

  private func small(_ workout: AJFitWorkout) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      header(workout, logoSize: 18)
      Text(workout.workoutName.uppercased())
        .font(.custom("Archivo-Bold", size: 15)).foregroundColor(.white)
        .lineLimit(2).minimumScaleFactor(0.68)
      ZStack {
        if let bodyMap = workout.bodyMap {
          WorkoutBodyMapView(bodyMap: bodyMap)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
      VStack(alignment: .leading, spacing: 0) {
        Text(workout.exercisesLabel)
        Text(workout.setsLabel)
      }
      .font(.custom("Archivo-SemiBold", size: 8.5))
      .foregroundColor(.white.opacity(0.64))
      .lineLimit(1).minimumScaleFactor(0.7)
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private func metric(label: String) -> some View {
    Text(label).font(.custom("Archivo-Bold", size: 11)).foregroundColor(.white.opacity(0.72))
      .lineLimit(2).minimumScaleFactor(0.7)
  }

  private func medium(_ workout: AJFitWorkout) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      header(workout, logoSize: 22)
      HStack(alignment: .bottom, spacing: 16) {
        VStack(alignment: .leading, spacing: 5) {
          if let dateLabel = workout.displayedDateLabel(at: date) {
            Text(dateLabel).font(.custom("JetBrainsMono-Regular", size: 10))
              .foregroundColor(.white.opacity(0.68)).lineLimit(1)
          }
          Text(workout.workoutName.uppercased())
            .font(.custom("Archivo-Bold", size: 19)).foregroundColor(.white)
            .lineLimit(2).minimumScaleFactor(0.75)
        }.frame(maxWidth: .infinity, alignment: .leading)
        HStack(alignment: .bottom, spacing: 14) {
          metric(label: workout.exercisesLabel)
          Rectangle().fill(AJFitColors.border).frame(width: 1, height: 38)
          metric(label: workout.setsLabel)
        }.fixedSize(horizontal: true, vertical: false)
      }
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct StreakValue: View {
  let streak: AJFitStreak
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(streak.displayValue).font(.custom("Anton-Regular", size: 52)).foregroundColor(.white).minimumScaleFactor(0.7)
      Text(streak.complete ? streak.unitLabel.uppercased() : "PELO MENOS \(streak.unitLabel.uppercased())")
        .font(.custom("Archivo-SemiBold", size: 9)).tracking(1).foregroundColor(.white.opacity(0.62)).lineLimit(1)
    }
  }
}

private struct WeekStrip: View {
  let days: [AJFitWeekDay]
  var body: some View {
    HStack(spacing: 3) {
      ForEach(Array(days.enumerated()), id: \.offset) { _, day in
        VStack(spacing: 6) {
          Text(day.weekday.shortLabel).font(.custom("Archivo-SemiBold", size: 9)).foregroundColor(.white.opacity(0.55))
          Circle()
            .fill(fillColor(day.status))
            .overlay(Circle().stroke(borderColor(day), lineWidth: day.status == .missed || day.isToday ? 1.5 : 0))
            .frame(width: 20, height: 20)
            .overlay(
              Image(systemName: icon(day.status))
                .font(.system(size: 8, weight: .bold))
                .foregroundColor(day.status == .missed ? AJFitColors.primary : .white)
            )
        }.frame(maxWidth: .infinity)
      }
    }
  }
  private func fillColor(_ status: AJFitDayStatus) -> Color {
    switch status {
    case .completed, .todayCompleted: return AJFitColors.primary
    case .fulfilledEarly: return AJFitColors.success
    case .missed: return .clear
    case .activeRecovery: return AJFitColors.warning.opacity(0.7)
    case .todayPending: return AJFitColors.primary.opacity(0.25)
    default: return AJFitColors.surface
    }
  }
  private func borderColor(_ day: AJFitWeekDay) -> Color {
    if day.status == .missed { return AJFitColors.primary }
    return day.isToday ? AJFitColors.primaryEmphasis : .clear
  }
  private func icon(_ status: AJFitDayStatus) -> String {
    switch status { case .completed, .todayCompleted, .fulfilledEarly: return "checkmark"; case .missed: return "xmark"; case .activeRecovery: return "leaf.fill"; default: return "" }
  }
}

private struct CompactStreakView: View {
  let fields: AJFitReadyFields
  var body: some View {
    ZStack(alignment: .topTrailing) {
      AJDecorativeMark()
        .offset(x: 27, y: -20)

      VStack(alignment: .leading, spacing: 10) {
        HStack { Text("SEQUÊNCIA").font(.custom("Archivo-SemiBold", size: 10)).tracking(1).foregroundColor(AJFitColors.primaryEmphasis); Spacer(); Image(systemName: "flame.fill").foregroundColor(AJFitColors.primary) }
        StreakValue(streak: fields.streak)
        Spacer(minLength: 0)
        HStack(spacing: 4) { ForEach(Array(fields.weeklyActivity.enumerated()), id: \.offset) { _, day in Circle().fill(day.status == .completed || day.status == .todayCompleted ? AJFitColors.primary : AJFitColors.surface).frame(width: 7, height: 7) } }
      }
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

/// SwiftUI counterpart of Home/Profile's large, hollow OutlineNumber "AJ".
/// It is deliberately typographic (not the official logo) and decorative.
private struct AJDecorativeMark: View {
  var body: some View {
    AJOutlineGlyphs(text: "AJ", fontName: "Anton-Regular", fontSize: 98)
      .stroke(
        Color.white.opacity(0.035),
        style: StrokeStyle(lineWidth: 1.25, lineJoin: .round)
      )
      .frame(width: 122, height: 112)
      .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

/// CoreText exposes the same glyph outlines that React Native's SVG text
/// strokes. Drawing the path with `stroke` and no fill keeps the letter
/// interiors genuinely transparent instead of repainting them as background.
private struct AJOutlineGlyphs: Shape {
  let text: String
  let fontName: String
  let fontSize: CGFloat

  func path(in rect: CGRect) -> Path {
    let font = CTFontCreateWithName(fontName as CFString, fontSize, nil)
    let attributed = NSAttributedString(
      string: text,
      attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font]
    )
    let line = CTLineCreateWithAttributedString(attributed)
    let glyphPath = CGMutablePath()

    for case let run as CTRun in CTLineGetGlyphRuns(line) as NSArray {
      let count = CTRunGetGlyphCount(run)
      var glyphs = Array(repeating: CGGlyph(), count: count)
      var positions = Array(repeating: CGPoint.zero, count: count)
      CTRunGetGlyphs(run, CFRange(location: 0, length: 0), &glyphs)
      CTRunGetPositions(run, CFRange(location: 0, length: 0), &positions)

      for index in 0..<count {
        guard let letter = CTFontCreatePathForGlyph(font, glyphs[index], nil) else { continue }
        let translation = CGAffineTransform(
          translationX: positions[index].x,
          y: positions[index].y
        )
        glyphPath.addPath(letter, transform: translation)
      }
    }

    let bounds = glyphPath.boundingBoxOfPath
    var placement = CGAffineTransform(
      a: 1, b: 0, c: 0, d: -1,
      tx: rect.midX - bounds.midX,
      ty: rect.midY + bounds.midY
    )
    return Path(glyphPath.copy(using: &placement) ?? glyphPath)
  }
}

private struct WeeklyStreakView: View {
  let fields: AJFitReadyFields
  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack(alignment: .center) {
        Text("SEQUÊNCIA ATUAL")
          .font(.custom("Archivo-SemiBold", size: 10))
          .tracking(1)
          .foregroundColor(AJFitColors.primaryEmphasis)
        Spacer(minLength: 8)
        Image("AJFitLogo")
          .resizable()
          .scaledToFit()
          .frame(width: 21, height: 21)
          .accessibilityHidden(true)
      }

      HStack(alignment: .bottom, spacing: 10) {
        StreakValue(streak: fields.streak)
          .frame(width: 92, alignment: .leading)
        WeekStrip(days: fields.weeklyActivity)
          .frame(maxWidth: .infinity)
          .padding(.bottom, 4)
      }
    }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct AJFitCalendarMetrics {
  let titleFont: CGFloat
  let weekdayFont: CGFloat
  let dayFont: CGFloat
  let logoSize: CGFloat
  let headerHeight: CGFloat
  let weekdayHeight: CGFloat
  let headerGap: CGFloat
  let gridGap: CGFloat
  let columnSpacing: CGFloat
  let rowSpacing: CGFloat
  let cellRadius: CGFloat

  static func forFamily(_ family: WidgetFamily) -> AJFitCalendarMetrics {
    if family == .systemLarge {
      return AJFitCalendarMetrics(titleFont: 19, weekdayFont: 10, dayFont: 13,
        logoSize: 29, headerHeight: 30, weekdayHeight: 16, headerGap: 11,
        gridGap: 9, columnSpacing: 7, rowSpacing: 7, cellRadius: 7)
    }
    return AJFitCalendarMetrics(titleFont: 14, weekdayFont: 8, dayFont: 9,
      logoSize: 21, headerHeight: 21, weekdayHeight: 11, headerGap: 5,
      gridGap: 4, columnSpacing: 3, rowSpacing: 3, cellRadius: 5)
  }
}

private struct MonthView: View {
  let fields: AJFitReadyFields
  @Environment(\.widgetFamily) private var family

  private var activity: AJFitMonthlyActivity { fields.monthlyActivity }
  private var metrics: AJFitCalendarMetrics { .forFamily(family) }
  private var slots: [AJFitCalendarSlot] {
    AJFitCalendarLayout.slots(daysInMonth: activity.daysInMonth, startWeekday: activity.startWeekday)
  }
  private var rowCount: Int { max(1, slots.count / 7) }
  private var todayLocalDate: String? { fields.weeklyActivity.first(where: \.isToday)?.localDate }

  var body: some View {
    GeometryReader { proxy in
      let reservedHeight = metrics.headerHeight + metrics.headerGap + metrics.weekdayHeight
        + metrics.gridGap + metrics.rowSpacing * CGFloat(rowCount - 1)
      let cellHeight = max(1, (proxy.size.height - reservedHeight) / CGFloat(rowCount))
      VStack(alignment: .leading, spacing: 0) {
        HStack(alignment: .center) {
          Text(monthTitle)
            .font(.custom("Archivo-Bold", size: metrics.titleFont))
            .foregroundColor(.white)
          Spacer(minLength: 8)
          Image("AJFitLogo")
            .resizable()
            .scaledToFit()
            .frame(width: metrics.logoSize, height: metrics.logoSize)
            .accessibilityHidden(true)
        }
        .frame(height: metrics.headerHeight)

        HStack(spacing: metrics.columnSpacing) {
          ForEach(Array(weekdayLabels.enumerated()), id: \.offset) { _, label in
            Text(label)
              .font(.custom("Archivo-SemiBold", size: metrics.weekdayFont))
              .foregroundColor(.white.opacity(0.45))
              .frame(maxWidth: .infinity)
          }
        }
        .frame(height: metrics.weekdayHeight)
        .padding(.top, metrics.headerGap)

        LazyVGrid(
          columns: Array(repeating: GridItem(.flexible(), spacing: metrics.columnSpacing), count: 7),
          spacing: metrics.rowSpacing
        ) {
          ForEach(slots) { slot in
            calendarCell(slot, height: cellHeight)
          }
        }
        .padding(.top, metrics.gridGap)
      }
    }
  }

  @ViewBuilder
  private func calendarCell(_ slot: AJFitCalendarSlot, height: CGFloat) -> some View {
    switch slot.content {
    case .empty:
      Color.clear.frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
    case .day(let day):
      let date = localDate(day)
      let completed = activity.completedLocalDates.contains(date)
      let isToday = date == todayLocalDate
      Text(String(day))
        .font(.custom(completed ? "Archivo-Bold" : "Archivo-Regular", size: metrics.dayFont))
        .foregroundColor(completed ? .white : .white.opacity(0.58))
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
        .background(completed ? AJFitColors.primary : .clear)
        .overlay(
          RoundedRectangle(cornerRadius: metrics.cellRadius)
            .stroke(isToday ? AJFitColors.primary.opacity(0.40) : .clear, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: metrics.cellRadius))
    }
  }

  private let weekdayLabels = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"]
  private var monthTitle: String { ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"][activity.month - 1] + " \(activity.year)" }
  private func localDate(_ day: Int) -> String { String(format: "%04d-%02d-%02d", activity.year, activity.month, day) }
}

private struct AJFitFrequencyMetrics {
  let cellSize: CGFloat
  let cellSpacing: CGFloat
  let titleFont: CGFloat
  let footerFont: CGFloat
  let logoSize: CGFloat
  let verticalSpacing: CGFloat
  let cornerRadius: CGFloat

  static func forFamily(_ family: WidgetFamily) -> AJFitFrequencyMetrics {
    switch family {
    case .systemLarge:
      return AJFitFrequencyMetrics(cellSize: 28, cellSpacing: 7, titleFont: 12,
        footerFont: 11, logoSize: 29, verticalSpacing: 18, cornerRadius: 6)
    case .systemMedium:
      return AJFitFrequencyMetrics(cellSize: 18, cellSpacing: 4, titleFont: 10,
        footerFont: 10, logoSize: 21, verticalSpacing: 2, cornerRadius: 5)
    case .systemSmall:
      return AJFitFrequencyMetrics(cellSize: 11, cellSpacing: 1.25, titleFont: 10,
        footerFont: 9, logoSize: 21, verticalSpacing: 1.5, cornerRadius: 3)
    default:
      return AJFitFrequencyMetrics(cellSize: 8.5, cellSpacing: 2.8, titleFont: 10,
        footerFont: 9, logoSize: 21, verticalSpacing: 4, cornerRadius: 3)
    }
  }
}

private struct FrequencyView: View {
  let window: AJFitFrequencyWindow
  @Environment(\.widgetFamily) private var family
  private var metrics: AJFitFrequencyMetrics { .forFamily(family) }
  private var columnCount: Int { family == .systemMedium ? 10 : 7 }
  private var columns: [GridItem] {
    Array(repeating: GridItem(.fixed(metrics.cellSize), spacing: metrics.cellSpacing), count: columnCount)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center) {
        Text("FREQUÊNCIA")
          .font(.custom("Archivo-SemiBold", size: metrics.titleFont))
          .tracking(1)
          .foregroundColor(AJFitColors.primaryEmphasis)
        Spacer(minLength: 8)
        Image("AJFitLogo")
          .resizable()
          .scaledToFit()
          .frame(width: metrics.logoSize, height: metrics.logoSize)
          .accessibilityHidden(true)
      }

      Spacer(minLength: metrics.verticalSpacing)

      LazyVGrid(columns: columns, alignment: .center, spacing: metrics.cellSpacing) {
        if family != .systemMedium {
          ForEach(0..<leadingPad, id: \.self) { _ in
            Color.clear.frame(width: metrics.cellSize, height: metrics.cellSize)
          }
        }
        ForEach(0..<Self.dayCount, id: \.self) { index in
          RoundedRectangle(cornerRadius: metrics.cornerRadius)
            .fill(completed(index) ? AJFitColors.primary : AJFitColors.surface)
            .frame(width: metrics.cellSize, height: metrics.cellSize)
        }
      }
      .frame(maxWidth: .infinity, alignment: .center)

      Spacer(minLength: metrics.verticalSpacing)

      HStack(alignment: .center) {
        HStack(spacing: 5) {
          Circle().fill(AJFitColors.primary).frame(width: 7, height: 7)
          Text("\(window.completedLocalDates.count) treinos")
            .font(.custom("Archivo-Regular", size: metrics.footerFont))
            .foregroundColor(.white.opacity(0.65))
            .lineLimit(1)
        }
        Spacer(minLength: 8)
        Text("30 DIAS")
          .font(.custom("JetBrainsMono-Regular", size: metrics.footerFont))
          .foregroundColor(.white.opacity(0.5))
          .lineLimit(1)
      }
    }
  }
  private static let dayCount = 30
  private var leadingPad: Int { AJFitWeekday.allCases.firstIndex(of: window.startWeekday) ?? 0 }
  private func completed(_ index: Int) -> Bool {
    // No date arithmetic: TypeScript already supplies the ordered 30-day
    // window and its completed date set. Offset lookup is display-only.
    guard let start = ISO8601DateFormatter.ajfitLocal.date(from: window.startLocalDate) else { return false }
    let date = Calendar(identifier: .iso8601).date(byAdding: .day, value: index, to: start)!
    return window.completedLocalDates.contains(ISO8601DateFormatter.ajfitLocal.string(from: date))
  }
}

private extension ISO8601DateFormatter {
  static let ajfitLocal: DateFormatter = { let formatter = DateFormatter(); formatter.calendar = Calendar(identifier: .iso8601); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "yyyy-MM-dd"; return formatter }()
}

private struct MonthlyEntryView: View { let entry: AJFitWidgetEntry; var body: some View { WidgetContentView(content: entry.content) { MonthView(fields: $0) } } }
private struct WeeklyEntryView: View { let entry: AJFitWidgetEntry; var body: some View { WidgetContentView(content: entry.content) { WeeklyStreakView(fields: $0) } } }
private struct CompactEntryView: View { let entry: AJFitWidgetEntry; var body: some View { WidgetContentView(content: entry.content) { CompactStreakView(fields: $0) } } }
private struct FrequencyEntryView: View { let entry: AJFitWidgetEntry; var body: some View { WidgetContentView(content: entry.content) { FrequencyView(window: $0.frequencyWindow) } } }
private struct WorkoutEntryView: View { let entry: AJFitWorkoutWidgetEntry; var body: some View { WorkoutWidgetView(content: entry.content, date: entry.date) } }

struct AJFitMonthlyWidget: Widget {
  let kind = "AJFitMonthlyCalendar"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AJFitWidgetProvider()) { entry in
      AJFitWidgetRoot { MonthlyEntryView(entry: entry) }
    }
    .configurationDisplayName("Calendário AJ Fit")
    .description("Seus treinos concluídos no mês.")
    .supportedFamilies([.systemMedium, .systemLarge])
    .contentMarginsDisabled()
  }
}

struct AJFitWeeklyWidget: Widget {
  let kind = "AJFitWeeklyStreak"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AJFitWidgetProvider()) { entry in
      AJFitWidgetRoot { WeeklyEntryView(entry: entry) }
    }
    .configurationDisplayName("Semana AJ Fit")
    .description("Sequência e estado da semana.")
    .supportedFamilies([.systemMedium])
    .contentMarginsDisabled()
  }
}

struct AJFitCompactWidget: Widget {
  let kind = "AJFitCompactStreak"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AJFitWidgetProvider()) { entry in
      AJFitWidgetRoot { CompactEntryView(entry: entry) }
    }
    .configurationDisplayName("Sequência AJ Fit")
    .description("Sua sequência em destaque.")
    .supportedFamilies([.systemSmall])
    .contentMarginsDisabled()
  }
}

struct AJFitFrequencyWidget: Widget {
  let kind = "AJFitFrequency"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AJFitWidgetProvider()) { entry in
      AJFitWidgetRoot { FrequencyEntryView(entry: entry) }
    }
    .configurationDisplayName("Frequência AJ Fit")
    .description("Atividade dos últimos 30 dias.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    .contentMarginsDisabled()
  }
}

struct AJFitWorkoutWidget: Widget {
  let kind = "AJFitNextWorkout"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AJFitWorkoutWidgetProvider()) { entry in
      AJFitWidgetRoot { WorkoutEntryView(entry: entry) }
    }
    .configurationDisplayName("Próximo Treino AJ Fit")
    .description("Seu próximo treino ou a sessão em andamento.")
    .supportedFamilies([.systemSmall, .systemMedium])
    .contentMarginsDisabled()
  }
}

#if DEBUG
private enum AJFitWidgetPreviewData {
  static let mixedWeek: [AJFitWeekDay] = [
    AJFitWeekDay(localDate: "2026-09-14", weekday: .mon, status: .completed, isToday: false),
    AJFitWeekDay(localDate: "2026-09-15", weekday: .tue, status: .missed, isToday: false),
    AJFitWeekDay(localDate: "2026-09-16", weekday: .wed, status: .rest, isToday: false),
    AJFitWeekDay(localDate: "2026-09-17", weekday: .thu, status: .todayPending, isToday: true),
    AJFitWeekDay(localDate: "2026-09-18", weekday: .fri, status: .upcoming, isToday: false),
    AJFitWeekDay(localDate: "2026-09-19", weekday: .sat, status: .fulfilledEarly, isToday: false),
    AJFitWeekDay(localDate: "2026-09-20", weekday: .sun, status: .activeRecovery, isToday: false),
  ]

  static func fields(completedDates: [String], complete: Bool = true) -> AJFitReadyFields {
    AJFitReadyFields(
      streak: AJFitStreak(scheduleMode: "fixed", unit: "obligations", current: 12, complete: complete),
      weeklyActivity: mixedWeek,
      monthlyActivity: AJFitMonthlyActivity(year: 2026, month: 9, daysInMonth: 30,
        startWeekday: .tue, completedLocalDates: completedDates),
      frequencyWindow: AJFitFrequencyWindow(startLocalDate: "2026-09-01", endLocalDate: "2026-09-30",
        startWeekday: .tue, completedLocalDates: completedDates)
    )
  }

  static let fewDates = ["2026-09-03", "2026-09-10", "2026-09-17"]
  static let manyDates = (1...30).filter { $0 % 3 != 0 }.map { String(format: "2026-09-%02d", $0) }
}

private struct AJFitWidgets_Previews: PreviewProvider {
  static var previews: some View {
    Group {
      AJFitWidgetRoot {
        WeeklyEntryView(entry: AJFitWidgetEntry(date: Date(), content: .ready(
          AJFitWidgetPreviewData.fields(completedDates: AJFitWidgetPreviewData.fewDates, complete: false)
        )))
      }
      .previewContext(WidgetPreviewContext(family: .systemMedium))
      .previewDisplayName("Weekly — statuses + complete:false")

      AJFitWidgetRoot {
        CompactEntryView(entry: AJFitWidgetEntry(date: Date(), content: .ready(
          AJFitWidgetPreviewData.fields(completedDates: AJFitWidgetPreviewData.fewDates)
        )))
      }
      .previewContext(WidgetPreviewContext(family: .systemSmall))
      .previewDisplayName("Compact — AJ watermark")

      frequencyPreview(AJFitWidgetPreviewData.fewDates, family: .systemSmall)
        .previewDisplayName("Frequency Small — enlarged + few")
      frequencyPreview(AJFitWidgetPreviewData.fewDates, family: .systemMedium)
        .previewDisplayName("Frequency Medium — few")
      frequencyPreview(AJFitWidgetPreviewData.manyDates, family: .systemMedium)
        .previewDisplayName("Frequency Medium — many")
      frequencyPreview(AJFitWidgetPreviewData.manyDates, family: .systemLarge)
        .previewDisplayName("Frequency Large — many")

      AJFitWidgetRoot {
        FrequencyEntryView(entry: AJFitWidgetEntry(date: Date(), content: .empty(.unavailable)))
      }
      .previewContext(WidgetPreviewContext(family: .systemMedium))
      .previewDisplayName("Frequency — empty state")
    }
  }

  private static func frequencyPreview(_ dates: [String], family: WidgetFamily) -> some View {
    AJFitWidgetRoot {
      FrequencyEntryView(entry: AJFitWidgetEntry(date: Date(), content: .ready(
        AJFitWidgetPreviewData.fields(completedDates: dates)
      )))
    }
    .previewContext(WidgetPreviewContext(family: family))
  }
}
#endif
