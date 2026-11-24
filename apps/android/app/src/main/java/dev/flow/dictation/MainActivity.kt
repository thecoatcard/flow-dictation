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
import android.widget.ProgressBar
import android.app.Activity
import android.app.AlertDialog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList

class MainActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var settings: FlowSettings
    private lateinit var status: TextView
    private lateinit var setupStatus: TextView
    private lateinit var permission: Button
    private lateinit var overlayPermission: Button
    private lateinit var accessPermission: Button
    private lateinit var bubbleButton: Button
    private lateinit var testButton: Button
    private lateinit var saveKeyButton: Button
    private lateinit var apiStatus: TextView
    private lateinit var testProgress: ProgressBar
    private lateinit var key: EditText
    private lateinit var usageText: TextView
    private lateinit var updateText: TextView
    private lateinit var updateButton: Button
    private var pendingUpdate: UpdateInfo? = null

    private companion object {
        const val EXPORT_REQUEST = 41
        const val IMPORT_REQUEST = 42
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(18, 20, 23)
        window.navigationBarColor = Color.rgb(18, 20, 23)
        settings = FlowSettings(this)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp, 24.dp, 20.dp, 40.dp)
            setBackgroundColor(Color.rgb(18, 20, 23))
        }
        val scroll = ScrollView(this).apply { addView(column) }
        setContentView(scroll)

        column.label("FLOW / ANDROID", 14f)
        column.label("Speak anywhere.", 30f)
        column.label("Keep your usual keyboard. Tap or hold the floating mic in a text field to dictate.")
        status = column.label("")
        val setup = column.section("GET READY")
        setup.label("Allow these once. Flow appears alongside your keyboard and inserts into the field you selected.")
        permission = setup.button("Allow microphone") {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }
        overlayPermission = setup.button("Allow floating bubble") {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        accessPermission = setup.button("Allow text insertion") {
            AlertDialog.Builder(this)
                .setTitle("Allow Flow to insert dictated text?")
                .setMessage(
                    "Flow uses Android Accessibility access to detect the text field you selected, " +
                        "read its current text and cursor, and insert your dictation only into that field. " +
                        "It also remembers the app package name for tone settings. Existing field text stays " +
                        "on your device; Flow sends only your recorded audio and dictated transcript to " +
                        "Google Gemini for transcription and cleanup. Flow excludes fields marked as password, " +
                        "number, phone, or URL. You can turn this access off in Android Settings at any time."
                )
                .setNegativeButton("Not now", null)
                .setPositiveButton("Continue") { _, _ ->
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                }
                .show()
        }
        bubbleButton = setup.button("Show floating mic", primary = true) {
            if (FlowBubbleService.active != null) {
                FlowBubbleService.stopByUser(this)
                setupStatus.text = "Floating mic stopped. It stays off until you start it again."
                bubbleButton.text = "Show floating mic"
            }
            else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
                Settings.canDrawOverlays(this) && FlowAccessibilityService.active != null) {
                settings.bubbleEnabled = true
                startForegroundService(Intent(this, FlowBubbleService::class.java))
                setupStatus.text = "Floating mic is on. It keeps running until you stop it."
                bubbleButton.text = "Stop floating mic"
            } else setupStatus.text = "Allow microphone, floating bubble and text insertion first."
        }
        setupStatus = setup.label("Open a text field after starting the floating mic.")
        setup.button("Reset bubble position") {
            settings.bubblePosition = null
            FlowBubbleService.active?.resetPosition()
            setupStatus.text = "Bubble moved back to the right edge."
        }
        setup.button("Copy last dictation") {
            val text = FlowBubbleService.active?.lastText.orEmpty()
            if (text.isEmpty()) status.text = "No dictation to copy yet."
            else {
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("Flow dictation", text))
                status.text = "Copied last dictation."
            }
        }

        val api = column.section("GOOGLE API")
        api.label("Stored using Android Keystore. Audio and cleanup text go directly to Google.")
        key = EditText(this).apply {
            hint = if (settings.hasApiKey()) "Key saved securely" else "Paste API key"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
            styleField()
        }
        api.addView(key)
        saveKeyButton = api.button("Save API key") {
            val value = key.text.toString()
            apiStatus.text = "Saving key…"
            saveKeyButton.isEnabled = false
            scope.launch {
                try {
                    withContext(Dispatchers.IO) { settings.saveApiKey(value) }
                    key.text.clear()
                    key.hint = "Key saved securely"
                    apiStatus.text = "Key saved securely. Test the connection below."
                    refreshStatus()
                } catch (error: Exception) {
                    apiStatus.text = error.message ?: "Could not save key."
                } finally {
                    saveKeyButton.isEnabled = true
                }
            }
        }
        testButton = api.button("Test API connection", primary = true) {
            testButton.isEnabled = false
            apiStatus.text = "Reading saved key…"
            testProgress.visibility = View.VISIBLE
            scope.launch {
                try {
                    val saved = withContext(Dispatchers.IO) { settings.apiKey() }
                        ?: throw IllegalStateException("Save an API key first.")
                    withTimeout(12_000) {
                        testGeminiApi(saved) { step -> runOnUiThread { apiStatus.text = step } }
                    }
                    apiStatus.text = "API ready: cleanup and Live transcription connected."
                } catch (error: Exception) { apiStatus.text = error.message ?: "API test failed." }
                finally { testButton.isEnabled = true; testProgress.visibility = View.GONE }
            }
        }
        apiStatus = api.label("Save a key, then test both Gemini models.")
        testProgress = ProgressBar(this, null, android.R.attr.progressBarStyleSmall).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        api.addView(testProgress)
        api.button("Remove API key") {
            settings.clearApiKey()
            key.hint = "Paste API key"
            apiStatus.text = "Key removed."
            refreshStatus()
        }

        val cleanup = column.section("AUTO CLEANUP")
        cleanup.label("Choose how much Flow edits after transcription. Applies to every app.")
        val levels = CleanupLevel.entries
        val cleanupHelp = mapOf(
            CleanupLevel.NONE to "Paste the raw transcript. Spoken line breaks and saved snippets still work.",
            CleanupLevel.AUTO to "Leave clean speech alone; use Light for small fixes and Medium only when wording is tangled.",
            CleanupLevel.LIGHT to "Remove fillers, accidental repeats and clear false starts; fix grammar with minimal rewriting.",
            CleanupLevel.MEDIUM to "Also reword tangled phrases for clarity and concision while keeping your meaning.",
        )
        val help = cleanup.label(cleanupHelp.getValue(settings.cleanupLevel))
        cleanup.segmented(levels.map { it.name.lowercase().replaceFirstChar(Char::uppercase) }, levels.indexOf(settings.cleanupLevel)) { index ->
            settings.cleanupLevel = levels[index]
            help.text = cleanupHelp.getValue(levels[index])
            status.text = "Cleanup level saved."
        }

        val hindi = column.section("HINDI")
        hindi.label("Choose how spoken Hindi is written. English stays English, and other languages are written as spoken.")
        val hindiHelp = mapOf(
            HindiOutput.HINGLISH to "Hindi speech is typed in English letters, like \"main kal office jaunga\".",
            HindiOutput.DEVANAGARI to "Hindi speech is typed in Devanagari, like \"मैं कल ऑफिस जाऊँगा\".",
        )
        val hindiHint = hindi.label(hindiHelp.getValue(settings.hindiOutput))
        val hindiChoices = HindiOutput.entries
        hindi.segmented(listOf("Hinglish (Roman)", "Devanagari (हिन्दी)"), hindiChoices.indexOf(settings.hindiOutput)) { index ->
            settings.hindiOutput = hindiChoices[index]
            hindiHint.text = hindiHelp.getValue(hindiChoices[index])
            status.text = "Hindi style saved."
        }

        val controls = column.section("DICTATION")
        controls.label("Default app tone", 18f)
        val tones = Tone.entries
        val tonePicker = controls.picker(tones.map { it.name.lowercase().replaceFirstChar(Char::uppercase) })
        tonePicker.setSelection(tones.indexOf(settings.defaultTone))
        val personal = column.section("PERSONALIZATION")
        personal.label("Dictionary: one term per line, optional note after |", 18f)
        val dictionary = EditText(this).apply {
            hint = "Spring Boot | Java framework\nAngular"
            minLines = 3
            setText(settings.dictionary.joinToString("\n"))
            styleField()
        }
        personal.addView(dictionary)
        personal.label("Writing style", 18f)
        val style = EditText(this).apply {
            hint = "Concise, natural, no exclamation marks"
            minLines = 3
            setText(settings.style)
            styleField()
        }
        personal.addView(style)
        personal.label("Learn it from your writing", 18f)
        personal.label("Paste two or three pieces of your own writing, separated by a blank line. Flow sends them to Google once to draft the style above, then forgets them.")
        val samples = EditText(this).apply { minLines = 4; styleField() }
        personal.addView(samples)
        personal.button("Draft my style") {
            status.text = "Drafting your style…"
            scope.launch {
                try {
                    val saved = withContext(Dispatchers.IO) { settings.apiKey() } ?: throw IllegalStateException("Save an API key first.")
                    style.setText(draftStyle(saved, samples.text.toString()))
                    samples.text.clear()
                    status.text = "Style drafted. Edit it if you like, then save preferences."
                } catch (error: Exception) { status.text = error.message ?: "Could not draft a style." }
            }
        }
        personal.label("Snippets: phrase => replacement, one per line. \"New line\", \"new paragraph\" and \"delete that\" already work.", 18f)
        val snippets = EditText(this).apply {
            hint = "my email => me@example.com"
            minLines = 3
            setText(settings.snippets.entries.joinToString("\n") { "${it.key} => ${it.value}" })
            styleField()
        }
        personal.addView(snippets)
        personal.label("Tone by app package (optional)", 18f)
        personal.label("Most recent text field: ${settings.recentApp.ifEmpty { "none yet" }}. One line per app, for example com.whatsapp=casual.")
        val appTones = EditText(this).apply {
            hint = "com.whatsapp=casual\ncom.google.android.gm=professional"
            minLines = 3
            setText(settings.appTones.entries.joinToString("\n") { "${it.key}=${it.value.name.lowercase()}" })
            styleField()
        }
        personal.addView(appTones)
        personal.button("Save preferences", primary = true) {
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

        val usage = column.section("USAGE")
        usageText = usage.label("")
        usage.label("Speech price per hour (US$). Google's live transcription price is not clearly published; check ai.google.dev/pricing and enter the real figure.")
        val rate = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(settings.sttUsdPerHour.toString())
            styleField()
        }
        usage.addView(rate)
        usage.button("Save price") {
            val value = rate.text.toString().toFloatOrNull()
            if (value == null || value < 0f) status.text = "Enter a price like 0.54."
            else { settings.sttUsdPerHour = value; status.text = "Price saved."; refreshStatus() }
        }

        val updates = column.section("UPDATES")
        updateText = updates.label("Flow ${Updater.installedVersion(this)}")
        updateButton = updates.button("Check for updates", primary = true) {
            pendingUpdate?.let { installUpdate(it) } ?: checkUpdates(thenInstall = false)
        }
        updates.label("Flow looks for new versions on GitHub about once a day and downloads them over Wi-Fi. Android always asks you to confirm an install.")

        val backup = column.section("BACKUP")
        backup.label("Move your dictionary, tones, cleanup level, snippets and style between your phone and PC. Your API key stays behind. Import replaces your current settings.")
        backup.button("Export…") {
            startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json").putExtra(Intent.EXTRA_TITLE, "flow-personalization.json"), EXPORT_REQUEST)
        }
        backup.button("Import…") {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*"), IMPORT_REQUEST)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data ?: return
        if (resultCode != RESULT_OK) return
        try {
            if (requestCode == EXPORT_REQUEST) {
                contentResolver.openOutputStream(uri, "wt")!!.use { it.write(settings.exportPersonalization().toByteArray()) }
                status.text = "Exported."
            } else if (requestCode == IMPORT_REQUEST) {
                val raw = contentResolver.openInputStream(uri)!!.use { it.readBytes().take(1_000_000).toByteArray().toString(Charsets.UTF_8) }
                settings.importPersonalization(raw)
                recreate() // reload every field from the imported settings
            }
        } catch (error: Exception) { status.text = error.message ?: "Backup failed." }
    }

    override fun onResume() {
        super.onResume()
        FlowBubbleService.ensureRunning(this) // on by default once the permissions are granted
        refreshStatus()
        val fromNotification = intent.getBooleanExtra("install-update", false)
        intent.removeExtra("install-update")
        if (fromNotification || System.currentTimeMillis() - settings.lastUpdateCheck > 6 * 60 * 60 * 1000L)
            checkUpdates(thenInstall = fromNotification)
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    private fun checkUpdates(thenInstall: Boolean) {
        updateButton.isEnabled = false
        updateText.text = "Checking for updates…"
        scope.launch {
            try {
                val info = Updater.check(this@MainActivity)
                settings.lastUpdateCheck = System.currentTimeMillis()
                pendingUpdate = info
                if (info == null) {
                    updateText.text = "Flow ${Updater.installedVersion(this@MainActivity)} is up to date."
                    updateButton.text = "Check for updates"
                } else {
                    updateText.text = "Version ${info.version} is available."
                    updateButton.text = "Download and install ${info.version}"
                    updateButton.isEnabled = true
                    if (thenInstall) installUpdate(info)
                }
            } catch (error: Exception) {
                updateText.text = error.message ?: "Could not check for updates."
            } finally {
                updateButton.isEnabled = true
            }
        }
    }

    private fun installUpdate(info: UpdateInfo) {
        if (!packageManager.canRequestPackageInstalls()) {
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            updateText.text = "Allow Flow to install updates, come back, then tap again."
            return
        }
        updateButton.isEnabled = false
        scope.launch {
            try {
                val ready = Updater.readyFile(this@MainActivity, info.version)
                val file = if (ready.exists() && settings.readyUpdate == info.version) ready else {
                    updateText.text = "Downloading ${info.version}…"
                    Updater.download(this@MainActivity, info)
                }
                settings.readyUpdate = info.version
                updateText.text = "Installing ${info.version}…"
                Updater.install(this@MainActivity, file)
            } catch (error: Exception) {
                updateText.text = error.message ?: "Could not install the update."
            } finally {
                updateButton.isEnabled = true
            }
        }
    }

    private fun refreshStatus() {
        if (!::status.isInitialized) return
        val mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val overlay = Settings.canDrawOverlays(this)
        val access = FlowAccessibilityService.active != null
        val hasKey = settings.hasApiKey()
        status.text = "Mic ${if (mic) "ready" else "needed"} · Bubble ${if (overlay) "ready" else "needed"} · Text access ${if (access) "ready" else "needed"} · Key ${if (hasKey) "saved" else "missing"}"
        status.setTextColor(if (mic && overlay && access && hasKey)
            Color.rgb(95, 208, 162) else Color.rgb(255, 180, 84))
        permission.text = if (mic) "✓ Microphone allowed" else "Allow microphone"
        overlayPermission.text = if (overlay) "✓ Floating bubble allowed" else "Allow floating bubble"
        accessPermission.text = if (access) "✓ Text insertion allowed" else "Allow text insertion"
        bubbleButton.text = if (FlowBubbleService.active != null) "Stop floating mic" else "Show floating mic"
        val used = settings.usage()
        val minutes = used.audioSeconds / 60
        val cost = used.audioSeconds / 3600 * settings.sttUsdPerHour
        usageText.text = "This month: ${used.dictations} dictations · ${"%.1f".format(minutes)} minutes of speech · about US$${"%.2f".format(cost)} for transcription (cleanup cost not counted)."
    }

    private val Int.dp: Int get() = (this * resources.displayMetrics.density).toInt()

    private fun LinearLayout.section(title: String): LinearLayout {
        val card = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16.dp, 12.dp, 16.dp, 18.dp)
            background = GradientDrawable().apply {
                setColor(Color.rgb(27, 30, 35))
                cornerRadius = 18.dp.toFloat()
                setStroke(1.dp, Color.rgb(42, 47, 54))
            }
        }
        card.label(title, 18f)
        addView(card, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 18.dp })
        return card
    }

    private fun EditText.styleField() {
        setTextColor(Color.rgb(233, 236, 240))
        setHintTextColor(Color.rgb(152, 162, 173))
        setPadding(12.dp, 10.dp, 12.dp, 10.dp)
        background = GradientDrawable().apply {
            setColor(Color.rgb(20, 23, 27))
            cornerRadius = 10.dp.toFloat()
            setStroke(1.dp, Color.rgb(42, 47, 54))
        }
    }

    private fun LinearLayout.label(text: String, size: Float = 15f): TextView = TextView(this@MainActivity).also {
        it.text = text
        it.textSize = size
        it.setTextColor(if (size >= 18f) Color.rgb(233, 236, 240) else Color.rgb(152, 162, 173))
        it.setPadding(0, 15.dp, 0, 7.dp)
        addView(it)
    }

    private fun LinearLayout.button(text: String, primary: Boolean = false, action: () -> Unit): Button = Button(this@MainActivity).also {
        it.text = text
        it.isAllCaps = false
        it.setTextColor(if (primary) Color.rgb(15, 19, 34) else Color.rgb(233, 236, 240))
        val shape = GradientDrawable().apply {
            setColor(if (primary) Color.rgb(140, 155, 255) else Color.rgb(37, 43, 74))
            cornerRadius = 10.dp.toFloat()
            if (!primary) setStroke(1.dp, Color.rgb(63, 73, 112))
        }
        it.background = RippleDrawable(ColorStateList.valueOf(
            if (primary) Color.rgb(200, 207, 255) else Color.rgb(140, 155, 255)), shape, null)
        it.setOnClickListener { action() }
        addView(it, LinearLayout.LayoutParams(-1, 48.dp).apply { topMargin = 8.dp })
    }

    /** Pill-style single choice, like the desktop settings' segmented control. */
    private fun LinearLayout.segmented(labels: List<String>, selected: Int, onSelect: (Int) -> Unit) {
        val row = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL }
        val buttons = labels.map { text ->
            Button(this@MainActivity).apply {
                this.text = text
                isAllCaps = false
                minHeight = 0
                minimumHeight = 0
            }
        }
        fun paint(current: Int) = buttons.forEachIndexed { index, button ->
            val on = index == current
            button.setTextColor(if (on) Color.rgb(15, 19, 34) else Color.rgb(233, 236, 240))
            button.background = GradientDrawable().apply {
                setColor(if (on) Color.rgb(140, 155, 255) else Color.rgb(37, 43, 74))
                cornerRadius = 10.dp.toFloat()
            }
            button.isSelected = on
        }
        buttons.forEachIndexed { index, button ->
            button.setOnClickListener { paint(index); onSelect(index) }
            row.addView(button, LinearLayout.LayoutParams(0, 44.dp, 1f).apply { marginEnd = if (index < buttons.lastIndex) 6.dp else 0 })
        }
        paint(selected)
        addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 8.dp })
    }

    private fun LinearLayout.picker(labels: List<String>): Spinner = Spinner(this@MainActivity).also {
        it.adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, labels)
        addView(it)
    }
}
