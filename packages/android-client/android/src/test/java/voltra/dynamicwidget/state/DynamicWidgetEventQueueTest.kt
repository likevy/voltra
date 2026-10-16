package voltra.dynamicwidget.state

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/** PoC for issue #343: the persisted interaction event queue the app drains. */
@RunWith(RobolectricTestRunner::class)
class DynamicWidgetEventQueueTest {
    private val context = RuntimeEnvironment.getApplication()
    private lateinit var queue: DynamicWidgetEventQueue

    @Before
    fun setUp() {
        queue = DynamicWidgetEventQueue(context)
        queue.drain()
    }

    @Test
    fun drainsEventsInAppendOrderWithMonotonicSeq() {
        val seqs = listOf("t1", "t2", "t3").map { id -> queue.append(JSONObject().put("identifier", id)) }

        val drained = Json.parseToJsonElement(queue.drain()).jsonArray

        assertEquals(listOf("t1", "t2", "t3"), drained.map { it.jsonObject["identifier"]!!.jsonPrimitive.content })
        assertEquals(seqs, drained.map { it.jsonObject["seq"]!!.jsonPrimitive.long })
        assertEquals(listOf(seqs[0], seqs[0] + 1, seqs[0] + 2), seqs)
    }

    @Test
    fun drainEmptiesTheQueueButSeqKeepsCounting() {
        val before = queue.append(JSONObject().put("identifier", "a"))
        queue.drain()

        assertEquals("[]", queue.drain())

        val after = queue.append(JSONObject().put("identifier", "b"))
        assertEquals(before + 1, after)
        assertEquals(1, Json.parseToJsonElement(queue.drain()).jsonArray.size)
    }

    @Test
    fun seqSurvivesANewQueueInstance() {
        val first = queue.append(JSONObject().put("identifier", "a"))
        val second = DynamicWidgetEventQueue(context).append(JSONObject().put("identifier", "b"))

        assertEquals(first + 1, second)
        assertEquals(2, Json.parseToJsonElement(queue.peek()).jsonArray.size)
    }

    @Test
    fun keepsOnlyTheNewestEventsBeyondCapacity() {
        repeat(DynamicWidgetEventQueue.MAX_QUEUED_EVENTS + 3) { index ->
            queue.append(JSONObject().put("identifier", "e$index"))
        }

        val drained = Json.parseToJsonElement(queue.drain()).jsonArray

        assertEquals(DynamicWidgetEventQueue.MAX_QUEUED_EVENTS, drained.size)
        assertEquals("e3", drained.first().jsonObject["identifier"]!!.jsonPrimitive.content)
    }
}
