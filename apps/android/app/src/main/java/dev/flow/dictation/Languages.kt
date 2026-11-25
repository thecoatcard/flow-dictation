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

    /** Languages the text can be written in whatever was spoken. The first entry, "", keeps the spoken language. */
    val writeIn = listOf(
        "", "English", "Hindi", "Bengali", "Gujarati", "Marathi", "Tamil", "Telugu", "Urdu",
        "Spanish", "French", "German", "Portuguese", "Arabic",
    )

    /** A plain language name only (letters, spaces, brackets, hyphen; at most 40), so it cannot carry instructions. */
    fun cleanWriteIn(value: String?): String {
        val t = value?.trim().orEmpty()
        return if (t.length <= 40 && Regex("^[\\p{L} ()-]+$").matches(t)) t else ""
    }

    fun byCode(code: String): Language = all.firstOrNull { it.code == code } ?: all.first()

    /** What goes into the transcription setup: nothing for auto-detect, otherwise the one language. */
    fun codes(code: String): List<String> = if (byCode(code).code.isEmpty()) emptyList() else listOf(code)
}
