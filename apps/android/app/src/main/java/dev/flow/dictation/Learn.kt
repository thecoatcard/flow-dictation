package dev.flow.dictation

/**
 * Dictionary suggestions from a correction, the same rules as the desktop app's learnTerms: words that
 * appear only in the corrected text and look like names or technical terms. Everyday words are ignored.
 */
object Learn {
    private val edge = Regex("^[\\s\"'“”‘’(\\[{<]+|[\\s\"'“”‘’)\\]}>.,;:!?…]+$")
    private val sentenceEnd = Regex("[.!?…][\"'”’)]*$")

    private data class Token(val text: String, val startsSentence: Boolean)

    private fun tokens(text: String): List<Token> {
        val out = ArrayList<Token>()
        var startsSentence = true
        for (raw in text.split(Regex("\\s+"))) {
            val word = raw.replace(edge, "")
            if (word.isNotEmpty()) out.add(Token(word, startsSentence))
            startsSentence = sentenceEnd.containsMatchIn(raw) || raw.isEmpty()
        }
        return out
    }

    private fun looksLikeTerm(token: Token): Boolean {
        val text = token.text
        if (!Regex("\\p{L}").containsMatchIn(text)) return false // numbers alone are not terms
        if (Regex("\\d").containsMatchIn(text)) return true // k8s, GPT4, v2
        if (Regex("\\p{Ll}\\p{Lu}").containsMatchIn(text)) return true // camelCase, iPhone
        if (Regex("^\\p{Lu}{2,}$").matches(text)) return true // acronyms: API, EPAM
        if (Regex("[_.#+]").containsMatchIn(text) && text.length > 2) return true // Node.js, C#
        return Regex("^\\p{Lu}").containsMatchIn(text) && !token.startsSentence // a capital inside a sentence
    }

    /** Terms in [after] that were not in [before] and are not already [known], in order, without repeats. */
    fun terms(before: String, after: String, known: List<String> = emptyList()): List<String> {
        val seen = HashSet<String>()
        tokens(before).forEach { seen.add(it.text.lowercase()) }
        known.forEach { seen.add(it.trim().lowercase()) }
        val out = ArrayList<String>()
        for (t in tokens(after)) {
            val key = t.text.lowercase()
            if (key in seen || t.text.length < 2 || !looksLikeTerm(t)) continue
            seen.add(key)
            out.add(t.text)
        }
        return out
    }
}
