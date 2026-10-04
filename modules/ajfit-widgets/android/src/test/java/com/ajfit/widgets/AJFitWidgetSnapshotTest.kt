package com.ajfit.widgets

import org.junit.Assert.*
import org.junit.Test

class AJFitWidgetSnapshotTest {
  @Test fun decoderStatesAndFailures() {
    assertEquals("READY", AJFitWidgetSnapshotDecoder.decode(ready())?.status)
    assertEquals("UNAUTHENTICATED", AJFitWidgetSnapshotDecoder.decode("{\"schemaVersion\":1,\"status\":\"UNAUTHENTICATED\"}")?.status)
    assertEquals("NO_PROGRAM", AJFitWidgetSnapshotDecoder.decode("{\"schemaVersion\":1,\"status\":\"NO_PROGRAM\",\"localDate\":\"2026-09-01\",\"generatedAtMs\":1}")?.status)
    assertNull(AJFitWidgetSnapshotDecoder.decode("not-json"))
    assertEquals("UNAUTHENTICATED", AJFitWidgetSnapshotDecoder.decode("{\"schemaVersion\":2,\"status\":\"UNAUTHENTICATED\"}")?.status)
    assertNull(AJFitWidgetSnapshotDecoder.decode("{\"schemaVersion\":3,\"status\":\"UNAUTHENTICATED\"}"))
  }

  @Test fun effectiveEntryBoundariesAndMultipleFutureEntries() {
    val snapshot = AJFitWidgetSnapshotDecoder.decode(ready())!!
    val before = AJFitWidgetEntryResolver.resolve(snapshot, 1_999) as AJFitWidgetContent.Ready
    val boundary = AJFitWidgetEntryResolver.resolve(snapshot, 2_000) as AJFitWidgetContent.Ready
    val after = AJFitWidgetEntryResolver.resolve(snapshot, 3_500) as AJFitWidgetContent.Ready
    assertEquals(1, before.fields.streak.current)
    assertEquals(2, boundary.fields.streak.current)
    assertEquals(3, after.fields.streak.current)
    assertEquals(2_000L, before.nextEffectiveAtMs)
    assertNull(after.nextEffectiveAtMs)
  }

  @Test fun calendarsCoverEveryDayAndSixRows() {
    for (days in 28..31) for (weekday in AJFitWeekday.entries) {
      val slots = AJFitWidgetLayout.calendarSlots(days, weekday)
      assertEquals((1..days).toList(), slots.filterNotNull())
      assertEquals(0, slots.size % 7)
    }
    assertEquals(42, AJFitWidgetLayout.calendarSlots(31, AJFitWeekday.FRI).size)
  }

  @Test fun frequencyAlwaysHasThirtyDaysAndResponsiveModes() {
    assertEquals(30, AJFitWidgetLayout.frequencyCells().count())
    assertEquals(7, AJFitWidgetLayout.frequencyColumns(150f, 150f))
    assertEquals(15, AJFitWidgetLayout.frequencyColumns(300f, 130f))
    assertEquals(7, AJFitWidgetLayout.frequencyColumns(300f, 260f))
    assertEquals(30, AJFitWidgetLayout.frequencySlots(15, AJFitWeekday.SUN).filterNotNull().size)
    assertEquals(36, AJFitWidgetLayout.frequencySlots(7, AJFitWeekday.SUN).size)
  }

  @Test fun fixedFlexibleAndIncompleteStreakPresentation() {
    assertEquals("1", AJFitStreak("fixed", "obligations", 1, true).displayValue)
    assertEquals("TREINO", AJFitStreak("fixed", "obligations", 1, true).unitLabel)
    assertEquals("SEMANAS", AJFitStreak("flexible", "weeks", 2, true).unitLabel)
    assertEquals("12+", AJFitStreak("fixed", "obligations", 12, false).displayValue)
  }

  @Test fun workoutProjectionDecodesAndExpires() {
    val raw = ready().replace(
      "\"schemaVersion\":1",
      "\"schemaVersion\":2,\"workout\":{\"state\":\"IN_PROGRESS\",\"eyebrow\":\"TREINO EM ANDAMENTO\",\"workoutName\":\"Lower 1\",\"exerciseCount\":5,\"setCount\":18,\"exercisesLabel\":\"5 EXERCÍCIOS\",\"setsLabel\":\"18 SÉRIES\",\"metricsLabel\":\"5 EXERCÍCIOS · 18 SÉRIES\",\"dateLabel\":\"TER., 06 OUT.\",\"todayLabel\":\"HOJE\",\"dateBecomesTodayAtMs\":4500,\"bodyMap\":{\"sex\":\"m\",\"primaryMuscles\":[\"quads\",\"glutes\"],\"secondaryMuscles\":[\"calves\"]},\"staleAtMs\":5000}",
    )
    val snapshot = AJFitWidgetSnapshotDecoder.decode(raw)
    val workout = AJFitWorkoutResolver.resolve(snapshot, 4_999)
    assertEquals("Lower 1", workout?.workoutName)
    assertEquals("m", workout?.bodyMap?.sex)
    assertEquals(listOf("quads", "glutes"), workout?.bodyMap?.primaryMuscles)
    assertEquals("TER., 06 OUT.", workout?.displayedDateLabel(4_499))
    assertEquals("HOJE", workout?.displayedDateLabel(4_500))
    assertNull(AJFitWorkoutResolver.resolve(snapshot, 5_000))
  }

  private fun ready(): String {
    fun fields(streak: Int) = """
      "streak":{"scheduleMode":"fixed","unit":"obligations","current":$streak,"complete":true},
      "weeklyActivity":[
        {"localDate":"2026-09-01","weekday":"MON","status":"COMPLETED","isToday":true},
        {"localDate":"2026-09-02","weekday":"TUE","status":"MISSED","isToday":false},
        {"localDate":"2026-09-03","weekday":"WED","status":"REST","isToday":false},
        {"localDate":"2026-09-04","weekday":"THU","status":"TODAY_PENDING","isToday":false},
        {"localDate":"2026-09-05","weekday":"FRI","status":"UPCOMING","isToday":false},
        {"localDate":"2026-09-06","weekday":"SAT","status":"FULFILLED_EARLY","isToday":false},
        {"localDate":"2026-09-07","weekday":"SUN","status":"ACTIVE_RECOVERY","isToday":false}],
      "monthlyActivity":{"year":2026,"month":9,"daysInMonth":30,"startWeekday":"TUE","completedLocalDates":["2026-09-01"]},
      "frequencyWindow":{"startLocalDate":"2026-08-03","endLocalDate":"2026-09-01","startWeekday":"MON","completedLocalDates":["2026-09-01"]}
    """.trimIndent()
    return """{"schemaVersion":1,"status":"READY","localDate":"2026-09-01","generatedAtMs":1500,"effectiveAtMs":1000,${fields(1)},"futureEntries":[{"effectiveLocalDate":"2026-09-02","effectiveAtMs":2000,${fields(2)}},{"effectiveLocalDate":"2026-09-03","effectiveAtMs":3000,${fields(3)}}]}"""
  }
}
