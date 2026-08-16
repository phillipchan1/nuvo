#!/usr/bin/env bash
# Build the watchOS companion on its own, against the watchOS SDK.
#
# Why separately: `tauri ios build` invokes xcodebuild with an explicit
# `-sdk .../iPhoneOS<ver>.sdk`, and a command-line -sdk overrides every target's
# own SDKROOT. So the watch app cannot be a build dependency of the iOS app — it
# would be compiled for iOS and fail (CI run 31719213175). It is built here, and
# scripts/ios-watch.rb's "Embed Nuvo Watch" phase copies the product into the app
# bundle during Tauri's archive.
#
# Prints the built .app path and, under GitHub Actions, exports NUVO_WATCH_APP
# so the later `tauri ios build` step picks it up.
#
# Run AFTER scripts/ios-postinit.sh (which generates the project with the target).
#
# Note the `${arr[@]+"${arr[@]}"}` expansions below: macOS ships bash 3.2, where
# `"${arr[@]}"` on an EMPTY array trips `set -u`. The runners hit the same shell.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${ROOT}/src-tauri/gen/apple/nuvo.xcodeproj"
DERIVED="${ROOT}/src-tauri/gen/apple/build/watch"
CONFIG="${NUVO_WATCH_CONFIG:-release}"

if [ ! -d "$PROJECT" ]; then
  echo "::error::No Xcode project at $PROJECT — run 'npm run tauri ios init -- --ci' and scripts/ios-postinit.sh first."
  exit 1
fi

if ! xcodebuild -list -project "$PROJECT" 2>/dev/null | grep -q 'NuvoWatch'; then
  echo "::error::The NuvoWatch target is missing. ios-postinit.sh only injects it when NUVO_IOS_WATCH=1."
  exit 1
fi

# Signing — CI builds unsigned on purpose. Ephemeral GitHub runners plus
# -allowProvisioningUpdates mint a fresh "Apple Development: Created via API"
# certificate on every run; a handful of pushes exhausts the account cap and
# every TestFlight build fails (CI runs 31895025088+). The nested watch bundle
# rides inside the host IPA; Tauri's app-store export signs the archive and
# upload succeeds without a separately signed watch product (run 31853058296).
#
# Local builds with an API key may still use automatic signing for convenience.
# -allowProvisioningUpdates can create a PROFILE for an existing identifier but
# cannot register a new one, so day.nuvo.app.watchkitapp must already exist in
# the developer portal.
SIGN_ARGS=()
if [ "${CI:-}" = "true" ]; then
  SIGN_ARGS+=(CODE_SIGNING_ALLOWED=NO)
  echo "ios-watch-build: CI — building unsigned (avoids minting Development certs)"
elif [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  SIGN_ARGS+=(
    -allowProvisioningUpdates
    -authenticationKeyID "$APPLE_API_KEY"
    -authenticationKeyIssuerID "$APPLE_API_ISSUER"
    -authenticationKeyPath "$APPLE_API_KEY_PATH"
  )
  echo "ios-watch-build: automatic signing via App Store Connect API key"
else
  # No key (local dev): build unsigned so the shape can still be verified.
  SIGN_ARGS+=(CODE_SIGNING_ALLOWED=NO)
  echo "ios-watch-build: no API key — building unsigned"
fi

TEAM_ARGS=()
if [ -n "${APPLE_DEVELOPMENT_TEAM:-}" ]; then
  TEAM_ARGS+=(DEVELOPMENT_TEAM="$APPLE_DEVELOPMENT_TEAM")
fi

# Versions must match the host app's or App Store validation rejects the nested
# bundle. ios-watch.rb stamps the plist from tauri.conf.json; Tauri then runs
# `agvtool new-version -all` over the *app's* project, which does NOT reach a
# product built here beforehand — so pass the build number explicitly.
VERSION_ARGS=()
if [ -n "${BUILD_NUMBER:-}" ]; then
  VERSION_ARGS+=(CURRENT_PROJECT_VERSION="$BUILD_NUMBER")
fi

# `-target` + `-sdk`, deliberately, rather than `-scheme` + `-destination`:
#
#   • A -scheme build needs a destination, and `generic/platform=watchOS` fails
#     on machines that have the watchOS SDK but not the device platform
#     component ("watchOS 26.5 is not installed").
#   • -target builds exactly one target, so the command-line -sdk that causes
#     all this trouble in the app's build is harmless here — there is no other
#     target for it to leak onto.
#
# -derivedDataPath requires -scheme, so the output location is pinned with
# CONFIGURATION_BUILD_DIR instead, which also makes the product path exact
# rather than something to go hunting for.
OUT="${DERIVED}/Products"
rm -rf "$OUT"
mkdir -p "$OUT"

build_watch() {
  xcodebuild \
    -project "$PROJECT" \
    -target NuvoWatch \
    -configuration "$CONFIG" \
    -sdk watchos \
    CONFIGURATION_BUILD_DIR="$OUT" \
    ${SIGN_ARGS[@]+"${SIGN_ARGS[@]}"} \
    ${TEAM_ARGS[@]+"${TEAM_ARGS[@]}"} \
    ${VERSION_ARGS[@]+"${VERSION_ARGS[@]}"} \
    build
}

echo "ios-watch-build: building NuvoWatch ($CONFIG, watchos)…"
LOG="${DERIVED}/build.log"
mkdir -p "$DERIVED"
if ! build_watch 2>&1 | tee "$LOG"; then
  # The app icon is compiled by actool, which refuses to run unless a SIMULATOR
  # runtime matching the watchOS SDK is installed — even for a device build:
  #   "No simulator runtime version from [...] available to use with
  #    watchsimulator SDK version 23T570"
  # A machine can have the watchOS SDK and not that runtime (mine does). The
  # platform download is idempotent and quick when it's already there, so heal
  # and retry once rather than failing on a missing component.
  if grep -q "No simulator runtime version" "$LOG"; then
    echo "ios-watch-build: missing a matching watchOS simulator runtime — downloading the platform…"
    xcodebuild -downloadPlatform watchOS
    echo "ios-watch-build: retrying the build…"
    build_watch
  else
    echo "::error::NuvoWatch build failed — see the log above."
    exit 1
  fi
fi

APP="${OUT}/NuvoWatch.app"
if [ ! -d "$APP" ]; then
  echo "::error::NuvoWatch.app not found at $APP"
  ls -la "$OUT" 2>/dev/null || true
  exit 1
fi

echo "ios-watch-build: built $APP"
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "NUVO_WATCH_APP=${APP}" >> "$GITHUB_ENV"
  echo "ios-watch-build: exported NUVO_WATCH_APP"
fi
