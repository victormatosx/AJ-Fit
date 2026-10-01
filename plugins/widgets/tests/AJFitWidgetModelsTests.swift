import Foundation

private var failures = 0
private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
  if !condition() { failures += 1; fputs("FAIL: \(message)\n", stderr) }
}

private func readyDictionary(effectiveAtMs: Double = 1_000, future: [[String: Any]] = [],
                             mode: String = "fixed", unit: String = "obligations",
                             complete: Bool = true, daysInMonth: Int = 30,
                             startWeekday: String = "MON") -> [String: Any] {
  let statuses = ["COMPLETED", "TODAY_COMPLETED", "TODAY_PENDING", "MISSED", "UPCOMING", "FULFILLED_EARLY", "ACTIVE_RECOVERY"]
  let weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
  return [
    "schemaVersion": 1, "status": "READY", "localDate": "2026-09-01",
    "generatedAtMs": 2_000, "effectiveAtMs": effectiveAtMs,
    "streak": ["scheduleMode": mode, "unit": unit, "current": 12, "complete": complete],
    "weeklyActivity": weekdays.enumerated().map { index, weekday in
      ["localDate": "2026-09-0\(index + 1)", "weekday": weekday,
       "status": statuses[index], "isToday": index == 1] as [String: Any]
    },
    "monthlyActivity": ["year": 2026, "month": 9, "daysInMonth": daysInMonth,
      "startWeekday": startWeekday, "completedLocalDates": ["2026-09-01"]],
    "frequencyWindow": ["startLocalDate": "2026-08-03", "endLocalDate": "2026-09-01",
      "startWeekday": "MON", "completedLocalDates": ["2026-08-04", "2026-09-01"]],
    "futureEntries": future,
  ]
}

private func json(_ dictionary: [String: Any]) -> String {
  String(data: try! JSONSerialization.data(withJSONObject: dictionary), encoding: .utf8)!
}

@main
private struct AJFitWidgetModelsTestRunner {
static func main() {
expect(AJFitSnapshotDecoder.decode(nil) == nil, "missing snapshot")
expect(AJFitSnapshotDecoder.decode("not-json") == nil, "corrupt JSON")
expect(AJFitSnapshotDecoder.decode(json(["schemaVersion": 2, "status": "UNAUTHENTICATED"])) == nil,
       "unknown schema")
expect(AJFitSnapshotDecoder.decode(json(["schemaVersion": 1, "status": "UNAUTHENTICATED"]))?.status == "UNAUTHENTICATED",
       "unauthenticated")
expect(AJFitSnapshotDecoder.decode(json(["schemaVersion": 1, "status": "NO_PROGRAM", "localDate": "2026-09-01", "generatedAtMs": 1]))?.status == "NO_PROGRAM",
       "no program")

let fixed = AJFitSnapshotDecoder.decode(json(readyDictionary()))
expect(fixed?.currentFields()?.streak.unit == "obligations", "fixed unit")
expect(fixed?.currentFields()?.weeklyActivity.map(\.status).count == 7, "all weekly statuses decode")
for status in AJFitDayStatus.allCases {
  var payload = readyDictionary()
  var week = payload["weeklyActivity"] as! [[String: Any]]
  week[0]["status"] = status.rawValue
  payload["weeklyActivity"] = week
  expect(AJFitSnapshotDecoder.decode(json(payload)) != nil, "weekly status \(status.rawValue)")
}
let flexible = AJFitSnapshotDecoder.decode(json(readyDictionary(mode: "flexible", unit: "weeks")))
expect(flexible?.currentFields()?.streak.unitLabel == "semanas", "flexible week unit")
let incomplete = AJFitSnapshotDecoder.decode(json(readyDictionary(complete: false)))
expect(incomplete?.currentFields()?.streak.displayValue == "12+", "incomplete is a lower bound")

for days in [28, 29, 30, 31] {
  expect(AJFitSnapshotDecoder.decode(json(readyDictionary(daysInMonth: days))) != nil, "month with \(days) days")
}
for weekday in AJFitWeekday.allCases.map(\.rawValue) {
  expect(AJFitSnapshotDecoder.decode(json(readyDictionary(startWeekday: weekday))) != nil,
         "month starting \(weekday)")
}
expect(fixed?.currentFields()?.frequencyWindow.completedLocalDates.count == 2, "frequency window")

let now = Date(timeIntervalSince1970: 2)
let noFuture = AJFitTimelineResolver.resolve(snapshot: fixed, now: now)
expect(noFuture.count == 1, "timeline without future entries")
expect(noFuture[0].date == now, "current timeline entry starts now")

var future = readyDictionary(effectiveAtMs: 3_000)
future.removeValue(forKey: "schemaVersion"); future.removeValue(forKey: "status")
future.removeValue(forKey: "localDate"); future.removeValue(forKey: "generatedAtMs")
future["effectiveLocalDate"] = "2026-09-02"
future.removeValue(forKey: "futureEntries")
let withFuture = AJFitSnapshotDecoder.decode(json(readyDictionary(future: [future])))
let timeline = AJFitTimelineResolver.resolve(snapshot: withFuture, now: now)
expect(timeline.count == 2, "timeline with future entry")
expect(timeline[1].date.timeIntervalSince1970 == 3, "effectiveAtMs converts directly to seconds")

let unavailable = AJFitTimelineResolver.resolve(snapshot: nil, now: now)
expect(unavailable.first?.content == .empty(.unavailable), "missing/App Group failure is safe")

func calendarDays(_ daysInMonth: Int, _ start: AJFitWeekday) -> [Int] {
  AJFitCalendarLayout.slots(daysInMonth: daysInMonth, startWeekday: start).compactMap {
    if case .day(let day) = $0.content { return day }
    return nil
  }
}
for (days, start) in [(28, AJFitWeekday.sun), (29, .mon), (30, .sat), (31, .fri)] {
  let daysShown = calendarDays(days, start)
  expect(daysShown.first == 1, "calendar always contains day 1")
  expect(daysShown.last == days, "calendar always contains its last day")
  expect(daysShown == Array(1...days), "calendar contains every day exactly once")
  let slots = AJFitCalendarLayout.slots(daysInMonth: days, startWeekday: start)
  expect(Set(slots.map(\.id)).count == slots.count, "calendar slot IDs are unique")
  expect(slots.count % 7 == 0, "calendar has complete rows")
}
expect(AJFitCalendarLayout.slots(daysInMonth: 31, startWeekday: .fri).count == 42,
       "31-day month starting Friday uses six rows")
expect(calendarDays(31, .thu) == Array(1...31),
       "empty completion data cannot remove October days")

if failures > 0 { exit(1) }
print("AJFitWidgetModelsTests: PASS")
}
}
