// PoC for issue #343; not API. Covers the `useVoltraState` slot read by Dynamic Widgets.
const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')

const {
  createVoltraComponent,
  createVoltraRenderer,
  renderVariantToJson,
  runWithVoltraState,
  runWithVoltraStateReplay,
  takeVoltraStateWarnings,
  useVoltraState,
  useVoltraStateTuple,
} = require('../build/cjs/index.js')

const View = createVoltraComponent('View')
const Text = createVoltraComponent('Text')
const Button = createVoltraComponent('Button')
const CheckBox = createVoltraComponent('AndroidCheckBox')
const FilledButton = createVoltraComponent('AndroidFilledButton')

const componentIds = {
  View: 1,
  Text: 2,
  Button: 3,
  AndroidCheckBox: 4,
  AndroidFilledButton: 5,
}

const componentRegistry = {
  getComponentId(name) {
    const id = componentIds[name]

    if (id === undefined) {
      throw new Error(`Unknown component: ${name}`)
    }

    return id
  },
}

const h = React.createElement

function collectTexts(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectTexts(child, out)
    }
    return out
  }

  if (node === null || typeof node !== 'object') {
    return out
  }

  if (node.t === componentIds.Text && typeof node.c === 'string') {
    out.push(node.c)
  }

  if (node.c !== undefined) {
    collectTexts(node.c, out)
  }

  if (node.p !== undefined) {
    for (const value of Object.values(node.p)) {
      collectTexts(value, out)
    }
  }

  return out
}

function TodoItem({ id, title }) {
  const done = useVoltraState(`done.${id}`, false)
  return h(View, null, h(Text, null, `${done ? '[x]' : '[ ]'} ${title}`))
}

function TodoList({ items, withKeys }) {
  return h(
    View,
    null,
    items.map((item) => h(TodoItem, withKeys ? { key: item.id, id: item.id, title: item.title } : item))
  )
}

function renderTodo(state, items, withKeys) {
  return runWithVoltraState(state, () => renderVariantToJson(h(TodoList, { items, withKeys }), componentRegistry))
}

test('returns initial when there is no state slot', () => {
  assert.equal(useVoltraState('count', 7), 7)
  assert.equal(useVoltraState('done', false), false)
  assert.deepStrictEqual(useVoltraState('list', []), [])
})

test('returns the stored value inside runWithVoltraState, including falsy values', () => {
  const state = { done: false, count: 0, label: '', on: true, nested: { a: 1 } }

  const read = runWithVoltraState(state, () => ({
    done: useVoltraState('done', true),
    count: useVoltraState('count', 5),
    label: useVoltraState('label', 'fallback'),
    on: useVoltraState('on', false),
    nested: useVoltraState('nested', null),
    missing: useVoltraState('missing', 'initial'),
  }))

  assert.deepStrictEqual(read, {
    done: false,
    count: 0,
    label: '',
    on: true,
    nested: { a: 1 },
    missing: 'initial',
  })

  const rendered = runWithVoltraState({ 'done.a': false }, () =>
    renderVariantToJson(h(TodoItem, { id: 'a', title: 'Alpha' }), componentRegistry)
  )
  assert.deepStrictEqual(collectTexts(rendered), ['[ ] Alpha'])
})

test('clears the slot even when fn throws', () => {
  assert.throws(
    () =>
      runWithVoltraState({ done: true }, () => {
        assert.equal(useVoltraState('done', false), true)
        throw new Error('render failed')
      }),
    /render failed/
  )

  assert.equal(useVoltraState('done', false), false)
})

