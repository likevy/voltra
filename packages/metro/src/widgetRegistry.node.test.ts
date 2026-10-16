import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, mock, test } from 'node:test'
import { createElement } from 'react'

import { bundleWidgets } from './bundleWidgets.ts'
import { createVoltraMiddleware } from './createVoltraMiddleware.ts'
import { createLiveActivityRegistry } from './liveActivityRegistry.ts'
import { createWidgetRegistry } from './widgetRegistry.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

// The real built Android client package, used to execute generated entries end to end. React is
// resolved from the same place so elements and the renderer share one React instance.
const androidPackagePath = path.join(repoRoot, 'packages', 'android')
const requireFromAndroid = createRequire(path.join(androidPackagePath, 'package.json'))

type GeneratedEntryExports = {
  render: (propsJSON: string, envJSON: string) => string
  interact: (payloadJSON: string) => string
}

/**
 * Turns a generated Dynamic Widget entry into a callable module by dropping its imports and
 * injecting them as arguments instead.
 */
function loadGeneratedEntry(
  generatedEntryPath: string,
  imports: {
    createElement: unknown
    renderVariantToJson: unknown
    runWithVoltraState: unknown
    WidgetModule: Record<string, unknown>
  }
): GeneratedEntryExports {
  const executableEntry = fs
    .readFileSync(generatedEntryPath, 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n')
    .replace('export function render(propsJSON, envJSON)', 'function render(propsJSON, envJSON)')
    .replace('export function interact(payloadJSON)', 'function interact(payloadJSON)')
    .replace('export default render', 'return { render, interact }')

  const createEntry = new Function(
    'createElement',
    'renderVariantToJson',
    'runWithVoltraState',
    'WidgetModule',
    executableEntry
  ) as (...args: unknown[]) => GeneratedEntryExports

  return createEntry(
    imports.createElement,
    imports.renderVariantToJson,
    imports.runWithVoltraState,
    imports.WidgetModule
  )
}

type TempProject = {
  projectRoot: string
  cleanup: () => void
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contents)
}

function makeTempProject(files: Record<string, string>): TempProject {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voltra-metro-manifest-'))
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(projectRoot, 'node_modules'), 'dir')
  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'voltra-metro-test-project', private: true }, null, 2)
  )

  for (const [relativePath, contents] of Object.entries(files)) {
    writeFile(path.join(projectRoot, relativePath), contents)
  }

  return {
    projectRoot,
    cleanup: () => fs.rmSync(projectRoot, { recursive: true, force: true }),
  }
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

