package dev.flow.dictation

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** The dictation history on disk (history.json in the app's private storage, this phone only). */
class HistoryStore private constructor(context: Context) {
    private val file = File(context.filesDir, "history.json")
    private val list = HistoryList(load())

    companion object {
        @Volatile private var instance: HistoryStore? = null
        fun get(context: Context): HistoryStore =
            instance ?: synchronized(this) { instance ?: HistoryStore(context.applicationContext).also { instance = it } }
    }

    @Synchronized fun search(query: String): List<HistoryEntry> = list.search(query)

    @Synchronized fun add(text: String, app: String) {
        list.add(HistoryEntry(UUID.randomUUID().toString(), System.currentTimeMillis(), app, text))
        save()
    }

    @Synchronized fun update(id: String, text: String): Boolean = list.update(id, text).also { if (it) save() }
    @Synchronized fun text(id: String): String? = list.items.firstOrNull { it.id == id }?.text
    @Synchronized fun remove(id: String) { list.remove(id); save() }
    @Synchronized fun clear() { list.clear(); save() }

    private fun load(): List<HistoryEntry> = try {
        val raw = JSONArray(file.readText())
        (0 until raw.length()).mapNotNull {
            val o = raw.optJSONObject(it) ?: return@mapNotNull null
            val id = o.optString("id")
            val text = o.optString("text")
            if (id.isEmpty() || text.isEmpty()) null else HistoryEntry(id, o.optLong("at"), o.optString("app"), text)
        }
    } catch (_: Exception) { emptyList() } // missing or corrupt: start empty

    private fun save() {
        val array = JSONArray()
        list.items.forEach { array.put(JSONObject().put("id", it.id).put("at", it.at).put("app", it.app).put("text", it.text)) }
        val temp = File(file.parentFile, "history.json.tmp")
        temp.writeText(array.toString())
        temp.renameTo(file)
    }
}
