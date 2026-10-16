# PoC #343: in-widget state for Dynamic Widgets (Android)

Everything under `poc/343/` is throwaway, and so is the PoC code it describes (issue
callstackincubator/voltra#343, plan of 2026-10-15). Nothing here is API.

- `REPORT.md`: the verification report (what was built, demo results D1–D6 and K1/K3, latency, tests, open issues,
  ADR decision list with evidence). `HANDOFF.md`: the commit message and the commands for the human to commit and push.
- `FINDINGS.md`: Step 0 and the day-1 spikes S1–S6, which ran before the implementation.
- `evidence/`: logcat excerpts, screenshots, JSON and test output. `00-*` and `s*-*` come from the spikes,
  `t4-*` from the example-app build and `t5-*` from the verification run.
- `media/`: screen recordings and the detached Metro log. Gitignored; the human attaches recordings to the issue.

## Layout of the PoC code

| Area                  | Files                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core state slot       | `packages/core/src/renderer/voltra-state.ts` (`useVoltraState`, `runWithVoltraState`), re-exported from `@use-voltra/android` and `@use-voltra/ios`; tests in `packages/core/test/voltra-state.test.js`                                                                                                                                                                                                                                |
| Metro generated entry | `packages/metro/src/widgetRegistry.ts`: namespace import of the widget module, `env.__voltraState` stripped into the slot, and a new `interact(payloadJSON)` export that calls the author's `onInteraction`; tests in `widgetRegistry.node.test.ts`                                                                                                                                                                                    |
| JNI                   | `VoltraJSRenderer.kt` `invoke(widgetId, exportName, payloadJSON)` → `voltra_js_renderer.cpp` `nativeInvoke`                                                                                                                                                                                                                                                                                                                            |
| Android read path     | `VoltraClientGlanceWidget.kt` (state into `env.__voltraState`, `render …` repaint log line), `DynamicWidgetGlanceState.kt`, `DynamicWidgetRenderCoordinator.kt`, `VoltraRenderContext.kt`, `GlanceFactory.kt`                                                                                                                                                                                                                          |
| Android tap path      | `dynamicwidget/state/`: `DynamicWidgetStateActionCallback` (Glance `ActionCallback`), `DynamicWidgetStateInteraction` (the flow), `DynamicWidgetStateStore` (placement and scope stores), `DynamicWidgetStateFlags`, `DynamicWidgetStatePushReset`, `DynamicWidgetEventQueue`, `DynamicWidgetStateClickRule` (wired in `InputRenderers.kt` and `ButtonRenderers.kt`); Robolectric tests in `src/test/java/voltra/dynamicwidget/state/` |
| JS bridge             | `packages/android-client/src/dynamic-widget/api.ts`: `readAndroidDynamicWidgetState`, `resetAndroidDynamicWidgetState`, `drainAndroidDynamicWidgetEvents`, `setAndroidDynamicWidgetStateFlags` (TurboModule methods in `VoltraModule.kt`)                                                                                                                                                                                              |
| Example app           | `example/widgets/android/TodoStateWidget.tsx` (option C) and `TodoStateKeyWidget.tsx` (option D), their `app.json` entries, `example/screens/android/TodoStateScreen.tsx` (route `/android-widgets/todo-state`, deep link `voltra://android-widgets/todo-state`), four Appduct tools in `example/appduct/AndroidVoltraTools.tsx`                                                                                                       |

Positional `useState` (the "Voltra useState Identity" design note) vs option C: `packages/core/test/voltra-state-positional-identity.test.js` (throwaway walker in `packages/core/src/renderer/voltra-state-positional.ts`, exported only as `__poc343Positional`), matrix in `poc/343/evidence/t7-positional-identity.md`, write-up in `REPORT.md` §8.

## Authoring: `stateKey` (option D) vs `useVoltraState` + `onInteraction` (option C)

Reading is the same in both: `useVoltraState(key, initial)` returns the value the host persisted for this
placement (or the initial value), and it is read-only during render. The two options differ only in **who writes**
the record when a control is tapped.

**Option C: the widget's own handler decides.** Native evaluates the widget bundle in the app process, calls the
generated entry's `interact`, which calls the widget file's `onInteraction(event, { props, state, env })`; the
returned `{ state: patch }` is merged into the record (top-level keys replaced), committed with a revision bump, and
the widget re-renders. Any shape is possible: a map keyed by item id, several keys at once, derived values, or
ignoring the tap by returning `undefined`.

```tsx
export default function TodoStateWidget(props, env) {
  const done = useVoltraState<Record<string, boolean>>('done', {})
  return (
    <VoltraAndroid.Column>
      {props.items.map((item) => (
        <VoltraAndroid.CheckBox id={'task:' + item.id} text={item.title} checked={!!done[item.id]} />
      ))}
    </VoltraAndroid.Column>
  )
}

export function onInteraction(event, { state }) {
  if (event.componentId.startsWith('task:')) {
    return { state: { done: { ...state.done, [event.componentId.slice(5)]: event.value === true } } }
  }
  return undefined
}
```

`event` carries `componentId` (the control's `id`), `componentType`, `value` (the toggle value the host delivered,
absolute on API 31+, `null` for buttons), `renderedRevision`, `stateKey` and `timestamp`. The handler must be
synchronous. Cost: one bundle evaluation per tap inside the callback (18–46 ms in release), plus the repaint.

**Option D: the control names its key.** A `stateKey` prop on `CheckBox` or `Switch` makes native write
`state[stateKey] = checked` itself, with no JS on the tap. One flat key, one boolean, nothing to compute; the widget
needs no `onInteraction` at all.

```tsx
export default function TodoStateKeyWidget(props, env) {
  return (
    <VoltraAndroid.Column>
      {props.items.map((item) => (
        <VoltraAndroid.CheckBox
          id={item.id}
          text={item.title}
          checked={useVoltraState('done.' + item.id, false)}
          {...({ stateKey: 'done.' + item.id } as object)}
        />
      ))}
    </VoltraAndroid.Column>
  )
}
```

**How native picks the path.** For a tapped control with an author `id` in a Dynamic Widget: if the action carries a
non-empty `stateKey` and the host delivered a toggle value, the D write runs and JS is skipped; otherwise the C path
runs (`interact` → `onInteraction`). A widget can mix both: plain toggles with `stateKey`, anything richer through
`onInteraction`. Both paths share the same record, revision, event queue (`handledInWidget`, `stateChange`) and the
final `update()`. A props push from the app never touches the record in either option (flag `precedence=survive`).

**Caveats.** `stateKey` is not in the generated CheckBox/Switch prop types yet, hence the cast. The `onInteraction`
export makes the widget file a non-refresh boundary in dev, so every edit full-reloads the app (option D's file
hot-patches). Below API 31 the toggle value the host delivers is the negation of the last rendered value, so a double
tap before a repaint writes the same value twice (not tested here; no pre-31 image).

## Environment

```bash
source ~/Documents/Projects/callstack/voltra/voltra-poc-343/poc/343/env.sh   # every shell
```

`env.sh` pins JDK 17, `ANDROID_HOME=~/Library/Android/sdk` (the real `emulator` ahead of the legacy `sdk/tools` shim),
Node 24.13.0 through nvm and pnpm 11.5.0 through `corepack enable pnpm`, and exports `PKG` and `WT`. Node 24 is
required: on Node 22, `pnpm --filter @use-voltra/metro test` reports `tests 0` and exits 0 (spike S6). Every test run
must therefore show a non-zero count.

## Build and run (debug, API 35 AVD)

```bash
cd "$WT" && pnpm install --frozen-lockfile && pnpm exec lefthook uninstall   # lefthook writes into the shared .git/hooks
pnpm run build:all
emulator -avd Brownfield_457_API_35 -no-snapshot-load &
adb wait-for-device
cd "$WT/example" && CI=1 pnpm exec expo prebuild --platform android --clean
pnpm exec expo run:android --device Brownfield_457_API_35                    # the AVD name; "emulator-5554" is rejected
adb reverse tcp:8081 tcp:8081                                                # again after every emulator reboot
adb shell am start -a android.intent.action.VIEW -d voltra://android-widgets/todo-state $PKG
```

On the screen, pin both widgets with "Pin Todo · onInteraction (option C)" and "Pin Todo · stateKey (option D)" and
confirm the system dialog ("Add to home screen"). Debug widgets fetch their bundle from Metro at the start of every
Glance session, so keep Metro running for every "killed" run. After changing Kotlin or C++, run `expo run:android` again.
That command starts its own Metro, so stop the detached one first. After changing `packages/metro/src`, run
`pnpm --filter @use-voltra/metro build` and restart Metro. Restart Metro after every prebuild.

Appduct (dev build only):

```bash
cd "$WT/example"
appduct sessions link --open android --device emulator-5554 --app-id $PKG    # re-link after the app process dies
appduct tools call android_list_widgets --input '{}'
appduct tools call android_read_dynamic_widget_state --input '{"appWidgetId":4}'
appduct tools call android_set_dynamic_widget_state_flags --input '{"flags":{"precedence":"resetOnPush"}}'
appduct tools call android_update_dynamic_widget --input '{"widgetId":"TodoStateWidget","props":{"items":[{"id":"t4","title":"New"}]}}'
appduct tools call android_drain_dynamic_widget_events --input '{}'
```

`android_request_pin_widget` fails with "Calling application must have a foreground activity or a foreground service"
unless the app is in front. A session sometimes disappears from `appduct sessions ls` after about 15 minutes with the app in
the background. Re-link it.

## Tests

```bash
pnpm --filter @use-voltra/core test            # tests 32
pnpm --filter @use-voltra/metro test           # tests 33
pnpm --filter @use-voltra/android-client test  # 34 + 57 (two Jest configs)
cd "$WT/example/android" && ./gradlew --init-script "$WT/poc/343/scripts/jdk17-unit-tests.init.gradle" \
  :use-voltra_android-client:testDebugUnitTest --tests "voltra.dynamicwidget.state.*"   # 23 Robolectric tests
cd "$WT" && pnpm run typecheck && pnpm run lint
```

Without the init script, the Robolectric command fails while Gradle configures the project: the library asks for a
JDK 21 test launcher, and no JDK 21 is installed or downloadable here. The init script swaps in JDK 17. That is valid
only for tests without `@Config(sdk >= 36)`.

## Scripts (`scripts/`)

| Script                                                                                  | Use                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t5-page.sh C\|D`                                                                       | HOME, then swipe to the launcher page with widget C or D. Layout on the AVD: [Discover] [default] [C] [D] [second C placement]                                |
| `t5-tap.sh <label> X Y`                                                                 | logs `Poc343Tap: TAP <label>` on the device, then `input tap`                                                                                                 |
| `t5-checked.sh`                                                                         | checked flags of every CheckBox and Switch on screen (uiautomator)                                                                                            |
| `t5-state.sh <appWidgetId>`                                                             | decodes the placement's Glance DataStore (`files/datastore/appWidget-<id>.preferences_pb`) with `run-as`, without starting the app; uses `t5-glance-prefs.py` |
| `t5-kill.sh [wait]`                                                                     | `am kill` until `pidof` is empty (retries while a Glance session keeps the process alive). Never `am force-stop`                                              |
| `t5-logcat.sh`                                                                          | dumps the tags `DynamicWidgetState`, `VoltraClientGlanceWidget`, `VoltraJSRenderer`, `Poc343Tap` and the app's `ActivityManager` lines, with epoch timestamps |
| `t5-latency.py <logcat>…`                                                               | per tap: marker → callback → commit → update returned → first `render` with the committed `stateRevision`, plus callback and commit counts                    |
| `t5-d1.sh`, `t5-cold-series.sh`, `t5-warm-series.sh`, `t5-d3.sh`, `t5-d4.sh`, `t5-k.sh` | the demo and latency runs (results in the verification report)                                                                                                |
| `poc343-*.sh`                                                                           | the day-1 spike scripts (see `FINDINGS.md`). `poc343-goto-widget.sh` and `poc343-s1-s2.sh` target the removed `PocTodoSpike`                                  |
| `jdk17-unit-tests.init.gradle`                                                          | the JDK 17 override for the Robolectric suite                                                                                                                 |

The logcat filter for one tap:
`adb logcat -v epoch -s DynamicWidgetState VoltraClientGlanceWidget VoltraJSRenderer Poc343Tap`.

## Rules

Commits on this branch skip lefthook (`LEFTHOOK=0`; ktlint and swiftformat are not installed here). Never `am force-stop` on API 35:
it disables the widgets until the next launch (spike S2). Nothing is posted to the issue, and no PR is opened against `main`.
