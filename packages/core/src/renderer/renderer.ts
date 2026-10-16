import {
  ComponentType,
  ConsumerProps,
  Context,
  ForwardRefExoticComponent,
  FunctionComponent,
  LazyExoticComponent,
  MemoExoticComponent,
  ProviderProps,
  ReactElement,
  ReactNode,
} from 'react'
import {
  isContextConsumer,
  isContextProvider,
  isForwardRef,
  isFragment,
  isLazy,
  isMemo,
  isPortal,
  isProfiler,
  isStrictMode,
  isSuspense,
} from 'react-is'

import { isVoltraComponent } from '../jsx/createVoltraComponent.js'
import { shorten } from '../payload/short-names.js'
import { VoltraElementRef, VoltraNodeJson, VoltraPropValue } from '../types.js'
import { ContextRegistry, getContextRegistry } from './context-registry.js'
import { getHooksDispatcher, getReactCurrentDispatcher } from './dispatcher.js'
import { encodeNativeModifiers } from './native-modifiers.js'
import { createElementRegistry, type ElementRegistry, preScanForDuplicates } from './element-registry.js'
import { flattenStyle } from './flatten-styles.js'
import { getRenderCache, type RenderCache } from './render-cache.js'
import { createStylesheetRegistry, type StylesheetRegistry } from './stylesheet-registry.js'
import {
  poc343ArrayItemCursor,
  poc343ArrayLevelPath,
  poc343EnterComponent,
  poc343ExitComponent,
  poc343FreezeComponent,
  poc343LevelCursor,
  poc343RecordControl,
  poc343RootCursor,
  poc343SegmentPath,
  poc343TypeName,
  poc343UseState,
  type PositionalCursor,
} from './voltra-state-positional.js'
import { getVoltraStateReplay } from './voltra-state.js'

export type ComponentRegistry = {
  getComponentId: (name: string) => number
}

// `__DEV__` is provided by Metro/React Native bundles as a global boolean. It
// isn't declared by this package (which has no react-native dependency), so
// we declare it locally — this only introduces an ambient binding scoped to
// this module, not a real global declaration.
declare const __DEV__: boolean | undefined

const isDevEnvironment = (): boolean => {
  if (typeof __DEV__ !== 'undefined') {
    return Boolean(__DEV__)
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV !== 'production'
  }
  return false
}

type VoltraRenderingContext = {
  registry: ContextRegistry
  stylesheetRegistry?: StylesheetRegistry
  elementRegistry?: ElementRegistry
  duplicates?: Set<ReactNode>
  inStringOnlyContext?: boolean
  componentRegistry: ComponentRegistry
  /** PoC for issue #343; not API. Set only while a positional state slot is active. */
  poc343?: PositionalCursor
}

function renderNode(element: ReactNode, context: VoltraRenderingContext): VoltraNodeJson {
  if (element === null || element === undefined) {
    return []
  }

  if (typeof element === 'boolean') {
    if (context.inStringOnlyContext) {
      return ''
    }
    return []
  }

  if (typeof element === 'string') {
    if (context.inStringOnlyContext) {
      return element
    }
    throw new Error(
      'Expected a React element, but got "string". Strings are only allowed as children of Text components.'
    )
  }

  if (typeof element === 'number' || typeof element === 'bigint') {
    if (context.inStringOnlyContext) {
      return String(element)
    }
    throw new Error(`Expected a React element, but got "${typeof element}".`)
  }

  if (Array.isArray(element)) {
    if (context.inStringOnlyContext) {
      if (element.length === 0) {
        throw new Error('Text component must have at least one child that resolves to a string.')
      }
      const results: string[] = []
      for (const child of element) {
        const result = renderNode(child, context)
        if (Array.isArray(result) && result.length === 0) {
          continue
        }
        if (typeof result !== 'string') {
          throw new Error('Text component children must resolve to strings.')
        }
        results.push(result)
      }
      return results.join('')
    }
    const cursor = context.poc343
    if (cursor) {
      // PoC #343: every item (holes included) keeps its index as its slot.
      const levelPath = poc343ArrayLevelPath(cursor)
      const keys = new Set<string>()
      return element
        .map((child, index) => renderNode(child, { ...context, poc343: poc343ArrayItemCursor(levelPath, index, keys) }))
        .flat() as VoltraNodeJson
    }
    return element.map((child) => renderNode(child, context)).flat() as VoltraNodeJson
  }

  if (context.duplicates?.has(element) && context.elementRegistry) {
    const existingIndex = context.elementRegistry.isRegistered(element)
    if (existingIndex !== undefined) {
      return { $r: existingIndex } as VoltraElementRef
    }

    const rendered = renderNodeInternal(element, context)
    const index = context.elementRegistry.register(element, rendered)
    return { $r: index } as VoltraElementRef
  }

  return renderNodeInternal(element, context)
}

