#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds the watchOS companion app (src-tauri/ios/NuvoWatch) to the Xcode project
# `tauri ios init` generates, then regenerates the project so Xcode sees it.
#
# Read scripts/ios-widgets.rb first — this is its sibling and the reasoning for
# patching `project.yml` rather than committing an .xcodeproj is identical.
# The two are commutative: each re-reads the spec from disk, mutates it, writes
# it back and regenerates. The only hard ordering rule is that BOTH must run
# before ios-postinit.sh's PlistBuddy block, because xcodegen owns
# nuvo_iOS/Info.plist and rewrites it from project.yml on every regeneration.
#
# Idempotent — safe to re-run over an already-patched project.
# Set NUVO_IOS_WATCH=0 to skip it and ship the plain app; nothing else in the
# build depends on the watch target.
#
# ⚠️ The bundle id `<app>.watchkitapp` must be registered by hand in the Apple
# developer portal. `-allowProvisioningUpdates` will create a *profile* for an
# identifier that exists, but an App Store Connect API key cannot register a new
# identifier — CI fails at the export step with "Automatic signing cannot
# register bundle identifier". Same wall the widgets hit; see docs/ios-releases.md.

require 'fileutils'
require 'json'
require 'yaml'

ROOT = File.expand_path('..', __dir__)
PROJECT_DIR = File.join(ROOT, 'src-tauri', 'gen', 'apple')
SPEC_PATH = File.join(PROJECT_DIR, 'project.yml')

TARGET_NAME = 'NuvoWatch'
# Sources live outside gen/apple (gitignored) so the Swift is committed and
# reviewable; XcodeGen is happy to reference a path above the project.
SOURCE_PATH = '../../ios/NuvoWatch'
# The watch face complications, embedded in the watch app (not the phone's).
WIDGET_TARGET = 'NuvoWatchWidgets'
WIDGET_SOURCE_PATH = '../../ios/NuvoWatchWidgets'
# watchOS 10 is where the SwiftUI idioms this app is written in are native.
DEPLOYMENT_TARGET = '10.0'

def fail!(message)
  warn "ios-watch: #{message}"
  exit 1
end

fail!("no Xcode project at #{PROJECT_DIR} — run `npm run tauri ios init -- --ci` first") unless File.directory?(PROJECT_DIR)
fail!("no project.yml at #{SPEC_PATH} — cargo-mobile2 should have written one") unless File.file?(SPEC_PATH)

swift_dir = File.join(ROOT, 'src-tauri', 'ios', 'NuvoWatch')
fail!("missing watch sources at #{swift_dir}") if Dir.glob(File.join(swift_dir, '*.swift')).empty?

spec = YAML.safe_load(File.read(SPEC_PATH), aliases: true)
targets = spec['targets'] || fail!('project.yml has no targets')

app_name, app_target = targets.find { |_, t| t.is_a?(Hash) && t['type'] == 'application' && t['platform'] == 'iOS' }
fail!('could not find the iOS application target in project.yml') if app_target.nil?

# Bundle id and team follow the app's. Apple *requires* the watch app's id to be
# prefixed by its companion's — this is not merely a convention.
app_settings = spec.dig('settingGroups', 'app', 'base') || {}
app_bundle_id = app_settings['PRODUCT_BUNDLE_IDENTIFIER'] || spec.dig('options', 'bundleIdPrefix')
fail!('could not read the app bundle identifier from project.yml') if app_bundle_id.nil?
team = app_settings['DEVELOPMENT_TEAM'] || ENV['APPLE_DEVELOPMENT_TEAM']
watch_bundle_id = "#{app_bundle_id}.watchkitapp"

# Version strings must match the host app's exactly, and the build number must
# NOT be folded in here — Tauri runs `xcrun agvtool new-version -all` between the
# build and the archive, and `-all` reaches every Info.plist in the project. See
# the long comment in ios-widgets.rb; pre-stamping made the widget run *ahead* of
# the app and Xcode rejected the archive for it.
tauri_conf = JSON.parse(File.read(File.join(ROOT, 'src-tauri', 'tauri.conf.json')))
short_version = tauri_conf['version'] || '0.1.0'