describe('@use-voltra/metro manifest registry', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.()
    }
    mock.restoreAll()
  })

  test('loads platform manifests independently and generates default-export adapters', () => {
    const { projectRoot, cleanup } = makeTempProject({
      '.voltra/manifest.ios.json': JSON.stringify(
        {
          version: 1,
          platform: 'ios',
          widgets: [{ id: 'home', entry: 'widgets/ios-home.js' }],
        },
        null,
        2
      ),
      '.voltra/manifest.android.json': JSON.stringify(
        {
          version: 1,
          platform: 'android',
          widgets: [{ id: 'home', entry: 'widgets/android-home.js' }],
        },
        null,
        2
      ),
      'widgets/ios-home.js': 'export default function IosHomeWidget() { return null }\n',
      'widgets/android-home.js': 'export default function AndroidHomeWidget() { return null }\n',
    })
    cleanups.push(cleanup)

    const registry = createWidgetRegistry({ projectRoot })

    try {
      const iosWidget = registry.getWidget('ios', 'home')
      const androidWidget = registry.getWidget('android', 'home')

      assert.ok(iosWidget)
      assert.ok(androidWidget)
      assert.equal(iosWidget?.platform, 'ios')
      assert.equal(androidWidget?.platform, 'android')
      assert.notEqual(iosWidget?.generatedEntryPath, androidWidget?.generatedEntryPath)
      assert.ok(path.basename(iosWidget!.generatedEntryPath).startsWith('ios-home-'))
      assert.ok(path.basename(androidWidget!.generatedEntryPath).startsWith('android-home-'))
      assert.deepEqual(
        registry.listWidgets('ios').map((widget) => widget.id),
        ['home']
      )
      assert.deepEqual(
        registry
          .listWidgets()
          .map((widget) => `${widget.platform}:${widget.id}`)
          .sort(),
        ['android:home', 'ios:home']
      )

      const iosGenerated = fs.readFileSync(iosWidget!.generatedEntryPath, 'utf8')
      const iosEntryImport = toPosix(
        path.relative(path.dirname(iosWidget!.generatedEntryPath), path.join(projectRoot, iosWidget!.entry))
      )
      // The entry imports the author module as a namespace so an optional `onInteraction` export
      // reaches native through `interact`.
      assert.ok(iosGenerated.includes(`import * as WidgetModule from ${JSON.stringify(iosEntryImport)}`))
      assert.ok(!iosGenerated.includes('import Widget from'))
      assert.match(iosGenerated, /export function interact\(payloadJSON\)/)
      assert.ok(!iosGenerated.includes('export { Widget }'))
      assert.match(iosGenerated, /export function render\(propsJSON, envJSON\)/)

      const iosBarrel = fs.readFileSync(path.join(projectRoot, '.voltra', 'metro', 'widget-hot-reload.ios.js'), 'utf8')
      const iosBarrelImport = `./${toPosix(
        path.relative(path.join(projectRoot, '.voltra', 'metro'), iosWidget!.generatedEntryPath)
      )}`
      assert.ok(iosBarrel.includes(`import ${JSON.stringify(iosBarrelImport)}`))
      assert.ok(iosBarrel.includes('manifest-declared Voltra widgets'))
    } finally {
      registry.close()
    }
  })

  for (const platform of ['ios', 'android'] as const) {
    test(`generated ${platform} Dynamic Widget adapters preserve reserved React prop names`, () => {
      const { projectRoot, cleanup } = makeTempProject({
        [`.voltra/manifest.${platform}.json`]: JSON.stringify(
          {
            version: 1,
            platform,
            widgets: [{ id: 'inbox', entry: 'widgets/inbox.js' }],
          },
          null,
          2
        ),
        'widgets/inbox.js': 'export default function InboxDynamicWidget() { return null }\n',
      })
      cleanups.push(cleanup)

      const registry = createWidgetRegistry({ projectRoot })

      try {
        const dynamicWidget = registry.getWidget(platform, 'inbox')
        assert.ok(dynamicWidget)

        const generatedAdapter = fs.readFileSync(dynamicWidget.generatedEntryPath, 'utf8')
        const executableAdapter = generatedAdapter
          .split('\n')
          .filter((line) => !line.startsWith('import '))
          .join('\n')
          .replace('export function render(propsJSON, envJSON)', 'function render(propsJSON, envJSON)')
          .replace('export function interact(payloadJSON)', 'function interact(payloadJSON)')
          .replace('export default render', 'return render')

        type DynamicWidgetRender = (propsJSON: string, envJSON: string) => string
        type DynamicWidgetElement = {
          type: (props: Record<string, unknown>) => unknown
          props: Record<string, unknown>
        }
        type CreateDynamicWidgetElement = (
          type: DynamicWidgetElement['type'],
          props: Record<string, unknown>
        ) => DynamicWidgetElement

        const createAdapter = new Function(
          'createElement',
          'renderVariantToJson',
          'runWithVoltraState',
          'WidgetModule',
          executableAdapter
        ) as (
          createElement: CreateDynamicWidgetElement,
          renderVariantToJson: (element: DynamicWidgetElement) => unknown,
          runWithVoltraState: (state: unknown, fn: () => unknown) => unknown,
          WidgetModule: { default: (props: Record<string, unknown>, env: Record<string, unknown>) => unknown }
        ) => DynamicWidgetRender

        const render = createAdapter(
          createElement as unknown as CreateDynamicWidgetElement,
          (element) => element.type(element.props),
          (_state, fn) => fn(),
          { default: (props, env) => ({ props, env }) }
        )
        const dynamicWidgetProps = {
          key: 'primary-inbox',
          unreadCount: 7,
          mailbox: { id: 'primary' },
        }
        const dynamicWidgetEnvironment = { widgetFamily: '200x100' }

        const rendered = JSON.parse(
          render(JSON.stringify(dynamicWidgetProps), JSON.stringify(dynamicWidgetEnvironment))
        )

        assert.deepEqual(rendered, {
          props: dynamicWidgetProps,
          env: dynamicWidgetEnvironment,
        })
      } finally {
        registry.close()
      }
    })
  }

  describe('widget state contract (PoC for issue #343)', () => {
    const android = requireFromAndroid(androidPackagePath)
    const react = requireFromAndroid('react')

    function makeStateWidgetProject(widgetModule: Record<string, unknown>): GeneratedEntryExports & {
      generatedSource: string
    } {
      const { projectRoot, cleanup } = makeTempProject({
        '.voltra/manifest.android.json': JSON.stringify({
          version: 1,
          platform: 'android',
          widgets: [{ id: 'todo', entry: 'widgets/todo.js' }],
        }),
        'widgets/todo.js': 'export default function TodoWidget() { return null }\n',
      })
      cleanups.push(cleanup)

      const registry = createWidgetRegistry({ projectRoot })
      try {
        const widget = registry.getWidget('android', 'todo')
        assert.ok(widget)

        return {
          generatedSource: fs.readFileSync(widget.generatedEntryPath, 'utf8'),
          ...loadGeneratedEntry(widget.generatedEntryPath, {
            createElement: react.createElement,
            renderVariantToJson: android.renderAndroidVariantToJson,
            runWithVoltraState: android.runWithVoltraState,
            WidgetModule: widgetModule,
          }),
        }
      } finally {
        registry.close()
      }
    }

    function createTodoWidgetModule(seenEnvs: Array<Record<string, unknown>>): Record<string, unknown> {
      return {
        default: (_props: Record<string, unknown>, env: Record<string, unknown>) => {
          seenEnvs.push(env)
          return react.createElement(
            android.VoltraAndroid.Column,
            null,
            react.createElement(android.VoltraAndroid.CheckBox, {
              id: 'a',
              checked: android.useVoltraState('done.a', false),
            })
          )
        },
      }
    }

    test('generated source exposes interact and wraps render in runWithVoltraState', () => {
      const { generatedSource } = makeStateWidgetProject(createTodoWidgetModule([]))

      assert.match(generatedSource, /export function interact\(/)
      assert.match(generatedSource, /runWithVoltraState\(/)
      assert.match(generatedSource, /import \{ renderVariantToJson, runWithVoltraState \} from /)
    })

    test('render reads env.__voltraState through useVoltraState and hides it from the widget env', () => {
      const seenEnvs: Array<Record<string, unknown>> = []
      const { render } = makeStateWidgetProject(createTodoWidgetModule(seenEnvs))

      const rendered = JSON.parse(
        render('{}', JSON.stringify({ widgetFamily: '200x100', __voltraState: { 'done.a': true } }))
      )

      assert.deepEqual(rendered, { t: 9, c: { t: 3, i: 'a', p: { chk: true } } })
      assert.equal(seenEnvs.length, 1)
      assert.deepEqual(seenEnvs[0], { widgetFamily: '200x100' })
      assert.ok(!Object.prototype.hasOwnProperty.call(seenEnvs[0], '__voltraState'))
    })

    test('render without env.__voltraState renders initial values', () => {
      const { render } = makeStateWidgetProject(createTodoWidgetModule([]))

      const rendered = JSON.parse(render('{}', JSON.stringify({ widgetFamily: '200x100' })))

      assert.deepEqual(rendered, { t: 9, c: { t: 3, i: 'a', p: { chk: false } } })
    })

    test('interact reports handled false when the widget has no onInteraction', () => {
      const { interact } = makeStateWidgetProject(createTodoWidgetModule([]))

      assert.deepEqual(JSON.parse(interact(JSON.stringify({ event: { componentId: 'a' } }))), { handled: false })
    })

    test('interact calls onInteraction with event, props, state and env and returns its state patch', () => {
      const calls: unknown[] = []
      const event = {
        componentId: 'a',
        componentType: 'CheckBox',
        value: true,
        renderedRevision: 3,
        stateKey: null,
        timestamp: 1760000000000,
      }
      const { interact } = makeStateWidgetProject({
        ...createTodoWidgetModule([]),
        onInteraction: (receivedEvent: unknown, context: Record<string, unknown>) => {
          calls.push({
            event: receivedEvent,
            context,
            stateSlot: android.useVoltraState('done.b', 'missing'),
          })
          return { state: { 'done.a': true } }
        },
      })

      const result = JSON.parse(
        interact(
          JSON.stringify({
            event,
            props: { title: 'Buy bread' },
            state: { 'done.b': false },
            env: { widgetFamily: '200x100' },
          })
        )
      )

      assert.deepEqual(result, { handled: true, state: { 'done.a': true } })
      assert.deepEqual(calls, [
        {
          event,
          context: { props: { title: 'Buy bread' }, state: { 'done.b': false }, env: { widgetFamily: '200x100' } },
          stateSlot: false,
        },
      ])
    })

    test('interact defaults missing payload fields and returns a null patch for a result without state', () => {
      const calls: unknown[] = []
      const { interact } = makeStateWidgetProject({
        ...createTodoWidgetModule([]),
        onInteraction: (receivedEvent: unknown, context: unknown) => {
          calls.push({ event: receivedEvent, context })
          return undefined
        },
      })

      assert.deepEqual(JSON.parse(interact('')), { handled: true, state: null })
      assert.deepEqual(calls, [{ event: {}, context: { props: {}, state: {}, env: {} } }])
    })

    test('interact rejects an async onInteraction', () => {
      const { interact } = makeStateWidgetProject({
        ...createTodoWidgetModule([]),
        onInteraction: async () => ({ state: { 'done.a': true } }),
      })

      assert.throws(
        () => interact(JSON.stringify({ event: { componentId: 'a' } })),
        /Voltra widget "todo" onInteraction must be synchronous/
      )
    })
  })

  test('surfaces a missing platform manifest when a widget is requested', () => {
    const { projectRoot, cleanup } = makeTempProject({
      '.voltra/manifest.ios.json': JSON.stringify(
        {
          version: 1,
          platform: 'ios',
          widgets: [{ id: 'home', entry: 'widgets/home.js' }],
        },
        null,
        2
      ),
      'widgets/home.js': 'export default function HomeWidget() { return null }\n',
    })
    cleanups.push(cleanup)

    const registry = createWidgetRegistry({ projectRoot })

    try {
      assert.throws(
        () => registry.getWidget('android', 'home'),
        /Missing Voltra dynamic widgets manifest for android at \.voltra\/manifest\.android\.json\. Run Expo prebuild for android to generate it\./
      )
    } finally {
      registry.close()
    }
  })

  test('keeps Dynamic Live Activities in a separate registry when IDs collide with widgets', () => {
    const { projectRoot, cleanup } = makeTempProject({
      '.voltra/manifest.ios.json': JSON.stringify({
        version: 1,
        platform: 'ios',
        widgets: [{ id: 'order', entry: 'widgets/order.js' }],
      }),
      '.voltra/manifest.ios.live-activities.json': JSON.stringify({
        version: 1,
        platform: 'ios',
        liveActivities: [{ id: 'order', entry: 'live-activities/order.js' }],
      }),
      'widgets/order.js': 'export default function OrderWidget() { return null }\n',
      'live-activities/order.js': 'export default function OrderLiveActivity() { return {} }\n',
    })
    cleanups.push(cleanup)
    const widgets = createWidgetRegistry({ projectRoot })
    const liveActivities = createLiveActivityRegistry({ projectRoot })
    try {
      const widget = widgets.getWidget('ios', 'order')
      const liveActivity = liveActivities.getLiveActivity('order')
      assert.ok(widget)
      assert.ok(liveActivity)
      assert.notEqual(widget.generatedEntryPath, liveActivity.generatedEntryPath)
      const generated = fs.readFileSync(liveActivity.generatedEntryPath, 'utf8')
      assert.match(generated, /renderLiveActivityToJson/)
      assert.match(generated, /new Date\(environment.date\)/)
      assert.match(generated, /__voltraDynamicLiveActivities/)
      assert.match(generated, /__voltraDynamicLiveActivityDefinitionUpdated/)
      assert.match(generated, /\("order"\)/)
      assert.match(generated, /LiveActivity\(props, environment\)/)
    } finally {
      widgets.close()
      liveActivities.close()
    }
  })

  test('reports malformed Dynamic Live Activity manifests with collection-specific errors', () => {
    const { projectRoot, cleanup } = makeTempProject({
      '.voltra/manifest.ios.live-activities.json': JSON.stringify({ version: 1, platform: 'ios', widgets: [] }),
    })
    cleanups.push(cleanup)
    const registry = createLiveActivityRegistry({ projectRoot })
    try {
      assert.throws(
        () => registry.listLiveActivities(),
        /dynamic live activities manifest.*liveActivities must be an array/i
      )
    } finally {
      registry.close()
    }
  })
})