function renderNodeInternal(element: ReactNode, context: VoltraRenderingContext): VoltraNodeJson {
  if (typeof element !== 'object' || element === null) {
    throw new Error(`Expected element-like object with type and props, got ${typeof element}`)
  }

  if (!('type' in element) || !('props' in element)) {
    throw new Error(`Expected element-like object with type and props, got ${typeof element}`)
  }

  if (typeof element.type === 'string') {
    throw new Error(`Host component "${element.type}" is not supported in Voltra.`)
  }

  if (isStrictMode(element)) {
    throw new Error('Strict mode is not supported in Voltra.')
  }
  if (isProfiler(element)) {
    throw new Error('Profiler is not supported in Voltra.')
  }
  if (isSuspense(element)) {
    throw new Error('Suspense is not supported in Voltra.')
  }
  if (isPortal(element) || (element as { type?: unknown }).type === Symbol.for('react.portal')) {
    throw new Error('Portal is not supported in Voltra.')
  }

  if (isFragment(element) || (element as { type?: unknown }).type === Symbol.for('react.fragment')) {
    const fragmentElement = element as ReactElement<{ children?: ReactNode }>
    return renderNode(fragmentElement.props.children, context)
  }

  if (isMemo(element)) {
    const memoElement = element as ReactElement<unknown, MemoExoticComponent<ComponentType<unknown>>>
    const { type: memoizedComponent } = memoElement.type
    return renderNode({ ...memoElement, type: memoizedComponent }, context)
  }

  if (isForwardRef(element)) {
    const forwardRefElement = element as ReactElement<unknown, ForwardRefExoticComponent<ComponentType<unknown>>>
    const { render } = forwardRefElement.type as unknown as { render: (props: unknown) => ReactNode }
    return renderFunctionalComponent(render, forwardRefElement.props, context, forwardRefElement.key)
  }

  if (isLazy(element)) {
    const lazyElement = element as ReactElement<unknown, LazyExoticComponent<ComponentType<unknown>>>
    const lazyType = lazyElement.type as unknown as {
      _init?: (payload: unknown) => ComponentType<unknown>
      _payload?: unknown
    }

    if (typeof lazyType._init !== 'function') {
      throw new Error('Lazy component could not be resolved by the Voltra renderer.')
    }

    try {
      const resolvedType = lazyType._init(lazyType._payload)
      return renderNode({ ...lazyElement, type: resolvedType }, context)
    } catch (error) {
      if (error instanceof Promise) {
        throw new Error('Lazy component suspended! Voltra does not support Suspense/Promises.')
      }

      throw error
    }
  }

  if (isContextProvider(element)) {
    const contextProviderElement = element as ReactElement<ProviderProps<unknown>>
    const reactContext = contextProviderElement.type as Context<unknown>
    const { value, children } = contextProviderElement.props
    context.registry.pushProvider(reactContext, value)
    const result = renderNode(children, context)
    context.registry.popProvider(reactContext)
    return result
  }

  if (isContextConsumer(element)) {
    const contextConsumerElement = element as ReactElement<ConsumerProps<unknown>>
    const reactContext = (contextConsumerElement.type as unknown as { _context: Context<unknown> })._context
    const value = context.registry.readContext(reactContext)
    const children = contextConsumerElement.props.children

    if (typeof children === 'function') {
      return renderNode(children(value), context)
    }

    throw new Error(`Expected a function as children of a context consumer, but got "${typeof children}".`)
  }

  if (
    element != null &&
    typeof element === 'object' &&
    'type' in element &&
    'props' in element &&
    typeof (element as { type: unknown }).type === 'function'
  ) {
    const reactElement = element as ReactElement
    const componentType = reactElement.type as FunctionComponent<unknown>

    if (componentType.prototype && 'render' in componentType.prototype) {
      throw new Error('Class components are not supported in Voltra.')
    }

    if (isVoltraComponent(componentType)) {
      const child = componentType(reactElement.props)

      if (typeof child !== 'object' || child === null || !('type' in child) || !('props' in child)) {
        throw new Error(`Expected a React element, but got "${typeof child}".`)
      }

      if (typeof child.type !== 'string') {
        throw new Error(`Expected a string as the type of a React element, but got "${typeof child.type}".`)
      }

      const { children, ...parameters } = child.props as { children?: ReactNode; [key: string]: unknown }
      const replay = getVoltraStateReplay()
      if (replay !== null) {
        poc343ReplayHandler(replay, reactElement.props as Record<string, unknown>)
      }
      const isTextComponent = child.type === 'Text' || child.type === 'AndroidText'
      // PoC #343: a host primitive is a segment; its children and element-valued props are levels below it.
      const hostPath = context.poc343
        ? poc343SegmentPath(context.poc343, componentType.displayName, reactElement.key)
        : undefined
      const propsContext: VoltraRenderingContext =
        hostPath !== undefined ? { ...context, poc343: poc343LevelCursor(hostPath) } : context
      const childContext: VoltraRenderingContext = {
        ...context,
        inStringOnlyContext: isTextComponent,
        ...(hostPath !== undefined ? { poc343: poc343LevelCursor(hostPath) } : {}),
      }
      const renderedChildren =
        children !== null && children !== undefined ? renderNode(children, childContext) : isTextComponent ? '' : []

      const id = typeof parameters.id === 'string' ? parameters.id : undefined
      const { id: _id, ...cleanParameters } = parameters
      if (hostPath !== undefined && id) {
        poc343RecordControl(id)
      }

      if (isDevEnvironment() && !isTextComponent) {
        componentType.validate?.({
          props: cleanParameters,
          children: Array.isArray(renderedChildren) ? renderedChildren : [],
        })
      }

      if (isTextComponent) {
        if (typeof renderedChildren !== 'string') {
          throw new Error(
            'Text component children must resolve to a string. Nested components are allowed, but they must eventually resolve to a string.'
          )
        }

        const transformedProps = transformProps(cleanParameters, propsContext)
        const hasProps = Object.keys(transformedProps).length > 0

        return {
          t: context.componentRegistry.getComponentId(child.type),
          ...(id ? { i: id } : {}),
          c: renderedChildren,
          ...(hasProps ? { p: transformedProps } : {}),
        }
      }

      if (typeof renderedChildren === 'string') {
        throw new Error('Unexpected string in non-Text component children.')
      }

      const transformedProps = transformProps(cleanParameters, propsContext)
      const hasProps = Object.keys(transformedProps).length > 0
      const hasChildren = Array.isArray(renderedChildren) ? renderedChildren.length > 0 : true

      return {
        t: context.componentRegistry.getComponentId(child.type),
        ...(id ? { i: id } : {}),
        ...(hasChildren ? { c: renderedChildren } : {}),
        ...(hasProps ? { p: transformedProps } : {}),
      }
    }

    return renderFunctionalComponent(componentType, reactElement.props, context, reactElement.key)
  }

  throw new Error(
    `Unsupported element type "${String(
      (element as { type?: unknown }).type
    )}". Report this as a bug in the Voltra project.`
  )
}

