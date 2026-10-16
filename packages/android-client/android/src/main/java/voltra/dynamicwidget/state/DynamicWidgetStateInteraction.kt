package voltra.dynamicwidget.state

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.action.ToggleableStateKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONException
import org.json.JSONObject
import voltra.dynamicwidget.DynamicWidgetInstanceSizes
import voltra.dynamicwidget.DynamicWidgetPropsStore
import voltra.dynamicwidget.VoltraClientGlanceWidget
import voltra.dynamicwidget.VoltraConfigurationStore
import voltra.dynamicwidget.VoltraJSRenderer
import voltra.widget.VoltraWidgetReceiver
import voltra.widget.server.WidgetCanonicalConfiguration
import voltra.widget.server.WidgetScope
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * What one tap on an interactive control does to the widget state record.
 *
 * 1. Resolve the placement, its configuration, its scope and its props.
 * 2. Under a lock per placement (or per scope when the scope store is selected), read the current
 *    record and decide the next one:
 *    - a control with a `stateKey` and a toggle value (option D) writes `state[stateKey] = checked`
 *      without running any JS;
 *    - otherwise the widget bundle is evaluated if needed and the generated entry's `interact`
 *      export runs the author's `onInteraction(event, { props, state, env })`, or, when the widget
 *      has none, replays the render at the tapped size so the tapped element's inline
 *      `onCheckedChange` / `onPress` calls its `useVoltraStateTuple` setters (`via=replay`); a
 *      returned `{ state: patch }` is shallow-merged into the record (top-level keys replaced),
 *      and an unhandled tap, a throw or no patch writes nothing.
 * 3. Commit the record and its revision bump in one transaction, then append an event for the app.
 * 4. Always call `update()` on the placement, also when nothing was written or something failed:
 *    on API 31+ the launcher already flipped the tapped box, and only a render puts it back to the
 *    committed value.
 *
 * Every boundary is injected so the flow is testable without Hermes, Glance sessions or the
 * configuration DataStore (the same pattern as `DynamicWidgetUpdater`).
 *
 * PoC for issue #343; not API.
 */
