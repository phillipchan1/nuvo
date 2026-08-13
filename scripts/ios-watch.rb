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
  # Because the type is plain `application`, XcodeGen will not infer the "Embed
  # Watch Content" destination — which is exactly why the app target's dependency
  # below names `copy:` explicitly. `supportedDestinations` is not an option
  # either: XcodeGen refuses watchOS there.
  'type' => 'application',
  'platform' => 'watchOS',
  'sources' => [{ 'path' => SOURCE_PATH }],
  'info' => {
    'path' => "#{TARGET_NAME}/Info.plist",
    'properties' => {
      'CFBundleDisplayName' => 'Nuvo',
      'CFBundleShortVersionString' => short_version,
      'CFBundleVersion' => short_version,
      # Single-target watch app (Xcode 14+): no companion watchkit2-extension,
      # WKApplication rather than the retired WKWatchKitApp.
      'WKApplication' => true,
      'WKCompanionAppBundleIdentifier' => app_bundle_id
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
    { 'sdk' => 'WatchConnectivity.framework' }
  ]
}

# Embed it in the app. A watch app rides inside the iOS .app at
# Payload/Nuvo.app/Watch/Nuvo.app — one IPA, one App Store record, no separate
# submission. The explicit `copy:` is belt-and-braces: XcodeGen infers the Watch
# destination from the product type, but naming it means a wrong inference shows
# up as a build error rather than as an archive that silently has no watch app.
app_target['dependencies'] ||= []
already = app_target['dependencies'].any? { |d| d.is_a?(Hash) && d['target'] == TARGET_NAME }
unless already
  app_target['dependencies'].unshift(
    {
      'target' => TARGET_NAME,
      'embed' => true,
      'copy' => { 'destination' => 'productsDirectory', 'subpath' => '$(CONTENTS_FOLDER_PATH)/Watch' }
    }
  )
end

File.write(SPEC_PATH, spec.to_yaml)
FileUtils.mkdir_p(File.join(PROJECT_DIR, TARGET_NAME))

puts "ios-watch: added #{TARGET_NAME} (#{watch_bundle_id}, v#{short_version}) to #{app_name}"

ok = system('xcodegen', 'generate', '--no-env', '--spec', SPEC_PATH)
fail!('xcodegen failed to regenerate the project') unless ok

puts 'ios-watch: regenerated the Xcode project'
