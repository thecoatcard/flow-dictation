package dev.flow.dictation

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.util.Log
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo

/** Used only to read the currently focused editable field and insert a completed dictation. */
class FlowAccessibilityService : AccessibilityService() {
    data class Target(
        val node: AccessibilityNodeInfo,
        val text: String,
        val start: Int,
        val end: Int,
        val packageName: String,
    )

    companion object {
        @Volatile var active: FlowAccessibilityService? = null
            private set
    }

    private var lastEnsure = 0L

    override fun onServiceConnected() {
        active = this
        FlowBubbleService.ensureRunning(this) // the system rebinds this service after a reboot or a crash
        FlowBubbleService.active?.refreshVisibility()
    }

    private val handler = Handler(Looper.getMainLooper())
    private val settings by lazy { FlowSettings(this) }
    private var lastApp = ""
    private val refresh = Runnable { FlowBubbleService.active?.refreshVisibility() }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Remember the app for per-app tone, but write to disk only when it changes.
        if (event?.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED && !event.isPassword) {
            val app = event.packageName?.toString()
            if (app != null && app != lastApp) { lastApp = app; settings.recentApp = app }
        }
        // Window events arrive in bursts. With no bubble running there is nothing to update, and
        // otherwise one scan per burst is enough, so idle use costs almost no CPU or battery.
        if (FlowBubbleService.active == null) {
            val now = SystemClock.elapsedRealtime()
            if (now - lastEnsure > 30_000) { lastEnsure = now; FlowBubbleService.ensureRunning(this) }
            return
        }
        handler.removeCallbacks(refresh)
        handler.postDelayed(refresh, 120)
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        handler.removeCallbacks(refresh)
        if (active === this) active = null
        FlowBubbleService.active?.refreshVisibility()
        super.onDestroy()
    }

    fun hasEligibleField(): Boolean {
        val keyboardVisible = windows.any { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
        val field = focusedField()
        return keyboardVisible && field != null && isEligible(field)
    }

    private fun focusedField(): AccessibilityNodeInfo? {
        val appFields = windows.asSequence()
            .filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
            .mapNotNull { it.root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) }
            .toList()
        return appFields.firstOrNull { isEligible(it) }
            ?: appFields.firstOrNull()
            ?: rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
    }

    private fun isEligible(node: AccessibilityNodeInfo): Boolean {
        if (!node.isEditable || node.isPassword || node.packageName?.toString() == packageName) return false
        val kind = node.inputType and InputType.TYPE_MASK_CLASS
        if (kind == InputType.TYPE_CLASS_NUMBER || kind == InputType.TYPE_CLASS_PHONE) return false
        val variation = node.inputType and InputType.TYPE_MASK_VARIATION
        if (kind == InputType.TYPE_CLASS_TEXT && variation in setOf(
                InputType.TYPE_TEXT_VARIATION_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_URI
            )) return false
        return true
    }

    fun capture(): Target {
        val node = focusedField()
            ?: throw IllegalStateException("Tap a text field before speaking.")
        if (!isEligible(node))
            throw IllegalStateException("Voice insertion is unavailable in this field.")
        node.refresh()
        // An empty field reports its hint ("Message") as text; that is not content.
        val text = if (node.isShowingHintText) "" else node.text?.toString().orEmpty()
        if (text.length > 32_000) throw IllegalStateException("This field is too long for safe insertion.")
        val selection = if (text.isEmpty()) 0 to 0
            else safeSelection(text.length, node.textSelectionStart, node.textSelectionEnd)
        val (start, end) = selection ?: (-1 to -1)
        return Target(node, text, start, end, node.packageName?.toString().orEmpty())
    }

    /** Exact set-text insertion when the cursor is known; otherwise a paste into the focused field. */
    fun insert(target: Target, dictated: String): Boolean {
        val current = runCatching { capture() }.getOrNull()
        if (current == null) return fail("no_field")
        if (current.node != target.node || current.text != target.text) return fail("field_changed")
        if (target.start >= 0 && current.start == target.start && current.end == target.end) {
            val newText = target.text.substring(0, target.start) + dictated + target.text.substring(target.end)
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, newText)
            }
            if (current.node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                val cursor = target.start + dictated.length
                current.node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, Bundle().apply {
                    putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, cursor)
                    putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, cursor)
                })
                return true
            }
            Log.w("FlowInsert", "set_text_rejected")
        } else Log.w("FlowInsert", "cursor_unknown")
        (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager)
            .setPrimaryClip(ClipData.newPlainText("Flow dictation", dictated))
        return current.node.performAction(AccessibilityNodeInfo.ACTION_PASTE) || fail("paste_rejected")
    }

    private fun fail(reason: String): Boolean { Log.w("FlowInsert", reason); return false }

    fun undo(target: Target, dictated: String): Boolean {
        if (target.start < 0 || target.end < 0) return false
        val current = runCatching { capture() }.getOrNull() ?: return false
        val expected = target.text.substring(0, target.start) + dictated + target.text.substring(target.end)
        if (current.node != target.node || current.text != expected ||
            current.start != target.start + dictated.length || current.end != current.start) return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, target.text)
        }
        if (!current.node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return false
        current.node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, target.start)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, target.start)
        })
        return true
    }
}

/** Unknown or inconsistent cursor positions must never be used to replace a field's text. */
internal fun safeSelection(length: Int, start: Int, end: Int): Pair<Int, Int>? =
    if (start in 0..length && end in start..length) start to end else null
