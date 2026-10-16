// PoC for issue #343; not API. Identity harness: the positional `useState` design note
// ("Voltra useState Identity": key = tree path + hook index, mark & sweep) measured next to
// option C (`useVoltraState` with explicit keys). Every case has a PRE-REGISTERED prediction and
// asserts observed === predicted, so a mismatch fails and is itself a finding.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')

const {
  __poc343Positional,
  createVoltraComponent,
  createVoltraRenderer,
  renderVariantToJson,
  runWithVoltraState,
  useVoltraState,
} = require('../build/cjs/index.js')

const { createPositionalStore } = __poc343Positional

const h = React.createElement

const Column = createVoltraComponent('Column')
const Row = createVoltraComponent('Row')
const CheckBox = createVoltraComponent('CheckBox')
const Text = createVoltraComponent('Text')
const Button = createVoltraComponent('Button')

const componentIds = { Column: 1, Row: 2, CheckBox: 3, Text: 4, Button: 5 }
const componentRegistry = {
  getComponentId(name) {
    const id = componentIds[name]
    if (id === undefined) {
      throw new Error(`Unknown component: ${name}`)
    }
    return id
  },
}

// ---------------------------------------------------------------------------------------------
// Fixtures. `s` is the strategy: 'P' = the note scheme (React's useState, positional key),
// 'C' = option C (useVoltraState with an explicit key, written by onInteraction).
// ---------------------------------------------------------------------------------------------

function useStateFor(s, explicitKey, initial) {
  if (s === 'C') {
    return [useVoltraState(explicitKey, initial)]
  }
  return React.useState(initial)
}

function TodoRow({ s, item, idPrefix = 'task:' }) {
  const [done] = useStateFor(s, `done.${item.id}`, false)
  return h(CheckBox, { id: idPrefix + item.id, text: item.title, checked: done })
}

function Summary({ s, items }) {
  const [expanded] = useStateFor(s, 'summary.expanded', false)
  return h(Text, { id: 'summary' }, `${items.length} tasks${expanded ? ' (expanded)' : ''}`)
}

/**
 * summary: 'none' = v1 code (no Summary expression; the rows array is the only child),
 *          'hole' = `{showSummary && <Summary/>}` before the rows, 'show' = v2 code (Summary always).
 */
function TodoList({
  s,
  items,
  keyed = true,
  summary = 'none',
  showSummary = false,
  showCompleted = true,
  completedIds = [],
  condHook = false,
  wrapper = 'Column',
  featured,
  withOwnState = false,
}) {
  let extra
  if (withOwnState && condHook) {
    ;[extra] = useStateFor(s, 'extra', 'x')
  }
  let collapsed
  if (withOwnState) {
    ;[collapsed] = useStateFor(s, 'collapsed', false)
  }
  // P cannot read row state from the parent, so the host app tells it which ids are completed;
  // C reads the same record the rows read.
  const isDone = (item) => (s === 'C' ? useVoltraState(`done.${item.id}`, false) : completedIds.includes(item.id))
  const visible = showCompleted ? items : items.filter((item) => !isDone(item))
  const rows = visible.map((item) => h(TodoRow, keyed ? { key: item.id, s, item } : { s, item }))
  const Wrapper = wrapper === 'Row' ? Row : Column
  const own = withOwnState
    ? [
        h(Button, { id: 'collapse', title: 'collapse' }),
        h(Text, { id: 'own' }, `collapsed=${collapsed} extra=${condHook ? extra : '-'}`),
      ]
    : null
  if (featured) {
    return h(Wrapper, null, h(TodoRow, { s, item: featured, idPrefix: 'featured:' }), rows)
  }
  if (summary === 'show') {
    return h(Wrapper, null, h(Summary, { s, items }), rows, own)
  }
  if (summary === 'hole') {
    return h(Wrapper, null, showSummary && h(Summary, { s, items }), rows, own)
  }
  if (own) {
    return h(Wrapper, null, rows, own)
  }
  return h(Wrapper, null, rows)
}

function Counter({ s, name }) {
  const [count] = useStateFor(s, `count.${name}`, 0)
  return h(Column, null, h(Text, { id: `count:${name}` }, String(count)), h(Button, { id: `inc:${name}`, title: '+' }))
}

function Banner({ s }) {
  const [dismissed] = useStateFor(s, 'banner.dismissed', false)
  return h(Text, { id: 'banner' }, dismissed ? 'dismissed' : 'banner')
}

function BannerScreen({ s, show }) {
  return h(Column, null, show && h(Banner, { s }), h(Counter, { s, name: 'c' }))
}

