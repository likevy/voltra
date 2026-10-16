package voltra.glance

import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.unit.DpSize
import voltra.models.VoltraNode

data class VoltraRenderContext(
    val widgetId: String,
    val sharedElements: List<VoltraNode>? = null,
    val sharedStyles: List<Map<String, Any?>>? = null,
    val widgetSize: DpSize? = null,
    /**
     * True only for a Dynamic Widget drawn by `VoltraClientGlanceWidget`: its CheckBox, Switch and
     * FilledButton taps with an author `id` go to the in-widget state callback instead of opening
     * the app. Payload widgets, previews and notifications never set it, so their clicks are
     * unchanged.
     *
     * PoC for issue #343; not API.
     */
    val interactiveState: Boolean = false,
    /** The state revision this tree was rendered with, carried by each tap. PoC for issue #343; not API. */
    val stateRevision: Long = 0L,
)

val LocalVoltraRenderContext =
    compositionLocalOf<VoltraRenderContext> {
        error("VoltraRenderContext not provided")
    }
