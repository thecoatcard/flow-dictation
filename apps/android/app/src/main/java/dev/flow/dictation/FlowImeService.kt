package dev.flow.dictation

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.inputmethodservice.InputMethodService
import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.graphics.Color
import android.view.Gravity
import android.view.View
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext

/** A real Android IME: Android shows it for text fields only after the user selects it as default. */
class FlowImeService : InputMethodService() {
    private enum class State { IDLE, CONNECTING, LISTENING, PROCESSING }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val settings by lazy { FlowSettings(this) }
    private var state = State.IDLE
    private var fieldGeneration = 0
    private var privateField = false
    private var session: GeminiLiveTranscriber? = null
    private var recorder: MicRecorder? = null
    private var startJob: Job? = null
    private var finishJob: Job? = null
    private var recordingTimeout: Job? = null
    private var statusView: TextView? = null
    private var micButton: Button? = null
    private var shift = false
    private var lastInserted = ""
    private var lastField = -1

    override fun onCreateInputView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(4.dp, 4.dp, 4.dp, 6.dp)
            setBackgroundColor(Color.rgb(32, 36, 44))
        }
        val bar = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        statusView = TextView(this).apply {
            textSize = 13f
            setTextColor(Color.WHITE)
            text = "Flow ready"
            setPadding(8.dp, 0, 4.dp, 0)
        }
        bar.addView(statusView, LinearLayout.LayoutParams(0, 48.dp, 1f))
        bar.key("⚙", 48.dp) { openSettings() }
        micButton = bar.key("🎙 Speak", 100.dp) { onMicTap() }
        root.addView(bar)

        for (row in listOf("qwertyuiop", "asdfghjkl", "zxcvbnm")) {
            val line = LinearLayout(this).apply { gravity = Gravity.CENTER }
            if (row.startsWith('z')) line.key("⇧", 44.dp) { shift = !shift; showStatus(if (shift) "Shift on" else "Flow ready") }
            for (letter in row) {
                line.key(letter.toString(), 0) {
                    type(if (shift) letter.uppercase() else letter.toString())
                    shift = false
                }
            }
            if (row.startsWith('z')) line.key("⌫", 48.dp) { deleteOne() }
            root.addView(line)
        }
        val bottom = LinearLayout(this)
        bottom.key("🌐", 55.dp) { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker() }
        bottom.key(",", 45.dp) { type(",") }
        bottom.key("space", 0) { type(" ") }
        bottom.key(".", 45.dp) { type(".") }
        bottom.key("↵", 55.dp) { type("\n") }
        root.addView(bottom)
        updateMicButton()
        return root
    }

    override fun onStartInput(attribute: EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        cancelActive()
        fieldGeneration++
        lastInserted = ""
        privateField = isPrivate(attribute)
        attribute?.packageName?.let { settings.recentApp = it }
        showStatus(if (privateField) "Voice off in private field" else "Flow ready")
    }

    override fun onFinishInputView(finishingInput: Boolean) {
        fieldGeneration++
        cancelActive()
        super.onFinishInputView(finishingInput)
    }

    override fun onDestroy() {
        cancelActive()
        scope.cancel()
        super.onDestroy()
    }

    private fun cancelActive() {
        startJob?.cancel()
        finishJob?.cancel()
        recordingTimeout?.cancel()
        recordingTimeout = null
        val activeMic = recorder
        recorder = null
        runBlocking { activeMic?.stop() }
        session?.close()
        session = null
        state = State.IDLE
        updateMicButton()
    }

    private fun onMicTap() {
        when (state) {
            State.IDLE -> startDictation()
            State.CONNECTING -> {
                cancelActive()
                showStatus("Cancelled")
            }
            State.LISTENING -> finishDictation()
            State.PROCESSING -> Unit
        }
    }

    private fun startDictation() {
        if (privateField) { showStatus("Voice is off in private fields"); return }
        val key = settings.apiKey()
        if (key == null || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            openSettings()
            return
        }
        val generation = fieldGeneration
        state = State.CONNECTING
        showStatus("Connecting…")
        startJob = scope.launch {
            val live = GeminiLiveTranscriber(key, settings.dictionary)
            session = live
            try {
                live.connect()
                if (generation != fieldGeneration) { live.close(); return@launch }
                val mic = MicRecorder()
                recorder = mic
                mic.start(scope, { bytes, length -> live.sendAudio(bytes, length) }) {
                    if (generation == fieldGeneration && state == State.LISTENING) {
                        cancelActive()
                        showStatus("Microphone or connection lost")
                    }
                }
                state = State.LISTENING
                showStatus("Listening · tap mic to finish")
                recordingTimeout = scope.launch {
                    delay(120_000)
                    if (state == State.LISTENING) finishDictation()
                }
            } catch (error: Exception) {
                live.close()
                recorder?.stop()
                recorder = null
                session = null
                if (generation == fieldGeneration) {
                    state = State.IDLE
                    showStatus(if (error is SecurityException) "Microphone permission needed" else "Could not start dictation")
                }
            }
        }
    }

    private fun finishDictation() {
        recordingTimeout?.cancel()
        recordingTimeout = null
        state = State.PROCESSING
        showStatus("Processing…")
        val generation = fieldGeneration
        val mic = recorder
        val live = session
        finishJob = scope.launch {
            try {
                mic?.stop()
                val transcript = live?.finish().orEmpty()
                if (generation != fieldGeneration) return@launch
                if (transcript.isBlank()) { showStatus("No speech heard"); return@launch }
                val key = settings.apiKey() ?: return@launch
                when (val result = DictationPipeline.process(transcript, settings.snapshot(currentInputEditorInfo?.packageName), key)) {
                    is DictationResult.Insert -> if (generation == fieldGeneration && result.text.isNotEmpty()) {
                        currentInputConnection?.commitText(result.text, 1)
                        lastInserted = result.text
                        lastField = generation
                        showStatus("Inserted")
                    }
                    DictationResult.DeleteLast -> {
                        if (generation == lastField && lastInserted.isNotEmpty() &&
                            currentInputConnection?.getTextBeforeCursor(lastInserted.length, 0)?.toString() == lastInserted) {
                            currentInputConnection?.deleteSurroundingText(lastInserted.length, 0)
                            lastInserted = ""
                            showStatus("Removed")
                        } else showStatus("Nothing to remove")
                    }
                }
            } catch (_: Exception) {
                if (generation == fieldGeneration) showStatus("Dictation failed · try again")
            } finally {
                withContext(NonCancellable) { mic?.stop(); live?.close() }
                if (recorder === mic) recorder = null
                if (session === live) session = null
                if (generation == fieldGeneration) {
                    state = State.IDLE
                    updateMicButton()
                }
            }
        }
    }

    private fun type(text: String) {
        currentInputConnection?.commitText(text, 1)
        lastInserted = ""
    }

    private fun deleteOne() {
        currentInputConnection?.deleteSurroundingTextInCodePoints(1, 0)
        lastInserted = ""
    }

    private fun showStatus(text: String) {
        statusView?.text = text
        updateMicButton()
    }

    private fun updateMicButton() {
        micButton?.isEnabled = !privateField && state != State.PROCESSING
        micButton?.text = when (state) {
            State.IDLE -> "🎙 Speak"
            State.CONNECTING -> "Cancel"
            State.LISTENING -> "■ Stop"
            State.PROCESSING -> "Wait…"
        }
        if (privateField) statusView?.text = "Voice off in private field"
    }

    private fun openSettings() {
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun isPrivate(info: EditorInfo?): Boolean {
        if (info == null) return true
        val variation = info.inputType and InputType.TYPE_MASK_VARIATION
        val kind = info.inputType and InputType.TYPE_MASK_CLASS
        return (kind == InputType.TYPE_CLASS_TEXT && variation in setOf(
            InputType.TYPE_TEXT_VARIATION_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
        )) || (kind == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD)
            || (info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING) != 0
    }

    private val Int.dp: Int get() = (this * resources.displayMetrics.density).toInt()

    private fun LinearLayout.key(label: String, width: Int, action: () -> Unit): Button = Button(this@FlowImeService).also {
        it.text = label
        it.textSize = 16f
        it.isAllCaps = false
        it.minWidth = 0
        it.minimumWidth = 0
        it.setPadding(0, 0, 0, 0)
        it.setOnClickListener { action() }
        addView(it, if (width == 0) LinearLayout.LayoutParams(0, 47.dp, 1f)
            else LinearLayout.LayoutParams(width, 47.dp))
    }
}