function A({ s }) {
  const [count] = useStateFor(s, 'count.ab', 0)
  return h(Column, null, h(Text, { id: 'count:ab' }, String(count)), h(Button, { id: 'inc:ab', title: 'A' }))
}
function B({ s }) {
  const [count] = useStateFor(s, 'count.ab', 0)
  return h(Row, null, h(Text, { id: 'count:ab' }, String(count)), h(Button, { id: 'inc:ab', title: 'B' }))
}
// Same bodies with the "build-time ID (module + export)" the note proposes.
function AWithId(props) {
  return A(props)
}
AWithId.__pocId = 'widgets/AB.tsx#A'
function BWithId(props) {
  return B(props)
}
BWithId.__pocId = 'widgets/AB.tsx#B'

function SwapScreen({ s, which, withIds = false }) {
  const Type = which === 'A' ? (withIds ? AWithId : A) : withIds ? BWithId : B
  return h(Column, null, h(Type, { s }))
}

function DayScreen({ s, day }) {
  return h(Column, null, h(Counter, { key: day, s, name: 'day' }))
}

function PlainRow({ item, done }) {
  return h(CheckBox, { id: `task:${item.id}`, text: item.title, checked: done })
}

/** N18: one state map in the list, hookless rows. P: useState({}), C: useVoltraState('done', {}). */
function TodoListMap({ s, items, keyed = false, summary = 'none', showCompleted = true }) {
  const [done] = useStateFor(s, 'done', {})
  const visible = showCompleted ? items : items.filter((item) => !done[item.id])
  const rows = visible.map((item) =>
    h(PlainRow, keyed ? { key: item.id, item, done: !!done[item.id] } : { item, done: !!done[item.id] })
  )
  if (summary === 'show') {
    return h(Column, null, h(Summary, { s, items }), rows)
  }
  return h(Column, null, rows)
}

function Boom({ boom }) {
  React.useState(0)
  if (boom) {
    throw new Error('render failed')
  }
  return h(Text, null, 'ok')
}

function Naughty() {
  const [value, setValue] = React.useState(0)
  if (value === 0) {
    setValue(1)
  }
  return h(Text, { id: 'naughty' }, String(value))
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const ITEMS = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
  { id: 'c', title: 'Gamma' },
]
const reversed = () => [...ITEMS].reverse()
const insertedFront = () => [{ id: 'z', title: 'Zeta' }, ...ITEMS]

function walk(node, payload, visit) {
  if (Array.isArray(node)) {
    for (const child of node) {
      walk(child, payload, visit)
    }
    return
  }
  if (node === null || typeof node !== 'object') {
    return
  }
  if (node.$r !== undefined) {
    walk(payload.e[node.$r], payload, visit)
    return
  }
  visit(node)
  if (node.c !== undefined) {
    walk(node.c, payload, visit)
  }
  if (node.p !== undefined) {
    for (const value of Object.values(node.p)) {
      walk(value, payload, visit)
    }
  }
}

function ticked(json, payload = {}) {
  const out = []
  walk(json, payload, (node) => {
    if (node.t === componentIds.CheckBox && node.p && node.p.chk === true) {
      out.push(node.i)
    }
  })
  return out.sort()
}

function textsById(json, id, payload = {}) {
  const out = []
  walk(json, payload, (node) => {
    if (node.i === id) {
      out.push(node.c)
    }
  })
  return out
}

function tickLabel(after, tickedId) {
  if (after.length === 0) {
    return 'gone'
  }
  if (after.length === 1 && after[0] === tickedId) {
    return 'kept'
  }
  if (!after.includes(tickedId)) {
    return `moved ${tickedId}->${after.join('+')}`
  }
  return `kept+leak ${after.filter((id) => id !== tickedId).join('+')}`
}

function countLabel(values, expected, initial) {
  if (values.length === 1 && values[0] === String(expected)) {
    return 'kept'
  }
  if (values.length === 1 && values[0] === String(initial)) {
    return 'gone'
  }
  return `values=[${values.join(',')}]`
}

const renderJson = (element) => renderVariantToJson(element, componentRegistry)
const renderP = (store, variant, element) => store.render(variant, () => renderJson(element))
const renderC = (state, element) => runWithVoltraState(state, () => renderJson(element))

/** C's onInteraction for the fixtures: explicit keys, never swept. */
function onInteractionC(state, id, value) {
  if (id.startsWith('task:')) {
    return { ...state, [`done.${id.slice(5)}`]: value }
  }
  if (id.startsWith('inc:')) {
    return { ...state, [`count.${id.slice(4)}`]: value }
  }
  if (id === 'collapse') {
    return { ...state, collapsed: value }
  }
  throw new Error(`unknown control ${id}`)
}

const keyOf = (store, id) => store.controls[id]?.hookKeys[0] ?? '(not rendered)'

/**
 * Tick item `a` in `before`, commit, render `after`. Returns observed labels for P and C and the
 * P slot keys before (the tapped key) and after (the key item a reads now, plus the holders).
 */