test('nested runWithVoltraState calls for two widgets do not leak into each other', () => {
  const widgetA = { 'done.a': true, onlyA: 'a' }
  const widgetB = { 'done.b': true }
  const items = [
    { id: 'a', title: 'Alpha' },
    { id: 'b', title: 'Beta' },
  ]

  const result = runWithVoltraState(widgetA, () => {
    const before = renderVariantToJson(h(TodoList, { items }), componentRegistry)
    const inner = runWithVoltraState(widgetB, () => ({
      rendered: renderVariantToJson(h(TodoList, { items }), componentRegistry),
      onlyA: useVoltraState('onlyA', 'missing'),
    }))
    const masked = runWithVoltraState(null, () => useVoltraState('onlyA', 'missing'))
    const after = renderVariantToJson(h(TodoList, { items }), componentRegistry)
    return { before, inner, masked, after, onlyA: useVoltraState('onlyA', 'missing') }
  })

  assert.deepStrictEqual(collectTexts(result.before), ['[x] Alpha', '[ ] Beta'])
  assert.deepStrictEqual(collectTexts(result.inner.rendered), ['[ ] Alpha', '[x] Beta'])
  assert.equal(result.inner.onlyA, 'missing')
  assert.equal(result.masked, 'missing')
  assert.deepStrictEqual(result.after, result.before)
  assert.equal(result.onlyA, 'a')
  assert.equal(useVoltraState('onlyA', 'missing'), 'missing')
})

test('sees the slot in element-valued props and in every root of a multi-root render', () => {
  function Label() {
    const done = useVoltraState('done', false)
    return h(Text, null, done ? 'ticked' : 'unticked')
  }

  const tree = h(Button, { id: 'toggle', label: h(Label) })
  const rendered = runWithVoltraState({ done: true }, () => renderVariantToJson(tree, componentRegistry))

  assert.equal(rendered.t, componentIds.Button)
  assert.equal(rendered.i, 'toggle')
  assert.deepStrictEqual(Object.values(rendered.p), [{ t: componentIds.Text, c: 'ticked' }])

  const withoutState = renderVariantToJson(tree, componentRegistry)
  assert.deepStrictEqual(Object.values(withoutState.p), [{ t: componentIds.Text, c: 'unticked' }])

  const payload = runWithVoltraState({ done: true }, () => {
    const renderer = createVoltraRenderer(componentRegistry)
    renderer.addRootNode('small', h(Label))
    renderer.addRootNode('large', h(Button, { label: h(Label) }))
    return renderer.render()
  })

  assert.deepStrictEqual(collectTexts(payload.small), ['ticked'])
  assert.deepStrictEqual(collectTexts(payload.large), ['ticked'])
})

test('a bare author call without a dispatcher returns initial and does not throw', () => {
  function Widget(_props, _env) {
    const done = useVoltraState('done', false)
    const count = useVoltraState('count', 3)
    return h(Text, null, `${done ? 'done' : 'open'} ${count}`)
  }

  const reactInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  assert.equal(reactInternals.H, null)

  let element
  assert.doesNotThrow(() => {
    element = Widget({}, { widgetFamily: '200x200' })
  })
  assert.equal(element.type, Text)
  assert.equal(element.props.children, 'open 3')

  const withSlot = runWithVoltraState({ done: true, count: 9 }, () => Widget({}, {}))
  assert.equal(withSlot.props.children, 'done 9')
})

test('state is keyed by explicit key, not by position, with and without React keys', () => {
  const state = { 'done.b': true }
  const base = [
    { id: 'a', title: 'Alpha' },
    { id: 'b', title: 'Beta' },
    { id: 'c', title: 'Gamma' },
  ]
  const inserted = [{ id: 'z', title: 'Zeta' }, ...base]
  const reversed = [...base].reverse()

  for (const withKeys of [true, false]) {
    assert.deepStrictEqual(collectTexts(renderTodo(state, base, withKeys)), ['[ ] Alpha', '[x] Beta', '[ ] Gamma'])
    assert.deepStrictEqual(collectTexts(renderTodo(state, inserted, withKeys)), [
      '[ ] Zeta',
      '[ ] Alpha',
      '[x] Beta',
      '[ ] Gamma',
    ])
    assert.deepStrictEqual(collectTexts(renderTodo(state, reversed, withKeys)), ['[ ] Gamma', '[x] Beta', '[ ] Alpha'])
  }
})

