package dev.flow.dictation

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.text.format.DateUtils
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.Switch
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/**
 * A home menu with the floating-mic control and one page per topic, like the desktop settings:
 * Dictation, Words and tone, Writing style, Usage, Updates, Permissions and Backup.
 */
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
    private lateinit var permissionsSub: TextView
    private lateinit var updatesSub: TextView
    private lateinit var titleView: TextView
    private lateinit var menuButton: TextView
    private lateinit var drawer: LinearLayout
    private lateinit var scrim: View
    private var drawerOpen = false
    private lateinit var content: FrameLayout
    private lateinit var menu: ScrollView
    private val pages = LinkedHashMap<String, Pair<String, ScrollView>>() // id -> title, view
    private var openPage: String? = null
    private var pendingUpdate: UpdateInfo? = null
    private lateinit var historyList: LinearLayout
    private lateinit var historySearch: EditText
    private lateinit var batteryStatus: TextView

    private companion object {
        const val EXPORT_REQUEST = 41
        const val IMPORT_REQUEST = 42
        val BACKGROUND = Color.rgb(18, 20, 23)
        const val DRAWER_DP = 290
        val TEXT = Color.rgb(233, 236, 240)
        val MUTED = Color.rgb(152, 162, 173)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = BACKGROUND
        window.navigationBarColor = BACKGROUND
        settings = FlowSettings(this)

        menuButton = TextView(this).apply {
            text = "☰"
            textSize = 26f
            setTextColor(TEXT)
            setPadding(14.dp, 4.dp, 14.dp, 8.dp)
            contentDescription = "Menu"
            setOnClickListener { setDrawer(!drawerOpen) }
        }
        titleView = TextView(this).apply {
            textSize = 24f
            setTextColor(TEXT)
            setPadding(6.dp, 0, 0, 0)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(6.dp, 28.dp, 20.dp, 10.dp)
            addView(menuButton)
            addView(titleView)
        }
        content = FrameLayout(this)
        val main = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BACKGROUND)
            addView(header, LinearLayout.LayoutParams(-1, -2))
            addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        }

        buildPages()
        buildMenu()
        pages["home"] = "Flow" to menu
        scrim = View(this).apply {
            setBackgroundColor(Color.argb(150, 0, 0, 0))
            visibility = View.GONE
            alpha = 0f
            setOnClickListener { setDrawer(false) }
        }
        drawer = buildDrawer().apply {
            visibility = View.GONE
            translationX = -DRAWER_DP.dp.toFloat()
        }
        setContentView(FrameLayout(this).apply {
            addView(main, FrameLayout.LayoutParams(-1, -1))
            addView(scrim, FrameLayout.LayoutParams(-1, -1))
            addView(drawer, FrameLayout.LayoutParams(DRAWER_DP.dp, -1))
        })
        val restored = savedInstanceState?.getString("page")
        showPage(if (restored != null && pages.containsKey(restored)) restored else "home")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        openPage?.let { outState.putString("page", it) }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            drawerOpen -> setDrawer(false)
            openPage != null && openPage != "home" -> showPage("home")
            else -> super.onBackPressed()
        }
    }

    private fun setDrawer(open: Boolean) {
        drawerOpen = open
        if (open) { scrim.visibility = View.VISIBLE; drawer.visibility = View.VISIBLE }
        scrim.animate().alpha(if (open) 1f else 0f).setDuration(180)
            .withEndAction { if (!drawerOpen) scrim.visibility = View.GONE }.start()
        drawer.animate().translationX(if (open) 0f else -DRAWER_DP.dp.toFloat()).setDuration(220)
            .withEndAction { if (!drawerOpen) drawer.visibility = View.GONE }.start()
    }

    private fun showPage(id: String) {
        val (title, view) = pages.getValue(id)
        openPage = id
        titleView.text = title
        content.removeAllViews()
        content.addView(view)
        if (id == "history") renderHistory()
        if (drawerOpen) setDrawer(false)
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()

    private fun page(build: LinearLayout.() -> Unit): ScrollView {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp, 0, 20.dp, 40.dp)
        }
        column.build()
        return ScrollView(this).apply { addView(column) }
    }

    // ---------- home ----------

    private fun buildMenu() {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp, 0, 20.dp, 40.dp)
        }
        column.label("Speak anywhere. Keep your usual keyboard and tap or hold the floating mic in a text field to dictate.")
        status = column.label("")
        val mic = column.section("FLOATING MIC")
        bubbleButton = mic.button("Show floating mic", primary = true) {
            if (FlowBubbleService.active != null) {
                FlowBubbleService.stopByUser(this)
                setupStatus.text = "Floating mic stopped. It stays off until you start it again."
                bubbleButton.text = "Show floating mic"
            } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
                Settings.canDrawOverlays(this) && FlowAccessibilityService.active != null) {
                settings.bubbleEnabled = true
                startForegroundService(Intent(this, FlowBubbleService::class.java))
                setupStatus.text = "Floating mic is on. It keeps running until you stop it."
                bubbleButton.text = "Stop floating mic"
            } else {
                setupStatus.text = "Allow microphone, floating bubble and text insertion first (see Permissions)."
            }
        }
        setupStatus = mic.label("It stays on until you stop it, and comes back after a restart.")

        menu = ScrollView(this).apply { addView(column) }
    }

    private fun buildDrawer(): LinearLayout {
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16.dp, 40.dp, 16.dp, 24.dp)
        }
        list.addView(TextView(this).apply { text = "Flow"; textSize = 28f; setTextColor(TEXT) })
        list.addView(TextView(this).apply {
            text = "Version ${Updater.installedVersion(this@MainActivity)}"
            textSize = 13f
            setTextColor(MUTED)
            setPadding(0, 2.dp, 0, 18.dp)
        })
        list.menuRow("home", "Home", "Floating mic and status")
        list.menuRow("dictation", "Dictation", "Google API key and floating mic tools")
        list.menuRow("history", "History", "Search, copy and fix past dictations")
        list.menuRow("words", "Words and tone", "App tone, dictionary and snippets")
        list.menuRow("style", "Writing style", "Auto cleanup, Hindi output and your style")
        list.menuRow("usage", "Usage", "Dictations, minutes and estimated cost")
        updatesSub = list.menuRow("updates", "Updates", "Flow ${Updater.installedVersion(this)}")
        permissionsSub = list.menuRow("access", "Permissions", "Microphone, floating bubble, text insertion")
        list.menuRow("backup", "Backup", "Move your settings between phone and PC")
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(27, 30, 35))
            elevation = 24.dp.toFloat()
            addView(ScrollView(this@MainActivity).apply { addView(list) }, LinearLayout.LayoutParams(-1, -1))
        }
    }

    private fun LinearLayout.menuRow(id: String, title: String, subtitle: String): TextView {
        val subtitleView = TextView(this@MainActivity).apply {
            text = subtitle
            textSize = 13f
            setTextColor(MUTED)
            setPadding(0, 2.dp, 0, 0)
        }
        val texts = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(this@MainActivity).apply { text = title; textSize = 17f; setTextColor(TEXT) })
            addView(subtitleView)
        }
        val row = LinearLayout(this@MainActivity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(4.dp, 14.dp, 4.dp, 14.dp)
            isClickable = true
            background = RippleDrawable(ColorStateList.valueOf(Color.argb(40, 255, 255, 255)), null, ColorDrawable(Color.WHITE))
            setOnClickListener { showPage(id) }
            addView(texts, LinearLayout.LayoutParams(0, -2, 1f))
        }
        addView(row, LinearLayout.LayoutParams(-1, -2))
        return subtitleView
    }

    // ---------- pages ----------

    private fun buildPages() {
        pages["dictation"] = "Dictation" to dictationPage()
        pages["history"] = "History" to historyPage()
        pages["words"] = "Words and tone" to wordsPage()
        pages["style"] = "Writing style" to stylePage()
        pages["usage"] = "Usage" to usagePage()
        pages["updates"] = "Updates" to updatesPage()
        pages["access"] = "Permissions" to permissionsPage()
        pages["backup"] = "Backup" to backupPage()
    }

    private fun dictationPage() = page {
        label("Hold the floating mic or tap it, speak, and cleaned-up text appears in the field you selected.")
        val api = section("GOOGLE API")
        api.label("Stored using Android Keystore. Audio and cleanup text go directly to Google.")
        key = EditText(this@MainActivity).apply {
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
        testProgress = ProgressBar(this@MainActivity, null, android.R.attr.progressBarStyleSmall).apply {
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

        val speech = section("SPEECH LANGUAGE")
        speech.label("Pick the language you speak, or leave Auto-detect to mix languages freely (Hinglish works either way).")
        val languagePicker = speech.picker(Languages.all.map { it.label })
        languagePicker.setSelection(Languages.all.indexOfFirst { it.code == settings.language }.coerceAtLeast(0))
        languagePicker.onItemSelected { index ->
            val code = Languages.all[index].code
            if (code != settings.language) { settings.language = code; toast("Language saved. It applies to the next dictation.") }
        }

        val writeIn = section("WRITE IN")
        writeIn.label("Speak in any language and Flow writes it in the one you pick. Leave it on As I speak to keep the language you spoke. This uses the cleanup model, so it takes a moment longer.")
        val writePicker = writeIn.picker(Languages.writeIn.map { it.ifEmpty { "As I speak" } })
        writePicker.setSelection(Languages.writeIn.indexOf(settings.outputLanguage).coerceAtLeast(0))
        writePicker.onItemSelected { index ->
            val language = Languages.writeIn[index]
            if (language != settings.outputLanguage) { settings.outputLanguage = language; toast("Saved. It applies to the next dictation.") }
        }

        val editing = section("EDIT BY VOICE")
        editing.label("Select some text, tap the mic, and say what to do: make this shorter, fix the grammar, translate to Hindi, turn into a list. Flow rewrites the selection. Say delete that to undo. Turn this off to dictate over a selection instead.")
        editing.switchRow("Rewrite selected text", settings.voiceEditing) { settings.voiceEditing = it }

        val feedback = section("FEEDBACK")
        feedback.switchRow("Start and stop sounds", settings.soundCues) { settings.soundCues = it }
        feedback.switchRow("Vibrate on start and stop", settings.haptics) { settings.haptics = it }
        feedback.button("Play the sounds") {
            Chime.play(Chime.Kind.START)
            scope.launch { kotlinx.coroutines.delay(500); Chime.play(Chime.Kind.STOP) }
        }

        val tools = section("FLOATING MIC TOOLS")
        tools.button("Reset bubble position") {
            settings.bubblePosition = null
            FlowBubbleService.active?.resetPosition()
            toast("Bubble moved back to the right edge.")
        }
        tools.button("Copy last dictation") {
            val text = FlowBubbleService.active?.lastText.orEmpty()
            if (text.isEmpty()) toast("No dictation to copy yet.")
            else {
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("Flow dictation", text))
                toast("Copied last dictation.")
            }
        }
    }

    private fun historyPage() = page {
        label("Your recent dictations stay on this phone. Fix a mistake and Flow offers to remember the words you corrected.")
        historySearch = EditText(this@MainActivity).apply {
            hint = "Search dictations"
            isSingleLine = true
            styleField()
            addTextChangedListener(object : android.text.TextWatcher {
                override fun afterTextChanged(s: android.text.Editable?) = renderHistory()
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            })
        }
        addView(historySearch, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 12.dp })
        val options = section("OPTIONS")
        options.switchRow("Keep a history of dictations", settings.keepHistory) { settings.keepHistory = it }
        options.button("Clear all history") {
            AlertDialog.Builder(this@MainActivity)
                .setTitle("Clear all history?")
                .setMessage("This deletes every saved dictation from this phone. It cannot be undone.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Clear") { _, _ -> HistoryStore.get(this@MainActivity).clear(); renderHistory() }
                .show()
        }
        historyList = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
        addView(historyList, LinearLayout.LayoutParams(-1, -2))
    }

    private fun renderHistory() {
        if (!::historyList.isInitialized) return
        historyList.removeAllViews()
        val entries = HistoryStore.get(this).search(historySearch.text.toString())
        if (entries.isEmpty()) {
            historyList.label(if (historySearch.text.isNotBlank()) "Nothing matches that search."
                else if (settings.keepHistory) "No dictations yet. Your next ones appear here." else "History is off.")
            return
        }
        entries.take(100).forEach { entry ->
            val card = historyList.section(DateUtils.getRelativeTimeSpanString(entry.at).toString())
            card.label(entry.text)
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.smallButton("Copy") {
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("Flow dictation", entry.text))
                toast("Copied.")
            }
            row.smallButton("Fix") { fixEntry(entry) }
            row.smallButton("Delete") { HistoryStore.get(this).remove(entry.id); renderHistory() }
            card.addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 6.dp })
        }
    }

    /** Lets the user correct an entry, then offers to add the words they changed to the dictionary. */
    private fun fixEntry(entry: HistoryEntry) {
        val field = EditText(this).apply { setText(entry.text); minLines = 3; styleField() }
        AlertDialog.Builder(this)
            .setTitle("Fix this dictation")
            .setView(field)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val fixed = field.text.toString().trim()
                if (fixed.isEmpty() || fixed == entry.text) return@setPositiveButton
                HistoryStore.get(this).update(entry.id, fixed)
                renderHistory()
                val known = settings.dictionary.map { it.substringBefore('|').trim() }
                val terms = Learn.terms(entry.text, fixed, known)
                if (terms.isNotEmpty()) offerTerms(terms)
            }
            .show()
    }

    private fun offerTerms(terms: List<String>) {
        val chosen = BooleanArray(terms.size) { true }
        AlertDialog.Builder(this)
            .setTitle("Add to your dictionary?")
            .setMultiChoiceItems(terms.toTypedArray(), chosen) { _, index, checked -> chosen[index] = checked }
            .setNegativeButton("No thanks", null)
            .setPositiveButton("Add") { _, _ ->
                val picked = terms.filterIndexed { index, _ -> chosen[index] }
                if (picked.isNotEmpty()) {
                    settings.dictionary = settings.dictionary + picked
                    toast("Added ${picked.size} to your dictionary.")
                }
            }
            .show()
    }

    private fun wordsPage() = page {
        label("Teach Flow how to write in each app and which words to spell exactly.")
        val words = section("TONE")
        words.label("Default app tone", 18f)
        val tones = Tone.entries
        val tonePicker = words.picker(tones.map { it.name.lowercase().replaceFirstChar(Char::uppercase) })
        tonePicker.setSelection(tones.indexOf(settings.defaultTone))
        words.label("Tone by app package (optional)", 18f)
        words.label("Most recent text field: ${settings.recentApp.ifEmpty { "none yet" }}. One line per app, for example com.whatsapp=casual.")
        val appTones = EditText(this@MainActivity).apply {
            hint = "com.whatsapp=casual\ncom.google.android.gm=professional"
            minLines = 3
            setText(settings.appTones.entries.joinToString("\n") { "${it.key}=${it.value.name.lowercase()}" })
            styleField()
        }
        words.addView(appTones)

        val dict = section("DICTIONARY AND SNIPPETS")
        dict.label("Dictionary: one term per line, optional note after |", 18f)
        val dictionary = EditText(this@MainActivity).apply {
            hint = "Spring Boot | Java framework\nAngular"
            minLines = 3
            setText(settings.dictionary.joinToString("\n"))
            styleField()
        }
        dict.addView(dictionary)
        dict.label("Snippets: phrase => replacement, one per line. \"New line\", \"new paragraph\" and \"delete that\" already work.", 18f)
        val snippets = EditText(this@MainActivity).apply {
            hint = "my email => me@example.com"
            minLines = 3
            setText(settings.snippets.entries.joinToString("\n") { "${it.key} => ${it.value}" })
            styleField()
        }
        dict.addView(snippets)
        dict.button("Save words and tone", primary = true) {
            settings.defaultTone = tones[tonePicker.selectedItemPosition]
            settings.dictionary = dictionary.text.toString().lines().map(String::trim).filter(String::isNotEmpty)
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
            toast("Saved.")
        }
    }

    private fun stylePage() = page {
        label("A short description of how you write. Flow follows it when it tidies what you said.")
        val cleanup = section("AUTO CLEANUP")
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
            toast("Cleanup level saved.")
        }

        val hindi = section("HINDI")
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
            toast("Hindi style saved.")
        }

        val mine = section("YOUR STYLE")
        val style = EditText(this@MainActivity).apply {
            hint = "Concise, natural, no exclamation marks"
            minLines = 3
            setText(settings.style)
            styleField()
        }
        mine.addView(style)
        mine.button("Save style", primary = true) {
            settings.style = style.text.toString()
            toast("Style saved.")
        }

        val learn = section("LEARN IT FROM YOUR WRITING")
        learn.label("Paste two or three pieces of your own writing, separated by a blank line. Flow sends them to Google once to draft the style above, then forgets them.")
        val samples = EditText(this@MainActivity).apply { minLines = 4; styleField() }
        learn.addView(samples)
        learn.button("Draft my style") {
            toast("Drafting your style…")
            scope.launch {
                try {
                    val saved = withContext(Dispatchers.IO) { settings.apiKey() } ?: throw IllegalStateException("Save an API key first.")
                    style.setText(draftStyle(saved, samples.text.toString()))
                    samples.text.clear()
                    toast("Style drafted. Edit it if you like, then save it.")
                } catch (error: Exception) { toast(error.message ?: "Could not draft a style.") }
            }
        }
    }

    private fun usagePage() = page {
        val usage = section("THIS MONTH")
        usageText = usage.label("")
        usage.label("Speech price per hour (US$). Google's live transcription price is not clearly published; check ai.google.dev/pricing and enter the real figure.")
        val rate = EditText(this@MainActivity).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(settings.sttUsdPerHour.toString())
            styleField()
        }
        usage.addView(rate)
        usage.button("Save price", primary = true) {
            val value = rate.text.toString().toFloatOrNull()
            if (value == null || value < 0f) toast("Enter a price like 0.54.")
            else { settings.sttUsdPerHour = value; toast("Price saved."); refreshStatus() }
        }
    }

    private fun updatesPage() = page {
        label("Flow looks for new versions on GitHub about once a day and downloads them over Wi-Fi. Android always asks you to confirm an install.")
        val updates = section("VERSION")
        updateText = updates.label("Flow ${Updater.installedVersion(this@MainActivity)}")
        updateButton = updates.button("Check for updates", primary = true) {
            pendingUpdate?.let { installUpdate(it) } ?: checkUpdates(thenInstall = false)
        }
    }

    private fun permissionsPage() = page {
        label("Allow these once. Flow appears alongside your keyboard and inserts into the field you selected.")
        val setup = section("ACCESS")
        permission = setup.button("Allow microphone") {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }
        overlayPermission = setup.button("Allow floating bubble") {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        accessPermission = setup.button("Allow text insertion") {
            AlertDialog.Builder(this@MainActivity)
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

        val battery = section("KEEP THE MIC ALIVE")
        battery.label(BatteryHelp.WHY)
        batteryStatus = battery.label("")
        battery.button("Allow background activity") {
            val intent = if (Build.VERSION.SDK_INT >= 23)
                Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
            runCatching { startActivity(intent) }
        }
        battery.button("Open Flow's app settings") {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
        }
        battery.label("For your ${Build.MANUFACTURER.replaceFirstChar(Char::uppercase)} phone:", 18f)
        BatteryHelp.steps(Build.MANUFACTURER).forEachIndexed { index, step -> battery.label("${index + 1}. $step") }
    }

    private fun backupPage() = page {
        label("Move your dictionary, tones, cleanup level, snippets and style between your phone and PC. Your API key stays behind. Import replaces your current settings.")
        val backup = section("EXPORT AND IMPORT")
        backup.button("Export…") {
            startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/json").putExtra(Intent.EXTRA_TITLE, "flow-personalization.json"), EXPORT_REQUEST)
        }
        backup.button("Import…") {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*"), IMPORT_REQUEST)
        }
    }

    // ---------- actions ----------

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data ?: return
        if (resultCode != RESULT_OK) return
        try {
            if (requestCode == EXPORT_REQUEST) {
                contentResolver.openOutputStream(uri, "wt")!!.use { it.write(settings.exportPersonalization().toByteArray()) }
                toast("Exported.")
            } else if (requestCode == IMPORT_REQUEST) {
                val raw = contentResolver.openInputStream(uri)!!.use { it.readBytes().take(1_000_000).toByteArray().toString(Charsets.UTF_8) }
                settings.importPersonalization(raw)
                recreate() // reload every field from the imported settings
            }
        } catch (error: Exception) { toast(error.message ?: "Backup failed.") }
    }

    override fun onResume() {
        super.onResume()
        FlowBubbleService.ensureRunning(this) // on by default once the permissions are granted
        refreshStatus()
        val fromNotification = intent.getBooleanExtra("install-update", false)
        intent.removeExtra("install-update")
        if (fromNotification) showPage("updates")
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
                    updatesSub.text = "Flow ${Updater.installedVersion(this@MainActivity)} · up to date"
                } else {
                    updateText.text = "Version ${info.version} is available."
                    updateButton.text = "Download and install ${info.version}"
                    updatesSub.text = "Version ${info.version} is available"
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
        val ready = mic && overlay && access && hasKey
        status.text = "Mic ${if (mic) "ready" else "needed"} · Bubble ${if (overlay) "ready" else "needed"} · Text access ${if (access) "ready" else "needed"} · Key ${if (hasKey) "saved" else "missing"}"
        status.setTextColor(if (ready) Color.rgb(95, 208, 162) else Color.rgb(255, 180, 84))
        val allowed = listOf(mic, overlay, access).count { it }
        permissionsSub.text = if (allowed == 3) "All allowed" else "$allowed of 3 allowed · action needed"
        permissionsSub.setTextColor(if (allowed == 3) Color.rgb(95, 208, 162) else Color.rgb(255, 180, 84))
        permission.text = if (mic) "✓ Microphone allowed" else "Allow microphone"
        overlayPermission.text = if (overlay) "✓ Floating bubble allowed" else "Allow floating bubble"
        accessPermission.text = if (access) "✓ Text insertion allowed" else "Allow text insertion"
        bubbleButton.text = if (FlowBubbleService.active != null) "Stop floating mic" else "Show floating mic"
        val unrestricted = (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName)
        batteryStatus.text = if (unrestricted) "✓ Android lets Flow run in the background." else "Android may close Flow in the background."
        batteryStatus.setTextColor(if (unrestricted) Color.rgb(95, 208, 162) else Color.rgb(255, 180, 84))
        val used = settings.usage()
        val minutes = used.audioSeconds / 60
        val cost = used.audioSeconds / 3600 * settings.sttUsdPerHour
        usageText.text = "${used.dictations} dictations · ${"%.1f".format(minutes)} minutes of speech · about US$${"%.2f".format(cost)} for transcription (cleanup cost not counted)."
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

    /** Calls [onPick] when the user chooses an item (not for the initial selection). */
    private fun Spinner.onItemSelected(onPick: (Int) -> Unit) {
        var first = true
        onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: android.widget.AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (first) { first = false; return }
                onPick(position)
            }
            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) {}
        }
    }

    private fun LinearLayout.switchRow(text: String, on: Boolean, onChange: (Boolean) -> Unit) {
        addView(Switch(this@MainActivity).apply {
            this.text = text
            textSize = 16f
            setTextColor(TEXT)
            isChecked = on
            setPadding(0, 10.dp, 0, 10.dp)
            setOnCheckedChangeListener { _, checked -> onChange(checked) }
        }, LinearLayout.LayoutParams(-1, -2))
    }

    private fun LinearLayout.smallButton(text: String, action: () -> Unit) {
        addView(Button(this@MainActivity).apply {
            this.text = text
            isAllCaps = false
            minHeight = 0
            minimumHeight = 0
            setTextColor(TEXT)
            background = GradientDrawable().apply { setColor(Color.rgb(37, 43, 74)); cornerRadius = 10.dp.toFloat() }
            setOnClickListener { action() }
        }, LinearLayout.LayoutParams(0, 40.dp, 1f).apply { marginEnd = 6.dp })
    }
}