function tickCase({ before, after, tapId = 'task:a', storeOptions, commitAfter = false }) {
  const store = createPositionalStore(storeOptions)
  renderP(store, 'systemMedium', before('P'))
  const tapKey = store.tap(tapId, true)
  store.commit()
  const json = renderP(store, 'systemMedium', after('P'))
  const afterTicked = ticked(json)
  const holders = afterTicked.filter((id) => id !== tapId).map((id) => `${id}=${keyOf(store, id)}`)
  const pKeys = `${tapKey} → ${keyOf(store, tapId)}${holders.length ? `; ticked: ${holders.join(', ')}` : ''}`
  let swept = []
  if (commitAfter) {
    swept = store.commit().deleted
  }

  let state = {}
  renderC(state, before('C'))
  state = onInteractionC(state, tapId, true)
  const cJson = renderC(state, after('C'))

  return {
    P: tickLabel(afterTicked, tapId),
    C: tickLabel(ticked(cJson), tapId),
    pKeys,
    swept,
  }
}

function counterCase({ before, after, id, storeOptions }) {
  const name = id.slice(4)
  const store = createPositionalStore(storeOptions)
  renderP(store, 'systemMedium', before('P'))
  const tapKey = store.tap(id, 5)
  store.commit()
  const json = renderP(store, 'systemMedium', after('P'))
  const pKeys = `${tapKey} → ${keyOf(store, id)}`

  let state = {}
  renderC(state, before('C'))
  state = onInteractionC(state, id, 5)
  const cJson = renderC(state, after('C'))

  return {
    P: countLabel(textsById(json, `count:${name}`), 5, 0),
    C: countLabel(textsById(cJson, `count:${name}`), 5, 0),
    pKeys,
  }
}

// ---------------------------------------------------------------------------------------------
// PRE-REGISTERED predictions (written before the first run). P = note scheme, dev names unless
// the case says otherwise. Labels: kept / gone / moved <from>-><to> / composite strings.
// ---------------------------------------------------------------------------------------------

const PREDICTIONS = {
  N1: { title: 'conditional sibling hidden (Banner before Counter, show=false)', P: 'kept', C: 'kept' },
  N2: { title: 'keyed list reorder (reverse)', P: 'kept', C: 'kept' },
  N3: { title: 'unkeyed list reorder (reverse)', P: 'moved task:a->task:c', C: 'kept' },
  N4: { title: 'unkeyed insert at front', P: 'moved task:a->task:z', C: 'kept' },
  N5: { title: 'keyed insert at front', P: 'kept', C: 'kept' },
  N6: { title: 'type swap <A/> -> <B/> in the same slot (dev names)', P: 'gone', C: 'kept' },
  N7: { title: 'wrapper Column -> Row between versions (keyed rows)', P: 'gone', C: 'kept' },
  N8: { title: 'v2 adds hooked <Summary/> above the list (keyed rows)', P: 'gone', C: 'kept' },
  N8b: {
    title: 'v2 adds a featured (unkeyed) <TodoRow/> above the unkeyed list',
    P: 'moved task:a->featured:c',
    C: 'kept',
  },
  N9: { title: 'key={day} changes on Counter (mon -> tue)', P: 'gone', C: 'kept' },
  N10: {
    title: 'mark & sweep with hidden rows (showCompleted=false, commit, show again)',
    P: 'gone',
    C: 'kept',
  },
  N11a: {
    title: 'sizes without prefix, separate shapes (small: no Summary; large: Summary), sweep on',
    P: 'large:gone small-after:gone',
    C: 'large:kept small-after:kept',
  },
  N11b: {
    // Added sub-case (not in the task list): one component, `{large && <Summary/>}` hole; tick a in
    // small, tick c (large-only row) in large. Own prediction: the hole keeps the rows' slot, so a is
    // shared across sizes, and the small commit sweeps c's key (only stored keys can be swept).
    title: 'sizes without prefix, one component with a Summary hole, sweep on; tick a in small, c in large',
    P: 'large:kept small-after:kept large-again=[task:a] swept-by-small=[TodoRow:c#0]',
    C: 'large:kept small-after:kept large-again=[task:a,task:c]',
  },
  N11c: {
    title: 'sizes without prefix, separate shapes, sweep off',
    P: 'large:gone small-after:kept',
    C: 'large:kept small-after:kept',
  },
  N12: {
    title: 'sizes with variant prefix (hole form), sweep scoped to rendered variant',
    P: 'large:gone small-after:kept',
    C: 'large:kept small-after:kept',
  },
  N13: {
    title: 'server-fetch trial render with 4 other items, committed',
    // Only keys with a stored value can be deleted: the tick of a is the only one.
    P: 'gone written=0 deleted=1',
    C: 'kept',
  },
  N14: {
    title: 'conditional useState in TodoList before its own state (flag false -> true)',
    P: 'rows:kept own:collapsed=false extra=true',
    C: 'rows:kept own:collapsed=true extra=x',
  },
  N15a: { title: 'type swap <A/> -> <B/>, release names (all `t`)', P: 'kept', C: 'kept' },
  N15b: { title: 'type swap <A/> -> <B/>, build-time ids (__pocId)', P: 'gone', C: 'kept' },
  N16: {
    title: 'same element object twice under createVoltraRenderer (dedup)',
    P: 'keys=1 values=[5,5]',
    C: 'keys=1 values=[5,5]',
  },
  N16b: {
    // Added sub-case: the same tree through renderVariantToJson (no dedup). Own prediction: two
    // keys; duplicate control ids make the tap hit the last one.
    title: 'same element object twice under renderVariantToJson (no dedup)',
    P: 'keys=2 values=[0,5]',
    C: 'keys=1 values=[5,5]',
  },
  N17: {
    title: 'purity and sweep idempotence; render that throws',
    P: 'json=same seen=same throw=aborted,store-unchanged setter-in-render=ignored+warned',
    C: 'json=same throw=state-unchanged',
  },
  N18: {
    title: 'parent map: one useState({}) in the list, hookless rows (N3, N4, N8, N10)',
    P: 'N3:kept N4:kept N8:kept N10:kept',
    C: 'N3:kept N4:kept N8:kept N10:kept',
  },
}

