package dev.flow.dictation

data class HistoryEntry(val id: String, val at: Long, val app: String, val text: String)

/** The in-memory rules of the dictation history: newest first, capped, searchable. Storage is separate. */
class HistoryList(items: List<HistoryEntry> = emptyList(), private val max: Int = MAX) {
    var items: List<HistoryEntry> = items.take(max)
        private set

    companion object { const val MAX = 300 }

    fun add(entry: HistoryEntry) {
        if (entry.text.isBlank()) return
        items = (listOf(entry) + items).take(max)
    }

    /** Newest first. The query matches the text or the app, ignoring case. */
    fun search(query: String): List<HistoryEntry> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return items
        return items.filter { it.text.lowercase().contains(q) || it.app.lowercase().contains(q) }
    }

    /** Replaces an entry's text (a correction). False when the entry is gone or the text is blank. */
    fun update(id: String, text: String): Boolean {
        if (text.isBlank() || items.none { it.id == id }) return false
        items = items.map { if (it.id == id) it.copy(text = text) else it }
        return true
    }

    fun remove(id: String) { items = items.filter { it.id != id } }

    fun clear() { items = emptyList() }
}
