/**
 * Per-render widget state slot for Dynamic Widgets.
 *
 * PoC for issue #343; not API.
 *
 * The native host persists a JSON record per widget placement and hands it into every render
 * as the reserved `env.__voltraState` key. The generated Dynamic Widget entry strips that key
 * from `env` and runs the author's render inside {@link runWithVoltraState}, so
 * {@link useVoltraState} can read it from a module-level slot.
 *
 * Render is read-only: the record is written only by the author's `onInteraction` handler on
 * the tap path (or natively for a control's `stateKey`), never during render.
 */

/** Widget state record as persisted by the native host. */
export type VoltraStateRecord = Record<string, unknown>

let currentVoltraState: VoltraStateRecord | null = null

/**
 * Runs `fn` with `state` as the current widget state slot and restores the previous slot
 * afterwards, also when `fn` throws. Nested calls do not leak into each other.
 *
 * PoC for issue #343; not API.
 */
export function runWithVoltraState<T>(state: VoltraStateRecord | null, fn: () => T): T {
  const previousState = currentVoltraState
  currentVoltraState = state

  try {
    return fn()
  } finally {
    currentVoltraState = previousState
  }
}

/**
 * Reads `key` from the widget state of the placement being rendered, or returns `initial` when
 * the state has no such key (or when called outside a Dynamic Widget render, such as at
 * prerender).
 *
 * PoC for issue #343; not API. The value is read-only during render: state is written only by
 * the widget's `onInteraction` handler on the tap path. The hook does not use React's
 * dispatcher, so it works in bare calls and inside element-valued props.
 */
export function useVoltraState<T>(key: string, initial: T): T {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('useVoltraState: key must be a non-empty string')
  }

  const state = currentVoltraState

  if (state !== null && Object.prototype.hasOwnProperty.call(state, key)) {
    return state[key] as T
  }

  return initial
}
