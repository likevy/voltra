# PoC #343 — Step 0 and day-1 spikes S1–S6 (Android, API 35 emulator)

Branch `poc/343-in-widget-state` (worktree `../voltra-poc-343`, cut from `main` at `d447f6d`, voltra 2.4.0). Run on
2026-10-15 against `Brownfield_457_API_35` (Android 15, arm64-v8a, google_apis, CheckJNI late-enabled for the debug
build). Every file under `poc/343/` and every `poc343`/`Poc343`-prefixed name is throwaway evidence for the ADR, never
API. Scope note: on 2026-10-15 option B was dropped
from the PoC; the next phase builds option C under the name `useVoltraState` with the env carrier `__voltraState`, plus
option D (`stateKey`). Nothing in this pass is B-specific.

Evidence lives in `poc/343/evidence/` (logcat excerpts, screenshots, JSON, the baked release bundle). `poc/343/media/`
is gitignored for recordings; this pass produced screenshots only, no screen recordings.

## Step 0 — environment and baselines (pass)

| Check | Result | Evidence |
|---|---|---|
| `poc/343/env.sh` | JDK 17.0.13 (Zulu), `ANDROID_HOME=~/Library/Android/sdk`, real `emulator` ahead of the legacy `sdk/tools` shim, Node 24.13.0 via nvm, pnpm 11.5.0 via `corepack enable pnpm` | `which emulator node pnpm` prints `.../sdk/emulator/emulator`, `v24.13.0`, `11.5.0` |
| `pnpm install --frozen-lockfile` | 25.4 s; `prepare: lefthook install` wrote `pre-commit` and `pre-push` into the **shared** `.git/hooks` of the main checkout | — |
| `pnpm exec lefthook uninstall` (P8) | exit 0; `ls ~/Documents/Projects/callstack/voltra/voltra/.git/hooks` is back to the 14 `*.sample` files only; `core.hooksPath` unset | checked twice, before and after |
| `pnpm run build:all` | 12/12 Turborepo tasks in 9.5 s; `packages/core/build/cjs/index.js` exists | — |
| Baseline tests (Node 24.13.0) | core: tests 23, fail 0; metro: tests 26, suites 6, fail 0 | `evidence/00-baseline-tests.txt` |
| Emulator | `emulator -avd Brownfield_457_API_35 -no-snapshot-load`; `sys.boot_completed=1`; SDK 35, Android 15, arm64-v8a | — |
| Port 8081 | free before Metro | — |
| `CI=1 pnpm exec expo prebuild --platform android --clean` | 5.9 s, no errors; prerendered 1 Dynamic Widget placeholder (later 2) | — |
| `pnpm exec expo run:android` | `--device emulator-5554` is **rejected** by Expo CLI 55.0.31 ("Could not find device with name"); `--device Brownfield_457_API_35` (the AVD name) works. First debug build 4 min 6 s, incremental rebuilds 7 s. Only `arm64-v8a` is built (Expo passes `-PreactNativeArchitectures=arm64-v8a`) | `evidence/00-gradle-resolution.txt` |
| Gradle resolution | Gradle 9.0.0 (the only download of the whole pass), AGP 8.12.0, build-tools 36.0.0, **NDK 27.1.12297006**, **CMake 3.22.1** (`CMAKE_COMMAND` in `.cxx`), Kotlin 2.1.20, minSdk 24, targetSdk 36 | same |
| `compileSdk 37` | accepted from the installed `platforms;android-37.0` **without any download**; AGP prints "This Android Gradle plugin (8.12.0) was tested up to compile SDK version 36.0" and the template already sets `android.suppressUnsupportedCompileSdk=37.0`; also "SDK XML versions up to 3 but ... version 4" | same |
| Metro bundle | `curl .../voltra/widgets/AndroidClientDemoWidget.bundle?platform=android&dev=true` → **200** | — |
| Appduct | 0.15.0 installed with `npm install -g appduct` under Node 24. Differences from `docs/agents/appduct-e2e.md`: `sessions link` needs `--app-id com.callstackincubator.voltraexample` (or `.appduct/config.json`); a session dies with the app process (`am kill`, reinstall), so re-link and revoke the stale alias; the session is sometimes not active until ~3 s after "Delivered yes"; `android_list_widgets` needs `--input '{}'` | `evidence/00-android_list_widgets.json` |
| Pin | `android_request_pin_widget` + `input tap` on the system "Add to home screen" button; `AndroidClientDemoWidget` became `appWidgetId=2` (165×130 dp), later `PocTodoSpike` `appWidgetId=3` (255×200 dp) | `evidence/00-demo-widget-pinned.png` |

