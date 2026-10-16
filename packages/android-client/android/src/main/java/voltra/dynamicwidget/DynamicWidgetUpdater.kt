package voltra.dynamicwidget

import voltra.widget.VoltraWidgetKind
import voltra.widget.VoltraWidgetKindResolution

internal fun interface DynamicWidgetPropsPersistence {
    fun persistDynamicWidgetProps(
        dynamicWidgetId: String,
        dynamicWidgetPropsJson: String,
    )
}

internal fun interface DynamicWidgetUpdateTrigger {
    suspend fun triggerDynamicWidgetUpdate(dynamicWidgetId: String)
}

/**
 * Runs after a push's props are persisted and before the widget re-renders. The default does
 * nothing, so a push never touches the widget state record; the `resetOnPush` precedence flag
 * swaps in a reset of every placement's record (`AndroidDynamicWidgetPushStateReset`).
 *
 * PoC for issue #343; not API.
 */
internal fun interface DynamicWidgetPushStateReset {
    suspend fun afterDynamicWidgetPropsPersisted(dynamicWidgetId: String)
}

/** Resolves a widget id's [VoltraWidgetKind]. Injectable so [DynamicWidgetUpdater] is testable. */
internal fun interface DynamicWidgetKindResolver {
    fun resolveDynamicWidgetKind(dynamicWidgetId: String): VoltraWidgetKindResolution
}

/** A widget id was resolved but is not a Dynamic Widget, or could not be resolved at all. */
internal sealed class DynamicWidgetUpdateRejection(
    message: String,
) : Exception(message) {
    class KindMismatch(
        message: String,
    ) : DynamicWidgetUpdateRejection(message)

    class NotFound(
        message: String,
    ) : DynamicWidgetUpdateRejection(message)
}

/**
 * Resolves the widget's kind, then persists runtime props before asking Glance to re-render a
 * Dynamic Widget. Nothing is persisted before the kind check passes (ADR 0000): a widget id can
 * no longer be driven through the wrong API and leave state behind.
 */
internal class DynamicWidgetUpdater(
    private val dynamicWidgetKindResolver: DynamicWidgetKindResolver,
    private val dynamicWidgetPropsPersistence: DynamicWidgetPropsPersistence,
    private val dynamicWidgetUpdateTrigger: DynamicWidgetUpdateTrigger,
    private val dynamicWidgetPushStateReset: DynamicWidgetPushStateReset = DynamicWidgetPushStateReset { },
) {
    suspend fun updateDynamicWidget(
        dynamicWidgetId: String,
        dynamicWidgetPropsJson: String,
    ) {
        when (val resolution = dynamicWidgetKindResolver.resolveDynamicWidgetKind(dynamicWidgetId)) {
            is VoltraWidgetKindResolution.Resolved -> {
                if (resolution.kind != VoltraWidgetKind.Dynamic) {
                    throw DynamicWidgetUpdateRejection.KindMismatch(
                        "Widget '$dynamicWidgetId' is a payload-driven widget. Use updateAndroidWidget " +
                            "to pass a payload; updateAndroidDynamicWidget only drives Dynamic Widgets.",
                    )
                }
            }

            is VoltraWidgetKindResolution.Unresolved -> {
                throw DynamicWidgetUpdateRejection.NotFound(resolution.reason)
            }
        }

        dynamicWidgetPropsPersistence.persistDynamicWidgetProps(
            dynamicWidgetId = dynamicWidgetId,
            dynamicWidgetPropsJson = dynamicWidgetPropsJson,
        )
        dynamicWidgetPushStateReset.afterDynamicWidgetPropsPersisted(dynamicWidgetId)
        dynamicWidgetUpdateTrigger.triggerDynamicWidgetUpdate(dynamicWidgetId)
    }
}
