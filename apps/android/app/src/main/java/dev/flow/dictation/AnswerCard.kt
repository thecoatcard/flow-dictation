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
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The answer popup for Ask Flow. It grows out of the floating mic, is only as big as the answer needs,
 * and fades away after 15 seconds unless it is being touched or read aloud. It never takes focus, so the
 * keyboard and the user's app stay as they were. Text is set as plain text only.
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
    private var speaking = false
    private var touching = false
    private val fade = Runnable { if (touching || speaking) arm(AFTER_TOUCH_MS) else dismiss(animated = true) }

    private val Int.dp: Int get() = (this * context.resources.displayMetrics.density).toInt()

    companion object {
        private const val SHOW_MS = 15_000L // fades by itself after this long if nobody is looking at it
        private const val AFTER_TOUCH_MS = 5_000L // and this long after the last touch
        private val SURFACE = Color.rgb(24, 24, 27)
        private val EDGE = Color.argb(190, 140, 155, 255)
    }

    fun show(answer: String) {
        dismiss(animated = false)
        val metrics = context.resources.displayMetrics
        val answerView = TextView(context).apply {
            text = answer
            setTextColor(Color.WHITE)
            textSize = 14.5f
            setLineSpacing(0f, 1.12f)
            maxWidth = (metrics.widthPixels * 0.72f).toInt()
            maxHeight = (metrics.heightPixels * 0.34f).toInt()
            movementMethod = ScrollingMovementMethod()
            setTextIsSelectable(true)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
                .apply { topMargin = 4.dp; bottomMargin = 4.dp }
        }
        val copyButton = tool(R.drawable.ic_copy, "Copy the answer") { view ->
            (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                .setPrimaryClip(ClipData.newPlainText("Flow answer", answer))
            view.setImageResource(R.drawable.ic_done)
            view.setColorFilter(Color.rgb(95, 208, 162))
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
        val root = object : LinearLayout(context) {
            // Watches the touches without taking them: the countdown waits while a finger is on the card.
            override fun dispatchTouchEvent(event: MotionEvent): Boolean {
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { touching = true; handler.removeCallbacks(fade) }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { touching = false; arm(AFTER_TOUCH_MS) }
                }
                return super.dispatchTouchEvent(event)
            }
        }.apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
            setPadding(18.dp, 8.dp, 8.dp, 8.dp)
            background = GradientDrawable().apply {
                setColor(SURFACE)
                cornerRadius = 24.dp.toFloat()
                setStroke(1.dp, EDGE)
            }
            elevation = 18.dp.toFloat()
            addView(answerView)
            addView(tools)
        }

        // Above the floating mic, on its side of the screen; below it when it sits near the top.
        val anchor = bubble()
        val below = anchor != null && anchor.centerY() < metrics.heightPixels * 0.3f
        val onRight = anchor == null || anchor.centerX() >= metrics.widthPixels / 2
        val gap = 10.dp
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = (if (below) Gravity.TOP else Gravity.BOTTOM) or (if (onRight) Gravity.END else Gravity.START)
            x = 12.dp
            y = if (anchor == null) 120.dp
                else if (below) anchor.bottom + gap
                else metrics.heightPixels - anchor.top + gap
        }
        root.alpha = 0f
        if (runCatching { windows.addView(root, params) }.isFailure) return
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

    private fun arm(ms: Long) {
        handler.removeCallbacks(fade)
        if (card != null) handler.postDelayed(fade, ms)
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

private val ACCENT = Color.rgb(140, 155, 255)
