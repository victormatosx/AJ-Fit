package com.ajfit.widgets

import org.json.JSONArray
import org.json.JSONObject

enum class AJFitWeekday { MON, TUE, WED, THU, FRI, SAT, SUN }
enum class AJFitDayStatus { COMPLETED, TODAY_COMPLETED, TODAY_PENDING, MISSED, UPCOMING, FULFILLED_EARLY, ACTIVE_RECOVERY, REST, BEFORE_PROGRAM }

data class AJFitStreak(val scheduleMode: String, val unit: String, val current: Int, val complete: Boolean) {
  val displayValue get() = if (complete) "$current" else "$current+"
  val unitLabel get() = when (unit) {
    "weeks" -> if (current == 1) "SEMANA" else "SEMANAS"
    else -> if (current == 1) "TREINO" else "TREINOS"
  }
}
data class AJFitWeekEntry(val localDate: String, val weekday: AJFitWeekday, val status: AJFitDayStatus, val isToday: Boolean)
data class AJFitMonthlyActivity(val year: Int, val month: Int, val daysInMonth: Int, val startWeekday: AJFitWeekday, val completedLocalDates: Set<String>)
data class AJFitFrequencyWindow(val startLocalDate: String, val endLocalDate: String, val startWeekday: AJFitWeekday, val completedLocalDates: Set<String>)
data class AJFitReadyFields(val streak: AJFitStreak, val weeklyActivity: List<AJFitWeekEntry>, val monthlyActivity: AJFitMonthlyActivity, val frequencyWindow: AJFitFrequencyWindow)
data class AJFitTimedFields(val effectiveAtMs: Long, val fields: AJFitReadyFields)
data class AJFitWorkout(
  val state: String,
  val eyebrow: String,
  val workoutName: String,
  val exerciseCount: Int,
  val setCount: Int,
  val exercisesLabel: String,
  val setsLabel: String,
  val metricsLabel: String,
  val dateLabel: String?,
  val todayLabel: String?,
  val dateBecomesTodayAtMs: Long?,
  val bodyMap: AJFitWorkoutBodyMap?,
  val staleAtMs: Long,
) {
  fun displayedDateLabel(nowMs: Long): String? =
    if (todayLabel != null && dateBecomesTodayAtMs != null && nowMs >= dateBecomesTodayAtMs) todayLabel else dateLabel
}

data class AJFitWorkoutBodyMap(
  val sex: String,
  val primaryMuscles: List<String>,
  val secondaryMuscles: List<String>,
)

sealed interface AJFitWidgetContent {
  data class Ready(val fields: AJFitReadyFields, val nextEffectiveAtMs: Long?) : AJFitWidgetContent
  data class Empty(val reason: Reason) : AJFitWidgetContent
  enum class Reason { UNAUTHENTICATED, NO_PROGRAM, UNAVAILABLE }
}

data class AJFitDecodedSnapshot(
  val status: String,
  val current: AJFitTimedFields? = null,
  val future: List<AJFitTimedFields> = emptyList(),
  val workout: AJFitWorkout? = null,
)

object AJFitWidgetSnapshotDecoder {
  fun decode(raw: String?): AJFitDecodedSnapshot? {
    return try {
    if (raw == null) return null
    val root = JSONObject(raw)
    if (root.optInt("schemaVersion", -1) !in setOf(1, 2)) return null
    when (val status = root.optString("status")) {
      "UNAUTHENTICATED" -> AJFitDecodedSnapshot(status)
      "NO_PROGRAM" -> AJFitDecodedSnapshot(status)
      "READY" -> {
        val current = AJFitTimedFields(root.requiredLong("effectiveAtMs"), decodeFields(root))
        val future = root.optJSONArray("futureEntries")?.objects()?.map {
          AJFitTimedFields(it.requiredLong("effectiveAtMs"), decodeFields(it))
        } ?: emptyList()
        AJFitDecodedSnapshot(status, current, future, decodeWorkout(root.optJSONObject("workout")))
      }
      else -> null
    }
    } catch (_: Throwable) { null }
  }

  private fun decodeWorkout(json: JSONObject?): AJFitWorkout? {
    if (json == null) return null
    val state = json.getString("state").also { require(it == "NEXT" || it == "IN_PROGRESS") }
    return AJFitWorkout(
      state = state,
      eyebrow = json.getString("eyebrow").also { require(it.isNotBlank()) },
      workoutName = json.getString("workoutName").also { require(it.isNotBlank()) },
      exerciseCount = json.getInt("exerciseCount").also { require(it >= 0) },
      setCount = json.getInt("setCount").also { require(it >= 0) },
      exercisesLabel = json.getString("exercisesLabel"),
      setsLabel = json.getString("setsLabel"),
      metricsLabel = json.getString("metricsLabel"),
      dateLabel = json.optString("dateLabel").takeIf { !json.isNull("dateLabel") && it.isNotBlank() },
      todayLabel = json.optString("todayLabel").takeIf { !json.isNull("todayLabel") && it.isNotBlank() },
      dateBecomesTodayAtMs = json.optLong("dateBecomesTodayAtMs").takeIf { !json.isNull("dateBecomesTodayAtMs") && it >= 0 },
      bodyMap = decodeBodyMap(json.optJSONObject("bodyMap")),
      staleAtMs = json.requiredLong("staleAtMs"),
    )
  }

