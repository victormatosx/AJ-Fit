package com.ajfit.widgets

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.ColorFilter
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

// Jetpack Glance 1.1.1 is a RemoteViews compiler, not full Compose UI:
// - No custom/bundled font loading (`TextStyle.fontFamily` only accepts the
//   generic Serif/SansSerif/Monospace/Cursive families or a system font
//   name) — Anton/Archivo/JetBrains Mono from the iOS build cannot be used.
//   We compensate with fontSize/fontWeight/textAlign hierarchy instead.
// - No letter-spacing/tracking API on `TextStyle`.
// - No border/stroke modifier — a "ring" look is faked with a transparent
//   -fill, stroked vector drawable applied as an image background.
// - No GeometryReader; `LocalSize.current` (one of `responsiveSizes` below)
//   plays the same role for size-driven metrics.
private object AJFitWidgetColors {
  // `ColorProvider` is overloaded as (Color) for a fixed color and (Int) for
  // an Android @ColorRes resource id — `android.graphics.Color.rgb/argb`
  // return a plain Int, which silently binds to the resource-id overload
  // and crashes RemoteViews at inflate time with a NotFoundException for
  // the packed color value. Always construct a Compose `Color` explicitly —
  // never pass an Int literal/variable to `ColorProvider` directly.
  val background = ColorProvider(ComposeColor(2, 0, 16))
  val primary = ColorProvider(ComposeColor(11, 112, 249))
  val emphasis = ColorProvider(ComposeColor(77, 163, 255))
  val bodyMapSecondary = ColorProvider(ComposeColor(77, 163, 255, 90))
  val text = ColorProvider(ComposeColor.White)
  val muted = ColorProvider(ComposeColor(255, 255, 255, 160))
  val faint = ColorProvider(ComposeColor(255, 255, 255, 90))
  val surface = ColorProvider(ComposeColor(255, 255, 255, 18))
}

private val responsiveSizes = setOf(
  DpSize(120.dp, 120.dp), DpSize(250.dp, 120.dp), DpSize(250.dp, 250.dp)
)

abstract class AJFitGlanceWidget : GlanceAppWidget() {
  override val sizeMode: SizeMode = SizeMode.Responsive(responsiveSizes)
  protected abstract val kind: Kind
  enum class Kind { MONTHLY, WEEKLY, COMPACT, FREQUENCY, WORKOUT }

  override suspend fun provideGlance(context: Context, id: androidx.glance.GlanceId) {
    val snapshot = AJFitWidgetSnapshotDecoder.decode(AJFitWidgetsStorage.readRaw(context))
    val nowMs = System.currentTimeMillis()
    val content = AJFitWidgetEntryResolver.resolve(snapshot, nowMs)
    val workout = AJFitWorkoutResolver.resolve(snapshot, nowMs)
    provideContent { WidgetRoot(content, workout, kind, nowMs) }
  }
}

class AJFitMonthlyWidget : AJFitGlanceWidget() { override val kind = Kind.MONTHLY }
class AJFitWeeklyWidget : AJFitGlanceWidget() { override val kind = Kind.WEEKLY }
class AJFitCompactWidget : AJFitGlanceWidget() { override val kind = Kind.COMPACT }
class AJFitFrequencyWidget : AJFitGlanceWidget() { override val kind = Kind.FREQUENCY }
class AJFitWorkoutWidget : AJFitGlanceWidget() { override val kind = Kind.WORKOUT }

class AJFitMonthlyWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget = AJFitMonthlyWidget() }
class AJFitWeeklyWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget = AJFitWeeklyWidget() }
class AJFitCompactWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget = AJFitCompactWidget() }
class AJFitFrequencyWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget = AJFitFrequencyWidget() }
class AJFitWorkoutWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget = AJFitWorkoutWidget() }

private val rootPadding = 14.dp

