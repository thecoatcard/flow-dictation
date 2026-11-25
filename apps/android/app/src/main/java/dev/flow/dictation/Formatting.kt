package dev.flow.dictation

/**
 * Smart formatting on the phone: the cleanup model writes lists, paragraphs and **bold** as Markdown, and this phone inserts
 * plain text, so the Markdown becomes clean bullets, numbers and paragraphs with no symbols. A port of markdownToPlain in
 * packages/core/src/format.ts.
 */
object Formatting {
    private val bold = Regex("\\*\\*(?=\\S)(.+?)(?<=\\S)\\*\\*")
    private val bullet = Regex("^\\s{0,3}[-*•]\\s+(.*)$")
    private val numbered = Regex("^\\s{0,3}(\\d{1,3})[.)]\\s+(.*)$")
    private val heading = Regex("^\\s{0,3}#{1,6}\\s+(.*)$")

    /** "- " bullets, "1." numbers, blank lines between paragraphs, and no ** or # symbols. */
    fun toPlain(markdown: String): String =
        markdown.replace("\r\n", "\n").replace('\r', '\n').split('\n').map { raw ->
            val line = heading.find(raw)?.groupValues?.get(1) ?: raw
            val item = bullet.find(line)
            val number = numbered.find(line)
            when {
                item != null && !line.trimStart().startsWith("**") -> "- ${item.groupValues[1].trim()}"
                number != null -> "${number.groupValues[1]}. ${number.groupValues[2].trim()}"
                else -> line.trimEnd(' ', '\t')
            }
        }.joinToString("\n")
            .replace(bold, "$1")
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
}
