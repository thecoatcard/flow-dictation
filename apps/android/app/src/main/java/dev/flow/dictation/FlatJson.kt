package dev.flow.dictation

/**
 * Reads the one flat JSON object Ask's model replies with: string keys and string values. Written by hand
 * because the platform's JSON classes are not available in unit tests, and nothing richer is needed.
 * Non-string values are kept as their raw text; nested objects or arrays make the whole reply unreadable.
 */
object FlatJson {
    /** The key/value pairs of the first `{ ... }` in [text], or null when it is not a flat object. */
    fun parse(text: String): Map<String, String>? {
        val start = text.indexOf('{')
        val end = text.lastIndexOf('}')
        if (start < 0 || end <= start) return null
        val s = text.substring(start + 1, end)
        val out = LinkedHashMap<String, String>()
        var i = 0
        fun skip() { while (i < s.length && (s[i].isWhitespace() || s[i] == ',')) i++ }
        fun string(): String? {
            if (i >= s.length || s[i] != '"') return null
            i++
            val b = StringBuilder()
            while (i < s.length) {
                val c = s[i++]
                when (c) {
                    '"' -> return b.toString()
                    '\\' -> {
                        if (i >= s.length) return null
                        when (val e = s[i++]) {
                            'n' -> b.append('\n')
                            't' -> b.append('\t')
                            'r' -> b.append('\r')
                            'b' -> b.append('\b')
                            'f' -> b.append('\u000C')
                            'u' -> {
                                if (i + 4 > s.length) return null
                                b.append(s.substring(i, i + 4).toIntOrNull(16)?.toChar() ?: return null)
                                i += 4
                            }
                            else -> b.append(e) // \" \\ \/ and anything else
                        }
                    }
                    else -> b.append(c)
                }
            }
            return null
        }
        while (true) {
            skip()
            if (i >= s.length) return out
            val key = string() ?: return null
            skip()
            if (i >= s.length || s[i] != ':') return null
            i++
            skip()
            if (i >= s.length) return null
            if (s[i] == '"') {
                out[key] = string() ?: return null
            } else {
                if (s[i] == '{' || s[i] == '[') return null
                val from = i
                while (i < s.length && s[i] != ',') i++
                out[key] = s.substring(from, i).trim()
            }
        }
    }
}
