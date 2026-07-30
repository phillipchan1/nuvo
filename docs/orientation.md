# Orientation — two doors into the app

**Status:** shipped 2026-07-30 (desktop + phone, light + dark, driven in the dev app).
Builds on [`personas.md`](./product/personas.md) §5 rows **O1/O6** and the onboarding
layers described in [`design-language.md`](./design-language.md).

> *Some people want to be shown. Some want to be walked through. Guessing which one you
> have is how a walkthrough ends up either useless or patronising — so the welcome step
> asks.*

Nuvo's concepts are the hard part of Nuvo. The funnel has four altitudes and two acts, and
a first-time reader has to hold all of it before a single screen makes sense. The tour has
always taught with **rebuilt art** (`Visuals.tsx`), which is honest but leaves the reader
one translation short: they still have to map a diagram onto a screen they've never seen.

The obvious fix — coach marks over the live app — **fails on a cold account**, and that
failure is the whole design constraint. `AppShell.tsx` gates the shell on
`domains.length === 0`, so `FirstRun` runs *first*: by the time orientation opens, the
account has **1–5 domains the user just named and nothing else.** Four of the five ladder
steps would spotlight empty surfaces. Pointing at an empty Inbox teaches less than a
drawing of a full one.

So orientation doesn't choose. **It forks.**

## The fork

`ORIENTATION_STEPS[0]` (`welcome`) renders two doors instead of a Next:

| Door | What it is | Mode |
|---|---|---|
| **Show me around** | The 8-step visual tour, unchanged — art, no data required, ~2 minutes | `show` |
| **Walk me through it** | A docked panel that narrates over the live app while you act | `teach` |

The chooser has its own Skip, Esc closes it, and **Back from the first slide of either
path reopens the fork** — the other door is never more than one press away.

`mode` and the live path's step index are persisted (`nuvo.onboarding.{mode,step}`)
alongside the existing version flag, so a reload mid-walkthrough resumes rather than
restarting. Because `mode` persists and React state doesn't, the card path **clamps step to
≥ 1 in `show` mode** — otherwise a refresh lands on the welcome slide with the doors
already gone.

## The live door

The overlay **docks instead of covering**: a glass panel bottom-right on desktop, and above
the bar (clearing the ＋ and ✦ floating actions) on a phone. The app behind it stays fully
live and usable.

The model is deliberately thin: **the panel narrates, the user acts in the real UI, and the
step ticks from real data.** There are no act components and no mutation paths in
`TeachPanel.tsx` — capture goes through the rail's real capture form, a project through the
real create surface. Nothing to keep in sync, nothing taught twice.

| # | Step | Points at | Ticks when |
|---|---|---|---|
| 1 | Everything starts in your Inbox | the rail's capture form | an inbox task exists |
| 2 | Now give it a time | the rail list | a task has `do_date` + `start_time` |
| 3 | More than one task? That's a Project | the floor's ＋ (its empty-state teacher, or the deck's foot pill) | a project exists |
| 4 | More than one project? An Initiative | — *(art)* | — |
| 5 | It all rolls up to a Domain | the Domain wall *(navigation only)* | — |
| 6 | Ask Nuvo something | the ✦ badge | a user message exists in the thread |
| 7 | Bring your calendars in | — *(CTA)* | a calendar account exists |
| 8 | Let's make this week land | — | — |

Steps 1/2/3/6/7 are **exactly the five `GettingStarted` milestones, in order, read through
the same derivations** — this walkthrough *is* that tracker, performed live. Finishing it
retires the tracker through the path it already has, and clears the floors' empty states
because the floors now have data.

### Three rules that keep it honest

- **Step 4 stays a drawing on purpose.** An initiative is several projects; a day-one
  account has one. The panel says *"you won't need this today"* rather than staging a fake.
- **A step whose whole teach is *arriving* gets no orb.** The domain wall is navigation-only
  — an orb drawn around a whole wall is a rectangle with its edges off-screen, which reads
  as no spotlight at all. Same reason step 6 lights the ✦ *badge* and not the full-height
  agent rail: light the thing you can click.
- **Auto-advance only on a real transition.** A milestone already satisfied when the step
  opens shows its tick and *waits* — nobody should watch a step they didn't do fly past.
  The step captures a baseline on entry and only advances on not-done → done.

**Nothing gates.** Next is always live, Skip sits on every step, Esc leaves. A user who
hates walkthroughs is one key from an empty app they can drive.

## On a phone

The Build floors are desktop-only, so the live path **degrades rather than lies**: a step
with no phone target falls back to its art (Initiative, Domain) and the panel never
auto-navigates — it points at the ＋ FAB, the bottom-bar tabs, and the ✦ launcher, and the
user taps. Everything still ticks from the same derived data.

## Code map

| Concern | File |
|---|---|
| Both step registries + `ORIENTATION_VERSION` | `src/components/orientation/steps.tsx` |
| Target → selector / floor / phone equivalent | `src/components/orientation/teachTargets.ts` |
| The fork + the card path | `src/components/orientation/Orientation.tsx` |
| The docked panel, orb, and step driver | `src/components/orientation/TeachPanel.tsx` |
| `visible` · `mode` · `teachStep` persistence | `src/hooks/useOrientation.tsx` |

Targets are tagged `data-teach="<key>"` on the real elements (rail capture form, rail list,
`FloorGuide`'s action, the planner rail's ＋, the ✦ badge, the phone's FAB / tabs). Adding a
destination is one registry entry plus one tag — the same shape as
[`marquee.md`](./marquee.md)'s registry, which is where the orb CSS (`.marquee-orb`) and the
wait-for-target idea come from. **Marquee's *session* is deliberately not reused**: it is a
single held spotlight that ends the moment you self-navigate, which is the opposite of what
a multi-step tour needs.

## Not verified

The **auto-advance transition** is reasoned and its guard is observed (a pre-satisfied
milestone correctly does *not* skip), but the not-done → done path was never driven live:
in the builder's account every milestone except "ask Nuvo" is already satisfied, and
forcing that one costs agent tokens and writes to a real thread. First genuinely fresh
account should confirm it.
