package dev.flow.dictation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FieldSelectionTest {
    @Test fun acceptsCursorAndSelectionWithinText() {
        assertEquals(2 to 2, safeSelection(4, 2, 2))
        assertEquals(1 to 3, safeSelection(4, 1, 3))
    }

    @Test fun rejectsMissingOrInconsistentCursor() {
        assertNull(safeSelection(4, -1, -1))
        assertNull(safeSelection(4, 2, -1))
        assertNull(safeSelection(4, 3, 2))
        assertNull(safeSelection(4, 5, 5))
    }
}
