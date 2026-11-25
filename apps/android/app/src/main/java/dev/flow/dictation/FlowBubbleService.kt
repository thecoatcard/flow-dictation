package dev.flow.dictation

import android.Manifest
import android.animation.LayoutTransition
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.sqrt
import java.util.ArrayDeque

/** Non-focusable floating control; the user's normal keyboard stays selected. */
class FlowBubbleService : Service() {
    companion object {
        const val ACTION_STOP = "dev.flow.dictation.STOP_BUBBLE"
        @Volatile var active: FlowBubbleService? = null
            private set

        /** Starts the bubble when the user wants it on and the permissions are in place. Safe to call often. */
        fun ensureRunning(context: Context) {
            if (active != null || !FlowSettings(context).bubbleEnabled) return
            if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED ||
                !Settings.canDrawOverlays(context)) return
            try { context.startForegroundService(Intent(context, FlowBubbleService::class.java)) }
            catch (_: Exception) { /* the system refused a background start; the next event retries */ }
        }

        /** The only way the bubble stays off: an explicit stop from the user. */
        fun stopByUser(context: Context) {
            FlowSettings(context).bubbleEnabled = false
            context.stopService(Intent(context, FlowBubbleService::class.java))
        }
        private val SURFACE = Color.rgb(24, 24, 27)
        private val ACCENT = Color.rgb(140, 155, 255)
        private val EDGE = Color.argb(190, 140, 155, 255)
    }

    private enum class State { IDLE, CONNECTING, LISTENING, PROCESSING }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val settings by lazy { FlowSettings(this) }
    private val windows by lazy { getSystemService(WINDOW_SERVICE) as WindowManager }
    private val handler = Handler(Looper.getMainLooper())
    private val fade = Runnable {
        if (state == State.IDLE) {
            label?.visibility = View.GONE
            bubble?.animate()?.alpha(0.82f)?.setDuration(240)?.start()
            icon?.setImageResource(R.drawable.ic_mic)
            icon?.setColorFilter(ACCENT)
            (bubble?.background as? GradientDrawable)?.setStroke(2.dp, EDGE)
        }
    }
    private var bubble: LinearLayout? = null
    private var icon: ImageView? = null
    private var label: TextView? = null
    private var wave: WaveformView? = null
    private var cancelButton: ImageView? = null
    private var dockedRight = true
    private val updateCheck = object : Runnable {
        override fun run() {
            scope.launch { checkForUpdate() }
            handler.postDelayed(this, 24 * 60 * 60 * 1000L) // once a day, no wake locks
        }
    }
    private val audioBytes = java.util.concurrent.atomic.AtomicLong()
    private var params: WindowManager.LayoutParams? = null
    private var state = State.IDLE
    private var session: GeminiLiveTranscriber? = null
    private var recorder: MicRecorder? = null
    private var startJob: Job? = null
    private var finishJob: Job? = null
    private var limitJob: Job? = null
    private var target: FlowAccessibilityService.Target? = null
    private var holdMode = false
    private var cued = false // the start chime played, so the stop chime should too
    private var lastTarget: FlowAccessibilityService.Target? = null
    private var lastInserted = ""
    private var lastInsertedAt = 0L
    var lastText: String = ""
        private set

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        active = this
        FlowTileService.update(this)
        createNotificationChannel()
        val notification = notification("Voice dictation is ready")
        try {
            promote(micActive = false, notification)
            if (!Settings.canDrawOverlays(this)) { stopSelf(); return }
            createBubble()
            refreshVisibility()
            handler.postDelayed(updateCheck, 60_000)
        } catch (_: SecurityException) { stopSelf() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            FlowSettings(this).bubbleEnabled = false
            stopSelf()
        }
        // If the system kills the process, it brings the service back; only an explicit stop ends it.
        return START_STICKY
    }

    /**
     * Android 14+ refuses to start a microphone foreground service from the background (after a reboot or
     * a restart), so idle uses the special-use type and microphone is added only while the user is dictating.
     */
    private fun promote(micActive: Boolean, notification: Notification = notification("Voice dictation is ready")) {
        try {
            when {
                Build.VERSION.SDK_INT >= 34 -> startForeground(7, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or
                        if (micActive) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
                Build.VERSION.SDK_INT >= 29 -> startForeground(7, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
                else -> startForeground(7, notification)
            }
        } catch (_: Exception) { /* keep the current type; recording is still allowed while the overlay is visible */ }
    }

    /** Looks for a newer release; on Wi-Fi it downloads and verifies it so installing is one tap. */
    private suspend fun checkForUpdate() {
        try {
            val info = Updater.check(this) ?: return
            settings.lastUpdateCheck = System.currentTimeMillis()
            if (settings.readyUpdate != info.version || !Updater.readyFile(this, info.version).exists()) {
                if (!isUnmetered()) return // wait for Wi-Fi rather than spend mobile data
                Updater.download(this, info)
                settings.readyUpdate = info.version
            }
            promote(micActive = state != State.IDLE) // refreshes the foreground notification, now showing the update
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) { /* offline or rate limited: try again tomorrow */ }
    }

    private fun isUnmetered(): Boolean {
        val manager = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        return manager.getNetworkCapabilities(manager.activeNetwork)
            ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
    }

    override fun onDestroy() {
        handler.removeCallbacks(updateCheck)
        handler.removeCallbacks(fade)
        cancelActive()
        bubble?.let { runCatching { windows.removeView(it) } }
        bubble = null
        scope.cancel()
        if (active === this) active = null
        FlowTileService.update(this)
        super.onDestroy()
    }

    fun refreshVisibility() {
        applyState()
        val eligible = FlowAccessibilityService.active?.hasEligibleField() == true
        val show = eligible || state != State.IDLE
        if (state == State.IDLE && label?.visibility != View.VISIBLE) {
            icon?.setImageResource(R.drawable.ic_mic)
            icon?.setColorFilter(ACCENT)
        }
        bubble?.visibility = if (show) View.VISIBLE else View.GONE
        if (show && state == State.IDLE) scheduleFade()
    }

    /** Puts the bubble back at its default spot (right edge, middle of the screen). */
    fun resetPosition() {
        val p = params ?: return
        settings.bubblePosition = null
        dockedRight = true
        p.x = resources.displayMetrics.widthPixels - 72.dp
        p.y = resources.displayMetrics.heightPixels / 2
        bubble?.let { windows.updateViewLayout(it, p) }
    }

    private fun createBubble() {
        val view = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            orientation = LinearLayout.HORIZONTAL
            setPadding(9.dp, 9.dp, 9.dp, 9.dp)
            background = GradientDrawable().apply {
                setColor(SURFACE)
                cornerRadius = 28.dp.toFloat()
                setStroke(2.dp, EDGE)
            }
            elevation = 18.dp.toFloat()
            layoutTransition = LayoutTransition()
            contentDescription = "Flow. Tap to dictate, hold to talk, drag to move."
        }
        cancelButton = ImageView(this).apply {
            setImageResource(R.drawable.ic_cancel)
            setColorFilter(Color.rgb(170, 170, 178))
            setPadding(5.dp, 5.dp, 5.dp, 5.dp)
            contentDescription = "Cancel dictation"
            visibility = View.GONE
            setOnClickListener { cancelActive(); showStatus("Cancelled") }
        }
        view.addView(cancelButton, LinearLayout.LayoutParams(30.dp, 30.dp))
        wave = WaveformView(this).apply { visibility = View.GONE }
        view.addView(wave, LinearLayout.LayoutParams(84.dp, 26.dp).apply { setMargins(8.dp, 0, 8.dp, 0) })
        icon = ImageView(this).apply {
            setImageResource(R.drawable.ic_mic)
            setColorFilter(ACCENT)
            contentDescription = null
        }
        view.addView(icon, LinearLayout.LayoutParams(22.dp, 22.dp))
        label = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 13.5f
            visibility = View.GONE
            setPadding(10.dp, 0, 2.dp, 0)
        }
        view.addView(label)
        val width = resources.displayMetrics.widthPixels
        val height = resources.displayMetrics.heightPixels
        val saved = settings.bubblePosition
        val position = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = saved?.first ?: (width - 72.dp)
            y = saved?.second ?: (height / 2)
        }
        bubble = view
        params = position
        dockedRight = position.x > width / 2
        // The pill grows when listening; keep it on screen and on its docked side.
        view.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ ->
            val p = params ?: return@addOnLayoutChangeListener
            val max = resources.displayMetrics.widthPixels - v.width - 4.dp
            val wanted = if (dockedRight) max else minOf(p.x, max).coerceAtLeast(0)
            if (wanted != p.x) v.post { if (bubble === v) { p.x = wanted; windows.updateViewLayout(v, p) } }
        }
        view.setOnTouchListener(BubbleTouch())
        windows.addView(view, position)
    }

    private inner class BubbleTouch : View.OnTouchListener {
        private val slop = ViewConfiguration.get(this@FlowBubbleService).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var originalX = 0
        private var originalY = 0
        private var moved = false
        private var held = false
        private val hold = Runnable {
            if (!moved && state == State.IDLE) {
                held = true
                holdMode = true
                startDictation()
            }
        }

        override fun onTouch(view: View, event: MotionEvent): Boolean {
            val p = params ?: return false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    view.animate().alpha(1f).setDuration(120).start()
                    downX = event.rawX
                    downY = event.rawY
                    originalX = p.x
                    originalY = p.y
                    moved = false
                    held = false
                    handler.postDelayed(hold, 350)
                    return true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!moved && (abs(dx) > slop || abs(dy) > slop)) {
                        moved = true
                        handler.removeCallbacks(hold)
                    }
                    if (moved) {
                        p.x = (originalX + dx.toInt()).coerceIn(0, resources.displayMetrics.widthPixels - 44.dp)
                        p.y = (originalY + dy.toInt()).coerceIn(0, resources.displayMetrics.heightPixels - 64.dp)
                        windows.updateViewLayout(view, p)
                    }
                    return true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    handler.removeCallbacks(hold)
                    if (event.actionMasked == MotionEvent.ACTION_CANCEL) {
                        if (held) { cancelActive(); showStatus("Cancelled") }
                        scheduleFade()
                        return true
                    }
                    if (moved) {
                        dockedRight = p.x + view.width / 2 >= resources.displayMetrics.widthPixels / 2
                        p.x = if (dockedRight) resources.displayMetrics.widthPixels - view.width - 4.dp else 4.dp
                        windows.updateViewLayout(view, p)
                        settings.bubblePosition = p.x to p.y
                    } else if (held) {
                        holdMode = false
                        if (state == State.LISTENING || state == State.CONNECTING) finishDictation()
                    } else if (event.actionMasked == MotionEvent.ACTION_UP) onBubbleTap()
                    scheduleFade()
                    return true
                }
            }
            return false
        }
    }

    private fun onBubbleTap() {
        when (state) {
            State.IDLE -> startDictation()
            State.CONNECTING -> finishDictation()
            State.LISTENING -> finishDictation()
            State.PROCESSING -> { cancelActive(); showStatus("Cancelled") }
        }
    }

    private fun startDictation() {
        val access = FlowAccessibilityService.active
        if (access == null) { showStatus("Enable text access in Flow"); return }
        val focused = try { access.capture() }
            catch (error: IllegalStateException) { showStatus(error.message.orEmpty()); return }
        val key = settings.apiKey()
        if (key == null) { showStatus("Add API key in Flow"); return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            showStatus("Allow microphone in Flow")
            return
        }
        if (!isOnline()) { showStatus("No internet · try again later"); return }
        target = focused
        state = State.CONNECTING
        promote(micActive = true)
        wave?.level = 0f
        audioBytes.set(0)
        cued = false
        buzz()
        showStatus("Starting mic…")
        val live = GeminiLiveTranscriber(
            key,
            settings.dictionary.map { it.substringBefore('|').trim() },
            Languages.codes(settings.language),
        )
        val mic = MicRecorder()
        val audioLock = Any()
        val pendingAudio = ArrayDeque<ByteArray>()
        var readyForAudio = false
        session = live
        recorder = mic
        try {
            mic.start(scope, { bytes, count ->
                wave?.level = levelOf(bytes, count)
                audioBytes.addAndGet(count.toLong())
                synchronized(audioLock) {
                    if (readyForAudio) live.sendAudio(bytes, count)
                    else if (pendingAudio.size < 70) pendingAudio.add(bytes.copyOf(count))
                }
            }) {
                if (state == State.LISTENING || state == State.CONNECTING) {
                    cancelActive()
                    showStatus("Microphone or connection lost")
                }
            }
            showStatus(if (holdMode) "Listening · release to finish" else "Listening · tap to finish")
            if (settings.soundCues) { cued = true; Chime.play(Chime.Kind.START) } // the mic is live: speak now
        } catch (error: Exception) {
            cancelActive()
            showStatus(error.message?.take(48) ?: "Could not open microphone")
            return
        }
        startJob = scope.launch {
            try {
                live.connect()
                synchronized(audioLock) {
                    while (pendingAudio.isNotEmpty()) {
                        val bytes = pendingAudio.removeFirst()
                        live.sendAudio(bytes, bytes.size)
                    }
                    readyForAudio = true
                }
                if (state == State.CONNECTING) {
                    state = State.LISTENING
                    showStatus(if (holdMode) "Listening · release to finish" else "Listening · tap to finish")
                    limitJob = scope.launch {
                        delay(240_000)
                        if (state == State.LISTENING) showStatus("1 minute left")
                        delay(60_000)
                        if (state == State.LISTENING) finishDictation()
                    }
                }
            } catch (_: CancellationException) {
                live.close()
            } catch (error: Exception) {
                cancelActive()
                showStatus(error.message?.take(48) ?: "Could not start dictation")
            }
        }
    }

    private fun finishDictation() {
        limitJob?.cancel()
        limitJob = null
        state = State.PROCESSING
        buzz()
        showStatus("Working on it · tap to cancel")
        val mic = recorder
        val destination = target
        finishJob = scope.launch {
            var live: GeminiLiveTranscriber? = null
            try {
                mic?.stop()
                if (cued && settings.soundCues) Chime.play(Chime.Kind.STOP) // the mic is off, so the chime is not recorded
                cued = false
                startJob?.join()
                live = session
                if (live == null || state != State.PROCESSING) return@launch
                val transcript = live?.finish().orEmpty()
                if (transcript.isBlank()) { showStatus("No speech heard"); return@launch }
                settings.recordUsage(audioBytes.get() / 32_000.0) // 16 kHz, 16-bit mono
                val key = settings.apiKey() ?: return@launch
                val result = DictationPipeline.process(transcript, settings.snapshot(destination?.packageName), key)
                when (result) {
                    is DictationResult.Insert -> {
                        lastText = result.text
                        if (result.text.isEmpty()) {
                            if (result.pressEnter) pressEnterNow() else showStatus("No speech heard")
                        } else {
                            if (settings.keepHistory)
                                HistoryStore.get(this@FlowBubbleService).add(result.text, destination?.packageName.orEmpty())
                            if (destination != null &&
                                FlowAccessibilityService.active?.insert(destination, result.text) == true) {
                                lastTarget = destination
                                lastInserted = result.text
                                lastInsertedAt = System.currentTimeMillis()
                                if (result.pressEnter) { delay(150); pressEnterNow() } else showStatus("Inserted")
                            } else {
                                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager)
                                    .setPrimaryClip(ClipData.newPlainText("Flow dictation", result.text))
                                showStatus("Copied · paste in your text field")
                            }
                        }
                    }
                    is DictationResult.Key -> when (result.action) {
                        KeyAction.SELECT_ALL ->
                            showStatus(if (FlowAccessibilityService.active?.selectAll() == true) "Selected all" else "Could not select")
                        KeyAction.ENTER -> pressEnterNow()
                    }
                    DictationResult.DeleteLast -> {
                        val removed = System.currentTimeMillis() - lastInsertedAt < 60_000 &&
                            lastTarget?.let { FlowAccessibilityService.active?.undo(it, lastInserted) } == true
                        if (removed) { lastInserted = ""; showStatus("Removed") }
                        else showStatus("Nothing to remove")
                    }
                }
            } catch (_: CancellationException) {
                // A cancelled dictation must not overwrite the next session's status.
            } catch (error: Exception) {
                showStatus(error.message?.take(48) ?: "Dictation failed")
            } finally {
                withContext(NonCancellable) { mic?.stop(); live?.close() }
                if (recorder === mic) recorder = null
                if (session === live) session = null
                if (state == State.PROCESSING) {
                    state = State.IDLE
                    promote(micActive = false)
                    refreshVisibility()
                }
            }
        }
    }

    /** Haptic feedback when recording starts and stops, if it is turned on. */
    private fun buzz() {
        if (settings.haptics) bubble?.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    }

    private fun pressEnterNow() {
        showStatus(if (FlowAccessibilityService.active?.pressEnter() == true) "Sent" else "Enter is not available here")
    }

    private fun cancelActive() {
        startJob?.cancel()
        finishJob?.cancel()
        limitJob?.cancel()
        limitJob = null
        val mic = recorder
        recorder = null
        runBlocking { mic?.stop() }
        session?.close()
        session = null
        target = null
        state = State.IDLE
        promote(micActive = false)
        refreshVisibility()
    }

    /** Shape the pill for the current state: compact mic when idle, waveform pill while working. */
    private fun applyState() {
        val working = state != State.IDLE
        val listening = state == State.CONNECTING || state == State.LISTENING
        wave?.processing = state == State.PROCESSING
        wave?.visibility = if (working) View.VISIBLE else View.GONE
        cancelButton?.visibility = if (working) View.VISIBLE else View.GONE
        val confirm = icon ?: return
        // Idle is a 40 dp circle, a little smaller than WhatsApp's 48 dp mic button; the ✓ button is larger.
        val size = if (working) 30.dp else 22.dp
        if (confirm.layoutParams.width != size) confirm.layoutParams = LinearLayout.LayoutParams(size, size)
        if (working) {
            confirm.visibility = if (listening) View.VISIBLE else View.GONE
            confirm.setImageResource(R.drawable.ic_done)
            confirm.setColorFilter(SURFACE)
            confirm.setPadding(6.dp, 6.dp, 6.dp, 6.dp)
            confirm.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) }
            confirm.contentDescription = "Finish dictation"
            label?.visibility = View.GONE
        } else {
            confirm.visibility = View.VISIBLE
            confirm.background = null
            confirm.setPadding(0, 0, 0, 0)
            confirm.contentDescription = null
        }
    }

    private fun showStatus(message: String) {
        applyState()
        if (state != State.IDLE) {
            // The waveform says "listening" and "working"; only the time warning needs words.
            label?.text = message
            label?.visibility = if (message == "1 minute left") View.VISIBLE else View.GONE
            bubble?.animate()?.alpha(1f)?.setDuration(160)?.start()
            return
        }
        val ok = message == "Inserted" || message == "Removed"
        icon?.setImageResource(if (ok) R.drawable.ic_done else R.drawable.ic_warn)
        val color = if (ok) Color.rgb(95, 208, 162) else Color.rgb(255, 180, 84)
        icon?.setColorFilter(color)
        (bubble?.background as? GradientDrawable)?.setStroke(1.dp, color)
        label?.text = message
        label?.visibility = if (message == "Flow ready") View.GONE else View.VISIBLE
        bubble?.animate()?.alpha(1f)?.setDuration(160)?.start()
        scheduleFade()
    }

    private fun levelOf(pcm: ByteArray, count: Int): Float {
        var sum = 0.0
        var n = 0
        var i = 0
        while (i + 1 < count) {
            val v = (pcm[i + 1].toInt() shl 8) or (pcm[i].toInt() and 0xff)
            sum += v.toDouble() * v
            n++
            i += 2
        }
        if (n == 0) return 0f
        return (sqrt(sqrt(sum / n) / 32768.0) * 2.2).toFloat().coerceIn(0f, 1f)
    }

    private fun scheduleFade() {
        handler.removeCallbacks(fade)
        if (state == State.IDLE) handler.postDelayed(fade, 5_000)
    }

    private fun isOnline(): Boolean {
        val manager = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
        return capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel("flow-bubble", "Flow bubble", NotificationManager.IMPORTANCE_LOW))
    }

    private fun notification(message: String): Notification {
        val ready = settings.readyUpdate.takeIf { it.isNotEmpty() && Updater.isNewer(it, Updater.installedVersion(this)) }
        val text = if (ready != null) "Update $ready is ready. Tap to install." else message
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).putExtra("install-update", ready != null), PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(this, 1, Intent(this, FlowBubbleService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, "flow-bubble")
            .setSmallIcon(R.drawable.ic_mic)
            .setContentTitle("Flow")
            .setContentText(text)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .setOngoing(true)
            .build()
    }

    private val Int.dp: Int get() = (this * resources.displayMetrics.density).toInt()
}