const results = []

function record(id, observed, extra = {}) {
  const prediction = PREDICTIONS[id]
  results.push({ id, title: prediction.title, prediction, observed, ...extra })
  return prediction
}

function check(id, observed, extra) {
  const prediction = record(id, observed, extra)
  assert.equal(observed.P, prediction.P, `${id} P: observed differs from prediction`)
  assert.equal(observed.C, prediction.C, `${id} C: observed differs from prediction`)
}

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

test('N1 conditional sibling hidden', () => {
  const r = counterCase({
    id: 'inc:c',
    before: (s) => h(BannerScreen, { s, show: true }),
    after: (s) => h(BannerScreen, { s, show: false }),
  })
  check('N1', r, { pKeys: r.pKeys })
})

test('N2 keyed list reorder', () => {
  const r = tickCase({
    before: (s) => h(TodoList, { s, items: ITEMS }),
    after: (s) => h(TodoList, { s, items: reversed() }),
  })
  check('N2', r, { pKeys: r.pKeys })
})

test('N3 unkeyed list reorder', () => {
  const r = tickCase({
    before: (s) => h(TodoList, { s, items: ITEMS, keyed: false }),
    after: (s) => h(TodoList, { s, items: reversed(), keyed: false }),
  })
  check('N3', r, { pKeys: r.pKeys })
})

test('N4 unkeyed insert at front', () => {
  const r = tickCase({
    before: (s) => h(TodoList, { s, items: ITEMS, keyed: false }),
    after: (s) => h(TodoList, { s, items: insertedFront(), keyed: false }),
  })
  check('N4', r, { pKeys: r.pKeys })
})

test('N5 keyed insert at front', () => {
  const r = tickCase({
    before: (s) => h(TodoList, { s, items: ITEMS }),
    after: (s) => h(TodoList, { s, items: insertedFront() }),
  })
  check('N5', r, { pKeys: r.pKeys })
})

test('N6 component type swap in the same slot (dev names)', () => {
  const r = counterCase({
    id: 'inc:ab',
    before: (s) => h(SwapScreen, { s, which: 'A' }),
    after: (s) => h(SwapScreen, { s, which: 'B' }),
  })
  check('N6', r, { pKeys: r.pKeys })
})

test('N7 wrapper change Column -> Row between versions', () => {
  const r = tickCase({
    before: (s) => h(TodoList, { s, items: ITEMS }),
    after: (s) => h(TodoList, { s, items: ITEMS, wrapper: 'Row' }),
  })
  check('N7', r, { pKeys: r.pKeys })
})

test('N8 v2 adds a hooked Summary above the list', () => {
  const r = tickCase({
    before: (s) => h(TodoList, { s, items: ITEMS, summary: 'none' }),
    after: (s) => h(TodoList, { s, items: ITEMS, summary: 'show' }),
  })
  check('N8', r, { pKeys: r.pKeys })
})

test('N8b v2 adds a featured row above an unkeyed list', () => {
  const r = tickCase({
    before: (s) => h(TodoList, { s, items: ITEMS, keyed: false }),
    after: (s) => h(TodoList, { s, items: ITEMS, keyed: false, featured: ITEMS[2] }),
  })
  check('N8b', r, { pKeys: r.pKeys })
})