@Composable
private fun WidgetRoot(content: AJFitWidgetContent, workout: AJFitWorkout?, kind: AJFitGlanceWidget.Kind, nowMs: Long) {
  val isSmallWorkout = kind == AJFitGlanceWidget.Kind.WORKOUT && LocalSize.current.width.value < 220f
  val padding = if (isSmallWorkout) 6.dp else rootPadding
  Box(GlanceModifier.fillMaxSize().background(AJFitWidgetColors.background).padding(padding)) {
    if (kind == AJFitGlanceWidget.Kind.WORKOUT) {
      if (workout != null) WorkoutWidget(workout, nowMs)
      else EmptyWidget((content as? AJFitWidgetContent.Empty)?.reason ?: AJFitWidgetContent.Reason.UNAVAILABLE)
    } else when (content) {
      is AJFitWidgetContent.Empty -> EmptyWidget(content.reason)
      is AJFitWidgetContent.Ready -> when (kind) {
        AJFitGlanceWidget.Kind.MONTHLY -> MonthlyWidget(content.fields)
        AJFitGlanceWidget.Kind.WEEKLY -> WeeklyWidget(content.fields)
        AJFitGlanceWidget.Kind.COMPACT -> CompactWidget(content.fields)
        AJFitGlanceWidget.Kind.FREQUENCY -> FrequencyWidget(content.fields.frequencyWindow)
        AJFitGlanceWidget.Kind.WORKOUT -> Unit
      }
    }
  }
}

// ---- Próximo treino ---------------------------------------------------------

@Composable private fun WorkoutHeader(workout: AJFitWorkout, logoSize: Int) {
  Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
    if (workout.state == "IN_PROGRESS") {
      Box(GlanceModifier.size(7.dp).background(AJFitWidgetColors.primary).cornerRadius(7.dp)) {}
      Spacer(GlanceModifier.width(6.dp))
    }
    Text(
      workout.eyebrow,
      GlanceModifier.defaultWeight(),
      TextStyle(AJFitWidgetColors.emphasis, fontSize = 10.sp, fontWeight = FontWeight.Bold),
      maxLines = 1,
    )
    Image(ImageProvider(R.drawable.ajfit_widget_logo), "AJ Fit", GlanceModifier.size(logoSize.dp))
  }
}

@Composable private fun WorkoutMetric(label: String) {
  Text(label, style = TextStyle(AJFitWidgetColors.muted, fontSize = 11.sp, fontWeight = FontWeight.Bold), maxLines = 2)
}

private fun bodyMapResource(sex: String, muscle: String?): Int? {
  val pair = when (muscle) {
    null -> R.drawable.ajfit_widget_bodymap_m_base to R.drawable.ajfit_widget_bodymap_f_base
    "chest" -> R.drawable.ajfit_widget_bodymap_m_chest to R.drawable.ajfit_widget_bodymap_f_chest
    "lats" -> R.drawable.ajfit_widget_bodymap_m_lats to R.drawable.ajfit_widget_bodymap_f_lats
    "upper_back" -> R.drawable.ajfit_widget_bodymap_m_upper_back to R.drawable.ajfit_widget_bodymap_f_upper_back
    "traps" -> R.drawable.ajfit_widget_bodymap_m_traps to R.drawable.ajfit_widget_bodymap_f_traps
    "lower_back" -> R.drawable.ajfit_widget_bodymap_m_lower_back to R.drawable.ajfit_widget_bodymap_f_lower_back
    "front_deltoid" -> R.drawable.ajfit_widget_bodymap_m_front_deltoid to R.drawable.ajfit_widget_bodymap_f_front_deltoid
    "side_deltoid" -> R.drawable.ajfit_widget_bodymap_m_side_deltoid to R.drawable.ajfit_widget_bodymap_f_side_deltoid
    "rear_deltoid" -> R.drawable.ajfit_widget_bodymap_m_rear_deltoid to R.drawable.ajfit_widget_bodymap_f_rear_deltoid
    "biceps" -> R.drawable.ajfit_widget_bodymap_m_biceps to R.drawable.ajfit_widget_bodymap_f_biceps
    "triceps" -> R.drawable.ajfit_widget_bodymap_m_triceps to R.drawable.ajfit_widget_bodymap_f_triceps
    "forearms" -> R.drawable.ajfit_widget_bodymap_m_forearms to R.drawable.ajfit_widget_bodymap_f_forearms
    "quads" -> R.drawable.ajfit_widget_bodymap_m_quads to R.drawable.ajfit_widget_bodymap_f_quads
    "hamstrings" -> R.drawable.ajfit_widget_bodymap_m_hamstrings to R.drawable.ajfit_widget_bodymap_f_hamstrings
    "glutes" -> R.drawable.ajfit_widget_bodymap_m_glutes to R.drawable.ajfit_widget_bodymap_f_glutes
    "adductors" -> R.drawable.ajfit_widget_bodymap_m_adductors to R.drawable.ajfit_widget_bodymap_f_adductors
    "abductors" -> R.drawable.ajfit_widget_bodymap_m_abductors to R.drawable.ajfit_widget_bodymap_f_abductors
    "calves" -> R.drawable.ajfit_widget_bodymap_m_calves to R.drawable.ajfit_widget_bodymap_f_calves
    "abs" -> R.drawable.ajfit_widget_bodymap_m_abs to R.drawable.ajfit_widget_bodymap_f_abs
    else -> return null
  }
  return if (sex == "f") pair.second else pair.first
}

