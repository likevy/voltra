package voltra.dynamicwidget.state

import androidx.glance.appwidget.AppWidgetId
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import voltra.dynamicwidget.dynamicWidgetPropsRevisionKey
import voltra.widget.server.WidgetScope

/** PoC for issue #343: the per-placement and per-scope widget state stores. */
@RunWith(RobolectricTestRunner::class)
class DynamicWidgetStateStoreTest {
    private val context = RuntimeEnvironment.getApplication()

    @Test
    fun readsAnEmptyRecordAtRevisionZeroBeforeAnyCommit() =
        runTest {
            val glanceId = AppWidgetId(71_001)

            assertEquals("{}", DynamicWidgetStateStore.readPlacementState(context, glanceId))
            assertEquals(0L, DynamicWidgetStateStore.readPlacementSnapshot(context, glanceId).stateRevision)
        }

    @Test
    fun commitReturnsAnIncrementingRevisionAndAdvancesThePropsRevision() =
        runTest {
            val glanceId = AppWidgetId(71_002)
            val initialPropsRevision = propsRevision(glanceId)

            val first = DynamicWidgetStateStore.commitPlacementState(context, glanceId, """{"done":{"t1":true}}""")
            val second = DynamicWidgetStateStore.commitPlacementState(context, glanceId, """{"done":{"t1":false}}""")

            assertEquals(1L, first)
            assertEquals(2L, second)
            assertJsonEquals(
                """{"done":{"t1":false}}""",
                DynamicWidgetStateStore.readPlacementState(context, glanceId),
            )
            assertEquals(2L, DynamicWidgetStateStore.readPlacementSnapshot(context, glanceId).stateRevision)
            assertEquals(initialPropsRevision + 2L, propsRevision(glanceId))
        }

    @Test
    fun concurrentCommitsEachAdvanceBothRevisionsOnce() =
        runTest {
            val glanceId = AppWidgetId(71_003)
            val initialStateRevision = DynamicWidgetStateStore.readPlacementSnapshot(context, glanceId).stateRevision
            val initialPropsRevision = propsRevision(glanceId)

            val revisions =
                coroutineScope {
                    List(20) { index ->
                        async {
                            DynamicWidgetStateStore.commitPlacementState(context, glanceId, """{"n":$index}""")
                        }
                    }.awaitAll()
                }

            assertEquals((initialStateRevision + 1L..initialStateRevision + 20L).toList(), revisions.sorted())
            assertEquals(
                initialStateRevision + 20L,
                DynamicWidgetStateStore.readPlacementSnapshot(context, glanceId).stateRevision,
            )
            assertEquals(initialPropsRevision + 20L, propsRevision(glanceId))
        }

    @Test
    fun resetClearsTheRecordAndStillAdvancesTheRevisions() =
        runTest {
            val glanceId = AppWidgetId(71_004)
            DynamicWidgetStateStore.commitPlacementState(context, glanceId, """{"done":{"t1":true}}""")
            val propsRevisionBeforeReset = propsRevision(glanceId)

            DynamicWidgetStateStore.resetPlacementState(context, glanceId)

            val snapshot = DynamicWidgetStateStore.readPlacementSnapshot(context, glanceId)
            assertEquals("{}", snapshot.stateJson)
            assertEquals(2L, snapshot.stateRevision)
            assertEquals(propsRevisionBeforeReset + 1L, propsRevision(glanceId))
        }

    @Test
    fun aCommitThatIsNotAJsonObjectIsStoredAsAnEmptyRecord() =
        runTest {
            val glanceId = AppWidgetId(71_005)

            DynamicWidgetStateStore.commitPlacementState(context, glanceId, "[1,2]")

            assertEquals("{}", DynamicWidgetStateStore.readPlacementState(context, glanceId))
        }

    @Test
    fun scopeStoreSharesOneRecordPerScopeAndReRendersTheWidgetAfterEachWrite() =
        runTest {
            val rerendered = mutableListOf<String>()
            val store = DynamicWidgetScopeStateStore(context, afterWrite = { _, widgetId -> rerendered += widgetId })
            val instance = WidgetScope.Instance("ScopeStateWidget", "abc")
            val widget = WidgetScope.of("ScopeStateWidget")

            assertEquals(DynamicWidgetStateSnapshot("{}", 0L), store.read(instance))
            assertEquals(1L, store.commit(instance, """{"done":{"t1":true}}"""))
            assertEquals(2L, store.commit(instance, """{"done":{"t1":false}}"""))
            assertJsonEquals("""{"done":{"t1":false}}""", store.read(instance).stateJson)
            assertEquals(DynamicWidgetStateSnapshot("{}", 0L), store.read(widget))

            store.reset(instance)
            assertEquals(DynamicWidgetStateSnapshot("{}", 3L), store.read(instance))
            assertEquals(listOf("ScopeStateWidget", "ScopeStateWidget", "ScopeStateWidget"), rerendered)

            store.commit(widget, """{"a":1}""")
            store.clearWidget("ScopeStateWidget")
            assertEquals(0L, store.read(instance).stateRevision)
            assertEquals(0L, store.read(widget).stateRevision)
        }

    @Test
    fun concurrentScopeCommitsEachAdvanceTheRevisionOnce() =
        runTest {
            val store = DynamicWidgetScopeStateStore(context, afterWrite = { _, _ -> })
            val scope = WidgetScope.of("ConcurrentScopeStateWidget")

            coroutineScope {
                List(20) { index -> async { store.commit(scope, """{"n":$index}""") } }.awaitAll()
            }

            assertEquals(20L, store.read(scope).stateRevision)
        }

    private suspend fun propsRevision(glanceId: AppWidgetId): Long =
        getAppWidgetState(context, PreferencesGlanceStateDefinition, glanceId)[dynamicWidgetPropsRevisionKey] ?: 0L

    private fun assertJsonEquals(
        expected: String,
        actual: String,
    ) = assertEquals(Json.parseToJsonElement(expected), Json.parseToJsonElement(actual))
}
