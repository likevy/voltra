#!/usr/bin/env bash
# PoC #343 environment. `source` this file in every shell the PoC uses (plan §6).
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
export ANDROID_HOME="$HOME/Library/Android/sdk"; export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"   # real emulator ahead of the legacy sdk/tools shim
source ~/.nvm/nvm.sh && nvm use 24.13.0 >/dev/null && corepack enable pnpm   # Node 24 installs ship no pnpm binary
export PKG=com.callstackincubator.voltraexample
export WT="$HOME/Documents/Projects/callstack/voltra/voltra-poc-343"
which emulator node pnpm; node -v; pnpm -v   # expect .../sdk/emulator/emulator, v24.13.0, 11.5.0
