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
    private class Request(val text: String, val onFail: () -> Unit, val onEnd: () -> Unit)

    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    private var ready = false
    private var queued: Request? = null

    /**
     * Speaks [text], replacing anything already being read. [onFail] runs when the phone has no voice to use
     * (no engine, or it could not start). [onEnd] runs when speech finishes, is stopped, or failed.
     */
    fun speak(text: String, onFail: () -> Unit = {}, onEnd: () -> Unit = {}) {
        val request = Request(text.trim(), onFail, onEnd)
        if (request.text.isEmpty()) { onEnd(); return }
        val tts = engine
        when {
            tts != null && ready -> say(tts, request)
            tts != null -> queued = request // the engine is still starting
            else -> { queued = request; engine = create() }
        }
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

    private fun create(): TextToSpeech {
        var created: TextToSpeech? = null
        created = TextToSpeech(app) { status ->
            main.post {
                val waiting = queued
                queued = null
                if (status == TextToSpeech.SUCCESS) {
                    ready = true
                    val tts = engine
                    if (waiting != null && tts != null) say(tts, waiting)
                } else {
                    // No engine, or it refused to start: forget it so the next try starts a new one.
                    ready = false
                    created?.shutdown()
                    if (engine === created) engine = null
                    waiting?.let { it.onFail(); it.onEnd() }
                }
            }
        }
        return created
    }

    private fun say(tts: TextToSpeech, request: Request) {
        val hindi = Regex("[\\u0900-\\u097F]").containsMatchIn(request.text)
        val locale = if (hindi) Locale("hi", "IN") else Locale.getDefault()
        if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) tts.language = locale
        val id = "flow-${System.nanoTime()}"
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit
            override fun onDone(utteranceId: String?) { if (utteranceId == id) main.post(request.onEnd) }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                if (utteranceId == id) main.post { request.onFail(); request.onEnd() }
            }
            override fun onStop(utteranceId: String?, interrupted: Boolean) { if (utteranceId == id) main.post(request.onEnd) }
        })
        val limit = TextToSpeech.getMaxSpeechInputLength() - 1
        if (tts.speak(request.text.take(limit), TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
            request.onFail()
            request.onEnd()
        }
    }
}