test('N9 key={day} changes', () => {
  const r = counterCase({
    id: 'inc:day',
    before: (s) => h(DayScreen, { s, day: 'mon' }),
    after: (s) => h(DayScreen, { s, day: 'tue' }),
  })
  check('N9', r, { pKeys: r.pKeys })
})

test('N10 mark & sweep deletes the state of hidden rows', () => {
  const store = createPositionalStore()
  renderP(store, 'systemMedium', h(TodoList, { s: 'P', items: ITEMS }))
  const tapKey = store.tap('task:a', true)
  store.commit()
  renderP(store, 'systemMedium', h(TodoList, { s: 'P', items: ITEMS, showCompleted: false, completedIds: ['a'] }))
  const hiddenCommit = store.commit()
  const json = renderP(store, 'systemMedium', h(TodoList, { s: 'P', items: ITEMS }))

  let state = {}
  renderC(state, h(TodoList, { s: 'C', items: ITEMS }))
  state = onInteractionC(state, 'task:a', true)
  renderC(state, h(TodoList, { s: 'C', items: ITEMS, showCompleted: false }))
  const cJson = renderC(state, h(TodoList, { s: 'C', items: ITEMS }))

  const observed = { P: tickLabel(ticked(json), 'task:a'), C: tickLabel(ticked(cJson), 'task:a') }
  check('N10', observed, {
    pKeys: `${tapKey} → ${keyOf(store, 'task:a')} (swept by the hidden-row commit: ${hiddenCommit.deleted.join(', ')})`,
  })
})

function sizesCase({ storeOptions, smallEl, largeEl }) {
  const store = createPositionalStore(storeOptions)
  renderP(store, 'systemSmall', smallEl('P'))
  const tapKey = store.tap('task:a', true)
  store.commit()
  const largeJson = renderP(store, 'systemLarge', largeEl('P'))
  const largeKey = keyOf(store, 'task:a')
  const largeCommit = store.commit()
  const smallJson = renderP(store, 'systemSmall', smallEl('P'))
  const smallCommit = store.commit()

  let state = {}
  renderC(state, smallEl('C'))
  state = onInteractionC(state, 'task:a', true)
  const cLarge = renderC(state, largeEl('C'))
  const cSmall = renderC(state, smallEl('C'))

  return {
    P: `large:${tickLabel(ticked(largeJson), 'task:a')} small-after:${tickLabel(ticked(smallJson), 'task:a')}`,
    C: `large:${tickLabel(ticked(cLarge), 'task:a')} small-after:${tickLabel(ticked(cSmall), 'task:a')}`,
    pKeys: `${tapKey} → large reads ${largeKey}; large commit deleted [${largeCommit.deleted.join(
      ', '
    )}]; small commit deleted [${smallCommit.deleted.join(', ')}]`,
    smallCommit,
  }
}

test('N11a size variants without prefix, separate shapes, sweep on', () => {
  const r = sizesCase({
    smallEl: (s) => h(TodoList, { s, items: ITEMS.slice(0, 2), summary: 'none' }),
    largeEl: (s) => h(TodoList, { s, items: ITEMS, summary: 'show' }),
  })
  check('N11a', r, { pKeys: r.pKeys })
})

test('N11b size variants without prefix, one component with a Summary hole, sweep on', () => {
  const small = (s) => h(TodoList, { s, items: ITEMS.slice(0, 2), summary: 'hole', showSummary: false })
  const large = (s) => h(TodoList, { s, items: ITEMS, summary: 'hole', showSummary: true })

  const store = createPositionalStore()
  renderP(store, 'systemSmall', small('P'))
  const tapA = store.tap('task:a', true)
  store.commit()
  const largeJson = renderP(store, 'systemLarge', large('P'))
  const tapC = store.tap('task:c', true)
  store.commit()
  const smallJson = renderP(store, 'systemSmall', small('P'))
  const smallCommit = store.commit()
  const largeAgain = renderP(store, 'systemLarge', large('P'))
  const sweptBySmall = smallCommit.deleted.map((key) => key.split('/').pop()).sort()

  let state = {}
  renderC(state, small('C'))
  state = onInteractionC(state, 'task:a', true)
  const cLarge = renderC(state, large('C'))
  state = onInteractionC(state, 'task:c', true)
  const cSmall = renderC(state, small('C'))
  const cLargeAgain = renderC(state, large('C'))

  const observed = {
    P: `large:${tickLabel(ticked(largeJson), 'task:a')} small-after:${tickLabel(
      ticked(smallJson),
      'task:a'
    )} large-again=[${ticked(largeAgain).join(',')}] swept-by-small=[${sweptBySmall.join(',')}]`,
    C: `large:${tickLabel(ticked(cLarge), 'task:a')} small-after:${tickLabel(
      ticked(cSmall),
      'task:a'
    )} large-again=[${ticked(cLargeAgain).join(',')}]`,
  }
  check('N11b', observed, {
    pKeys: `a ${tapA} (same path in both sizes); c ${tapC} → swept by the small commit [${smallCommit.deleted.join(
      ', '
    )}]`,
  })
})

