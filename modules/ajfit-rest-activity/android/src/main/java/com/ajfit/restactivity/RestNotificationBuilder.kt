package com.ajfit.restactivity

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

internal const val REST_NOTIFICATION_ID = 41_704
internal const val REST_NOTIFICATION_TIMEOUT_MARGIN_MILLIS = 5_000L
internal const val ACTIVE_WORKOUT_DEEP_LINK = "ajfit://workout/active"
private const val REST_NOTIFICATION_PENDING_INTENT_REQUEST_CODE = 41_705
private const val MAX_EXERCISE_NAME_LENGTH = 80

internal fun calculateRestNotificationTimeout(endsAt: Long, now: Long): Long {
  val remaining = (endsAt - now).coerceAtLeast(0L)
  return remaining.coerceAtMost(Long.MAX_VALUE - REST_NOTIFICATION_TIMEOUT_MARGIN_MILLIS) +
    REST_NOTIFICATION_TIMEOUT_MARGIN_MILLIS
}

internal fun sanitizeRestNotificationText(value: String): String =
  value.trim().replace(Regex("\\s+"), " ").take(MAX_EXERCISE_NAME_LENGTH)

internal data class RestNotificationBuildResult(
  val notification: Notification,
  val liveUpdateSdkSupported: Boolean,
  val promotionRequested: Boolean,
  val promotable: Boolean,
)

internal object RestNotificationBuilder {
  fun build(
    context: Context,
    state: RestActivityStateRecord,
    now: Long,
  ): RestNotificationBuildResult {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, REST_NOTIFICATION_CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }

    builder
      .setSmallIcon(R.drawable.ic_ajfit_rest_notification)
      .setContentTitle(context.getString(R.string.ajfit_rest_notification_title))
      .setContentText(sanitizeRestNotificationText(state.exerciseName))
      .setSubText(
        context.getString(
          R.string.ajfit_rest_series_format,
          state.setIndex,
          state.totalSets,
        ),
      )
      .setContentIntent(activeWorkoutPendingIntent(context))
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setWhen(state.endsAt)
      .setShowWhen(true)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setOngoing(true)
      .setAutoCancel(false)
      .setOnlyAlertOnce(true)

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      configureLegacySilentNotification(builder)
    } else {
      builder.setTimeoutAfter(calculateRestNotificationTimeout(state.endsAt, now))
    }

    if (!isLiveUpdateSdkSupported()) {
      return RestNotificationBuildResult(
        notification = builder.build(),
        liveUpdateSdkSupported = false,
        promotionRequested = false,
        promotable = false,
      )
    }

    val notification = RestLiveUpdateApi36.enrich(
      builder = builder,
      contextTitle = context.getString(R.string.ajfit_rest_live_update_title),
      contextShortCriticalText = context.getString(
        R.string.ajfit_rest_short_critical_text,
      ),
      state = state,
      now = now,
    )
    return RestNotificationBuildResult(
      notification = notification,
      liveUpdateSdkSupported = true,
      promotionRequested = notification.extras.getBoolean(
        REQUEST_PROMOTED_ONGOING_EXTRA,
        false,
      ),
      promotable = RestLiveUpdateApi36.hasPromotableCharacteristics(notification),
    )
  }

  @Suppress("DEPRECATION")
  private fun configureLegacySilentNotification(builder: Notification.Builder) {
    builder
      .setPriority(Notification.PRIORITY_DEFAULT)
      .setDefaults(0)
      .setSound(null)
      .setVibrate(null)
  }

  private fun activeWorkoutPendingIntent(context: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(ACTIVE_WORKOUT_DEEP_LINK)).apply {
      addCategory(Intent.CATEGORY_BROWSABLE)
      setPackage(context.packageName)
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    return PendingIntent.getActivity(
      context,
      REST_NOTIFICATION_PENDING_INTENT_REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
