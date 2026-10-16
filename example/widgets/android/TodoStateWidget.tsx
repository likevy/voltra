import { useVoltraState, VoltraAndroid, type WidgetEnvironment } from '@use-voltra/android'

// PoC for issue #343 (option C): a tap on a task is handled inside the widget. The host calls
// `onInteraction` below in the app process, with no Activity and no React Native runtime, merges
// the returned `state` patch into this placement's state record and re-renders; the render reads
// the committed record through `useVoltraState`. Not API: the names are what the ADR decides on.

export type TodoItem = { id: string; title: string }

export type TodoStateWidgetProps = {
  items?: TodoItem[]
}

type TodoState = {
  done: Record<string, boolean>
  showCompleted: boolean
}

// The PoC has no public types for the tap event or the handler context, so they are spelled out
// here from what the native host sends.
type VoltraInteractionEvent = {
  componentId: string
  componentType: 'checkbox' | 'switch' | 'button'
  value: boolean | null
  renderedRevision: number
  stateKey: string | null
  timestamp: number
}

type TodoInteractionContext = {
  props: TodoStateWidgetProps
  state: Partial<TodoState>
  env: WidgetEnvironment
}

const DEFAULT_TODO_ITEMS: TodoItem[] = [
  { id: 't1', title: 'Buy 🍞' },
  { id: 't2', title: 'Water the plants' },
  { id: 't3', title: 'Call the dentist' },
]

// Jetpack Glance drops a Column's children past 10, so the list stays well under that.
const MAX_VISIBLE_ITEMS = 6

export default function TodoStateWidget(
  props: TodoStateWidgetProps = {},
  env: WidgetEnvironment = {} as WidgetEnvironment
) {
  // Called at the top level on purpose: `useVoltraState` reads the record the host handed in for
  // this render, not React's dispatcher, so it also works at prerender and in plain calls.
  const done = useVoltraState<Record<string, boolean>>('done', {})
  const showCompleted = useVoltraState('showCompleted', true)

  const items = props.items ?? DEFAULT_TODO_ITEMS
  const doneCount = items.filter((item) => done[item.id] === true).length
  const visibleItems = items.filter((item) => showCompleted || !done[item.id]).slice(0, MAX_VISIBLE_ITEMS)

  const isDark = env.colorScheme === 'dark'
  const foreground = isDark ? '#F8FAFC' : '#0F172A'
  const muted = isDark ? '#94A3B8' : '#475569'

  return (
    <VoltraAndroid.Column
      style={{
        width: '100%',
        height: '100%',
        padding: 12,
        borderRadius: 16,
        backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
      }}
      modifiers={[VoltraAndroid.modifiers.appWidgetBackground()]}
    >
      <VoltraAndroid.Text style={{ fontSize: 14, fontWeight: '700', color: foreground }}>
        Todo · onInteraction
      </VoltraAndroid.Text>
      <VoltraAndroid.Column style={{ width: '100%' }}>
        {visibleItems.map((item) => (
          <VoltraAndroid.CheckBox key={item.id} id={'task:' + item.id} text={item.title} checked={!!done[item.id]} />
        ))}
      </VoltraAndroid.Column>
      <VoltraAndroid.Switch id="showCompleted" text="Show completed" checked={showCompleted} />
      <VoltraAndroid.Text style={{ fontSize: 11, color: muted }}>
        {`${doneCount} of ${items.length} done`}
      </VoltraAndroid.Text>
    </VoltraAndroid.Column>
  )
}

// Runs on a tap, in the app process, never during render. The returned `state` is a shallow
// patch the host merges into the placement's record before it re-renders.
export function onInteraction(event: VoltraInteractionEvent, ctx: TodoInteractionContext) {
  if (event.componentId.startsWith('task:')) {
    return { state: { done: { ...ctx.state.done, [event.componentId.slice(5)]: event.value === true } } }
  }
  if (event.componentId === 'showCompleted') {
    return { state: { showCompleted: event.value === true } }
  }
  return undefined
}
