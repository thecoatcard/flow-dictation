package dev.flow.dictation

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import android.view.View
import kotlin.math.max
import kotlin.math.sin

/** Live mic-level bars while listening; a soft travelling pulse while the result is being written. */
class WaveformView(context: Context) : View(context) {
    /** Latest mic level, 0..1. Written from the audio thread. */
    @Volatile var level = 0f
    var processing = false
        set(value) { field = value; invalidate() }

    private val bars = FloatArray(16)
    private var smoothed = 0f
    private var lastPush = 0L
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeCap = Paint.Cap.ROUND
        color = Color.WHITE
    }

    override fun onDraw(canvas: Canvas) {
        val now = SystemClock.uptimeMillis()
        if (processing) {
            for (i in bars.indices) bars[i] = 0.3f + 0.25f * sin(now / 170.0 - i * 0.55).toFloat()
            paint.alpha = 150
        } else {
            smoothed = max(level, smoothed * 0.8f)
            if (now - lastPush >= 55) {
                lastPush = now
                System.arraycopy(bars, 1, bars, 0, bars.size - 1)
                bars[bars.size - 1] = smoothed
            }
            paint.alpha = 255
        }
        val slot = width.toFloat() / bars.size
        paint.strokeWidth = slot * 0.5f
        val centre = height / 2f
        for (i in bars.indices) {
            val half = height * (0.07f + 0.43f * bars[i].coerceIn(0f, 1f))
            val x = slot * (i + 0.5f)
            canvas.drawLine(x, centre - half, x, centre + half, paint)
        }
        postInvalidateDelayed(33) // about 30 fps is plenty for a 26 dp waveform
    }
}
