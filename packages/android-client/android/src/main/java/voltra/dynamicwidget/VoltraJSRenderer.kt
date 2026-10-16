package voltra.dynamicwidget

import android.util.Log

/**
 * Standalone Hermes runtime for Voltra **Dynamic Widgets**.
 *
 * Architectural mirror of iOS `VoltraJSRenderer.swift` (JSC). Each per-widget Metro bundle
 * exposes `render(props, env)`; [evaluateBundle] evaluates it once in a single process-wide
 * Hermes runtime, capturing the bundle's exports under `globalThis.__voltraWidgets[<id>]`,
 * and [render] invokes that function on every Glance render.
 *
 * Lifecycle: one Hermes runtime per process (created lazily in native code on first
 * evaluate). Re-evaluating the same widget overwrites its captured exports — used by
 * dev-mode hot reload (always-refetch).
 *
 * Thread safety: a single lock guards both evaluate and render, matching iOS's NSLock.
 */
object VoltraJSRenderer {
    private const val TAG = "VoltraJSRenderer"

    init {
        System.loadLibrary("voltra_js_renderer")
    }

    private val lock = Any()

    private external fun nativeEvaluateBundle(
        wrappedSource: String,
        sourceURL: String,
        widgetId: String,
    ): Boolean

    private external fun nativeRender(
        widgetId: String,
        propsJSON: String,
        envJSON: String,
    ): String?

    private external fun nativeInvoke(
        widgetId: String,
        exportName: String,
        payloadJSON: String,
    ): String?

    /**
     * Minimal global shims. The widget Metro bundle runs in a *bare* Hermes runtime (no RN
     * preamble — the widget Metro config strips polyfills), but React's dev build and a few
     * helpers reference `console` / timers that Hermes does not define out of the box. JSC
     * (iOS) happened to tolerate their absence; Hermes does not, so we inject no-op stand-ins
     * before the bundle. Voltra's renderer is fully synchronous, so timers are never actually
     * needed during a render — the no-ops exist only so references don't throw.
     */
    private val GLOBAL_SHIMS =
        """
        (function (g) {
          if (typeof g.console === 'undefined') {
            var noop = function () {};
            g.console = {
              log: noop, info: noop, warn: noop, error: noop, debug: noop, trace: noop,
              group: noop, groupCollapsed: noop, groupEnd: noop, table: noop, assert: noop,
              dir: noop, count: noop, time: noop, timeEnd: noop
            };
          }
          if (typeof g.setTimeout === 'undefined') { g.setTimeout = function () { return 0; }; }
          if (typeof g.clearTimeout === 'undefined') { g.clearTimeout = function () {}; }
          if (typeof g.setInterval === 'undefined') { g.setInterval = function () { return 0; }; }
          if (typeof g.clearInterval === 'undefined') { g.clearInterval = function () {}; }
          if (typeof g.setImmediate === 'undefined') { g.setImmediate = function () { return 0; }; }
        })(typeof globalThis !== 'undefined' ? globalThis : this);
        """.trimIndent()

    /**
     * Evaluate a widget bundle (raw Metro `/voltra/widgets/<id>.bundle` output) and capture
     * its `render(props, env)` export. Idempotent: re-evaluating overwrites the capture.
     *
     * The raw bundle ends with Metro's entry invocation `__r(<entryId>);`. We re-invoke that
     * entry and stash its exports in `globalThis.__voltraWidgets[<id>]` (Metro's `__r` caches
     * module exports, so the second invocation returns the already-evaluated module).
     */
    fun evaluateBundle(
        source: String,
        widgetId: String,
    ): Boolean =
        synchronized(lock) {
            val entryModuleId = extractEntryModuleId(source) ?: 0
            val wrapped =
                buildString {
                    append(GLOBAL_SHIMS)
                    append('\n')
                    append(source)
                    append('\n')
                    append(";(function () {\n")
                    append("  if (!globalThis.__voltraWidgets) { globalThis.__voltraWidgets = {}; }\n")
                    append("  globalThis.__voltraWidgets[")
                    append(jsStringLiteral(widgetId))
                    append("] = __r(")
                    append(entryModuleId)
                    append(");\n")
                    append("})();\n")
                }
            val ok =
                try {
                    nativeEvaluateBundle(wrapped, "voltra/$widgetId.bundle", widgetId)
                } catch (t: Throwable) {
                    Log.e(TAG, "nativeEvaluateBundle threw for widgetId=$widgetId", t)
                    false
                }
            ok
        }

    /**
     * Invoke the previously-evaluated widget's `render(propsJSON, envJSON)` and return its
     * resolved JSON string. Returns null if the widget was not evaluated, the function throws,
     * or it did not return a string.
     */
    fun render(
        widgetId: String,
        propsJSON: String,
        envJSON: String,
    ): String? =
        synchronized(lock) {
            try {
                nativeRender(widgetId, propsJSON, envJSON)
            } catch (t: Throwable) {
                Log.e(TAG, "nativeRender threw for widgetId=$widgetId", t)
                null
            }
        }

    /**
     * Call another export of an evaluated widget bundle with one JSON string:
     * `__voltraWidgets[widgetId][exportName](payloadJSON)`, under the same lock as [render] and
     * [evaluateBundle]. The Dynamic Widget state callback uses it to reach the generated entry's
     * `interact(payloadJSON)` export, which runs the author's `onInteraction`.
     *
     * Returns null when the widget was not evaluated, the export is missing or not a function (so
     * a bundle built before the export existed is feature-detected, not an error), the call throws,
     * or it did not return a string.
     *
     * PoC for issue #343; not API.
     */
    fun invoke(
        widgetId: String,
        exportName: String,
        payloadJSON: String,
    ): String? =
        synchronized(lock) {
            try {
                nativeInvoke(widgetId, exportName, payloadJSON)
            } catch (t: Throwable) {
                Log.e(TAG, "nativeInvoke threw for widgetId=$widgetId export=$exportName", t)
                null
            }
        }

    /**
     * Find the entry module id Metro emitted in the bundle's trailing `__r(<id>);`. Every
     * `__d(...)` module body also contains internal `__r(...)` calls, so we take the LAST
     * match — the entry invocation Metro appends at the end of the bundle. Mirrors iOS's
     * `extractEntryModuleId`.
     */
    private fun extractEntryModuleId(source: String): Int? =
        Regex("""__r\((\d+)\);""")
            .findAll(source)
            .lastOrNull()
            ?.groupValues
            ?.get(1)
            ?.toIntOrNull()

    private fun jsStringLiteral(value: String): String =
        "\"" +
            value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r") +
            "\""
}
