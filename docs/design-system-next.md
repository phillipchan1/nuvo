# Design system — the working brief

**Status:** active work-in-progress as of 2026-07-28. Foundation landed (tokens, spacing
scale, gallery); nothing migrated. This is the handoff doc — **read this plus
[`design-system.md`](./design-system.md) before continuing the work.**

The spec is [`design-system.md`](./design-system.md). This file is the *plan*: what's done,
what's next, in what order, and how you know each step is finished.

---

## 0 · What we're actually doing, in three sentences

The app's design language was never the problem — the absence of anything **enforcing** one
was. 126 components and 40,711 lines of TSX rest on 14 primitives, with 234 hand-rolled
`border border-line` containers and 32% of 3,053 spacing utilities off the 4px grid; over
the same code, type drifted **0%**, purely because type had named tokens and spacing had
none. We are adopting Notion's language (decision **D-025**) for its *constraint*, and
building the component library as a product (**D-026**) so the constraint is enforced by
the system rather than remembered by a person.

**The goal is not a repaint. It is that a surface file should contain no `px-`, no
`rounded-`, no `border`, and no colour** — because every one of those decisions has been
made once, in a primitive, and vetted in the gallery.

## 1 · State of play

**Landed** (commit "Adopt Notion's design language, and give spacing a vocabulary"):

| | Where |
|---|---|
| Notion material, light + dark | `src/index.css` (`html[data-skin="notion"]`), registered in `src/hooks/useSkin.ts` |
| Ratified 7-step 4px spacing scale | `src/index.css` `@theme` — `p-s1`…`p-s7`, `gap-s3`, `mt-s4` |
| Time vocabulary (net-new) | `src/index.css` — `--now`, `--slot`, `--busy`, `--span` |
| The gallery | `src/gallery/Gallery.tsx`, reached at `?gallery`, wired in `src/main.tsx` |
| Spec + provenance | [`design-system.md`](./design-system.md) |
| Decisions | `docs/product/decisions.md` — D-025, D-026 (D-019/D-020 marked superseded) |

**Not landed, deliberately:** nothing is migrated. The material is *selectable*, so all 126
components still render Warm Paper markup underneath it. It makes them **look** Notion; it
does not make them **consistent**. No primitives, no lint gate, no visual tests.

**Never verified:** the authed app. The container this was built in had no `.env.local` and
no Supabase config, so only the gallery and login screen were driven. **Step 1 exists
because of this.**

## 2 · The steps, in order

Do not reorder these. Migrating before the primitives exist produces a 127th dialect;
running a linter before the scale is adopted produces ~990 untriageable findings.

### Step 1 · Verify the material on real data ← start here

You have `.env.local` and real data; the build container did not. This is the step that
can't be done remotely.

```bash
npm run dev          # auto-login lands you straight in the app
# 1. localhost:5717/?gallery      — sanity-check tokens/primitives, flip skins + themes
# 2. Settings → Appearance → Notion, then drive the REAL app
```

Walk: **Schedule** (the risky one) · **Projects / Initiatives decks** · **Domain chapel** ·
**Record modal** · **Week's Plan** · the **mobile shell at 375px**.

The specific thing to distrust: `blockColors` in `CalendarPane.tsx` mixes event hues
against `--surface`, and that arithmetic has never met these tokens. A heavy-overlap day is
the worst case — look at one.

**Done when:** you've seen every major floor in the Notion material in both themes, and
every visual break is either fixed or written into §4 below. Expect breaks; that's the
point of doing it before migrating.

### Step 2 · Decide whether to flip the default

A separate decision from D-025, deliberately. Options: keep Notion as a selectable material
(safe, but the app stays Warm Paper for you day to day) or make it the base language and
demote `paper` to a skin (commits to it, makes every subsequent decision simpler).

**Done when:** logged in `decisions.md` either way. An unrecorded call comes back.

### Step 3 · Build the primitive layer — the bulk of the work

~15 missing: `Card`, `Row`, `Chip`, `Badge`, `Menu`, `Popover`, `Tooltip`, `Tabs`, `Empty`,
`Skeleton`, `Avatar`, `Toolbar`, `Table`, `Dialog`, `Command`.

Behaviour comes from **Base UI via shadcn** (its default since Jan 2026, by the original
Radix engineers, React 18-compatible, has a registry + MCP server so components can be
pulled rather than hand-written). Skin at intake — never merge one as-is.

The loop, per primitive:

