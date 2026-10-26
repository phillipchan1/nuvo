#!/bin/bash
# Xcode Cloud — runs after clone, before dependency resolution / xcodebuild.
# Installs Node 20 + Rust stable (aarch64-apple-ios), npm ci, optional pods,
# and the leftover post-init work that is still needed on a committed project
# (icons already in-tree; watch is skipped).
set -euo pipefail

echo "=== Nuvo Xcode Cloud: ci_post_clone ==="
echo "pwd=$(pwd)"
echo "HOME=${HOME:-}"
echo "CI_PRIMARY_REPOSITORY_PATH=${CI_PRIMARY_REPOSITORY_PATH:-}"
echo "CI_XCODE_CLOUD=${CI_XCODE_CLOUD:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
fi
cd "$REPO_ROOT"
echo "repo=$REPO_ROOT"

# Cloud default: do not inject or build the watch companion.
# Honor an explicit NUVO_IOS_WATCH=1 if someone sets it on the workflow.
export NUVO_IOS_WATCH="${NUVO_IOS_WATCH:-0}"
echo "NUVO_IOS_WATCH=$NUVO_IOS_WATCH"

# ---------------------------------------------------------------------------
# Required environment (set on the Xcode Cloud workflow)
# ---------------------------------------------------------------------------
REQUIRED_VARS=(
  VITE_SUPABASE_URL
  VITE_SUPABASE_ANON_KEY
  VITE_POSTHOG_PROJECT_TOKEN
  VITE_POSTHOG_HOST
  VITE_NUVO_IAP_MONTHLY
  VITE_NUVO_IAP_ANNUAL
  APPLE_DEVELOPMENT_TEAM
)

missing=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    missing+=("$var")
  fi
done
if [ "${#missing[@]}" -ne 0 ]; then
  echo "error: Xcode Cloud is missing required environment variables:" >&2
  for var in "${missing[@]}"; do
    echo "  - $var" >&2
  done
  echo "Add them in App Store Connect → Xcode Cloud → [workflow] → Environment." >&2
  echo "Never set CFBundleVersion here — Cloud's build number wins." >&2
  exit 1
fi
echo "Required environment variables: ok"

# ---------------------------------------------------------------------------
# Node 20
# ---------------------------------------------------------------------------
export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1

node_major() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt 20 ]; then
  echo "Installing Node 20 via Homebrew…"
  brew install node@20
fi
if brew --prefix node@20 >/dev/null 2>&1; then
  export PATH="$(brew --prefix node@20)/bin:$PATH"
fi
# Some Cloud images already have a newer node; accept ≥20.
if [ "$(node_major)" -lt 20 ]; then
  echo "error: need Node 20+, have $(node -v 2>/dev/null || echo none)" >&2
  exit 1
fi
echo "node $(node -v)  npm $(npm -v)"

# ---------------------------------------------------------------------------
# Rust stable + aarch64-apple-ios
# ---------------------------------------------------------------------------
if [ ! -f "$HOME/.cargo/env" ]; then
  echo "Installing Rust stable…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal
fi
# shellcheck disable=SC1091
. "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$PATH"
echo "Adding rust target aarch64-apple-ios"
rustup target add aarch64-apple-ios
echo "rustc $(rustc --version)"

# ---------------------------------------------------------------------------
# Persist toolchain + Vite env for later phases
# (Xcode Cloud's build-phase sandbox hides PATH)
# ---------------------------------------------------------------------------
# shellcheck source=env.sh
. "$SCRIPT_DIR/env.sh"
nuvo_write_xcode_cloud_env

# ---------------------------------------------------------------------------
# JS deps + leftover post-init
# ---------------------------------------------------------------------------
echo "npm ci"
npm ci --no-audit --no-fund

# Icons, encryption flag, URL scheme — skip the xcodegen injectors.
# Widgets + SIWA + app group are already in the committed project.
# Watch stays out unless NUVO_IOS_WATCH=1 (not the Cloud default).
if [ "$NUVO_IOS_WATCH" = "1" ]; then
  if ! command -v xcodegen >/dev/null 2>&1; then
    echo "Installing xcodegen for watch injection…"
    brew install xcodegen
  fi
  bash "$REPO_ROOT/scripts/ios-postinit.sh"
else
  bash "$REPO_ROOT/scripts/ios-postinit.sh" --no-codegen
fi

# ---------------------------------------------------------------------------
# CocoaPods — only if the Podfile names a real pod
# ---------------------------------------------------------------------------
PODFILE="$REPO_ROOT/src-tauri/gen/apple/Podfile"
if [ -f "$PODFILE" ] && grep -Eq "^[[:space:]]*pod[[:space:]]" "$PODFILE"; then
  echo "pod install"
  (cd "$REPO_ROOT/src-tauri/gen/apple" && pod install)
else
  echo "pod install skipped (no pods declared)"
fi

echo "=== ci_post_clone complete ==="
echo "scheme: nuvo_iOS"
