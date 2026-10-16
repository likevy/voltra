package voltra.dynamicwidget.state

import android.content.Context
import android.content.SharedPreferences
import androidx.glance.GlanceId
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONException
import org.json.JSONObject
import voltra.dynamicwidget.dynamicWidgetPropsRevisionKey
import voltra.dynamicwidget.dynamicWidgetStateKey
import voltra.dynamicwidget.dynamicWidgetStateRevisionKey
import voltra.dynamicwidget.triggerDynamicWidgetGlanceUpdate
import voltra.widget.server.WidgetScope
import java.util.concurrent.ConcurrentHashMap

/**
 * One widget state record as stored: a JSON object and the revision it was committed at.
 *
 * PoC for issue #343; not API.
 */
internal data class DynamicWidgetStateSnapshot(
    val stateJson: String,
    val stateRevision: Long,
)

internal const val EMPTY_DYNAMIC_WIDGET_STATE_JSON = "{}"

/**
 * The widget state record of one placement (`useVoltraState`), kept in that placement's Glance
 * state next to the props revision. Deleted with the placement, not remapped on launcher restore,
 * and not cleared by `clearAndroidWidget` (Glance owns the file).
 *
 * Every commit writes the record, advances its revision and advances the props revision in one
 * `updateAppWidgetState` transaction, so a live Glance session recomposes with the new record and
 * never sees one without the other.
 *
 * PoC for issue #343; not API.
 */
internal object DynamicWidgetStateStore {
    /** The record as a JSON object text, `{}` when nothing was committed yet. */
    suspend fun readPlacementState(
        context: Context,
        glanceId: GlanceId,
    ): String = readPlacementSnapshot(context, glanceId).stateJson

    suspend fun readPlacementSnapshot(
        context: Context,
        glanceId: GlanceId,
    ): DynamicWidgetStateSnapshot {
        val preferences = getAppWidgetState(context, PreferencesGlanceStateDefinition, glanceId)

        return DynamicWidgetStateSnapshot(
            stateJson = preferences[dynamicWidgetStateKey] ?: EMPTY_DYNAMIC_WIDGET_STATE_JSON,
            stateRevision = preferences[dynamicWidgetStateRevisionKey] ?: 0L,
        )
    }

    /**
     * Replace the record with [nextStateJson] and return the new state revision. The props revision
     * advances in the same transaction so the next `update()` recomposes a live session.
     */
    suspend fun commitPlacementState(
        context: Context,
        glanceId: GlanceId,
        nextStateJson: String,
    ): Long {
        val normalized = normalizeStateJson(nextStateJson)
        var nextRevision = 0L
        updateAppWidgetState(context, glanceId) { preferences ->
            nextRevision = (preferences[dynamicWidgetStateRevisionKey] ?: 0L) + 1L
            preferences[dynamicWidgetStateKey] = normalized
            preferences[dynamicWidgetStateRevisionKey] = nextRevision
            preferences[dynamicWidgetPropsRevisionKey] = (preferences[dynamicWidgetPropsRevisionKey] ?: 0L) + 1L
        }
        return nextRevision
    }

    /**
     * Drop the record. The revisions still advance, so a tap drawn before the reset is recognisably
     * stale and a live session recomposes without the old record.
     */
    suspend fun resetPlacementState(
        context: Context,
        glanceId: GlanceId,
    ) {
        updateAppWidgetState(context, glanceId) { preferences ->
            preferences.remove(dynamicWidgetStateKey)
            preferences[dynamicWidgetStateRevisionKey] = (preferences[dynamicWidgetStateRevisionKey] ?: 0L) + 1L
            preferences[dynamicWidgetPropsRevisionKey] = (preferences[dynamicWidgetPropsRevisionKey] ?: 0L) + 1L
        }
    }
}

