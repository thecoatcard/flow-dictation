package dev.flow.dictation

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import android.app.Activity

class MainActivity : Activity() {
    private lateinit var settings: FlowSettings
    private lateinit var status: TextView
    private lateinit var permission: Button
    private lateinit var key: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = FlowSettings(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24.dp, 24.dp, 24.dp, 40.dp)
        }
        val scroll = ScrollView(this).apply { addView(column) }
        setContentView(scroll)

        column.label("Flow keyboard", 26f)
        column.label("Enable Flow once in Android settings, then select it as your default keyboard. Tap the mic on the keyboard to dictate; it never records automatically.")
        status = column.label("")
        column.button("1. Enable Flow keyboard") {
            startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
        }
        column.button("2. Choose default keyboard") {
            (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
        }
        permission = column.button("3. Allow microphone") {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }

        column.label("Google Gemini API key", 18f)
        column.label("Stored using Android Keystore. Audio and cleanup text go directly to Google.")
        key = EditText(this).apply {
            hint = if (settings.apiKey() == null) "Paste API key" else "Key saved securely"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
        }
        column.addView(key)
        column.button("Save API key") {
            try {
                settings.saveApiKey(key.text.toString())
                key.text.clear()
                key.hint = "Key saved securely"
                refreshStatus()
            } catch (error: Exception) { status.text = error.message ?: "Could not save key." }
        }
        column.button("Remove API key") {
            settings.clearApiKey()
            key.hint = "Paste API key"
            refreshStatus()
        }

        column.label("Cleanup", 18f)
        val levels = CleanupLevel.entries
        val levelPicker = column.picker(levels.map { it.name.lowercase().replaceFirstChar(Char::uppercase) })
        levelPicker.setSelection(levels.indexOf(settings.cleanupLevel))
        column.label("None keeps raw speech. Auto chooses the smallest useful edit in one request. Light makes minimal fixes. Medium can rephrase tangled wording.")

        column.label("Default app tone", 18f)
        val tones = Tone.entries
        val tonePicker = column.picker(tones.map { it.name.lowercase().replaceFirstChar(Char::uppercase) })
        tonePicker.setSelection(tones.indexOf(settings.defaultTone))
        column.label("Dictionary: one spelling per line", 18f)
        val dictionary = EditText(this).apply {
            hint = "Spring Boot\nAngular"
            minLines = 3
            setText(settings.dictionary.joinToString("\n"))
        }
        column.addView(dictionary)
        column.label("Writing style", 18f)
        val style = EditText(this).apply {
            hint = "Concise, natural, no exclamation marks"
            minLines = 3
            setText(settings.style)
        }
        column.addView(style)
        column.label("Snippets: phrase => replacement, one per line", 18f)
        val snippets = EditText(this).apply {
            hint = "my email => me@example.com"
            minLines = 3
            setText(settings.snippets.entries.joinToString("\n") { "${it.key} => ${it.value}" })
        }
        column.addView(snippets)
        column.label("Tone by app package (optional)", 18f)
        column.label("Most recent text field: ${settings.recentApp.ifEmpty { "none yet" }}. One line per app, for example com.whatsapp=casual.")
        val appTones = EditText(this).apply {
            hint = "com.whatsapp=casual\ncom.google.android.gm=professional"
            minLines = 3
            setText(settings.appTones.entries.joinToString("\n") { "${it.key}=${it.value.name.lowercase()}" })
        }
        column.addView(appTones)
        column.button("Save preferences") {
            settings.cleanupLevel = levels[levelPicker.selectedItemPosition]
            settings.defaultTone = tones[tonePicker.selectedItemPosition]
            settings.dictionary = dictionary.text.toString().lines().map(String::trim).filter(String::isNotEmpty)
            settings.style = style.text.toString()
            settings.snippets = snippets.text.toString().lines().mapNotNull { line ->
                val pair = line.split("=>", limit = 2)
                if (pair.size == 2 && pair[0].isNotBlank() && pair[1].isNotBlank())
                    pair[0].trim() to pair[1].trim() else null
            }.toMap()
            settings.appTones = appTones.text.toString().lines().mapNotNull { line ->
                val pair = line.split("=", limit = 2)
                val tone = tones.firstOrNull { it.name.equals(pair.getOrNull(1)?.trim(), ignoreCase = true) }
                if (pair.size == 2 && pair[0].isNotBlank() && tone != null)
                    pair[0].trim().lowercase() to tone else null
            }.toMap()
            status.text = "Preferences saved."
        }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun refreshStatus() {
        if (!::status.isInitialized) return
        val manager = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        val id = ComponentName(this, FlowImeService::class.java).flattenToShortString()
        val enabled = manager.enabledInputMethodList.any { it.id == id }
        val selected = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD) == id
        val mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        status.text = "Keyboard ${if (enabled) "enabled" else "not enabled"} · ${if (selected) "selected" else "not selected"} · Mic ${if (mic) "allowed" else "not allowed"} · Key ${if (settings.apiKey() != null) "saved" else "missing"}"
        permission.visibility = if (mic) View.GONE else View.VISIBLE
    }

    private val Int.dp: Int get() = (this * resources.displayMetrics.density).toInt()

    private fun LinearLayout.label(text: String, size: Float = 15f): TextView = TextView(this@MainActivity).also {
        it.text = text
        it.textSize = size
        it.setPadding(0, 14.dp, 0, 6.dp)
        addView(it)
    }

    private fun LinearLayout.button(text: String, action: () -> Unit): Button = Button(this@MainActivity).also {
        it.text = text
        it.setOnClickListener { action() }
        addView(it)
    }

    private fun LinearLayout.picker(labels: List<String>): Spinner = Spinner(this@MainActivity).also {
        it.adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, labels)
        addView(it)
    }
}
