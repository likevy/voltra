package voltra.dynamicwidget.state

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import voltra.dynamicwidget.DynamicWidgetKindResolver
import voltra.dynamicwidget.DynamicWidgetPropsPersistence
import voltra.dynamicwidget.DynamicWidgetPushStateReset
import voltra.dynamicwidget.DynamicWidgetUpdateTrigger
import voltra.dynamicwidget.DynamicWidgetUpdater
import voltra.widget.VoltraWidgetKind
import voltra.widget.VoltraWidgetKindResolution
import voltra.widget.server.WidgetScope

/** PoC for issue #343: where a props push meets the widget state record. */
@RunWith(RobolectricTestRunner::class)
class DynamicWidgetPushStateResetTest {
    private val context = RuntimeEnvironment.getApplication()

    @Test
    fun thePushHookRunsAfterThePropsArePersistedAndBeforeTheReRender() =
        runTest {
            val calls = mutableListOf<String>()
            val updater =
                DynamicWidgetUpdater(
                    dynamicWidgetKindResolver =
                        DynamicWidgetKindResolver { VoltraWidgetKindResolution.Resolved(VoltraWidgetKind.Dynamic) },
                    dynamicWidgetPropsPersistence = DynamicWidgetPropsPersistence { _, _ -> calls += "persist" },
                    dynamicWidgetUpdateTrigger = DynamicWidgetUpdateTrigger { calls += "trigger" },
                    dynamicWidgetPushStateReset = DynamicWidgetPushStateReset { calls += "reset" },
                )

            updater.updateDynamicWidget("PushStateWidget", """{"items":[]}""")

            assertEquals(listOf("persist", "reset", "trigger"), calls)
        }

    @Test
    fun surviveLeavesScopeRecordsAloneAndResetOnPushClearsThem() =
        runTest {
            val scopeStore = DynamicWidgetScopeStateStore(context, afterWrite = { _, _ -> })
            val scope = WidgetScope.of("PushStateWidget")
            scopeStore.commit(scope, """{"done":{"t1":true}}""")
            val reset = AndroidDynamicWidgetPushStateReset(context)

            DynamicWidgetStateFlags.write(context, """{"precedence":"survive"}""")
            reset.afterDynamicWidgetPropsPersisted("PushStateWidget")
            assertEquals(1L, scopeStore.read(scope).stateRevision)

            DynamicWidgetStateFlags.write(context, """{"precedence":"resetOnPush"}""")
            reset.afterDynamicWidgetPropsPersisted("PushStateWidget")
            assertEquals(DynamicWidgetStateSnapshot("{}", 0L), scopeStore.read(scope))
        }
}
