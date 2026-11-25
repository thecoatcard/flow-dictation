package dev.flow.dictation

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * memory.json: the notes and reminders Ask saved, kept only on this phone (the app's private storage). Whatever is read
 * back is validated, so a damaged file means an empty memory, never a crash.
 */
class MemoryStore private constructor(context: Context) {
    private val file = File(context.filesDir, "memory.json")
    private var data: MemoryData = load()

    companion object {
        @Volatile private var instance: MemoryStore? = null
        fun get(context: Context): MemoryStore =
            instance ?: synchronized(this) { instance ?: MemoryStore(context.applicationContext).also { instance = it } }
    }

    @Synchronized fun get(): MemoryData = data

    /** Replaces the memory (after an add, clear, snooze or delete) and saves it. */
    @Synchronized fun set(next: MemoryData) {
        if (next == data) return
        data = next
        save()
    }

    private fun load(): MemoryData = try {
        val root = JSONObject(file.readText())
        val notes = root.optJSONArray("notes")?.let { list ->
            (0 until list.length()).mapNotNull {
                val o = list.optJSONObject(it) ?: return@mapNotNull null
                val id = o.optString("id")
                val text = Memory.clean(o.optString("text"))
                if (id.isEmpty() || text.isEmpty()) null else Note(id, text, o.optLong("at"))
            }
        }.orEmpty()
        val reminders = root.optJSONArray("reminders")?.let { list ->
            (0 until list.length()).mapNotNull {
                val o = list.optJSONObject(it) ?: return@mapNotNull null
                val id = o.optString("id")
                val text = Memory.clean(o.optString("text"))
                if (id.isEmpty() || text.isEmpty() || !o.has("due")) return@mapNotNull null
                Reminder(
                    id, text, o.optLong("due"),
                    Repeat.entries.firstOrNull { r -> r.name.equals(o.optString("repeat"), ignoreCase = true) } ?: Repeat.NONE,
                    o.optLong("createdAt"),
                    if (o.has("snoozedUntil")) o.optLong("snoozedUntil") else null,
                )
            }
        }.orEmpty()
        MemoryData(notes.take(Memory.MAX_NOTES), reminders.take(Memory.MAX_REMINDERS))
    } catch (_: Exception) { MemoryData() } // missing or corrupt: start empty

    private fun save() {
        val root = JSONObject()
            .put("notes", JSONArray().also { a -> data.notes.forEach { a.put(JSONObject().put("id", it.id).put("text", it.text).put("at", it.at)) } })
            .put("reminders", JSONArray().also { a ->
                data.reminders.forEach {
                    val o = JSONObject().put("id", it.id).put("text", it.text).put("due", it.due)
                        .put("repeat", it.repeat.name.lowercase()).put("createdAt", it.createdAt)
                    it.snoozedUntil?.let { until -> o.put("snoozedUntil", until) }
                    a.put(o)
                }
            })
        val temp = File(file.parentFile, "memory.json.tmp")
        temp.writeText(root.toString())
        temp.renameTo(file)
    }
}