test('N11c size variants without prefix, separate shapes, sweep off', () => {
  const r = sizesCase({
    storeOptions: { sweep: false },
    smallEl: (s) => h(TodoList, { s, items: ITEMS.slice(0, 2), summary: 'none' }),
    largeEl: (s) => h(TodoList, { s, items: ITEMS, summary: 'show' }),
  })
  check('N11c', r, { pKeys: r.pKeys })
})

test('N12 size variants with the variant prefix', () => {
  const r = sizesCase({
    storeOptions: { variantPrefix: true },
    smallEl: (s) => h(TodoList, { s, items: ITEMS.slice(0, 2), summary: 'hole', showSummary: false }),
    largeEl: (s) => h(TodoList, { s, items: ITEMS, summary: 'hole', showSummary: true }),
  })
  check('N12', r, { pKeys: r.pKeys })
})

test('N13 server-fetch trial render committed', () => {
  const trialItems = ['d', 'e', 'f', 'g'].map((id) => ({ id, title: id.toUpperCase() }))
  const store = createPositionalStore()
  renderP(store, 'systemMedium', h(TodoList, { s: 'P', items: ITEMS }))
  const tapKey = store.tap('task:a', true)
  store.commit()
  renderP(store, 'systemMedium', h(TodoList, { s: 'P', items: trialItems }))
  const trial = store.commit()
  const json = renderP(store, 'systemMedium', h(TodoList, { s: 'P', items: ITEMS }))

  let state = {}
  renderC(state, h(TodoList, { s: 'C', items: ITEMS }))
  state = onInteractionC(state, 'task:a', true)
  const before = JSON.stringify(state)
  renderC(state, h(TodoList, { s: 'C', items: trialItems }))
  assert.equal(JSON.stringify(state), before)
  const cJson = renderC(state, h(TodoList, { s: 'C', items: ITEMS }))

  const observed = {
    P: `${tickLabel(ticked(json), 'task:a')} written=${trial.written.length} deleted=${trial.deleted.length}`,
    C: tickLabel(ticked(cJson), 'task:a'),
  }
  check('N13', observed, {
    pKeys: `${tapKey} → ${keyOf(store, 'task:a')}; trial commit deleted [${trial.deleted.join(', ')}]`,
  })
})

test('N14 conditional hook inside TodoList before its own state', () => {
  const el = (s, condHook) => h(TodoList, { s, items: ITEMS, withOwnState: true, condHook })
  const store = createPositionalStore()
  renderP(store, 'systemMedium', el('P', false))
  const rowKey = store.tap('task:a', true)
  const ownKey = store.tap('collapse', true)
  store.commit()
  const json = renderP(store, 'systemMedium', el('P', true))
  const ownAfter = store.controls.collapse.hookKeys.join(' + ')

  let state = {}
  renderC(state, el('C', false))
  state = onInteractionC(state, 'task:a', true)
  state = onInteractionC(state, 'collapse', true)
  const cJson = renderC(state, el('C', true))

  const observed = {
    P: `rows:${tickLabel(ticked(json), 'task:a')} own:${textsById(json, 'own')[0]}`,
    C: `rows:${tickLabel(ticked(cJson), 'task:a')} own:${textsById(cJson, 'own')[0]}`,
  }
  check('N14', observed, {
    pKeys: `row ${rowKey} → ${keyOf(
      store,
      'task:a'
    )}; collapsed ${ownKey} → TodoList hooks now [${ownAfter}] (extra reads #0)`,
  })
})

test('N15a type swap with release (minified) names', () => {
  const r = counterCase({
    id: 'inc:ab',
    storeOptions: { mode: 'release' },
    before: (s) => h(SwapScreen, { s, which: 'A' }),
    after: (s) => h(SwapScreen, { s, which: 'B' }),
  })
  check('N15a', r, { pKeys: r.pKeys })
})

test('N15b type swap with build-time ids (__pocId), release mode', () => {
  const r = counterCase({
    id: 'inc:ab',
    storeOptions: { mode: 'release' },
    before: (s) => h(SwapScreen, { s, which: 'A', withIds: true }),
    after: (s) => h(SwapScreen, { s, which: 'B', withIds: true }),
  })
  check('N15b', r, { pKeys: r.pKeys })
})