test('rendering is pure: same slot gives identical JSON and leaves the slot unchanged', () => {
  const state = { 'done.a': true, 'done.c': false, extra: { list: [1, 2] } }
  const snapshot = JSON.parse(JSON.stringify(state))
  const items = [
    { id: 'a', title: 'Alpha' },
    { id: 'b', title: 'Beta' },
    { id: 'c', title: 'Gamma' },
  ]

  const renders = [1, 2, 3].map(() => JSON.stringify(renderTodo(state, items, true)))

  assert.equal(renders[0], renders[1])
  assert.equal(renders[1], renders[2])
  assert.deepStrictEqual(collectTexts(JSON.parse(renders[0])), ['[x] Alpha', '[ ] Beta', '[ ] Gamma'])
  assert.deepStrictEqual(state, snapshot)
  assert.deepStrictEqual(Object.keys(state), ['done.a', 'done.c', 'extra'])
  assert.equal(useVoltraState('done.a', false), false)
})

test('rejects a non-string or empty key', () => {
  const message = { message: 'useVoltraState: key must be a non-empty string' }

  assert.throws(() => useVoltraState('', 1), message)
  assert.throws(() => useVoltraState(undefined, 1), message)
  assert.throws(() => useVoltraState(null, 1), message)
  assert.throws(() => useVoltraState(42, 1), message)
  assert.throws(() => runWithVoltraState({ '': 1 }, () => useVoltraState('', 0)), message)
})

// Hybrid write path (PoC for issue #343; not API): inline setters run only in a tap replay.

function HybridTodo({ items }) {
  return h(
    View,
    null,
    items.map((item) => h(HybridTodoItem, { key: item.id, item }))
  )
}

function HybridTodoItem({ item }) {
  const [done, setDone] = useVoltraStateTuple(`done.${item.id}`, false)
  return h(CheckBox, { id: `task:${item.id}`, checked: done, onCheckedChange: (checked) => setDone(checked) })
}

const hybridItems = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
]

function replayHybrid(state, componentId, value, tree = h(HybridTodo, { items: hybridItems })) {
  return runWithVoltraStateReplay(state, { componentId, value }, () => renderVariantToJson(tree, componentRegistry))
}

test('hybrid: a setter outside a replay is a no-op that records a warning', () => {
  takeVoltraStateWarnings()
  const state = { count: 1 }
  let setter

  const value = runWithVoltraState(state, () => {
    const [count, setCount] = useVoltraStateTuple('count', 0)
    setter = setCount
    setCount(5)
    setCount((prev) => prev + 1)
    return count
  })

  assert.equal(value, 1)
  assert.deepStrictEqual(state, { count: 1 })
  setter(9)
  assert.deepStrictEqual(takeVoltraStateWarnings(), [
    'useVoltraStateTuple: setter called outside a tap handler for key "count"',
    'useVoltraStateTuple: setter called outside a tap handler for key "count"',
    'useVoltraStateTuple: setter called outside a tap handler for key "count"',
  ])
  assert.deepStrictEqual(takeVoltraStateWarnings(), [])

  // Function-valued props are dropped at serialisation, as before.
  const rendered = JSON.parse(
    JSON.stringify(renderVariantToJson(h(HybridTodo, { items: hybridItems }), componentRegistry))
  )
  assert.deepStrictEqual(rendered, {
    t: componentIds.View,
    c: [
      { t: componentIds.AndroidCheckBox, i: 'task:a', p: { chk: false } },
      { t: componentIds.AndroidCheckBox, i: 'task:b', p: { chk: false } },
    ],
  })
})

