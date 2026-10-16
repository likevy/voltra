package voltra.dynamicwidget.state

import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.AppWidgetId
import androidx.glance.appwidget.action.ToggleableStateKey
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import voltra.dynamicwidget.dynamicWidgetPropsRevisionKey

/**
 * PoC for issue #343: the tap flow with fakes for the bundle, the `interact` export and `update()`,
 * against the real placement store and event queue.
 */
@RunWith(RobolectricTestRunner::class)
class DynamicWidgetStateInteractionTest {
    private val context = RuntimeEnvironment.getApplication()
    private val widgetId = "TodoStateWidget"

    private val bundleEvaluations = mutableListOf<String>()
    private val invocations = mutableListOf<Triple<String, String, String>>()
    private val updates = mutableListOf<Pair<String, GlanceId>>()
    private var interactResult: () -> String? = { """{"handled":false}""" }
    private lateinit var events: DynamicWidgetEventQueue

    private val interaction =
        DynamicWidgetStateInteraction(
            ensureBundle = { _, id ->
                bundleEvaluations += id
                true
            },
            invoke = { id, exportName, payload ->
                invocations += Triple(id, exportName, payload)
                interactResult()
            },
            update = { _, id, glanceId -> updates += id to glanceId },
            resolveAppWidgetId = { _, glanceId -> (glanceId as AppWidgetId).appWidgetId },
            readConfiguration = { _, _, _ -> emptyMap() },
            readProps = { _, _ -> """{"items":[{"id":"t1","title":"Buy milk"}]}""" },
            buildEnv = { _, _, _ -> """{"widgetFamily":"255x200","colorScheme":"light"}""" },
            readFlags = { DynamicWidgetStateFlagValues() },
            now = { 1_700_000_000_000L },
        )

    @Before
    fun setUp() {
        events = DynamicWidgetEventQueue(context)
        events.drain()
    }

    @Test
    fun checkboxTapWithAHandlerPatchCommitsTheMergedStateAndReportsIt() =
        runTest {
            val glanceId = AppWidgetId(72_001)
            DynamicWidgetStateStore.commitPlacementState(context, glanceId, """{"done":{"t0":true},"keep":1}""")
            val propsRevisionBefore = propsRevision(glanceId)
            interactResult = { """{"handled":true,"state":{"done":{"t0":true,"t1":true}}}""" }

            interaction.onAction(context, glanceId, tap(componentId = "t1", checked = true, renderedRevision = 1L))

            val snapshot = DynamicWidgetStateStore.readPlacementSnapshot(context, glanceId)
            assertJsonEquals("""{"done":{"t0":true,"t1":true},"keep":1}""", snapshot.stateJson)
            assertEquals(2L, snapshot.stateRevision)
            assertEquals(propsRevisionBefore + 1L, propsRevision(glanceId))
            assertEquals(listOf(widgetId to glanceId), updates)
            assertEquals(listOf(widgetId), bundleEvaluations)

            val (invokedWidget, exportName, payloadJson) = invocations.single()
            assertEquals(widgetId, invokedWidget)
            assertEquals("interact", exportName)
            val payload = Json.parseToJsonElement(payloadJson).jsonObject
            val event = payload["event"]!!.jsonObject
            assertEquals("t1", event["componentId"]!!.jsonPrimitive.content)
            assertEquals("checkbox", event["componentType"]!!.jsonPrimitive.content)
            assertEquals(true, event["value"]!!.jsonPrimitive.boolean)
            assertEquals(1L, event["renderedRevision"]!!.jsonPrimitive.long)
            assertEquals(JsonNull, event["stateKey"])
            assertJsonEquals("""{"done":{"t0":true},"keep":1}""", payload["state"].toString())
            assertJsonEquals("""{"items":[{"id":"t1","title":"Buy milk"}]}""", payload["props"].toString())
            assertEquals("255x200", payload["env"]!!.jsonObject["widgetFamily"]!!.jsonPrimitive.content)

            val reported = drainedEvents().single()
            assertEquals("interaction", reported["type"]!!.jsonPrimitive.content)
            assertEquals("widget", reported["source"]!!.jsonPrimitive.content)
            assertEquals(widgetId, reported["widgetId"]!!.jsonPrimitive.content)
            assertEquals("t1", reported["identifier"]!!.jsonPrimitive.content)
            assertEquals(72_001L, reported["appWidgetId"]!!.jsonPrimitive.long)
            assertEquals(JsonNull, reported["instance"])
            assertEquals(true, reported["handledInWidget"]!!.jsonPrimitive.boolean)
            assertEquals(2L, reported["stateRevision"]!!.jsonPrimitive.long)
            assertEquals(1L, reported["renderedRevision"]!!.jsonPrimitive.long)
            assertEquals(1_700_000_000_000L, reported["timestamp"]!!.jsonPrimitive.long)
            assertJsonEquals(
                """{"key":"done","from":{"t0":true},"to":{"t0":true,"t1":true}}""",
                reported["stateChange"].toString(),
            )
        }

    @Test
    fun aStateKeyTapWritesTheToggleValueWithoutRunningJs() =
        runTest {
            val glanceId = AppWidgetId(72_002)

            interaction.onAction(
                context,
                glanceId,
                tap(componentId = "t2", checked = true, stateKey = "done.t2", renderedRevision = 0L),
            )

            assertJsonEquals(
                """{"done.t2":true}""",
                DynamicWidgetStateStore.readPlacementState(context, glanceId),
            )
            assertEquals(1L, DynamicWidgetStateStore.readPlacementSnapshot(context, glanceId).stateRevision)
            assertTrue(invocations.isEmpty())
            assertTrue(bundleEvaluations.isEmpty())
            assertEquals(1, updates.size)

            val reported = drainedEvents().single()
            assertEquals(true, reported["handledInWidget"]!!.jsonPrimitive.boolean)
            assertJsonEquals("""{"key":"done.t2","from":null,"to":true}""", reported["stateChange"].toString())
        }

