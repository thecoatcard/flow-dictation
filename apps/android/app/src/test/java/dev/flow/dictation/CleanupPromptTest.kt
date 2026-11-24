package dev.flow.dictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Android must clean up exactly like the desktop app. cleanup-prompts.txt holds the desktop's
 * buildSystemPrompt output (packages/core/src/prompt.ts); each case here must match it character for character.
 */
class CleanupPromptTest {
    private val golden: Map<String, String> = javaClass.getResource("/cleanup-prompts.txt")!!.readText()
        .replace("\r\n", "\n")
        .split("=====").filter(String::isNotBlank)
        .associate { block -> block.substringBefore('\n') to block.substringAfter('\n').removeSuffix("\n") }

    private fun prompt(level: CleanupLevel, tone: Tone, dictionary: List<String> = emptyList(), style: String = "") =
        DictationPipeline.prompt(DictationPreferences(level, tone, dictionary, style, emptyMap()))

    @Test fun levelsMatchDesktop() {
        assertEquals(golden.getValue("none-casual"), prompt(CleanupLevel.NONE, Tone.CASUAL))
        assertEquals(golden.getValue("auto-casual"), prompt(CleanupLevel.AUTO, Tone.CASUAL))
        assertEquals(golden.getValue("light-casual"), prompt(CleanupLevel.LIGHT, Tone.CASUAL))
        assertEquals(golden.getValue("medium-casual"), prompt(CleanupLevel.MEDIUM, Tone.CASUAL))
    }

    @Test fun tonesMatchDesktop() {
        assertEquals(golden.getValue("light-professional"), prompt(CleanupLevel.LIGHT, Tone.PROFESSIONAL))
        assertEquals(golden.getValue("light-literal"), prompt(CleanupLevel.LIGHT, Tone.LITERAL))
        assertEquals(golden.getValue("light-code"), prompt(CleanupLevel.LIGHT, Tone.CODE))
    }

    @Test fun dictionaryNotesAndStyleMatchDesktop() {
        assertEquals(
            golden.getValue("light-casual-personal"),
            prompt(CleanupLevel.LIGHT, Tone.CASUAL, listOf("Spring Boot | Java framework", "Angular"), "Short sentences. No exclamation marks.")
        )
    }

    @Test fun hindiRulesMatchDesktop() {
        // Hinglish is the default, so "light-casual" above already covers it.
        assertEquals(
            golden.getValue("light-casual-devanagari"),
            DictationPipeline.prompt(DictationPreferences(CleanupLevel.LIGHT, Tone.CASUAL, emptyList(), "", emptyMap(), HindiOutput.DEVANAGARI))
        )
        assertEquals(golden.getValue("transliterate"), DictationPipeline.transliteratePrompt)
        assertTrue(prompt(CleanupLevel.LIGHT, Tone.CASUAL).contains("write spoken Hindi in Roman letters (Hinglish)"))
    }

    @Test fun guardMatchesDesktop() {
        assertEquals("", DictationPipeline.guardOutput("um", "  "))
        assertEquals("raw text", DictationPipeline.guardOutput("raw text ", "Sure, here is the text: raw text"))
        assertEquals("Sure thing.", DictationPipeline.guardOutput("sure thing", "Sure thing.")) // raw also starts that way
        assertEquals("hi", DictationPipeline.guardOutput("hi", "x".repeat(25)))
        assertEquals("Hello there.", DictationPipeline.guardOutput("hello there", " Hello there. "))
    }
}
