package voltra.dynamicwidget.state

import android.appwidget.AppWidgetManager
import android.content.Context
import android.util.Log
import androidx.glance.appwidget.GlanceAppWidgetManager
import voltra.dynamicwidget.DynamicWidgetPushStateReset
import voltra.widget.VoltraWidgetReceivers

/**
 * The `resetOnPush` precedence (see [DynamicWidgetStateFlags]): when the flag is set, a props push
 * clears the state record of every placement of the widget, and every scope record of it, before
 * the push re-renders them. With the default `survive` it does nothing, so a push keeps every
 * record as it was.
 *
 * PoC for issue #343; not API.
 */
internal class AndroidDynamicWidgetPushStateReset(
    private val context: Context,
) : DynamicWidgetPushStateReset {
    override suspend fun afterDynamicWidgetPropsPersisted(dynamicWidgetId: String) {
        if (DynamicWidgetStateFlags.read(context).precedence != DynamicWidgetStatePrecedence.RESET_ON_PUSH) {
            return
        }

        val appWidgetIds =
            AppWidgetManager
                .getInstance(context)
                .getAppWidgetIds(VoltraWidgetReceivers.componentName(context, dynamicWidgetId))
        val glanceAppWidgetManager = GlanceAppWidgetManager(context)
        appWidgetIds.forEach { appWidgetId ->
            DynamicWidgetStateStore.resetPlacementState(context, glanceAppWidgetManager.getGlanceIdBy(appWidgetId))
        }
        // The push re-renders every placement right after this, so the scope store needs no
        // re-render of its own here.
        DynamicWidgetScopeStateStore(context).clearWidget(dynamicWidgetId)

        Log.d(
            DynamicWidgetStateInteraction.TAG,
            "resetOnPush cleared the state of '$dynamicWidgetId' (${appWidgetIds.size} placements)",
        )
    }
}