function sharedElementCase(useRenderer) {
  const run = (s, render) => {
    const shared = h(Counter, { s, name: 'shared' })
    const tree = h(Column, null, shared, shared)
    if (!useRenderer) {
      const json = render(() => renderJson(tree))
      return { json, payload: {} }
    }
    const payload = render(() => {
      const renderer = createVoltraRenderer(componentRegistry)
      renderer.addRootNode('systemMedium', tree)
      return renderer.render()
    })
    return { json: payload.systemMedium, payload }
  }

  const store = createPositionalStore()
  run('P', (fn) => store.render('systemMedium', fn))
  const keys = [...store.seen].filter((key) => key.includes('Counter'))
  const tapKey = store.tap('inc:shared', 5)
  store.commit()
  const p = run('P', (fn) => store.render('systemMedium', fn))

  let state = {}
  run('C', (fn) => runWithVoltraState(state, fn))
  state = onInteractionC(state, 'inc:shared', 5)
  const c = run('C', (fn) => runWithVoltraState(state, fn))

  return {
    P: `keys=${keys.length} values=[${textsById(p.json, 'count:shared', p.payload).join(',')}]`,
    C: `keys=1 values=[${textsById(c.json, 'count:shared', c.payload).join(',')}]`,
    pKeys: `marked [${keys.join(', ')}]; tap wrote ${tapKey}`,
  }
}

test('N16 same element object in two places under createVoltraRenderer', () => {
  const r = sharedElementCase(true)
  check('N16', r, { pKeys: r.pKeys })
})

test('N16b same element object in two places under renderVariantToJson', () => {
  const r = sharedElementCase(false)
  check('N16b', r, { pKeys: r.pKeys })
})

test('N17 purity, sweep idempotence, a render that throws', () => {
  const store = createPositionalStore()
  renderP(store, 'systemMedium', h(TodoList, { s: 'P', items: ITEMS }))
  store.tap('task:b', true)
  store.commit()
  const snapshot = JSON.stringify(store.data)

  const jsons = []
  const seens = []
  for (let i = 0; i < 3; i += 1) {
    jsons.push(JSON.stringify(renderP(store, 'systemMedium', h(TodoList, { s: 'P', items: ITEMS }))))
    seens.push(JSON.stringify([...store.seen].sort()))
    const result = store.commit()
    assert.deepStrictEqual(result.deleted, [])
  }
  const jsonSame = jsons.every((json) => json === jsons[0])
  const seenSame = seens.every((seen) => seen === seens[0])
  assert.equal(JSON.stringify(store.data), snapshot)

  assert.throws(() => renderP(store, 'systemMedium', h(Column, null, h(Boom, { boom: true }))), /render failed/)
  const aborted = store.commit()
  const throwOk = aborted.aborted && JSON.stringify(store.data) === snapshot

  const warningsBefore = store.warnings.length
  renderP(store, 'systemMedium', h(Column, null, h(Naughty), h(TodoList, { s: 'P', items: ITEMS })))
  const setterIgnored = Object.keys(store.pending).length === 0 && store.warnings.length === warningsBefore + 1
  store.commit()

  const state = { 'done.b': true }
  const cSnapshot = JSON.stringify(state)
  const cJsons = [1, 2, 3].map(() => JSON.stringify(renderC(state, h(TodoList, { s: 'C', items: ITEMS }))))
  assert.throws(() => renderC(state, h(Column, null, h(Boom, { boom: true }))), /render failed/)

  const observed = {
    P: `json=${jsonSame ? 'same' : 'differs'} seen=${seenSame ? 'same' : 'differs'} throw=${
      throwOk ? 'aborted,store-unchanged' : 'swept'
    } setter-in-render=${setterIgnored ? 'ignored+warned' : 'applied'}`,
    C: `json=${cJsons.every((json) => json === cJsons[0]) ? 'same' : 'differs'} throw=${
      JSON.stringify(state) === cSnapshot ? 'state-unchanged' : 'changed'
    }`,
  }
  check('N17', observed, {
    pKeys: `seen per render: ${JSON.parse(seens[0]).length} keys; warnings: ${store.warnings.at(-1)}`,
  })
})

