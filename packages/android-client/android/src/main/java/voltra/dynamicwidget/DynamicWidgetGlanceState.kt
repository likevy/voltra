package voltra.dynamicwidget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.currentState
import kotlinx.coroutines.runBlocking
import voltra.dynamicwidget.state.DynamicWidgetScopeStateStore
import voltra.dynamicwidget.state.DynamicWidgetStateFlags
import voltra.dynamicwidget.state.DynamicWidgetStateSnapshot
import voltra.dynamicwidget.state.DynamicWidgetStateStorage
import voltra.widget.server.WidgetScope

internal val dynamicWidgetPropsRevisionKey =
    longPreferencesKey("voltra.dynamic_widget.props_revision")

// The props revision is also what an environment-only reload advances (a locale or colour-scheme
// change, `setDynamicWidgetLocale`): the render reads `env` on every composition, so any key that
// forces a recomposition of a live session re-runs it. See `WidgetOrchestrator.reloadClientWidgets`.

/**
 * Bumped whenever the app writes configuration, for the same reason the props revision exists.
 *
 * `GlanceAppWidget.update` on a widget with a live session only reloads Glance state and
 * recomposes; it does not re-run `provideGlance`. A configuration value read in `provideGlance` and
 * captured by the `provideContent` lambda is therefore frozen for the life of the session, so a
 * write stayed invisible until the session idled out (~10-13 s after the last render) and the next
 * update re-ran `provideGlance`. Making the configuration depend on this key moves the read into
 * the composition, where a bump forces it to happen again.
 */
internal val dynamicWidgetConfigurationRevisionKey =
    longPreferencesKey("voltra.dynamic_widget.configuration_revision")

/**
 * The placement's widget state record (`useVoltraState`), a JSON object, written only by the tap
 * callback and never by a render or a props push. Handed into every render as `env.__voltraState`.
 *
 * PoC for issue #343; not API.
 */
internal val dynamicWidgetStateKey = stringPreferencesKey("voltra.dynamic_widget.state")

/**
 * Advanced together with [dynamicWidgetStateKey] in the same Glance-state transaction. A tap
 * carries the revision it was rendered with, so the callback can tell a stale tree from a fresh one.
 *
 * PoC for issue #343; not API.
 */
internal val dynamicWidgetStateRevisionKey = longPreferencesKey("voltra.dynamic_widget.state_revision")

/**
 * Connects Glance's observable per-instance state to the authoritative SharedPreferences props.
 * The revision causes recomposition; the props store supplies the latest value when updates coalesce.
 *
 * The widget state record comes from the placement's Glance state by default, or from the
 * per-scope store when the PoC flag selects it (issue #343). Both state keys are read on every
 * composition, so a commit to either recomposes a live session.
 */
@Composable
internal fun currentDynamicWidgetRenderInput(
    context: Context,
    dynamicWidgetId: String,
    scope: WidgetScope = WidgetScope.of(dynamicWidgetId),
): DynamicWidgetRenderInput {
    val propsRevision = currentState(dynamicWidgetPropsRevisionKey) ?: 0L
    val placementStateJson = currentState(dynamicWidgetStateKey)
    val placementStateRevision = currentState(dynamicWidgetStateRevisionKey) ?: 0L
    val state =
        when (DynamicWidgetStateFlags.read(context).storage) {
            DynamicWidgetStateStorage.PLACEMENT -> {
                DynamicWidgetStateSnapshot(placementStateJson ?: "{}", placementStateRevision)
            }

            DynamicWidgetStateStorage.WIDGET_SCOPE -> {
                DynamicWidgetScopeStateStore(context).read(scope)
            }
        }

    return DynamicWidgetRenderInput(
        propsRevision = propsRevision,
        // Reads the instance slot for `scope`'s key, falling back to the widget slot when the
        // placement has not fetched yet or has no configuration (ADR 0007).
        propsJson = DynamicWidgetPropsStore(context).getDynamicWidgetProps(scope),
        stateJson = state.stateJson,
        stateRevision = state.stateRevision,
    )
}

/**
 * The configuration this composition renders with, re-read whenever
 * [dynamicWidgetConfigurationRevisionKey] advances.
 *
 * [initialConfiguration] is what `provideGlance` already read off the composition, so the first
 * composition of a session costs no blocking read. Only a revision bump seen *during* a session
 * triggers a re-read; that read runs on Glance's background session thread, and the DataStore is
 * memory-cached after its first load, so blocking there is cheap.
 */
@Composable
internal fun currentDynamicWidgetConfiguration(
    context: Context,
    dynamicWidgetId: String,
    dynamicWidgetAppWidgetId: Int?,
    initialConfiguration: Map<String, String>,
): Map<String, String> {
    val configurationRevision = currentState(dynamicWidgetConfigurationRevisionKey) ?: 0L
    // The revision as it stood when this composition began; captured once, so it survives
    // recomposition while the session lives.
    val initialConfigurationRevision = remember { configurationRevision }

    return remember(configurationRevision) {
        if (configurationRevision == initialConfigurationRevision) {
            initialConfiguration
        } else {
            runBlocking {
                VoltraConfigurationStore(context).get(dynamicWidgetId, dynamicWidgetAppWidgetId)
            }
        }
    }
}
