package dev.flow.dictation

import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the desktop's answer-code tests: code answers must be split, spoken, parsed and clipped the same way. */
class AnswerCodeTest {
    private val fence = "```"
    private val twoSum = listOf(
        "Use a hash map to find the pair in one pass.",
        "${fence}python",
        "def two_sum(nums, target):",
        "    seen = {}",
        "    for i, n in enumerate(nums):",
        "        if target - n in seen:",
        "            return [seen[target - n], i]",
        "        seen[n] = i",
        fence,
        "Time O(n), space O(n).",
    ).joinToString("\n")
    private val zone: ZoneId = ZoneId.of("Asia/Kolkata")
    private val now = 1_800_000_000_000L

    @Test fun separatesProseAndACodeBlockKeepingTheLanguageAndTheCodeExactly() {
        val parts = Answer.split(twoSum)
        assertEquals(3, parts.size)
        assertEquals(Answer.Part.Text("Use a hash map to find the pair in one pass."), parts[0])
        assertEquals(
            Answer.Part.Code(
                "python",
                "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i",
            ),
            parts[1],
        )
        assertEquals(Answer.Part.Text("Time O(n), space O(n)."), parts[2])
    }

    @Test fun handlesSeveralBlocksNoLanguageCodeOnlyAndPlainProse() {
        assertEquals(listOf(Answer.Part.Code("", "x = 1")), Answer.split("$fence\nx = 1\n$fence"))
        assertEquals(listOf("Text", "Code", "Text", "Code"), Answer.split("A\n${fence}js\none\n$fence\nB\n${fence}sql\ntwo\n$fence").map { it::class.simpleName })
        assertEquals(listOf(Answer.Part.Text("Just a sentence.")), Answer.split("Just a sentence."))
    }

    @Test fun aBlockThatWasNeverClosedIsCodeToTheEnd() {
        val parts = Answer.split("Here:\n${fence}python\nprint(1)\nprint(2)")
        assertEquals(listOf("Text", "Code"), parts.map { it::class.simpleName })
        assertTrue((parts[1] as Answer.Part.Code).text.contains("print(2)"))
    }

    @Test fun readsTheProseAndSkipsTheCodeAloud() {
        assertEquals("Use a hash map to find the pair in one pass. Time O(n), space O(n). The code is shown on screen.", Answer.spokenText(twoSum))
        assertEquals("Canberra.", Answer.spokenText("Canberra."))
    }

    @Test fun aPlainTextReplyWithCodeIsTheAnswerBracesAndAll() {
        assertEquals(AskResult.Answer(twoSum), AskMode.parse(twoSum, now, zone))
        val json = "Config:\n${fence}json\n{\"a\": 1, \"b\": [1, 2]}\n$fence"
        assertEquals(AskResult.Answer(json), AskMode.parse(json, now, zone))
        assertEquals(AskResult.Remember("gate code 1234"), AskMode.parse("{\"action\":\"remember\",\"text\":\"gate code 1234\"}", now, zone))
    }

    @Test fun aReplyThatIsOnlyACodeBlockKeepsItsFence() {
        val only = "${fence}python\nprint(1)\n$fence"
        assertEquals(AskResult.Answer(only), AskMode.parse(only, now, zone))
    }

    @Test fun aLongSolutionIsKeptAndItsCodeBlockIsClosedIfItHasToBeCut() {
        val lines = (0 until 900).joinToString("\n") { "    value_$it = compute($it)" }
        val reply = "${fence}python\ndef big():\n$lines\n$fence"
        val text = (AskMode.parse(reply, now, zone) as AskResult.Answer).text
        assertTrue(text.length <= AskMode.MAX_ANSWER_CHARS + 8)
        assertEquals(0, Regex("^```", RegexOption.MULTILINE).findAll(text).count() % 2)
        assertTrue(text.endsWith(fence))
    }
}
