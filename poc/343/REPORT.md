# PoC #343 — in-widget state for Android Dynamic Widgets: report

Branch `poc/343-in-widget-state` (worktree `../voltra-poc-343`, cut from `main` at `d447f6d`, voltra 2.4.0). Built and verified on 2026-10-15 on the `Brownfield_457_API_35` AVD (Android 15, arm64). Everything on this branch is a proof of concept for [callstackincubator/voltra#343](https://github.com/callstackincubator/voltra/issues/343): it is never merged, names are not API, and the ADR decides what is kept. The investigation and plan behind this PoC are kept outside the repository (ask the branch author). Day-1 spike results: `FINDINGS.md`. How to reproduce: `README.md`.

Scope decided on 2026-10-15: option **C** (`useVoltraState` + `onInteraction`) is the design, option **D** (`stateKey`, no JS on the tap) is touched on the same seam, option **B** (positional `useState`) was dropped because it misattributes state on list insert and removal, option **A** (props as the only state) was not built because a props push overwrites the tap.

## 0. C vs D in short (conclusions of this run)

Both options passed the same emulator scenario on API 35: tap with the app in front, in the background and killed (D1), state kept across relaunch and reboot (D2), a props push that inserts an item at the front or the end keeps the right task ticked (D3), events reach the app in order with `handledInWidget` (D6), rapid double tap and two taps inside a delay window commit in order (K1, K3). D4 (two placements: independent per placement, shared per widget scope) was run for C only.

|                         | C: `useVoltraState` + `onInteraction`                                                                          | D: `stateKey`                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| What a tap does         | the callback evaluates the bundle in the app process and calls `onInteraction`, which returns a state patch    | the callback writes `state[stateKey] = checked`, no JS                          |
| What it can express     | any patch: a `done` map keyed by item id, derived values, several keys at once                                 | one flat key = the toggle value                                                 |
| Author code             | the hook in render plus an exported handler                                                                    | the hook in render, nothing on the tap                                          |
| Repaint, debug (median) | 109 ms warm session, 520 ms warm process, 1.5 s cold                                                           | 60 ms, 473 ms, 1.4 s                                                            |
| Repaint, release        | 83 ms warm session, 643 ms cold                                                                                | 61 ms warm session                                                              |
| Own cost                | one bundle evaluation per tap in the callback (18–46 ms release); `interact` itself under 1 ms                 | none                                                                            |
| Dev experience          | the `onInteraction` export makes the widget file a non-refresh boundary: every edit full-reloads the app (F33) | hot patch works; `stateKey` is not in the generated prop types yet (local cast) |

The latency gap is almost entirely the bundle evaluation inside the callback; on a cold tap both options pay the same process start plus Glance session start (about 410 ms from `update()` to the first render). Recommendation for the ADR: build C as the core and D as the no-JS fast path on the same state record, and add a source-hash bundle-evaluation cache as a prerequisite for C.

Not verified by this run: server-fetch precedence (D5), the K2/K4/K5 races (push during a tap, tap during a cold `provideGlance`, placement removed mid-tap), Android below API 31, state size caps, asynchronous handlers, cleanup on restore, iOS. One oddity to explain: a destructive drain of the event queue lost three events once (seq 12, 14, 16).

## 1. Summary of the run

I verified the in-widget state PoC on the Brownfield_457_API_35 AVD for both widgets: C (TodoStateWidget, `onInteraction` + `useVoltraState`) and D (TodoStateKeyWidget, `stateKey`). D1, D2, D3, D4 and D6 pass, and K1/K3 behave consistently (details below). All four test suites, typecheck and lint pass; the Robolectric suite only runs with the JDK 17 init script.

**What was built and why.** A tap on a CheckBox or Switch with an author `id` in a Dynamic Widget runs `DynamicWidgetStateActionCallback`, a Glance ActionCallback in the app process. No React Native runtime and no Activity are involved. The callback:

- reads a JSON state record persisted per placement (Glance per-appWidgetId DataStore), or per WidgetScope behind a flag;
- for C, evaluates the bundle and calls the new `interact` export, which runs `onInteraction(event, {props, state, env})` and returns `{state: patch}`;
- for D, writes `state[stateKey] = checked` with no JS;
- commits the record together with a revision bump in one Glance transaction, queues an event, and always calls `update()`.

Render receives the record as `env.__voltraState`. The generated Metro entry strips it into a module slot that `useVoltraState(key, initial)` reads. That slot is not React's dispatcher, so it also works at prerender and inside element-valued props. Props pushes never touch the record. B was dropped (positional state misattributes silently, plan §3/§2.4 and the Rescope under §4). A was not built (a push overwrites the tick, F23).

**Fast Refresh (F33), with Metro running and the app in front:**

- A control widget with only a default export got a hot patch.
- Both example widgets as written trigger a full app reload on every edit, because they also export `DEFAULT_TODO_ITEMS`.
- With that export removed temporarily, D (default only) got a hot patch, while C (default + `onInteraction`) still fully reloaded. So the lowercase `onInteraction` export alone breaks the refresh boundary. All probe edits were reverted byte-for-byte (shasum checked).
- After the emulator reboot, HMR stayed disconnected until a dev-menu Reload.
- Evidence: poc/343/evidence/t5-f33-summary.txt and t5-f33-\*.log.

**ADR list (plan §13) with this run's evidence:**

1. Build C as the core and D as the no-JS fast path on the same record.
2. Keep `onInteraction` explicit and synchronous. `interact` takes ≤1 ms; the cost is evaluating the bundle in the callback (debug 34–63 ms, release 18–46 ms).
3. Require explicit keys. D3 kept the right item ticked on front and end inserts.
4. Keep the env-key transport, but move the handler out of the widget module's exports: F33 is confirmed.
5. Placement vs scope both work (D4). Pick one per platform consciously; iOS can only do scope.
6. Use `survive` by default and give the app explicit read/reset (D3).
7. Bundle-version policy was not exercised.
8. Use absolute values with `renderedRevision` as metadata. Broadcasts are serialised by the system, so K3 never contended the mutex. Pre-31 is untested.
9. No trial render on tap; always call `update()`.
10. The eval cache is a prerequisite: C pays an eval per tap, and every new session adds about 410 ms (F21).
11. Clean up and remap the record on delete/restore. The orphan appWidget-3.preferences_pb from the removed spike placement is still on disk (F26).
12. #314 should persist first, then hand off to this seam. Delivery should be acknowledged, because the destructive drain lost events (see below).
13. Size caps (13) and §13 items 14–17 (iOS, Live Activities, preview, prerender wrapping) were not run. A top-level `useVoltraState` did prerender fine.

**What to keep vs what is throwaway.**

- Candidates to keep: `useVoltraState`/`runWithVoltraState` with their tests; the namespace import, `__voltraState` strip and `interact` export in the generated entry; `nativeInvoke`/`VoltraJSRenderer.invoke`; the commit-plus-revision transaction with `update()` in `finally`; the event `seq` semantics; the Metro and Robolectric tests.
- Throwaway: the `DynamicWidgetState*` names (Glance writes the callback class name into RemoteViews, so a shipped name is a compatibility commitment); the flags and TurboModule drain; the example TodoState\* widgets and screen; the Appduct tools; everything under poc/343.

**How to run (about ten commands).**

1. `source poc/343/env.sh`
2. `pnpm install --frozen-lockfile && pnpm exec lefthook uninstall`
3. `pnpm run build:all`
4. `emulator -avd Brownfield_457_API_35 -no-snapshot-load & adb wait-for-device`
5. `cd example && CI=1 pnpm exec expo prebuild --platform android --clean`
6. `pnpm exec expo run:android --device Brownfield_457_API_35`
7. `adb shell am start -a android.intent.action.VIEW -d voltra://android-widgets/todo-state $PKG`
8. Pin both widgets from that screen.
9. HOME, then tap a task.
10. `adb logcat -v epoch -s DynamicWidgetState VoltraClientGlanceWidget`

## 2. Demo results (plan §9 step 10–12; issue demo steps D1–D6, cases K1/K3)

- D1 foreground C: pass (tap-then-return, because the launcher and the app cannot both be in front: the app was resumed until ~4 s before the tap). t1 ticked, 1 callback / 1 commit, rev 1. Evidence: poc/343/evidence/t5-d1-C-fg.png, t5-d1-C-fg-return-app.png, t5-d1-C-logcat.log, t5-d1-C-steps.txt; recording poc/343/media/t5-d1-C.mp4
- D1 foreground D: pass (same procedure). 1 callback / 1 commit, rev 1. Evidence: t5-d1-D-fg.png, t5-d1-D-logcat.log; recording media/t5-d1-D.mp4
- D1 background C: pass. t2 ticked, 1/1, repaint at +143 ms (live session). Evidence: t5-d1-C-bg.png
- D1 background D: pass. t2 ticked, 1/1, repaint at +67 ms. Evidence: t5-d1-D-bg.png
- D1 killed C: pass. HOME, session ended, am kill, pidof empty, then tap. Start proc for ActionCallbackBroadcastReceiver +48 ms, callback +958 ms, repaint rev 3 at +1645 ms, 1/1. Evidence: t5-d1-C-killed.png, t5-d1-C-steps.txt
- D1 killed D: pass. Callback +919 ms, repaint +1556 ms, 1/1. Evidence: t5-d1-D-killed.png
- D2 kill + relaunch C and D: pass. The DataStore kept all ticks (rev 3); android_reload_widgets re-rendered with stateRevision=3. Evidence: t5-d2-steps.txt, t5-d2-relaunch-C.png, t5-d2-relaunch-D.png, t5-d2-relaunch-reload-renders.log
- D2 reboot C and D: pass. The boot-time update rendered stateRevision=3 with every row ticked. Debug caveat: adb reverse must be set again after boot. Evidence: t5-d2-reboot-C.png, t5-d2-reboot-D.png, t5-d2-reboot-logcat.log
- D3 C: pass. With t1 ticked, a front push [t4,t1,t2,t3] kept 'Buy 🍞' (t1, now row 2) ticked; an end push kept row 1 (t1) ticked; the record was unchanged. With precedence=resetOnPush, a front push cleared the record ({} rev 26→27) and all rows rendered unticked. Evidence: t5-d3-\*-C.png, t5-d3-steps.txt, t5-d3-logcat.log
- D3 D: pass, same outcome (rev 25 unchanged; resetOnPush 25→26). Evidence: t5-d3-\*-D.png
- D4 C scope=placement: pass (independent). Second placement awid 7: a tick in awid 4 left awid 7 at {}. Evidence: t5-d4-placement-placement1.png, t5-d4-placement-placement2.png, t5-d4-steps.txt, t5-d4-list-widgets.json
- D4 C scope=widgetScope: pass (shared). After a reset, a tick in awid 4 showed in both; both read {done:{t1:true}} rev 3. Evidence: t5-d4-widgetScope-placement1.png, t5-d4-widgetScope-placement2.png
- D4 D: not run (C only, as planned)
- D6 C: pass. Three taps, each with the process killed first: queue seq 17,18,19 in order, handledInWidget=true, stateChange {key:'done', from, to} correct (t1→true, t2→false, t3→false). Evidence: t5-d6-C-queue.xml (raw via run-as), t5-d6-C-screen-events.txt/.png (drained on the screen), t5-d6-C-logcat.log
- D6 D: pass for seq 8,9,10 (in order, handledInWidget=true, drained on the screen; evidence t5-d6-D-screen-events.png, t5-d6-cold-logcat.log). A second series (seq 12,14,16; t5-d6-cold2-logcat.log) was appended but found already drained, by an unknown consumer, on the cold relaunch (t5-d6-drain-empty-after-cold-relaunch.json): an open issue
- K1 C: 2 callbacks / 2 commits, rev 29,30, absolute values true then false. Final t1:false matches the launcher; tap 2 had renderedRevision 28 (stale) and was applied. Evidence: t5-k-K1-C.png, t5-k-logcat.log, t5-k-steps.txt
- K1 D: same, rev 28,29, final done.t1:false. Evidence: t5-k-K1-D.png
- K3 C (interactDelayMs=1500, t2 then t3 0.3 s apart): both committed in tap order (rev 31 then 32; t3 renderedRevision 30 = stale by one). The second callback entered only after the first returned (+1.3 s): the system serialises broadcasts under goAsync. Evidence: t5-k-K3-C.png, t5-k-logcat.log
- K3 D: same, rev 30 then 31. Evidence: t5-k-K3-D.png
- F33 Fast Refresh: recorded. The onInteraction export alone causes a full reload; an exported non-component constant does too; a default-only widget gets a hot patch. Evidence: t5-f33-summary.txt, t5-f33-\*.log, t5-f33-dev-menu.png
- D5 (server fetch precedence), K2, K4, K5, pre-31 (API 30) and iOS: not run

## 3. Latency (plan §9 step 14)

- Format: median / max in ms, from the tap marker (device clock) to callback entered → commit → update() returned → first render with the committed stateRevision. Computed with poc/343/scripts/t5-latency.py
- DEBUG C warm-session n=5: callback 20/27, commit 95/98, update 99/102, repaint 109/112 (t5-lat-warmsession-C-logcat.log, tap 1 excluded)
- DEBUG D warm-session n=5: callback 17/58, commit 53/64, update 56/68, repaint 60/72 (t5-lat-warmsession-D-logcat.log)
- DEBUG C warm-process (65 s idle, same pid) n=6: callback 24/30, commit 100/106, update 116/118, repaint 520/528 (t5-lat-warmprocess-logcat.log)
- DEBUG D warm-process n=6: callback 15/30, commit 49/66, update 61/77, repaint 473/486 (same file)
- DEBUG C cold (am kill, empty pidof) n=8: callback 814/958, commit 1028/1143, update 1074/1189, repaint 1538/1645 (t5-d1-C, t5-d6-cold, t5-d6-cold2, t5-d6-C logcat files)
- DEBUG D cold n=7: callback 803/919, commit 857/987, update 904/1077, repaint 1372/1556
- RELEASE (assembleRelease arm64-v8a, 1m22s build, installed over debug; debug reinstalled afterwards) C warm-session n=5: callback 20/27, commit 70/81, update 73/84, repaint 83/91 (t5-lat-release-warmsession-C-logcat.log)
- RELEASE D warm-session n=5: callback 22/47, commit 55/57, update 58/63, repaint 61/64 (t5-lat-release-warmsession-D-logcat.log)
- RELEASE C cold n=5: callback 183/189, commit 220/221, update 231/237, repaint 643/653 (t5-lat-release-cold-C-logcat.log). Release warm-process: not measured
- Breakdown: C pays a full bundle evaluation in the callback on every tap (debug 34–63 ms including a ~12 ms Metro fetch, release 18–46 ms); interact itself takes 0–1 ms. Every repaint that is not a live session spends ~410 ms from update() to the first render (SessionWorker start plus a second bundle evaluation in provideGlance). Debug cold spends ~0.8 s on process start before the callback

## 4. Tests

- pnpm --filter @use-voltra/core test (Node 24.13.0): tests 32, pass 32, fail 0
- pnpm --filter @use-voltra/metro test: tests 33, suites 7, pass 33, fail 0
- pnpm --filter @use-voltra/android-client test: Jest dynamic-widget config 8 suites / 34 tests passed; expo-plugin config 11 suites / 57 tests passed
- cd example/android && ./gradlew :use-voltra_android-client:testDebugUnitTest --tests "voltra.dynamicwidget.state.\*": FAILED at configuration, verbatim: 'Cannot find a Java installation on your machine (Mac OS X 26.6.2 aarch64) matching: {languageVersion=21, vendor=any vendor, implementation=vendor-specific, nativeImageCapable=false}. Toolchain download repositories have not been configured.' (JDK 21 toolchain unavailable)
- Same with --init-script poc/343/scripts/jdk17-unit-tests.init.gradle (copied into the repo from the scratchpad): BUILD SUCCESSFUL, 23 tests, 0 failures (EventQueue 4, PushStateReset 2, StateFlags 3, StateInteraction 7, StateStore 7)
- pnpm run typecheck: 12/12 tasks successful
- pnpm run lint: 12/12 tasks successful, 0 warnings / 0 errors in every package; nothing to fix
- example tsc --noEmit (not in the root typecheck): 50 errors, all in files the PoC does not touch; 0 in PoC files
- All results recorded in poc/343/evidence/t5-tests.txt

Robolectric note: the repository's unit tests declare a JDK 21 toolchain (`packages/android-client/android/build.gradle:62-76`), which Gradle could not auto-provision on this machine. The suite was run with `poc/343/scripts/jdk17-unit-tests.init.gradle` (test JVM = local JDK 17, Robolectric `sdk=35`): 23 new tests and the surrounding `voltra.dynamicwidget.*`/`voltra.glance.*` suites (223 tests) pass. With a JDK 21 installed the plain command works.

## 5. Open issues found while verifying

- Lost events: seq 12,14,16 (TodoStateKeyWidget, second cold series) were appended, but the queue was already empty on the cold relaunch and no screen showed them. Likely TodoStateScreen mounted briefly and drained into component state that was then dropped. Not root-caused. The drain is destructive (ADR item 12: acknowledged delivery)
- A cold start with the deep link voltra://android-widgets/todo-state landed on the 'Per-instance server fetches' screen instead (t5-d2-relaunch-app.png); a warm start routes correctly
- The example widgets exported DEFAULT_TODO_ITEMS, which alone forced a full app reload on every widget edit (F33 probe); the export was removed after verification (no importers), so TodoStateKeyWidget now gets a hot patch and TodoStateWidget still full-reloads because of its onInteraction export
- stateKey is not in the Android CheckBox/Switch JSX prop types; TodoStateKeyWidget uses a local cast
- No bundle-eval cache: C evaluates the whole bundle in the callback on every tap, and every new Glance session evaluates it again (+~410 ms to repaint)
- Debug only: adb reverse tcp:8081 is lost on emulator reboot (a boot-time render before it is restored would fall back to the stateless placeholder), and the app's HMR socket stays down after a reboot until a dev-menu Reload
- Appduct sessions disappeared after ~15 min with the app in the background; android_request_pin_widget requires the app in the foreground
- Leftovers from earlier runs: orphan Glance file appWidget-3.preferences_pb from the removed PocTodoSpike placement (F26), and a second TodoStateWidget placement (appWidgetId 7) is still pinned on launcher page 4
- poc/343/evidence is 40 MB (mostly PNG screenshots); consider trimming before the human commits
- Not run: D5 server-fetch precedence, K2/K4/K5, pre-31 (API 30, deferred P6), iOS (P7), size caps, async-handler spike, cleanup/restore, release warm-process, Pixel_9a smoke test
- Foreground D1 is tap-then-return (procState 15 at the tap): on a phone the launcher and the app cannot both be in front

## 6. Implementation notes per area

### metro

- The spike widget example/widgets/android/poc343/PocTodoSpike.tsx still exports the old `onInteraction(payload: {note,title})`. With the new contract it receives (event, {props,state,env}). A spike payload without `event` now gets event={} and returns {handled:true,state:null}, so the spike's echo result no longer reaches native. That widget and the Kotlin caller of `interact` must move to the new payload `{event, props, state, env}` in a later task.
- example/.voltra/metro/widgets/\*.js and the render shims in example/.voltra/metro still hold the old spike output. They regenerate only when Metro starts (withVoltra) or bundleWidgets runs. Expo prebuild does not regenerate them, so it was not run.

### android

- `stateKey` reaches native unchanged at runtime: it is not in the short-name table, and ShortNames.expand passes unknown keys through. But AndroidCheckBoxProps and AndroidSwitchProps in packages/android do not declare it, so authors writing `stateKey` get a TypeScript error until the JSX prop types gain it.
- Every Dynamic Widget CheckBox, Switch or FilledButton that has an author `id` and no `deepLinkUrl` now runs the state callback instead of opening the app. That includes the leftover example/widgets/android/poc343/PocTodoSpike.tsx. No other example Dynamic Widget uses these controls today. A tap on a widget without onInteraction and without stateKey now does nothing visible: no write, a repaint, an event with handledInWidget=false. Before, it opened the app. This is an ADR or behaviour-change point.
- `interact` runs while the per-placement Mutex and the process-wide JS lock are held, so a slow onInteraction blocks Main-thread Glance compositions of every Dynamic Widget for that time (F19). renderedRevision is only recorded; there is no stale-tap rejection policy.
- In widgetScope mode a tap updates the tapped placement twice: once from the scope store's afterWrite (every placement) and once from the callback's finally.
- A JS throw inside interact, including the 'onInteraction must be synchronous' error, comes back from nativeInvoke as null. Native therefore cannot tell a missing export from a throw; both log and write nothing. The C++ side logs the JSError text under the VoltraJSRenderer tag.
- Below API 31 the toggle value Glance delivers is baked at render time (!rendered), so a stateKey tap writes that value as absolute. Untested: there is no pre-31 image.

### example

- After the app was brought back to the foreground at 16:31:25, the RN dev overlay showed 6 errors like 'Uncaught (in promise): Call to function ExpoAsset.downloadAsync has been rejected… Unable to download asset from url: http://10.0.2.2:8081/assets/?unstable_path=…@expo/vector-icons…'. These are @expo/vector-icons font downloads from the dev client's 10.0.2.2 host URL, not from this task's code. Not chased. The screens render, and a curl of the same asset URL on the host returned 200.
- The flags section in TodoStateScreen cannot read the current flags back: the PoC has no getter. It shows what the screen last saved, starting from the defaults (placement / survive / 0).
- CheckBox and Switch text colour cannot be set: `style.color` is not in the generated toggle prop types. Glance's default theme colours are used, which are fine on the light card; dark mode was not checked.
- The TodoStateWidget onInteraction ctx.state is typed Partial<TodoState>, not TodoState, because the first tap sees {}.
- Nothing verifies yet that `stateKey` reaches native element.p. core's shorten() passes unknown prop names through unchanged, so it should arrive as 'stateKey'; Task 5 should confirm this in the DynamicWidgetState logcat (via=stateKey).

## 7. Evidence index (`poc/343/evidence/`)

- 00-android_list_widgets.json
- 00-app-first-launch.png
- 00-app-home.png
- 00-baseline-after-reload.png
- 00-baseline-after-tap-home.png
- 00-baseline-d1-before.txt
- 00-baseline-tap-immediate.png
- 00-baseline-tap-opens-app.png
- 00-baseline-tests.txt
- 00-baseline-usestate-before-tap.png
- 00-demo-widget-pinned.png
- 00-gradle-resolution.txt
- s1-after-cold-tap.png
- s1-android_list_widgets.json
- s1-s2-s3-logcat.log
- s1-spike-pinned.png
- s2-after-cold-tap.png
- s2-force-stop-tap1.png
- s2-force-stop-tap2.png
- s2-force-stop-widgets.png
- s2-force-stop.log
- s2-kill-method.txt
- s4-release-after-invoke.png
- s4-release-bundle.txt
- s4-release-runtime.log
- s4-voltra-widget-PocTodoSpike.release.bundle
- s5-after-emoji-checkbox-tap.png
- s5-after-invoke-and-checkbox.png
- s5-emoji-title-rendered.png
- s5-invoke-emoji.log
- s6-node22-tests.txt
- t4-android-widgets-tab-section.png
- t4-todo-state-screen-placements.png
- t4-todo-state-screen.png
- t4-todo-state-widget-initial.png
- t4-todo-statekey-widget-initial.png
- t5-d1-C-bg.png
- t5-d1-C-fg-return-app.png
- t5-d1-C-fg.png
- t5-d1-C-killed.png
- t5-d1-C-logcat.log
- t5-d1-C-steps.txt
- t5-d1-D-bg.png
- t5-d1-D-fg-return-app.png
- t5-d1-D-fg.png
- t5-d1-D-killed.png
- t5-d1-D-logcat.log
- t5-d1-D-steps.txt
- t5-d2-reboot-C.png
- t5-d2-reboot-D.png
- t5-d2-reboot-logcat.log
- t5-d2-relaunch-C.png
- t5-d2-relaunch-D.png
- t5-d2-relaunch-app.png
- t5-d2-relaunch-reload-renders.log
- t5-d2-steps.txt
- t5-d3-1-t1-ticked-C.png
- t5-d3-1-t1-ticked-D.png
- t5-d3-2-front-survive-C.png
- t5-d3-2-front-survive-D.png
- t5-d3-3-end-survive-C.png
- t5-d3-3-end-survive-D.png
- t5-d3-4-front-resetOnPush-C.png
- t5-d3-4-front-resetOnPush-D.png
- t5-d3-logcat.log
- t5-d3-steps.txt
- t5-d4-list-widgets.json
- t5-d4-logcat.log
- t5-d4-placement-placement1.png
- t5-d4-placement-placement2.png
- t5-d4-steps.txt
- t5-d4-widgetScope-placement1.png
- t5-d4-widgetScope-placement2.png
- t5-d6-C-logcat.log
- t5-d6-C-queue.xml
- t5-d6-C-screen-events.png
- t5-d6-C-screen-events.txt
- t5-d6-C-steps.txt
- t5-d6-D-screen-events.png
- t5-d6-cold-logcat.log
- t5-d6-cold-steps.txt
- t5-d6-cold2-logcat.log
- t5-d6-cold2-steps.txt
- t5-d6-drain-empty-after-cold-relaunch.json
- t5-d6-queue-before.xml
- t5-d6-state-before-drain.txt
- t5-f33-0-before-js-reload-no-hmr.log
- t5-f33-C-default-plus-onInteraction-comment-edit.log
- t5-f33-D-default-only-comment-edit.log
- t5-f33-TodoStateKeyWidget-no-lowercase-export.log
- t5-f33-TodoStateWidget.log
- t5-f33-control-AndroidClientDemoWidget.log
- t5-f33-dev-menu.png
- t5-f33-setupC-unexport.log
- t5-f33-setupD-unexport.log
- t5-f33-summary.txt
- t5-k-K1-C.png
- t5-k-K1-D.png
- t5-k-K3-C.png
- t5-k-K3-D.png
- t5-k-logcat.log
- t5-k-steps.txt
- t5-lat-release-cold-C-logcat.log
- t5-lat-release-cold-C-steps.txt
- t5-lat-release-warmsession-C-logcat.log
- t5-lat-release-warmsession-C-steps.txt
- t5-lat-release-warmsession-D-logcat.log
- t5-lat-release-warmsession-D-steps.txt
- t5-lat-warmprocess-logcat.log
- t5-lat-warmprocess-steps.txt
- t5-lat-warmsession-C-logcat.log
- t5-lat-warmsession-C-steps.txt
- t5-lat-warmsession-D-logcat.log
- t5-lat-warmsession-D-steps.txt
- t5-release-bundles.txt
- t5-tests.txt
- t5-todo-state-screen-after-reset.png

Recordings (`poc/343/media/`, gitignored): metro-task4.log, t5-d1-C.mp4, t5-d1-D.mp4
