package dev.flow.dictation

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 16 kHz mono PCM16, roughly 100 ms per chunk. Tracks are released on stop. */
class MicRecorder {
    private var record: AudioRecord? = null
    private var worker: Job? = null
    @Volatile private var running = false

    @Suppress("MissingPermission") // FlowBubbleService checks RECORD_AUDIO immediately before start.
    fun start(scope: CoroutineScope, onChunk: (ByteArray, Int) -> Unit, onError: () -> Unit) {
        check(record == null) { "Microphone is already active." }
        val minimum = AudioRecord.getMinBufferSize(16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "16 kHz microphone capture is unavailable." }
        val recorder = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION, 16_000,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minimum * 2, 6_400)
        )
        check(recorder.state == AudioRecord.STATE_INITIALIZED) { "Could not open microphone." }
        try { recorder.startRecording() }
        catch (error: Exception) { recorder.release(); throw error }
        record = recorder
        running = true
        worker = scope.launch(Dispatchers.IO) {
            val chunk = ByteArray(3_200)
            try {
                while (running) {
                    val count = recorder.read(chunk, 0, chunk.size)
                    if (count > 0) onChunk(chunk, count)
                    else if (count < 0 && running) throw IllegalStateException("Microphone disconnected.")
                }
            } catch (_: Exception) {
                if (running) scope.launch(Dispatchers.Main) { onError() }
            } finally { running = false }
        }
    }

    suspend fun stop() {
        val recorder = record ?: return
        record = null
        running = false
        withContext(Dispatchers.IO) {
            try { recorder.stop() } catch (_: Exception) { }
            worker?.join()
            worker = null
            recorder.release()
        }
    }
}
