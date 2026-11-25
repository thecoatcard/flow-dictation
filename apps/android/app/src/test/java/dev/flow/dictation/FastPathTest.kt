package dev.flow.dictation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FastPathTest {
    private fun prefs(
        level: CleanupLevel = CleanupLevel.AUTO,
        tone: Tone = Tone.CASUAL,
        hindi: HindiOutput = HindiOutput.HINGLISH,
        dictionary: List<String> = emptyList(),
    ) = DictationPreferences(level, tone, dictionary, "", emptyMap(), hindi)

    @Test fun clearTextSkipsTheModel() {
        listOf(
            "I will reach in ten minutes.",
            "Can you send me the report by Friday?",
            "The meeting is at 3 p.m. tomorrow.",
        ).forEach { assertTrue(it, FastPath.isClearAlready(it, prefs())) }
    }

    @Test fun anythingMessyGoesToTheModel() {
        listOf(
            "um I will reach in ten minutes.",
            "I will I will reach soon.",
            "Meet at 8, no wait, at 7.",
            "i will reach soon.",
            "I will reach soon",
            "First buy milk. Second buy eggs.",
            "Email me at sam at the rate example dot com.",
            "Line one.\nLine two.",
            "I will reach  soon.",
            "मैं कल आऊँगा।",
        ).forEach { assertFalse(it, FastPath.isClearAlready(it, prefs())) }
    }

    @Test fun onlyAutoNonCodeAndCorrectSpelling() {
        val clear = "I will reach in ten minutes."
        assertFalse(FastPath.isClearAlready(clear, prefs(level = CleanupLevel.LIGHT)))
        assertFalse(FastPath.isClearAlready(clear, prefs(tone = Tone.CODE)))
        assertFalse(FastPath.isClearAlready(clear, prefs(hindi = HindiOutput.DEVANAGARI)))
        val dict = prefs(dictionary = listOf("Spring Boot | Java framework"))
        assertFalse(FastPath.isClearAlready("We use spring boot here.", dict))
        assertTrue(FastPath.isClearAlready("We use Spring Boot here.", dict))
    }
}
