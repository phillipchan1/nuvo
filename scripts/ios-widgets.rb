#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds the WidgetKit extension (src-tauri/ios/NuvoWidgets) to the Xcode project
# `tauri ios init` generates, then regenerates the project so Xcode sees it.
#
# Why patch instead of commit a project: `gen/apple/` is thrown away and rebuilt
# on every CI run, and Tauri has no hook for extra targets. What it does leave
# behind is `project.yml` — cargo-mobile2 renders it from a template and runs
# `xcodegen generate --no-env --spec project.yml` against it (see
# cargo-mobile2/src/apple/project.rs). So we edit that spec, re-run the same
# command, and the extension arrives through Tauri's own pipeline rather than
# beside it. `tauri ios build` re-uses an existing project (its `ensure_init`
# only regenerates when the app name changed), so the patch survives the build.
#
# Idempotent — safe to re-run over an already-patched project.
# Set NUVO_IOS_WIDGETS=0 to skip it entirely and ship the plain app; nothing
# else in the build depends on the extension.
#
# Ruby (not Python) because macOS and the GitHub runners both ship it with YAML
# in the stdlib, so this needs no pip install in front of the iOS build.

require 'fileutils'
require 'json'
require 'yaml'

ROOT = File.expand_path('..', __dir__)
PROJECT_DIR = File.join(ROOT, 'src-tauri', 'gen', 'apple')
SPEC_PATH = File.join(PROJECT_DIR, 'project.yml')

TARGET_NAME = 'NuvoWidgets'
# Sources live outside gen/apple (which is gitignored) so the Swift is committed
# and reviewable; XcodeGen is happy to reference a path above the project.
SOURCE_PATH = '../../ios/NuvoWidgets'
# Lock-screen accessory families are iOS 16+. The app itself still targets 15.0;
# an extension may sit higher than its host, it just won't install below this.
DEPLOYMENT_TARGET = '16.0'

def fail!(message)
  warn "ios-widgets: #{message}"
  exit 1
end

fail!("no Xcode project at #{PROJECT_DIR} — run `npm run tauri ios init -- --ci` first") unless File.directory?(PROJECT_DIR)
fail!("no project.yml at #{SPEC_PATH} — cargo-mobile2 should have written one") unless File.file?(SPEC_PATH)

swift_dir = File.join(ROOT, 'src-tauri', 'ios', 'NuvoWidgets')
fail!("missing widget sources at #{swift_dir}") if Dir.glob(File.join(swift_dir, '*.swift')).empty?

spec = YAML.safe_load(File.read(SPEC_PATH), aliases: true)
targets = spec['targets'] || fail!('project.yml has no targets')

# The app target is the one Tauri generated: `<name>_iOS`, an application.
app_name, app_target = targets.find { |_, t| t.is_a?(Hash) && t['type'] == 'application' && t['platform'] == 'iOS' }
fail!('could not find the iOS application target in project.yml') if app_target.nil?

# Bundle id and team follow the app's, so the extension can never be signed for
# a different identity than the app that embeds it.
app_settings = spec.dig('settingGroups', 'app', 'base') || {}
app_bundle_id = app_settings['PRODUCT_BUNDLE_IDENTIFIER'] || spec.dig('options', 'bundleIdPrefix')
fail!('could not read the app bundle identifier from project.yml') if app_bundle_id.nil?
team = app_settings['DEVELOPMENT_TEAM'] || ENV['APPLE_DEVELOPMENT_TEAM']

# App Store validation rejects an extension whose version strings differ from
# its host app's. The app's short version is stamped from tauri.conf.json and its
# build number from the CLI's --build-number, so compose the same pair here.
# (`xcrun agvtool new-version -all`, which Tauri runs at archive time, then
# rewrites CFBundleVersion across every target — this keeps us correct either way.)
tauri_conf = JSON.parse(File.read(File.join(ROOT, 'src-tauri', 'tauri.conf.json')))
short_version = tauri_conf['version'] || '0.1.0'
build_number = ENV['BUILD_NUMBER'].to_s.strip
bundle_version = build_number.empty? ? short_version : "#{short_version}.#{build_number}"

targets[TARGET_NAME] = {
  'type' => 'app-extension',
  'platform' => 'iOS',
  'sources' => [{ 'path' => SOURCE_PATH }],
  'info' => {
    'path' => "#{TARGET_NAME}/Info.plist",
    'properties' => {
      'CFBundleDisplayName' => 'Nuvo',
      'CFBundleShortVersionString' => short_version,
      'CFBundleVersion' => bundle_version,
      'NSExtension' => {
        'NSExtensionPointIdentifier' => 'com.apple.widgetkit-extension'
      }
    }
  },
  'settings' => {
    'base' => {
      'PRODUCT_NAME' => TARGET_NAME,
      'PRODUCT_BUNDLE_IDENTIFIER' => "#{app_bundle_id}.widgets",
      'IPHONEOS_DEPLOYMENT_TARGET' => DEPLOYMENT_TARGET,
      'TARGETED_DEVICE_FAMILY' => '1,2',
      'SWIFT_VERSION' => '5.0',
      'SKIP_INSTALL' => 'YES',
      # The host app already embeds the Swift runtime; doing it twice is a
      # rejected build ("nested bundle contains disallowed frameworks").
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

# Embed it in the app. XcodeGen turns an app-extension dependency into the
# "Embed App Extensions" copy phase; without this the extension builds and is
# never shipped, which looks exactly like a widget that won't appear.
app_target['dependencies'] ||= []
already = app_target['dependencies'].any? { |d| d.is_a?(Hash) && d['target'] == TARGET_NAME }
app_target['dependencies'].unshift({ 'target' => TARGET_NAME, 'embed' => true }) unless already

File.write(SPEC_PATH, spec.to_yaml)
FileUtils.mkdir_p(File.join(PROJECT_DIR, TARGET_NAME))

puts "ios-widgets: added #{TARGET_NAME} (#{app_bundle_id}.widgets, v#{short_version} build #{bundle_version}) to #{app_name}"

# Same invocation cargo-mobile2 uses, so the regenerated project matches what
# `tauri ios init` would have produced — plus our target.
ok = system('xcodegen', 'generate', '--no-env', '--spec', SPEC_PATH)
fail!('xcodegen failed to regenerate the project') unless ok

puts 'ios-widgets: regenerated the Xcode project'
