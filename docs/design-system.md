# Nuvo design system — the Notion language

**Status:** foundation landed 2026-07-28 · tokens + spacing scale + gallery shipping ·
primitive layer not yet built · nothing migrated. Supersedes
[`design-language.md`](./design-language.md) (Warm Paper), which is retained because the
`paper` material still exists. Decisions: **D-025** (language), **D-026** (library as a
product) in [`decisions.md`](./product/decisions.md).

Nuvo adopts Notion's design language literally, and the reason is not that Notion is
prettier — it is that **Notion's meticulousness is a property of its constraints, not of
its taste.** Notion's spacing is immaculate because roughly eight values are legal and the
rest are unavailable; you cannot reach that state by trying harder across 126 components,
because a thousand judgment calls drift no matter who makes them. This document is the
constraint, plus the one place Notion had nothing to offer and we had to extend it.

Siblings: **the working plan in [`design-system-next.md`](./design-system-next.md)** (what's
done, what's next, in what order — start there if you're picking this up) · the build
conventions in [`CLAUDE.md`](../CLAUDE.md) · the retired grammar in
[`design-language.md`](./design-language.md) · the docs contract in
[`docs/CLAUDE.md`](./CLAUDE.md).

---

## 1 · Why this, and what the evidence was

The app was measured before anything was changed. The finding was not "the design is bad":

| | Type | Spacing |
|---|---|---|
| Uses across 126 components | 1,398 | 3,053 |
| Off-system uses | **0** | **990 (32.4%)** |
| Distinct values in play | 8, all named | **20, none named** |

Zero raw `text-sm`/`text-lg` anywhere. Thirty-two percent of spacing off the 4px grid. Same
authors, same files, same week. **The only difference was that type had a named vocabulary
and spacing had none** — so every author reached for raw Tailwind, because there was
nothing else to reach for.

Everything below follows from that. The supporting numbers: 14 primitives carrying 40,711
lines of TSX, 234 hand-rolled `border border-line` containers, 5 radius scales in live use,
91 files with inline `style={{}}`, zero ESLint, zero visual tests, and no gallery.

## 2 · Provenance — what is verified and what is derived

**Notion publishes no design system.** There is no open-source repo, no public Figma
library, no token spec. Anything sold as "Notion's design tokens" is scraped and
unverifiable. So every value in the `notion` material is one of two things, and the
distinction is load-bearing:

| | Meaning | Examples |
|---|---|---|
| **Verified** | Widely documented from Notion's rendered UI, corroborated across sources | ink `#37352f` · paper `#f7f6f3` · action blue `#2383e2` · the nine text/background palette pairs · 4px base unit · the popover/modal shadow stacks |
| **Derived** | Not observed directly; reasoned from a verified value by Notion's own logic | the time roles (§4) · dark-mode line steps · `--slot-soft` / `--busy-soft` mixes |

Nothing here is invented taste, and **nothing is claimed as official**. Before treating any
single value as settled, verify it against the real app. If a value turns out wrong, fix it
in `index.css` — it is one token, not a hundred components.

## 3 · The material

Ships as `data-skin="notion"` (see [`useSkin.ts`](../src/hooks/useSkin.ts)), orthogonal to
light/dark. This is deliberate and non-destructive: the whole app can be flipped into the
Notion language and compared against `paper` before a single component is migrated.
**Flipping the default is a separate decision, not yet made.**

The three moves that define it:

1. **Inverted nesting.** The *frame* is the warm off-white (`--bg: #f7f6f3`) and the
   *content* is white (`--surface`) floating on it. This is the single most Notion-defining
   layout decision, and it is the opposite of the `flat` material's tinted rail against a
   white app.
2. **A resting thing has a border and casts nothing.** `--shadow-1` is literally `none`.
   Only a floating thing — a menu, a modal, a dragged block — gets a shadow, and it gets
   Notion's own three-layer stack.
3. **Focus does not lift.** A selected thing takes a blue-tinted fill and **stays flat**.
   This directly contradicts Warm Paper's sixth move, so it is stated in CSS rather than
   inherited. The one exception is Notion's own: a block you are *dragging* floats and
   casts.

Retired with the language: the Fraunces ceremony voice (`--font-serif` → the sans, so every
`.masthead` flattens for free), the dawn/dusk `.atmosphere` gradient, and the entire
glass/frost focal system.

## 4 · The extension — a vocabulary for time

Notion is a document tool. It has **no design language for time**: no now-line, no
unclaimed slot, no bar spanning three weeks. Adopting it wholesale therefore leaves a hole
exactly where Nuvo does its work. Four roles are net-new, each derived from a place Notion
already reasons about the same idea, so they sit *inside* the language instead of beside it:

| Token | Role | Derived from |
|---|---|---|
| `--now` | the live moment — now-line, current column/week band | Notion's **overdue** date colour, the one place it already says "time is pressing on you" |
| `--slot` | open / claimable / unbooked; AI-proposed-not-committed | Notion's **blue**, the hue it uses for a thing you can act on. Never the accent — an open slot is an invitation, not a commitment |
| `--busy` | occupied but not yours (external calendar) | Notion's **grey** |
| `--span` | a thing occupying more than one column | Neutral by design — duration is *structure*, not status, and colouring it competes with the identity the card already carries |

## 5 · The spacing scale — the ratified seven

Seven steps on a strict 4px unit, and **nothing between them**. This is the vocabulary
whose absence caused the 32%.

