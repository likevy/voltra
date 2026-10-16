package voltra.dynamicwidget.state

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** PoC for issue #343: the runtime switches of the in-widget state PoC. */
@RunWith(RobolectricTestRunner::class)
class DynamicWidgetStateFlagsTest {
    private val context = RuntimeEnvironment.getApplication()

    @Test
    fun readsTheDefaultsWhenNothingWasWritten() {
        DynamicWidgetStateFlags.write(context, """{"scope":null,"interactDelayMs":null,"precedence":null}""")

        assertEquals(DynamicWidgetStateFlagValues(), DynamicWidgetStateFlags.read(context))
    }

    @Test
    fun appliesOnlyThePresentKeysAndNullRestoresTheDefault() {
        DynamicWidgetStateFlags.write(context, """{"scope":"widgetScope","interactDelayMs":250}""")
        DynamicWidgetStateFlags.write(context, """{"precedence":"resetOnPush"}""")

        assertEquals(
            DynamicWidgetStateFlagValues(
                storage = DynamicWidgetStateStorage.WIDGET_SCOPE,
                interactDelayMs = 250L,
                precedence = DynamicWidgetStatePrecedence.RESET_ON_PUSH,
            ),
            DynamicWidgetStateFlags.read(context),
        )

        DynamicWidgetStateFlags.write(context, """{"scope":null}""")

        assertEquals(DynamicWidgetStateStorage.PLACEMENT, DynamicWidgetStateFlags.read(context).storage)
        assertEquals(250L, DynamicWidgetStateFlags.read(context).interactDelayMs)
    }

    @Test
    fun rejectsUnknownValuesWithoutStoringThem() {
        DynamicWidgetStateFlags.write(context, """{"scope":"placement"}""")

        assertThrows(IllegalArgumentException::class.java) {
            DynamicWidgetStateFlags.write(context, """{"scope":"everywhere"}""")
        }
        assertThrows(IllegalArgumentException::class.java) {
            DynamicWidgetStateFlags.write(context, "not json")
        }
        assertEquals(DynamicWidgetStateStorage.PLACEMENT, DynamicWidgetStateFlags.read(context).storage)
    }
}