targets[TARGET_NAME] = {
  # A modern SINGLE-TARGET watch app (Xcode 14+) is a plain `application` on
  # platform watchOS. It must NOT be `application.watchapp2`: that is the legacy
  # type where the .app is a resource bundle carrying Apple's WatchKit stub
  # executable and the real code lives in a companion watchkit2-extension. With
  # our Swift compiled into the app itself, Xcode then has two commands writing
  # the same executable — a stub copy and our link — and the build dies with
  # "Multiple commands produce .../NuvoWatch.app/NuvoWatch" (verified locally).
  #
  # Nothing embeds this automatically, by design — see the long note below the
  # target: it is built separately and copied in by a script phase, because a
  # dependency edge would get it compiled for iOS. `supportedDestinations` is
  # not an option either: XcodeGen refuses watchOS there.
  'type' => 'application',
  'platform' => 'watchOS',
  'sources' => [{ 'path' => SOURCE_PATH }],
  'info' => {
    'path' => "#{TARGET_NAME}/Info.plist",
    'properties' => {
      'CFBundleDisplayName' => 'Nuvo',
      'CFBundleShortVersionString' => short_version,
      'CFBundleVersion' => short_version,
      # App Store validation rejects a watch app without an icon, twice over:
      # "A value for the Info.plist key 'CFBundleIconName' is missing" (90713)
      # and "No icons found for watch application" (90391). GENERATE_INFOPLIST_FILE
      # is NO, so nothing writes this key for us — see run 31721830337.
      'CFBundleIconName' => 'AppIcon',
      # Single-target watch app (Xcode 14+): no companion watchkit2-extension,
      # WKApplication rather than the retired WKWatchKitApp.
      'WKApplication' => true,
      'WKCompanionAppBundleIdentifier' => app_bundle_id,
      # A complication tap opens `nuvo://capture` / `nuvo://chat`, the same
      # vocabulary src/lib/shortcuts.ts parses and the iPhone widgets fire. The
      # watch app has to declare the scheme or onOpenURL never sees it.
      'CFBundleURLTypes' => [
        {
          'CFBundleURLName' => watch_bundle_id,
          'CFBundleURLSchemes' => ['nuvo']
        }
      ]
    }
  },
  'settings' => {
    'base' => {
      # PRODUCT_NAME is the BUILT FILE's name and must match the target's product
      # reference (NuvoWatch.app) — the embed phase copies that path. Setting it
      # to 'Nuvo' makes the target build Nuvo.app while the copy phase still
      # expects NuvoWatch.app, and the build dies with "Multiple commands produce
      # .../Nuvo.app/Nuvo". The name a wearer actually sees comes from
      # CFBundleDisplayName above, exactly as it does for the widgets.
      'PRODUCT_NAME' => TARGET_NAME,
      'PRODUCT_BUNDLE_IDENTIFIER' => watch_bundle_id,
      'WATCHOS_DEPLOYMENT_TARGET' => DEPLOYMENT_TARGET,
      'TARGETED_DEVICE_FAMILY' => '4',
      'SWIFT_VERSION' => '5.0',
      'SKIP_INSTALL' => 'YES',
      # The host app already embeds the Swift runtime.
      'ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES' => 'NO',
      'CODE_SIGN_STYLE' => 'Automatic',
      'GENERATE_INFOPLIST_FILE' => 'NO',
      # Compiles src-tauri/ios/NuvoWatch/Assets.xcassets (picked up with the
      # rest of that directory) and names the icon set to ship.
      'ASSETCATALOG_COMPILER_APPICON_NAME' => 'AppIcon',
      'INFOPLIST_KEY_WKCompanionAppBundleIdentifier' => app_bundle_id
      # Deliberately NOT inheriting the app target's ARCHS/EXCLUDED_ARCHS: those
      # live in nuvo_iOS.settings.base and name arm64 only. A watch target needs
      # $(ARCHS_STANDARD) for the watchOS SDK (arm64_32), and pinning arm64 here
      # is the classic "no architectures to compile for" failure.
    }.tap { |s| s['DEVELOPMENT_TEAM'] = team if team && !team.empty? }
  },
  'dependencies' => [
    { 'sdk' => 'SwiftUI.framework' },
    # The phone hands the watch its credential over WCSession — see the token
    # bridge in the plan. Linked now so the target doesn't change shape later.
    { 'sdk' => 'WatchConnectivity.framework' },
    # The complications ride INSIDE the watch app, not the iPhone app. This one
    # is a normal embed: both targets are watchOS, so the SDK conflict that
    # forced the app-side dance below doesn't arise here.
    { 'target' => WIDGET_TARGET, 'embed' => true }
  ]
}

# The watch face complications — Capture and Ask Nuvo, the same two acts as the
# iPhone's widgets. A WidgetKit extension on watchOS, embedded in the watch app.
targets[WIDGET_TARGET] = {
  'type' => 'app-extension',
  'platform' => 'watchOS',
  'sources' => [{ 'path' => WIDGET_SOURCE_PATH }],
  'info' => {
    'path' => "#{WIDGET_TARGET}/Info.plist",
    'properties' => {
      'CFBundleDisplayName' => 'Nuvo',
      'CFBundleShortVersionString' => short_version,
      'CFBundleVersion' => short_version,
      'NSExtension' => {
        'NSExtensionPointIdentifier' => 'com.apple.widgetkit-extension'
      }
    }
  },
  'settings' => {
    'base' => {
      'PRODUCT_NAME' => WIDGET_TARGET,
      'PRODUCT_BUNDLE_IDENTIFIER' => "#{watch_bundle_id}.complications",
      'WATCHOS_DEPLOYMENT_TARGET' => DEPLOYMENT_TARGET,
      'TARGETED_DEVICE_FAMILY' => '4',
      'SWIFT_VERSION' => '5.0',
      'SKIP_INSTALL' => 'YES',
      'ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES' => 'NO',
      'CODE_SIGN_STYLE' => 'Automatic',
      'GENERATE_INFOPLIST_FILE' => 'NO'
    }.tap { |s| s['DEVELOPMENT_TEAM'] = team if team && !team.empty? }
  },
  'dependencies' => [
    { 'sdk' => 'SwiftUI.framework' },
    { 'sdk' => 'WidgetKit.framework' }
  ]
}

