#!/usr/bin/env ruby
# frozen_string_literal: true

# Gets `com.apple.developer.applesignin` into the generated iOS app's
# entitlements — the entitlement Sign in with Apple needs, and which App Store
# guideline 4.8 makes non-optional for Nuvo (we offer Google Sign-In, which
# forfeits the "own account system only" exemption).
#
# Same approach as ios-widgets.rb / ios-watch.rb, and for the same reason:
# `gen/apple/` is thrown away and rebuilt on every CI run, but cargo-mobile2
# leaves `project.yml` behind and renders the project from it with
# `xcodegen generate`. So we edit that spec and re-run the same command, and the
# entitlement arrives through Tauri's own pipeline rather than beside it.
# Idempotent — safe to re-run over an already-patched project.
#
# ⚠️ NOT via `settings.base.CODE_SIGN_ENTITLEMENTS`. The first version of this
# script set exactly that, and it looked like it worked — the key landed in
# project.yml, xcodegen reported success, and the built project still had
#     CODE_SIGN_ENTITLEMENTS = nuvo_iOS/nuvo_iOS.entitlements
# pointing at Tauri's own file, which is an empty `<dict/>`. XcodeGen's
# `targets.<t>.entitlements` key OWNS that build setting and overwrites
# whatever `settings` says. A build would have signed cleanly, shipped without
# the entitlement, and been rejected under 4.8 — with nothing anywhere saying
# why. So we merge our keys into `entitlements.properties` instead, which is
# the input xcodegen actually renders the file from, and then VERIFY the
# rendered file rather than trusting the generator.
#
# src-tauri/ios/Nuvo.entitlements stays the committed, reviewable source of
# truth; this script is only the courier.
#
# BEFORE THIS CAN BUILD: "Sign In with Apple" must be enabled on the App ID
# (day.nuvo.app) in the Apple Developer portal, or code signing fails with
# "Provisioning profile doesn't include the com.apple.developer.applesignin
# entitlement". docs/apple-sign-in.md has the steps. Set NUVO_IOS_SIWA=0
# to ship without it — but an App Store build without it is a 4.8 rejection,
# so that switch is for unblocking a local build, not for releases.

require 'json'
require 'yaml'

ROOT = File.expand_path('..', __dir__)
PROJECT_DIR = File.join(ROOT, 'src-tauri', 'gen', 'apple')
SPEC_PATH = File.join(PROJECT_DIR, 'project.yml')
ENTITLEMENTS_SRC = File.join(ROOT, 'src-tauri', 'ios', 'Nuvo.entitlements')

# Where xcodegen writes the target's entitlements when the spec doesn't already
# name a path. Relative to gen/apple/, like every other path in project.yml.
DEFAULT_ENTITLEMENTS_REL = 'nuvo_iOS/nuvo_iOS.entitlements'

def fail!(message)
  warn "ios-siwa: #{message}"
  exit 1
end

unless File.file?(SPEC_PATH)
  fail!("no project.yml at #{SPEC_PATH} — run `npm run tauri ios init -- --ci` first")
end
fail!("missing #{ENTITLEMENTS_SRC}") unless File.file?(ENTITLEMENTS_SRC)

# Ruby has no plist parser in stdlib; `plutil` ships with macOS, which is the
# only place this runs.
# No shell: paths go straight to plutil as argv, so nothing has to be escaped.
def read_plist(path)
  json = IO.popen(['plutil', '-convert', 'json', '-o', '-', path], &:read)
  return nil unless $?.success?
  JSON.parse(json)
rescue JSON::ParserError
  nil
end

wanted = read_plist(ENTITLEMENTS_SRC)
fail!("could not read #{ENTITLEMENTS_SRC} as a plist") if wanted.nil?
fail!("#{ENTITLEMENTS_SRC} is not a plist dictionary") unless wanted.is_a?(Hash)
fail!("#{ENTITLEMENTS_SRC} declares nothing") if wanted.empty?

spec = YAML.safe_load(File.read(SPEC_PATH), aliases: true)
targets = spec['targets'] || fail!('project.yml has no targets')

app_name, app_target = targets.find { |_, t| t.is_a?(Hash) && t['type'] == 'application' && t['platform'] == 'iOS' }
fail!('could not find the iOS application target in project.yml') if app_target.nil?

entitlements = (app_target['entitlements'] ||= {})
entitlements['path'] ||= DEFAULT_ENTITLEMENTS_REL
properties = (entitlements['properties'] ||= {})

# Merge, never clobber. If something else ever declares one of these keys with a
# different value, say so rather than quietly winning — the other declaration is
# presumably load-bearing too.
changed = false
wanted.each do |key, value|
  existing = properties[key]
  if existing.nil?
    properties[key] = value
    changed = true
  elsif existing != value
    fail!(
      "#{app_name} already declares #{key} as #{existing.inspect}, and " \
      "#{ENTITLEMENTS_SRC} wants #{value.inspect}. Reconcile them by hand."
    )
  end
end

# A leftover from the version of this script that set the wrong key. xcodegen
# ignores it, but leaving it in the spec is an invitation to believe it.
if app_target.dig('settings', 'base')&.key?('CODE_SIGN_ENTITLEMENTS')
  app_target['settings']['base'].delete('CODE_SIGN_ENTITLEMENTS')
  changed = true
  puts 'ios-siwa: removed a stale settings.base.CODE_SIGN_ENTITLEMENTS (xcodegen ignores it)'
end

if changed
  File.write(SPEC_PATH, spec.to_yaml)
  puts "ios-siwa: merged #{wanted.keys.join(', ')} into #{app_name}'s entitlements"
else
  puts "ios-siwa: #{app_name} already declares #{wanted.keys.join(', ')}"
end

# Same invocation cargo-mobile2 uses, so the regenerated project matches what
# `tauri ios init` would have produced — plus our entitlements.
ok = system('xcodegen', 'generate', '--no-env', '--spec', SPEC_PATH)
fail!('xcodegen failed to regenerate the project') unless ok

# Verify what was actually rendered, not what we asked for. This check is the
# whole point: the previous approach passed every step above and still produced
# a project with an empty entitlements file.
rendered_path = File.join(PROJECT_DIR, entitlements['path'])
fail!("xcodegen did not write #{rendered_path}") unless File.file?(rendered_path)

rendered = read_plist(rendered_path)
fail!("could not read the rendered #{rendered_path}") if rendered.nil?
missing = wanted.reject { |key, value| rendered[key] == value }
unless missing.empty?
  fail!(
    "#{rendered_path} is missing #{missing.keys.join(', ')} after generation. " \
    'A build from this project would sign cleanly and be rejected under 4.8.'
  )
end

# And that the target actually points at the file we just checked.
pbxproj = File.join(PROJECT_DIR, 'nuvo.xcodeproj', 'project.pbxproj')
if File.file?(pbxproj) && !File.read(pbxproj).include?("CODE_SIGN_ENTITLEMENTS = #{entitlements['path']}")
  fail!("#{app_name} does not point at #{entitlements['path']} in the generated project")
end

puts "ios-siwa: #{entitlements['path']} carries #{wanted.keys.join(', ')}"
