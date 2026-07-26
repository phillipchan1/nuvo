#!/usr/bin/env node
// Assemble a cumulative, newest-first changelog from the PUBLIC releases repo's
// GitHub Releases (each release body is the human-readable notes we generate),
// prepend the build currently being published, and write public/changelog.json.
//
// That file is copied into dist/ by Vite and bundled into the app, so Settings
// can read it SAME-ORIGIN (no CORS, no extra Tauri plugin, works offline). Since
// the app auto-updates aggressively, a freshly-installed build always carries the
// full history up through the version the user just landed on.
//
// Best-effort: if the GitHub API is unreachable it still writes at least the
// current entry, so a release never fails over the changelog.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import process from 'node:process'

const REPO = process.env.RELEASES_REPO || 'phillipchan1/nuvo-releases'
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const CURRENT_VERSION = process.env.APP_VERSION || ''
const CURRENT_DATE = process.env.PUB_DATE || ''
const MAX = 50
const OUT = 'public/changelog.json'

const tagToVersion = (t) => (t || '').replace(/^v/, '')

function currentNotes() {
  try {
    return readFileSync('RELEASE_NOTES.md', 'utf8').trim()
  } catch {
    return ''
  }
}

async function fetchReleases() {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'nuvo-changelog' }
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=${MAX}`, { headers })
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
  const arr = await res.json()
  return arr
    .filter((r) => !r.draft)
    .map((r) => ({
      version: tagToVersion(r.tag_name),
      date: r.published_at || r.created_at || '',
      notes: (r.body || '').trim(),
    }))
}

const versions = []
// The build being published isn't a GitHub release yet — prepend it ourselves.
if (CURRENT_VERSION) versions.push({ version: CURRENT_VERSION, date: CURRENT_DATE, notes: currentNotes() })

try {
  for (const v of await fetchReleases()) versions.push(v)
} catch (err) {
  process.stderr.write(`[changelog] could not fetch releases, writing current only: ${err}\n`)
}

// Dedupe by version (the current entry wins over any API duplicate). The GitHub
// API's release order isn't reliable, but our versions are monotonic
// <major>.<minor>.<run> — sort by that run number descending so it's always
// strictly newest-first.
const runOf = (v) => parseInt(v.split('.').pop() || '0', 10) || 0
const seen = new Set()
const deduped = versions
  .filter((v) => v.version && !seen.has(v.version) && seen.add(v.version))
  .sort((a, b) => runOf(b.version) - runOf(a.version))
  .slice(0, MAX)

mkdirSync('public', { recursive: true })
writeFileSync(OUT, JSON.stringify({ updated: CURRENT_DATE, versions: deduped }, null, 2) + '\n')
process.stderr.write(`[changelog] wrote ${deduped.length} versions to ${OUT}\n`)
