# Memory — what Nuvo learns about you, and where it uses it

**Status: partly built (2026-11-13, D-194).** Built: the store (`user_settings.memory`, migration 94 — **not applied yet**), the Rhythm detectors, `useMemory`, the panel, the sidebar row and its dot, and the phone's dot and chat entry; then Plan the week's What I noticed (§4.5), the Schedule's Rhythm view without drag-to-adjust (§5.2), and first run (§5.3). Verified at `?memory`, not on a live account. Not built: drag-to-adjust, `planMemory` in the database, the other chapters, the chat. Storage deviates from §8 on purpose: one jsonb column, not a table (see D-194). Replaces a same-day draft, `rhythm.md` (never
committed), which covered time only; Rhythm is now §5, the first chapter of Memory. Prototypes
(private, example data):
[Nuvo Memory](https://claude.ai/artifact/F3yNgHaJe5DHTR3LGLAiuZ) (the indicator and the
panel) · [Your Rhythm](https://claude.ai/artifact/X34HaYSanSSeV4eYuK8x2W) (time memories
on the Schedule, in Plan the week and at first run; its observations are computed from
the example data in the page). Its four open calls were settled by Phil on 2026-11-13 (§12). On acceptance: a decision
entry, glossary entries (§9), and the ledger notes in §2.

Builds on: [`plan-the-week-v2.md`](./plan-the-week-v2.md) §6 (the planner's memory: the
pattern this generalizes) · [`standing-slots.md`](./standing-slots.md) ·
[`commitment-model.md`](./commitment-model.md) (calibration: planned vs proven) ·
[`planning-kernel.md`](./planning-kernel.md) (one rule, two runtimes) ·
[`agent-conformance.md`](./agent-conformance.md) (the chat reads it too) ·
`src/lib/planMemory.ts` (the trial memory, pure over plain data).

---

## 1 · Thesis

Nuvo already learns, in pieces, and forgets all of it. The week planner keeps your
corrections in one device's local storage. The inbox router learns from your re-files and
only uses that to guess. Draft the path will watch you drop steps. Calibration measures your
real pace and nothing else reads it. Meanwhile every account is planned as if its owner works
8:00–4:30 with no habits.

**Memory is one place where what Nuvo has learned about you lives, says where it came from,
and says where it's used.** It learns quietly from what you already do: your calendar, your
finished blocks, your corrections. It asks only when it's sure. Every answer you give shows
what it will change before you give it. Anything it isn't sure of, you can see, but nothing
else in the app acts on it.

The load-bearing idea: **a memory is never a guess the app acts on. It's a fact you
confirmed, with its evidence attached.** Everything else is visibly a hypothesis.

---

## 2 · Anchor

| Check | Answer |
|---|---|
| **Ledger** | **W1** (capacity uses your real hours and real sizes) · **A4** (calibration's honesty reaches sizing and drafts, not just one number) · **Q4** (Draft the path learns your shape of a project) · **W7** ◐ (patterns in what carries over become visible) · **O3** ○ (a connected calendar produces your hours on day one) · **O4** ○ (*who can see my work?* Memory says it on its face: only you, never leaves your account) · open question **Q-07** (a new account's hours) |
| **Strains** | **P10**, hard: it is a **new place**. The justification is P10's own test, a second instance: one memory feeds five altitudes (§6), so it can't live inside any one of them. Mitigation: it is an Inspector panel over the page you're on, not a navigation destination (the five tabs stay five), and it has one icon. **P9**: an indicator is the first step toward a nag. Held by §4.1: one dot, no count, no motion, cleared by looking. **P3**: nothing is used until you keep it. **P16**: learning needs history. Accounts without it see an honest empty state, never a filler guess |
| **Already decided** | Plan the week v2 §6 (≤3, three of the last four weeks, Forget for 8 weeks). Memory is that store generalized, not a second one: `planMemory` moves into it. **N-20**: the app never picks your work, so learned "tasks" are limited to repeating what you already keep writing. **N-07**: no planning nudges, so nothing about Memory is ever a notification. **N-04**: no scores, so confidence is three words, not a percentage. **D-061**: a domain going quiet is the Domain floor's and the Review's voice, not Memory's |
| **Four no's** | Pool: no. Name: **Memory**, and three section names (§9). Clean data: no; it reads raw data and says how much. Builder-only: the detectors are tested on fixture accounts unlike persona zero's (§10) |