@Composable private fun WorkoutBodyMap(bodyMap: AJFitWorkoutBodyMap) {
  Box(GlanceModifier.fillMaxSize()) {
    bodyMapResource(bodyMap.sex, null)?.let {
      Image(ImageProvider(it), null, GlanceModifier.fillMaxSize(), contentScale = ContentScale.Fit)
    }
    bodyMap.secondaryMuscles.forEach { muscle ->
      bodyMapResource(bodyMap.sex, muscle)?.let {
        Image(
          ImageProvider(it), null, GlanceModifier.fillMaxSize(), contentScale = ContentScale.Fit,
          colorFilter = ColorFilter.tint(AJFitWidgetColors.bodyMapSecondary),
        )
      }
    }
    bodyMap.primaryMuscles.forEach { muscle ->
      bodyMapResource(bodyMap.sex, muscle)?.let {
        Image(
          ImageProvider(it), null, GlanceModifier.fillMaxSize(), contentScale = ContentScale.Fit,
          colorFilter = ColorFilter.tint(AJFitWidgetColors.emphasis),
        )
      }
    }
  }
}

@Composable private fun WorkoutWidget(workout: AJFitWorkout, nowMs: Long) {
  val medium = LocalSize.current.width.value >= 220f
  val dateLabel = workout.displayedDateLabel(nowMs)
  Column(GlanceModifier.fillMaxSize()) {
    WorkoutHeader(workout, if (medium) 22 else 20)
    Spacer(GlanceModifier.height(if (medium) 7.dp else 3.dp))
    if (medium) {
      Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.Bottom) {
        Column(GlanceModifier.defaultWeight()) {
          dateLabel?.let {
            Text(it, style = TextStyle(AJFitWidgetColors.muted, fontSize = 10.sp, fontFamily = androidx.glance.text.FontFamily.Monospace), maxLines = 1)
            Spacer(GlanceModifier.height(5.dp))
          }
          Text(workout.workoutName.uppercase(), style = TextStyle(AJFitWidgetColors.text, fontSize = 18.sp, fontWeight = FontWeight.Bold), maxLines = 2)
        }
        Spacer(GlanceModifier.width(15.dp))
        WorkoutMetric(workout.exercisesLabel)
        Spacer(GlanceModifier.width(15.dp))
        WorkoutMetric(workout.setsLabel)
      }
    } else {
      Text(workout.workoutName.uppercase(), style = TextStyle(AJFitWidgetColors.text, fontSize = 13.sp, fontWeight = FontWeight.Bold), maxLines = 2)
      Box(GlanceModifier.fillMaxWidth().defaultWeight(), contentAlignment = Alignment.Center) {
        workout.bodyMap?.let {
          WorkoutBodyMap(it)
        }
      }
      Text(workout.exercisesLabel, style = TextStyle(AJFitWidgetColors.muted, fontSize = 8.sp, fontWeight = FontWeight.Medium), maxLines = 1)
      Text(workout.setsLabel, style = TextStyle(AJFitWidgetColors.muted, fontSize = 8.sp, fontWeight = FontWeight.Medium), maxLines = 1)
    }
  }
}

