package dev.flow.dictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the desktop's format and fast-path tests: the same Markdown must give the same plain text. */
class FormattingTest {
    private val golden: Map<String, String> = javaClass.getResource("/cleanup-prompts.txt")!!.readText()
        .replace("\r\n", "\n")
        .split("=====").filter(String::isNotBlank)
        .associate { block -> block.substringBefore('\n') to block.substringAfter('\n').removeSuffix("\n") }

    private fun prefs(
        level: CleanupLevel = CleanupLevel.AUTO,
        tone: Tone = Tone.CASUAL,
        smartFormatting: Boolean = true,
    ) = DictationPreferences(level, tone, emptyList(), "", emptyMap(), HindiOutput.HINGLISH, "", smartFormatting)

    private val markdown = listOf(
        "Here is the plan for the launch:",
        "",
        "**Action items:**",
        "- Finish the **pricing page**",
        "- Email the beta users",
        "- Book the demo room",
        "",
        "After that we review feedback.",
    ).joinToString("\n")

    @Test fun keepsListsAndParagraphsAndDropsTheBoldSymbols() {
        assertEquals(
            listOf(
                "Here is the plan for the launch:",
                "",
                "Action items:",
                "- Finish the pricing page",
                "- Email the beta users",
                "- Book the demo room",
                "",
                "After that we review feedback.",
            ).joinToString("\n"),
            Formatting.toPlain(markdown),
        )
    }

    @Test fun normalizesBulletsAndNumbersRemovesHeadingsAndCollapsesBlankLines() {
        assertEquals("Title\n\n- one\n- two\n1. first\n2. second", Formatting.toPlain("# Title\n\n\n\n* one\n• two\n1) first\n2. second"))
    }

    @Test fun leavesOrdinaryTextAlone() {
        assertEquals("Just one sentence, about 2*3 and a * star.", Formatting.toPlain("Just one sentence, about 2*3 and a * star."))
    }

    @Test fun longOrMultiSentenceSpeechGoesToTheModelButShortSpeechDoesNot() {
        val longClear = "The meeting is at three. We will cover pricing. Then we will plan the launch."
        assertFalse(FastPath.isClearAlready(longClear, prefs()))
        assertTrue(FastPath.isClearAlready(longClear, prefs(smartFormatting = false)))
        assertTrue(FastPath.isClearAlready("The meeting is at three.", prefs()))
    }

    @Test fun theOlderListRulesStayWhenFormattingIsOffOrTheToneIsCodeOrLiteral() {
        assertEquals(golden.getValue("light-casual-noformat"), DictationPipeline.prompt(prefs(CleanupLevel.LIGHT, Tone.CASUAL, smartFormatting = false)))
        assertTrue(DictationPipeline.prompt(prefs(CleanupLevel.LIGHT, Tone.CODE)).contains("If the speaker clearly enumerates items"))
        assertTrue(DictationPipeline.prompt(prefs(CleanupLevel.LIGHT, Tone.LITERAL)).contains("If the speaker clearly enumerates items"))
        assertFalse(DictationPipeline.prompt(prefs(CleanupLevel.LIGHT, Tone.CASUAL)).contains("If the speaker clearly enumerates items"))
    }
}
