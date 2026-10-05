import Foundation

/**
 * Simple one-shot flag shared between the rest-activity Live Activity
 * extension and the main app via the App Group already used by
 * `AJFitSharedAuth.swift`. This is NOT a capability/token — it carries no
 * identity, grants no network access, and is only ever a session id (plus,
 * for +15s, a plain accumulated second count) the extension wrote when its
 * own in-process Lock Screen buttons ran. The main app consumes (reads-and-
 * clears) it once, on the next foreground, to replay the exact same local
 * `skipRest()`/`addSeconds()` the in-app buttons already call — never a
 * second workout engine.
 */
public enum AJFitRestActivityStorage {
  private static let appGroupId = "group.com.ajfit.app.restactivity"
  private static let pendingFinishKey = "pendingManualRestFinishSessionId"
  private static let pendingAddSecondsSessionIdKey = "pendingAddSecondsSessionId"
  private static let pendingAddSecondsAmountKey = "pendingAddSecondsAmount"

  private static var sharedDefaults: UserDefaults? {
    UserDefaults(suiteName: appGroupId)
  }

  public static func markPendingFinish(sessionId: String) {
    sharedDefaults?.set(sessionId, forKey: pendingFinishKey)
  }

  public static func consumePendingFinish(sessionId: String) -> Bool {
    guard
      let sharedDefaults,
      sharedDefaults.string(forKey: pendingFinishKey) == sessionId
    else { return false }
    sharedDefaults.removeObject(forKey: pendingFinishKey)
    return true
  }

  /// Accumulates across repeated taps while the app isn't running, so three
  /// +15s taps before the next foreground replay exactly +45s — never only
  /// the last one — in the JS engine's own (additive) `addSeconds`.
  public static func markPendingAddSeconds(sessionId: String, seconds: Int) {
    guard let sharedDefaults else { return }
    let existingAmount = sharedDefaults.string(forKey: pendingAddSecondsSessionIdKey) == sessionId
      ? sharedDefaults.integer(forKey: pendingAddSecondsAmountKey)
      : 0
    sharedDefaults.set(sessionId, forKey: pendingAddSecondsSessionIdKey)
    sharedDefaults.set(existingAmount + seconds, forKey: pendingAddSecondsAmountKey)
  }

  /// Returns the accumulated pending seconds (0 when none) and clears them.
  public static func consumePendingAddSeconds(sessionId: String) -> Int {
    guard
      let sharedDefaults,
      sharedDefaults.string(forKey: pendingAddSecondsSessionIdKey) == sessionId
    else { return 0 }
    let amount = sharedDefaults.integer(forKey: pendingAddSecondsAmountKey)
    sharedDefaults.removeObject(forKey: pendingAddSecondsSessionIdKey)
    sharedDefaults.removeObject(forKey: pendingAddSecondsAmountKey)
    return amount
  }
}
