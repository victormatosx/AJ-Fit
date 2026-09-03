package com.ajfit.restactivity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

internal const val REST_NOTIFICATION_CHANNEL_ID = "rest_timer"
internal const val REST_NOTIFICATION_LOG_TAG = "AJFitRestActivity"

internal object RestNotificationChannel {
  fun manager(context: Context): NotificationManager =
    context.getSystemService(NotificationManager::class.java)

  fun ensureCreated(context: Context): NotificationManager {
    val manager = manager(context)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return manager
    val existingChannel = manager.getNotificationChannel(REST_NOTIFICATION_CHANNEL_ID)
    if (existingChannel != null) return manager

    val channel = NotificationChannel(
      REST_NOTIFICATION_CHANNEL_ID,
      context.getString(R.string.ajfit_rest_channel_name),
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = context.getString(R.string.ajfit_rest_channel_description)
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }

    manager.createNotificationChannel(channel)
    return manager
  }
}
