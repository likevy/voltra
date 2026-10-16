/**
 * Positional `useState` identity (the "Voltra useState Identity" design note), built only to be
 * measured against option C in `test/voltra-state-positional-identity.test.js`.
 *
 * PoC for issue #343; not API. Everything here is throwaway.
 *
 * Scheme under test:
 * - the key of every `useState` call is `root/<segment>/…/<segment>#<hookIndex>`;
 * - a function component segment is `<Type>@<slot>`, or `<Type>:<key>` when the element has a key;
 * - a Voltra host primitive is a segment too (`<HostName>@<slot>` / `<HostName>:<key>`);
 * - a nested array of children is a new level `[]@<slot>`; holes (`null`, `false`, `undefined`)
 *   keep their slot, so siblings do not shift; keys are scoped per level, and a duplicate key
 *   records a warning and falls back to the slot;
 * - the hook counter resets to 0 for every function component call;
 * - mark & sweep: every `useState` marks its key as seen, a successful commit writes the pending
 *   updates and deletes `store − seen` (scoped per variant when the variant prefix is on), and a
 *   pass in which a render threw does not commit at all.
 *
 * The walker in `renderer.ts` threads a {@link PositionalCursor} through its rendering context
 * only while a positional slot is installed; without a slot nothing changes.
 */

/** PoC for issue #343; not API. Where the walker is: path of the parent segment and slot here. */
export type PositionalCursor = {
  /** Path of the enclosing segment, e.g. `root/TodoList@0/Column@0`. */
  path: string
  /** Index of the node being rendered within its level (holes included). */
  slot: number
  /** True when an array at this position is the level itself (the children list of a segment). */
  level: boolean
  /** Keys already used at this level (duplicate detection). */
  keys: Set<string>
}

/** PoC for issue #343; not API. A control with an author `id` emitted under a function component. */
export type PositionalControl = {
  componentPath: string
  hookKeys: string[]
}

/** PoC for issue #343; not API. `dev` keeps function names, `release` simulates minification. */
export type PositionalNameMode = 'dev' | 'release'

type ComponentFrame = {
  path: string
  hookIndex: number
  frozen: boolean
  hookKeys: string[]
}

type PositionalSlot = {
  root: string
  mode: PositionalNameMode
  replay: boolean
  data: Record<string, unknown>
  pending: Record<string, unknown>
  values: Record<string, unknown>
  seen: Set<string>
  controls: Record<string, PositionalControl>
  warnings: string[]
  frames: ComponentFrame[]
}

let currentSlot: PositionalSlot | null = null

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

/** PoC for issue #343; not API. Root cursor for a variant render, or `undefined` without a slot. */
export const poc343RootCursor = (): PositionalCursor | undefined =>
  currentSlot ? poc343LevelCursor(currentSlot.root) : undefined

/** PoC for issue #343; not API. Cursor for the children (one level) of the segment at `path`. */
export const poc343LevelCursor = (path: string): PositionalCursor => ({
  path,
  slot: 0,
  level: true,
  keys: new Set<string>(),
})

/** PoC for issue #343; not API. Cursor for item `index` of an array level at `levelPath`. */
export const poc343ArrayItemCursor = (levelPath: string, index: number, keys: Set<string>): PositionalCursor => ({
  path: levelPath,
  slot: index,
  level: false,
  keys,
})

/** PoC for issue #343; not API. Path of the level an array rendered at `cursor` opens. */
export const poc343ArrayLevelPath = (cursor: PositionalCursor): string =>
  cursor.level ? cursor.path : `${cursor.path}/[]@${cursor.slot}`

/**
 * PoC for issue #343; not API. Name of a function component: `__pocId` (the build-time id the note
 * proposes, "module + export") when present, otherwise `displayName || name` in dev and `t` in
 * release (every name mangled to the same short token).
 */
export const poc343TypeName = (type: unknown): string => {
  const fn = type as { __pocId?: unknown; displayName?: unknown; name?: unknown }
  if (typeof fn.__pocId === 'string' && fn.__pocId.length > 0) {
    return fn.__pocId
  }
  if (currentSlot?.mode === 'release') {
    return 't'
  }
  if (typeof fn.displayName === 'string' && fn.displayName.length > 0) {
    return fn.displayName
  }
  if (typeof fn.name === 'string' && fn.name.length > 0) {
    return fn.name
  }
  return 'Anonymous'
}

