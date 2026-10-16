import { getNativeVoltraAndroid } from '../native/NativeVoltraAndroid.js'

export type AndroidDynamicWidgetPropsValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<AndroidDynamicWidgetPropsValue>
  | Readonly<{ [dynamicWidgetPropName: string]: AndroidDynamicWidgetPropsValue }>

export type AndroidDynamicWidgetProps = Readonly<{
  [dynamicWidgetPropName: string]: AndroidDynamicWidgetPropsValue
}>

/**
 * Update a Dynamic Widget's props.
 *
 * Rejects with `VOLTRA_WIDGET_KIND_MISMATCH` when `dynamicWidgetId` belongs to a payload-driven
 * widget, and with `VOLTRA_WIDGET_NOT_FOUND` when `dynamicWidgetId` is unknown.
 */
export const updateAndroidDynamicWidget = async (
  dynamicWidgetId: string,
  dynamicWidgetProps: AndroidDynamicWidgetProps
): Promise<void> => {
  const dynamicWidgetPropsJson = JSON.stringify(dynamicWidgetProps)

  return getNativeVoltraAndroid().updateAndroidDynamicWidget(dynamicWidgetId, dynamicWidgetPropsJson)
}

/**
 * Render Dynamic Widgets in a language the app chooses, for apps with their own language setting.
 *
 * The tag (BCP-47, for example `"pl"` or `"pt-BR"`) reaches every render as `env.appLocale`, and
 * `resolveLocale` gives it precedence over the user's system languages. Pass `null` to clear it.
 * Every placed Dynamic Widget re-renders once the value is stored.
 *
 * Android already passes a per-app language set through `LocaleManager` (Android 13+) to widgets
 * as `env.locale`, so this is only needed when the app keeps its own setting.
 */
export const setDynamicWidgetLocale = async (tag: string | null): Promise<void> => {
  return getNativeVoltraAndroid().setDynamicWidgetLocale(normalizeDynamicWidgetLocale(tag))
}

function normalizeDynamicWidgetLocale(tag: string | null): string | null {
  if (tag === null) {
    return null
  }
  if (typeof tag !== 'string') {
    throw new TypeError('setDynamicWidgetLocale expects a BCP-47 language tag or null.')
  }
  const trimmed = tag.trim().replace(/_/g, '-')
  return trimmed.length === 0 ? null : trimmed
}

/**
 * A Dynamic Widget's state record, the values `useVoltraState(key, initial)` reads.
 *
 * PoC for issue #343; not API.
 */
export type AndroidDynamicWidgetStateRecord = Readonly<{ [stateKey: string]: AndroidDynamicWidgetPropsValue }>

/** PoC for issue #343; not API. */
export type AndroidDynamicWidgetStateSnapshot = Readonly<{
  state: AndroidDynamicWidgetStateRecord
  /** Advances on every commit and reset. */
  stateRevision: number
}>

/**
 * What a state change recorded in an event looked like: one key for a `stateKey` tap or a
 * one-key patch, or the patched keys' previous values (`from`) and the patch (`to`) otherwise.
 *
 * PoC for issue #343; not API.
 */
export type AndroidDynamicWidgetStateChange = Readonly<{
  key?: string
  from?: AndroidDynamicWidgetPropsValue
  to?: AndroidDynamicWidgetPropsValue
}>

/**
 * One tap a Dynamic Widget handled (or tried to handle) while the app was not involved.
 *
 * PoC for issue #343; not API.
 */
export type AndroidDynamicWidgetInteractionEvent = Readonly<{
  type: 'interaction'
  source: 'widget'
  widgetId: string
  /** The tapped control's `id`. */
  identifier: string
  componentType: 'checkbox' | 'switch' | 'button'
  /** The value the host reported for a toggle (absolute on Android 12+); null for buttons. */
  checked: boolean | null
  appWidgetId: number | null
  /** The placement's configuration key, or null when it has no configuration. */
  instance: string | null
  /** Strictly increasing across process deaths; a gap means events were dropped. */
  seq: number
  eventId: string
  /** Epoch milliseconds. */
  timestamp: number
  /** True when a `stateKey` binding or an `onInteraction` handler took the tap. */
  handledInWidget: boolean
  /** The state revision after the tap (unchanged when nothing was written). */
  stateRevision: number
  /** The state revision of the tree that was tapped. */
  renderedRevision: number
  stateChange: AndroidDynamicWidgetStateChange | null
}>

/** PoC for issue #343; not API. */
export type AndroidDynamicWidgetStateFlags = Readonly<{
  /** Where the record lives: per placement (default) or per configuration scope. */
  scope?: 'placement' | 'widgetScope' | null
  /** An artificial pause before a tap commits, to widen race windows. Defaults to 0. */
  interactDelayMs?: number | null
  /** Whether a props push keeps the record (default) or clears it. */
  precedence?: 'survive' | 'resetOnPush' | null
}>

/**
 * Read the state record one placed Dynamic Widget renders with.
 *
 * PoC for issue #343; not API.
 */
export const readAndroidDynamicWidgetState = async (
  appWidgetId: number
): Promise<AndroidDynamicWidgetStateSnapshot> => {
  const snapshotJson = await getNativeVoltraAndroid().readDynamicWidgetState(appWidgetId)

  return JSON.parse(snapshotJson) as AndroidDynamicWidgetStateSnapshot
}

/**
 * Clear one placed Dynamic Widget's state record and re-render it.
 *
 * PoC for issue #343; not API.
 */
export const resetAndroidDynamicWidgetState = async (appWidgetId: number): Promise<void> => {
  return getNativeVoltraAndroid().resetDynamicWidgetState(appWidgetId)
}

/**
 * Take every interaction event the widgets queued since the last call, oldest first.
 *
 * PoC for issue #343; not API.
 */
export const drainAndroidDynamicWidgetEvents = async (): Promise<AndroidDynamicWidgetInteractionEvent[]> => {
  const eventsJson = await getNativeVoltraAndroid().drainDynamicWidgetEvents()

  return JSON.parse(eventsJson) as AndroidDynamicWidgetInteractionEvent[]
}

/**
 * Change the in-widget state PoC switches. Keys left out keep their value; `null` restores the
 * default. Every Dynamic Widget re-renders afterwards.
 *
 * PoC for issue #343; not API.
 */
export const setAndroidDynamicWidgetStateFlags = async (flags: AndroidDynamicWidgetStateFlags): Promise<void> => {
  return getNativeVoltraAndroid().setDynamicWidgetStateFlags(JSON.stringify(flags))
}