internal class DynamicWidgetStateInteraction(
    private val ensureBundle: suspend (Context, String) -> Boolean = { context, widgetId ->
        VoltraClientGlanceWidget.ensureBundleEvaluated(context, widgetId)
    },
    private val invoke: (String, String, String) -> String? = { widgetId, exportName, payloadJson ->
        VoltraJSRenderer.invoke(widgetId, exportName, payloadJson)
    },
    private val update: suspend (Context, String, GlanceId) -> Unit = ::updateDynamicWidgetPlacement,
    private val resolveAppWidgetId: suspend (Context, GlanceId) -> Int? = { context, glanceId ->
        GlanceAppWidgetManager(context).getAppWidgetId(glanceId)
    },
    private val readConfiguration: suspend (Context, String, Int?) -> Map<String, String> = { context, widgetId, appWidgetId ->
        VoltraConfigurationStore(context).get(widgetId, appWidgetId)
    },
    private val readProps: (Context, WidgetScope) -> String = { context, scope ->
        DynamicWidgetPropsStore(context).getDynamicWidgetProps(scope)
    },
    private val buildEnv: (Context, String, Map<String, String>, DpSize?) -> String = ::interactionEnvJson,
    private val readFlags: (Context) -> DynamicWidgetStateFlagValues = DynamicWidgetStateFlags::read,
    private val scopeStore: (Context) -> DynamicWidgetScopeStateStore = { context -> DynamicWidgetScopeStateStore(context) },
    private val eventSink: (Context) -> DynamicWidgetEventSink = { context -> DynamicWidgetEventQueue(context) },
    private val now: () -> Long = System::currentTimeMillis,
    private val elapsed: () -> Long = SystemClock::elapsedRealtime,
) {
    suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        val start = elapsed()
        val widgetId = parameters[DynamicWidgetStateActionCallback.KEY_WIDGET_ID]
        if (widgetId == null) {
            Log.e(TAG, "No widget id in the state action parameters; ignoring the tap")
            return
        }
        val tap =
            Tap(
                componentId = parameters[DynamicWidgetStateActionCallback.KEY_COMPONENT_ID].orEmpty(),
                componentType = parameters[DynamicWidgetStateActionCallback.KEY_COMPONENT_TYPE] ?: "button",
                stateKey = parameters[DynamicWidgetStateActionCallback.KEY_STATE_KEY].orEmpty(),
                renderedRevision = parameters[DynamicWidgetStateActionCallback.KEY_RENDERED_REVISION] ?: 0L,
                // Absolute on API 31+ (the value the host already flipped to); null for buttons.
                checked = parameters[ToggleableStateKey],
                size =
                    tappedSize(
                        parameters[DynamicWidgetStateActionCallback.KEY_WIDTH_DP],
                        parameters[DynamicWidgetStateActionCallback.KEY_HEIGHT_DP],
                    ),
            )
        Log.d(
            TAG,
            "callback entered widgetId=$widgetId componentId=${tap.componentId} componentType=${tap.componentType} " +
                "checked=${tap.checked} stateKey=${tap.stateKey.ifEmpty { "-" }} renderedRevision=${tap.renderedRevision} " +
                "size=${tap.size?.let(::formatSize) ?: "-"} thread=${Thread.currentThread().name}",
        )

        try {
            handle(context, glanceId, widgetId, tap, start)
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (failure: Throwable) {
            Log.e(TAG, "Tap on '$widgetId'/${tap.componentId} failed: ${failure.message}", failure)
        } finally {
            val updateStart = elapsed()
            try {
                update(context, widgetId, glanceId)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (failure: Throwable) {
                Log.e(TAG, "update() after a tap on '$widgetId' failed: ${failure.message}", failure)
            }
            Log.d(
                TAG,
                "update returned widgetId=$widgetId ms=${elapsed() - updateStart} totalMs=${elapsed() - start}",
            )
        }
    }

    private suspend fun handle(
        context: Context,
        glanceId: GlanceId,
        widgetId: String,
        tap: Tap,
        start: Long,
    ) {
        val appWidgetId =
            try {
                resolveAppWidgetId(context, glanceId)
            } catch (e: Exception) {
                Log.w(TAG, "Could not resolve the appWidgetId for '$widgetId': ${e.message}")
                null
            }
        val configuration = readConfiguration(context, widgetId, appWidgetId)
        val scope = VoltraClientGlanceWidget.placementScope(widgetId, configuration, appWidgetId)
        val flags = readFlags(context)
        val lockKey =
            when (flags.storage) {
                DynamicWidgetStateStorage.PLACEMENT -> "placement:$widgetId:${appWidgetId ?: glanceId}"
                DynamicWidgetStateStorage.WIDGET_SCOPE -> "scope:${scope.storageKey}"
            }

        lockFor(lockKey).withLock {
            val current =
                when (flags.storage) {
                    DynamicWidgetStateStorage.PLACEMENT -> DynamicWidgetStateStore.readPlacementSnapshot(context, glanceId)
                    DynamicWidgetStateStorage.WIDGET_SCOPE -> scopeStore(context).read(scope)
                }
            val currentState = parseObject(current.stateJson)
            val decision = decide(context, widgetId, tap, configuration, scope, currentState)

            if (flags.interactDelayMs > 0L) {
                delay(flags.interactDelayMs)
            }

            val commitStart = elapsed()
            val nextState = decision.nextState
            val stateRevision =
                when {
                    nextState == null -> {
                        current.stateRevision
                    }

                    flags.storage == DynamicWidgetStateStorage.PLACEMENT -> {
                        DynamicWidgetStateStore.commitPlacementState(context, glanceId, nextState.toString())
                    }

                    else -> {
                        scopeStore(context).commit(scope, nextState.toString())
                    }
                }
            Log.d(
                TAG,
                "commit widgetId=$widgetId appWidgetId=$appWidgetId storage=${flags.storage.wireName} " +
                    "wrote=${nextState != null} handled=${decision.handled} via=${decision.via} " +
                    "stateRevision=$stateRevision renderedRevision=${tap.renderedRevision} " +
                    "ms=${elapsed() - commitStart} sinceTapMs=${elapsed() - start}",
            )

            val event =
                JSONObject()
                    .put("type", "interaction")
                    .put("source", "widget")
                    .put("widgetId", widgetId)
                    .put("identifier", tap.componentId)
                    .put("componentType", tap.componentType)
                    .put("checked", tap.checked ?: JSONObject.NULL)
                    .put("appWidgetId", appWidgetId ?: JSONObject.NULL)
                    .put("instance", WidgetCanonicalConfiguration.key(configuration) ?: JSONObject.NULL)
                    .put("eventId", UUID.randomUUID().toString())
                    .put("timestamp", now())
                    .put("handledInWidget", decision.handled)
                    .put("stateRevision", stateRevision)
                    .put("renderedRevision", tap.renderedRevision)
                    .put("stateChange", decision.stateChange ?: JSONObject.NULL)
            val seq = eventSink(context).append(event)
            Log.d(TAG, "event appended widgetId=$widgetId seq=$seq handledInWidget=${decision.handled}")
        }
    }

    private suspend fun decide(
        context: Context,
        widgetId: String,
        tap: Tap,
        configuration: Map<String, String>,
        scope: WidgetScope,
        currentState: JSONObject,
    ): Decision {
        // Option D: the control names the key it writes, so the toggle value needs no JS at all.
        if (tap.stateKey.isNotEmpty() && tap.checked != null) {
            val next = copyOf(currentState).put(tap.stateKey, tap.checked)
            val change =
                JSONObject()
                    .put("key", tap.stateKey)
                    .put("from", currentState.opt(tap.stateKey) ?: JSONObject.NULL)
                    .put("to", tap.checked)
            return Decision(nextState = next, handled = true, via = "stateKey", stateChange = change)
        }

        val bundleStart = elapsed()
        val bundleReady =
            try {
                ensureBundle(context, widgetId)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (failure: Throwable) {
                Log.e(TAG, "Evaluating the bundle of '$widgetId' threw: ${failure.message}", failure)
                false
            }
        Log.d(TAG, "bundle widgetId=$widgetId ready=$bundleReady ms=${elapsed() - bundleStart}")
        if (!bundleReady) {
            return Decision.unhandled("noBundle")
        }

        val payload =
            JSONObject()
                .put(
                    "event",
                    JSONObject()
                        .put("componentId", tap.componentId)
                        .put("componentType", tap.componentType)
                        .put("value", tap.checked ?: JSONObject.NULL)
                        .put("renderedRevision", tap.renderedRevision)
                        .put("stateKey", tap.stateKey.ifEmpty { null } ?: JSONObject.NULL)
                        .put("timestamp", now()),
                ).put("props", parseObject(readProps(context, scope)))
                .put("state", currentState)
                .put("env", parseObject(buildEnv(context, widgetId, configuration, tap.size)))

        val interactStart = elapsed()
        val raw =
            try {
                invoke(widgetId, INTERACT_EXPORT, payload.toString())
            } catch (failure: Throwable) {
                Log.e(TAG, "interact for '$widgetId' threw: ${failure.message}", failure)
                null
            }
        val interactMs = elapsed() - interactStart
        // Null: no `interact` export (a bundle from before it existed), a JS throw (including an
        // async onInteraction), or a non-string result. All of them leave the record untouched.
        if (raw == null) {
            Log.d(TAG, "interact widgetId=$widgetId ms=$interactMs returned=false")
            return Decision.unhandled("interactFailed")
        }

        val result =
            try {
                JSONObject(raw)
            } catch (_: JSONException) {
                Log.d(TAG, "interact widgetId=$widgetId ms=$interactMs returned=true")
                Log.e(TAG, "interact for '$widgetId' returned something other than a JSON object")
                return Decision.unhandled("interactFailed")
            }
        val handled = result.optBoolean("handled", false)
        val patch = result.optJSONObject("state")
        // The inline-setter replay (no `onInteraction` export) reports how long the replay render
        // took and why it did not call a handler; `onInteraction` reports neither.
        val via = if (result.has("replayMs")) "replay" else "onInteraction"
        val replayMs = if (result.has("replayMs")) result.optLong("replayMs").toString() else "-"
        val warnings = result.optJSONArray("warnings")?.toString() ?: "[]"
        Log.d(
            TAG,
            "interact widgetId=$widgetId ms=$interactMs returned=true via=$via handled=$handled " +
                "replayMs=$replayMs warnings=$warnings",
        )
        if (!handled || patch == null) {
            return Decision(nextState = null, handled = handled, via = via, stateChange = null)
        }

        val next = copyOf(currentState)
        val keys = patch.keys().asSequence().toList()
        keys.forEach { key -> next.put(key, patch.get(key)) }

        return Decision(
            nextState = next,
            handled = true,
            via = via,
            stateChange = stateChangeOf(currentState, patch, keys),
        )
    }

    private data class Tap(
        val componentId: String,
        val componentType: String,
        val stateKey: String,
        val renderedRevision: Long,
        val checked: Boolean?,
        /** The size the tapped tree was drawn at, or null when the action carried none. */
        val size: DpSize?,
    )

    private data class Decision(
        /** The record to commit, or null to write nothing. */
        val nextState: JSONObject?,
        val handled: Boolean,
        val via: String,
        val stateChange: JSONObject?,
    ) {
        companion object {
            fun unhandled(via: String) = Decision(nextState = null, handled = false, via = via, stateChange = null)
        }
    }

    companion object {
        const val TAG = "DynamicWidgetState"
        private const val INTERACT_EXPORT = "interact"

        private val locks = ConcurrentHashMap<String, Mutex>()

        private fun lockFor(key: String): Mutex = locks.getOrPut(key) { Mutex() }
    }
}

/** `{ key, from, to }` for a one-key patch; `{ from: {…}, to: {…} }` over the patched keys otherwise. */
private fun stateChangeOf(
    currentState: JSONObject,
    patch: JSONObject,
    keys: List<String>,
): JSONObject? {
    if (keys.isEmpty()) return null
    if (keys.size == 1) {
        val key = keys.single()
        return JSONObject()
            .put("key", key)
            .put("from", currentState.opt(key) ?: JSONObject.NULL)
            .put("to", patch.get(key))
    }
    val from = JSONObject()
    keys.forEach { key -> from.put(key, currentState.opt(key) ?: JSONObject.NULL) }
    return JSONObject().put("from", from).put("to", patch)
}

private fun parseObject(json: String): JSONObject =
    try {
        JSONObject(json)
    } catch (_: JSONException) {
        JSONObject()
    }

private fun copyOf(state: JSONObject): JSONObject = JSONObject(state.toString())

/** The tapped size from the action parameters, or null unless both edges are present and positive. */
private fun tappedSize(
    widthDp: Float?,
    heightDp: Float?,
): DpSize? =
    if (widthDp != null && heightDp != null && widthDp > 0f && heightDp > 0f) {
        DpSize(widthDp.dp, heightDp.dp)
    } else {
        null
    }

private fun formatSize(size: DpSize): String = "${size.width.value}x${size.height.value}"

/**
 * The env `onInteraction` and the inline-setter replay see: the real theme, locale and
 * configuration, without `__voltraState` (state travels as its own payload field) and without
 * server-update fields. The size is the one the tapped tree was drawn at when the action carried
 * it, so the replay renders the layout that was tapped; otherwise the smallest placed size, as the
 * server-fetch trial render picks it.
 */
private fun interactionEnvJson(
    context: Context,
    widgetId: String,
    configuration: Map<String, String>,
    tappedSize: DpSize?,
): String {
    val smallest = if (tappedSize == null) DynamicWidgetInstanceSizes.smallestPlacedSize(context, widgetId) else null
    val size = tappedSize ?: smallest ?: DpSize(FALLBACK_ENV_WIDTH_DP.dp, FALLBACK_ENV_HEIGHT_DP.dp)
    val source =
        when {
            tappedSize != null -> "tapped"
            smallest != null -> "smallestPlaced"
            else -> "fallback"
        }
    Log.d(DynamicWidgetStateInteraction.TAG, "interact env widgetId=$widgetId size=${formatSize(size)} source=$source")
    return VoltraClientGlanceWidget.buildEnvJson(
        context = context,
        widgetId = widgetId,
        size = size,
        configuration = configuration,
        environmentSource = null,
    )
}

private const val FALLBACK_ENV_WIDTH_DP = 180
private const val FALLBACK_ENV_HEIGHT_DP = 110

private suspend fun updateDynamicWidgetPlacement(
    context: Context,
    widgetId: String,
    glanceId: GlanceId,
) {
    val widget =
        checkNotNull(VoltraWidgetReceiver.getWidget(context, widgetId)) {
            "No registered Glance widget for '$widgetId'"
        }
    widget.update(context, glanceId)
}