# Embedding — and why it can't be a dependency.
#
# The obvious shape is `dependencies: [{target: NuvoWatch, embed: true}]`, and
# it is wrong here. `tauri ios build` drives xcodebuild with an explicit
# `-sdk .../iPhoneOS<ver>.sdk`, and a command-line -sdk overrides EVERY target's
# own SDKROOT. A watch app that is a build dependency of the iOS app therefore
# compiles against the iOS SDK, where WCSessionDelegate has different
# requirements (sessionDidBecomeInactive/sessionDidDeactivate are iOS-only) and
# the watchOS SwiftUI surface isn't available. That reddened CI run 31719213175,
# and no target-level setting can win against a command-line -sdk.
#
# So there is no dependency edge at all. scripts/ios-watch-build.sh builds
# NuvoWatch on its own against the watchOS SDK, and the script phase below
# copies the finished product in during the app's build. Tauri never compiles
# it, so Tauri's SDK cannot reach it.
app_target['dependencies'] ||= []
app_target['dependencies'].reject! { |d| d.is_a?(Hash) && d['target'] == TARGET_NAME }

embed_phase = 'Embed Nuvo Watch'
app_target['postBuildScripts'] ||= []
app_target['postBuildScripts'].reject! { |s| s.is_a?(Hash) && s['name'] == embed_phase }
app_target['postBuildScripts'] << {
  'name' => embed_phase,
  # Never skipped: the input lives outside the project, so Xcode's dependency
  # analysis can't see it and a cached "up to date" would silently ship an app
  # with no watch inside it.
  'basedOnDependencyAnalysis' => false,
  'script' => <<~SH
    set -euo pipefail

    # The location is DERIVED, not inherited. A script phase does not see the
    # environment of whatever invoked xcodebuild — the first attempt exported
    # NUVO_WATCH_APP from the workflow step and this phase still logged it as
    # unset, so the IPA shipped with no watch app (run 31721460405). SRCROOT is
    # src-tauri/gen/apple, and ios-watch-build.sh always writes its product to
    # build/watch/Products underneath it. The env var stays as an override for
    # anyone building the watch app somewhere else.
    WATCH_APP="${NUVO_WATCH_APP:-${SRCROOT}/build/watch/Products/NuvoWatch.app}"

    # Absent is the normal case for `tauri ios dev` — no watch app was built.
    # A release that *expected* one is caught by the IPA check in the workflow,
    # which is the right place for it: only that step knows what was intended.
    if [ ! -d "$WATCH_APP" ]; then
      echo "note: no watch app at $WATCH_APP — building without it"
      exit 0
    fi

    DEST="${TARGET_BUILD_DIR}/${CONTENTS_FOLDER_PATH}/Watch"
    NAME="$(basename "$WATCH_APP")"
    mkdir -p "$DEST"
    rm -rf "${DEST:?}/${NAME}"
    cp -R "$WATCH_APP" "$DEST/"

    # Re-sign with the host app's identity so the nested bundle matches the
    # archive it now lives in. --preserve-metadata keeps the watch app's OWN
    # identifier and entitlements, which are not the phone app's.
    if [ "${CODE_SIGNING_REQUIRED:-YES}" = "YES" ] && [ -n "${EXPANDED_CODE_SIGN_IDENTITY:-}" ]; then
      codesign --force --timestamp=none \\
        --preserve-metadata=identifier,entitlements,flags \\
        --sign "$EXPANDED_CODE_SIGN_IDENTITY" "${DEST}/${NAME}"
      echo "ios-watch: embedded and re-signed ${NAME}"
    else
      echo "ios-watch: embedded ${NAME} (unsigned build)"
    fi
  SH
}

File.write(SPEC_PATH, spec.to_yaml)
FileUtils.mkdir_p(File.join(PROJECT_DIR, TARGET_NAME))

puts "ios-watch: added #{TARGET_NAME} (#{watch_bundle_id}, v#{short_version}) to #{app_name}"

ok = system('xcodegen', 'generate', '--no-env', '--spec', SPEC_PATH)
fail!('xcodegen failed to regenerate the project') unless ok

puts 'ios-watch: regenerated the Xcode project'
