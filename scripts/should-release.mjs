#!/usr/bin/env node
// Decide whether the desktop app should rebuild for commits since a SHA.
//
// Used by the Release workflow's cheap gate job. Prints exactly one of:
//   SHIP <reason>
//   SKIP <reason>
// …to stdout (the gate job parses the first word). Always exits 0 on a
// decisive answer; exits 1 only if usage is wrong. On AI failure, prints SKIP
// so the daily cron / [release] / manual dispatch remain the backstops —
// never burn a macOS runner because the model hiccuped.
//
// Decision order:
//   1. Heuristic — obvious user-facing fixes touching the app → SHIP
//   2. Heuristic — only internal / marketing / docs paths → SKIP
//   3. OpenAI (same nano model as release-notes) — gray area → SHIP|SKIP
//   4. No key / API error → SKIP
//
// Usage: node scripts/should-release.mjs <since-sha>

import { execFileSync } from 'node:child_process'
import process from 'node:process'

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-nano'
const KEY = process.env.OPENAI_API_KEY
const since = process.argv[2]

if (!since || !/^[0-9a-f]{7,40}$/i.test(since)) {
  process.stderr.write('usage: node scripts/should-release.mjs <since-sha>\n')
  process.exit(1)
}

function decide(kind, reason) {
  process.stdout.write(`${kind} ${reason}\n`)
  process.exit(0)
}

// Paths that ship inside the Tauri / SPA bundle (or change how it's built).
const APP_PATH =
  /^(src\/|src-tauri\/|public\/|index\.html$|package\.json$|package-lock\.json$|vite\.config|tsconfig|tailwind|postcss|components\.json)/

// Paths a desktop user never sees.
const INTERNAL_PATH =
  /^(docs\/|marketing\/|\.github\/|\.claude\/|\.cursor\/|supabase\/|scripts\/|readme\.md$|CLAUDE\.md$)/i

// Subjects that are almost always worth a same-day desktop build when they
// touch app code — correctness / data-quality / user-visible bugs.
const FIXISH =
  /\b(fix|bugfix|hotfix|regress|corrupt|duplicat|data[\s-]?qualit|incorrect|wrong)\b/i

// Conventional types that never warrant a desktop rebuild on their own.
const INTERNAL_TYPE = /^(chore|docs|refactor|test|build|ci|style)(\([^)]*\))?:/i

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

// since-sha may be missing locally (shallow clone / rewritten history) — treat
// as "unknown range" and fall through to AI / SKIP rather than crashing the gate.
let rangeOk = true
try {
  git(['cat-file', '-e', `${since}^{commit}`])
} catch {
  rangeOk = false
}

if (!rangeOk) {
  decide('SKIP', `since-sha ${since.slice(0, 7)} not in this clone — wait for cron or [release]`)
}

const head = git(['rev-parse', 'HEAD'])
if (since === head || git(['rev-list', '--count', `${since}..HEAD`]) === '0') {
  decide('SKIP', 'no new commits since last release')
}

const raw = git([
  'log',
  `${since}..HEAD`,
  '--no-merges',
  '--name-only',
  '--pretty=format:===%s',
])

/** @type {{ subject: string, files: string[] }[]} */
const commits = []
let current = null
for (const line of raw.split('\n')) {
  if (line.startsWith('===')) {
    current = { subject: line.slice(3).trim(), files: [] }
    commits.push(current)
    continue
  }
  if (current && line.trim()) current.files.push(line.trim())
}

if (commits.length === 0) {
  decide('SKIP', 'no non-merge commits since last release')
}

function touchesApp(files) {
  return files.some((f) => APP_PATH.test(f))
}
function onlyInternal(files) {
  return files.length > 0 && files.every((f) => INTERNAL_PATH.test(f) || !APP_PATH.test(f))
}

// 1. Heuristic SHIP — fix-like subject + app paths.
for (const c of commits) {
  if (FIXISH.test(c.subject) && touchesApp(c.files)) {
    decide('SHIP', `heuristic: "${c.subject}" touches app code`)
  }
}

// 2. Heuristic SKIP — every commit is internal-typed or only non-app paths.
const allInternal = commits.every(
  (c) => INTERNAL_TYPE.test(c.subject) || onlyInternal(c.files) || !touchesApp(c.files),
)
if (allInternal) {
  decide('SKIP', 'heuristic: no app-facing commits since last release')
}

// 3. Gray area — ask the model.
const digest = commits
  .map((c) => {
    const files = c.files.slice(0, 12).join(', ') || '(no files listed)'
    return `- ${c.subject}\n  files: ${files}`
  })
  .join('\n')

if (!KEY) {
  decide('SKIP', 'no OPENAI_API_KEY — leaving build for cron / [release] / manual')
}

const system =
  'You are a release gate for Nuvo\'s macOS desktop app. Answer with exactly one word on the first line: SHIP or SKIP. Optional short reason on the second line. Never ask a question.'

const user = `Nuvo is a personal daily planner (schedule, tasks, projects, weekly plan, AI assistant) shipped as a Tauri macOS app from the same SPA.

Should we cut a desktop release for the commits below (since the last published build)?

SHIP when a person USING the installed Mac app would notice: bug/data-quality fixes, planning or calendar behavior, capture, weekly ritual, sync, settings, appearance, or anything that changes what the app shows or does.

SKIP when the change is only docs, product decisions, marketing site, CI, refactors, tests, agent/edge prompts that don't change the SPA, or other internal tooling. When in doubt, SKIP — a daily cron can still batch later.

COMMITS:
${digest}

Reply SHIP or SKIP.`

try {
  const body = {
    model: MODEL,
    max_completion_tokens: 64,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }
  if (/nano|gpt-5|^o\d/i.test(MODEL)) body.reasoning_effort = 'low'

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const text = (json.choices?.[0]?.message?.content || '').trim()
  const first = text.split(/\s+/)[0]?.toUpperCase()
  if (first === 'SHIP' || first === 'SKIP') {
    const reason = text.split('\n').slice(1).join(' ').trim() || 'model decision'
    decide(first, `ai: ${reason}`)
  }
  throw new Error(`unparseable model reply: ${text.slice(0, 80)}`)
} catch (err) {
  process.stderr.write(`[should-release] ${err}\n`)
  decide('SKIP', 'ai failed — leaving build for cron / [release] / manual')
}