/**
 * PoC for issue #343; not API. Full path of the segment `typeName` placed at `cursor`, honouring
 * the element key (scoped per level; a duplicate key warns and falls back to the slot).
 */
export const poc343SegmentPath = (
  cursor: PositionalCursor,
  typeName: string,
  key: string | number | bigint | null | undefined
): string => {
  let segment = `${typeName}@${cursor.slot}`
  if (key !== null && key !== undefined) {
    const keyString = String(key)
    if (cursor.keys.has(keyString)) {
      currentSlot?.warnings.push(
        `duplicate key "${keyString}" under ${cursor.path}: falling back to slot ${cursor.slot}`
      )
    } else {
      cursor.keys.add(keyString)
      segment = `${typeName}:${keyString}`
    }
  }
  return `${cursor.path}/${segment}`
}

/** PoC for issue #343; not API. Pushes a function component frame (hook counter at 0). */
export const poc343EnterComponent = (path: string): ComponentFrame | undefined => {
  if (!currentSlot) {
    return undefined
  }
  const frame: ComponentFrame = { path, hookIndex: 0, frozen: false, hookKeys: [] }
  currentSlot.frames.push(frame)
  return frame
}

/**
 * PoC for issue #343; not API. Freezes the counter once the component body returned, so render
 * props (Context.Consumer children) called later by the walker cannot advance it.
 */
export const poc343FreezeComponent = (frame: ComponentFrame): void => {
  frame.frozen = true
}

/** PoC for issue #343; not API. Pops the frame pushed by {@link poc343EnterComponent}. */
export const poc343ExitComponent = (frame: ComponentFrame): void => {
  const frames = currentSlot?.frames
  if (frames && frames[frames.length - 1] === frame) {
    frames.pop()
  }
}

/**
 * PoC for issue #343; not API. Records a host control with an author `id`: it belongs to the nearest
 * function component on the path that holds state (the component whose setter a replayed tap
 * handler would call), so a hookless row under a stateful parent maps to the parent.
 */
export const poc343RecordControl = (id: string): void => {
  const frames = currentSlot?.frames
  if (!currentSlot || !frames || frames.length === 0) {
    return
  }
  let frame = frames[frames.length - 1]
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index].hookKeys.length > 0) {
      frame = frames[index]
      break
    }
  }
  currentSlot.controls[id] = { componentPath: frame.path, hookKeys: frame.hookKeys }
}

type SetStateAction<S> = S | ((previous: S) => S)

/**
 * PoC for issue #343; not API. The positional `useState` the walker installs into the hooks
 * dispatcher of every function component while a slot is active.
 */
export function poc343UseState<S>(initial?: S | (() => S)): [S, (action: SetStateAction<S>) => void] {
  const resolveInitial = (): S => (typeof initial === 'function' ? (initial as () => S)() : (initial as S))
  const slot = currentSlot
  const frame = slot?.frames[slot.frames.length - 1]

  if (!slot || !frame) {
    return [resolveInitial(), () => {}]
  }

  if (frame.frozen) {
    slot.warnings.push(`useState called after ${frame.path} returned (render prop): not keyed, not marked`)
    return [resolveInitial(), () => {}]
  }

  const key = `${frame.path}#${frame.hookIndex}`
  frame.hookIndex += 1
  frame.hookKeys.push(key)
  slot.seen.add(key)

  const value = hasOwn(slot.data, key) ? (slot.data[key] as S) : resolveInitial()
  slot.values[key] = value

  const setter = (action: SetStateAction<S>): void => {
    if (!slot.replay) {
      slot.warnings.push(`setState outside a tap replay ignored for ${key}`)
      return
    }
    const current = hasOwn(slot.pending, key) ? (slot.pending[key] as S) : value
    slot.pending[key] = typeof action === 'function' ? (action as (previous: S) => S)(current) : action
  }

  return [value, setter]
}

/** PoC for issue #343; not API. Options of {@link createPositionalStore}. */
export type PositionalStoreOptions = {
  /** Name mode for function components (default `dev`). */
  mode?: PositionalNameMode
  /** Prefix keys with `<variant>/` and sweep only the variants rendered in a pass (default false). */
  variantPrefix?: boolean
  /** Delete `store − seen` on commit (default true). */
  sweep?: boolean
  /** Initial persisted record. */
  data?: Record<string, unknown>
}

