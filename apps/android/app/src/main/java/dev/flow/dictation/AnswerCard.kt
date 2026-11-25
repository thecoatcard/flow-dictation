package dev.flow.dictation

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.method.ScrollingMovementMethod
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The card that grows out of the floating mic. It shows either an answer from Ask (as big as the text needs, fading
 * after 15 seconds unless it is touched or read aloud) or the reminder at the front of the due queue (kept until it is
 * cleared, snoozed or closed). It never takes focus, so the keyboard and the user's app stay as they were. Text is
 * set as plain text only.
 *
 * [bubble] is the floating mic's rectangle on screen, which the card opens from.
 */
class AnswerCard(
    private val context: Context,
    private val windows: WindowManager,
    private val speaker: Speaker,
    private val bubble: () -> Rect?,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var card: View? = null
    private var params: WindowManager.LayoutParams? = null
    private var speaking = false
    private var touching = false
    private var autoFade = true
    private val fade = Runnable { if (touching || speaking) arm(AFTER_TOUCH_MS) else dismiss(animated = true) }

    private val Int.dp: Int get() = (this * context.resources.displayMetrics.density).toInt()

    companion object {
        private const val SHOW_MS = 8_000L // an answer fades by itself after this long if nobody is touching it
        private const val AFTER_TOUCH_MS = 5_000L // and this long after the last touch
        private val SURFACE = Color.rgb(24, 24, 27)
        private val EDGE = Color.argb(190, 140, 155, 255)
        private val ACCENT = Color.rgb(140, 155, 255)
        private val OK = Color.rgb(95, 208, 162)
        private val RED = Color.rgb(255, 107, 90)
    }

    /** An answer from Ask. */
    fun show(answer: String) {
        val answerView = text(answer, 14.5f, Color.WHITE).apply {
            movementMethod = ScrollingMovementMethod()
            setTextIsSelectable(true)
            maxWidth = (context.resources.displayMetrics.widthPixels * 0.72f).toInt()
            maxHeight = (context.resources.displayMetrics.heightPixels * 0.34f).toInt()
        }
        val copyButton = tool(R.drawable.ic_copy, "Copy the answer") { view ->
            (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                .setPrimaryClip(ClipData.newPlainText("Flow answer", answer))
            view.setImageResource(R.drawable.ic_done)
            view.setColorFilter(OK)
            handler.postDelayed({ view.setImageResource(R.drawable.ic_copy); view.setColorFilter(Color.WHITE) }, 1200)
        }
        val speakButton = tool(R.drawable.ic_volume, "Read the answer aloud") { view ->
            if (speaking) {
                speaker.stop()
            } else {
                speaking = true
                view.setImageResource(R.drawable.ic_stop)
                view.setColorFilter(ACCENT)
                speaker.speak(answer) {
                    speaking = false
                    view.setImageResource(R.drawable.ic_volume)
                    view.setColorFilter(Color.WHITE)
                    arm(AFTER_TOUCH_MS)
                }
            }
        }
        val tools = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(copyButton)
            addView(speakButton)
        }
        present(row(answerView, tools), fades = true)
    }

    /**
     * The reminder at the front of the queue: what it is, when it was due, and Snooze / Done / Later. The card stays until
     * the user chooses one. [total] is how many are waiting, so "1 of 3" tells them more are queued.
     */
    fun showReminder(text: String, meta: String, total: Int, onDone: () -> Unit, onSnooze: () -> Unit) {
        val metaView = text(if (total > 1) "$meta · 1 of $total" else meta, 12f, Color.argb(150, 238, 240, 243))
        val body = text(text, 15f, Color.WHITE).apply {
            maxWidth = (context.resources.displayMetrics.widthPixels * 0.72f).toInt()
        }
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(metaView)
            addView(body)
        }
        val buttons = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            addView(pill("Later", filled = false) { dismiss(animated = true) })
            addView(pill("Snooze", filled = false) { onSnooze() })
            addView(pill("Done", filled = true) { onDone() })
        }
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(column)
            addView(buttons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = 8.dp })
        }
        present(frame(root), fades = false)
    }

    /** Closes the card, now or with a short fade back toward the mic. */
    fun dismiss(animated: Boolean = false) {
        handler.removeCallbacks(fade)
        speaker.stop()
        speaking = false
        touching = false
        val view = card ?: return
        card = null
        if (animated && view.isAttachedToWindow) {
            view.animate().alpha(0f).scaleX(0.9f).scaleY(0.9f).setDuration(420)
                .withEndAction { runCatching { windows.removeView(view) } }.start()
        } else {
            view.animate().cancel()
            runCatching { windows.removeView(view) }
        }
    }

    val isShowing: Boolean get() = card != null

    private fun arm(ms: Long) {
        handler.removeCallbacks(fade)
        if (card != null && autoFade) handler.postDelayed(fade, ms)
    }

    private fun text(value: String, size: Float, color: Int) = TextView(context).apply {
        text = value
        setTextColor(color)
        textSize = size
        setLineSpacing(0f, 1.12f)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = 2.dp; bottomMargin = 2.dp }
    }

    private fun row(content: View, tools: View) = frame(LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.TOP
        addView(content)
        addView(tools)
    })

    /** The glass card around [content]: the floating mic's surface, edge and shadow. Drag it anywhere to move it. */
    private fun frame(content: View): LinearLayout = object : LinearLayout(context) {
        private val slop = ViewConfiguration.get(context).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var originX = 0
        private var originY = 0
        private var dragging = false

        // Watches the touches without taking them: the countdown waits while a finger is on the card.
        override fun dispatchTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { touching = true; handler.removeCallbacks(fade) }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { touching = false; dragging = false; arm(AFTER_TOUCH_MS) }
            }
            return super.dispatchTouchEvent(event)
        }

        // A finger that moves takes the card over from the buttons and text, so it can be dragged from anywhere on it.
        override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; dragging = false }
                MotionEvent.ACTION_MOVE -> if (!dragging && kotlin.math.hypot(event.rawX - downX, event.rawY - downY) > slop) {
                    dragging = beginDrag(this)
                    originX = params?.x ?: 0
                    originY = params?.y ?: 0
                    return dragging
                }
            }
            return dragging
        }

        override fun onTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; return true }
                MotionEvent.ACTION_MOVE -> {
                    if (!dragging && kotlin.math.hypot(event.rawX - downX, event.rawY - downY) > slop) {
                        dragging = beginDrag(this)
                        originX = params?.x ?: 0
                        originY = params?.y ?: 0
                    }
                    if (dragging) moveTo(this, originX + (event.rawX - downX).toInt(), originY + (event.rawY - downY).toInt())
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> dragging = false
            }
            return true
        }
    }.apply {
        orientation = LinearLayout.VERTICAL
        setPadding(18.dp, 10.dp, 10.dp, 10.dp)
        background = GradientDrawable().apply {
            setColor(SURFACE)
            cornerRadius = 24.dp.toFloat()
            setStroke(1.dp, EDGE)
        }
        elevation = 18.dp.toFloat()
        addView(content)
    }

    /** The card was opened against the screen's bottom or right edge; from the first drag on it is placed by its top-left corner. */
    private fun beginDrag(view: View): Boolean {
        val p = params ?: return false
        val at = IntArray(2).also { view.getLocationOnScreen(it) }
        p.gravity = Gravity.TOP or Gravity.START
        p.x = at[0]
        p.y = at[1]
        return true
    }

    private fun moveTo(view: View, x: Int, y: Int) {
        val p = params ?: return
        val (width, height) = screenSize()
        p.x = x.coerceIn(0, maxOf(0, width - view.width))
        p.y = y.coerceIn(0, maxOf(0, height - view.height))
        runCatching { windows.updateViewLayout(view, p) }
    }

    /** The whole screen, so a card can be dragged to any edge and never lost off it. */
    private fun screenSize(): Pair<Int, Int> =
        if (android.os.Build.VERSION.SDK_INT >= 30) windows.currentWindowMetrics.bounds.let { it.width() to it.height() }
        else android.util.DisplayMetrics().also { @Suppress("DEPRECATION") windows.defaultDisplay.getRealMetrics(it) }.let { it.widthPixels to it.heightPixels }

    /** Opens [root] above the floating mic (below it near the top of the screen), growing out of the mic. */
    private fun present(root: View, fades: Boolean) {
        dismiss(animated = false)
        autoFade = fades
        val metrics = context.resources.displayMetrics
        val anchor = bubble()
        val below = anchor != null && anchor.centerY() < metrics.heightPixels * 0.3f
        val onRight = anchor == null || anchor.centerX() >= metrics.widthPixels / 2
        val gap = 10.dp
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = (if (below) Gravity.TOP else Gravity.BOTTOM) or (if (onRight) Gravity.END else Gravity.START)
            x = 12.dp
            y = if (anchor == null) 120.dp
                else if (below) anchor.bottom + gap
                else screenSize().second - anchor.top + gap
        }
        root.alpha = 0f
        if (runCatching { windows.addView(root, params) }.isFailure) return
        this.params = params
        card = root
        root.post {
            // Grow out of the mic: the pivot is the mic's centre, in the card's own coordinates.
            val at = IntArray(2).also { root.getLocationOnScreen(it) }
            root.pivotX = ((anchor?.centerX() ?: (at[0] + root.width)) - at[0]).toFloat()
            root.pivotY = ((anchor?.centerY() ?: (at[1] + root.height)) - at[1]).toFloat()
            root.scaleX = 0.2f
            root.scaleY = 0.2f
            root.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(DecelerateInterpolator()).start()
        }
        arm(SHOW_MS)
    }

    private fun pill(label: String, filled: Boolean, onClick: () -> Unit) = Button(context).apply {
        text = label
        isAllCaps = false
        textSize = 13f
        setTextColor(if (filled) Color.rgb(20, 22, 26) else Color.WHITE)
        background = GradientDrawable().apply {
            setColor(if (filled) OK else Color.argb(26, 255, 255, 255))
            cornerRadius = 18.dp.toFloat()
        }
        minHeight = 0
        minimumHeight = 0
        setPadding(16.dp, 0, 16.dp, 0)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, 36.dp).apply { marginStart = 8.dp }
        setOnClickListener { onClick() }
    }

    private fun tool(icon: Int, description: String, onClick: (ImageView) -> Unit) = ImageView(context).apply {
        setImageResource(icon)
        setColorFilter(Color.WHITE)
        alpha = 0.8f
        contentDescription = description
        setPadding(7.dp, 7.dp, 7.dp, 7.dp)
        layoutParams = LinearLayout.LayoutParams(36.dp, 36.dp)
        setBackgroundResource(android.R.drawable.list_selector_background)
        setOnClickListener { onClick(this) }
    }
}