@Composable private fun EmptyWidget(reason: AJFitWidgetContent.Reason) {
  val (title, detail) = when (reason) {
    AJFitWidgetContent.Reason.UNAUTHENTICATED -> "Entre no AJ Fit" to "Faça login para acompanhar sua rotina."
    AJFitWidgetContent.Reason.NO_PROGRAM -> "Ative seu treino" to "Escolha um programa para começar."
    AJFitWidgetContent.Reason.UNAVAILABLE -> "Abra o AJ Fit" to "Atualize seus dados no app."
  }
  Column(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.Vertical.CenterVertically) {
    Text(title, style = TextStyle(AJFitWidgetColors.text, fontSize = 15.sp, fontWeight = FontWeight.Bold))
    Spacer(GlanceModifier.height(6.dp))
    Text(detail, style = TextStyle(AJFitWidgetColors.muted, fontSize = 11.sp), maxLines = 3)
  }
}

@Composable private fun Header(title: String, titleSize: Int, logoSize: Int) {
  Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
    Text(
      title,
      style = TextStyle(AJFitWidgetColors.emphasis, fontSize = titleSize.sp, fontWeight = FontWeight.Bold),
      maxLines = 1,
    )
    Spacer(GlanceModifier.defaultWeight())
    Image(ImageProvider(R.drawable.ajfit_widget_logo), "AJ Fit", GlanceModifier.size(logoSize.dp))
  }
}

@Composable private fun Streak(streak: AJFitStreak, valueSize: Int, unitSize: Int) {
  Text(
    streak.displayValue,
    style = TextStyle(AJFitWidgetColors.text, fontSize = valueSize.sp, fontWeight = FontWeight.Bold),
    maxLines = 1,
  )
  Text(
    if (streak.complete) streak.unitLabel else "PELO MENOS ${streak.unitLabel}",
    style = TextStyle(AJFitWidgetColors.muted, fontSize = unitSize.sp, fontWeight = FontWeight.Medium),
    maxLines = 1,
  )
}

// ---- Monthly (Calendário) --------------------------------------------------

private data class AJFitCalendarMetrics(
  val titleSize: Int, val logoSize: Int, val weekdaySize: Int, val daySize: Int,
  val headerHeight: Int, val weekdayHeight: Int, val headerGap: Int, val gridGap: Int, val cellRadius: Int,
)

private fun calendarMetrics(size: DpSize): AJFitCalendarMetrics = when {
  size.height.value >= 220f -> AJFitCalendarMetrics(
    titleSize = 18, logoSize = 26, weekdaySize = 10, daySize = 13,
    headerHeight = 26, weekdayHeight = 16, headerGap = 8, gridGap = 6, cellRadius = 7,
  )
  size.width.value >= 220f -> AJFitCalendarMetrics(
    titleSize = 15, logoSize = 21, weekdaySize = 9, daySize = 11,
    headerHeight = 21, weekdayHeight = 14, headerGap = 5, gridGap = 4, cellRadius = 6,
  )
  else -> AJFitCalendarMetrics(
    titleSize = 13, logoSize = 18, weekdaySize = 8, daySize = 10,
    headerHeight = 18, weekdayHeight = 12, headerGap = 4, gridGap = 3, cellRadius = 5,
  )
}

private val weekdayLabels = listOf("DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB")

