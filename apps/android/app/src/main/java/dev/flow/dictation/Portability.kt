package dev.flow.dictation

import org.json.JSONArray
import org.json.JSONObject

private const val EXPORT_KIND = "flow-personalization"

/** Same file format as the desktop app's Backup page, so either can import the other's export. */
fun FlowSettings.exportPersonalization(): String = JSONObject()
    .put("kind", EXPORT_KIND)
    .put("version", 1)
    .put("dictionary", JSONArray().also { list ->
        dictionary.forEach { line ->
            val entry = JSONObject().put("term", line.substringBefore('|').trim())
            line.substringAfter('|', "").trim().takeIf(String::isNotEmpty)?.let { entry.put("hint", it) }
            list.put(entry)
        }
    })
    .put("appTones", JSONObject().also { map -> appTones.forEach { (app, tone) -> map.put(app, tone.name.lowercase()) } })
    .put("defaultTone", defaultTone.name.lowercase())
    .put("cleanupLevel", cleanupLevel.name.lowercase())
    .put("hindiOutput", hindiOutput.name.lowercase())
    .put("outputLanguage", outputLanguage)
    .put("smartFormatting", smartFormatting)
    .put("snippets", JSONArray().also { list ->
        snippets.forEach { (trigger, expansion) ->
            list.put(JSONObject().put("trigger", trigger).put("expansion", expansion))
        }
    })
    .put("style", style)
    .toString(2)

/** Replaces dictionary, tones, cleanup level, snippets and style. Throws on a foreign or invalid file. */
fun FlowSettings.importPersonalization(raw: String) {
    val root = try { JSONObject(raw) } catch (_: Exception) { throw IllegalArgumentException("This is not a Flow export.") }
    if (root.optString("kind") != EXPORT_KIND) throw IllegalArgumentException("This is not a Flow personalization export.")
    fun tone(value: String?) = Tone.entries.firstOrNull { it.name.equals(value, ignoreCase = true) }

    val terms = root.optJSONArray("dictionary")?.let { list ->
        (0 until list.length()).mapNotNull {
            val item = list.optJSONObject(it) ?: return@mapNotNull null
            val term = item.optString("term").trim().takeIf(String::isNotEmpty) ?: return@mapNotNull null
            val hint = item.optString("hint").trim()
            if (hint.isEmpty()) term else "$term | $hint"
        }
    }.orEmpty()
    val tones = root.optJSONObject("appTones")?.let { map ->
        map.keys().asSequence().mapNotNull { app -> tone(map.optString(app))?.let { app.trim().lowercase() to it } }
            .filter { it.first.isNotEmpty() }.toMap()
    }.orEmpty()
    val phrases = root.optJSONArray("snippets")?.let { list ->
        (0 until list.length()).mapNotNull {
            val item = list.optJSONObject(it) ?: return@mapNotNull null
            val trigger = item.optString("trigger").trim()
            val expansion = item.optString("expansion")
            if (trigger.isNotEmpty() && expansion.isNotBlank()) trigger to expansion else null
        }.toMap()
    }.orEmpty()

    dictionary = terms
    appTones = tones
    snippets = phrases
    style = root.optString("style")
    tone(root.optString("defaultTone"))?.let { defaultTone = it }
    CleanupLevel.entries.firstOrNull { it.name.equals(root.optString("cleanupLevel"), ignoreCase = true) }
        ?.let { cleanupLevel = it }
    HindiOutput.entries.firstOrNull { it.name.equals(root.optString("hindiOutput"), ignoreCase = true) }
        ?.let { hindiOutput = it } // an older export without the field keeps the current choice
    if (root.has("outputLanguage")) outputLanguage = root.optString("outputLanguage")
    if (root.has("smartFormatting")) smartFormatting = root.optBoolean("smartFormatting", true)
}
