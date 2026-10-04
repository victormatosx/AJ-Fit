import Foundation

/// Shared read/write surface for the Home Screen Widgets snapshot, usable by
/// both the main app (via `AJFitWidgetsModule`) and the future
/// `AJFitWidgetsExtension` target (Phase 3) — mirrors how
/// `AJFitSharedAuth.swift` is shared between the main app and
/// `AJFitRestActivityExtension`. Contains NO business logic: it only knows
/// how to persist/retrieve/validate a JSON string's structural shell
/// (parseable JSON with a known integer `schemaVersion`), never what the
/// `status`/`streak`/activity fields inside it mean.
public enum AJFitWidgetsStorage {
  /// Must match `WIDGETS_APP_GROUP_IDENTIFIER` in `plugins/widgets-bridge/index.js`.
  public static let appGroupIdentifier = "group.com.ajfit.app.widgets"
  private static let snapshotKey = "ajfit.widgets.snapshot.v1"

  /// `schemaVersion` values this binary knows how to treat as "present and
  /// structurally OK." Mirrors `isSupportedWidgetSnapshotVersion` in
  /// `src/widgets/widgetSnapshot.ts` — hand-kept in sync today (single
  /// integer, changes rarely); if a second schema version ever ships, keep
  /// both lists updated together.
  private static let supportedSchemaVersions: Set<Int> = [1, 2]

  private static var defaults: UserDefaults? {
    UserDefaults(suiteName: appGroupIdentifier)
  }

  /// Overwrites the stored snapshot unconditionally — `UserDefaults` swaps a
  /// key's value in as one atomic unit, so a concurrent reader can only ever
  /// see the old complete value or the new complete value, never a
  /// half-written string. That atomicity is the entire reason this uses
  /// `UserDefaults(suiteName:)` rather than a raw JSON file in the shared
  /// container (which would need its own temp-file-then-rename dance to get
  /// the same guarantee) — see the Phase 2 report for the full comparison.
  ///
  /// Rejects (logs, never throws/crashes) a payload that isn't even
  /// parseable JSON with a recognized integer `schemaVersion` — this is the
  /// ONLY validation this layer ever does; it never inspects
  /// `status`/`streak`/activity fields, which remain TypeScript's authority.
  @discardableResult
  public static func write(json: String) -> Bool {
    guard isStructurallyValid(json: json) else { return false }
    guard let defaults else { return false }
    defaults.set(json, forKey: snapshotKey)
    return true
  }

  /// The "no data" state is the KEY being absent, never an empty/placeholder
  /// JSON blob — a future reader must treat "missing" and "present-but-
  /// invalid" identically (see `isStructurallyValid`), both as "nothing to
  /// show," never as a different code path.
  public static func clear() {
    defaults?.removeObject(forKey: snapshotKey)
  }

  /// Raw, unparsed. Debug/QA only — a real production reader (Phase 3/4)
  /// must still run its own structural check before trusting this; nothing
  /// upstream of `UserDefaults` guarantees the value wasn't written by an
  /// older/newer binary with a different schema.
  public static func readRaw() -> String? {
    defaults?.string(forKey: snapshotKey)
  }

  private static func isStructurallyValid(json: String) -> Bool {
    guard let data = json.data(using: .utf8) else { return false }
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      return false
    }
    guard let schemaVersion = object["schemaVersion"] as? Int else { return false }
    return supportedSchemaVersions.contains(schemaVersion)
  }
}
