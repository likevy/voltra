import { useVoltraStateTuple, VoltraAndroid, type WidgetEnvironment } from '@use-voltra/android'

// PoC for issue #343 (hybrid): the state is written by inline setters, the way a React author
// would write it. `useVoltraStateTuple` returns `[value, setValue]`; the handlers below call the
// setters. Handlers cannot cross to native, so a tap is handled by a replay: the host calls the
// generated `interact`, which re-runs this render with the tap event, calls the `onCheckedChange`
// or `onPress` of the element whose `id` was tapped, collects what the setters wrote as a state
// patch and discards the replay output. The host merges the patch and re-renders, as for
// `onInteraction`. That is why every control with a handler has an `id`, and why this file has no
// `onInteraction` and no other named export (it stays a Fast Refresh boundary). Outside a tap the
// setters do nothing. Not API: the names are what the ADR decides on.

type TodoItem = { id: string; title: string }

type TodoStateSetterWidgetProps = {
  items?: TodoItem[]
}

const DEFAULT_TODO_ITEMS: TodoItem[] = [
  { id: 't1', title: 'Buy 🍞' },
  { id: 't2', title: 'Water the plants' },
  { id: 't3', title: 'Call the dentist' },
]

// Jetpack Glance drops a Column's children past 10, so the list stays well under that.
const MAX_VISIBLE_ITEMS = 6

// The generated CheckBox/Switch/FilledButton prop types have no inline handlers yet (the ADR
// decides the real props), so they are passed through local casts. The renderer forwards unknown
// props, and the replay reads them from the element before serialization drops the functions.
const onCheckedChangeProp = (onCheckedChange: (checked: boolean) => void) => ({ onCheckedChange } as object)
const onPressProp = (onPress: () => void) => ({ onPress } as object)

export default function TodoStateSetterWidget(
  props: TodoStateSetterWidgetProps = {},
  env: WidgetEnvironment = {} as WidgetEnvironment
) {
  // Called at the top level on purpose: the value is the record the host handed in for this
  // render, and the setter only records a patch while a tap is being replayed.
  const [done, setDone] = useVoltraStateTuple<Record<string, boolean>>('done', {})
  const [showCompleted, setShowCompleted] = useVoltraStateTuple('showCompleted', true)

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
        Todo · inline setters
      </VoltraAndroid.Text>
      <VoltraAndroid.Column style={{ width: '100%' }}>
        {visibleItems.map((item) => (
          <VoltraAndroid.CheckBox
            key={item.id}
            id={'task:' + item.id}
            text={item.title}
            checked={!!done[item.id]}
            {...onCheckedChangeProp((checked: boolean) => setDone((d) => ({ ...d, [item.id]: checked })))}
          />
        ))}
      </VoltraAndroid.Column>
      <VoltraAndroid.Switch
        id="showCompleted"
        text="Show completed"
        checked={showCompleted}
        {...onCheckedChangeProp((v: boolean) => setShowCompleted(v))}
      />
      <VoltraAndroid.Text style={{ fontSize: 11, color: muted }}>
        {`${doneCount} of ${items.length} done`}
      </VoltraAndroid.Text>
      <VoltraAndroid.FilledButton id="clear" text="Clear all" {...onPressProp(() => setDone({}))} />
    </VoltraAndroid.Column>
  )
}