test('N18 parent map spelled with useState passes N3, N4, N8, N10', () => {
  const tapMap = (map) => ({ ...map, a: true })
  const sub = (before, after, hideBetween = false) => {
    const store = createPositionalStore()
    renderP(store, 'systemMedium', before('P'))
    const tapKey = store.tap('task:a', tapMap)
    store.commit()
    if (hideBetween) {
      renderP(store, 'systemMedium', h(TodoListMap, { s: 'P', items: ITEMS, showCompleted: false }))
      store.commit()
    }
    const json = renderP(store, 'systemMedium', after('P'))

    let state = {}
    renderC(state, before('C'))
    state = { ...state, done: tapMap(state.done ?? {}) }
    if (hideBetween) {
      renderC(state, h(TodoListMap, { s: 'C', items: ITEMS, showCompleted: false }))
    }
    const cJson = renderC(state, after('C'))
    return { P: tickLabel(ticked(json), 'task:a'), C: tickLabel(ticked(cJson), 'task:a'), tapKey }
  }
  const n3 = sub(
    (s) => h(TodoListMap, { s, items: ITEMS }),
    (s) => h(TodoListMap, { s, items: reversed() })
  )
  const n4 = sub(
    (s) => h(TodoListMap, { s, items: ITEMS }),
    (s) => h(TodoListMap, { s, items: insertedFront() })
  )
  const n8 = sub(
    (s) => h(TodoListMap, { s, items: ITEMS }),
    (s) => h(TodoListMap, { s, items: ITEMS, summary: 'show' })
  )
  const n10 = sub(
    (s) => h(TodoListMap, { s, items: ITEMS }),
    (s) => h(TodoListMap, { s, items: ITEMS }),
    true
  )
  const observed = {
    P: `N3:${n3.P} N4:${n4.P} N8:${n8.P} N10:${n10.P}`,
    C: `N3:${n3.C} N4:${n4.C} N8:${n8.C} N10:${n10.C}`,
  }
  check('N18', observed, { pKeys: `map key ${n3.tapKey} (one key for the whole list)` })
})

test('walker rules: duplicate key falls back to the slot; a render prop cannot advance the counter', () => {
  const store = createPositionalStore()
  const Ctx = React.createContext('dark')
  function Themed() {
    const [own] = React.useState('own')
    return h(Ctx.Consumer, null, (theme) => {
      const [inner] = React.useState('inner')
      return h(Text, { id: 'themed' }, `${own}/${inner}/${theme}`)
    })
  }
  const dupes = [
    { id: 'a', title: 'Alpha' },
    { id: 'a', title: 'Alpha again' },
  ]
  const json = renderP(store, 'systemMedium', h(Column, null, h(TodoList, { s: 'P', items: dupes }), h(Themed)))
  const seen = [...store.seen].sort()

  assert.deepStrictEqual(seen, [
    'root/Column@0/Themed@1#0',
    'root/Column@0/TodoList@0/Column@0/TodoRow:a#0',
    'root/Column@0/TodoList@0/Column@0/TodoRow@1#0',
  ])
  assert.deepStrictEqual(textsById(json, 'themed'), ['own/inner/dark'])
  assert.ok(store.warnings.some((warning) => warning.startsWith('duplicate key "a"')))
  assert.ok(store.warnings.some((warning) => warning.startsWith('useState called after root/Column@0/Themed@1')))
})

test('matrix: observed vs predicted (written to poc/343/evidence/t7-positional-identity.md)', (t) => {
  const escape = (value) => String(value).replace(/\|/g, '\\|')
  const lines = [
    '| Case | Scenario | P predicted | P observed | C predicted | C observed | Match | P slot keys before → after |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const row of results) {
    const match = row.observed.P === row.prediction.P && row.observed.C === row.prediction.C
    lines.push(
      `| ${row.id} | ${escape(row.title)} | ${escape(row.prediction.P)} | ${escape(row.observed.P)} | ${escape(
        row.prediction.C
      )} | ${escape(row.observed.C)} | ${match ? 'yes' : 'NO'} | ${escape(row.pKeys ?? '')} |`
    )
  }
  const matrix = lines.join('\n')
  for (const line of lines) {
    t.diagnostic(line)
  }

  const evidenceDir = path.join(__dirname, '..', '..', '..', 'poc', '343', 'evidence')
  if (fs.existsSync(evidenceDir)) {
    const body = [
      '# T7: positional useState identity (design note) vs option C',
      '',
      'Generated by `packages/core/test/voltra-state-positional-identity.test.js` (PoC for issue #343; not API).',
      'P = the note scheme (key = tree path + hook index, mark & sweep; dev names unless the case says otherwise).',
      'C = option C (`useVoltraState` with explicit keys written by `onInteraction`, never swept).',
      'Labels: kept / gone / moved <from>-><to> (the tick shows on another item).',
      'Every case except N12 runs without the variant prefix, so P keys start with `root/` instead of the variant',
      '(the note writes `systemMedium/...`); no single-variant outcome depends on that root segment.',
      "In N16 and N16b, C's `keys=1` holds by construction (one explicit key); only `values=[...]` is measured.",
      '',
      matrix,
      '',
    ].join('\n')
    const target = path.join(evidenceDir, 't7-positional-identity.md')
    let formatted = body
    try {
      // Keep the generated file clean under the repo's `prettier --check .` (root devDependency, sync in 2.x).
      const prettier = require('prettier')
      const config = prettier.resolveConfig.sync(target) ?? {}
      formatted = prettier.format(body, { ...config, filepath: target })
    } catch {
      // Prettier unavailable: write the raw table; a human formats it before committing.
    }
    fs.writeFileSync(target, formatted)
  }

  assert.equal(results.length, Object.keys(PREDICTIONS).length)
})