/** PoC for issue #343; not API. Result of {@link PositionalStore.commit}. */
export type PositionalCommitResult = {
  aborted: boolean
  written: string[]
  deleted: string[]
}

/** PoC for issue #343; not API. The native per-widget store, simulated. */
export type PositionalStore = {
  /** The persisted record (mutated only by `commit`). */
  readonly data: Record<string, unknown>
  /** Keys marked in the current pass. */
  readonly seen: Set<string>
  /** Controls with an author `id` from the last render. */
  readonly controls: Record<string, PositionalControl>
  /** Updates waiting for `commit`. */
  readonly pending: Record<string, unknown>
  readonly warnings: string[]
  /** Renders `fn` with the slot installed; `replay` lets setters write `pending`. */
  render: <T>(variant: string, fn: () => T, options?: { replay?: boolean }) => T
  /** Simulates a tap on control `id`: writes `pending[firstHookKey]` (value or updater). */
  tap: (id: string, action: unknown) => string
  /** Writes pending updates and sweeps unseen keys; aborts when a render of the pass threw. */
  commit: () => PositionalCommitResult
}

/** PoC for issue #343; not API. Creates a simulated native store for one widget instance. */
export const createPositionalStore = (options: PositionalStoreOptions = {}): PositionalStore => {
  const mode = options.mode ?? 'dev'
  const variantPrefix = options.variantPrefix ?? false
  const sweep = options.sweep ?? true
  const data: Record<string, unknown> = { ...options.data }
  let pending: Record<string, unknown> = {}
  let seen = new Set<string>()
  let variants = new Set<string>()
  let failed = false
  let rendered = false
  let controls: Record<string, PositionalControl> = {}
  let values: Record<string, unknown> = {}
  const warnings: string[] = []

  const render = <T>(variant: string, fn: () => T, renderOptions?: { replay?: boolean }): T => {
    const slot: PositionalSlot = {
      root: variantPrefix ? variant : 'root',
      mode,
      replay: renderOptions?.replay ?? false,
      data,
      pending,
      values: {},
      seen,
      controls: {},
      warnings,
      frames: [],
    }
    const previous = currentSlot
    currentSlot = slot
    variants.add(variant)
    rendered = true
    try {
      const result = fn()
      controls = slot.controls
      values = slot.values
      return result
    } catch (error) {
      failed = true
      throw error
    } finally {
      currentSlot = previous
    }
  }

  const tap = (id: string, action: unknown): string => {
    const control = controls[id]
    if (!control || control.hookKeys.length === 0) {
      throw new Error(`tap: no stateful control "${id}" in the last render`)
    }
    const key = control.hookKeys[0]
    const current = hasOwn(pending, key) ? pending[key] : values[key]
    pending[key] = typeof action === 'function' ? (action as (previous: unknown) => unknown)(current) : action
    return key
  }

  const resetPass = () => {
    pending = {}
    seen = new Set<string>()
    variants = new Set<string>()
    failed = false
    rendered = false
  }

  const commit = (): PositionalCommitResult => {
    if (failed) {
      resetPass()
      return { aborted: true, written: [], deleted: [] }
    }
    const written = Object.keys(pending)
    for (const key of written) {
      data[key] = pending[key]
    }
    const deleted: string[] = []
    if (sweep && rendered) {
      for (const key of Object.keys(data)) {
        const inScope = !variantPrefix || [...variants].some((variant) => key.startsWith(`${variant}/`))
        if (inScope && !seen.has(key)) {
          delete data[key]
          deleted.push(key)
        }
      }
    }
    resetPass()
    return { aborted: false, written, deleted }
  }

  return {
    data,
    get seen() {
      return seen
    },
    get controls() {
      return controls
    },
    get pending() {
      return pending
    },
    warnings,
    render,
    tap,
    commit,
  }
}

/**
 * PoC for issue #343; not API. The positional strategy as one object, so nothing here looks like
 * public API: `createPositionalStore` installs the slot the walker reads.
 */
export const __poc343Positional = {
  createPositionalStore,
  useState: poc343UseState,
}
