package dev.flow.dictation

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Notes and reminders, kept on this phone only. Pure logic, a port of packages/core/src/memory.ts: the caller
 * supplies the clock and the ids and stores the result. Times are epoch milliseconds, shown in local time.
 */
data class Note(val id: String, val text: String, val at: Long)

enum class Repeat { NONE, DAILY, WEEKLY }

data class Reminder(
    val id: String,
    val text: String,
    /** When it is due next. For a repeating reminder this is the next occurrence. */
    val due: Long,
    val repeat: Repeat,
    val createdAt: Long,
    /** Set when snoozed: the reminder fires again then, and [due] keeps the repeat schedule. */
    val snoozedUntil: Long? = null,
) {
    /** When it will next fire. */
    val fireAt: Long get() = snoozedUntil ?: due
}

data class MemoryData(val notes: List<Note> = emptyList(), val reminders: List<Reminder> = emptyList())

/** Which items a "cancel ..." or "forget ..." refers to. Several matches are never removed on a guess. */
data class Resolved<T>(val removed: List<T>, val ambiguous: List<T>)

object Memory {
    const val MAX_NOTES = 200
    const val MAX_REMINDERS = 100
    const val MAX_NOTE_CHARS = 500
    /** How many notes Ask is shown, newest first. */
    const val NOTES_IN_ASK = 60

    fun clean(text: String): String = text.replace(Regex("\\s+"), " ").trim().take(MAX_NOTE_CHARS)

    fun addNote(m: MemoryData, text: String, now: Long, id: String): MemoryData {
        val t = clean(text)
        if (t.isEmpty()) return m
        return m.copy(notes = (listOf(Note(id, t, now)) + m.notes).take(MAX_NOTES))
    }

    fun addReminder(m: MemoryData, text: String, due: Long, repeat: Repeat, now: Long, id: String): MemoryData {
        val t = clean(text)
        if (t.isEmpty()) return m
        return m.copy(reminders = (m.reminders + Reminder(id, t, due, repeat, now)).sortedBy { it.fireAt }.take(MAX_REMINDERS))
    }

    /** Reminders due now, oldest first: the queue the user clears one by one. */
    fun dueReminders(m: MemoryData, now: Long): List<Reminder> = m.reminders.filter { it.fireAt <= now }.sortedBy { it.fireAt }

    fun upcomingReminders(m: MemoryData, now: Long): List<Reminder> = m.reminders.filter { it.fireAt > now }.sortedBy { it.fireAt }

    /** The time the next not-yet-due reminder fires, or null. Used to set the alarm. */
    fun nextDueAt(m: MemoryData, now: Long): Long? = upcomingReminders(m, now).firstOrNull()?.fireAt

    private fun advance(due: Long, repeat: Repeat, now: Long, zone: ZoneId): Long {
        val step = if (repeat == Repeat.DAILY) 1L else 7L
        var d = Instant.ofEpochMilli(due).atZone(zone)
        while (d.toInstant().toEpochMilli() <= now) d = d.plusDays(step)
        return d.toInstant().toEpochMilli()
    }

    /** The user cleared it. A one-off disappears; a repeating one moves to its next occurrence. */
    fun clearReminder(m: MemoryData, id: String, now: Long, zone: ZoneId = ZoneId.systemDefault()): MemoryData =
        m.copy(reminders = m.reminders.flatMap { r ->
            when {
                r.id != id -> listOf(r)
                r.repeat == Repeat.NONE -> emptyList()
                else -> listOf(r.copy(due = advance(r.due, r.repeat, now, zone), snoozedUntil = null))
            }
        }.sortedBy { it.fireAt })

    /** Ask again later. The repeat schedule is kept. */
    fun snoozeReminder(m: MemoryData, id: String, now: Long, minutes: Int): MemoryData =
        m.copy(reminders = m.reminders.map { if (it.id == id) it.copy(snoozedUntil = now + minutes * 60_000L) else it }.sortedBy { it.fireAt })

    fun removeReminder(m: MemoryData, id: String): MemoryData = m.copy(reminders = m.reminders.filter { it.id != id })
    fun removeNote(m: MemoryData, id: String): MemoryData = m.copy(notes = m.notes.filter { it.id != id })

    fun withoutIds(m: MemoryData, reminderIds: List<String>, noteIds: List<String>): MemoryData =
        MemoryData(m.notes.filter { it.id !in noteIds }, m.reminders.filter { it.id !in reminderIds })

    private fun words(s: String): List<String> =
        s.lowercase().replace(Regex("[^\\p{L}\\p{N} ]+"), " ").split(Regex("\\s+")).filter { it.length >= 2 }

    private fun <T> matching(items: List<T>, textOf: (T) -> String, match: String): List<T> {
        if (match.trim() == "*") return items
        val wanted = words(match)
        if (wanted.isEmpty()) return emptyList()
        return items.filter { item ->
            val text = textOf(item)
            val have = words(text).toSet()
            wanted.all { it in have || text.lowercase().contains(it) }
        }
    }

    private fun <T> resolve(items: List<T>, textOf: (T) -> String, match: String): Resolved<T> {
        val found = matching(items, textOf, match)
        return if (match.trim() == "*" || found.size == 1) Resolved(found, emptyList()) else Resolved(emptyList(), found)
    }

    fun resolveReminders(m: MemoryData, match: String): Resolved<Reminder> = resolve(m.reminders, { it.text }, match)
    fun resolveNotes(m: MemoryData, match: String): Resolved<Note> = resolve(m.notes, { it.text }, match)

    private val DAYS = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
    private val MONTHS = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )

    private fun two(n: Int) = n.toString().padStart(2, '0')

    private fun clock(d: ZonedDateTime): String {
        val h = d.hour
        return "${if (h % 12 == 0) 12 else h % 12}:${two(d.minute)} ${if (h < 12) "am" else "pm"}"
    }

    /** "Today 5:00 pm", "Tomorrow 9:00 am", "Thu 27 Nov, 5:00 pm" (with the year when it is not this year). */
    fun formatWhen(due: Long, now: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val d = Instant.ofEpochMilli(due).atZone(zone)
        val n = Instant.ofEpochMilli(now).atZone(zone)
        val today: LocalDate = n.toLocalDate()
        return when (d.toLocalDate()) {
            today -> "Today ${clock(d)}"
            today.plusDays(1) -> "Tomorrow ${clock(d)}"
            else -> {
                val year = if (d.year == n.year) "" else " ${d.year}"
                "${DAYS[d.dayOfWeek.value - 1].take(3)} ${d.dayOfMonth} ${MONTHS[d.monthValue - 1].take(3)}$year, ${clock(d)}"
            }
        }
    }

    /** "Thursday 26 November 2026, 23:50 (UTC+05:30)": the clock the model computes times from. */
    fun describeNow(now: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val d = Instant.ofEpochMilli(now).atZone(zone)
        val offset = d.offset.totalSeconds / 60
        val abs = kotlin.math.abs(offset)
        return "${DAYS[d.dayOfWeek.value - 1]} ${d.dayOfMonth} ${MONTHS[d.monthValue - 1]} ${d.year}, " +
            "${two(d.hour)}:${two(d.minute)} (UTC${if (offset < 0) "-" else "+"}${two(abs / 60)}:${two(abs % 60)})"
    }
}