---

## 3 · The engine

```
signals  →  observations  →  memories  →  uses
(raw)       (derived, each     (what you      (every surface that reads one
            time, never        kept or        names it, so you can trace a
            stored as fact)    refused)       placement back to its memory)
```

**Signals** are what already happens: calendar events, finished blocks (planned vs actual),
tasks you write, and your corrections (a draft step dropped, a block moved off an hour, a
task re-filed, a run split). Corrections are the richest signal, because each one is a place
where Nuvo was wrong.

**Observations** are pure derivations over a window of signals, recomputed every time. They
are never stored, so they can't go stale or disagree with the data under them. Each carries:

| Field | |
|---|---|
| statement | one sentence, in your words where possible ("Gym is Monday, Wednesday and Friday, 6–7am.") |
| evidence | the count and the window ("21 of 24 sessions"), plus pips, one per period, oldest first |
| confidence | **Sure** · **Fairly sure** · **Not sure yet** (§4.2) |
| source | where it came from ("From your calendar") |
| uses | which surfaces would read it if kept |
| on keep · on not true | the exact change each answer makes (§4.3) |

**Memories** are what you answered: **kept** (Nuvo plans with it) or **said no** (Nuvo stops
looking). Only these are stored. A kept memory usually *writes something that already
exists*, such as working hours, a standing slot or a repeat, and the memory row records why that
thing exists. Some memories have no other home ("you drop research steps") and are read
directly by their consumer.

**Uses**: every consumer reads memories through one read model (`useMemory`, and the same
pure module on the agent side), and anything it changes because of a memory says so. A
sitting placed in Deep work carries "in Deep work · from Memory"; a drafted step sized at
75m says "writing runs long for you". **A use that can't be traced back to its memory is a
bug.**

---

## 4 · The surface

### 4.1 · The indicator

A ✦-in-a-ring icon at the foot of the desktop sidebar, beside Settings. It is always there,
because a place you have to remember exists is one you never visit.

- **One dot, accent, no count**, and only when a **Sure** or **Fairly sure** observation is
  new since you last opened Memory. Opening clears it, whether or not you answer. It's
  "something to look at", never "things you owe" (P4).
- **No motion.** It doesn't pulse, and it doesn't appear on load with a flourish (P9).
- **Never a notification**, with or without push consent (N-07).
- Paused learning (§4.4) removes the dot; the tooltip says "Memory · paused".
- **The phone:** the dot rides the ✦ Nuvo launcher; Memory opens from the chat's header as a
  bottom `Sheet`. *Settled:* try the dot. If, in use, it reads as "Nuvo replied", Memory
  gets a row at the top of the chat instead and no dot.

### 4.2 · Confidence

Confidence decides **where** something may appear, not how loudly.

| Level | Rule (per detector, §5–6) | Appears |
|---|---|---|
| **Sure** | the pattern held across the full window with at most one miss, and nothing contradicts it in the last two periods | Noticed; Plan the week (≤3); first run |
| **Fairly sure** | held in ≥75% of the window, no recent contradiction | Noticed |
| **Not sure yet** | some evidence, below the bar | **Still watching**, inside Memory only. Each says what it still needs ("Needs 5 of 8 weeks before Nuvo asks you about it.") |

Thresholds are the honesty. A missed pattern costs nothing. A wrong one ("you train at 6";
you trained twice) teaches you that Nuvo guesses, and that spends the trust calibration
earned (A4).

### 4.3 · The panel

An Inspector panel over the current page, titled **Memory**, with one line of what it is:
"What Nuvo has learned from your calendar and your work. Only you can see it, and it never
leaves your account." Four tabs, each grouped by area (Time · Work · Projects · Initiatives ·
Domains · Words):

| Tab | Holds | Acts |
|---|---|---|
| **Noticed** | Sure / Fairly sure, unanswered | **Keep** · **Not true**. Both show their consequence first, as a line under the statement |
| **What Nuvo uses** | kept memories, with source, date kept and **used by** chips | **Forget…**, which shows its consequence and asks once in place |
| **Still watching** | Not sure yet | **Not true** only. You can't keep a hypothesis early |
| **You said no** | refused observations | **Ask me again** |

Consequence lines are specific, never generic:

