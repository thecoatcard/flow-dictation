package dev.flow.dictation

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.sin

/**
 * The start and stop chimes, the same soft two-note bell as the Windows app: rising (G5 to D6) when
 * recording starts, falling when it stops. Synthesized, so there is no sound file to ship or license.
 */
object Chime {
    enum class Kind { START, STOP }

    private const val RATE = 44_100
    private val partials = listOf(1 to 1.0, 2 to 0.28, 3 to 0.08)

    private data class Note(val freq: Double, val at: Double, val len: Double, val peak: Double)

    private fun notes(kind: Kind) = if (kind == Kind.START)
        listOf(Note(784.0, 0.0, 0.07, 0.34), Note(1175.0, 0.075, 0.16, 0.30))
    else
        listOf(Note(1175.0, 0.0, 0.07, 0.27), Note(784.0, 0.075, 0.16, 0.23))

    /** 16-bit mono samples at 44.1 kHz. */
    fun samples(kind: Kind): ShortArray {
        val notes = notes(kind)
        val seconds = notes.maxOf { it.at + it.len + 0.12 }
        val out = DoubleArray((seconds * RATE).toInt())
        for (note in notes) {
            val start = (note.at * RATE).toInt()
            val tail = note.len + 0.09
            val decay = ln(1.0 / 0.0001) / (tail - 0.006) // from the peak to near silence over the tail
            val count = ((tail + 0.03) * RATE).toInt().coerceAtMost(out.size - start)
            for (i in 0 until count) {
                val t = i.toDouble() / RATE
                val envelope = if (t < 0.006) t / 0.006 else exp(-(t - 0.006) * decay)
                var value = 0.0
                for ((multiple, amplitude) in partials) value += amplitude / 1.36 * sin(2 * PI * note.freq * multiple * t)
                out[start + i] += value * envelope * note.peak
            }
        }
        return ShortArray(out.size) { (out[it].coerceIn(-1.0, 1.0) * Short.MAX_VALUE).toInt().toShort() }
    }

    /** Plays the chime without blocking. Respects the phone's media volume. */
    fun play(kind: Kind) {
        val data = samples(kind)
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(data.size * 2)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()
        track.write(data, 0, data.size)
        track.play()
        Handler(Looper.getMainLooper()).postDelayed({ runCatching { track.release() } }, data.size * 1000L / RATE + 150)
    }
}
