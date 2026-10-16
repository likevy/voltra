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
 * the tap path (or natively for a control's `stateKey`), never during render. The hybrid write
 * path ({@link useVoltraStateTuple}) also writes only on the tap path, through a replay render
 * whose output is discarded.
 */

/** Widget state record as persisted by the native host. */
export type VoltraStateRecord = Record<string, unknown>

/**
 * Replay of one tap, used by the hybrid write path (inline setters).
 *
 * PoC for issue #343; not API. Closures cannot cross to native, so a tap on a control whose
 * handler is an inline `onCheckedChange` / `onPress` is handled by re-running the render with the
 * tap event: the renderer records the handler of the host element whose `id` equals
 * `event.componentId`, and once the render has finished that handler is called; the setters it
 * calls record into `pending`. Calling it after the walk means it sees every closure the render
 * produced, whatever the element order, and setters called by the render itself never write.
 */
export type VoltraStateReplayEvent = {
  componentId: string
  value: boolean | null
}

/** PoC for issue #343; not API. Mutable replay context while a replay render runs. */
export type VoltraStateReplayContext = {
  event: VoltraStateReplayEvent
  pending: Record<string, unknown>
  handled: boolean
  /** True once an element with the matching id was reached, so its handler runs at most once. */
  matched: boolean
  /** The matched element's handler, recorded during the walk and called after it. */
  matchedHandler: (() => void) | null
  /** True only while the matched handler runs; setters write `pending` only then. */
  inHandler: boolean
  warnings: string[]
}

/** PoC for issue #343; not API. Outcome of {@link runWithVoltraStateReplay}. */
export type VoltraStateReplayResult<T> = {
  out: T
  pending: Record<string, unknown>
  handled: boolean
  warnings: string[]
}

/** PoC for issue #343; not API. Options for {@link runWithVoltraState}. */
export type RunWithVoltraStateOptions = {
  replay?: VoltraStateReplayEvent
}

let currentVoltraState: VoltraStateRecord | null = null
let currentReplay: VoltraStateReplayContext | null = null

const MAX_ORPHAN_WARNINGS = 50
let orphanWarnings: string[] = []

/**
 * Runs `fn` with `state` as the current widget state slot and restores the previous slot
 * afterwards, also when `fn` throws. Nested calls do not leak into each other.
 *
 * PoC for issue #343; not API. With `options.replay`, `fn` runs as a tap replay (see
 * {@link runWithVoltraStateReplay}, which also returns the replay outcome).
 */
export function runWithVoltraState<T>(
  state: VoltraStateRecord | null,
  fn: () => T,
  options?: RunWithVoltraStateOptions
): T {
  if (options?.replay) {
    // The replay outcome is not visible here; use runWithVoltraStateReplay to read it.
    return runWithVoltraStateReplay(state, options.replay, fn).out
  }

  const previousState = currentVoltraState
  const previousReplay = currentReplay
  currentVoltraState = state
  currentReplay = null

  try {
    return fn()
  } finally {
    currentVoltraState = previousState
    currentReplay = previousReplay
  }
}

/**
 * Runs `fn` (normally a render) as the replay of one tap, then calls the inline handler of the
 * element whose `id` matched `replay.componentId` (recorded by the renderer during the walk), and
 * returns the render output together with the state the handler's setters wrote, whether the
 * handler ran, and the warnings recorded meanwhile.
 *
 * PoC for issue #343; not API. Only the handler writes `pending`: a setter called by the render
 * itself is ignored with a warning. A throwing handler leaves the replay unhandled with nothing
 * pending. The slot and replay context are restored afterwards, also when `fn` throws.
 */
export function runWithVoltraStateReplay<T>(
  state: VoltraStateRecord | null,
  replay: VoltraStateReplayEvent,
  fn: () => T
): VoltraStateReplayResult<T> {
  const previousState = currentVoltraState
  const previousReplay = currentReplay
  const context = createReplayContext(replay)
  currentVoltraState = state
  currentReplay = context

  try {
    const out = fn()
    invokeMatchedReplayHandler(context)
    return { out, pending: context.pending, handled: context.handled, warnings: context.warnings }
  } finally {
    currentVoltraState = previousState
    currentReplay = previousReplay
  }
}

function createReplayContext(replay: VoltraStateReplayEvent): VoltraStateReplayContext {
  return {
    event: {
      componentId: typeof replay.componentId === 'string' ? replay.componentId : '',
      value: replay.value ?? null,
    },
    pending: {},
    handled: false,
    matched: false,
    matchedHandler: null,
    inHandler: false,
    warnings: [],
  }
}

function invokeMatchedReplayHandler(context: VoltraStateReplayContext): void {
  const componentId = context.event.componentId

  if (componentId === '') {
    context.warnings.push('replay without a componentId; no handler called')
    return
  }

  if (!context.matched) {
    context.warnings.push(`no element with id "${componentId}" reached in the replay render`)
    return
  }

  const handler = context.matchedHandler
  if (handler === null) {
    context.warnings.push(`element "${componentId}" has no inline onCheckedChange / onPress`)
    return
  }

  context.inHandler = true
  try {
    handler()
  } catch (error) {
    context.warnings.push(
      `inline handler for "${componentId}" threw: ${error instanceof Error ? error.message : String(error)}`
    )
    context.pending = {}
    return
  } finally {
    context.inHandler = false
  }

  context.handled = true
}

/**
 * Returns the active replay context, or `null` outside a replay. Used by the renderer to call the
 * tapped element's inline handler.
 *
 * PoC for issue #343; not API.
 */
export function getVoltraStateReplay(): VoltraStateReplayContext | null {
  return currentReplay
}

/**
 * Returns and clears the warnings recorded outside a replay (a setter called during a normal
 * render, for example).
 *
 * PoC for issue #343; not API.
 */
export function takeVoltraStateWarnings(): string[] {
  const warnings = orphanWarnings
  orphanWarnings = []
  return warnings
}

/**
 * Records a warning on the active replay, or in the orphan list outside a replay.
 *
 * PoC for issue #343; not API.
 */
export function recordVoltraStateWarning(message: string): void {
  if (currentReplay !== null) {
    currentReplay.warnings.push(message)
    return
  }

  if (orphanWarnings.length < MAX_ORPHAN_WARNINGS) {
    orphanWarnings.push(message)
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
  assertVoltraStateKey('useVoltraState', key)
  return readVoltraState(key, initial)
}

function assertVoltraStateKey(hookName: string, key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(`${hookName}: key must be a non-empty string`)
  }
}

function readVoltraState<T>(key: string, initial: T): T {
  const state = currentVoltraState

  if (state !== null && Object.prototype.hasOwnProperty.call(state, key)) {
    return state[key] as T
  }

  return initial
}

/** PoC for issue #343; not API. Setter returned by {@link useVoltraStateTuple}. */
export type VoltraStateSetter<T> = (next: T | ((prev: T) => T)) => void

/**
 * Like {@link useVoltraState}, plus a setter for inline handlers on controls with an author `id`:
 * `const [done, setDone] = useVoltraStateTuple('done.a', false)` and
 * `onCheckedChange={(checked) => setDone(checked)}`.
 *
 * PoC for issue #343; not API (the ADR decides whether `useVoltraState` itself returns a tuple).
 * The setter only has an effect inside the tapped element's handler during a tap replay: it
 * writes the next value (computed from the value already pending for `key` in this replay, else
 * the slot value, else `initial`) into the replay's pending patch, which native merges into the
 * persisted record. Anywhere else (a normal render, or the render body during a replay) it does
 * nothing and records a warning, so render stays pure.
 */
export function useVoltraStateTuple<T>(key: string, initial: T): [T, VoltraStateSetter<T>] {
  assertVoltraStateKey('useVoltraStateTuple', key)
  const value = readVoltraState(key, initial)

  const setValue: VoltraStateSetter<T> = (next) => {
    const replay = currentReplay

    if (replay === null || !replay.inHandler) {
      recordVoltraStateWarning(`useVoltraStateTuple: setter called outside a tap handler for key "${key}"`)
      return
    }

    const previous = Object.prototype.hasOwnProperty.call(replay.pending, key)
      ? (replay.pending[key] as T)
      : readVoltraState(key, initial)
    replay.pending[key] = typeof next === 'function' ? (next as (prev: T) => T)(previous) : next
  }

  return [value, setValue]
}
