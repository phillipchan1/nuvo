#!/bin/bash
# Xcode Cloud — runs immediately before xcodebuild.
# Restores Node / Rust / VITE_* on PATH so Tauri's "Build Rust Code"
# phase (`tauri ios xcode-script`) can see them. Cloud strips PATH from
# script phases via -hideShellScriptEnvironment.
set -euo pipefail

echo "=== Nuvo Xcode Cloud: ci_pre_xcodebuild ==="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
fi
cd "$REPO_ROOT"

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi
if brew --prefix node@20 >/dev/null 2>&1; then
  export PATH="$(brew --prefix node@20)/bin:$PATH"
fi
export PATH="$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

# shellcheck source=env.sh
. "$SCRIPT_DIR/env.sh"
nuvo_require_xcode_cloud_env
nuvo_write_xcode_cloud_env

echo "node:  $(command -v node)  $(node -v)"
echo "npm:   $(command -v npm)   $(npm -v)"
echo "cargo: $(command -v cargo) $(cargo --version)"
echo "rustc: $(command -v rustc) $(rustc --version)"
echo "tauri: $REPO_ROOT/node_modules/.bin/tauri"

if [ ! -x "$REPO_ROOT/node_modules/.bin/tauri" ]; then
  echo "error: Tauri CLI missing — ci_post_clone.sh must run npm ci first." >&2
  exit 1
fi
if [ ! -d "$REPO_ROOT/src-tauri/gen/apple/nuvo.xcodeproj" ]; then
  echo "error: committed Xcode project missing at src-tauri/gen/apple/nuvo.xcodeproj" >&2
  exit 1
fi

echo "=== ci_pre_xcodebuild ready (scheme nuvo_iOS) ==="
