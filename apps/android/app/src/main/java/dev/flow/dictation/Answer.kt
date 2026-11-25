package dev.flow.dictation

/**
 * An answer from Ask, split into prose and fenced code blocks so the card can draw code in its own box with its own
 * Copy button. A port of splitAnswer and spokenText in packages/core/src/format.ts.
 */
object Answer {
    sealed interface Part {
        data class Text(val text: String) : Part
        data class Code(val lang: String, val text: String) : Part
    }

    private val fence = Regex("^```([A-Za-z0-9_+#.-]*)[ \\t]*\\n([\\s\\S]*?)\\n?```[ \\t]*$", RegexOption.MULTILINE)
    private val fenceStart = Regex("^```", RegexOption.MULTILINE)

    /** Splits at the fenced code blocks, in order. A block that was never closed counts as code to the end. */
    fun split(text: String): List<Part> {
        val closed = if (text.endsWith("\n")) text else text + "\n"
        val source = if (fenceStart.findAll(closed).count() % 2 == 1) closed + "```" else closed
        val parts = mutableListOf<Part>()
        var last = 0
        for (match in fence.findAll(source)) {
            val before = source.substring(last, match.range.first).trimEnd()
            if (before.isNotBlank()) parts += Part.Text(before.trimStart())
            parts += Part.Code(match.groupValues[1], match.groupValues[2])
            last = match.range.last + 1
        }
        val rest = source.substring(last).trim()
        if (rest.isNotEmpty()) parts += Part.Text(rest)
        return parts.ifEmpty { listOf(Part.Text(text.trim())) }
    }

    /** The prose for reading aloud: code blocks are skipped, since code read out loud is noise. */
    fun spokenText(text: String): String {
        val parts = split(text)
        val prose = parts.filterIsInstance<Part.Text>().joinToString(" ") { it.text }.trim()
        if (parts.none { it is Part.Code }) return prose
        return (if (prose.isEmpty()) "" else "$prose ") + "The code is shown on screen."
    }
}
