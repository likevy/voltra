# PoC #343 — handoff

Branch `poc/343-in-widget-state` on `origin` (`likevy/voltra`), cut from upstream `main` at `d447f6d` (voltra 2.4.0). It is a proof of concept for [callstackincubator/voltra#343](https://github.com/callstackincubator/voltra/issues/343): never merged, no changeset, no pull request against `main` (a PR would run the full CI for nothing).

## Commits

- `9a604af` feat(example): add to-do widgets and screen for in-widget state (#343)
- `be56b29` feat(android): handle widget taps in-process with a persisted state record (#343)
- `215a267` feat(metro): pass __voltraState into render and expose interact (#343)
- `ad40f78` feat(core): add useVoltraState for in-widget state (#343)

plus `docs(poc): add #343 findings, report, scripts and evidence` (this commit). Code diff against `main`:  42 files changed, 3544 insertions(+), 31 deletions(-).

## Open it

```bash
git clone https://github.com/likevy/voltra.git && cd voltra      # or: git fetch origin
git switch poc/343-in-widget-state
```

Then follow `poc/343/README.md`: `source poc/343/env.sh`, `pnpm install --frozen-lockfile`, `pnpm run build:all`, boot an API 35 AVD, `cd example && CI=1 pnpm exec expo prebuild --platform android --clean`, `pnpm exec expo run:android --device <AVD name>`, open the "In-widget state (PoC #343)" screen, pin `TodoStateWidget` (option C) and `TodoStateKeyWidget` (option D), tap a task.

- `poc/343/REPORT.md`: what was built, demo results, latency, tests, open issues, the ADR decision list with evidence.
- `poc/343/FINDINGS.md`: the day-1 spikes that the design rests on.
- `poc/343/evidence/`: logcat excerpts, screenshots, JSON and test output referenced by the two documents (about 40 MB, mostly screenshots). Recordings were not committed.

## Notes for whoever continues

- The Kotlin unit tests need a JDK 21 toolchain (`packages/android-client/android/build.gradle`). Without one, run them with `cd example/android && ./gradlew --init-script ../../poc/343/scripts/jdk17-unit-tests.init.gradle :use-voltra_android-client:testDebugUnitTest --tests "voltra.dynamicwidget.state.*"`.
- Expo CLI 55 wants the AVD name in `--device`, not the adb serial.
- Not verified yet: server-fetch precedence (D5), the K2/K4/K5 races, pre-31 Android, size caps, async handlers, cleanup on restore, iOS.
