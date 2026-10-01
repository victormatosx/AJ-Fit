package com.ajfit.widgets

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * Shared read/write surface for the Home Screen Widgets snapshot — a
 * dedicated SharedPreferences file (`ajfit_widgets`), separate from
 * `ajfit_rest_activity_permissions` (`AJFitRestActivityModule.kt`), so
 * neither surface's storage can be confused with the other's. No business
 * logic: only knows how to persist/retrieve/validate a JSON string's
 * structural shell (parseable JSON with a known integer `schemaVersion`).
 */
object AJFitWidgetsStorage {
  const val PREFERENCES_FILE = "ajfit_widgets"
  const val SNAPSHOT_KEY = "ajfit.widgets.snapshot.v1"

  // Mirrors `isSupportedWidgetSnapshotVersion` in
  // `src/widgets/widgetSnapshot.ts` — hand-kept in sync today (single
  // integer, changes rarely).
  private val SUPPORTED_SCHEMA_VERSIONS = setOf(1)

  private fun preferences(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFERENCES_FILE, Context.MODE_PRIVATE)

  /**
   * `SharedPreferences.Editor.apply()` persists the whole backing file as a
   * single atomic write (temp-file-then-rename internally) — a concurrent
   * reader can only ever see the old complete file or the new complete
   * file, never a half-written value. Same atomicity guarantee
   * `UserDefaults(suiteName:)` gives on iOS for one key, with no extra
   * dependency (DataStore) needed at this payload size — see the Phase 2
   * report for the full comparison.
   */
  fun write(context: Context, json: String): Boolean {
    if (!isStructurallyValid(json)) return false
    if (!preferences(context).edit().putString(SNAPSHOT_KEY, json).commit()) return false
    AJFitWidgetCoordinator.snapshotChanged(context)
    return true
  }

  /** The "no data" state is the KEY being absent, never an empty/placeholder JSON blob. */
  fun clear(context: Context) {
    preferences(context).edit().remove(SNAPSHOT_KEY).commit()
    AJFitWidgetCoordinator.snapshotChanged(context)
  }

  /** Raw, unparsed. Debug/QA only. */
  fun readRaw(context: Context): String? = preferences(context).getString(SNAPSHOT_KEY, null)

  private fun isStructurallyValid(json: String): Boolean = try {
    val schemaVersion = JSONObject(json).getInt("schemaVersion")
    schemaVersion in SUPPORTED_SCHEMA_VERSIONS
  } catch (error: Throwable) {
    false
  }
}