test('hybrid: a replay on a CheckBox calls onCheckedChange with the value and writes pending', () => {
  const calls = []
  function Absolute() {
    const [done, setDone] = useVoltraStateTuple('done.a', false)
    return h(CheckBox, {
      id: 'task:a',
      checked: done,
      onCheckedChange: (checked) => {
        calls.push(checked)
        setDone(checked)
      },
    })
  }

  const absolute = replayHybrid({ 'done.a': false }, 'task:a', true, h(Absolute))
  assert.deepStrictEqual(calls, [true])
  assert.equal(absolute.handled, true)
  assert.deepStrictEqual(absolute.pending, { 'done.a': true })
  assert.deepStrictEqual(absolute.warnings, [])

  const listed = replayHybrid({ 'done.a': true }, 'task:b', true)
  assert.equal(listed.handled, true)
  assert.deepStrictEqual(listed.pending, { 'done.b': true })

  function Functional() {
    const [count, setCount] = useVoltraStateTuple('count', 10)
    return h(CheckBox, { id: 'counter', checked: count > 0, onCheckedChange: () => setCount((prev) => prev + 1) })
  }

  assert.deepStrictEqual(replayHybrid({ count: 3 }, 'counter', false, h(Functional)).pending, { count: 4 })
  assert.deepStrictEqual(replayHybrid({}, 'counter', false, h(Functional)).pending, { count: 11 })
})

test('hybrid: a replay on a FilledButton calls onPress', () => {
  let presses = 0
  function Counter() {
    const [count, setCount] = useVoltraStateTuple('count', 0)
    return h(FilledButton, {
      id: 'inc',
      text: `+ ${count}`,
      onPress: () => {
        presses += 1
        setCount((prev) => prev + 1)
      },
    })
  }

  const result = replayHybrid({ count: 4 }, 'inc', null, h(Counter))
  assert.equal(presses, 1)
  assert.equal(result.handled, true)
  assert.deepStrictEqual(result.pending, { count: 5 })
})

test('hybrid: no matching id leaves the replay unhandled with nothing pending', () => {
  const result = replayHybrid({}, 'task:zzz', true)
  assert.equal(result.handled, false)
  assert.deepStrictEqual(result.pending, {})
  assert.deepStrictEqual(result.warnings, ['no element with id "task:zzz" reached in the replay render'])

  function NoHandler() {
    return h(CheckBox, { id: 'task:a', checked: useVoltraStateTuple('done.a', false)[0] })
  }
  const withoutHandler = replayHybrid({}, 'task:a', true, h(NoHandler))
  assert.equal(withoutHandler.handled, false)
  assert.deepStrictEqual(withoutHandler.pending, {})
  assert.deepStrictEqual(withoutHandler.warnings, ['element "task:a" has no inline onCheckedChange / onPress'])

  // An empty componentId never matches, not even an element whose id is ''.
  function EmptyId() {
    const [, setK] = useVoltraStateTuple('k', 0)
    return h(CheckBox, { id: '', onCheckedChange: () => setK(1) })
  }
  const empty = replayHybrid({}, '', true, h(EmptyId))
  assert.equal(empty.handled, false)
  assert.deepStrictEqual(empty.pending, {})
  assert.deepStrictEqual(empty.warnings, ['replay without a componentId; no handler called'])
})

test('hybrid: a throwing handler leaves the replay unhandled, records a warning, and writes nothing', () => {
  function Throwing() {
    const [, setDone] = useVoltraStateTuple('done.a', false)
    return h(CheckBox, {
      id: 'task:a',
      onCheckedChange: (checked) => {
        setDone(checked)
        throw new Error('boom')
      },
    })
  }

  const result = replayHybrid({}, 'task:a', true, h(Throwing))
  assert.equal(result.handled, false)
  assert.deepStrictEqual(result.pending, {})
  assert.deepStrictEqual(result.warnings, ['inline handler for "task:a" threw: boom'])
})

test('hybrid: the replay output is a normal render and the slot is cleared afterwards', () => {
  const state = { 'done.a': true }
  const snapshot = JSON.parse(JSON.stringify(state))
  const result = replayHybrid(state, 'task:b', true)

  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.out)), {
    t: componentIds.View,
    c: [
      { t: componentIds.AndroidCheckBox, i: 'task:a', p: { chk: true } },
      { t: componentIds.AndroidCheckBox, i: 'task:b', p: { chk: false } },
    ],
  })
  assert.deepStrictEqual(state, snapshot)
  assert.equal(useVoltraState('done.a', false), false)

  takeVoltraStateWarnings()
  const [, setDone] = useVoltraStateTuple('done.a', false)
  setDone(true)
  assert.equal(takeVoltraStateWarnings().length, 1)

  assert.throws(
    () =>
      runWithVoltraStateReplay({ x: 1 }, { componentId: 'a', value: true }, () => {
        throw new Error('render failed')
      }),
    /render failed/
  )
  assert.equal(useVoltraState('x', 0), 0)
})

