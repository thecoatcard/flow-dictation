package dev.flow.dictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdaterTest {
    @Test fun newerVersionsAreDetectedNumerically() {
        assertTrue(Updater.isNewer("0.1.8", "0.1.7"))
        assertTrue(Updater.isNewer("0.1.10", "0.1.9")) // not a string comparison
        assertTrue(Updater.isNewer("0.2.0", "0.1.99"))
        assertTrue(Updater.isNewer("1.0", "0.9.9"))
    }

    @Test fun sameOrOlderVersionsAreNotUpdates() {
        assertFalse(Updater.isNewer("0.1.7", "0.1.7"))
        assertFalse(Updater.isNewer("0.1.6", "0.1.7"))
        assertFalse(Updater.isNewer("0.1", "0.1.0"))
        assertFalse(Updater.isNewer("", "0.1.0"))
    }

    @Test fun checksumFileIsParsedInEitherFormat() {
        val hash = "a".repeat(64)
        assertEquals(hash, Updater.parseSha("$hash *Flow-Android-0.1.8.apk\n"))
        assertEquals(hash, Updater.parseSha("${hash.uppercase()}  Flow-Android-0.1.8.apk"))
        assertNull(Updater.parseSha("not a checksum"))
        assertNull(Updater.parseSha("abc123"))
    }
}
