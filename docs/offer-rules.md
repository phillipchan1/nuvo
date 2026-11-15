# Offers — the rules a suggestion keeps, and Plan projects

**Status: accepted (2026-11-14, D-216). Amends D-209's "deck first" and D-213's card labels (see §5). Phase 1 built 2026-11-14 on branch `claude/offer-rules` (day in every time label; the card leaves the rest state; a project's time offer rides its row; hover/focus previews on the Schedule and dims the rest). Driven at `?rail=deck`; not yet driven on a signed-in Schedule. Other times, Plan projects and Plan initiatives not built.**
Prototype (private, example data): [Nuvo Offer Rules](https://claude.ai/artifact/7oumBYorD2Zk7bAbxZgetX):
fifteen scenarios on the desktop Schedule, the project deck and the phone.

Builds on: [`intelligence-home.md`](./intelligence-home.md) (D-198: offers live on the left; D-200:
no chat; D-199: the Reach) · [`rail-modes.md`](./rail-modes.md) (D-202: Rest · Plan · Repair, acts
named by destination) · [`outcome-readings.md`](./outcome-readings.md) (D-201: Ready · Placed) ·
D-193 (Draft the path) · D-194 (Memory) · `useFindTime`, `composeWeek`, `slotPicksFor`.

---

## 1 · Thesis

An offer that's wrong costs more trust than a missing one earns. So Nuvo offers **only what's
hard to work out yourself**, and every offer carries everything you need to judge it before you
press: **where it lands (with the day), why, and what it costs.** Pointing at it shows the spot on
the grid and dims the rest of the week. When the first answer isn't right, there's always a
second: **Other times** opens up to two alternatives that differ for a reason they name, and you
can place it yourself by clicking the grid. Nothing is written until you press.

The left rail at rest is your work. An offer is a **chip on the row it would change**, never a
card above the list. The Get ready card at rest (D-209's "deck first": a `NUVO` label, a filled *Schedule 4:15–5pm*
button, no day, above the Projects list) breaks four of these rules. At rest it gives way to
the chips; the stack stays one press away behind the crown's line (D-207).

## 2 · The thirteen rules

| # | Rule | Violated when |
|---|---|---|
| R1 | **Only what's hard to do yourself.** Fitting several pieces into a fragmented week, finding the only gap, splitting, sizing from history, drafting tasks, naming what breaks. | One drag into an obvious gap would do it. |
| R2 | **Says where, with the day.** The label is the destination: *Today 4:15–5pm*, *Thu 10:30–11am*, *File in Garage studio*. | A time without a day; an opinion (*Looks good*) or a placeless deferral (*Later*). |
| R3 | **Shows where.** Hover or keyboard focus ghosts it on the grid and dims everything else to ~20%; the target day's column and header take the accent. The phone's first tap opens a sheet that draws the day. | You have to press to find out where it went. |
| R4 | **Says what it's built from**, in one muted line. With no history it says so and names the default ("30m is a guess"). | A number with no source, or a default dressed as a read of you (P6). |
| R5 | **Says what it costs**: what it fills, pushes or collides with, in `--warn`. | A cost the user discovers after pressing. |
| R6 | **Rides the row it changes.** One chip per row, quiet outline at rest, filled only under hover/focus. | A card or section of offers; an offer louder than the Today hero. |
| R7 | **Writes nothing until you press**, then offers Undo. | A ghost becomes data without a press. |
| R8 | **Learns from no.** ✕ asks why in one tap (Not now · Wrong time · Don't offer this); Memory keeps the answer (D-194). | The same refused offer returns unchanged. |
| R9 | **Modes start from your press.** The crown line is a fact, present only while true. | A badge, a push (N-07), an auto-opened mode. |
| R10 | **Lands and reaches.** Keeping lands the block and advances the project's bar in one beat (D-199). | A keep with no visible consequence; a score (N-04). |
| R11 | **Silence is an answer.** Nothing worth offering shows nothing. | An empty state about offers. |
| R12 | **Never rewrites what you touched.** A steer redrafts only Nuvo's lines; anything you edited, sized or typed stays. | A redraft undoes your edit. |
| R13 | **Always a second answer.** *Other times* is always shown beside the chip (not revealed on hover). It opens up to two alternatives, each different for a reason it names (*Sooner*, *Keeps today light*, *Two longer blocks*) and each with its own cost; or click any open time on the grid and Nuvo checks it ("Overlaps CAB Meeting", "That time has passed", "Open"). | Alternatives fifteen minutes apart; more than two; alternatives shown before you ask; no way to say "somewhere else". |

## 3 · Anatomy of an offer at rest

```
◯ Stand up security team at Frontier ━━━━━──  3/5
   ✦ Today 4:15–5pm ↵   Other times   ✕
   45m · sized from your last 3 finished on this project · Ends right before Kid date night   ← on hover/focus
```

- **Hover/focus the chip:** only the suggestion ghosts on the grid; the rest dims. Alternatives
  do **not** appear on hover (settled by Phil, 2026-11-14).
- **Other times:** the chip becomes a small chooser in the rail: the suggestion and up to two
  alternatives as numbered rows (1 · 2 · 3), all drawn on the grid at once, numbered; the one
  you point at is solid, the others faint. Click a faint block on the grid to pick it, or click
  open time to place it yourself (snapped to 15 minutes, the task's length). The button names the
  choice: **Hold Wed 1–1:45pm ↵**. Cancel or Esc leaves everything as it was.
- **Multi-piece offers** (*Place 3h: Tue · Wed · Fri*) offer a different *shape* as the
  alternative (*Two longer blocks*); place-it-yourself is off, since one click can't place three.
- **Phone:** the chip opens the task's sheet with the day strip, the ghost, time chips for the
  alternatives, and "or tap the day". 44px targets. Same words.

## 4 · Plan projects (and Plan initiatives)

The rail's Plan mode on every planner surface: **Plan the week** (Schedule), **Plan projects**
(project deck), **Plan initiatives** (initiative deck). Same grammar, three clock speeds. This
closes rail-modes §8's open question 2.

Plan projects walks the deck's not-Ready projects, rawest first, in two phases each:

1. **Tasks.** Nuvo drafts the missing tasks (the Draft the path engine, D-193), sized from shipped
   projects in the same domain. Inline: rename, resize, remove (Undo), add your own. A plain-language
   line, *Tell Nuvo what to change*, steers the draft (*fewer*, *smaller pieces*, *start with a call
   to Ana*) and obeys R12. Commit names the destination: **Add 4 tasks to Rebuild / Restart
   Fundraising**. Drafted lines use the existing **Drafted step** look (faint wash, dashed edge).
2. **Weeks.** The kept hours become a span at your usual weekly pace in that domain (a named
   default when there's none), offered as two spans with costs (*Overlaps Cloudflare migration the
   week of Nov 23* vs *clear weeks, later*), plus **Park it**. Hover ghosts the span on the deck.

The counter is **Ready n of m**, a state of the deck (D-201), never a tally of acts (N-04).
**No history:** drafts from the project's outcome with every size at a 30m default, and says so.
No outcome either: no draft, just the add line.

*Copy note:* the UI says **tasks**, not steps. In the glossary a **Step** is a line on a task's
checklist (D-103); "Add 4 steps" would name the wrong object (P11).

## 5 · Anchor

- **Ledger:** W2 (where do the hours go), W3 (what breaks), Q1 (on pace), Q2 (collisions), Q4
  (the actual steps), A4 (honest about the week, via costs).
- **Strains P9** (an offer is always present on its row), held by R6 + R11: quiet outline, one per
  row, nothing when there's nothing hard to offer. **Strains P10** with Plan projects (another
  walk), held by it being the existing Plan mode on another surface, not a new ritual.
- **Four no's:** no pool (offers ride existing rows); new names *Other times*, *Plan projects*,
  *Plan initiatives* (glossary); degrades on empty data (R4, R11; scenario *A brand-new account*);
  nothing about one account.

## 6 · Build order

1. **Phase 1 — the chip at rest (desktop):** ✅ built. `OfferChip`'s `preview` prop →
   `lib/offerPreview` → `Planner`'s `previewOverlay` (the plan overlay with `dimCalendar`);
   `WeekPanel`'s `TimeOfferLine` carries a project's first loose card; `whenLabel` / `holdWhen` say
   *Today*. Still to do here: the cost half of the why line, and the one-tap reasons on ✕ (today ✕
   is the existing Not now). The project decks still mount `RestDeck`; their cards need row chips first.
2. **Phase 2 — Other times:** up to two named alternatives from the same fitter, numbered ghosts,
   pick-on-grid with a conflict check; the phone's time chips and tap-the-day.
3. **Phase 3 — Plan projects:** the deck walk (tasks, then weeks) on the Draft the path engine.
4. **Phase 4 — Plan initiatives** on the same walk.

## 7 · Open

1. Does choosing an alternative teach Memory silently (e.g. "never straight after a meeting")?
   Leans yes, under D-194's "says where it learned it". Not in phase 1–2.
2. The fitter must return *named* alternatives (a reason per candidate), not just the next-best
   slots. Phase 2 starts by confirming what `useFindTime` / `composeWeek` can return.