- Keep: "a Deep work standing slot, Tue and Thu 1–4pm. Plan the week puts project sittings there first."
- Not true: "Nuvo stops looking for open time on those afternoons. It won't ask again unless the pattern changes for 8 weeks."
- Forget: "Capacity and Plan the week go back to the default, 8am–4:30pm."

Every act has an Undo toast.

### 4.4 · Trust controls

In the panel's footer: **Keep learning** (a switch; off means Nuvo still uses what you kept
but derives nothing new and shows no dot), and **Forget everything…**, confirmed in place.
It deletes every memory and refusal. Things a Keep already wrote (your hours, a slot, a
repeat) stay as ordinary settings and series, because they're yours now. Nuvo forgets why
they exist and starts learning from zero.

### 4.5 · Where else memories surface

Memory is the one place to see and edit them all. Observations may also be asked **in
context**, but only on a surface you opened to plan, and only Sure ones:

- **Plan the week**: What I noticed, ≤3 (v2 §6, unchanged rule).
- **The Schedule**: the Rhythm view (§5.2).
- **First run**: your week, as your calendar tells it (§5.3).
- **Draft the path**: none asked in the draft; a kept project memory just shapes it, and says so.

---

## 5 · Chapter one: Rhythm (time)

The time-only first draft, carried over unchanged in substance.

### 5.1 · Detectors

| Detector | Rule | Keep makes |
|---|---|---|
| **Hours** | per weekday, median first and last timed event that counts toward work, ≥4 weeks; days within 30 min merge | your **working hours**, per weekday (migration: `work_hours jsonb`; `planMemory.dayEnds` folds into it) |
| **Habit** | same normalized title, same weekday(s), start ±30 min, ≥5 of 8 weeks and ≥60% of sessions | a **standing slot** with the domain as affinity. If it's already a recurring calendar series, **no slot** (that would double-book it); Keep sets the series' Counts toward instead |
| **Open window** | inside your hours, ≥90 min with nothing timed, ≥7 of 8 weeks, ≥2 weekdays | a **Deep work** standing slot, work affinity, where Plan the week puts project sittings first |
| **Repeat** | the same title written by hand ≥3 times on a steady cadence | a **repeating task**; the hand-written ones stay |
| **Planner** | the existing `planMemory` proposals (clear hour, early end, run cap) | as today |

Never read: all-day, free/transparent and declined events, and hidden calendars.
*Settled:* someone else's subscribed calendar (a family calendar) is their rhythm, not yours.
Only calendars the account owns count.

**History.** Sync keeps 30 days back (`SYNC_WINDOW_PAST_DAYS`). *Settled:* widen
`SYNC_WINDOW_PAST_DAYS` to 56 days for both providers. One constant, one code path; the cost
is more stored event rows, which `npm run perf` should confirm is harmless.

