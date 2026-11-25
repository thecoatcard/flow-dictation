package dev.flow.dictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FeatureLogicTest {
    // ---- faster finish ----
    @Test fun finishWaitsLongerWhenNothingWasHeard() {
        assertFalse(FinishPolicy.isFinal(hasText = true, idleMs = 600))
        assertTrue(FinishPolicy.isFinal(hasText = true, idleMs = 700))
        assertFalse(FinishPolicy.isFinal(hasText = false, idleMs = 1_400))
        assertTrue(FinishPolicy.isFinal(hasText = false, idleMs = 1_500))
    }

    // ---- learning dictionary terms from a fix ----
    @Test fun learnsATermThatReplacedAMisheardPhrase() {
        assertEquals(listOf("Kubernetes"), Learn.terms("we deploy it on cooper net is", "we deploy it on Kubernetes"))
    }

    @Test fun learnsNamesCamelCaseAcronymsVersionsAndIdentifiers() {
        val after = "Ask Anand to use buildSystemPrompt with the EPAM API on k8s and Node.js for GPT4."
        assertEquals(
            listOf("Anand", "buildSystemPrompt", "EPAM", "API", "k8s", "Node.js", "GPT4"),
            Learn.terms("ask to use with the on and for.", after)
        )
    }

    @Test fun ignoresEverydayWordsNumbersAndSentenceCapitals() {
        assertEquals(emptyList<String>(), Learn.terms("i went to form", "I went to the form. Then we left at 7 pm."))
    }

    @Test fun ignoresWordsAlreadyInTheOriginalOrTheDictionaryAndNeverRepeats() {
        assertEquals(emptyList<String>(), Learn.terms("Send it to Anand", "Send it to Anand and Rahul", listOf("rahul")))
        assertEquals(listOf("Rahul"), Learn.terms("hi", "hi Rahul Rahul"))
        assertEquals(listOf("Flow", "Gemini"), Learn.terms("x", "Use “Flow”, then (Gemini)."))
    }

    // ---- history list ----
    private fun entry(id: String, text: String, app: String = "") = HistoryEntry(id, 0L, app, text)

    @Test fun historyIsNewestFirstSearchableAndCapped() {
        val list = HistoryList(max = 3)
        list.add(entry("1", "Meet at 7 pm", "com.whatsapp"))
        list.add(entry("2", "Send the report to Anand", "outlook"))
        list.add(entry("blank", "   "))
        assertEquals(listOf("2", "1"), list.items.map { it.id })
        assertEquals(listOf("2"), list.search("REPORT").map { it.id })
        assertEquals(listOf("1"), list.search("whatsapp").map { it.id })
        list.add(entry("3", "three")); list.add(entry("4", "four"))
        assertEquals(listOf("4", "3", "2"), list.items.map { it.id }) // the oldest fell off
    }

    @Test fun historyUpdateRemoveAndClear() {
        val list = HistoryList()
        list.add(entry("a", "cooper net is great"))
        assertTrue(list.update("a", "Kubernetes is great"))
        assertFalse(list.update("a", "  "))
        assertFalse(list.update("missing", "x"))
        assertEquals("Kubernetes is great", list.items.single().text)
        list.remove("a")
        assertTrue(list.items.isEmpty())
        list.add(entry("b", "x")); list.clear()
        assertTrue(list.items.isEmpty())
    }

    // ---- chimes ----
    @Test fun chimesAreShortAudibleAndNeverClip() {
        for (kind in Chime.Kind.values()) {
            val s = Chime.samples(kind)
            val ms = s.size * 1000 / 44_100
            assertTrue("$kind is $ms ms", ms in 200..450)
            val peak = s.maxOf { kotlin.math.abs(it.toInt()) } / 32767.0
            assertTrue("$kind peak $peak", peak in 0.15..0.5)
        }
        // the stop chime is a little softer than the start chime
        fun peak(kind: Chime.Kind) = Chime.samples(kind).maxOf { kotlin.math.abs(it.toInt()) }
        assertTrue(peak(Chime.Kind.STOP) < peak(Chime.Kind.START))
    }

    // ---- languages ----
    @Test fun autoDetectSendsNoLanguageAndUnknownCodesFallBackToIt() {
        assertEquals(emptyList<String>(), Languages.codes(""))
        assertEquals(emptyList<String>(), Languages.codes("xx-XX"))
        assertEquals(listOf("hi-IN"), Languages.codes("hi-IN"))
        assertEquals("", Languages.all.first().code)
    }

    // ---- battery help ----
    @Test fun batteryStepsMatchThePhoneMaker() {
        assertEquals("vivo", BatteryHelp.brand("vivo"))
        assertEquals("vivo", BatteryHelp.brand(" iQOO "))
        assertEquals("xiaomi", BatteryHelp.brand("Redmi"))
        assertEquals("other", BatteryHelp.brand("Google"))
        assertTrue(BatteryHelp.steps("vivo").first().contains("Background power consumption"))
        assertTrue(BatteryHelp.steps("Google").first().contains("Unrestricted"))
        for (m in listOf("vivo", "xiaomi", "oppo", "samsung", "huawei", "Google", "")) assertTrue(BatteryHelp.steps(m).isNotEmpty())
    }
}