    @Test
    fun aMissingHandlerWritesNothingButStillRepaintsAndReports() =
        runTest {
            val glanceId = AppWidgetId(72_003)
            interactResult = { """{"handled":false}""" }

            interaction.onAction(context, glanceId, tap(componentId = "t1", checked = true, renderedRevision = 0L))

            val snapshot = DynamicWidgetStateStore.readPlacementSnapshot(context, glanceId)
            assertEquals("{}", snapshot.stateJson)
            assertEquals(0L, snapshot.stateRevision)
            assertEquals(0L, propsRevision(glanceId))
            assertEquals(1, invocations.size)
            assertEquals(1, updates.size)

            val reported = drainedEvents().single()
            assertEquals(false, reported["handledInWidget"]!!.jsonPrimitive.boolean)
            assertEquals(0L, reported["stateRevision"]!!.jsonPrimitive.long)
            assertEquals(JsonNull, reported["stateChange"])
        }

    @Test
    fun anInteractThatThrowsStillCallsUpdate() =
        runTest {
            val glanceId = AppWidgetId(72_004)
            DynamicWidgetStateStore.commitPlacementState(context, glanceId, """{"done":{"t1":false}}""")
            interactResult = { throw IllegalStateException("onInteraction must be synchronous") }

            interaction.onAction(context, glanceId, tap(componentId = "t1", checked = true, renderedRevision = 1L))

            assertJsonEquals(
                """{"done":{"t1":false}}""",
                DynamicWidgetStateStore.readPlacementState(context, glanceId),
            )
            assertEquals(listOf(widgetId to glanceId), updates)
            assertEquals(false, drainedEvents().single()["handledInWidget"]!!.jsonPrimitive.boolean)
        }

    @Test
    fun aFailingUpdateDoesNotLoseTheCommit() =
        runTest {
            val glanceId = AppWidgetId(72_005)
            val failingUpdate =
                DynamicWidgetStateInteraction(
                    update = { _, _, _ -> throw IllegalStateException("no registered widget") },
                    resolveAppWidgetId = { _, id -> (id as AppWidgetId).appWidgetId },
                    readConfiguration = { _, _, _ -> emptyMap() },
                    readFlags = { DynamicWidgetStateFlagValues() },
                )

            failingUpdate.onAction(context, glanceId, tap(componentId = "t1", checked = false, stateKey = "done.t1"))

            assertJsonEquals("""{"done.t1":false}""", DynamicWidgetStateStore.readPlacementState(context, glanceId))
        }

    @Test
    fun recordsTheRenderedRevisionAndAMonotonicSeqPerTap() =
        runTest {
            val glanceId = AppWidgetId(72_006)
            interactResult = { """{"handled":true,"state":{"count":1}}""" }

            interaction.onAction(context, glanceId, tap(componentId = "inc", checked = null, renderedRevision = 5L))
            interactResult = { """{"handled":true,"state":{"count":2}}""" }
            interaction.onAction(context, glanceId, tap(componentId = "inc", checked = null, renderedRevision = 6L))

            val reported = drainedEvents()
            assertEquals(listOf(5L, 6L), reported.map { it["renderedRevision"]!!.jsonPrimitive.long })
            assertEquals(listOf(1L, 2L), reported.map { it["stateRevision"]!!.jsonPrimitive.long })
            val seqs = reported.map { it["seq"]!!.jsonPrimitive.long }
            assertEquals(seqs[0] + 1, seqs[1])
            assertEquals(listOf("button", "button"), reported.map { it["componentType"]!!.jsonPrimitive.content })
            assertEquals(listOf(JsonNull, JsonNull), reported.map { it["checked"] })
            assertEquals(2, reported.map { it["eventId"]!!.jsonPrimitive.content }.toSet().size)
            assertEquals(2, updates.size)
        }

    @Test
    fun aTapWithoutAWidgetIdIsIgnored() =
        runTest {
            interaction.onAction(context, AppWidgetId(72_007), actionParametersOf())

            assertTrue(updates.isEmpty())
            assertTrue(drainedEvents().isEmpty())
        }

    private fun tap(
        componentId: String,
        checked: Boolean?,
        stateKey: String = "",
        renderedRevision: Long = 0L,
    ): ActionParameters {
        val pairs =
            mutableListOf<ActionParameters.Pair<out Any>>(
                DynamicWidgetStateActionCallback.KEY_WIDGET_ID to widgetId,
                DynamicWidgetStateActionCallback.KEY_COMPONENT_ID to componentId,
                DynamicWidgetStateActionCallback.KEY_COMPONENT_TYPE to if (checked == null) "button" else "checkbox",
                DynamicWidgetStateActionCallback.KEY_STATE_KEY to stateKey,
                DynamicWidgetStateActionCallback.KEY_RENDERED_REVISION to renderedRevision,
            )
        if (checked != null) pairs += ToggleableStateKey to checked
        return actionParametersOf(*pairs.toTypedArray())
    }

    private fun drainedEvents(): List<JsonObject> = Json.parseToJsonElement(events.drain()).jsonArray.map { it.jsonObject }

    private suspend fun propsRevision(glanceId: AppWidgetId): Long =
        getAppWidgetState(context, PreferencesGlanceStateDefinition, glanceId)[dynamicWidgetPropsRevisionKey] ?: 0L

    private fun assertJsonEquals(
        expected: String,
        actual: String,
    ) = assertEquals(Json.parseToJsonElement(expected), Json.parseToJsonElement(actual))
}