describe('@use-voltra/metro middleware and bundling', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.()
    }
    mock.restoreAll()
  })

  test('routes bundle requests by platform and widget id', () => {
    const { projectRoot, cleanup } = makeTempProject({
      '.voltra/manifest.ios.json': JSON.stringify(
        {
          version: 1,
          platform: 'ios',
          widgets: [{ id: 'home', entry: 'widgets/ios-home.js' }],
        },
        null,
        2
      ),
      '.voltra/manifest.android.json': JSON.stringify(
        {
          version: 1,
          platform: 'android',
          widgets: [{ id: 'home', entry: 'widgets/android-home.js' }],
        },
        null,
        2
      ),
      'widgets/ios-home.js': 'export default function IosHomeWidget() { return null }\n',
      'widgets/android-home.js': 'export default function AndroidHomeWidget() { return null }\n',
    })
    cleanups.push(cleanup)

    const registry = createWidgetRegistry({ projectRoot })
    const calls: string[] = []
    const middleware = createVoltraMiddleware({
      registry,
      widgetMetro: {
        middleware(req: { url: string }, _res: unknown, _next: () => void) {
          calls.push(req.url)
        },
      },
    })

    const response = {
      status: 0,
      body: '',
      writeHead(status: number) {
        this.status = status
      },
      end(chunk: string) {
        this.body = chunk
      },
    }

    try {
      middleware({ url: '/widgets/home.bundle?platform=android&dev=true' }, response, () => {
        throw new Error('next() should not be called for a matched widget bundle')
      })

      assert.equal(calls.length, 1)
      assert.ok(calls[0].startsWith('/voltra-widget.bundle?'))
      assert.match(calls[0], /platform=android/)
      assert.match(calls[0], /bundleEntry=.*android-home/)
      assert.equal(response.status, 0)
      assert.equal(response.body, '')
    } finally {
      registry.close()
    }
  })

  test('routes colliding Dynamic Live Activity bundles through their dedicated endpoint', () => {
    const { projectRoot, cleanup } = makeTempProject({
      '.voltra/manifest.ios.json': JSON.stringify({
        version: 1,
        platform: 'ios',
        widgets: [{ id: 'order', entry: 'widgets/order.js' }],
      }),
      '.voltra/manifest.ios.live-activities.json': JSON.stringify({
        version: 1,
        platform: 'ios',
        liveActivities: [{ id: 'order', entry: 'live-activities/order.js' }],
      }),
      'widgets/order.js': 'export default function OrderWidget() { return null }\n',
      'live-activities/order.js': 'export default function OrderLiveActivity() { return {} }\n',
    })
    cleanups.push(cleanup)
    const registry = createWidgetRegistry({ projectRoot })
    const liveActivityRegistry = createLiveActivityRegistry({ projectRoot })
    const calls: string[] = []
    const middleware = createVoltraMiddleware({
      registry,
      liveActivityRegistry,
      widgetMetro: {
        middleware(req: { url: string }) {
          calls.push(req.url)
        },
      },
    })
    const response = { writeHead() {}, end() {} }
    try {
      middleware({ url: '/live-activities/order.bundle?platform=ios' }, response, () => {})
      assert.equal(calls.length, 1)
      assert.match(calls[0], /bundleEntry=.*live-activities/)
      assert.match(calls[0], /platform=ios/)
    } finally {
      registry.close()
      liveActivityRegistry.close()
    }
  })

  test('bakes no bundles for an empty manifest', async () => {
    const { projectRoot, cleanup } = makeTempProject({
      '.voltra/manifest.ios.json': JSON.stringify(
        {
          version: 1,
          platform: 'ios',
          widgets: [],
        },
        null,
        2
      ),
      '.voltra/manifest.android.json': JSON.stringify(
        {
          version: 1,
          platform: 'android',
          widgets: [],
        },
        null,
        2
      ),
    })
    cleanups.push(cleanup)

    const outDir = path.join(projectRoot, 'dist', 'widgets')
    await bundleWidgets({
      projectRoot,
      outDir,
      platform: 'ios',
    })

    assert.equal(fs.existsSync(outDir), false)
  })

  test('keeps release bundle filenames aligned with native loaders', async () => {
    const { projectRoot, cleanup } = makeTempProject({
      '.voltra/manifest.ios.json': JSON.stringify(
        {
          version: 1,
          platform: 'ios',
          widgets: [{ id: 'home', entry: 'widgets/home.js' }],
        },
        null,
        2
      ),
      'widgets/home.js': 'export default function HomeWidget() { return null }\n',
    })
    cleanups.push(cleanup)

    const originalLoad = (Module as any)._load
    mock.method(Module as any, '_load', function (request: string, parent: unknown, isMain: boolean) {
      if (request === 'metro') {
        return {
          runBuild: async () => ({ code: 'bundle' }),
        }
      }

      if (request === 'metro-config') {
        return {
          loadConfig: async () => ({
            resolver: { sourceExts: [] },
            watchFolders: [],
            serializer: {},
            transformer: {},
            server: {},
          }),
          getDefaultConfig: async () => ({
            resolver: { sourceExts: [] },
            watchFolders: [],
            serializer: {},
            transformer: {},
            server: {},
          }),
        }
      }

      return originalLoad.call(this, request, parent, isMain)
    })

    const outDir = path.join(projectRoot, 'dist', 'widgets')
    await bundleWidgets({
      projectRoot,
      outDir,
      platform: 'ios',
    })

    assert.deepEqual(fs.readdirSync(outDir), ['voltra-widget-home.bundle'])
  })

  test('bakes Dynamic Live Activity bundles with their dedicated release prefix', async () => {
    const { projectRoot, cleanup } = makeTempProject({
      '.voltra/manifest.ios.json': JSON.stringify({
        version: 1,
        platform: 'ios',
        widgets: [{ id: 'order', entry: 'widgets/order.js' }],
      }),
      '.voltra/manifest.ios.live-activities.json': JSON.stringify({
        version: 1,
        platform: 'ios',
        liveActivities: [{ id: 'order', entry: 'live-activities/order.js' }],
      }),
      'widgets/order.js': 'export default function OrderWidget() { return null }\n',
      'live-activities/order.js': 'export default function OrderLiveActivity() { return {} }\n',
    })
    cleanups.push(cleanup)
    const originalLoad = (Module as any)._load
    mock.method(Module as any, '_load', function (request: string, parent: unknown, isMain: boolean) {
      if (request === 'metro') return { runBuild: async () => ({ code: 'bundle' }) }
      if (request === 'metro-config')
        return {
          loadConfig: async () => ({ resolver: {}, watchFolders: [], serializer: {}, transformer: {}, server: {} }),
          getDefaultConfig: async () => ({
            resolver: {},
            watchFolders: [],
            serializer: {},
            transformer: {},
            server: {},
          }),
        }
      return originalLoad.call(this, request, parent, isMain)
    })
    const outDir = path.join(projectRoot, 'dist', 'widgets')
    await bundleWidgets({ projectRoot, outDir, platform: 'ios' })
    assert.deepEqual(fs.readdirSync(outDir).sort(), ['voltra-live-activity-order.bundle', 'voltra-widget-order.bundle'])
  })
})
