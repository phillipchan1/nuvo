#!/usr/bin/env node
// Turn raw git commit subjects into a short, human-readable changelog.
//
// Reads commit lines from stdin (one "- subject" per line), asks the configured
// OpenAI model to rewrite them as friendly, user-facing release notes, and
// prints Markdown to stdout. This is BEST-EFFORT: on any problem (no API key,
// API error, empty input/output) it falls back to printing a lightly-cleaned
// version of the raw commit list, so the desktop release pipeline never fails
// over release notes. Used by .github/workflows/release.yml.

import process from 'node:process'

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-nano'
const KEY = process.env.OPENAI_API_KEY

async function readStdin(stream) {
  let data = ''
  for await (const chunk of stream) data += chunk
  return data
}

const raw = (await readStdin(process.stdin)).trim()

// Best-effort relevance even without the model: drop commits whose conventional
// type is internal (chore/docs/refactor/test/build/ci/style), then strip the
// remaining prefixes so it reads friendlier. If nothing user-facing is left,
// emit the same generic line the model uses.
function fallback() {
  const INTERNAL = /^-\s*(?:chore|docs|refactor|test|build|ci|style)(\([^)]*\))?:/i
  const kept = raw
    .split('\n')
    .filter((l) => l.trim() && !INTERNAL.test(l))
    .map((l) => l.replace(/^-\s*(?:feat|fix|perf)(\([^)]*\))?:\s*/i, '- '))
  process.stdout.write(kept.join('\n') || '✨ Minor improvements and behind-the-scenes fixes.')
}

if (!raw || !KEY) {
  fallback()
  process.exit(0)
}

// System: a strict transformer, NOT a chat assistant. Small models (gpt-5.4-nano)
// will otherwise reply conversationally ("Sure thing — paste the commits…") and
// that text leaks into a release. Forbid questions/addressing the reader outright.
const system =
  'You are a release-notes generator. You transform git commit messages into a finished changelog and output ONLY that changelog. Never ask a question, never address the reader, never explain what you are doing, never request more input — the commits are already provided.'

// User: the rules AND the commits in one message, with the commits clearly
// delimited so the model can't mistake them for absent.
const instructions = `Rewrite the COMMITS below into Nuvo's release notes. Nuvo is a calm, single-user daily planner — a schedule, tasks, projects, and an AI assistant on one warm surface.

Voice: warm, friendly, a little playful — like a thoughtful friend telling you what's new, never corporate.

Rules:
- ONLY include changes a person USING the app would actually notice: the schedule & calendar, capturing/planning tasks, projects & initiatives, the weekly plan, the Nuvo assistant, reminders, search, sync, settings, appearance, and other in-app features.
- OMIT everything internal — refactors, tests, CI, build & release tooling (including these release notes and the auto-updater plumbing themselves), dependency or version bumps, developer docs, and tweaks to internal prompts/scripts. When in doubt whether users would notice, LEAVE IT OUT.
- A SINGLE FLAT LIST of bullets. No headings, no sections, no grouping. Each bullet starts with "- ".
- One short, friendly bullet per user-visible change, in plain language. No jargon, no commit prefixes (feat:/fix:), no file names, no SHAs.
- For a notable/major new feature, lead that bullet with a fitting emoji and celebrate a little (e.g. 🎉, ✨). Keep small fixes calm and emoji-free.
- At most ~5 bullets. Plain text only (the notes render as plain text — no Markdown headings, bold, or links).
- If NOTHING is user-facing (e.g. the build is all internal/tooling), output EXACTLY this one line and nothing else: ✨ Minor improvements and behind-the-scenes fixes.

COMMITS:
${raw}

Now output ONLY the changelog bullets — no preamble, no questions, no commentary.`

// Reject a response that's clearly the model chatting instead of producing notes,
// so it falls back to the clean commit list rather than shipping the chatter.
function looksConversational(text) {
  return (
    /\b(sure thing|paste|let me know|go ahead|i'?ll rewrite|raw git commit|you want me|happy to|here'?s what|could you)\b/i.test(text) ||
    /\?\s*$/.test(text)
  )
}

try {
  const body = {
    model: MODEL,
    max_completion_tokens: 2000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: instructions },
    ],
  }
  // gpt-5/o-series/nano are reasoning models: cap hidden reasoning so the token
  // budget goes to the actual notes.
  if (/nano|gpt-5|^o\d/i.test(MODEL)) body.reasoning_effort = 'low'

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('empty completion')
  if (looksConversational(text)) throw new Error(`model returned conversational text, not notes: ${text.slice(0, 80)}`)
  process.stdout.write(text)
} catch (err) {
  process.stderr.write(`[release-notes] falling back to raw commits: ${err}\n`)
  fallback()
}
