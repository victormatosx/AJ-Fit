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
      val surface = context?.let(::resolveCapabilities) ?: RestLiveSurface.NONE
      val available = surface != RestLiveSurface.NONE
      mapOf(
        "available" to available,
        "surface" to surface.wireValue,
      )
    }

    AsyncFunction("start") { state: RestActivityStateRecord, promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        Log.w(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] native_error operation=start reason=context")
        promise.resolve(null)
        return@AsyncFunction
      }

      if (!state.isValid()) {
        Log.w(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] native_error operation=start reason=payload")
        promise.resolve(null)
        return@AsyncFunction
      }

      if (canPostNotifications(context)) {
        safelyResolve(promise, "start") {
          postNotification(context, state, "started")
        }
        return@AsyncFunction
      }

      requestPermissionOnFirstUse(context, state, promise)
    }

    AsyncFunction("update") { state: RestActivityStateRecord, promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null || !state.isValid()) {
        Log.w(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] native_error operation=update reason=context_or_payload")
        promise.resolve(null)
        return@AsyncFunction
      }
      if (!canPostNotifications(context)) {
        Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] permission_denied operation=update")
        promise.resolve(null)
        return@AsyncFunction
      }

      safelyResolve(promise, "update") {
        postNotification(context, state, "updated")
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
          "[rest-live:android] ended id=$REST_NOTIFICATION_ID reason=$reason",
        )
      }
    }

    AsyncFunction("cleanup") { promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      safelyResolve(promise, "cleanup") {
        RestNotificationChannel.manager(context).cancel(REST_NOTIFICATION_ID)
        Log.i(
          REST_NOTIFICATION_LOG_TAG,
          "[rest-live:android] ended id=$REST_NOTIFICATION_ID reason=cleanup",
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
      Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] permission_denied reason=notifications_disabled")
      promise.resolve(null)
      return
    }

    val preferences = permissionPreferences(context)
    if (preferences.getBoolean(PERMISSION_REQUESTED_KEY, false)) {
      Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] permission_denied reason=already_answered")
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
      Log.w(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] native_error operation=permission reason=unavailable",
      )
      promise.resolve(null)
      return
    }

    preferences.edit().putBoolean(PERMISSION_REQUESTED_KEY, true).apply()
    try {
      permissions.askForPermissions(
        { response ->
          val granted = response[Manifest.permission.POST_NOTIFICATIONS]?.status ==
            PermissionsStatus.GRANTED
          if (!granted || !canPostNotifications(context)) {
            Log.i(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] permission_denied reason=request_denied")
            promise.resolve(null)
            return@askForPermissions
          }
          safelyResolve(promise, "start") {
            postNotification(context, state, "started")
          }
        },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    } catch (error: Throwable) {
      Log.w(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] native_error operation=permission", error)
      promise.resolve(null)
    }
  }

  private fun postNotification(
    context: Context,
    state: RestActivityStateRecord,
    event: String,
  ) {
    val now = System.currentTimeMillis()
    val manager = RestNotificationChannel.ensureCreated(context)
    if (state.endsAt <= now) {
      manager.cancel(REST_NOTIFICATION_ID)
      return
    }
    val buildResult = RestNotificationBuilder.build(context, state, now)
    val resolvedSurface = resolveBuiltSurface(
      manager = manager,
      buildResult = buildResult,
      source = event,
    )
    val notification = buildResult.notification
    manager.notify(REST_NOTIFICATION_ID, notification)
    Log.i(
      REST_NOTIFICATION_LOG_TAG,
      "[rest-live:android] $event id=$REST_NOTIFICATION_ID surface=${resolvedSurface.wireValue}",
    )
  }

  private fun resolveCapabilities(context: Context): RestLiveSurface {
    val normalSurfaceAvailable = isNotificationSurfaceAvailable(context)
    if (!normalSurfaceAvailable) return RestLiveSurface.NONE

    // Preserve the existing first-use flow: before the one allowed runtime
    // prompt, the module stays available as a normal notification capability
    // so start() can request POST_NOTIFICATIONS. Once denied, availability is
    // false through isNotificationSurfaceAvailable().
    if (!canPostNotifications(context)) {
      Log.i(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] fallback source=capabilities " +
          "surface=${RestLiveSurface.NOTIFICATION.wireValue} " +
          "reason=notification_permission_pending",
      )
      return RestLiveSurface.NOTIFICATION
    }

    if (!isLiveUpdateSdkSupported()) {
      Log.i(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] fallback source=capabilities " +
          "surface=${RestLiveSurface.NOTIFICATION.wireValue} reason=sdk_unsupported",
      )
      return RestLiveSurface.NOTIFICATION
    }

    return try {
      val now = System.currentTimeMillis()
      val probe = RestActivityStateRecord(
        sessionId = "capability-probe",
        startedAt = now,
        endsAt = now + 60_000L,
        exerciseName = context.getString(R.string.ajfit_rest_notification_title),
        setIndex = 1,
        totalSets = 1,
      )
      resolveBuiltSurface(
        manager = RestNotificationChannel.manager(context),
        buildResult = RestNotificationBuilder.build(context, probe, now),
        source = "capabilities",
      )
    } catch (error: Throwable) {
      Log.w(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] fallback source=capabilities " +
          "surface=${RestLiveSurface.NOTIFICATION.wireValue} reason=probe_error",
        error,
      )
      RestLiveSurface.NOTIFICATION
    }
  }

  private fun resolveBuiltSurface(
    manager: NotificationManager,
    buildResult: RestNotificationBuildResult,
    source: String,
  ): RestLiveSurface {
    if (!buildResult.liveUpdateSdkSupported) {
      Log.i(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] fallback source=$source " +
          "surface=${RestLiveSurface.NOTIFICATION.wireValue} reason=sdk_unsupported",
      )
      return RestLiveSurface.NOTIFICATION
    }

    val promotionDeclared = isPromotedNotificationPermissionDeclared()
    val promotionAllowed = promotionDeclared && try {
      RestLiveUpdateApi36.canPostPromotedNotifications(manager)
    } catch (error: Throwable) {
      Log.w(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] native_error operation=promotion", error)
      false
    }

    val surface = resolveRestLiveSurface(
      sdk = Build.VERSION.SDK_INT,
      notificationPermission = true,
      promotionPermission = promotionAllowed,
      promotable = buildResult.promotable,
    )
    if (surface != RestLiveSurface.LIVE_UPDATE) {
      val reason = when {
        !promotionAllowed -> "promotion_denied"
        !buildResult.promotable -> "not_promotable"
        else -> "system_fallback"
      }
      Log.i(
        REST_NOTIFICATION_LOG_TAG,
        "[rest-live:android] fallback source=$source " +
          "surface=${surface.wireValue} reason=$reason",
      )
    }
    return surface
  }

  private fun isPromotedNotificationPermissionDeclared(): Boolean =
    appContext.permissions?.isPermissionPresentInManifest(
      POST_PROMOTED_NOTIFICATIONS_PERMISSION,
    ) == true

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
      Log.w(REST_NOTIFICATION_LOG_TAG, "[rest-live:android] native_error operation=$operation", error)
    }
    promise.resolve(null)
  }
}
