# Plan the week — UX review · 2026-10-25

*Status: review, with bet 1 built (2026-10-25, working tree, not committed). Fixed: the
working-hours field and the grid's drag scale (§2, #1–#2). Built: the first three rows of
§5 (projects take the morning, the week is spread, loose work batched by domain), with
fixtures in `tests/plan-week-defaults.test.ts`, and driven on both shells against a demo
account. §5's other rows and bets 2–3 are still recommendations. Also built the same day:
the missed-block fix (§8) and a design pass over both shells (one hero per step, less copy,
one time spelling). Logged as D-163.*

**Thesis.** Plan the week gets the **what** right and the **when** wrong. The pull, the
project sittings and the AI-themed runs give you sensible *groups*. Then a placement engine
with hard-coded clock windows and a Monday-first greedy fill puts those groups into the
**wrong hours**. Your best hours go to nothing, the week piles up at the front, and every
domain shares one 9-to-5 window. It also ignores the one thing Nuvo has that a scheduler
doesn't: **evidence of where your work has actually happened**. The fix doesn't need more AI. It
needs a better order of trust: what you declared, then what you've proven, then defaults.

The brief (ⓟ, paraphrased): *planning the week isn't working. I couldn't select hours. It
bunches times without thinking about which times. Default to bunching loose tasks by
context or domain. Should there be slots I set each week? Could it learn my habits from
previous weeks? I leave 8am open to drive, and that's not on any calendar. I want to plan the
week quickly.*