| | | Use |
|---|---|---|
| `s1` | 4px | hairline gaps — icon↔label, chip padding |
| `s2` | 8px | the default gap inside a row or control |
| `s3` | 12px | padding inside a card / row; gap between related rows |
| `s4` | 16px | gap between distinct elements; card padding at rest |
| `s5` | 24px | gap between groups within a section |
| `s6` | 32px | section separation |
| `s7` | 48px | major region separation, page top padding |

Used as `p-s3`, `gap-s2`, `mt-s4`. **Deliberately additive under an `s` namespace** —
redefining Tailwind's own `--spacing-*` would silently re-space all 3,053 existing
utilities at once. Old values stay legal until their component is migrated, then stop being.

If you need a value that isn't here, the answer is one of the two nearest steps. Adding an
eighth is an edit to this document and to `index.css` — never an inline decision.

## 6 · The four layers

Each layer may consume **only** the layer beneath it. The names do nothing; the dependency
rule does all the work.

| Layer | Knows about | Example |
|---|---|---|
| **Tokens** | nothing — values only | `--space-s3`, `--line`, `--now` |
| **Primitives** | no domain | `Card`, `Row`, `Chip`, `Menu`, `Field` — doesn't know what a project is |
| **Compositions** | Nuvo | `TaskRow`, `ProjectCard`, `PlannerRail`, `FloorHeader` |
| **Surfaces** | assembly only | `WeekPlanFloor`, `DomainFloor` |

**The enforceable test:** a surface file contains no `px-`, no `rounded-`, no `border`, no
colour. If it does, the layer below failed to provide something. Every floor in the app
fails this today — that is the same finding as the 234 hand-rolled containers, restated.

## 7 · The gallery is the front door

`npm run dev` → **`localhost:5717/?gallery`** (dev only, no auth, no shell — follows the
existing `?emblem` / `?planweek` harness convention in `main.tsx`).

Every token and primitive, every state, both themes, any material, with a live skin
switcher. Two rules:

- **A primitive that isn't on this page isn't finished.**
- **Anything from outside enters here first** — a Dribbble shot, a 21st.dev component, an
  Untitled UI import — with its full state matrix, *before* it touches a screen. If it
  can't survive eight states in both themes at both breakpoints, it was a picture, not a
  component. You learn that in an hour instead of after it's wired into three floors.

It earns its keep immediately: drawing `Toggle` and `Checkbox` side by side for the first
time surfaced that one names its accessible label `label` and the other uses `children` —
two words for one idea, invisible until they were adjacent. Logged in §9 rather than
patched silently.

## 8 · Intake — absorbing an outside design

Don't reject it, don't paste it. Decompose it, in this order:

1. **Name what you like in one sentence.** Nine times in ten it is not the component but a
   *property* — "the rows breathe more", "there's only one font weight", "the card has no
   border". Those are **token changes**, and a token change improves all 126 components at
   once. This is the highest-leverage outcome and the step people skip.
2. **If it's structural**, ask whether existing primitives express it with a new variant.
3. **If it needs a new primitive**, apply the **rule of three** — once is a one-off built
   locally, twice is still local, three times earns promotion into the library. Promoting
   on first sighting is how you get 200 components nobody uses.
4. **Log the version you rejected** in [`decisions.md`](./product/decisions.md) §2. An
   unrecorded no comes back every quarter.

Sourcing, in the order to reach for it:

| Need | Source |
|---|---|
| Behaviour — keyboard, focus trapping, ARIA | **Base UI via shadcn** (its default since Jan 2026, by the original Radix engineers; React 18-compatible, registry + MCP) |
| Component coverage gaps | 21st.dev, Untitled UI — **behaviour donors, skinned at intake, never merged as-is** |
| Token architecture reference | Atlassian (391 described tokens), Primer, Spectrum, Polaris — all publish DTCG JSON free |

Two frictions to expect, both real: imported components arrive with an opaque `bg-card`
that must be re-skinned, and **Tauri swallows HTML5 drag-and-drop**, so no third-party dnd
block will work — drag stays pointer-events (see `nuvo-tauri-dnd`).

## 9 · Open threads

- **Nothing is migrated.** The Notion material is complete and selectable; all 126
  components still render their Warm Paper markup underneath it. The material makes them
  *look* Notion; it does not make them *consistent*. That's the primitive layer's job.
- **The primitive layer isn't built.** ~15 missing: `Card`, `Row`, `Chip`, `Badge`, `Menu`,
  `Popover`, `Tooltip`, `Tabs`, `Empty`, `Skeleton`, `Avatar`, `Toolbar`, `Table`, `Dialog`,
  `Command`.
- **API inconsistency, found by the gallery:** `Toggle` takes `label`, `Checkbox` takes
  `children`. Unify on one when the primitives land.
- **No enforcement yet.** The scale exists but nothing rejects an off-scale value. Next:
  ESLint/Stylelint rules banning raw hex and off-scale spacing, plus
  [Impeccable](https://github.com/pbakaus/impeccable) (60 deterministic detector rules, no
  LLM) configured *from* this doc rather than its generic defaults. Pointing it at the
  codebase before the scale is adopted would just generate ~990 untriageable findings.
- **`llms.txt` not written.** A root index pointing agents at the canon, tokens and
  decisions — now table stakes for agent-readable design systems, and the direct fix for
  the doc/token/component drift that makes an agent inconsistent.
- **Verified in this container only against the gallery and the login screen** (both
  themes, 1440px and 375px, zero horizontal overflow, zero page errors). The authed app was
  not driven — no `.env.local`, so no dev auto-login, and Supabase is unconfigured. **Drive
  the real floors before trusting the material on dense surfaces**, particularly the
  calendar (`blockColors` mixes hues against `--surface`) and the decks.
- **Mobile pass untouched** for the Notion language beyond the gallery's own reflow.
