package dev.flow.dictation

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.widget.TextView
import android.app.Activity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import android.graphics.Color
import android.graphics.drawable.GradientDrawable

class MainActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var settings: FlowSettings
    private lateinit var status: TextView
    private lateinit var permission: Button
    private lateinit var overlayPermission: Button
    private lateinit var accessPermission: Button
    private lateinit var bubbleButton: Button
    private lateinit var testButton: Button
    private lateinit var key: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(13, 21, 34)
        window.navigationBarColor = Color.rgb(13, 21, 34)
        settings = FlowSettings(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp, 24.dp, 20.dp, 40.dp)
            setBackgroundColor(Color.rgb(13, 21, 34))
        }
        val scroll = ScrollView(this).apply { addView(column) }
        setContentView(scroll)

        column.label("FLOW", 14f)
        column.label("Speak anywhere.", 28f)
        column.label("Keep your usual keyboard. Tap or hold the floating mic in a text field to dictate.")
        status = column.label("")
        column.label("GET READY", 18f)
        column.label("Allow these once. Flow appears alongside your keyboard and inserts into the field you selected.")
        permission = column.button("Allow microphone") {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }
        overlayPermission = column.button("Allow floating bubble") {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        accessPermission = column.button("Allow text insertion") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        bubbleButton = column.button("Show floating mic") {
            if (FlowBubbleService.active != null) stopService(Intent(this, FlowBubbleService::class.java))
            else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
                Settings.canDrawOverlays(this) && FlowAccessibilityService.active != null)
                startForegroundService(Intent(this, FlowBubbleService::class.java))
            else status.text = "Allow microphone, floating bubble and text insertion first."
        }
        column.button("Copy last dictation") {
            val text = FlowBubbleService.active?.lastText.orEmpty()
            if (text.isEmpty()) status.text = "No dictation to copy yet."
            else {
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("Flow dictation", text))
                status.text = "Copied last dictation."
            }
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
        testButton = column.button("Test API connection") {
            val saved = settings.apiKey()
            if (saved == null) { status.text = "Save an API key first."; return@button }
            testButton.isEnabled = false
            scope.launch {
                try {
                    testGeminiApi(saved) { step -> runOnUiThread { status.text = step } }
                    status.text = "API ready: cleanup and Live transcription connected."
                } catch (error: Exception) { status.text = error.message ?: "API test failed." }
                finally { testButton.isEnabled = true }
            }
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

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    private fun refreshStatus() {
        if (!::status.isInitialized) return
        val mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val overlay = Settings.canDrawOverlays(this)
        val access = FlowAccessibilityService.active != null
        status.text = "Mic ${if (mic) "ready" else "needed"} · Bubble ${if (overlay) "ready" else "needed"} · Text access ${if (access) "ready" else "needed"} · Key ${if (settings.apiKey() != null) "saved" else "missing"}"
        permission.text = if (mic) "✓ Microphone allowed" else "Allow microphone"
        overlayPermission.text = if (overlay) "✓ Floating bubble allowed" else "Allow floating bubble"
        accessPermission.text = if (access) "✓ Text insertion allowed" else "Allow text insertion"
        bubbleButton.text = if (FlowBubbleService.active != null) "Stop floating mic" else "Show floating mic"
    }

    private val Int.dp: Int get() = (this * resources.displayMetrics.density).toInt()

    private fun LinearLayout.label(text: String, size: Float = 15f): TextView = TextView(this@MainActivity).also {
        it.text = text
        it.textSize = size
        it.setTextColor(if (size >= 18f) Color.WHITE else Color.rgb(174, 194, 209))
        it.setPadding(0, 15.dp, 0, 7.dp)
        addView(it)
    }

    private fun LinearLayout.button(text: String, action: () -> Unit): Button = Button(this@MainActivity).also {
        it.text = text
        it.isAllCaps = false
        it.setTextColor(Color.WHITE)
        it.background = GradientDrawable().apply { setColor(Color.rgb(39, 75, 86)); cornerRadius = 12.dp.toFloat() }
        it.setOnClickListener { action() }
        addView(it, LinearLayout.LayoutParams(-1, 48.dp).apply { topMargin = 8.dp })
    }

    private fun LinearLayout.picker(labels: List<String>): Spinner = Spinner(this@MainActivity).also {
        it.adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, labels)
        addView(it)
    }
}
