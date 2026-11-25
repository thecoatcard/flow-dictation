package dev.flow.dictation

/**
 * Port of the desktop's isClearAlready. True when Auto cleanup would leave the text alone, so the model
 * call (the slowest step) can be skipped. Strict: any sign of a filler, stutter, correction, spoken
 * punctuation, list, odd casing or a missing sentence mark sends the text to the model as before.
 */
object FastPath {
    private const val MAX_CHARS = 600
    private val devanagari = Regex("[\\u0900-\\u097F]")
    private val fillers = Regex("\\b(?:u+m+|u+h+|e+r+m*|h+m+|m+h*m+|a+h+|you know|i mean|kind of|sort of)\\b", RegexOption.IGNORE_CASE)
    private val corrections = Regex("\\b(?:no wait|wait no|actually no|no no|scratch that|never mind|sorry|or rather|rather)\\b", RegexOption.IGNORE_CASE)
    private val spokenMarks = Regex("\\b(?:period|full stop|comma|question mark|exclamation (?:point|mark)|colon|semicolon|em dash|new line|new paragraph)\\b", RegexOption.IGNORE_CASE)
    private val spokenSymbols = Regex("\\b(?:dot com|dot org|at the rate|underscore|slash|hashtag)\\b", RegexOption.IGNORE_CASE)
    private val listWords = Regex("\\b(?:first|second|third|number one|number two)\\b|\\b(?:one|two|three)[,;:]", RegexOption.IGNORE_CASE)
    private val repeat = Regex("\\b([\\p{L}\\p{N}']+(?:\\s+[\\p{L}\\p{N}']+)?)\\s+\\1\\b", RegexOption.IGNORE_CASE)
    private val lowerI = Regex("(?:^|[\\s(])i(?:$|[\\s',.!?])")
    private val start = Regex("^[\\p{Lu}\\p{N}\"'(]")
    private val end = Regex("[.?!…][\"')]*$")
    private val spacing = Regex("\\s{2,}|\\s[,.;:!?]")

    fun isClearAlready(text: String, preferences: DictationPreferences): Boolean {
        if (preferences.level != CleanupLevel.AUTO || preferences.tone == Tone.CODE) return false
        val t = text.trim()
        if (t.isEmpty() || t.length > MAX_CHARS || t.contains('\n')) return false
        if (preferences.hindi == HindiOutput.DEVANAGARI || devanagari.containsMatchIn(t)) return false
        if (!start.containsMatchIn(t) || !end.containsMatchIn(t)) return false
        if (fillers.containsMatchIn(t) || corrections.containsMatchIn(t) ||
            spokenMarks.containsMatchIn(t) || spokenSymbols.containsMatchIn(t)) return false
        if (listWords.containsMatchIn(t) || repeat.containsMatchIn(t) || lowerI.containsMatchIn(t)) return false
        if (spacing.containsMatchIn(t)) return false
        val lower = t.lowercase()
        for (entry in preferences.dictionary) {
            val term = entry.substringBefore('|').trim()
            if (term.isNotEmpty() && lower.contains(term.lowercase()) && !t.contains(term)) return false
        }
        return true
    }
}
