import { useVoltraState, VoltraAndroid, type WidgetEnvironment } from '@use-voltra/android'

// PoC for issue #343 (option D): every toggle carries a `stateKey`, and the host writes
// `state[stateKey] = checked` natively on a tap, then re-renders. No JS runs on the tap path, so
// this widget exports no `onInteraction`. Not API: the names are what the ADR decides on.

export type TodoItem = { id: string; title: string }

export type TodoStateKeyWidgetProps = {
  items?: TodoItem[]
}

const DEFAULT_TODO_ITEMS: TodoItem[] = [
  { id: 't1', title: 'Buy 🍞' },
  { id: 't2', title: 'Water the plants' },
  { id: 't3', title: 'Call the dentist' },
]

// Jetpack Glance drops a Column's children past 10, so the list stays well under that.
const MAX_VISIBLE_ITEMS = 6

// `stateKey` is not in the generated CheckBox/Switch prop types yet (the ADR decides the real
// prop), so it is passed through a local cast. The renderer forwards unknown props unchanged.
const stateKeyProp = (stateKey: string) => ({ stateKey } as object)

export default function TodoStateKeyWidget(
  props: TodoStateKeyWidgetProps = {},
  env: WidgetEnvironment = {} as WidgetEnvironment
) {
  const items = props.items ?? DEFAULT_TODO_ITEMS

  // `useVoltraState` is not a React hook: it reads the record the host handed in for this render,
  // so calling it in a loop is fine. The list order comes from props and is fixed for a render.
  const done = items.map((item) => useVoltraState('done.' + item.id, false))
  const showCompleted = useVoltraState('showCompleted', true)

  const doneCount = done.filter(Boolean).length
  const visibleItems = items
    .map((item, index) => ({ item, checked: done[index] }))
    .filter(({ checked }) => showCompleted || !checked)
    .slice(0, MAX_VISIBLE_ITEMS)

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
        Todo · stateKey
      </VoltraAndroid.Text>
      <VoltraAndroid.Column style={{ width: '100%' }}>
        {visibleItems.map(({ item, checked }) => (
          <VoltraAndroid.CheckBox
            key={item.id}
            id={'task:' + item.id}
            {...stateKeyProp('done.' + item.id)}
            text={item.title}
            checked={checked}
          />
        ))}
      </VoltraAndroid.Column>
      <VoltraAndroid.Switch
        id="showCompleted"
        {...stateKeyProp('showCompleted')}
        text="Show completed"
        checked={showCompleted}
      />
      <VoltraAndroid.Text style={{ fontSize: 11, color: muted }}>
        {`${doneCount} of ${items.length} done`}
      </VoltraAndroid.Text>
    </VoltraAndroid.Column>
  )
}
