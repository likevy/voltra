package voltra.dynamicwidget.state

import android.content.Context
import org.json.JSONException
import org.json.JSONObject

/** Where the widget state record lives. PoC for issue #343; not API. */
internal enum class DynamicWidgetStateStorage(
    val wireName: String,
) {
    /** One record per placement, in its Glance state (the default). */
    PLACEMENT("placement"),

    /** One record per `WidgetScope.storageKey`, shared by identical configurations. */
    WIDGET_SCOPE("widgetScope"),
}

/** What a props push does to the state record. PoC for issue #343; not API. */
internal enum class DynamicWidgetStatePrecedence(
    val wireName: String,
) {
    /** A push never touches the record (the default). */
    SURVIVE("survive"),

    /** A push clears the record of every placement of the widget after the props are persisted. */
    RESET_ON_PUSH("resetOnPush"),
}

/** PoC for issue #343; not API. */
internal data class DynamicWidgetStateFlagValues(
    val storage: DynamicWidgetStateStorage = DynamicWidgetStateStorage.PLACEMENT,
    /** An artificial pause between computing and committing a tap, to widen race windows. */
    val interactDelayMs: Long = 0L,
    val precedence: DynamicWidgetStatePrecedence = DynamicWidgetStatePrecedence.SURVIVE,
) {
    fun toJson(): JSONObject =
        JSONObject()
            .put(SCOPE_KEY, storage.wireName)
            .put(INTERACT_DELAY_MS_KEY, interactDelayMs)
            .put(PRECEDENCE_KEY, precedence.wireName)

    internal companion object {
        const val SCOPE_KEY = "scope"
        const val INTERACT_DELAY_MS_KEY = "interactDelayMs"
        const val PRECEDENCE_KEY = "precedence"
    }
}

/**
 * Runtime switches for the in-widget state PoC, kept in SharedPreferences
 * `voltra_dynamic_widget_state_flags` and written from the app through
 * `setAndroidDynamicWidgetStateFlags`. Every unset or unknown value reads as its default, so with
 * nothing written the behaviour is: per-placement storage, no delay, props pushes leave state alone.
 *
 * PoC for issue #343; not API.
 */
internal object DynamicWidgetStateFlags {
    const val PREFERENCES_NAME = "voltra_dynamic_widget_state_flags"

    fun read(context: Context): DynamicWidgetStateFlagValues {
        val preferences = context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val storageName = preferences.getString(DynamicWidgetStateFlagValues.SCOPE_KEY, null)
        val precedenceName = preferences.getString(DynamicWidgetStateFlagValues.PRECEDENCE_KEY, null)

        return DynamicWidgetStateFlagValues(
            storage =
                DynamicWidgetStateStorage.entries.firstOrNull { it.wireName == storageName }
                    ?: DynamicWidgetStateStorage.PLACEMENT,
            interactDelayMs =
                preferences.getLong(DynamicWidgetStateFlagValues.INTERACT_DELAY_MS_KEY, 0L).coerceAtLeast(0L),
            precedence =
                DynamicWidgetStatePrecedence.entries.firstOrNull { it.wireName == precedenceName }
                    ?: DynamicWidgetStatePrecedence.SURVIVE,
        )
    }

    /**
     * Apply the keys present in [flagsJson]; a key set to `null` goes back to its default, and keys
     * that are absent keep their current value. Unknown values are rejected rather than stored.
     */
    fun write(
        context: Context,
        flagsJson: String,
    ) {
        val flags =
            try {
                JSONObject(flagsJson)
            } catch (e: JSONException) {
                throw IllegalArgumentException("Dynamic Widget state flags must be a JSON object: ${e.message}")
            }
        val editor =
            context.applicationContext
                .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()

        if (flags.has(DynamicWidgetStateFlagValues.SCOPE_KEY)) {
            if (flags.isNull(DynamicWidgetStateFlagValues.SCOPE_KEY)) {
                editor.remove(DynamicWidgetStateFlagValues.SCOPE_KEY)
            } else {
                val value = flags.getString(DynamicWidgetStateFlagValues.SCOPE_KEY)
                require(DynamicWidgetStateStorage.entries.any { it.wireName == value }) {
                    "Unknown Dynamic Widget state scope '$value'"
                }
                editor.putString(DynamicWidgetStateFlagValues.SCOPE_KEY, value)
            }
        }
        if (flags.has(DynamicWidgetStateFlagValues.INTERACT_DELAY_MS_KEY)) {
            if (flags.isNull(DynamicWidgetStateFlagValues.INTERACT_DELAY_MS_KEY)) {
                editor.remove(DynamicWidgetStateFlagValues.INTERACT_DELAY_MS_KEY)
            } else {
                val value = flags.getLong(DynamicWidgetStateFlagValues.INTERACT_DELAY_MS_KEY)
                require(value >= 0L) { "interactDelayMs must not be negative" }
                editor.putLong(DynamicWidgetStateFlagValues.INTERACT_DELAY_MS_KEY, value)
            }
        }
        if (flags.has(DynamicWidgetStateFlagValues.PRECEDENCE_KEY)) {
            if (flags.isNull(DynamicWidgetStateFlagValues.PRECEDENCE_KEY)) {
                editor.remove(DynamicWidgetStateFlagValues.PRECEDENCE_KEY)
            } else {
                val value = flags.getString(DynamicWidgetStateFlagValues.PRECEDENCE_KEY)
                require(DynamicWidgetStatePrecedence.entries.any { it.wireName == value }) {
                    "Unknown Dynamic Widget state precedence '$value'"
                }
                editor.putString(DynamicWidgetStateFlagValues.PRECEDENCE_KEY, value)
            }
        }
        check(editor.commit()) { "Failed to persist Dynamic Widget state flags" }
    }
}
