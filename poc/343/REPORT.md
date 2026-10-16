# PoC #343 — in-widget state for Android Dynamic Widgets: report

Branch `poc/343-in-widget-state` (worktree `../voltra-poc-343`, cut from `main` at `d447f6d`, voltra 2.4.0). Built and verified on 2026-10-15 on the `Brownfield_457_API_35` AVD (Android 15, arm64). Everything on this branch is a proof of concept for [callstackincubator/voltra#343](https://github.com/callstackincubator/voltra/issues/343): it is never merged, names are not API, and the ADR decides what is kept. The investigation and plan behind this PoC are kept outside the repository (ask the branch author). Day-1 spike results: `FINDINGS.md`. How to reproduce: `README.md`.

Scope decided on 2026-10-15: option **C** (`useVoltraState` + `onInteraction`) is the design, option **D** (`stateKey`, no JS on the tap) is touched on the same seam, option **B** (positional `useState`) was dropped because it misattributes state on list insert and removal, option **A** (props as the only state) was not built because a props push overwrites the tap.

## 0. C vs D in short (conclusions of this run)

Both options passed the same emulator scenario on API 35: tap with the app in front, in the background and killed (D1), state kept across relaunch and reboot (D2), a props push that inserts an item at the front or the end keeps the right task ticked (D3), events reach the app in order with `handledInWidget` (D6), rapid double tap and two taps inside a delay window commit in order (K1, K3). D4 (two placements: independent per placement, shared per widget scope) was run for C only.

|                                                     | C: `useVoltraState` + `onInteraction`                                                                                                                                                                                           | D: `stateKey`                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| What a tap does                                     | the callback evaluates the bundle in the app process and calls `onInteraction`, which returns a state patch                                                                                                                     | the callback writes `state[stateKey] = checked`, no JS                                                      |
| What it can express                                 | any patch: a `done` map keyed by item id, derived values, several keys at once                                                                                                                                                  | one flat key = the toggle value                                                                             |
| Author code                                         | the hook in render plus an exported handler                                                                                                                                                                                     | the hook in render, nothing on the tap                                                                      |
| Repaint, debug (median)                             | 109 ms warm session, 520 ms warm process, 1.5 s cold                                                                                                                                                                            | 60 ms, 473 ms, 1.4 s                                                                                        |
| Repaint, release                                    | 83 ms warm session, 643 ms cold                                                                                                                                                                                                 | 61 ms warm session                                                                                          |
| Own cost                                            | one bundle evaluation per tap in the callback (18–46 ms release); `interact` itself under 1 ms                                                                                                                                  | none                                                                                                        |
| Dev experience                                      | the `onInteraction` export makes the widget file a non-refresh boundary: every edit full-reloads the app (F33)                                                                                                                  | hot patch works; `stateKey` is not in the generated prop types yet (local cast)                             |
| H: inline setters + tap replay (§9), vs this option | H runs on the same seam at the same cost (+4–10 ms replay render). There is no exported handler, so the file hot-patches. Measured the same session: H 132 ms warm session, 584 ms warm process, 1.5 s cold (C 132, 577, 1.5 s) | D stays ahead without JS (77 ms warm session); H also writes maps keyed by id, several keys and button taps |

The latency gap is almost entirely the bundle evaluation inside the callback; on a cold tap both options pay the same process start plus Glance session start (about 410 ms from `update()` to the first render). Recommendation for the ADR: build C as the core and D as the no-JS fast path on the same state record, and add a source-hash bundle-evaluation cache as a prerequisite for C. §9 (2026-10-16) adds variant H: inline setters replayed on the C seam, proposed as the default authoring model.

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

## 8. Positional useState identity (design note) validated in the harness

Run on 2026-10-16, in node only (no device). The question: does the "Voltra useState Identity" design note (positional `useState` keyed by tree path, mark & sweep in native storage) give option B a sound footing, compared with option C?

**What the note proposes.**

1. Each `useState` key is the tree path plus the hook index: `root/Type@slot | Type:key/…#hookIndex`. The path is built in `renderNode` (push a segment on enter, pop it on exit), and the hook counter resets to 0 per component.
2. Holes (`null`/`false`) count as slots. Host primitives are segments. A nested array is a new level `[]@slot`. Keys are scoped per level, and a duplicate key warns and falls back to the slot.
3. The store is the previous tree flattened to keys. Every `useState` marks its key as seen, and a successful commit writes the updates and deletes `store − seen`. A render that throws does not sweep.
4. Variant prefix: optional. When it is on, only the variants rendered in the pass are swept.
5. Function names do not survive minification, so the note proposes a build-time id (module + export). Its alternative GC is `lastSeen = evalId` per key.

**How it was built in the harness (throwaway; JSDoc "PoC for issue #343; not API").**

- `packages/core/src/renderer/voltra-state-positional.ts`: the path cursor helpers, the per-component frames with the hook counter (frozen once the body returns, so `Context.Consumer` render props cannot advance it), the positional `useState` (reads `store[key]`, marks it seen; its setter writes `pending` only in a tap replay, otherwise it is a no-op with a warning), the control map (`id` → nearest stateful component → its first hook key), name modes (`dev` = `displayName || name`, `release` = every function component is `t`, `__pocId` wins when present), and `createPositionalStore` with `render(variant)`, `tap(id, value)` and `commit()` (mark & sweep, optional variant prefix, aborted after a throw). Exported from `renderer/index.ts` only as `__poc343Positional`.
- `packages/core/src/renderer/renderer.ts`: an optional `poc343` cursor on `VoltraRenderingContext`, used only while a positional slot is installed. The walker threads it through the children map (index per child, holes included), through `renderFunctionalComponent` (which pushes the component segment and installs the positional `useState` into the dispatcher object returned by `getHooksDispatcher`), through the host branch (host segment and control recording), and through `transformProps` (an element-valued prop becomes the level `<host>/$<prop>`). With no slot installed, the output does not change: `renderer.test.js` and `voltra-state.test.js` pass unchanged.
- Root segment: every case except N12 runs without the variant prefix, so its keys start with `root/` rather than the variant root the note uses (`systemMedium/…`). That changes the outcome of no single-variant case. With the prefix on, the walker reproduces the note's own example keys exactly (probe on the built package: `systemMedium/Widget@0#0`, `systemMedium/Widget@0/Column@0/Header@0#0`, `systemMedium/Widget@0/Column@0/[]@2/RowC:a#0`).
- Deviations from the note (none changes a matrix row): (a) `Fragment`, `Provider` and `Consumer` are transparent, so a keyed `Fragment` loses its key (probe: `items.map(i => <Fragment key={i}><RowC/></Fragment>)` gives `RowC@0#0` and `RowC@1#0`), which is harsher than the note or React for that pattern; (b) only `useState` advances the hook index (probe: `useReducer` and `useMemo` before `useState` still give `#0`), while React and the note count every hook; (c) a tap goes to the first hook of the nearest **stateful** component, not the nearest function component, which N18 needs; (d) the replay setter path (`render(..., { replay: true })`) is never exercised, since every case writes through `tap`.
- `packages/core/test/voltra-state-positional-identity.test.js`: the fixtures (`TodoRow`, `TodoList`, `Summary`, `Banner`, `Counter`, `A`/`B`, `TodoListMap`). Every case runs both strategies, P (the note) and C (`useVoltraState` with explicit keys, written by an `onInteraction` stand-in). The predictions are pre-registered, and each case asserts observed === predicted. The matrix is printed with `t.diagnostic` and written to `poc/343/evidence/t7-positional-identity.md` on every test run, formatted with the repo's prettier config so the file passes `prettier --check .`; the output is deterministic (same bytes across runs).

**Matrix (as printed by the harness; P = note scheme in dev-name mode unless the row says otherwise).** All 23 rows match their predictions. In every row where P loses or misattributes state, the last column gives the slot keys before → after. Keys start with `root/` except in N12 (see above). In N16 and N16b, C's `keys=1` holds by construction (one explicit key); only `values=[...]` is measured.

| Case | Scenario                                                                                       | P predicted                                                                       | P observed                                                                        | C predicted                                             | C observed                                              | Match | P slot keys before → after                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1   | conditional sibling hidden (Banner before Counter, show=false)                                 | kept                                                                              | kept                                                                              | kept                                                    | kept                                                    | yes   | root/BannerScreen@0/Column@0/Counter@1#0 → root/BannerScreen@0/Column@0/Counter@1#0                                                                                                                  |
| N2   | keyed list reorder (reverse)                                                                   | kept                                                                              | kept                                                                              | kept                                                    | kept                                                    | yes   | root/TodoList@0/Column@0/TodoRow:a#0 → root/TodoList@0/Column@0/TodoRow:a#0                                                                                                                          |
| N3   | unkeyed list reorder (reverse)                                                                 | moved task:a->task:c                                                              | moved task:a->task:c                                                              | kept                                                    | kept                                                    | yes   | root/TodoList@0/Column@0/TodoRow@0#0 → root/TodoList@0/Column@0/TodoRow@2#0; ticked: task:c=root/TodoList@0/Column@0/TodoRow@0#0                                                                     |
| N4   | unkeyed insert at front                                                                        | moved task:a->task:z                                                              | moved task:a->task:z                                                              | kept                                                    | kept                                                    | yes   | root/TodoList@0/Column@0/TodoRow@0#0 → root/TodoList@0/Column@0/TodoRow@1#0; ticked: task:z=root/TodoList@0/Column@0/TodoRow@0#0                                                                     |
| N5   | keyed insert at front                                                                          | kept                                                                              | kept                                                                              | kept                                                    | kept                                                    | yes   | root/TodoList@0/Column@0/TodoRow:a#0 → root/TodoList@0/Column@0/TodoRow:a#0                                                                                                                          |
| N6   | type swap <A/> -> <B/> in the same slot (dev names)                                            | gone                                                                              | gone                                                                              | kept                                                    | kept                                                    | yes   | root/SwapScreen@0/Column@0/A@0#0 → root/SwapScreen@0/Column@0/B@0#0                                                                                                                                  |
| N7   | wrapper Column -> Row between versions (keyed rows)                                            | gone                                                                              | gone                                                                              | kept                                                    | kept                                                    | yes   | root/TodoList@0/Column@0/TodoRow:a#0 → root/TodoList@0/Row@0/TodoRow:a#0                                                                                                                             |
| N8   | v2 adds hooked <Summary/> above the list (keyed rows)                                          | gone                                                                              | gone                                                                              | kept                                                    | kept                                                    | yes   | root/TodoList@0/Column@0/TodoRow:a#0 → root/TodoList@0/Column@0/[]@1/TodoRow:a#0                                                                                                                     |
| N8b  | v2 adds a featured (unkeyed) <TodoRow/> above the unkeyed list                                 | moved task:a->featured:c                                                          | moved task:a->featured:c                                                          | kept                                                    | kept                                                    | yes   | root/TodoList@0/Column@0/TodoRow@0#0 → root/TodoList@0/Column@0/[]@1/TodoRow@0#0; ticked: featured:c=root/TodoList@0/Column@0/TodoRow@0#0                                                            |
| N9   | key={day} changes on Counter (mon -> tue)                                                      | gone                                                                              | gone                                                                              | kept                                                    | kept                                                    | yes   | root/DayScreen@0/Column@0/Counter:mon#0 → root/DayScreen@0/Column@0/Counter:tue#0                                                                                                                    |
| N10  | mark & sweep with hidden rows (showCompleted=false, commit, show again)                        | gone                                                                              | gone                                                                              | kept                                                    | kept                                                    | yes   | root/TodoList@0/Column@0/TodoRow:a#0 → root/TodoList@0/Column@0/TodoRow:a#0 (swept by the hidden-row commit: root/TodoList@0/Column@0/TodoRow:a#0)                                                   |
| N11a | sizes without prefix, separate shapes (small: no Summary; large: Summary), sweep on            | large:gone small-after:gone                                                       | large:gone small-after:gone                                                       | large:kept small-after:kept                             | large:kept small-after:kept                             | yes   | root/TodoList@0/Column@0/TodoRow:a#0 → large reads root/TodoList@0/Column@0/[]@1/TodoRow:a#0; large commit deleted [root/TodoList@0/Column@0/TodoRow:a#0]; small commit deleted []                   |
| N11b | sizes without prefix, one component with a Summary hole, sweep on; tick a in small, c in large | large:kept small-after:kept large-again=[task:a] swept-by-small=[TodoRow:c#0]     | large:kept small-after:kept large-again=[task:a] swept-by-small=[TodoRow:c#0]     | large:kept small-after:kept large-again=[task:a,task:c] | large:kept small-after:kept large-again=[task:a,task:c] | yes   | a root/TodoList@0/Column@0/[]@1/TodoRow:a#0 (same path in both sizes); c root/TodoList@0/Column@0/[]@1/TodoRow:c#0 → swept by the small commit [root/TodoList@0/Column@0/[]@1/TodoRow:c#0]           |
| N11c | sizes without prefix, separate shapes, sweep off                                               | large:gone small-after:kept                                                       | large:gone small-after:kept                                                       | large:kept small-after:kept                             | large:kept small-after:kept                             | yes   | root/TodoList@0/Column@0/TodoRow:a#0 → large reads root/TodoList@0/Column@0/[]@1/TodoRow:a#0; large commit deleted []; small commit deleted []                                                       |
| N12  | sizes with variant prefix (hole form), sweep scoped to rendered variant                        | large:gone small-after:kept                                                       | large:gone small-after:kept                                                       | large:kept small-after:kept                             | large:kept small-after:kept                             | yes   | systemSmall/TodoList@0/Column@0/[]@1/TodoRow:a#0 → large reads systemLarge/TodoList@0/Column@0/[]@1/TodoRow:a#0; large commit deleted []; small commit deleted []                                    |
| N13  | server-fetch trial render with 4 other items, committed                                        | gone written=0 deleted=1                                                          | gone written=0 deleted=1                                                          | kept                                                    | kept                                                    | yes   | root/TodoList@0/Column@0/TodoRow:a#0 → root/TodoList@0/Column@0/TodoRow:a#0; trial commit deleted [root/TodoList@0/Column@0/TodoRow:a#0]                                                             |
| N14  | conditional useState in TodoList before its own state (flag false -> true)                     | rows:kept own:collapsed=false extra=true                                          | rows:kept own:collapsed=false extra=true                                          | rows:kept own:collapsed=true extra=x                    | rows:kept own:collapsed=true extra=x                    | yes   | row root/TodoList@0/Column@0/[]@0/TodoRow:a#0 → root/TodoList@0/Column@0/[]@0/TodoRow:a#0; collapsed root/TodoList@0#0 → TodoList hooks now [root/TodoList@0#0 + root/TodoList@0#1] (extra reads #0) |
| N15a | type swap <A/> -> <B/>, release names (all `t`)                                                | kept                                                                              | kept                                                                              | kept                                                    | kept                                                    | yes   | root/t@0/Column@0/t@0#0 → root/t@0/Column@0/t@0#0                                                                                                                                                    |
| N15b | type swap <A/> -> <B/>, build-time ids (\_\_pocId)                                             | gone                                                                              | gone                                                                              | kept                                                    | kept                                                    | yes   | root/t@0/Column@0/widgets/AB.tsx#A@0#0 → root/t@0/Column@0/widgets/AB.tsx#B@0#0                                                                                                                      |
| N16  | same element object twice under createVoltraRenderer (dedup)                                   | keys=1 values=[5,5]                                                               | keys=1 values=[5,5]                                                               | keys=1 values=[5,5]                                     | keys=1 values=[5,5]                                     | yes   | marked [root/Column@0/Counter@0#0]; tap wrote root/Column@0/Counter@0#0                                                                                                                              |
| N16b | same element object twice under renderVariantToJson (no dedup)                                 | keys=2 values=[0,5]                                                               | keys=2 values=[0,5]                                                               | keys=1 values=[5,5]                                     | keys=1 values=[5,5]                                     | yes   | marked [root/Column@0/Counter@0#0, root/Column@0/Counter@1#0]; tap wrote root/Column@0/Counter@1#0                                                                                                   |
| N17  | purity and sweep idempotence; render that throws                                               | json=same seen=same throw=aborted,store-unchanged setter-in-render=ignored+warned | json=same seen=same throw=aborted,store-unchanged setter-in-render=ignored+warned | json=same throw=state-unchanged                         | json=same throw=state-unchanged                         | yes   | seen per render: 3 keys; warnings: setState outside a tap replay ignored for root/Column@0/Naughty@0#0                                                                                               |
| N18  | parent map: one useState({}) in the list, hookless rows (N3, N4, N8, N10)                      | N3:kept N4:kept N8:kept N10:kept                                                  | N3:kept N4:kept N8:kept N10:kept                                                  | N3:kept N4:kept N8:kept N10:kept                        | N3:kept N4:kept N8:kept N10:kept                        | yes   | map key root/TodoListMap@0#0 (one key for the whole list)                                                                                                                                            |

Sub-cases added to the task list: N8b, N11b, N11c, N16b, and one structural check (duplicate key, render prop). Two predictions were corrected **before the first run**, because writing out the expected key sets showed the first draft was wrong: N13 went from `deleted=3` to `deleted=1` (only keys that hold a value can be deleted, and only row a had been ticked), and N11b was redesigned to tick a large-only row (with only a small tick, nothing large-only would be stored for the small commit to sweep). No assertion was changed after a run. This is self-attested: the test file is untracked and no prediction was committed before the first run, so the pre-registration cannot be checked from the tree. Validation: `pnpm --filter @use-voltra/core build`, then `pnpm --filter @use-voltra/core test` (tests 57 = 32 previous + 25 new, fail 0); `lint` and `typecheck` passed.

**Three structural problems.** Problems 1 and 2 are React's own identity rules (N3, N4, N6, N7, N8 and N8b are what React does within a session; at runtime the walker cannot tell `<Column>{rows}</Column>` apart from a list of several children, and React also remounts keyed rows when a sibling is added next to a lone array). They are a problem here only because widget state persists across code versions and evaluations.

1. **Unkeyed lists misattribute silently.** In N3 (reverse) and N4 (insert at front), the tick stays at slot 0 and appears on another task (`TodoRow@0#0` is read by c, then by z). Nothing warns: in React this is the documented consequence of index keys, but here the state is persisted, so the wrong tick outlives the render. N8b shows the same thing without any list change: v2 puts a featured row at the old slot, and it inherits a's tick.
2. **A code change between versions resets or misattributes persisted state.** Wrapping in `Row` instead of `Column` (N7) or adding a sibling above the list (N8) moves the key, and the user's ticks are lost. N6 (`<A/>` → `<B/>` in one slot) is a runtime swap whose reset the note specifies, the same kind of case as N9; it only becomes a loss when the swap ships as a code change. C keeps N6 only because the fixture gives A and B the same explicit key. N8 loses even **keyed** rows, because adding a sibling next to a lone `{rows}` array turns it into the level `[]@1`. Explicit React keys do not protect against structural edits above them. Names make it worse: with release names (N15a), `<A/>` → `<B/>` keeps the state, because both are `t@0`, so dev and release disagree. A build-time id restores the reset (N15b). The all-`t` simulation is realistic: the earlier release bundle `poc/343/evidence/s4-voltra-widget-PocTodoSpike.release.bundle` has single-letter function names that collide (`function o(` appears 5 times, `function t(` twice).
3. **Mark & sweep deletes the state of anything not rendered in this pass.** That covers hidden rows (N10: hide completed, commit, show again, and the tick is gone) and a committed server-fetch trial render (N13), with or without the variant prefix. The sweep is only safe if every pass renders every stateful node the user can ever see again, and a widget's passes do not. Size variants are a separate, weaker point. N11a and N11b run without the variant prefix the note recommends in §05 (the large commit sweeps the small tick; the small commit sweeps a large-only row's tick). With the prefix (N12), the other variant is not swept (both commits deleted nothing), but state becomes per size, which is the note's own open question ("Decide"). No configuration gives state that is both shared across sizes and safe from the sweep: no prefix plus sweep loses keys (N11a, N11b); the prefix makes state per size (N12); no sweep shares state only when the trees line up slot for slot (N11b hole form vs N11c).

**Smaller findings.**

- Identity depends on the render path. In N16, the same element object used twice under `createVoltraRenderer` is deduplicated, so it gets one key and one shared state. Under `renderVariantToJson` (N16b) it gets two keys, and because the control ids repeat, the tap hits the second one. The note's second dedup path, the cross-variant `renderCache`, is not covered by a matrix case. A probe shows the gap: with `createVoltraRenderer`, the same root object added as `systemSmall` and `systemLarge`, and the prefix on, only `systemSmall/Column@0/Cnt@0#0` is marked. `systemLarge` comes from `renderCache` and is never marked, so a sweep in a multi-variant renderer pass would delete large-only keys. In the harness the root cursor also comes from `store.render`'s variant argument, not the renderer's variant name, so every variant in one renderer pass shares one prefix.
- With the variant prefix (N12), state is per size: a tick in small does not show in large. Without the prefix, state is shared only when the trees line up slot for slot (N11b, hole form), and not otherwise (N11a).
- A parent cannot read a row's `useState`. TodoList could not filter "done" rows in P; the harness had to pass `completedIds` from outside, while C reads the same record the rows read.
- The native side has to map a tap to a hook key. The harness uses "first hook of the nearest stateful component". A component with two state hooks needs a JS replay to know which one changes. In N14, a conditional hook in TodoList makes its own later hook read the wrong key (`collapsed` lost, `extra` gets `true`) without any error.
- A build-time id that contains `/` or `#` collides with the path and hook separators (`…/widgets/AB.tsx#A@0#0`) and would need escaping.

**Worth keeping from the note.** Holes as slots (N1 passes). Host primitives as segments, so a wrapper change is a visible reset rather than a silent mix-up. The build-time id idea, for any feature that needs a stable component identity (dev tools, error messages). `lastSeen = evalId` GC, instead of an immediate sweep, for any keyed store that wants to drop abandoned keys lazily, if size caps ever require GC. Untested (not implemented in the harness): as the note words it ("drop anything older"), it is equivalent to the sweep, so it would only avoid the N10, N11 and N13 losses with a grace window (keep a key for N evaluations or a TTL after it was last seen). A frozen hook counter after the body returns, as a guard for render props.

**Conclusion relative to option C.** The note correctly reproduces React's identity rules within one render (N1, N2, N5, N9 and N17 behave as React would), and its holes-as-slots rule fixes the worst problem of a global counter. But React's rules assume state dies with the tree, and widget state does not: it persists across code versions, size variants, hidden rows and trial renders, which are exactly where the path changes or a node is not rendered. The harness confirms the three structural problems (silent misattribution in unkeyed lists, loss or misattribution after a code change, and sweep deletion of hidden rows and committed trial renders), plus a dev/release disagreement that only a build-time id fixes. Across size variants the note's own prefix prevents the sweep loss but makes state per size, so shared-across-sizes state is not available in any configuration. The one honest positive is N18: a single `useState({})` map held by the list, with hookless rows, passes N3, N4, N8 and N10 like C. But that is option C spelled with `useState`: one stable key per widget (`root/TodoListMap@0#0`) holding a map keyed by item id, and the key is still positional, so it breaks if TodoListMap moves. Recommendation for the ADR: keep C (`useVoltraState` with explicit keys, written by `onInteraction` or `stateKey`), with no sweep on render. Do not build positional `useState` for Dynamic Widgets. At most, `useState` could become a dev-time error that points to `useVoltraState`.

## 9. Hybrid: inline setter + tap replay

Run on 2026-10-16 on the same `Brownfield_457_API_35` AVD. The debug build used Metro; release was measured afterwards. Widget H is `TodoStateSetterWidget`, appWidgetId 8, on the last launcher page: [Discover] [default] [C] [D] [second C] [H]. `t5-page.sh` gained an `H` case. Scripts for this run: `t8-series.sh` (warm-session, warm-process and cold series for C, D and H), `t8-d3.sh`, `t8-ad.sh` (Appduct call that first revokes stale sessions) and `t8-agg.py` (median/max per widget). `t5-latency.py` now also reports `bundleMs`, `interactMs` and `replayMs`.

**What it is.**

1. The author writes `const [done, setDone] = useVoltraStateTuple(key, initial)` (a PoC name) and an inline `onCheckedChange` / `onPress` on each control that has an author `id`.
2. A closure cannot cross to native, so a tap goes through the generated `interact` exactly as in C. When the widget exports no `onInteraction`, `interact` re-runs the render in replay mode, at the size the tapped tree was drawn at (native now puts that size in the action).
3. During the walk, the renderer records the handler of the first host element whose `id` equals `event.componentId`. Once the render has finished, it calls `onCheckedChange(event.value)` on a toggle or `onPress()` on a button.
4. Setters write a pending patch only inside that handler; they take a value or an updater. Anywhere else they do nothing and record a warning. The replay output is discarded, and `{ handled, state, replayMs, warnings }` goes back to native.
5. Native merges the patch the way it merges a C patch: same record, revision bump, event and `update()`. Precedence: `stateKey` (D) > `onInteraction` (C) > inline replay (H).

**Author code** (`example/widgets/android/TodoStateSetterWidget.tsx`, verbatim):

```tsx
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
```

**Demo (H).** In the "Chain" column, each value is in ms after the tap marker: callback entered → bundle eval → interact (of which the replay render) → commit → update returned → first render with the committed `stateRevision`. Every tap logged `via=replay handled=true warnings=[]`.

| Step                                                  | Result  | Chain / what was checked                                                                                                                                                                                                                                                     | Evidence                                                                  |
| ----------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| D1 foreground (tap-then-return, procState 15)         | pass    | 25 → 71 → 7 (6) → 113 → 135 → 553 (the app was in front, so no live Glance session for H); rev 3, 1 callback / 1 commit                                                                                                                                                      | t8-d1-H-fg.png, t8-d1-H-fg-return-app.png, t8-d1-H-logcat.log, -steps.txt |
| D1 background                                         | pass    | 18 → 69 → 7 (6) → 99 → 102 → 112; rev 4, 1/1                                                                                                                                                                                                                                 | t8-d1-H-bg.png                                                            |
| D1 killed (HOME, session ended, am kill, pidof empty) | pass    | Start proc +52, then 824 → 139 → 25 (24) → 1064 → 1114 → 1568; rev 5, 1/1; the repaint reads "3 of 3 done", so it is the JS render, not only the launcher's flip                                                                                                             | t8-d1-H-killed.png; recording media/t8-d1-H.mp4                           |
| D2 kill + relaunch                                    | pass    | `{done:{t1,t2,t3:true}}` rev 5 survived am kill. After the relaunch, `android_reload_widgets` rendered stateRevision=5 with every row ticked                                                                                                                                 | t8-d2-H-steps.txt, t8-d2-H-relaunch.png, t8-d2-H-logcat.log               |
| D3 push at the front, t1 ticked                       | pass    | [t4,t1,t2,t3]: row 2 ("Buy 🍞", t1) stays ticked, "NEW at front" is unticked; the record is unchanged (rev 7)                                                                                                                                                                | t8-d3-H-2-front-survive.png, t8-d3-H-steps.txt                            |
| D3 push at the end                                    | pass    | [t1,t2,t3,t4]: row 1 ticked, t4 unticked; rev 7 unchanged                                                                                                                                                                                                                    | t8-d3-H-3-end-survive.png                                                 |
| "Show completed" switch (second key)                  | pass    | off: the ticked rows are hidden, record `showCompleted:false` rev 9; on: they come back, rev 10; `done` is untouched                                                                                                                                                         | t8-d3-H-5-…, t8-d3-H-6-….png                                              |
| "Clear all" button (`onPress`)                        | pass    | componentType=button, value null; the replay called `onPress` → `done = {}` rev 11, every row unticked, `showCompleted` kept; 63 → 62 → 6 (5) → 144 → 147 → 150                                                                                                              | t8-d3-H-7-clear-all.png, t8-d3-H-logcat.log                               |
| D6 three cold taps, then drain                        | pass    | t1, t2, t1 with the process killed before each tap: seq 84, 85, 86 in order, handledInWidget=true, stateChange `done` null→{t1}→{t1,t2}→{t1:false,t2}. Raw queue read with run-as before any app start; drained through Appduct after a launcher start (not the todo screen) | t8-d6-H-queue.xml, t8-d6-H-drain.json/.txt, t8-d6-H-logcat.log            |
| K1 rapid double tap on t1                             | pass    | 2 callbacks / 2 commits, rev 17 then 18, absolute values true then false. Tap 2 carried renderedRevision 16 (stale) and was applied; the final `t1:false` matches the launcher                                                                                               | t8-k1-H.png, t8-k1-H-logcat.log                                           |
| D2 reboot, D4, K3 for H                               | not run | n/a                                                                                                                                                                                                                                                                          | n/a                                                                       |

**Latency, C vs D vs H, same session.** Each cell is median / max in ms after the tap marker. Debug bundle eval includes the Metro fetch (16–80 ms). Warm-session leaves out each widget's first tap (the one that opens the session). Warm-process: 65 s idle before every tap, same pid 18780 in all 15 rounds. Cold: C, D and H interleaved, each tap after HOME, end of the Glance session, `am kill` and an empty `pidof`. Every tap had exactly 1 callback and 1 commit. Summary: `evidence/t8-latency-summary.txt`.

| Build, cell           | Widget | n   | callback | commit    | update    | first render | bundle eval | interact | replayMs |
| --------------------- | ------ | --- | -------- | --------- | --------- | ------------ | ----------- | -------- | -------- |
| debug, warm-session   | C      | 5   | 26/70    | 119/126   | 122/129   | 132/138      | 63/80       | 0/1      | –        |
| debug, warm-session   | D      | 5   | 23/31    | 64/70     | 73/78     | 77/82        | –           | –        | –        |
| debug, warm-session   | H      | 5   | 28/34    | 126/130   | 129/135   | 132/137      | 59/80       | 7/8      | 6/7      |
| debug, warm-process   | C      | 5   | 40/51    | 147/163   | 163/176   | 577/592      | 98/103      | 1/2      | –        |
| debug, warm-process   | D      | 5   | 44/80    | 89/122    | 118/146   | 532/565      | –           | –        | –        |
| debug, warm-process   | H      | 5   | 41/122   | 158/197   | 170/207   | 584/623      | 93/111      | 8/9      | 7/9      |
| debug, cold           | C      | 5   | 809/812  | 1001/1055 | 1063/1111 | 1531/1575    | 130/174     | 1/2      | –        |
| debug, cold           | D      | 5   | 816/831  | 866/880   | 916/931   | 1379/1402    | –           | –        | –        |
| debug, cold           | H      | 5   | 808/836  | 989/1007  | 1045/1062 | 1493/1524    | 109/111     | 12/13    | 10/12    |
| release, warm-session | C      | 5   | 32/35    | 98/110    | 101/115   | 111/123      | 55/71       | 0/1      | –        |
| release, warm-session | H      | 5   | 30/38    | 94/112    | 98/115    | 101/121      | 50/63       | 6/6      | 5/5      |
| release, cold         | C      | 5   | 236/243  | 268/278   | 282/293   | 699/715      | 17/19       | 0/1      | –        |
| release, cold         | H      | 5   | 228/262  | 265/303   | 278/314   | 696/734      | 17/34       | 4/7      | 4/6      |

Evidence: t8-lat-warmsession-{C,D,H}-logcat.log, t8-lat-warmprocess-logcat.log, t8-lat-cold-logcat.log, t8-lat-release-warmsession-{C,H}-logcat.log, t8-lat-release-cold-logcat.log, plus the matching -steps.txt files.

Reading the table:

- H costs what C costs, plus the replay render: 5–10 ms in debug and 4–6 ms in release for this tree (3 rows, a switch and a button), against ≤1 ms for `onInteraction`. That is smaller than the run-to-run spread of the bundle evaluation, so H and C are level in every cell.
- D stays ahead wherever JS is skipped: about 55 ms in the warm session, and about 120 ms to the commit when cold.
- On a cold tap, every option pays the process start (about 0.8 s debug, 0.23 s release) and then 410–470 ms from `update()` to the first render.
- Today's debug C warm-session commit (119 ms) is slower than §3's (95 ms), so only numbers from the same session are compared.
- Release recipe: worked. The incremental `assembleRelease -PreactNativeArchitectures=arm64-v8a` took 36 s. The APK carries four widget bundles, among them `voltra-widget-TodoStateSetterWidget.bundle` (98,588 bytes, with the replay warning strings; t8-release-bundles.txt). The release was installed with `adb install -r` over debug and measured. Debug was then reinstalled, and a tap on H was checked again (t8-debug-reinstall-smoke-logcat.log).
- Release warm-process: not measured.

**F33 (Fast Refresh).**

- Setup: Metro running, the app in front on the todo screen. One comment line in `TodoStateSetterWidget.tsx` was edited (the file has only a default export).
- Result: hot patch. `registerTool`=0 (the app's JS did not re-run), and 15 widget renders arrived through the widget hot reload, 3 of them for H.
- Control in the same minute: the same kind of edit in `TodoStateWidget.tsx` (C: default export plus `onInteraction`) caused a full reload (`registerTool`=22, 36 renders). So the HMR socket was up, and the difference comes from the exports.
- Both files were restored byte for byte (shasum before = after: H `74d977a2…`, C `4cc01207…`).
- Evidence: t8-f33-H.txt, t8-f33-H-comment-edit.log, t8-f33-C-control-comment-edit.log.

**What it costs, relative to C and D.**

- Every tap runs a replay render of the whole tree, on top of the bundle evaluation per tap that C already pays. The bundle-eval cache stays a prerequisite, and the replay cost grows with the size of the tree.
- The replay must rebuild the tree the user tapped. It uses the record, the props, the env (theme, locale, configuration) and the tapped size. Anything else that changes the tree, such as time, randomness or a server-fetched tree, can leave the tapped `id` unmatched. Then the tap is not handled (warning `no element with id "X" reached in the replay render`), though it still repaints. No such warning occurred in this run.
- Handlers must be synchronous. A setter called after an `await`, in a timer or in the render body does nothing and records a warning. Today these warnings only reach logcat (`warnings=[…]`), not the app or the developer.
- Each control with a handler needs a unique author `id`; the first element in render order wins. An `id` missing next to a handler is not detected yet.
- `onCheckedChange` and `onPress` are not in the generated prop types, so the example uses local casts. This is the same gap as `stateKey`.
- Compared with D, H runs JS on every tap (about 55 ms more in the warm session). D has no closure semantics to get wrong, but it can only write one flat boolean per toggle.

**What it buys.**

- Author code shaped like React: the state and its handler sit next to the control. A row's closure captures `item.id`, with no `componentId` string parsing and no exported handler.
- A file that stays a Fast Refresh boundary (F33 hot patch). C's exported `onInteraction` makes every edit of the file reload the whole app.
- The common cases C covers: a map keyed by item id, several keys from one widget (`done` and `showCompleted`), a button (`Clear all`), and updaters computed from the persisted value. D covers none of the button or map cases.
- The same native seam, record, revision, event queue and `update()` as C. The Kotlin side only gained `via=replay` logging and the tapped size in the action parameters.

**Public API proposal (for the ADR; the PoC names are not the API).**

```ts
// One hook: the read-only form becomes the first element of the tuple.
function useVoltraState<T>(key: string, initial: T): [T, VoltraStateSetter<T>]
type VoltraStateSetter<T> = (next: T | ((prev: T) => T)) => void

// Toggles (CheckBox, Switch) and buttons (FilledButton, Button, …). A handler requires an author id:
type WithCheckedChange = { id: string; onCheckedChange: (checked: boolean) => void } | { onCheckedChange?: never }
type WithPress = { id: string; onPress: () => void } | { onPress?: never }

// Unchanged and optional: `stateKey` on toggles (no JS on the tap) and an `onInteraction` escape hatch.
// Precedence: stateKey > onInteraction > inline replay.
```

- The setter takes a value or an updater; the updater sees the value already pending for the key in this replay, or else the persisted value.
- Outside a tap, the setter does nothing and records a dev warning, so render stays pure.
- A widget without `onInteraction` stays a Fast Refresh boundary.
- If `onInteraction` is kept, it should live outside the widget module's exports (F33).

**Recommendation for the ADR:** make H the default authoring model. `useVoltraState(key, initial)` returns `[value, setValue]`, toggles take `onCheckedChange` and buttons `onPress` (an `id` is required), and taps are handled by a replay on the C seam. Keep `stateKey` as the fast path without JS for flat booleans, keep `onInteraction` only as an escape hatch outside the widget module's exports, and keep the bundle-eval cache as a prerequisite.

**Other observations from this run.**

- The task notes placed H on the default page, top left. It is on the last launcher page; `t5-page.sh H` swipes there.
- After the D3 switch-off tap, the repaint took 561 ms, against 139–155 ms for the other D3 taps in the same session (commit 135 ms, as usual). Not explained.
- Seq 76 (the D1 foreground tap) was not in the drain before D6. D1 returned to the todo screen right after that tap, and the screen drains on mount. This matches §5's destructive-drain issue.
- The `props_revision` of placement 8 went from 1 to 25 during the run: the todo screen pushes props when it mounts, and D3 pushed four times.

**Tests (this run).**

- `pnpm --filter @use-voltra/core test`: tests 67, pass 67, fail 0.
- `pnpm --filter @use-voltra/metro test`: tests 35, suites 7, pass 35.
- `pnpm --filter @use-voltra/android-client test`: 8 suites / 34 tests and 11 suites / 57 tests passed.
- Robolectric with the JDK 17 init script and `--rerun`: 24 tests, 0 failures (StateInteraction 8, StateStore 7, EventQueue 4, StateFlags 3, PushStateReset 2). A first run without `--rerun` reported the task UP-TO-DATE and is not counted.
- `pnpm run typecheck`: 12/12 tasks. `pnpm run lint`: 12/12 tasks.
- All on Node 24.13.0, recorded in `evidence/t8-tests.txt`.

## 10. Public API proposal (draft for the ADR)

Written after the hybrid measurement (§9). PoC names (`useVoltraStateTuple`, `DynamicWidgetState…`) are not the API; this is the surface the ADR would decide on.

One hook, three write paths, one native record per placement (Android) or per scope (iOS); nothing else is public.

```tsx
import { useVoltraState, VoltraAndroid } from '@use-voltra/android'

export default function Todo({ items }: Props, env: WidgetEnvironment) {
  const [done, setDone] = useVoltraState<Record<string, boolean>>('done', {}) // React-shaped tuple, explicit key
  return (
    <VoltraAndroid.Column>
      {items.map((it) => (
        <VoltraAndroid.CheckBox
          id={it.id}
          text={it.title}
          checked={!!done[it.id]}
          onCheckedChange={(checked) => setDone((d) => ({ ...d, [it.id]: checked }))} // inline handler, replayed on the tap
        />
      ))}
      <VoltraAndroid.FilledButton id="clear" text="Clear all" onPress={() => setDone({})} />
    </VoltraAndroid.Column>
  )
}
```

- `useVoltraState(key, initial): [value, setValue]`. Not a React hook: no dispatcher, callable in loops and conditions, works at prerender and inside element-valued props. `key` is a non-empty string; the value is JSON. The setter accepts a value or an updater `(prev) => next`.
- The setter is effective only inside a control's handler prop (`onCheckedChange`, `onPress`) during a tap. Called in the render body it is ignored and logs a dev warning; render stays pure.
- Handlers run synchronously, as a replay render in the widget's own process (Android app process without React Native; iOS widget extension). They receive the value the platform delivered (absolute on Android 31+; render-time value below 31 and on iOS, so authors use the argument, never toggle relative to the previous value).
- Controls that react need an explicit `id`. A handler on a control without an `id` is a dev-time error.
- `stateKey` on `CheckBox`/`Switch` is the declarative fast path (`state[stateKey] = checked`, no JS); it takes precedence over a handler on the same control.
- `onInteraction` is not part of the public API (kept only if the ADR wants an escape hatch; the replay covers its cases and keeps the widget file a Fast Refresh boundary).
- `useState` in widget code becomes a dev-time error pointing at `useVoltraState` (or stays a no-op with a one-time warning; ADR decision).

App side: `getDynamicWidgetState(scopeOrAppWidgetId)`, `setDynamicWidgetState(...)`, `resetDynamicWidgetState(...)`; tap events through the #314 channel (`addVoltraListener('interaction')`) with `handledInWidget` and `stateChange`; `VoltraView` previews take a `state` prop. Props pushes never touch the record (`precedence = survive`); the app resets explicitly.

Types exported: `VoltraStateRecord`, the setter type, and (if kept) `VoltraInteractionEvent`. iOS: identical surface; the replay runs in the plain `AppIntent` in the extension.
