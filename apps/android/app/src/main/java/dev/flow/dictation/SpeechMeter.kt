package dev.flow.dictation

import kotlin.math.sqrt

/**
 * Tracks how loud a recording got, so a clip that only had noise or silence is dropped before the text
 * the speech model made up from it is used. Same thresholds and rules as the desktop's SpeechMeter.
 */
class SpeechMeter {
    var chunks = 0
        private set
    var peak = 0.0
        private set
    var voiced = 0
        private set

    /** [count] bytes of 16-bit little-endian mono PCM. */
    fun push(pcm: ByteArray, count: Int) {
        val rms = rms(pcm, count)
        chunks++
        if (rms > peak) peak = rms
        if (rms >= SPEECH_RMS) voiced++
    }

    /**
     * True when the transcript should be thrown away: the mic never heard anything speech-like, or it was
     * quiet and the text is one of the stock phrases models invent from silence. With no audio at all the
     * meter cannot judge, so it keeps the text.
     */
    fun rejects(text: String): Boolean {
        if (chunks == 0) return false
        if (voiced == 0) return true
        return peak < QUIET_PEAK && phantom.matches(text)
    }

    companion object {
        /** A chunk this loud (RMS, fraction of full scale) counts as possible speech. */
        const val SPEECH_RMS = 0.01
        /** Below this peak a clip is quiet enough that stock "phantom" phrases are likely hallucinations. */
        const val QUIET_PEAK = 0.03

        private val phantom = Regex(
            "^\\s*(?:(?:thank you|thanks|thanks for watching|thank you for watching|you|bye|bye-bye|okay|ok|so|uh|um|hmm|mm|\\.+)[\\s.!?,]*)+$",
            RegexOption.IGNORE_CASE,
        )

        /** RMS of a PCM16 chunk as a fraction of full scale (speech sits around 0.02 to 0.1). */
        fun rms(pcm: ByteArray, count: Int): Double {
            val samples = minOf(count, pcm.size) / 2
            if (samples == 0) return 0.0
            var sum = 0.0
            for (i in 0 until samples) {
                val v = ((pcm[2 * i + 1].toInt() shl 8) or (pcm[2 * i].toInt() and 0xff)).toShort() / 32768.0
                sum += v * v
            }
            return sqrt(sum / samples)
        }
    }
}
