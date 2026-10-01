package com.ajfit.widgets

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val LOG_TAG = "AJFitWidgets"

/**
 * Deliberately tiny — see `modules/ajfit-widgets/index.ts`'s doc comment.
 * Every Function here is a direct pass-through to `AJFitWidgetsStorage`;
 * none of them decide anything about what the snapshot means.
 */
class AJFitWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AJFitWidgets")

    Function("writeSnapshot") { json: String ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        Log.w(LOG_TAG, "[ajfit-widgets:android] native_error operation=write reason=context")
        return@Function
      }
      // A malformed payload here is a JS-side bug — `buildWidgetSnapshot` is
      // strongly typed and always produces valid, versioned JSON — not a
      // condition the user can act on.
      if (!AJFitWidgetsStorage.write(context, json)) {
        Log.w(LOG_TAG, "[ajfit-widgets:android] native_error operation=write reason=structurally_invalid")
      }
    }

    Function("clearSnapshot") {
      appContext.reactContext?.applicationContext?.let(AJFitWidgetsStorage::clear)
    }

    Function("readSnapshotForDebug") {
      appContext.reactContext?.applicationContext?.let(AJFitWidgetsStorage::readRaw)
    }

    Function("requestReload") {
      appContext.reactContext?.applicationContext?.let(AJFitWidgetCoordinator::snapshotChanged)
    }
  }
}