test('hybrid: two setters in one handler both land in pending, and a repeated key chains', () => {
  function Pair() {
    const [, setDone] = useVoltraStateTuple('done.a', false)
    const [, setCount] = useVoltraStateTuple('count', 0)
    return h(CheckBox, {
      id: 'task:a',
      onCheckedChange: (checked) => {
        setDone(checked)
        setCount((prev) => prev + 1)
        setCount((prev) => prev + 1)
      },
    })
  }

  const result = replayHybrid({ count: 2 }, 'task:a', true, h(Pair))
  assert.equal(result.handled, true)
  assert.deepStrictEqual(result.pending, { 'done.a': true, count: 4 })
})

test('hybrid: useVoltraState and runWithVoltraState are unchanged next to the tuple hook', () => {
  const state = { 'done.a': true, count: 0 }
  const read = runWithVoltraState(state, () => ({
    plain: useVoltraState('done.a', false),
    tuple: useVoltraStateTuple('done.a', false)[0],
    count: useVoltraState('count', 5),
    missing: useVoltraStateTuple('missing', 'initial')[0],
  }))

  assert.deepStrictEqual(read, { plain: true, tuple: true, count: 0, missing: 'initial' })
  assert.equal(
    runWithVoltraState({ v: 1 }, () => useVoltraState('v', 0), { replay: { componentId: 'x', value: null } }),
    1
  )

  const inReplay = runWithVoltraStateReplay({ 'done.a': true }, { componentId: 'nope', value: true }, () =>
    renderTodo({ 'done.b': true }, hybridItems, true)
  )
  assert.deepStrictEqual(collectTexts(inReplay.out), ['[ ] Alpha', '[x] Beta'])
  assert.equal(inReplay.handled, false)

  const message = { message: 'useVoltraStateTuple: key must be a non-empty string' }
  assert.throws(() => useVoltraStateTuple('', 1), message)
  assert.throws(() => useVoltraStateTuple(undefined, 1), message)
  assert.throws(() => useVoltraStateTuple(42, 1), message)
})

test('hybrid: a setter called by the render body during a replay does not write and records a warning', () => {
  function Widget() {
    const [renders, setRenders] = useVoltraStateTuple('renders', 0)
    setRenders(renders + 1)
    return h(View, null, h(HybridTodoItem, { item: { id: 'a' } }), h(Late))
  }
  function Late() {
    const [, setLate] = useVoltraStateTuple('late', 0)
    setLate(42)
    return h(Text, null, 'late')
  }

  const result = replayHybrid({ renders: 3 }, 'task:a', true, h(Widget))
  assert.equal(result.handled, true)
  assert.deepStrictEqual(result.pending, { 'done.a': true })
  assert.deepStrictEqual(result.warnings, [
    'useVoltraStateTuple: setter called outside a tap handler for key "renders"',
    'useVoltraStateTuple: setter called outside a tap handler for key "late"',
  ])
})

test('hybrid: the handler runs after the walk, so it sees closures from elements rendered after it', () => {
  function ClearFirst({ items }) {
    const setters = []
    return h(
      View,
      null,
      h(FilledButton, { id: 'clear', text: 'Clear', onPress: () => setters.forEach((setDone) => setDone(false)) }),
      items.map((item) => {
        const [done, setDone] = useVoltraStateTuple(`done.${item.id}`, false)
        setters.push(setDone)
        return h(CheckBox, { key: item.id, id: `task:${item.id}`, checked: done })
      })
    )
  }

  const result = replayHybrid({ 'done.a': true, 'done.b': true }, 'clear', null, h(ClearFirst, { items: hybridItems }))
  assert.equal(result.handled, true)
  assert.deepStrictEqual(result.pending, { 'done.a': false, 'done.b': false })
  assert.deepStrictEqual(result.warnings, [])
})
