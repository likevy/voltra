export { type ContextRegistry, getContextRegistry } from './context-registry.js'
export { getHooksDispatcher, getReactCurrentDispatcher } from './dispatcher.js'
export { createElementRegistry, type ElementRegistry, preScanForDuplicates } from './element-registry.js'
export { flattenStyle } from './flatten-styles.js'
export { getRenderCache, type RenderCache } from './render-cache.js'
export {
  type ComponentRegistry,
  createVoltraRenderer,
  renderVariantToJson,
  transformProps,
  VOLTRA_PAYLOAD_VERSION,
} from './renderer.js'
export { createStylesheetRegistry, type StylesheetRegistry } from './stylesheet-registry.js'
export type { NativeModifiersProp, NoNativeModifier } from './native-modifiers.js'
export type { VoltraVariantRenderer } from './types.js'
export {
  type RunWithVoltraStateOptions,
  runWithVoltraState,
  runWithVoltraStateReplay,
  takeVoltraStateWarnings,
  useVoltraState,
  useVoltraStateTuple,
  type VoltraStateRecord,
  type VoltraStateReplayEvent,
  type VoltraStateReplayResult,
  type VoltraStateSetter,
} from './voltra-state.js'
/** PoC for issue #343; not API. The positional useState design note, for the identity harness only. */
export {
  __poc343Positional,
  type PositionalCommitResult as Poc343PositionalCommitResult,
  type PositionalStore as Poc343PositionalStore,
  type PositionalStoreOptions as Poc343PositionalStoreOptions,
} from './voltra-state-positional.js'
