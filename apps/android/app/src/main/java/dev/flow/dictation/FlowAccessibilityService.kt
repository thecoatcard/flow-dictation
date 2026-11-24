package dev.flow.dictation

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
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

    override fun onServiceConnected() {
        active = this
        FlowBubbleService.active?.refreshVisibility()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED && !event.isPassword)
            event.packageName?.toString()?.let { FlowSettings(this).recentApp = it }
        FlowBubbleService.active?.refreshVisibility()
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (active === this) active = null
        FlowBubbleService.active?.refreshVisibility()
        super.onDestroy()
    }

    fun hasEligibleField(): Boolean {
        val keyboardVisible = windows.any { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
        val field = focusedField()
        return keyboardVisible && field != null && isEligible(field)
    }

    private fun focusedField(): AccessibilityNodeInfo? =
        rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: windows.asSequence().filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
                .mapNotNull { it.root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) }.firstOrNull()

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
        if (node.actionList.none { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT })
            throw IllegalStateException("This field does not support voice insertion.")
        val text = node.text?.toString().orEmpty()
        val start = node.textSelectionStart
        val end = node.textSelectionEnd
        if (start !in 0..text.length || end !in start..text.length || text.length > 32_000)
            throw IllegalStateException("Cannot read this field's cursor safely.")
        return Target(node, text, start, end, node.packageName?.toString().orEmpty())
    }

    fun insert(target: Target, dictated: String): Boolean {
        val current = runCatching { capture() }.getOrNull() ?: return false
        if (current.node != target.node || current.text != target.text ||
            current.start != target.start || current.end != target.end) return false
        val newText = target.text.substring(0, target.start) + dictated + target.text.substring(target.end)
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, newText)
        }
        if (!current.node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return false
        val cursor = target.start + dictated.length
        current.node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, cursor)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, cursor)
        })
        return true
    }

    fun undo(target: Target, dictated: String): Boolean {
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
