package dev.flow.dictation

data class Language(val code: String, val label: String)

/** Languages the transcription can be pinned to. Empty code means "detect it", the default. */
object Languages {
    val all = listOf(
        Language("", "Auto-detect (recommended)"),
        Language("en-US", "English (US)"),
        Language("en-IN", "English (India)"),
        Language("en-GB", "English (UK)"),
        Language("hi-IN", "Hindi"),
        Language("es-ES", "Spanish"),
        Language("fr-FR", "French"),
        Language("de-DE", "German"),
        Language("pt-BR", "Portuguese (Brazil)"),
        Language("it-IT", "Italian"),
        Language("ja-JP", "Japanese"),
        Language("ko-KR", "Korean"),
    )

    fun byCode(code: String): Language = all.firstOrNull { it.code == code } ?: all.first()

    /** What goes into the transcription setup: nothing for auto-detect, otherwise the one language. */
    fun codes(code: String): List<String> = if (byCode(code).code.isEmpty()) emptyList() else listOf(code)
}