/**
 * PoC for issue #343; not API. During a tap replay, records the inline handler of the host element
 * whose author `id` equals the tapped `componentId`: `onCheckedChange(value)` for toggles, else
 * `onPress()` for buttons. The handler is not called here: `runWithVoltraStateReplay` calls it
 * after the walk, so it sees every closure the render produced. Only the first matching element
 * is considered, and an empty `componentId` never matches.
 */
function poc343ReplayHandler(
  replay: NonNullable<ReturnType<typeof getVoltraStateReplay>>,
  authorProps: Record<string, unknown>
): void {
  const componentId = replay.event.componentId
  if (replay.matched || componentId === '' || authorProps.id !== componentId) {
    return
  }

  replay.matched = true
  const { onCheckedChange, onPress } = authorProps
  const value = replay.event.value

  if (typeof onCheckedChange === 'function') {
    replay.matchedHandler = () => {
      onCheckedChange(value)
    }
  } else if (typeof onPress === 'function') {
    replay.matchedHandler = () => {
      onPress()
    }
  }
}

export const renderFunctionalComponent = <TProps>(
  Component: FunctionComponent<TProps>,
  props: TProps,
  context: VoltraRenderingContext,
  /** PoC for issue #343; not API. The element key, used only by the positional slot. */
  elementKey?: string | null
): VoltraNodeJson => {
  const reactDispatcher = getReactCurrentDispatcher()
  const prevHooksDispatcher = reactDispatcher.H
  // PoC #343: push the component segment with a hook counter at 0 (only with a positional slot).
  const componentPath = context.poc343
    ? poc343SegmentPath(context.poc343, poc343TypeName(Component), elementKey)
    : undefined
  const frame = componentPath !== undefined ? poc343EnterComponent(componentPath) : undefined

  try {
    const hooksDispatcher = getHooksDispatcher(context.registry)
    if (frame) {
      hooksDispatcher.useState = poc343UseState
    }
    reactDispatcher.H = hooksDispatcher
    const result = Component(props)

    if (result instanceof Promise) {
      throw new Error(
        `Component "${
          Component.name || 'Anonymous'
        }" tried to suspend (returned a Promise). Async components are not supported in this synchronous renderer.`
      )
    }

    if (frame && componentPath !== undefined) {
      poc343FreezeComponent(frame)
      return renderNode(result, { ...context, poc343: poc343LevelCursor(componentPath) })
    }

    return renderNode(result, context)
  } catch (error) {
    if (error instanceof Promise) {
      throw new Error(
        `Component "${Component.name || 'Anonymous'}" suspended! Voltra does not support Suspense/Promises.`
      )
    }

    throw error
  } finally {
    reactDispatcher.H = prevHooksDispatcher
    if (frame) {
      poc343ExitComponent(frame)
    }
  }
}

