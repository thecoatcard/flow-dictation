package dev.flow.dictation

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.app.Notification

/**
 * Makes reminders ring on time. One alarm is always set for the next reminder that is not due yet, and it is set
 * again whenever the reminders change, after a reboot, and after an app update. When it goes off, the floating mic
 * turns red and a notification is posted, so a reminder is never missed even if the mic was switched off.
 */
object ReminderScheduler {
    private const val CHANNEL = "flow-reminders"
    private const val ALARM_CODE = 7001
    private const val NOTIFICATION_ID = 7002

    private fun alarmIntent(context: Context) = PendingIntent.getBroadcast(
        context, ALARM_CODE, Intent(context, ReminderReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    /** Exact alarms need the "Alarms & reminders" permission from Android 12; before that they are always allowed. */
    fun canScheduleExact(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms()

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Points the alarm at the next reminder that is not due yet, or clears it when there is none. */
    fun schedule(context: Context) {
        val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = alarmIntent(context)
        alarms.cancel(pending)
        val next = Memory.nextDueAt(MemoryStore.get(context).get(), System.currentTimeMillis()) ?: return
        try {
            if (canScheduleExact(context)) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
            else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending) // late by a few minutes at worst
        } catch (_: SecurityException) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending)
        }
    }

    /** The alarm went off (or the phone started): show what is due, then set the next alarm. */
    fun onDue(context: Context) {
        val due = Memory.dueReminders(MemoryStore.get(context).get(), System.currentTimeMillis())
        if (due.isNotEmpty()) {
            notify(context, due)
            FlowBubbleService.ensureRunning(context)
            FlowBubbleService.active?.onRemindersChanged(openCard = true)
        }
        schedule(context)
    }

    /** Removes the notification once nothing is due any more. */
    fun clearNotification(context: Context) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
    }

    private fun notify(context: Context, due: List<Reminder>) {
        if (!canNotify(context)) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Reminders you asked Flow to set"
            },
        )
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = if (due.size == 1) "Reminder" else "${due.size} reminders"
        val text = if (due.size == 1) due[0].text else due.take(3).joinToString(" · ") { it.text }
        manager.notify(
            NOTIFICATION_ID,
            Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_mic)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(Notification.BigTextStyle().bigText(due.joinToString("\n") { it.text }))
                .setContentIntent(open)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .build(),
        )
    }
}

/** The alarm for the next reminder. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = ReminderScheduler.onDue(context)
}

/** After a reboot or an app update the alarm is gone, so it is set again and anything that came due is shown. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED)
            ReminderScheduler.onDue(context)
    }
}
