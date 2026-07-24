# Handoff prompt — Nuvo marketing one-pager

Copy everything below the line into a **new agent chat** (with this repo open).

---

## Job

Build a **compelling one-page marketing website** for Nuvo inside the existing scaffold at `marketing/`. Replace the placeholder in `marketing/src/App.tsx`. Ship a finished page: copy, layout, motion, responsive behavior — not a wireframe.

Assess what the product actually is from this repo, then write marketing that is honest, sharp, and desirable. One page only (no blog, no pricing table unless a soft “coming soon / request access” is clearly needed).

## Product truth (start here, then dig)

Read before writing copy:

1. `readme.md` — positioning, core model, stack, flows summary
2. `docs/design-language.md` — Warm Paper / glass grammar (visual canon)
3. `docs/execution-flows.md` — vertical vs planner, rituals, Week as gate
4. Skim as needed: `docs/priorities-and-projects.md`, `docs/readiness-model.md`, `docs/commitment-model.md`, `docs/on-deck.md`
5. Run or screenshot the real app (`npm run dev` at repo root) for authentic product feel — Schedule + Domain are the reference screens

**What Nuvo is (facts, not slogans):**

- Single-user daily planner: GTD-style inbox + tasks + calendars on one planning surface
- Phase 1 of LifeOS; daily driver meant to replace Akiflow
- Core model: a scheduled task **is** a time block (one `tasks` row — no separate event entity for tasks)
- Calendars: Google (two-way + “Nuvo” mirror), Microsoft 365 (read-only), Apple/iCloud (two-way CalDAV), ICS
- Drag-and-drop time blocking; free-text capture (`parseCapture`); Nuvo assistant proposes, human promotes toward the calendar
- Domains → Initiatives → Projects (vertical / conscience) meet Day · Week (execution) via rituals (Sunday compose, Summit, Blueprint, Sunrise/Sundown)
- Clients: Tauri macOS app + installable iOS PWA from the same SPA
- Not a multi-user team tool; not a generic Notion clone; not “AI that runs your life”

Compete emotionally with Akiflow / Sunsama / Motion / Things — but **do not** clone their landing pages. Sound like Nuvo.

## Site constraints

- Live in `marketing/` only (separate Vite app, port 5174). Do **not** fold this into the product SPA.
- Stack already set: React 18 + Vite 6 + Tailwind v4 + Fraunces + Jakarta wordmark. Tokens are in `marketing/src/index.css` (Daybreak light subset). Prefer CSS variables; never invent a second brand palette.
- Visual language: Warm Paper — continuous atmosphere, Fraunces for ceremony, dissolve-not-frame, glass for floating UI, one hero per surface. Full grammar: `docs/design-language.md`.
- **One composition** for the first viewport: brand, one headline, one short supporting line, one CTA group, one dominant product visual. No dashboard clutter, no pill clusters, no fake stats strip.
- Mobile-ready: single column ≤767px, tap targets ≥44px, no horizontal scroll. Verify at 375px and desktop.
- CTA: if waitlist/auth isn’t ready, use a clear primary action (“Open app” → configurable URL, or “Request access” mailto / placeholder) plus optional secondary. Ask me only if the CTA target is ambiguous after checking the repo.
- Screenshots / UI: prefer real product captures or faithful recreations of Schedule / Domain. No generic stock “productivity” mockups. Don’t mutate the user’s live data while capturing.
- Keep the page fast and mostly static. Light intentional motion (2–3 beats) is good; no noise.
- SEO: meaningful `<title>`, meta description, Open Graph basics in `marketing/index.html`.
- When done: `cd marketing && npm run typecheck` clean; page verified in the marketing dev server.

## Page job (content)

Produce a single scroll that covers, in this spirit (structure can flex if the writing demands it):

1. **Hero** — who it’s for + the promise (calm command of the week, not another inbox)
2. **Problem** — the split between “what matters” and “what’s on the calendar”
3. **Major capabilities** (pick 4–6 max, sharp, not a feature dump): e.g. time-blocking that *is* the task; calendars unified; Week as the gate; domains/projects; capture + assistant; desktop + phone
4. **How it feels** — rituals / cadence without sounding culty
5. **Closing CTA**

Write like a product person who uses the tool, not a SaaS template. Short sentences. No purple marketing fog. Prefer concrete verbs over adjectives.

## Out of scope

- Separate repo / monorepo migration of the app
- Extracting `packages/design` fully (optional small cleanup only if needed)
- Auth, waitlist backend, blog, docs site, pricing
- Changing the product app UI

## Done when

- Placeholder gone; one polished page in `marketing/`
- Copy matches what Nuvo actually does
- Looks like the same brand as the app (Warm Paper)
- Works at 375px and desktop
- Typecheck/build green for `marketing/`