export const renderVariantToJson = (element: ReactNode, componentRegistry: ComponentRegistry): VoltraNodeJson => {
  const registry = getContextRegistry()
  const context: VoltraRenderingContext = {
    registry,
    componentRegistry,
  }
  const rootCursor = poc343RootCursor()
  if (rootCursor) {
    context.poc343 = rootCursor
  }

  return renderNode(element, context)
}

function compressStyleObject(style: any): any {
  if (style === null || style === undefined) {
    return style
  }

  const flattened = flattenStyle(style)
  const compressed: Record<string, any> = {}

  for (const [key, value] of Object.entries(flattened)) {
    const shortKey = shorten(key)

    if (value === null || value === undefined) {
      continue
    }

    if (typeof value === 'object' && !Array.isArray(value) && value.constructor === Object) {
      const compressedNested: Record<string, any> = {}
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        compressedNested[nestedKey] = nestedValue
      }
      compressed[shortKey] = compressedNested
    } else {
      compressed[shortKey] = value
    }
  }

  return compressed
}

function isReactNode(value: unknown): value is ReactNode {
  if (value === null || value === undefined || value === false || value === true) {
    return false
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return false
  }
  if (Array.isArray(value)) {
    return true
  }
  if (typeof value === 'object' && value !== null && 'type' in value && 'props' in value) {
    return true
  }
  return false
}