**Method.** Drove the dev app (auto-login, a demo account, not persona zero's data) at
1440×900 and 375px through all three steps, without committing. Read the code that decides
the week: `useWeekDraft` (pull → route → cluster → compose), `lib/compose.ts` (placement),
`lib/batch.ts` (clustering), `lib/standingSlots.ts` (layer 0), `lib/calibration.ts`.

---

## 1 · The job, stated once

> *On Sunday, in a few minutes, turn "everything this week is carrying" into a week I
> believe: projects in my good hours, loose stuff gathered into a few runs, and nothing
> booked into time I already know I won't have.*

| Ledger row | Today | What this review touches |
|---|---|---|
| **W2** · if I only get three real hours, where do they go? | ◐ | The placement *is* the answer to W2, and it currently gives your best hours to nothing |
| **D2** · what's already decided so I don't re-decide it? | ✅ | Scored ✅ because Sunday-composed blocks exist. That only holds if the blocks are in hours you'd keep, and the evidence here says many aren't |
| **W1** · can I carry this week? | ✅ | Unaffected, but capacity math depends on working hours, which you couldn't set |
| **A4** · am I lying to myself about this week? | ✅ | A plan that puts project work in hours you never work is a quiet version of the lie |

---

## 2 · What happened: verified in the running app

| # | I did | I saw | State |
|---|---|---|---|
| 1 | Boundaries → working hours → clicked the hour, pressed `1` then `1` to type 11 | The first `1` **saved 1:00am** as the start of the working day. The re-render reset the field's typing state, so the second `1` was swallowed. The grid redrew as 1am–5:30pm. Arrow keys worked; typing never could. The same pattern sat on three Settings fields (working hours ×2, the week-reveal time, the reminder time) | **Fixed.** `TimeInput` (`components/form.tsx`) keeps a draft and saves on blur or Enter. Used in Boundaries and Settings. Re-driven: `1`,`1`,Enter → 11:00 saved; nothing written mid-edit |
| 2 | Dragged a draft block to Wednesday 10:00am | It landed at 9:00 (clamped). The grid draws hours at `hourPx` (55px here) but converted the pointer with the `HOUR_PX` floor (44px), so every drag traveled 1.25× the cursor. On a tall Mac window the factor is larger | **Fixed.** `minAt` divides by `hourPx`. Re-driven: drop at Wed 10:00 → `10a–10:45a` |
| 3 | Opened an **empty** week (Mon–Fri, 9–5:30, no meetings) with four projects | All four sittings landed **Mon and Tue, 1pm–4:30pm**. Every morning and all of Wed–Fri stayed empty | Open. Root cause in §3 |
| 4 | Step 3 kept *Run* (40m) ✓ | *Run* appears **nowhere**: not on the grid, and not in the "didn't fit" list | Open. **Not diagnosed.** A kept item that silently vanishes breaks P6 |
| 5 | Step 3 | *Call the plumber* was placed Tue 4:15pm, wedged between two work sittings | Open. One window for every domain (§3d) |
| 6 | Read the grid's hour gutter | `9:00 AM` while the rest of the app says `9am` | Open, small. D-122's one-spelling rule |

Console showed repeated 503s during the session. I didn't trace them, and they look unrelated to these changes.

---

## 3 · Why placement feels unintelligent: the causes in code

**a · The good hours are reserved for an energy tag almost nothing carries.**
`compose.ts` `windowFor`: `deep` → work start to 12:30, `decide` → 10:30–3, **everything
else → 1pm to end of day**. A project sitting takes `shallow` unless one of its tasks is
tagged `deep` (`batch.ts` `clusterWeek`), and most captured and AI-drafted tasks aren't. So
project work goes to the afternoon and mornings hold nothing. That inverts the composer's
own rule ("project-backed work outranks loose captures for the open slots").

**b · Front-to-back greedy fill.** Days are tried Mon→Fri and the first fit wins, up to 75%
of a day's free time. On an open week, Monday fills first. That's the "bunching." Nothing
asks whether a project would rather have one sitting a day, or whether Thursday is empty.

**c · Loose work is grouped by an AI call, by theme only.** On open, `slotLooseWork` sends
the loose pool to the `agent` function's `clusterInbox`, which returns themed runs. That's
the grouping you like. But (i) if the call fails or returns nothing, loose work falls back
to **one block per task**, even though `clusterWeek` already has a deterministic
batch-by-domain pass that the draft only uses for project work. (ii) A run is grouped by
*what* it is, never by *when it can happen*. Calls, errands and computer work need
different hours.

**d · One window for every domain and every day.** `work_start_minutes` / `work_end_minutes`
is a single span. A Family errand and a deep work block draw from the same 9–5:30 window.
There are no per-day hours ("Tue I start at 10") and no domain hours ("Family happens after
5"). For P1 that's the whole problem: the domains *live at different times*.

**e · Nothing learned, though the evidence is already loaded.** `calibrate()` already
computes the share of your deep work you **finish before 1pm**, and nothing in placement
reads it. Every done task row keeps its `start_time`, so where each domain's work actually
happened over the last six weeks is already in `useAllTasks`.

**f · Standing slots exist, but Plan the week never offers them.** "Slots you set every
week" is already built: a recurring slot with a domain or project affinity is a **magnet**
that's filled *before* anything else is placed (`standing-slots.md`, layer 0). But you make
one by drag-creating on the Schedule with Repeat and a domain, or by asking the chat
(D-160). Plan the week only mentions them as "· N standing" on the phone, and the desktop
doesn't mention them at all. The best tool for your rhythm is invisible at the moment you
plan your rhythm.

---

## 4 · Your questions

**Should loose tasks default to being bunched?** Yes, and they mostly are, through the AI
runs. Make it **deterministic first, AI second**: always batch loose work by domain (the
`clusterWeek` pass, already written), then let the AI rename and regroup inside that. A run
should never fall back to scattered singles because a network call failed (P7).

**Weekly slots, or let it pick?** **Both, in a trust order.** Your rhythm is a fact about
your life that the calendar can't see. Standing slots are how you state it, and the composer
already obeys them. What's missing is the door: Plan the week's first step should show your
standing slots and let you add one in place ("Trading · weekdays 6–8a"). Picking still
matters, because most loose work isn't covered by a standing slot. But it should pick
**inside the shape you declared**, not around it.

**Can it learn from previous weeks?** Yes, and it fits the canon if it follows three rules:

1. **Evidence only (P6).** Learn from completed blocks and from hours you consistently
   leave empty, not from guesses. With no history, say so and use the defaults in §5.
2. **Learned rules surface as proposals, then become things you already have (P3, P10).**
   Illustrative copy, not real counts: "You've left 8–9am open on 18 of the last 20 weekdays. Keep it clear?" → one tap turns
   it into a boundary. "Trading work has landed 6–8am on 14 of 20 days. Make it a standing
   slot?" → one tap creates the standing slot. No new noun, no hidden model.
3. **Every placement says why.** The reason line already exists (`"afternoon batch"`). A
   learned placement says `"Tue mornings — where Marketing has landed 4 of 6 weeks"`.
   That's what separates this from N-01 (auto-schedule): when it's wrong, you can see why.

What it can learn cheaply from data already loaded:

| Signal | From | Becomes |
|---|---|---|
| Hours you never use inside the working window (the 8am drive) | No completed block or event in that hour across ≥4 weeks | A proposed boundary |
| When each domain's work actually happens | `start_time` of done tasks, by domain × hour-of-week | Placement preference, and a proposed standing slot when it's strong |
| Whether your project work happens in the morning | `calibrate()`'s morning share (already computed) | Window order for project sittings |
| What you move after Sunday | Not recorded today, so it would need a write | **Later.** Needs a decision, and isn't needed for v1 |

**The 8am drive.** Today, once the field works, set the start to 9:00. That's the honest
quick fix. Your case is an instance (ⓞ) of a general class: **time a person reliably
doesn't have that's on no calendar**: commutes, school runs, gym, prayer. The design should
target that class. A learned-quiet-hours proposal covers it for anyone with a few weeks of
history. Per-day working hours cover it on day one.

---

## 5 · Recommended defaults: true for a stranger, not just ⓞ

These are the stranger's product. Anyone without history gets *only* these, so they must be
good on their own (P7, P16).

| Default | Today | Proposed | Why |
|---|---|---|---|
| Project sittings | afternoon unless a task is `deep` | **morning first**, whatever the energy tag | Intent gets the best hours; that's the product's W2 answer |
| Spread | Mon-first greedy | **least-loaded eligible day**, at most one sitting per project per day | A week with room shouldn't read as a full Monday |
| Loose work | AI runs, singles on failure | **batched by domain**, deterministic; AI only names and regroups | Grouping can't depend on a network call |
| Loose runs | 1pm+ | afternoon, **after** the day's project sitting | Admin fills in around intent |
| Non-work domain loose work | inside the work window | inside its **standing slot** if one exists; otherwise flagged as "no time for this domain", not wedged into 2pm | A plumber call at 2:15 between two sittings is a fiction |
| Working hours | one span | one span **plus per-weekday overrides** | Different days have different shapes; a stranger has this on day one |
| Empty-week behavior | pack the front | leave about 25% of each day open (already the cap), **spread evenly** | Slack is the plan, per the composer's own header |

---

## 6 · The flow: making it feel fast

The walk (Open time → Projects → The rest) is right (D-035–D-037). The speed problem is
that each step shows a poor draft you have to fix by hand. Proposed, with no new steps:

1. **Opening it shows a draft already worth keeping.** That's §5's job, and nothing else
   makes the ritual fast.
2. **Step 1 "Open time" becomes "Your week's shape."** Meetings to set aside (as today),
   **plus** standing slots with an inline add, per-day hours, and any learned proposals
   ("8–9am usually stays open: keep it clear?"). This is where your weekly slots live.
3. **Step 2 Projects:** morning sittings, spread, each with a one-line reason.
4. **Step 3 The rest:** two or three named runs, not a list of singles. A kept item that
   can't be placed is always listed with a reason (finding #4).

Target to check against the persona's own bar: **a typical week committed in under five
minutes**, most of it spent reading rather than dragging.

---

## 7 · Anchor pass

1. **Ledger:** W2 (◐ → the placement starts answering it), D2 (keeps its ✅ honest).
2. **Strains:** **P16.** Learning presumes history, so a stranger's experience rests
   entirely on §5. **P3.** Holds only while everything stays a draft you commit. **P10/P11.**
   "Rhythm" must not become a new noun. Learned facts turn into *working hours* and
   *standing slots*, which already exist.
3. **Already decided:** **N-01** (auto-schedule the day) argues against this only if it acts
   without you. Here nothing leaves the draft without a press. `standing-slots.md` deferred
   "energy/time-of-day fit" and "auto-pull inbox": this review proposes the first, not the
   second.
4. **Four no's:** pool, no · overlapping name, a risk (see 2) · clean data, learning needs
   history, mitigated by §5 · builder-only, the 8am drive is ⓞ, generalized in §4.

---

## 8 · Actions

**Fix now**
- ✅ Working-hours (and Settings) time fields save per keystroke → `TimeInput`.
- ✅ Draft grid drag scale (`HOUR_PX` → `hourPx`).
- ✅ *Run* kept but neither placed nor reported (#4). It was a missed block from a past
  week that still carried its old `start_time`. The pull offered it ("going quiet"), but
  the draft dropped anything with a `start_time`, and that time wasn't in this week's
  blocks either. **Decided (ⓟ, 2026-10-25), in line with D-141:** a one-off block whose
  hour is in a past week has lost that hour. `isStaleBlock` / `draftableKept`
  (`lib/compose.ts`) hand it to the composer untimed. `planWeek` clears the old time
  (→ `backlog`, mirror updated) before writing the new one, so it can't commit with last
  week's clock. **Repeating occurrences are excluded (D-009):** re-placing a missed
  *Shutdown review* put a second one on a day that already had its own. The pull's
  presence source also stops offering occurrences (`VTask.recurring`). Driven: *Run*
  lands Wed 1–1:40pm. The commit write was not driven, because it would write to the
  account.
- ☐ Grid gutter spells `9:00 AM` (#6).

**Bets, in order**
1. ✅ **Placement defaults (§5, first three rows).** `compose.ts`: project pieces use the
   morning window whatever their energy; days are tried most-open-first (overdue work
   stays chronological, a project's loose steps try their previous step's day first);
   a project gets one *sitting* (`atomicIds`) a day, and each sitting leaves a later
   day for the sittings after it, both relaxed before anything is refused. `batch.ts`
   `batchLooseWork` + `useWeekDraft`: loose work the AI runs don't cover is batched by
   domain, singles stay tasks, and "take it out" works on these batches too. On the
   demo account's open week: **before**, four projects on Mon–Tue 1–4:30pm; **after**,
   one each morning, Mon–Fri, part 1 before part 2. The non-work-domain row and per-day
   hours are not built.
2. **Your week's shape in step 1.** Standing slots and per-day hours made inside Plan the
   week, on both shells. The phone's Plan the week has no hours control today; only
   Settings does.
3. **Learned proposals.** Quiet hours and domain timing from done blocks. Read-only
   derivation; the accept writes go through existing objects.

**Decisions to log** (once the branch's `decisions.md` conflict is resolved)
- Placement trust order: declared > proven > default.
- Project sittings take the morning by default, regardless of energy tag.
- Learned rhythm is proposed, never applied, and always becomes an existing object.

**Docs to update**
- `standing-slots.md`: "energy/time-of-day fit" moves from deferred to proposed.
- `personas.md` W2: re-score after bet 1 is driven on a real account.