  private fun decodeBodyMap(json: JSONObject?): AJFitWorkoutBodyMap? {
    if (json == null) return null
    val sex = json.getString("sex").also { require(it == "m" || it == "f") }
    fun muscles(key: String): List<String> = json.getJSONArray(key).strings().also { values ->
      require(values.all(SUPPORTED_MUSCLES::contains))
    }
    val primary = muscles("primaryMuscles").also { require(it.isNotEmpty()) }
    return AJFitWorkoutBodyMap(sex, primary, muscles("secondaryMuscles"))
  }

  private fun decodeFields(json: JSONObject): AJFitReadyFields {
    val streakJson = json.getJSONObject("streak")
    val streak = AJFitStreak(
      streakJson.getString("scheduleMode"), streakJson.getString("unit"),
      streakJson.getInt("current").also { require(it >= 0) }, streakJson.getBoolean("complete")
    )
    val week = json.getJSONArray("weeklyActivity").objects().map {
      AJFitWeekEntry(it.requiredDate("localDate"), enumValueOf(it.getString("weekday")),
        enumValueOf(it.getString("status")), it.getBoolean("isToday"))
    }.also { require(it.size == 7) }
    val monthJson = json.getJSONObject("monthlyActivity")
    val month = AJFitMonthlyActivity(
      monthJson.getInt("year"), monthJson.getInt("month").also { require(it in 1..12) },
      monthJson.getInt("daysInMonth").also { require(it in 28..31) },
      enumValueOf(monthJson.getString("startWeekday")), monthJson.getJSONArray("completedLocalDates").dates()
    )
    val frequencyJson = json.getJSONObject("frequencyWindow")
    val frequency = AJFitFrequencyWindow(
      frequencyJson.requiredDate("startLocalDate"), frequencyJson.requiredDate("endLocalDate"),
      enumValueOf(frequencyJson.getString("startWeekday")), frequencyJson.getJSONArray("completedLocalDates").dates()
    )
    return AJFitReadyFields(streak, week, month, frequency)
  }

  private fun JSONObject.requiredLong(key: String): Long = getLong(key).also { require(it >= 0) }
  private fun JSONObject.requiredDate(key: String): String = getString(key).also { require(DATE.matches(it)) }
  private fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }
  private fun JSONArray.dates() = (0 until length()).map { getString(it).also { date -> require(DATE.matches(date)) } }.toSet()
  private fun JSONArray.strings() = (0 until length()).map { getString(it) }
  private val DATE = Regex("\\d{4}-\\d{2}-\\d{2}")
  private val SUPPORTED_MUSCLES = setOf(
    "chest", "lats", "upper_back", "traps", "lower_back",
    "front_deltoid", "side_deltoid", "rear_deltoid", "biceps", "triceps",
    "forearms", "quads", "hamstrings", "glutes", "adductors", "abductors",
    "calves", "abs",
  )
}

object AJFitWorkoutResolver {
  fun resolve(snapshot: AJFitDecodedSnapshot?, nowMs: Long): AJFitWorkout? {
    if (snapshot?.status != "READY") return null
    return snapshot.workout?.takeIf { nowMs < it.staleAtMs }
  }
}

object AJFitWidgetEntryResolver {
  fun resolve(snapshot: AJFitDecodedSnapshot?, nowMs: Long): AJFitWidgetContent {
    if (snapshot == null) return AJFitWidgetContent.Empty(AJFitWidgetContent.Reason.UNAVAILABLE)
    if (snapshot.status == "UNAUTHENTICATED") return AJFitWidgetContent.Empty(AJFitWidgetContent.Reason.UNAUTHENTICATED)
    if (snapshot.status == "NO_PROGRAM") return AJFitWidgetContent.Empty(AJFitWidgetContent.Reason.NO_PROGRAM)
    val entries = listOfNotNull(snapshot.current) + snapshot.future
    if (entries.isEmpty()) return AJFitWidgetContent.Empty(AJFitWidgetContent.Reason.UNAVAILABLE)
    val selected = entries.sortedBy { it.effectiveAtMs }.lastOrNull { it.effectiveAtMs <= nowMs } ?: entries.minBy { it.effectiveAtMs }
    val next = entries.map { it.effectiveAtMs }.filter { it > nowMs }.minOrNull()
    return AJFitWidgetContent.Ready(selected.fields, next)
  }
}

object AJFitWidgetLayout {
  val sundayFirst = listOf(AJFitWeekday.SUN, AJFitWeekday.MON, AJFitWeekday.TUE, AJFitWeekday.WED, AJFitWeekday.THU, AJFitWeekday.FRI, AJFitWeekday.SAT)
  fun calendarSlots(days: Int, start: AJFitWeekday): List<Int?> {
    val leading = sundayFirst.indexOf(start).coerceAtLeast(0)
    val values = List(leading) { null } + (1..days).map { it }
    return values + List((7 - values.size % 7) % 7) { null }
  }
  fun frequencyColumns(widthDp: Float, heightDp: Float): Int = when {
    widthDp >= 250f && heightDp < 190f -> 15
    else -> 7
  }
  fun frequencyCells(): IntRange = 0 until 30
  fun frequencySlots(columns: Int, start: AJFitWeekday): List<Int?> =
    if (columns == 15) frequencyCells().map { it }
    else List(AJFitWeekday.entries.indexOf(start).coerceAtLeast(0)) { null } + frequencyCells().map { it }
}
