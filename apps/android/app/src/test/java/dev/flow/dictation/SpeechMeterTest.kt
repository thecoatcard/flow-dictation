package dev.flow.dictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechMeterTest {
    /** 100 ms of 16 kHz PCM16 alternating at [amplitude] (fraction of full scale), so its RMS is [amplitude]. */
    private fun chunk(amplitude: Double): ByteArray {
        val bytes = ByteArray(3200)
        for (i in 0 until 1600) {
            val v = (amplitude * 32767 * (if (i % 2 == 0) -1 else 1)).toInt().toShort().toInt()
            bytes[2 * i] = (v and 0xff).toByte()
            bytes[2 * i + 1] = ((v shr 8) and 0xff).toByte()
        }
        return bytes
    }

    private fun meter(vararg amplitudes: Double) = SpeechMeter().also { m -> amplitudes.forEach { m.push(chunk(it), 3200) } }

    @Test fun measuresRmsLikeTheDesktop() {
        assertEquals(0.5, SpeechMeter.rms(chunk(0.5), 3200), 0.01)
        assertEquals(0.0, SpeechMeter.rms(chunk(0.0), 3200), 0.0)
        assertEquals(0.0, SpeechMeter.rms(ByteArray(0), 0), 0.0)
    }

    @Test fun rejectsTextFromARecordingThatNeverGotLoud() {
        assertTrue(meter(0.002, 0.002, 0.002).rejects("Thank you for watching the show tonight"))
    }

    @Test fun keepsRealSpeech() {
        assertFalse(meter(0.002, 0.08).rejects("send the report tomorrow"))
    }

    @Test fun rejectsStockPhrasesFromQuietAudioOnly() {
        assertTrue(meter(0.012).rejects("Thank you."))
        assertFalse(meter(0.1).rejects("Thank you."))
    }

    @Test fun cannotJudgeWithoutAudioSoKeepsTheText() {
        assertFalse(SpeechMeter().rejects("hello"))
    }
}