/**
 * The per-[WidgetScope] variant of [DynamicWidgetStateStore], selected by
 * [DynamicWidgetStateFlags]: one record per `WidgetScope.storageKey` in SharedPreferences, so
 * placements with identical merged configuration share state (the iOS model, where WidgetKit
 * exposes no placement id).
 *
 * Writes for one key are serialised by a process-wide [Mutex]. After a commit or reset every
 * placement of the widget gets its props revision advanced and is updated through the Dynamic
 * Widget Glance update coordinator, because a placement's Glance state does not change when this
 * store does and would otherwise keep drawing the old record.
 *
 * PoC for issue #343; not API.
 */
internal class DynamicWidgetScopeStateStore(
    private val context: Context,
    private val afterWrite: suspend (Context, String) -> Unit = { writeContext, dynamicWidgetId ->
        triggerDynamicWidgetGlanceUpdate(writeContext, dynamicWidgetId)
    },
) {
    private val preferences: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun read(scope: WidgetScope): DynamicWidgetStateSnapshot {
        val raw = preferences.getString(scope.storageKey, null) ?: return emptySnapshot()

        return try {
            val entry = JSONObject(raw)
            DynamicWidgetStateSnapshot(
                stateJson = entry.optJSONObject(STATE_FIELD)?.toString() ?: EMPTY_DYNAMIC_WIDGET_STATE_JSON,
                stateRevision = entry.optLong(REVISION_FIELD, 0L),
            )
        } catch (_: JSONException) {
            emptySnapshot()
        }
    }

    /** Replace the record of [scope] and return its new revision. */
    suspend fun commit(
        scope: WidgetScope,
        nextStateJson: String,
    ): Long {
        val nextRevision =
            lockFor(scope.storageKey).withLock {
                val revision = read(scope).stateRevision + 1L
                val entry =
                    JSONObject()
                        .put(STATE_FIELD, JSONObject(normalizeStateJson(nextStateJson)))
                        .put(REVISION_FIELD, revision)
                check(preferences.edit().putString(scope.storageKey, entry.toString()).commit()) {
                    "Failed to persist Dynamic Widget state for key=${scope.storageKey}"
                }
                revision
            }
        afterWrite(context, scope.widgetId)
        return nextRevision
    }

    /** Drop the record of [scope]; the revision still advances, as in the placement store. */
    suspend fun reset(scope: WidgetScope) {
        lockFor(scope.storageKey).withLock {
            val entry =
                JSONObject()
                    .put(STATE_FIELD, JSONObject())
                    .put(REVISION_FIELD, read(scope).stateRevision + 1L)
            check(preferences.edit().putString(scope.storageKey, entry.toString()).commit()) {
                "Failed to reset Dynamic Widget state for key=${scope.storageKey}"
            }
        }
        afterWrite(context, scope.widgetId)
    }

    /**
     * Drop every record of [dynamicWidgetId] (the widget scope and all its instance scopes) without
     * re-rendering. For callers that re-render the widget themselves, such as a props push.
     */
    fun clearWidget(dynamicWidgetId: String) {
        val editor = preferences.edit()
        preferences.all.keys
            .filter { key -> key == dynamicWidgetId || key.startsWith("$dynamicWidgetId#") }
            .forEach { key -> editor.remove(key) }
        check(editor.commit()) { "Failed to clear Dynamic Widget state for $dynamicWidgetId" }
    }

    private fun emptySnapshot() = DynamicWidgetStateSnapshot(EMPTY_DYNAMIC_WIDGET_STATE_JSON, 0L)

    companion object {
        const val PREFERENCES_NAME = "voltra_dynamic_widget_state"
        private const val STATE_FIELD = "state"
        private const val REVISION_FIELD = "revision"

        private val locks = ConcurrentHashMap<String, Mutex>()

        private fun lockFor(storageKey: String): Mutex = locks.getOrPut(storageKey) { Mutex() }
    }
}

/** A record is always a JSON object; anything else is stored as `{}` rather than failing a tap. */
internal fun normalizeStateJson(stateJson: String): String =
    try {
        JSONObject(stateJson).toString()
    } catch (_: JSONException) {
        EMPTY_DYNAMIC_WIDGET_STATE_JSON
    }
