package com.ajfit.restactivity

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.OptimizedRecord

private const val PERMISSION_PREFERENCES = "ajfit_rest_activity_permissions"
private const val PERMISSION_REQUESTED_KEY = "post_notifications_requested"

@OptimizedRecord
data class RestActivityStateRecord(
  @Field val sessionId: String,
  @Field val startedAt: Long,
  @Field val endsAt: Long,
  @Field val exerciseName: String,
  @Field val setIndex: Int,
  @Field val totalSets: Int,
) : Record

class AJFitRestActivityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AJFitRestActivity")

    Function("getCapabilities") {
      val context = appContext.reactContext?.applicationContext
      val available = context?.let(::isNotificationSurfaceAvailable) == true
      Log.i(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] module_available available=${context != null}",
      )
      if (context != null) logPermissionState(context, "capabilities")
      Log.i(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] capabilities available=$available " +
          "surface=${if (available) "android-notification" else "none"}",
      )
      mapOf(
        "available" to available,
        "surface" to if (available) "android-notification" else "none",
      )
    }

    AsyncFunction("start") { state: RestActivityStateRecord, promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] start_received context=false")
        promise.resolve(null)
        return@AsyncFunction
      }

      Log.i(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] start_received startedAt=${state.startedAt} " +
          "endsAt=${state.endsAt} setIndex=${state.setIndex} totalSets=${state.totalSets}",
      )
      logPermissionState(context, "start")
      if (!state.isValid()) {
        Log.w(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] notify_error invalid_start_payload")
        promise.resolve(null)
        return@AsyncFunction
      }

      if (canPostNotifications(context)) {
        safelyResolve(promise, "start") {
          postNotification(context, state, "notification posted")
        }
        return@AsyncFunction
      }

      requestPermissionOnFirstUse(context, state, promise)
    }

    AsyncFunction("update") { state: RestActivityStateRecord, promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null || !state.isValid() || !canPostNotifications(context)) {
        Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] permission_unavailable update_skipped")
        promise.resolve(null)
        return@AsyncFunction
      }

      safelyResolve(promise, "update") {
        postNotification(context, state, "notification updated")
      }
    }

    AsyncFunction("end") { sessionId: String, reason: String, promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (
        context == null ||
        sessionId.isBlank() ||
        reason !in setOf("completed", "cancelled", "workout_ended")
      ) {
        promise.resolve(null)
        return@AsyncFunction
      }

      safelyResolve(promise, "end") {
        RestNotificationChannel.manager(context).cancel(REST_NOTIFICATION_ID)
        Log.i(
          REST_NOTIFICATION_LOG_TAG,
          "[rest-live:android] notification_cancelled id=$REST_NOTIFICATION_ID reason=$reason",
        )
      }
    }
  }

  private fun requestPermissionOnFirstUse(
    context: Context,
    state: RestActivityStateRecord,
    promise: Promise,
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] permission_unavailable notifications_disabled")
      promise.resolve(null)
      return
    }

    val preferences = permissionPreferences(context)
    if (preferences.getBoolean(PERMISSION_REQUESTED_KEY, false)) {
      Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] permission_unavailable request_already_answered")
      promise.resolve(null)
      return
    }

    val permissions = appContext.permissions
    val manifestDeclared = permissions?.isPermissionPresentInManifest(
      Manifest.permission.POST_NOTIFICATIONS,
    ) == true
    if (
      permissions == null ||
      !manifestDeclared
    ) {
      Log.i(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] permission_unavailable manifestDeclared=$manifestDeclared " +
          "permissionManager=${permissions != null}",
      )
      promise.resolve(null)
      return
    }

    preferences.edit().putBoolean(PERMISSION_REQUESTED_KEY, true).apply()
    try {
      Log.i(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] permission_request_attempted " +
          "activityAvailable=${appContext.currentActivity != null}",
      )
      permissions.askForPermissions(
        { response ->
          val granted = response[Manifest.permission.POST_NOTIFICATIONS]?.status ==
            PermissionsStatus.GRANTED
          Log.i(
            REST_NOTIFICATION_LOG_TAG,
            "[rest-live:android] permission_request_result resultKnown=true granted=$granted",
          )
          if (!granted || !canPostNotifications(context)) {
            Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] permission_unavailable request_denied")
            promise.resolve(null)
            return@askForPermissions
          }
          safelyResolve(promise, "start") {
            postNotification(context, state, "notification posted")
          }
        },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    } catch (error: Throwable) {
      Log.w(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] permission_request_error", error)
      promise.resolve(null)
    }
  }

  private fun postNotification(
    context: Context,
    state: RestActivityStateRecord,
    logMessage: String,
  ) {
    val now = System.currentTimeMillis()
    val manager = RestNotificationChannel.ensureCreated(context)
    if (state.endsAt <= now) {
      manager.cancel(REST_NOTIFICATION_ID)
      return
    }
    val remaining = (state.endsAt - now).coerceAtLeast(0L)
    val smallIcon = R.drawable.ic_ajfit_rest_notification
    Log.i(
      REST_NOTIFICATION_LOG_TAG,
      "[rest-live:android] notification_build id=$REST_NOTIFICATION_ID " +
        "channel=$REST_NOTIFICATION_CHANNEL_ID endsAt=${state.endsAt} when=${state.endsAt} " +
        "remaining=$remaining permissionGranted=${hasPostNotificationsPermission(context)} " +
        "smallIcon=$smallIcon",
    )
    val notification = RestNotificationBuilder.build(context, state, now)
    Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] notify_called id=$REST_NOTIFICATION_ID")
    manager.notify(REST_NOTIFICATION_ID, notification)
    Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] notify_success id=$REST_NOTIFICATION_ID event=$logMessage")
    val active = manager.activeNotifications.any { it.id == REST_NOTIFICATION_ID }
    Log.i(
      REST_NOTIFICATION_LOG_TAG,
      "[rest-live:android] active_notification_found id=$REST_NOTIFICATION_ID " +
        "found=$active timing=immediate",
    )
  }

  private fun isNotificationSurfaceAvailable(context: Context): Boolean {
    val manager = RestNotificationChannel.manager(context)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return manager.areNotificationsEnabled()
    }
    if (hasPostNotificationsPermission(context)) return manager.areNotificationsEnabled()
    return !permissionPreferences(context).getBoolean(PERMISSION_REQUESTED_KEY, false)
  }

  private fun canPostNotifications(context: Context): Boolean =
    hasPostNotificationsPermission(context) &&
      RestNotificationChannel.manager(context).areNotificationsEnabled()

  private fun hasPostNotificationsPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED

  private fun logPermissionState(context: Context, source: String) {
    val permissions = appContext.permissions
    val manifestDeclared = permissions?.isPermissionPresentInManifest(
      Manifest.permission.POST_NOTIFICATIONS,
    ) == true
    Log.i(
      REST_NOTIFICATION_LOG_TAG,
      "[rest-live:android] permission_state source=$source sdk=${Build.VERSION.SDK_INT} " +
        "required=${Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU} " +
        "granted=${hasPostNotificationsPermission(context)} " +
        "previouslyRequested=${permissionPreferences(context).getBoolean(PERMISSION_REQUESTED_KEY, false)} " +
        "manifestDeclared=$manifestDeclared activityAvailable=${appContext.currentActivity != null} " +
        "notificationsEnabled=${RestNotificationChannel.manager(context).areNotificationsEnabled()}",
    )
  }

  private fun permissionPreferences(context: Context) =
    context.getSharedPreferences(PERMISSION_PREFERENCES, Context.MODE_PRIVATE)

  private fun RestActivityStateRecord.isValid(): Boolean =
    sessionId.isNotBlank() &&
      startedAt >= 0L &&
      endsAt > startedAt &&
      exerciseName.isNotBlank() &&
      setIndex >= 1 &&
      totalSets >= setIndex

  private inline fun safelyResolve(
    promise: Promise,
    operation: String,
    block: () -> Unit,
  ) {
    try {
      block()
    } catch (error: Throwable) {
      Log.w(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] notify_error operation=$operation", error)
    }
    promise.resolve(null)
  }
}
