package dev.flow.dictation

import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the desktop's memory and Ask tests (packages/core): the same cases must give the same answers. */
class MemoryTest {
    private val zone: ZoneId = ZoneId.of("Asia/Kolkata")
    private fun at(day: Int, hour: Int, minute: Int = 0, month: Int = 11, year: Int = 2026) =
        LocalDateTime.of(year, month, day, hour, minute).atZone(zone).toInstant().toEpochMilli()
    private val now = at(26, 23, 50) // Thursday 26 November 2026, 23:50

    private fun reminders() = Memory.addReminder(
        Memory.addReminder(MemoryData(), "call Dhriti", at(27, 17), Repeat.NONE, now, "a"),
        "take the tablet", at(27, 9), Repeat.NONE, now, "b",
    )

    @Test fun remindersAreOrderedAndSplitIntoDueAndUpcoming() {
        val m = reminders()
        assertEquals(listOf("b", "a"), m.reminders.map { it.id })
        assertTrue(Memory.dueReminders(m, now).isEmpty())
        assertEquals(at(27, 9), Memory.nextDueAt(m, now))
        assertEquals(listOf("b"), Memory.dueReminders(m, at(27, 10)).map { it.id })
        assertEquals(listOf("b", "a"), Memory.dueReminders(m, at(27, 18)).map { it.id })
    }

    @Test fun clearingAOneOffRemovesItAndARepeatingOneMovesOn() {
        val m = Memory.addReminder(reminders(), "stand up", at(26, 9), Repeat.DAILY, at(25, 8), "c")
        val next = Memory.clearReminder(m, "c", now, zone).reminders.first { it.id == "c" }
        assertEquals(at(27, 9), next.due)
        assertEquals(listOf("b"), Memory.clearReminder(reminders(), "a", now, zone).reminders.map { it.id })
    }

    @Test fun missedWeeklyOccurrencesAreSkipped() {
        val m = Memory.addReminder(MemoryData(), "weekly review", at(5, 10), Repeat.WEEKLY, at(1, 8), "w")
        assertEquals(at(3, 10, month = 12), Memory.clearReminder(m, "w", now, zone).reminders[0].due)
    }

    @Test fun snoozingMovesTheFiringTimeButKeepsTheSchedule() {
        val m = Memory.addReminder(MemoryData(), "stand up", at(26, 9), Repeat.DAILY, at(25, 8), "c")
        val snoozed = Memory.snoozeReminder(m, "c", now, 10)
        assertTrue(Memory.dueReminders(snoozed, now).isEmpty())
        val later = now + 11 * 60_000L
        assertEquals(listOf("c"), Memory.dueReminders(snoozed, later).map { it.id })
        val cleared = Memory.clearReminder(snoozed, "c", later, zone).reminders[0]
        assertNull(cleared.snoozedUntil)
        assertEquals(at(27, 9), cleared.due)
    }

    @Test fun notesAreNewestFirstAndCleaned() {
        val m = Memory.addNote(Memory.addNote(MemoryData(), "my locker code is 4821", now, "n1"), "wifi password is blue sky", now, "n2")
        assertEquals(listOf("n2", "n1"), m.notes.map { it.id })
        assertEquals("a b c", Memory.addNote(MemoryData(), "  a   b \n c ", now, "x").notes[0].text)
        assertTrue(Memory.addNote(MemoryData(), "   ", now, "x").notes.isEmpty())
    }

    @Test fun matchingRemovesOnlyASingleClearMatch() {
        val m = Memory.addNote(Memory.addNote(MemoryData(), "my locker code is 4821", now, "n1"), "wifi password is blue sky", now, "n2")
        assertEquals(listOf("n1"), Memory.resolveNotes(m, "locker code").removed.map { it.id })
        assertEquals(2, Memory.resolveNotes(m, "is").ambiguous.size)
        assertTrue(Memory.resolveNotes(m, "is").removed.isEmpty())
        assertEquals(Resolved<Note>(emptyList(), emptyList()), Memory.resolveNotes(m, "zebra"))
        assertEquals(2, Memory.resolveNotes(m, "*").removed.size)
    }

    @Test fun timeTextIsPlainWords() {
        assertEquals("Today 11:59 pm", Memory.formatWhen(at(26, 23, 59), now, zone))
        assertEquals("Tomorrow 9:00 am", Memory.formatWhen(at(27, 9), now, zone))
        assertEquals("Mon 30 Nov, 12:05 am", Memory.formatWhen(at(30, 0, 5), now, zone))
        assertEquals("Sat 2 Jan 2027, 12:00 pm", Memory.formatWhen(at(2, 12, 0, month = 1, year = 2027), now, zone))
        assertEquals("Thursday 26 November 2026, 23:50 (UTC+05:30)", Memory.describeNow(now, zone))
    }

    // ---- Ask ----

    private fun parse(raw: String) = AskMode.parse(raw, now, zone)

