package com.ajfit.widgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import androidx.glance.appwidget.updateAll

object AJFitWidgetCoordinator {
  private const val REQUEST_CODE = 7401
  private const val ACTION_REFRESH = "com.ajfit.widgets.action.REFRESH"
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  fun snapshotChanged(context: Context) {
    val appContext = context.applicationContext
    scheduleNext(appContext)
    scope.launch { updateAll(appContext) }
  }

  fun onTimedRefresh(context: Context) {
    snapshotChanged(context)
  }

  private suspend fun updateAll(context: Context) {
    AJFitMonthlyWidget().updateAll(context)
    AJFitWeeklyWidget().updateAll(context)
    AJFitCompactWidget().updateAll(context)
    AJFitFrequencyWidget().updateAll(context)
  }

  internal fun nextEffectiveAtMs(context: Context, nowMs: Long = System.currentTimeMillis()): Long? {
    val snapshot = AJFitWidgetSnapshotDecoder.decode(AJFitWidgetsStorage.readRaw(context)) ?: return null
    return (listOfNotNull(snapshot.current) + snapshot.future)
      .map { it.effectiveAtMs }.filter { it > nowMs }.minOrNull()
  }

  private fun scheduleNext(context: Context) {
    val alarm = context.getSystemService(AlarmManager::class.java)
    val operation = PendingIntent.getBroadcast(
      context, REQUEST_CODE,
      Intent(context, AJFitWidgetAlarmReceiver::class.java).setAction(ACTION_REFRESH),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    alarm.cancel(operation)
    nextEffectiveAtMs(context)?.let {
      alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, it, operation)
    }
  }
}

class AJFitWidgetAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) = AJFitWidgetCoordinator.onTimedRefresh(context)
}

class AJFitWidgetBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action == Intent.ACTION_BOOT_COMPLETED) AJFitWidgetCoordinator.snapshotChanged(context)
  }
}