**"Work".** Domains don't store their kind, though the first-run picker asks it. *Settled:*
store it (`domains.kind`, from the five kinds the first-run picker offers; existing domains
get it once, asked in Memory or the domain's properties). Until a domain has one, Hours reads every timed weekday event between 6am and 9pm and says
"your weekday calendar", not "work".

### 5.2 · The Schedule's Rhythm view (desktop)

A **Rhythm** toggle in the Schedule's PageBar draws two layers under the real week: your
hours as a band (default hours hatched, "not yours yet"), and Sure habits and windows as
dashed ghost slots with their pips. Click one for the Inspector (statement, evidence, what
Keep makes, Keep ↵ · Not true ⌫). **Adjust is the grid**: drag a ghost's edges, or the hours
band's, then keep. A kept one draws as the standing slot it became.

### 5.3 · First run

After a calendar connects: "Your week, as your calendar tells it", every Sure time
observation in one list, per-item Not true, and one **Use these**. Under four weeks of
calendar, or none, one sentence says so and the step is skipped.

---

## 6 · The other chapters

Each is a set of detectors over signals Nuvo already has, a consumer that reads the kept
memories, and its own thresholds. They ship one at a time, each behind the same panel.

| Area | Example | Signal | Used by |
|---|---|---|---|
| **Work** | "Writing runs long for you. Of 6 blocks planned at 45m, 5 were extended or carried into a second sitting." | finished blocks: planned length vs what happened | Draft the path sizes, Plan the week, capacity |
| **Projects** | "You've dropped the research step from 4 of your last 5 drafted paths." · "You keep a project's first step under 30 minutes." | Draft the path keeps / drops / edits; first tasks of shipped projects | Draft the path |
| **Initiatives** | "You carry three initiatives a quarter, and finish two." | initiatives per quarter, shipped vs not | Summit (your usual three drawn as a line on the portfolio; never a cap) |
| **Domains** | "Training is the first thing to go in weeks over 45 hours of meetings." | finished blocks per domain against meeting load | **The Review only**, as evidence, if it holds. It is a judgment about a domain, so it uses D-061's voice and never Memory's dot |
| **Words** | "“SCE” means your Work domain." | re-files after the router guessed | capture routing, the chat |

The **Projects** chapter is the loop that makes this worth building: what you correct in a draft today
is how Nuvo drafts next month, and the draft says which memory shaped it.

---

## 7 · The chat

The pure detectors and the memory read live where both runtimes can import them
(`supabase/functions/_shared/memory/`, zero imports, like the planning kernel). So the chat
can answer *"when do I usually train?"* or *"what have you learned about me?"* from the same
memories, with their evidence.

The chat **may not keep, refuse or forget** a memory. It points you to Memory. That is a
writing capability with no UI twin, so the decision record must say so (root CLAUDE.md:
*a new agent tool that writes planning state needs its UI twin*). The read questions join the
battery (§10).

---

## 8 · Storage

| Table | Holds | Notes |
|---|---|---|
| `memories` | `user_id`, `kind` (detector id), `key` (the pattern's identity, e.g. `habit:gym:mon,wed,fri:06:00`), `answer` (`kept` / `refused`), `payload` (the adjusted values you kept), `wrote` (what the Keep created: a slot id, a series id, a setting), `until` (a refusal's expiry), timestamps | RLS: own rows only |
| `plan_signals` | the planner's corrections (v2's migration row), plus Draft the path's keep / drop / edit | replaces `nuvo.planMemory.v1` in localStorage, so a refusal on the phone holds on the Mac |
| `user_settings.memory_learning` | the Keep learning switch | |
| `user_settings.memory_seen_at` | when you last opened Memory; drives the dot | |

Observations are never stored. A `memories` row is only what you said.

---

## 9 · Names (glossary on acceptance)

| Name | Means |
|---|---|
| **Memory** | The place, and everything Nuvo has learned that you answered |
| **Noticed** | An observation sure enough to ask you about (already used by Plan the week v2: same meaning) |
| **Still watching** | An observation Nuvo isn't sure of; seen only in Memory |
| **Rhythm** | The time chapter, and the Schedule view that draws it |

Retired on build: **Nuvo keeps** (v2's list in the planner rail) becomes Memory's *What Nuvo
uses* tab, filtered to the planner.

---

## 10 · Verify

- Detector tests over fixture accounts unlike persona zero's: empty; calendar only; a
  four-day week; a night-shift worker whose hours cross midnight; one habit only (Sunday
  morning). Each asserts what is **not** said as much as what is.
- A threshold test per detector on the period that almost qualifies, and one per confidence
  level.
- **Traceability test**: every consumer that changes a plan because of a memory emits its
  memory id. Fail on an untraced use.
- Battery scenarios for "when do I usually…?" and "what have you learned about me?", plus
  one that asks the chat to forget something (it must point to Memory, not do it).
- Driven in the dev app on a real account read-only, and on a fresh account with a calendar.

---

## 11 · Build order

1. **The store and the read.** `memories`, `plan_signals`, `useMemory`, the shared pure
   module. `planMemory` moves in. Nothing new on screen.
2. **Rhythm.** `domains.kind`, the 56-day window, detectors, per-weekday hours, the Schedule view.
3. **Memory panel and indicator**, on both shells, with Noticed / What Nuvo uses / Still
   watching / You said no and the trust controls.
4. **First run and Plan the week** read from Memory.
5. **Projects** (Draft the path signals), then **Work**, **Words**, **Initiatives**. Domains
   last, and only as Review evidence.

---

## 12 · Settled calls (Phil, 2026-11-13)

| Question | Settled |
|---|---|
| 56-day sync window, or a one-off history read? | **Widen the window** to 56 days |
| Does someone else's subscribed calendar count? | **No.** Owned calendars only |
| Store each domain's kind, so "work" is known? | **Yes.** `domains.kind`, from the first-run picker's five kinds |
| On the phone, a dot on the ✦ launcher, or a row in the chat? | **The dot**, replaced by a chat row if it reads as "Nuvo replied" |