@Composable private fun MonthlyWidget(fields: AJFitReadyFields) {
  val month = fields.monthlyActivity
  val slots = AJFitWidgetLayout.calendarSlots(month.daysInMonth, month.startWeekday)
  val today = fields.weeklyActivity.firstOrNull { it.isToday }?.localDate
  val size = LocalSize.current
  val metrics = calendarMetrics(size)
  val rows = (slots.size / 7).coerceAtLeast(1)
  val availableHeight = size.height.value - rootPadding.value * 2
  val reserved = metrics.headerHeight + metrics.headerGap + metrics.weekdayHeight + metrics.gridGap +
    metrics.gridGap * (rows - 1)
  val cellHeight = ((availableHeight - reserved) / rows).coerceAtLeast(16f).toInt()

  Column(GlanceModifier.fillMaxSize()) {
    Header(monthName(month.month) + " ${month.year}", metrics.titleSize, metrics.logoSize)
    Spacer(GlanceModifier.height(metrics.headerGap.dp))
    Row(GlanceModifier.fillMaxWidth().height(metrics.weekdayHeight.dp)) {
      weekdayLabels.forEach { label ->
        Text(
          label,
          GlanceModifier.defaultWeight(),
          TextStyle(AJFitWidgetColors.faint, fontSize = metrics.weekdaySize.sp, textAlign = TextAlign.Center),
          maxLines = 1,
        )
      }
    }
    Spacer(GlanceModifier.height(metrics.gridGap.dp))
    slots.chunked(7).forEachIndexed { rowIndex, row ->
      Row(GlanceModifier.fillMaxWidth()) {
        row.forEach { day ->
          Box(GlanceModifier.defaultWeight().height(cellHeight.dp), contentAlignment = Alignment.Center) {
            if (day != null) {
              val date = "%04d-%02d-%02d".format(month.year, month.month, day)
              val completed = date in month.completedLocalDates
              val isToday = date == today
              Box(
                GlanceModifier.fillMaxSize().padding(horizontal = 2.dp, vertical = 1.dp)
                  .background(if (completed) AJFitWidgetColors.primary else ColorProvider(ComposeColor.Transparent))
                  .cornerRadius(metrics.cellRadius.dp)
                  .let { if (isToday && !completed) it.background(ImageProvider(R.drawable.ajfit_widget_today_ring), ContentScale.FillBounds) else it },
                contentAlignment = Alignment.Center,
              ) {
                Text(
                  "$day",
                  style = TextStyle(
                    if (completed) AJFitWidgetColors.text else AJFitWidgetColors.muted,
                    fontSize = metrics.daySize.sp,
                    fontWeight = if (completed) FontWeight.Bold else FontWeight.Normal,
                    textAlign = TextAlign.Center,
                  ),
                  maxLines = 1,
                )
              }
            }
          }
        }
      }
      if (rowIndex != rows - 1) Spacer(GlanceModifier.height(metrics.gridGap.dp))
    }
  }
}

// ---- Weekly (Semana) --------------------------------------------------------

private data class AJFitWeeklyMetrics(val titleSize: Int, val logoSize: Int, val streakSize: Int, val unitSize: Int, val circleSize: Int, val dayLabelSize: Int)

private fun weeklyMetrics(size: DpSize): AJFitWeeklyMetrics = if (size.height.value >= 150f)
  AJFitWeeklyMetrics(titleSize = 12, logoSize = 24, streakSize = 44, unitSize = 10, circleSize = 26, dayLabelSize = 10)
else
  AJFitWeeklyMetrics(titleSize = 11, logoSize = 21, streakSize = 38, unitSize = 9, circleSize = 22, dayLabelSize = 9)

@Composable private fun WeeklyWidget(fields: AJFitReadyFields) {
  val metrics = weeklyMetrics(LocalSize.current)
  Column(GlanceModifier.fillMaxSize()) {
    Header("SEQUÊNCIA ATUAL", metrics.titleSize, metrics.logoSize)
    Spacer(GlanceModifier.defaultWeight())
    Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.Bottom) {
      Column(GlanceModifier.width(92.dp)) { Streak(fields.streak, metrics.streakSize, metrics.unitSize) }
      Spacer(GlanceModifier.width(8.dp))
      Row(GlanceModifier.defaultWeight(), verticalAlignment = Alignment.Vertical.Bottom) {
        fields.weeklyActivity.forEach { day ->
          Column(GlanceModifier.defaultWeight(), horizontalAlignment = Alignment.Horizontal.CenterHorizontally) {
            Text(
              weekdayLabels[sundayFirstIndex(day.weekday)].take(1),
              style = TextStyle(AJFitWidgetColors.faint, fontSize = metrics.dayLabelSize.sp),
              maxLines = 1,
            )
            Spacer(GlanceModifier.height(5.dp))
            Image(ImageProvider(dayDrawable(day.status)), null, GlanceModifier.size(metrics.circleSize.dp))
          }
        }
      }
    }
  }
}

