package voltra.dynamicwidget.state

import android.content.Context
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.action.actionRunCallback
import voltra.glance.VoltraRenderContext
import voltra.glance.renderers.getOnClickAction
import voltra.models.VoltraElement
import voltra.payload.ComponentTypeID

/**
 * The click action of a CheckBox, Switch or FilledButton.
 *
 * Inside a Dynamic Widget drawn by `VoltraClientGlanceWidget` ([VoltraRenderContext.interactiveState])
 * a control with an author `id` runs [DynamicWidgetStateActionCallback] in the app process, with no
 * Activity and no React Native runtime, so a tap can change the widget's state record. Everything
 * else (payload widgets, previews, notifications, controls without an `id`, and controls with an
 * explicit `deepLinkUrl`, whose author asked for that link) keeps today's `getOnClickAction`, which
 * opens the app.
 *
 * Only the author's `id` routes a tap: the `hashCode` fallback ids the renderers build change with
 * every prop, including `checked`, so they cannot name a control across renders.
 *
 * PoC for issue #343; not API.
 */
fun dynamicWidgetStateActionOrDefault(
    context: Context,
    element: VoltraElement,
    renderContext: VoltraRenderContext,
    componentId: String,
): Action {
    val authorId = element.i
    val deepLinkUrl = element.p?.get("deepLinkUrl") as? String
    if (renderContext.interactiveState && authorId != null && deepLinkUrl.isNullOrEmpty()) {
        val parameters =
            mutableListOf<ActionParameters.Pair<out Any>>(
                DynamicWidgetStateActionCallback.KEY_WIDGET_ID to renderContext.widgetId,
                DynamicWidgetStateActionCallback.KEY_COMPONENT_ID to authorId,
                DynamicWidgetStateActionCallback.KEY_COMPONENT_TYPE to componentTypeName(element.t),
                DynamicWidgetStateActionCallback.KEY_STATE_KEY to (element.p?.get("stateKey") as? String ?: ""),
                DynamicWidgetStateActionCallback.KEY_RENDERED_REVISION to renderContext.stateRevision,
            )
        // The size this tree was drawn at, so the inline-setter replay renders the tapped layout
        // instead of the smallest placed one. Omitted when the render context has no size.
        renderContext.widgetSize?.let { size ->
            parameters += DynamicWidgetStateActionCallback.KEY_WIDTH_DP to size.width.value
            parameters += DynamicWidgetStateActionCallback.KEY_HEIGHT_DP to size.height.value
        }
        return actionRunCallback<DynamicWidgetStateActionCallback>(actionParametersOf(*parameters.toTypedArray()))
    }

    return getOnClickAction(context, element.p, renderContext.widgetId, componentId)
}

internal fun componentTypeName(componentType: Int): String =
    when (componentType) {
        ComponentTypeID.CHECK_BOX -> "checkbox"
        ComponentTypeID.SWITCH -> "switch"
        else -> "button"
    }