**D1 "before" baseline (Q7).** The demo widget has no clickable control, so a temporary `const [poc343Ticked] = useState(false)`
plus a `CheckBox` reading it was added (reverted afterwards, no diff left). Tapping the box opened the app
(`topResumedActivity = …/.MainActivity`), **ran zero JS renders**, and left the launcher showing the box **ticked** while its
label still said "useState unticked": on API 31+ the launcher host flips the `CompoundButton` itself (F25) and nothing
re-rendered. The next `android_reload_widgets` (6 JS renders) put the box back to unticked: `useState` persisted nothing and
the host flip is reverted by the next render. Evidence: `evidence/00-baseline-d1-before.txt`,
`00-baseline-usestate-before-tap.png`, `00-baseline-tap-opens-app.png`, `00-baseline-after-tap-home.png`,
`00-baseline-after-reload.png`.

## S1 — `update()` from an ActionCallback repaints a live, an expired and a killed session (pass)

A throwaway `Poc343PingCallback` (routed by `poc343OnClickOrDefault` for widgets whose id starts with `PocTodo` and
controls with an author `id`) bumps `dynamicWidgetPropsRevisionKey` in `updateAppWidgetState` and calls
`VoltraWidgetReceiver.getWidget(ctx, widgetId)!!.update(ctx, glanceId)`. All three conditions repainted (the `RENDER`
line inside `Content` carries the new revision and the widget text changed); no fallback (`updateAll`, RemoteViews push)
was needed. Whether `provideGlance` re-ran is exactly F20: never for a live session, always otherwise. Debug build, so
every `provideGlance` fetches the bundle from Metro (14–17 ms) and re-evaluates it (34–117 ms).

| Condition (tap → first `RENDER`) | callback entered | `update()` returned | `provideGlance` re-ran? | repaint | renders |
|---|---|---|---|---|---|
| T1 warm process, session expired (pin session was 1 min old) | +56 ms | +81 ms (update 17 ms) | **yes** (+286 ms, eval 34 ms) | **+497 ms** (`rev=1`) | 3 |
| T2 live session (4 s after T1) | +44 ms | +52 ms (update 2 ms) | **no** | **+61 ms** (`rev=2`) | 3 |
| T3 warm process, expired session (72 s idle) | +42 ms | +56 ms | **yes** (+263 ms, eval 37 ms) | **+472 ms** (`rev=3`) | 3 |
| T4 killed process (`am kill`, `pidof` empty) | `Start proc … for broadcast {…ActionCallbackBroadcastReceiver}` at +58 ms; callback at **+805 ms** (new pid, `procStartUptimeMs` 1548073 vs 1133313 before) | +881 ms (update 39 ms) | **yes** (+1111 ms, eval 117 ms, first JS render 100 ms) | **+1431 ms** (`rev=4`) | 3 |

Observations for the next phase: `update()` returns in 2–40 ms, before the composition; the repaint always lands on
`main` later. The live-session path is a pure recomposition (`currentState` key change → `renderNode` ×3). A session
that expired costs one `provideGlance` + bundle re-evaluation on `main` (F21, no cache). Evidence:
`evidence/s1-s2-s3-logcat.log` (T4 is the `T4b` block; the first `T4` tap in the same file hit wallpaper because the
script pressed HOME while the launcher was already in front, which scrolls it to its default page — fixed in the script),
`s1-spike-pinned.png`, `s1-after-cold-tap.png`.

## S2 — `am kill` semantics and the force-stop negative case (pass)

`am kill` after HOME **and** after the Glance session had ended (the spike waits for its own `CONTENT_DISPOSED` line)
killed the process on the first try: `ActivityManager: Killing 4016:com.callstackincubator.voltraexample/u0a210 (adj 700):
kill background`, `pidof` printed nothing, the `adb root && adb shell kill` fallback was not needed
(`evidence/s2-kill-method.txt`). The next tap cold-started the process through the launcher-held broadcast
`PendingIntent` (`Start proc … for broadcast {…ActionCallbackBroadcastReceiver}` 58 ms after the tap) and the callback's
`Process.getStartUptimeMillis()` was newer than the kill (S1 row T4). A tap attempted while a session is still running was
not needed to show the "only when safe to kill" caveat: the kill was issued only after the session had closed, which is
what the D1-killed procedure must do.

