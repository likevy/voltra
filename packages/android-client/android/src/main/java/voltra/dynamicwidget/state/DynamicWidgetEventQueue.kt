package voltra.dynamicwidget.state

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Where the tap callback reports what happened, so the app can learn about taps it never saw.
 *
 * PoC for issue #343; not API.
 */
internal fun interface DynamicWidgetEventSink {
    /** Append [event], stamping it with the next `seq`; returns that `seq`. */
    fun append(event: JSONObject): Long
}

/**
 * A persisted FIFO of widget interaction events in SharedPreferences `voltra_dynamic_widget_events`:
 * key `queue` holds a JSON array, key `seq` the last sequence number handed out. Every append and
 * drain is one `commit()` under a process-wide lock, so `seq` is strictly increasing across
 * process deaths and a drain never loses an event appended concurrently.
 *
 * The app drains it through `drainAndroidDynamicWidgetEvents()`. There is no live delivery: an
 * app in the foreground sees taps only when it drains (the #314 event channel would add that).
 *
 * PoC for issue #343; not API.
 */
internal class DynamicWidgetEventQueue(
    context: Context,
) : DynamicWidgetEventSink {
    private val preferences: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    override fun append(event: JSONObject): Long =
        synchronized(lock) {
            val seq = preferences.getLong(SEQ_KEY, 0L) + 1L
            val queue = readQueue()
            queue.put(event.put("seq", seq))
            val trimmed = trimToCapacity(queue)
            check(
                preferences
                    .edit()
                    .putString(QUEUE_KEY, trimmed.toString())
                    .putLong(SEQ_KEY, seq)
                    .commit(),
            ) { "Failed to persist Dynamic Widget event seq=$seq" }
            seq
        }

    /** Every queued event in append order, as a JSON array text; the queue is empty afterwards. */
    fun drain(): String =
        synchronized(lock) {
            val queue = readQueue()
            check(preferences.edit().remove(QUEUE_KEY).commit()) { "Failed to drain Dynamic Widget events" }
            queue.toString()
        }

    /** The queued events without removing them. */
    fun peek(): String = synchronized(lock) { readQueue().toString() }

    private fun readQueue(): JSONArray {
        val raw = preferences.getString(QUEUE_KEY, null) ?: return JSONArray()
        return try {
            JSONArray(raw)
        } catch (_: JSONException) {
            JSONArray()
        }
    }

    /** Keeps the newest [MAX_QUEUED_EVENTS]; the dropped ones show up as a gap in `seq`. */
    private fun trimToCapacity(queue: JSONArray): JSONArray {
        if (queue.length() <= MAX_QUEUED_EVENTS) return queue
        val trimmed = JSONArray()
        for (index in queue.length() - MAX_QUEUED_EVENTS until queue.length()) {
            trimmed.put(queue.get(index))
        }
        return trimmed
    }

    companion object {
        const val PREFERENCES_NAME = "voltra_dynamic_widget_events"
        const val QUEUE_KEY = "queue"
        const val SEQ_KEY = "seq"
        const val MAX_QUEUED_EVENTS = 500

        private val lock = Any()
    }
}
