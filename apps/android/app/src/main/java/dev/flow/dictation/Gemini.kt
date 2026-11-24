package dev.flow.dictation

import android.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** One shared connection pool. The key and dictated text are never logged. */
private val http = OkHttpClient.Builder().build()

class GeminiLiveTranscriber(private val key: String, private val vocabulary: List<String>) {
    private val ready = CompletableDeferred<Unit>()
    private val done = CompletableDeferred<Unit>()
    private val lock = Any()
    private val finals = StringBuilder()
    private var interim = ""
    private var failure = false
    private var socket: WebSocket? = null

    suspend fun connect() {
        // This is the same v1beta WebSocket endpoint and setup shape used by @google/genai.
        val url = "https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
            .toHttpUrl().newBuilder().addQueryParameter("key", key).build().toString().replaceFirst("https:", "wss:")
        val request = Request.Builder().url(url).build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val transcription = JSONObject()
                if (vocabulary.isNotEmpty()) transcription.put("customVocabulary", JSONArray(vocabulary.take(100)))
                val setup = JSONObject().put("model", "models/gemini-3.5-transcribe-live")
                    .put("generationConfig", JSONObject().put("responseModalities", JSONArray().put("TEXT")))
                    .put("inputAudioTranscription", transcription)
                webSocket.send(JSONObject().put("setup", setup).toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val message = JSONObject(text)
                    if (message.has("setupComplete") && !ready.isCompleted) ready.complete(Unit)
                    val content = message.optJSONObject("serverContent") ?: return
                    synchronized(lock) {
                        val final = content.optJSONObject("inputTranscription")?.optString("text").orEmpty()
                        if (final.isNotEmpty()) {
                            if (final.startsWith(finals.toString())) {
                                finals.clear().append(final)
                            } else {
                                finals.append(final)
                            }
                            interim = ""
                        }
                        val partial = content.optJSONObject("interimInputTranscription")?.optString("text").orEmpty()
                        if (partial.isNotEmpty()) interim = partial
                    }
                    if (content.optBoolean("turnComplete") || content.optBoolean("generationComplete"))
                        done.complete(Unit)
                } catch (_: Exception) {
                    // Ignore a malformed server event; the finalization timeout still applies.
                }
            }

            override fun onFailure(webSocket: WebSocket, error: Throwable, response: Response?) {
                failure = true
                val detail = when (response?.code) {
                    400 -> "Live setup rejected (HTTP 400)."
                    401, 403 -> "Live key or model access denied (HTTP ${response.code})."
                    429 -> "Live quota reached (HTTP 429)."
                    null -> "Live network connection failed."
                    else -> "Live connection failed (HTTP ${response.code})."
                }
                if (!ready.isCompleted) ready.completeExceptionally(IOException(detail))
                if (!done.isCompleted) done.complete(Unit)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (code != 1000) failure = true
                if (!ready.isCompleted) ready.completeExceptionally(IOException("Live setup closed (code $code)."))
                if (!done.isCompleted) done.complete(Unit)
            }
        })
        try { withTimeout(7_000) { ready.await() } }
        catch (error: Exception) {
            close()
            if (error is kotlinx.coroutines.TimeoutCancellationException)
                throw IOException("Live connection timed out.")
            throw error
        }
    }

    fun sendAudio(pcm: ByteArray, length: Int) {
        val bytes = if (length == pcm.size) pcm else pcm.copyOf(length)
        val audio = JSONObject().put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            .put("mimeType", "audio/pcm;rate=16000")
        if (socket?.send(JSONObject().put("realtimeInput", JSONObject().put("audio", audio)).toString()) != true)
            throw IOException("Transcription connection closed.")
    }

    suspend fun finish(): String {
        socket?.send(JSONObject().put("realtimeInput", JSONObject().put("audioStreamEnd", true)).toString())
        withTimeoutOrNull(3_000) { done.await() }
        val text = synchronized(lock) { (finals.toString() + interim).trim() }
        close()
        if (text.isEmpty() && failure) throw IOException("Transcription failed.")
        return text
    }

    fun close() { socket?.close(1000, null); socket = null }
}

class GeminiEditor(private val key: String) {
    suspend fun edit(system: String, transcript: String): String {
        val body = JSONObject()
            .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
            .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", transcript)))))
            .put("generationConfig", JSONObject().put("temperature", 0).put("thinkingConfig", JSONObject().put("thinkingLevel", "MINIMAL")))
        val request = Request.Builder()
            .url("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent")
            .header("x-goog-api-key", key)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        val client = http.newBuilder().callTimeout(2_500, TimeUnit.MILLISECONDS).build()
        val call = client.newCall(request)
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(IOException("Cleanup request failed."))
                }

                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        if (!continuation.isActive) return
                        if (!response.isSuccessful) {
                            val detail = when (response.code) {
                                400 -> "Cleanup request rejected (HTTP 400)."
                                401, 403 -> "API key or cleanup model access denied (HTTP ${response.code})."
                                429 -> "Cleanup quota reached (HTTP 429)."
                                else -> "Cleanup request failed (HTTP ${response.code})."
                            }
                            continuation.resumeWithException(IOException(detail))
                            return
                        }
                        try {
                            val candidate = JSONObject(response.body?.string().orEmpty())
                                .getJSONArray("candidates").getJSONObject(0)
                                .getJSONObject("content").getJSONArray("parts")
                            val result = buildString {
                                for (i in 0 until candidate.length()) append(candidate.getJSONObject(i).optString("text"))
                            }
                            continuation.resume(result)
                        } catch (_: Exception) {
                            continuation.resumeWithException(IOException("Cleanup response was invalid."))
                        }
                    }
                }
            })
        }
    }
}

/** Checks both models without recording audio. Each request returns only a small diagnostic. */
suspend fun testGeminiApi(key: String, onStep: (String) -> Unit) {
    onStep("Testing cleanup model…")
    val response = GeminiEditor(key).edit("Reply with exactly OK.", "ping")
    if (response.isBlank()) throw IOException("Cleanup model returned no text.")
    onStep("Testing live transcription setup…")
    val live = GeminiLiveTranscriber(key, emptyList())
    try { live.connect() } finally { live.close() }
}
