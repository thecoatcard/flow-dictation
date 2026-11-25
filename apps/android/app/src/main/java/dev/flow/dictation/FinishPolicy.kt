package dev.flow.dictation

/**
 * When to stop waiting for Gemini's final transcript once the audio has ended. The server sometimes
 * never sends turnComplete, so a quiet transcript is treated as final instead of waiting out the cap.
 * The numbers come from the desktop app's logs: a real turnComplete arrives within about 665 ms.
 */
object FinishPolicy {
    const val QUIET_MS = 700L
    const val EMPTY_MS = 1500L
    const val HARD_CAP_MS = 3000L

    /** [idleMs]: time since the last transcript text arrived (or since the audio ended, if later). */
    fun isFinal(hasText: Boolean, idleMs: Long): Boolean = idleMs >= if (hasText) QUIET_MS else EMPTY_MS
}
