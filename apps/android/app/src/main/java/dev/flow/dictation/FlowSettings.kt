package dev.flow.dictation

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

enum class CleanupLevel { NONE, AUTO, LIGHT, MEDIUM }
enum class Tone { CASUAL, PROFESSIONAL, LITERAL, CODE }

data class DictationPreferences(
    val level: CleanupLevel,
    val tone: Tone,
    val dictionary: List<String>,
    val style: String,
    val snippets: Map<String, String>
)

class FlowSettings(context: Context) {
    private val prefs = context.getSharedPreferences("flow-settings", Context.MODE_PRIVATE)

    var cleanupLevel: CleanupLevel
        get() = enumValue(prefs.getString("cleanup-level", null), CleanupLevel.LIGHT)
        set(value) { prefs.edit().putString("cleanup-level", value.name).apply() }

    var defaultTone: Tone
        get() = enumValue(prefs.getString("default-tone", null), Tone.CASUAL)
        set(value) { prefs.edit().putString("default-tone", value.name).apply() }

    var dictionary: List<String>
        get() = prefs.getString("dictionary", "").orEmpty().lines().map(String::trim).filter(String::isNotEmpty)
        set(value) { prefs.edit().putString("dictionary", value.joinToString("\n")).apply() }

    var style: String
        get() = prefs.getString("style", "").orEmpty()
        set(value) { prefs.edit().putString("style", value.take(800)).apply() }

    var snippets: Map<String, String>
        get() = prefs.getString("snippets", "").orEmpty().lines().mapNotNull { line ->
            val parts = line.split("=>", limit = 2)
            if (parts.size == 2 && parts[0].isNotBlank() && parts[1].isNotBlank())
                parts[0].trim() to parts[1].trim() else null
        }.toMap()
        set(value) {
            prefs.edit().putString("snippets", value.entries.joinToString("\n") { "${it.key} => ${it.value}" }).apply()
        }

    var appTones: Map<String, Tone>
        get() = prefs.getString("app-tones", "").orEmpty().lines().mapNotNull { line ->
            val parts = line.split("=", limit = 2)
            val tone = Tone.entries.firstOrNull { it.name.equals(parts.getOrNull(1)?.trim(), ignoreCase = true) }
            if (parts.size == 2 && parts[0].isNotBlank() && tone != null)
                parts[0].trim().lowercase() to tone else null
        }.toMap()
        set(value) {
            prefs.edit().putString("app-tones", value.entries.joinToString("\n") { "${it.key}=${it.value.name.lowercase()}" }).apply()
        }

    /** US dollars per hour of live transcription; the published price is unclear, so the user can adjust it. */
    var sttUsdPerHour: Float
        get() = prefs.getFloat("stt-usd-per-hour", 0.54f)
        set(value) { prefs.edit().putFloat("stt-usd-per-hour", value.coerceIn(0f, 999f)).apply() }

    data class Usage(val dictations: Int, val audioSeconds: Double)

    private fun monthKey(): String = java.util.Calendar.getInstance().let { "${it.get(java.util.Calendar.YEAR)}-${it.get(java.util.Calendar.MONTH)}" }

    /** This calendar month's totals; they start over each month like the desktop Usage page. */
    fun usage(): Usage =
        if (prefs.getString("usage-month", null) != monthKey()) Usage(0, 0.0)
        else Usage(prefs.getInt("usage-count", 0), prefs.getFloat("usage-seconds", 0f).toDouble())

    fun recordUsage(audioSeconds: Double) {
        val now = usage()
        prefs.edit().putString("usage-month", monthKey()).putInt("usage-count", now.dictations + 1)
            .putFloat("usage-seconds", (now.audioSeconds + audioSeconds).toFloat()).apply()
    }

    var recentApp: String
        get() = prefs.getString("recent-app", "").orEmpty()
        set(value) { prefs.edit().putString("recent-app", value).apply() }

    var bubblePosition: Pair<Int, Int>?
        get() = if (prefs.contains("bubble-x") && prefs.contains("bubble-y"))
            prefs.getInt("bubble-x", 0) to prefs.getInt("bubble-y", 0) else null
        set(value) {
            val edit = prefs.edit()
            if (value == null) edit.remove("bubble-x").remove("bubble-y")
            else edit.putInt("bubble-x", value.first).putInt("bubble-y", value.second)
            edit.apply()
        }

    fun snapshot(appId: String? = null) = DictationPreferences(
        cleanupLevel, appTones[appId?.lowercase()] ?: defaultTone, dictionary, style, snippets
    )

    fun apiKey(): String? {
        val stored = prefs.getString("api-key", null) ?: return null
        return try {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
        } catch (_: Exception) { null }
    }

    fun hasApiKey(): Boolean = prefs.contains("api-key")

    fun saveApiKey(value: String) {
        require(value.trim().length >= 10) { "Enter a valid Google API key." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val stored = cipher.iv + cipher.doFinal(value.trim().toByteArray(Charsets.UTF_8))
        prefs.edit().putString("api-key", Base64.encodeToString(stored, Base64.NO_WRAP)).apply()
    }

    fun clearApiKey() { prefs.edit().remove("api-key").apply() }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("flow-api-key", null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder("flow-api-key", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return generator.generateKey()
    }

    private inline fun <reified T : Enum<T>> enumValue(raw: String?, fallback: T): T =
        enumValues<T>().firstOrNull { it.name == raw } ?: fallback
}
