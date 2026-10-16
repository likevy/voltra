package voltra.dynamicwidget.state

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback

/**
 * The tap of a CheckBox, Switch or FilledButton with an author `id` inside a Dynamic Widget (see
 * [dynamicWidgetStateActionOrDefault]). Runs in the app process under Glance's `goAsync`, with no
 * Activity and no React Native runtime, and hands the work to [DynamicWidgetStateInteraction].
 *
 * Glance writes this class name into the `RemoteViews` the launcher holds for a placed widget, so a
 * shipped build would pin its name and package.
 *
 * PoC for issue #343; not API.
 */
class DynamicWidgetStateActionCallback : ActionCallback {
    override suspend fun onAction(
        context: Context,
        glanceId: GlanceId,
        parameters: ActionParameters,
    ) {
        DynamicWidgetStateInteraction().onAction(context, glanceId, parameters)
    }

    companion object {
        val KEY_WIDGET_ID = ActionParameters.Key<String>("voltra_state_widget_id")
        val KEY_COMPONENT_ID = ActionParameters.Key<String>("voltra_state_component_id")

        /** `checkbox`, `switch` or `button`. */
        val KEY_COMPONENT_TYPE = ActionParameters.Key<String>("voltra_state_component_type")

        /** The control's `stateKey` prop (option D), or an empty string when it has none. */
        val KEY_STATE_KEY = ActionParameters.Key<String>("voltra_state_key")

        /** The state revision of the tree the tap was drawn in. */
        val KEY_RENDERED_REVISION = ActionParameters.Key<Long>("voltra_state_rendered_revision")
    }
}
