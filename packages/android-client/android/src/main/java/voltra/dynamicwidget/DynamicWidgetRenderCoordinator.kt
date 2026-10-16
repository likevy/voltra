package voltra.dynamicwidget

import android.util.Log
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import voltra.models.VoltraNode
import voltra.parsing.VoltraDecompressor

internal fun interface DynamicWidgetRuntimeBoundary {
    fun renderDynamicWidget(
        dynamicWidgetId: String,
        dynamicWidgetRenderInput: DynamicWidgetRenderInput,
        dynamicWidgetEnvironmentJson: String,
    ): String?
}

internal data class DynamicWidgetRenderInput(
    val propsRevision: Long,
    val propsJson: String,
    /**
     * The widget state record (`useVoltraState`) this render reads, as a JSON object. The render
     * passes it to JS as `env.__voltraState`; it is never written by a render.
     *
     * PoC for issue #343; not API.
     */
    val stateJson: String = "{}",
    /** The revision of [stateJson], threaded into each tap so the callback sees what was drawn. */
    val stateRevision: Long = 0L,
)

internal object DynamicWidgetHermesRuntimeBoundary : DynamicWidgetRuntimeBoundary {
    override fun renderDynamicWidget(
        dynamicWidgetId: String,
        dynamicWidgetRenderInput: DynamicWidgetRenderInput,
        dynamicWidgetEnvironmentJson: String,
    ): String? =
        VoltraJSRenderer.render(
            dynamicWidgetId,
            dynamicWidgetRenderInput.propsJson,
            dynamicWidgetEnvironmentJson,
        )
}

internal class DynamicWidgetRenderCoordinator(
    private val dynamicWidgetRuntimeBoundary: DynamicWidgetRuntimeBoundary = DynamicWidgetHermesRuntimeBoundary,
) {
    fun renderDynamicWidget(
        dynamicWidgetId: String,
        dynamicWidgetRenderInput: DynamicWidgetRenderInput,
        dynamicWidgetEnvironmentJson: String,
    ): VoltraNode? {
        val dynamicWidgetStandaloneNodeJson =
            dynamicWidgetRuntimeBoundary.renderDynamicWidget(
                dynamicWidgetId = dynamicWidgetId,
                dynamicWidgetRenderInput = dynamicWidgetRenderInput,
                dynamicWidgetEnvironmentJson = dynamicWidgetEnvironmentJson,
            ) ?: return null

        return try {
            val dynamicWidgetNode =
                dynamicWidgetJson.decodeFromString<VoltraNode>(dynamicWidgetStandaloneNodeJson)
            VoltraDecompressor.decompressNode(dynamicWidgetNode)
        } catch (dynamicWidgetRenderException: Exception) {
            Log.e(
                DYNAMIC_WIDGET_RENDER_COORDINATOR_TAG,
                "Failed to parse Dynamic Widget node for dynamicWidgetId=$dynamicWidgetId: " +
                    dynamicWidgetRenderException.message,
            )
            null
        }
    }

    private companion object {
        private const val DYNAMIC_WIDGET_RENDER_COORDINATOR_TAG = "DynamicWidgetRenderCoordinator"

        @OptIn(ExperimentalSerializationApi::class)
        private val dynamicWidgetJson =
            Json {
                ignoreUnknownKeys = true
                explicitNulls = false
            }
    }
}
