package dev.flow.dictation

import android.Manifest
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** A Quick Settings tile that turns the floating mic on and off from the notification shade. */
class FlowTileService : TileService() {
    companion object {
        /** Asks Android to refresh the tile (when the floating mic starts or stops). */
        fun update(context: Context) {
            runCatching { requestListeningState(context, ComponentName(context, FlowTileService::class.java)) }
        }
    }

    override fun onStartListening() = refresh()

    override fun onClick() {
        if (FlowBubbleService.active != null) {
            FlowBubbleService.stopByUser(this)
        } else {
            FlowSettings(this).bubbleEnabled = true
            val ready = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
                Settings.canDrawOverlays(this) && FlowAccessibilityService.active != null
            if (ready) FlowBubbleService.ensureRunning(this) else openApp()
        }
        refresh()
        Handler(Looper.getMainLooper()).postDelayed({ refresh() }, 800) // the service starts a moment later
    }

    private fun refresh() {
        val tile = qsTile ?: return
        val on = FlowBubbleService.active != null
        tile.state = if (on) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = "Flow mic"
        if (Build.VERSION.SDK_INT >= 29) tile.subtitle = if (on) "On" else "Off"
        tile.updateTile()
    }

    /** Some permission is missing, so the app opens where the user can allow it. */
    @android.annotation.SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openApp() {
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE))
        } else {
            // Only reached below Android 14, where the PendingIntent overload does not exist.
            @Suppress("DEPRECATION") startActivityAndCollapse(intent)
        }
    }
}
