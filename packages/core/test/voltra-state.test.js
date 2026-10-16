// PoC for issue #343; not API. Covers the `useVoltraState` slot read by Dynamic Widgets.
const test = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')

const {
  createVoltraComponent,
  createVoltraRenderer,
  renderVariantToJson,
  runWithVoltraState,
  useVoltraState,
} = require('../build/cjs/index.js')

const View = createVoltraComponent('View')
const Text = createVoltraComponent('Text')
const Button = createVoltraComponent('Button')

const componentIds = {
  View: 1,
  Text: 2,
  Button: 3,
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