private fun sundayFirstIndex(weekday: AJFitWeekday): Int = AJFitWidgetLayout.sundayFirst.indexOf(weekday).coerceAtLeast(0)

// ---- Compact (Sequência) -----------------------------------------------------

private data class AJFitCompactMetrics(val titleSize: Int, val streakSize: Int, val unitSize: Int, val dotSize: Int, val outlineSize: Int)

private fun compactMetrics(size: DpSize): AJFitCompactMetrics = when {
  size.height.value >= 220f -> AJFitCompactMetrics(titleSize = 13, streakSize = 56, unitSize = 11, dotSize = 9, outlineSize = 220)
  size.width.value >= 220f -> AJFitCompactMetrics(titleSize = 12, streakSize = 44, unitSize = 10, dotSize = 8, outlineSize = 170)
  else -> AJFitCompactMetrics(titleSize = 11, streakSize = 38, unitSize = 9, dotSize = 7, outlineSize = 150)
}

@Composable private fun CompactWidget(fields: AJFitReadyFields) {
  val metrics = compactMetrics(LocalSize.current)
  Box(GlanceModifier.fillMaxSize()) {
    // Decorative AJ watermark: stroke-only, low-opacity, deliberately larger
    // than the widget and aligned to the top-trailing corner so it bleeds
    // past the edge and reads as a background mark, not a loose icon —
    // Glance has no `offset` modifier, so oversizing + corner alignment is
    // the closest faithful adaptation of the iOS `.offset(x:27, y:-20)` mark.
    Box(GlanceModifier.fillMaxSize(), contentAlignment = Alignment.TopEnd) {
      Image(
        ImageProvider(R.drawable.ajfit_widget_aj_outline), null,
        GlanceModifier.size(metrics.outlineSize.dp), contentScale = ContentScale.Fit,
      )
    }
    Column(GlanceModifier.fillMaxSize()) {
      Text(
        "SEQUÊNCIA",
        style = TextStyle(AJFitWidgetColors.emphasis, fontSize = metrics.titleSize.sp, fontWeight = FontWeight.Bold),
        maxLines = 1,
      )
      Spacer(GlanceModifier.height(8.dp))
      Streak(fields.streak, metrics.streakSize, metrics.unitSize)
      Spacer(GlanceModifier.defaultWeight())
      Row {
        fields.weeklyActivity.forEach { day ->
          Box(
            GlanceModifier.size(metrics.dotSize.dp).background(
              if (day.status == AJFitDayStatus.COMPLETED || day.status == AJFitDayStatus.TODAY_COMPLETED) AJFitWidgetColors.primary else AJFitWidgetColors.surface
            ).cornerRadius(metrics.dotSize.dp),
          ) {}
          Spacer(GlanceModifier.width(4.dp))
        }
      }
    }
  }
}

// ---- Frequency ----------------------------------------------------------------

private data class AJFitFrequencyGrid(val cell: Int, val gap: Int, val cornerRadius: Int)

/**
 * Cell size is solved from the real available space for the resolved column
 * count rather than hand-picked per breakpoint, so a layout change to
 * padding/columns can't silently reintroduce an overflow (the horizontal
 * 15x2 case previously overflowed its row: 15*14dp + 14*3dp = 252dp into a
 * ~222dp usable width).
 */