**Force-stop, recorded once (negative case).** `am force-stop` killed the process (`adj 250`), set the package
`stopped=true`, and `AppWidgetServiceImpl` logged `Updating package stopped masked state … isStopped true` plus
`cancelBroadcastsLocked()` for all 10 providers: both widgets became grey masks with a dot
(`evidence/s2-force-stop-widgets.png`). **First tap** on the mask: the system sent an `APPWIDGET_UPDATE` to the
**provider receiver** (`Start proc 5056 … for broadcast {…widget.VoltraWidget_PocTodoSpikeReceiver}`), then
`PACKAGE_UNSTOPPED` → `isStopped false`, both widgets re-rendered through `provideGlance` with the **old** revision
(`rev=10`), the callback did **not** run and no Activity started (launcher stayed `topResumedActivity`). So on API 35 a
tap on the mask un-stops the app and repaints without a launch, as the AOSP reading in F27 suggested; the tap itself is
lost. **Second tap**: a normal callback tap (`rev=11`, repaint in ~80 ms). Evidence: `evidence/s2-force-stop.log`,
`s2-force-stop-tap1.png`, `s2-force-stop-tap2.png`. Never use force-stop as "killed" in the demo runs.

## S3 — threads and session timing (pass)

| Where | Thread | Evidence |
|---|---|---|
| `provideGlance` (fetch + eval) | `main` | `PROVIDE_GLANCE … thread=main` |
| `Content` → `renderNode` (every JNI render) | `main` | `RENDER … thread=main` ×3 per composition |
| `Poc343PingCallback.onAction` | `DefaultDispatcher-worker-N` (Glance `goAsync` on `Dispatchers.Default`) | `CB_ENTER … thread=DefaultDispatcher-worker-1/3/5/6`; note the coroutine resumed on a different worker after `update()` |
| bundle eval from the callback (S5) | the callback's worker thread, under the same JVM lock | `EVAL ok=true ms=66 thread=DefaultDispatcher-worker-3` |

Session lifetime (`CONTENT_DISPOSED` + `WM-WorkerWrapper: Worker result SUCCESS … SessionWorker` +
`GlanceSessionManager: Closing session appWidget-3`): **45.2 s after `provideGlance`** when the only event (T2) landed
4 s into the session (two sessions: 45.25 s and 45.24 s), and **50.3 s** when an event (an Appduct props push) landed
40 s into the session, i.e. Glance keeps the session alive at least ~5 s past the last event, otherwise the 45 s
deadline counts from the first composition (F19 holds). Every composition renders **3 times** for the 3×3 placement
(`LocalSize` 255×316, 255×315, 457×200 under `SizeMode.Exact`), 6 times per `android_reload_widgets` on the 2×2 demo
widget (two passes), each render 3–12 ms warm, ~100 ms on a cold process (F7). The `DisposableEffect` used for the
dispose log enters and disposes once per size. Evidence: `evidence/s1-s2-s3-logcat.log`, `s5-invoke-emoji.log`.

## S4 — namespace import survives the release bundle (pass)

`packages/metro/src/widgetRegistry.ts` now emits `import * as WidgetModule from <entry>`, `const Widget =
WidgetModule.default` (the missing-default throw is kept) and `export function interact(payloadJSON)` that calls
`WidgetModule.onInteraction` when it is a function (`{handled:false}` otherwise); `widgetRegistry.node.test.ts` was
inverted accordingly and the `new Function` adapter test now injects `{ default }`. Metro tests: 26/26 on Node 24.
`cd example/android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` (2 min 49 s) ran
`voltraBundleWidgets` and baked `assets/voltra/voltra-widget-PocTodoSpike.bundle` (88 340 bytes, `__DEV__=false`,
vs 281 942 bytes from Metro in dev). In the baked bundle the author component is mangled (`e.default=c`, no
`function PocTodoSpike`) while both exports survive as **property names**: `e.interact=function(t){…o=f.onInteraction…}`
and `e.onInteraction=function(t){…}` (`onInteraction` ×2, `interact` ×1). The release APK was installed over the debug
build (`adb install -r`, placements kept; Glance re-rendered on `MyPackageReplacedReceiver`), the widget rendered from
the baked asset (eval 14 ms, no Metro fetch), and a tap on Invoke logged from `nativeInvoke`:
`typeof __voltraWidgets[PocTodoSpike].interact === 'function': true` with the same emoji result as in debug. Release
process is not debuggable (no `Late-enabling -Xcheck:jni`). Terser writes the emoji literal as `🍞`. Evidence:
`evidence/s4-release-bundle.txt`, `s4-voltra-widget-PocTodoSpike.release.bundle`, `s4-release-runtime.log`,
`s4-release-after-invoke.png`. Not measured in this pass: the Fast Refresh effect of the lowercase export on the host
app's dev graph (F33, plan §9 step 4).

## S5 — emoji through JNI with CheckJNI on (pass, no abort, no corruption)

