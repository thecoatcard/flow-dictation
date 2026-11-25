package dev.flow.dictation

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * Reads text aloud with the phone's own voice: no network, no cost, nothing leaves the phone.
 * Starts the engine on first use. Text in Devanagari is read with a Hindi voice when the phone has one.
 */
class Speaker(context: Context) {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    private var ready = false
    private var queued: Pair<String, () -> Unit>? = null

    /** Speaks [text], replacing anything already being read. [onEnd] runs when it finishes or is stopped. */
    fun speak(text: String, onEnd: () -> Unit = {}) {
        val spoken = text.trim()
        if (spoken.isEmpty()) { onEnd(); return }
        val tts = engine ?: create().also { engine = it }
        if (!ready) { queued = spoken to onEnd; return }
        say(tts, spoken, onEnd)
    }

    fun stop() {
        queued = null
        engine?.stop()
    }

    fun shutdown() {
        queued = null
        engine?.shutdown()
        engine = null
        ready = false
    }

    private fun create(): TextToSpeech = TextToSpeech(app) { status ->
        main.post {
            ready = status == TextToSpeech.SUCCESS
            val tts = engine
            val waiting = queued
            queued = null
            if (waiting != null) {
                if (ready && tts != null) say(tts, waiting.first, waiting.second) else waiting.second()
            }
        }
    }

    private fun say(tts: TextToSpeech, text: String, onEnd: () -> Unit) {
        val hindi = Regex("[\\u0900-\\u097F]").containsMatchIn(text)
        val locale = if (hindi) Locale("hi", "IN") else Locale.getDefault()
        if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) tts.language = locale
        val id = "flow-${System.nanoTime()}"
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) { if (utteranceId == id) main.post(onEnd) }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { if (utteranceId == id) main.post(onEnd) }
            override fun onStop(utteranceId: String?, interrupted: Boolean) { if (utteranceId == id) main.post(onEnd) }
        })
        val limit = TextToSpeech.getMaxSpeechInputLength() - 1
        if (tts.speak(text.take(limit), TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) onEnd()
    }
}
