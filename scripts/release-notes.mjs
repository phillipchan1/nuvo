#!/usr/bin/env node
// Turn raw git commit subjects into a short, human-readable changelog.
//
// Reads commit lines from stdin (one "- subject" per line), asks the configured
// OpenAI model to rewrite them as friendly, user-facing release notes, and
// prints Markdown to stdout. This is BEST-EFFORT: on any problem (no API key,
// API error, empty input/output, or notes that still read like engineering)
// it prints the quiet generic line, so the desktop release pipeline never
// fails over release notes and never ships commit-speak into the update prompt.
// Used by .github/workflows/release.yml.
//
// The quiet line and the engineering filter must stay in sync with
// src/lib/releaseNotesVoice.ts (the app hides the same notes at display time).

import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-nano'
const KEY = process.env.OPENAI_API_KEY

/** Keep in sync with src/lib/releaseNotesVoice.ts */
export const GENERIC_NOTES = '✨ A few quiet improvements behind the scenes.'

const GENERIC_LINE =
  /^(?:[-*•]\s*)?(?:✨\s*)?(?:minor improvements|a little polish|a few quiet improvements|automated build from)\b/i

const CONVENTIONAL =
  /^(?:feat|fix|chore|docs|refactor|test|build|ci|style|perf)(?:\([^)]*\))?:/i

const ENGINEERING =
  /\b(?:date bounds|reconcil(?:e|iation)|placeholderData|prefetch|RLS\b|webhook|debounce|harness|type-?cast|\bcast(?:ing|ed)\b|schema|migration|edge function|CORS\b|payload|backdrop blur|re-?check(?:ing)? the whole|FullCalendar|webview|service worker|TypeScript|Tailwind|TanStack|minisign|notariz|codesign)\b/i

const FILEISH = /(?:^|\s)(?:src|supabase|scripts|tests)\/|\.\b(?:tsx?|mjs|jsx?|yml|sql)\b/i

function bodyOf(line) {
  return line.replace(/^[-*•]\s*/, '').replace(/^[✨🎉]\s*/, '').trim()
}

function isQuietLine(line) {
  const body = bodyOf(line)
  return !body || GENERIC_LINE.test(line) || GENERIC_LINE.test(body)
}

function isEngineeringLine(line) {
  const body = bodyOf(line)
  return CONVENTIONAL.test(body) || ENGINEERING.test(body) || FILEISH.test(body)
}

/** Drop unclear / internal bullets. Empty → the quiet line. */
export function finalizeNotes(text) {
  if (!text) return GENERIC_NOTES
  const kept = []
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim()
    if (!line || isQuietLine(line) || isEngineeringLine(line)) continue
    kept.push(/^[-*•]\s/.test(line) ? line.replace(/^[•*]\s/, '- ') : `- ${line}`)
  }
  return kept.length > 0 ? kept.join('\n') : GENERIC_NOTES
}

export const SYSTEM =
  'You write Nuvo\'s in-app "What\'s new" for someone who uses the app to plan their day. You output ONLY the finished notes. Never ask a question, never address the reader, never explain what you are doing, never request more input — the commits are already provided.'

export function userPrompt(raw) {
  return `Rewrite the COMMITS below into Nuvo's "What's new". Nuvo is a calm, single-user daily planner — a schedule, tasks, projects, and an AI assistant.

The person reading this is about to restart the app. They should know what they GET: a new thing they can do, a bug they would have hit that is gone, or a change they would spot on a screen they use.

Voice: warm, plain, a little playful — a thoughtful friend, never corporate, never technical.

HARD RULE — when it isn't clear, stay quiet:
If you cannot name the benefit in words a non-developer would recognize, do not guess and do not translate the commit into friendlier jargon. Output EXACTLY this one line and nothing else:
${GENERIC_NOTES}

That includes: sync internals, performance plumbing, refactors, tests, CI, build & release tooling (including these notes and the auto-updater), dependency bumps, developer docs, prompts, scripts, and any change whose user effect you are inferring rather than reading plainly.

Include a bullet ONLY when all of these are true:
- A person using Nuvo would notice it (schedule, calendar, capture, tasks, projects, the week, the assistant, reminders, search, settings, appearance, sign-in, billing).
- You can say what they get without naming how it was built.
- The sentence would still make sense to someone who has never seen a git commit.

Rewrite as the thing they get, not the mechanism:

BAD: "Prevented empty date bounds from being sent during sync"
→ ${GENERIC_NOTES}

BAD: "Streamlined the calendar reconciliation so everything feels snappier"
→ ${GENERIC_NOTES}
("snappier" dressed over plumbing is still plumbing)

BAD: "Smooth out the schedule so it doesn't re-check the whole calendar grid"
→ ${GENERIC_NOTES}

BAD: "Fixed a task display/casting issue in the year harness"
→ ${GENERIC_NOTES}

BAD: "Your calendar now says the year only once (Chrome-only)"
→ "- The year on the calendar isn't repeated anymore."
(drop engine and browser names)

BAD: "Subscription now works with Stripe and StoreKit"
→ "- Subscriptions are more reliable on Mac and iPhone."
(drop vendor names; if you aren't sure that's what they get, use the quiet line)

GOOD: "- Tap empty time on the day view to capture something right there."
GOOD: "- There's a Join button when a meeting has a link, so you can hop on faster."
GOOD: "- Dragging things on the Schedule feels instant again."
GOOD: "- Sign in with Apple is ready when you want it."

Format:
- A SINGLE FLAT LIST. No headings, no sections, no grouping. Each bullet starts with "- ".
- One short sentence per change, in plain language. What they get, not how we built it.
- No jargon, no commit prefixes (feat:/fix:), no file names, no SHAs, no engine names (Chrome, Tauri, React, Stripe, StoreKit).
- At most ~5 bullets. Notable new features may lead with 🎉 or ✨; small fixes stay emoji-free.
- Plain text only (these notes render as plain text — no Markdown headings, bold, or links).

If nothing clear survives, output EXACTLY this one line and nothing else:
${GENERIC_NOTES}

COMMITS:
${raw}

Now output ONLY the changelog — no preamble, no questions, no commentary.`
}

function looksConversational(text) {
  return (
    /\b(sure thing|paste|let me know|go ahead|i'?ll rewrite|raw git commit|you want me|happy to|here'?s what|could you)\b/i.test(text) ||
    /\?\s*$/.test(text)
  )
}

async function readStdin(stream) {
  let data = ''
  for await (const chunk of stream) data += chunk
  return data
}

async function generate(raw, key, fetchImpl = fetch) {
  const body = {
    model: MODEL,
    max_completion_tokens: 2000,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userPrompt(raw) },
    ],
  }
  // gpt-5/o-series/nano are reasoning models: cap hidden reasoning so the token
  // budget goes to the actual notes.
  if (/nano|gpt-5|^o\d/i.test(MODEL)) body.reasoning_effort = 'low'

  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('empty completion')
  if (looksConversational(text)) throw new Error(`model returned conversational text, not notes: ${text.slice(0, 80)}`)
  return finalizeNotes(text)
}

export async function run(raw, { key = KEY, fetchImpl = fetch } = {}) {
  const input = (raw || '').trim()
  if (!input || !key) return GENERIC_NOTES
  try {
    return await generate(input, key, fetchImpl)
  } catch (err) {
    process.stderr.write(`[release-notes] falling back to quiet notes: ${err}\n`)
    return GENERIC_NOTES
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) {
  const raw = (await readStdin(process.stdin)).trim()
  process.stdout.write(await run(raw))
}