1. Pull behaviour (`npx shadcn add @shadcn/<component>`) or write it.
2. Re-skin to tokens. **Imported components arrive with opaque `bg-card`** — that must go.
3. Add it to `src/gallery/Gallery.tsx` with its **full state matrix**: default · hover ·
   active · focus · disabled · loading · empty · error, × light/dark, × 375/1440.
4. Only then use it in a surface.

**Two constraints that will bite:** Tauri swallows HTML5 drag-and-drop, so no third-party
dnd block will work — drag stays pointer-events. And every primitive must clear the mobile
golden rule in [`CLAUDE.md`](../CLAUDE.md) (≥44px taps, no hover-only affordances, `Sheet`
not popovers on a phone).

**Done when:** a primitive renders every state in the gallery in both themes at both
widths. If it can't survive that, it isn't finished.

### Step 4 · Migrate surfaces, one floor at a time

Per floor: replace hand-rolled containers with primitives, convert spacing to the `s` scale,
delete the dead classes. **One floor per commit** so a regression is bisectable.

Track it — this number is the whole project, and it should fall every commit:

```bash
# off-4px-grid spacing utilities (baseline 2026-07-28: 990 of 3053 = 32.4%)
all=$(grep -rho "\b\(gap\|p\|px\|py\|pt\|pb\|pl\|pr\|m\|mx\|my\|mt\|mb\|space-[xy]\)-[0-9.]\+" src --include=*.tsx | sed 's/.*-//')
echo "$(echo "$all" | grep -c '\.5$') off-grid of $(echo "$all" | grep -c .)"

# hand-rolled containers (baseline: 234)
grep -rn "border border-line" src --include=*.tsx | wc -l
```

**Done when:** the floor's file has no `px-`, no `rounded-`, no `border`, no colour.

### Step 5 · Close the gate, so it can't rot back

Nothing currently rejects an off-scale value — the app has zero ESLint and zero Stylelint,
and CI runs only typecheck + tests.

- **Lint:** ban raw hex in `.tsx`, ban off-scale spacing in migrated directories (start
  scoped, widen as floors land).
- **[Impeccable](https://github.com/pbakaus/impeccable)** — `npx impeccable install`,
  Apache 2.0, works natively with Claude Code. 60 deterministic detector rules that run with
  no LLM. **Configure it from `design-system.md`** (`/impeccable extract`) rather than
  taking its defaults — its rules are generic AI-slop heuristics and know nothing about
  `--slot`, `--now`, or the one-hero rule. Expect false positives; tune, don't obey.
- **Visual regression:** Playwright's `toHaveScreenshot()` against `?gallery` is free and
  built in. This is what makes "perfect" *stay* perfect.
- **`llms.txt` at repo root** — a plain-markdown index pointing agents at the canon, tokens
  and decisions. Trivial, and it's the direct fix for doc/token/component drift.

**Done when:** an off-scale value fails CI.

## 3 · Rules that hold throughout

- **Verify against the running dev app, not a typecheck.** Root `CLAUDE.md` §"Test against
  live code" is not optional, and it's the rule most often skipped.
- **Full verification checklist before calling any UI task done:** typecheck clean · driven
  in the dev app · 375px with no horizontal overflow · desktop · `npm run build` green.
- **Documentation duties are same-day**, per [`docs/CLAUDE.md`](./CLAUDE.md): a spec that
  ships updates its status header · a new user-facing name goes in `glossary.md` · a real
  call or a rejected idea goes in `decisions.md` · a doc made wrong is flagged as stale
  rather than left silently false.
- **Intake for anything from outside** (Dribbble, 21st.dev, Untitled UI): name the property
  you like in one sentence first — nine times in ten it's a *token change*, which improves
  all 126 components at once. Rule of three before promoting to a primitive. See
  [`design-system.md`](./design-system.md) §8.
- **This is visual/system work, not product work** — the anchor pass (Question Ledger,
  principles, four no's) does *not* apply. It applies the moment a change alters what a
  surface *says* or *does*.

## 4 · Known open threads

- **`blockColors` (`CalendarPane.tsx`) is unproven against Notion tokens** — highest-risk
  unknown, and Step 1 is designed to surface it.
- **API inconsistency, found by the gallery:** `Toggle` names its accessible label `label`,
  `Checkbox` uses `children`. Unify when the primitives land.
- **Mobile pass untouched** for the Notion language beyond the gallery's own reflow.
- **The identity palette isn't wired.** `--hue-*` exists but domains still carry ad-hoc
  hexes. Migrating them to Notion's nine is a real (and user-visible) change — worth its own
  decision entry.
- **`parts.tsx` gotcha:** it exports both components and constants, so editing it breaks
  Vite Fast Refresh (white screen). Reload fixes it; the build is unaffected.