private fun frequencyGrid(size: DpSize, columns: Int, rows: Int): AJFitFrequencyGrid {
  val usableWidth = size.width.value - rootPadding.value * 2
  val usableHeight = size.height.value - rootPadding.value * 2
  val reservedHeight = 20f + 20f + 8f * 2 // header row + footer row + two spacers, see FrequencyWidget
  val gap = if (size.height.value >= 190f) 6f else if (columns == 15) 3f else 2.5f
  val cellFromWidth = (usableWidth - gap * (columns - 1)) / columns
  val cellFromHeight = (usableHeight - reservedHeight - gap * (rows - 1)) / rows
  val cell = minOf(cellFromWidth, cellFromHeight).coerceIn(7f, 30f)
  return AJFitFrequencyGrid(cell.toInt(), gap.toInt().coerceAtLeast(1), (cell / 3.2f).toInt().coerceAtLeast(2))
}

@Composable private fun FrequencyWidget(window: AJFitFrequencyWindow) {
  val size = LocalSize.current
  val columns = AJFitWidgetLayout.frequencyColumns(size.width.value, size.height.value)
  val dates = frequencyDates(window.startLocalDate)
  val large = size.height.value >= 190f
  val slots = AJFitWidgetLayout.frequencySlots(columns, window.startWeekday)
  val rows = (slots.size + columns - 1) / columns
  val grid = frequencyGrid(size, columns, rows)
  val titleSize = if (large) 13 else if (size.height.value < 150f) 10 else 11
  val logoSize = if (large) 26 else if (size.height.value < 150f) 17 else 20
  val footerSize = if (large) 12 else 9

  Column(GlanceModifier.fillMaxSize()) {
    Header("FREQUÊNCIA", titleSize, logoSize)
    Spacer(GlanceModifier.defaultWeight())
    slots.chunked(columns).forEachIndexed { rowIndex, row ->
      Row(GlanceModifier.fillMaxWidth(), horizontalAlignment = Alignment.Horizontal.CenterHorizontally) {
        row.forEach { index ->
          if (index == null) {
            Spacer(GlanceModifier.size(grid.cell.dp))
          } else {
            Box(
              GlanceModifier.size(grid.cell.dp).background(
                if (dates[index] in window.completedLocalDates) AJFitWidgetColors.primary else AJFitWidgetColors.surface
              ).cornerRadius(grid.cornerRadius.dp),
            ) {}
          }
          if (index != row.last()) Spacer(GlanceModifier.width(grid.gap.dp))
        }
      }
      if (rowIndex != rows - 1) Spacer(GlanceModifier.height(grid.gap.dp))
    }
    Spacer(GlanceModifier.defaultWeight())
    Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
      Box(GlanceModifier.size(7.dp).background(AJFitWidgetColors.primary).cornerRadius(7.dp)) {}
      Spacer(GlanceModifier.width(5.dp))
      Text("${window.completedLocalDates.size} treinos", style = TextStyle(AJFitWidgetColors.muted, fontSize = footerSize.sp), maxLines = 1)
      Spacer(GlanceModifier.defaultWeight())
      Text("30 DIAS", style = TextStyle(AJFitWidgetColors.faint, fontSize = footerSize.sp, fontFamily = androidx.glance.text.FontFamily.Monospace), maxLines = 1)
    }
  }
}

private fun dayDrawable(status: AJFitDayStatus): Int = when (status) {
  AJFitDayStatus.COMPLETED, AJFitDayStatus.TODAY_COMPLETED, AJFitDayStatus.FULFILLED_EARLY -> R.drawable.ajfit_widget_day_completed
  AJFitDayStatus.MISSED -> R.drawable.ajfit_widget_day_missed
  AJFitDayStatus.TODAY_PENDING -> R.drawable.ajfit_widget_day_pending
  AJFitDayStatus.ACTIVE_RECOVERY -> R.drawable.ajfit_widget_day_recovery
  else -> R.drawable.ajfit_widget_day_empty
}

private fun monthName(month: Int) = listOf("JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO")[month - 1]

private fun frequencyDates(start: String): List<String> {
  val format = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC"); isLenient = false }
  val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = requireNotNull(format.parse(start)) }
  return List(30) { index -> format.format(calendar.time).also { if (index < 29) calendar.add(Calendar.DAY_OF_MONTH, 1) } }
}