Debug build, CheckJNI late-enabled (`Late-enabling -Xcheck:jni` for every debug process start). The Invoke button runs
`VoltraClientGlanceWidget.ensureBundleEvaluated` in the callback (66 ms incl. Metro fetch) and
`VoltraJSRenderer.invoke(widgetId, "interact", "{\"note\":\"🍞\",\"title\":\"Buy 🍞\"}")` through the new generic JNI
`nativeInvoke` (a copy of `nativeRender` under `g_mutex`). Observed bytes (`evidence/s5-invoke-emoji.log`):

- in: `GetStringUTFChars` delivered `f0 9f 8d 9e` ×2 — ART emits **4-byte UTF-8** for a valid surrogate pair, not the
  CESU-8 `ed a0 bc ed bd 9e` the "modified UTF-8" contract describes; `jsi::String::createFromUtf8` decoded it, JS saw
  `note.length === 2`, `codePointAt(0) === 127838`;
- out: Hermes `utf8()` produced `f0 9f 8d 9e` ×3 and `NewStringUTF` **accepted** it under CheckJNI; Kotlin received
  `{"handled":true,"result":{"echoNote":"🍞",…,"echoTitle":"Buy 🍞","back":"🍞"}}` with `codePointCount` 119 =
  UTF-16 length 122 − 3, exactly the three emoji.

Render path: props `{emojiTitle:true}` rendered a `CheckBox` titled `Buy 🍞` through `nativeRender`/`NewStringUTF`
(uiautomator shows `Buy &#127838;`, `s5-emoji-title-rendered.png`), and a tap on it reached the callback with
`checked=true` (`ToggleableStateKey`, API 35) and repainted. Same results in the release process (S4). No side issue
to file for the modified-UTF-8 risk (side issue 8 in the plan) on API 35/arm64; the risk stays theoretical for lone
surrogates and for older ART versions, which were not tested. The no-emoji variant stayed behind the `emojiTitle` prop.

## S6 — test discovery on Node 24.13 vs 22.15 (pass; the reason for the Node pin)

| Node | `pnpm --filter @use-voltra/metro test` (`node --import tsx --test`) | `pnpm --filter @use-voltra/core test` (`node --test`) |
|---|---|---|
| v24.13.0 | **tests 26**, suites 6, pass 26, fail 0 | tests 23, pass 23, fail 0 |
| v22.15.0 | **tests 0**, pass 0, fail 0, exit 0 — looks green, runs nothing (`*.node.test.ts` is not matched by Node 22's default test-file pattern) | tests 23, pass 23 (plain `.js` files are found) |

Evidence: `evidence/00-baseline-tests.txt`, `evidence/s6-node22-tests.txt`. Every later test run must assert a non-zero
count.

## Other observations worth carrying into the ADR work

- Checkbox semantics on API 35: the host flips the box on tap, Voltra delivers `ToggleableStateKey == true` to the callback
  as the absolute target, and **every later render with `checked={false}` snaps it back** — seen in the baseline, after
  the spike's own repaint and after `android_reload_widgets`. The state the render reads has to be the committed one;
  this is the `__voltraState` carrier / `useVoltraState` read path of the next phase.
- A cold tap evaluates the bundle twice today: once in the callback (if it needs `interact`) and again in `provideGlance`;
  an expired session makes a third evaluation per tap. The eval cache (plan §9 step 6) is worth keeping.
- `update()` on a live session is a ~60 ms repaint in debug; the cold path is ~1.4 s in debug (process start 0.8 s of it).
  Release numbers come from §9 step 14, not from here.
- Reinstalling the APK (`installPackageLI`) force-stops the package and Glance repaints every widget from
  `MyPackageReplacedReceiver`; placements and Glance state survive (`rev` continued at 11 → 12).
- The example app's first launch asks for the notification permission (dialog over the app); it was accepted once on the
  emulator.
- The plan's "Jest" harness is implemented as node:test (P1); unchanged by this pass, no harness exists yet.
- Plan §6 says `expo run:android --device emulator-5554`; it must be the AVD name.

## What is kept vs thrown away

Keep as candidates after the ADR (all still throwaway here): the namespace-import entry with a second export
(`interact`), the generic JNI `nativeInvoke` + `VoltraJSRenderer.invoke`, the `PocTodo*` click rule shape, the spike
scripts under `poc/343/scripts/`. Throw away: `Poc343PingCallback`, the `VoltraPoc343` logs in
`VoltraClientGlanceWidget`, `PocTodoSpike` and its app.json entry.

## Working tree

The spike changes were folded into the implementation commits on `poc/343-in-widget-state`; see `HANDOFF.md`. The
shared `.git/hooks` of the main checkout holds samples only. Unrelated side effects on the machine: Appduct 0.15.0 installed
globally under Node 24.13.0; `example/android/` and build outputs are gitignored.
