import Foundation
import Security

/**
 * External Set Completion — Workout Action Capability cache (architectural
 * audit, 2026-09: REPLACES the earlier design that cached a Firebase ID
 * token + App Check token in plain `UserDefaults`, which had no way to
 * refresh either token once the main app stopped running, and stored a
 * long-lived credential in an unencrypted-at-rest container).
 *
 * What's cached now is fundamentally different and simpler: a short-lived,
 * self-contained, server-signed Workout Action Capability (see
 * `functions/src/workoutLifecycle/workoutActionCapability.ts`) — never a
 * Firebase ID token, never an App Check token. It is minted ONCE per
 * workout by the main app (via `issueWorkoutActionCapability`, which IS
 * App-Check-protected — the main app has real App Attest) and needs no
 * refresh from the extension at all: it's valid on its own until `exp`
 * (a few hours, generous for a real training session) or until revoked by
 * a fresh issuance. The extension never re-derives or refreshes identity —
 * it only presents this one token to `externalWorkoutAction`, a dedicated
 * capability-gated HTTP endpoint (never the App-Check-protected
 * `completeWorkoutSet` callable the main app itself uses).
 *
 * Storage: the iOS Keychain (not `UserDefaults`) with the App Group access
 * group, so the credential is protected by Keychain ACLs (encrypted at
 * rest, `kSecAttrAccessibleAfterFirstUnlock` — usable in the background
 * without requiring the device to be unlocked at the exact moment, but
 * still tied to the device passcode being set at least once) and shared
 * between the main app and the widget extension without a plaintext
 * App-Group UserDefaults copy of a credential.
 *
 * `public` (production audit, 2026-09 — External Set Completion target-membership
 * fix): `CompleteSetIntent`/`AdjustStepperIntent`/`RestActionsIntent`/
 * `CompleteWorkoutSetClient` are now ALSO compiled into the main app target
 * (see `plugins/rest-activity/index.js`'s `APP_TARGET_SOURCE_FILES`), where
 * they reach this type via `import AJFitRestActivity` (this file's own
 * module, the `AJFitRestActivity` CocoaPod) rather than same-target file
 * visibility. Only the members those files actually call are `public`.
 */
public enum AJFitSharedAuth {
  /// Must match the App Group entitlement declared in `app.json` (`ios.entitlements`) and the extension's own entitlements (`plugins/rest-activity/index.js`).
  static let appGroupId = "group.com.ajfit.app.restactivity"
  /// Keychain sharing access group — same App Group identifier, conventionally prefixed with the team's `AppIdentifierPrefix` at read/write time via `kSecAttrAccessGroup`.
  static let keychainAccessGroup = "\(appGroupId)"

  private static let service = "com.ajfit.app.workoutActionCapability"
  private static let account = "current"

  public struct Capability: Codable {
    public let token: String
    public let expiresAtMs: Double
    /// `https://{region}-{projectId}.cloudfunctions.net/externalWorkoutAction` — cached alongside the token so the extension never hardcodes a project/region.
    public let endpointUrl: String
    public let executionId: String

    public var isExpired: Bool {
      // Small safety margin — never attempt a call with a token that's
      // about to expire mid-flight.
      Date().timeIntervalSince1970 * 1000 > expiresAtMs - 30_000
    }
  }

  public static func store(_ capability: Capability) {
    guard let data = try? JSONEncoder().encode(capability) else { return }
    var query = baseQuery()
    SecItemDelete(query as CFDictionary)
    query[kSecValueData as String] = data
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(query as CFDictionary, nil)
  }

  public static func current() -> Capability? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return try? JSONDecoder().decode(Capability.self, from: data)
  }

  /// Called on sign-out (and when a workout ends) — a stale capability must never outlive the identity/session it was minted for.
  public static func clear() {
    SecItemDelete(baseQuery() as CFDictionary)
  }

  private static func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: keychainAccessGroup,
    ]
  }
}
