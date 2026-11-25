package dev.flow.dictation

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * The answer popup for Ask Flow: a card near the bottom of the screen with the question, the answer, and
 * Copy / Read aloud / Close. It never takes focus, so the keyboard and the user's app stay as they were.
 * Text is set as plain text only, so an answer cannot inject anything.
 */
class AnswerCard(private val context: Context, private val windows: WindowManager, private val speaker: Speaker) {
    private var card: View? = null

    private val Int.dp: Int get() = (this * context.resources.displayMetrics.density).toInt()

    fun show(question: String, answer: String) {
        dismiss()
        val questionView = TextView(context).apply {
            text = question
            setTextColor(Color.rgb(154, 163, 173))
            textSize = 12f
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
        }
        val answerView = TextView(context).apply {
            text = answer
            setTextColor(Color.rgb(238, 240, 243))
            textSize = 15f
            setTextIsSelectable(true)
            setLineSpacing(0f, 1.15f)
        }
        val scroll = ScrollView(context).apply {
            addView(answerView)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply { topMargin = 8.dp }
        }
        var speaking = false
        lateinit var speakButton: Button
        speakButton = button("Read aloud") {
            if (speaking) { speaker.stop() } else {
                speaking = true
                speakButton.text = "Stop"
                speaker.speak(answer) { speaking = false; speakButton.text = "Read aloud" }
            }
        }
        val bar = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
            addView(button("Copy") {
                (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("Flow answer", answer))
                it.text = "Copied"
            })
            addView(speakButton)
            addView(button("Close") { dismiss() })
        }
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(16.dp, 14.dp, 16.dp, 10.dp)
            background = GradientDrawable().apply {
                setColor(Color.rgb(27, 30, 35))
                cornerRadius = 18.dp.toFloat()
                setStroke(1.dp, Color.argb(190, 140, 155, 255))
            }
            elevation = 18.dp.toFloat()
            addView(questionView)
            addView(scroll)
            addView(bar)
        }
        val metrics = context.resources.displayMetrics
        val params = WindowManager.LayoutParams(
            metrics.widthPixels - 32.dp,
            minOf(320.dp, metrics.heightPixels / 2),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = 96.dp
        }
        runCatching { windows.addView(root, params) }.onSuccess { card = root }
    }

    fun dismiss() {
        speaker.stop()
        card?.let { runCatching { windows.removeView(it) } }
        card = null
    }

    private fun button(label: String, onClick: (Button) -> Unit) = Button(context).apply {
        text = label
        isAllCaps = false
        setTextColor(Color.rgb(238, 240, 243))
        textSize = 13f
        background = GradientDrawable().apply {
            setColor(Color.TRANSPARENT)
            cornerRadius = 10.dp.toFloat()
            setStroke(1.dp, Color.rgb(60, 66, 76))
        }
        minHeight = 0
        minimumHeight = 0
        setPadding(14.dp, 6.dp, 14.dp, 6.dp)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, 36.dp).apply { marginStart = 8.dp }
        setOnClickListener { onClick(this) }
    }
}