export function transformProps(
  props: Record<string, unknown>,
  context: VoltraRenderingContext
): Record<string, VoltraPropValue> {
  const transformed: Record<string, VoltraPropValue> = {}

  for (const [key, value] of Object.entries(props)) {
    if (key === 'style') {
      const shortKey = shorten(key)
      if (context.stylesheetRegistry) {
        const index = context.stylesheetRegistry.registerStyle(value as object)
        transformed[shortKey] = index
      } else {
        transformed[shortKey] = compressStyleObject(value)
      }
    } else if (key === 'modifiers') {
      // Native modifiers travel as a JSON-encoded string so that no parsing layer treats the
      // descriptors as children or rewrites their keys (ADR 0005).
      const encoded = encodeNativeModifiers(value)
      if (encoded !== undefined) {
        transformed[shorten(key)] = encoded
      }
    } else if (isReactNode(value)) {
      const serializedComponent = renderNode(value, {
        registry: getContextRegistry(),
        stylesheetRegistry: context.stylesheetRegistry,
        elementRegistry: context.elementRegistry,
        duplicates: context.duplicates,
        inStringOnlyContext: false,
        componentRegistry: context.componentRegistry,
        ...(context.poc343 ? { poc343: poc343LevelCursor(`${context.poc343.path}/$${key}`) } : {}),
      })
      const shortKey = shorten(key)
      transformed[shortKey] = serializedComponent
    } else {
      const shortKey = shorten(key)
      transformed[shortKey] = value as VoltraPropValue
    }
  }

  return transformed
}

export const VOLTRA_PAYLOAD_VERSION = 1

export const createVoltraRenderer = (componentRegistry: ComponentRegistry) => {
  const rootNodes: { name: string; node: ReactNode }[] = []

  let duplicates: Set<ReactNode> | undefined
  let stylesheetRegistry: StylesheetRegistry | undefined
  let elementRegistry: ElementRegistry | undefined
  let renderCache: RenderCache | undefined

  const addRootNode = (name: string, node: ReactNode): void => {
    if (node === null || node === undefined) {
      return
    }
    rootNodes.push({ name, node })
  }

  const preScanAllNodes = (): Set<ReactNode> => {
    const seen = new Set<ReactNode>()
    const duplicatesSet = new Set<ReactNode>()

    for (const { node } of rootNodes) {
      if (node && typeof node === 'object') {
        if (seen.has(node)) {
          duplicatesSet.add(node)
        } else {
          seen.add(node)
        }
      }

      const nodeDuplicates = preScanForDuplicates(node)
      for (const dup of nodeDuplicates) {
        duplicatesSet.add(dup)
      }
    }

    return duplicatesSet
  }

  const render = (): Record<string, any> => {
    stylesheetRegistry = createStylesheetRegistry()
    elementRegistry = createElementRegistry()
    duplicates = preScanAllNodes()

    const renderVariantToJson = (element: ReactNode): VoltraNodeJson => {
      const registry = getContextRegistry()
      const context: VoltraRenderingContext = {
        registry,
        stylesheetRegistry,
        elementRegistry,
        duplicates,
        componentRegistry,
      }
      const rootCursor = poc343RootCursor()
      if (rootCursor) {
        context.poc343 = rootCursor
      }
      return renderNode(element, context)
    }

    renderCache = getRenderCache(renderVariantToJson)

    const result: Record<string, any> = {
      v: VOLTRA_PAYLOAD_VERSION,
    }

    for (const { name, node } of rootNodes) {
      if (node !== null && node !== undefined) {
        result[name] = renderCache.getOrRender(node)
      }
    }

    const sharedElements = elementRegistry.getElements()
    if (sharedElements.length > 0) {
      result.e = sharedElements
    }

    const styles = stylesheetRegistry.getStyles()
    if (styles.length > 0) {
      result.s = styles
    }

    return result
  }

  return {
    addRootNode,
    render,
  }
}