    @Test fun readsEachAskAction() {
        assertEquals(AskResult.Answer("Canberra."), parse("{\"action\":\"answer\",\"text\":\"Canberra.\"}"))
        assertEquals(AskResult.Remember("my locker code is 4821"), parse("{\"action\":\"remember\",\"text\":\"my locker code is 4821\"}"))
        assertEquals(AskResult.Cancel("call Dhriti"), parse("{\"action\":\"cancel\",\"match\":\"call Dhriti\"}"))
        assertEquals(AskResult.Forget("locker"), parse("{\"action\":\"forget\",\"match\":\"locker\"}"))
        assertEquals(
            AskResult.Remind("call Dhriti", at(27, 17), Repeat.DAILY),
            parse("{\"action\":\"remind\",\"text\":\"call Dhriti\",\"when\":\"2026-11-27T17:00\",\"repeat\":\"daily\"}"),
        )
    }

    @Test fun acceptsFencedOrChattyJsonAndShowsPlainTextAsAnAnswer() {
        assertEquals(AskResult.Answer("Hi."), parse("```json\n{\"action\":\"answer\",\"text\":\"Hi.\"}\n```"))
        assertEquals(AskResult.Answer("Hi."), parse("Sure! {\"action\":\"answer\",\"text\":\"Hi.\"}"))
        assertEquals(AskResult.Answer("Just a plain sentence."), parse("Just a plain sentence."))
        assertNull(parse("  "))
    }

    @Test fun readsEscapesInTheText() {
        assertEquals(AskResult.Answer("Line one\nHe said \"hi\" \u0905"), parse("{\"action\":\"answer\",\"text\":\"Line one\\nHe said \\\"hi\\\" \\u0905\"}"))
    }

    @Test fun neverSavesAReminderWithoutARealFutureTime() {
        val past = parse("{\"action\":\"remind\",\"text\":\"x\",\"when\":\"2026-11-26T09:00\"}") as AskResult.Answer
        assertTrue(past.text.contains("already passed"))
        assertTrue(parse("{\"action\":\"remind\",\"text\":\"x\",\"when\":\"tomorrow\"}") is AskResult.Answer)
        assertTrue(parse("{\"action\":\"remind\",\"text\":\"x\",\"when\":\"2026-02-31T10:00\"}") is AskResult.Answer)
        assertNull(parse("{\"action\":\"remind\",\"text\":\"\",\"when\":\"2026-11-27T10:00\"}"))
    }

    @Test fun anUnknownRepeatIsNoneAndAnUnknownActionIsAnAnswer() {
        assertEquals(Repeat.NONE, (parse("{\"action\":\"remind\",\"text\":\"x\",\"when\":\"2026-11-27T10:00\",\"repeat\":\"hourly\"}") as AskResult.Remind).repeat)
        assertTrue(parse("{\"action\":\"launch\"}") is AskResult.Answer)
    }

    private var counter = 0
    private fun apply(m: MemoryData, r: AskResult) = AskMode.apply(m, r, now, { "id${++counter}" }, zone)

    @Test fun savesNotesAndSetsRemindersAndSaysSo() {
        val noted = apply(MemoryData(), AskResult.Remember("my locker code is 4821"))
        assertEquals("Saved to your notes: my locker code is 4821", noted.second)
        assertEquals(1, noted.first.notes.size)
        val set = apply(MemoryData(), AskResult.Remind("call Dhriti", at(27, 17), Repeat.DAILY))
        assertEquals("Reminder set: call Dhriti\nTomorrow 5:00 pm · every day", set.second)
        assertEquals(1, set.first.reminders.size)
    }

    @Test fun cancelsASingleMatchAllOnRequestAndNothingOnAGuess() {
        val two = Memory.addReminder(Memory.addReminder(MemoryData(), "call Dhriti", at(27, 17), Repeat.NONE, now, "a"), "call mom", at(27, 18), Repeat.NONE, now, "b")
        assertEquals("Cancelled: call Dhriti", apply(two, AskResult.Cancel("dhriti")).second)
        assertEquals("Cancelled 2 reminders", apply(two, AskResult.Cancel("*")).second)
        val guess = apply(two, AskResult.Cancel("call"))
        assertEquals(2, guess.first.reminders.size)
        assertTrue(guess.second.contains("Which one?"))
        assertEquals("I could not find a reminder like that.", apply(two, AskResult.Cancel("zebra")).second)
    }

    @Test fun forgetsNotesWithTheSameCare() {
        val m = Memory.addNote(MemoryData(), "my locker code is 4821", now, "n1")
        assertEquals("Forgot: my locker code is 4821", apply(m, AskResult.Forget("locker")).second)
        assertEquals("I could not find a note like that.", apply(m, AskResult.Forget("zebra")).second)
    }

    @Test fun leavesNotesOutWhenTheUserTurnedThatOff() {
        val context = AskContext(now, listOf(Note("n", "secret", now)), emptyList(), useNotes = false, zone = zone)
        val message = AskMode.message("hi", context)
        assertTrue(!message.contains("secret"))
        assertTrue(!message.contains("<notes>"))
        assertNotNull(message)
    }
}
