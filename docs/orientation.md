# Orientation — two doors into the app

**Status:** shipped 2026-07-30 · revised the same day after a first real walk-through
(every step now highlights, travels, and opens what it's describing).
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

| # | Step | Opens | Lights | Ticks when |
|---|---|---|---|---|
| 1 | Let's add your first task | Schedule | the rail's capture form | an inbox task exists |
| 2 | There it is — your Inbox | Schedule, rail on **Inbox** | the Inbox tab | — |
| 3 | Now give it a time | Schedule, rail back on **Today** | the rail list | a task has `do_date` + `start_time` |
| 4 | More than one task? A Project | Projects | the floor's ＋ (empty-state teacher, or the deck's foot pill) | a project exists |
| 5 | More than one project? An Initiative | Initiatives | the floor's ＋ | — |
| 6 | It all rolls up to a Domain | the Domain wall | the **first domain card** | — |
| 7 | This is Nuvo. Ask it something | the **agent rail, opened** | the chat composer | a user message exists |
| 8 | Bring your calendars in | **Settings → Calendars** | that pane | a calendar account exists |
| 9 | Let's make this week land | back to the Schedule, overlays closed | — | — |

Steps 1/3/4/7/8 are **exactly the five `GettingStarted` milestones, in order, read through
the same derivations** — this walkthrough *is* that tracker, performed live. Finishing it
retires the tracker through the path it already has, and clears the floors' empty states
because the floors now have data.

### The rules that keep it clear, and honest

- **Every step highlights something, and the spotlight is a real spotlight.** A `.teach-dim`
  layer sits *above* the modal layer with a box-shadow cut-out on the target, so a
  first-timer's eye has exactly one place to land. It's `pointer-events: none` — the app
  stays fully usable while it's lit.
  **The scrim is one token, `--teach-scrim`, and it took three passes to land:** mixing with
  `--bg` washes out entirely in light mode (a highlight nobody can see is no highlight);
  pure black at 0.7 brings focus but reads as *overwhelming*, and neutral black over warm
  paper is colder than anything else in the app. It settled on a **warm** brown-black at
  **0.45** in light and **0.42** in dark (dark starts dark, so the same alpha lands
  heavier). The job is to *quiet* the surroundings, not black them out — the target's own
  ring does the pointing, and the reader should still see the surface being shown to them.
- **Light the thing you can click, never the container.** An orb around a whole wall, or the
  full-height agent rail, is a rectangle with its edges off-screen — it reads as nothing.
  So: one domain card, not the wall; the chat composer, not the 380px rail.
- **A step opens what it's about to talk about** (`arm`). Describing the chat while the chat
  is shut, or the Inbox while the rail shows Today, loses the reader instantly.
- **Step 5 navigates but expects nothing.** They won't create an initiative on day one — an
  initiative is several projects and a fresh account has one. But *"nothing to do here
  today"* only lands once you've been shown where it would go, so the step travels like
  every other one and simply asks for nothing.
- **Auto-advance only on a real transition.** A milestone already satisfied when the step
  opens shows its tick and *waits* — nobody should watch a step they didn't do fly past.
  The step captures a baseline on entry and only advances on not-done → done.

### Two bugs worth not re-introducing

Both were invisible to typecheck and only showed up by walking the thing:

1. **The pointing effect must not depend on the nav helpers.** Navigating changes their
   identity, so listing them as deps makes the effect re-run *as a result of its own
   navigation*, clear `orbSel`, and cancel the in-flight `waitForTarget`. The tell is
   diagnostic: every step that stays on the current floor lights, and every step that
   travels silently doesn't. They're held in a `drive` ref; the deps are the step alone.
2. **Close-then-navigate must be one patch.** `closeOverlay` prefers `history.back()`, which
   lands async and gets clobbered by a `navigate()` in the same tick (the same race behind
   the old "⌘K does nothing" bug). Closing Settings and moving to the next floor are issued
   as a single synchronous `navigate({ overlay: "none", rung })`.

**Nothing gates.** Next is always live, Skip sits on every step, Esc leaves. A user who
hates walkthroughs is one key from an empty app they can drive.

## On a phone

The Build floors are desktop-only, so the live path **degrades rather than lies**: a step
with no phone target falls back to its art (Domain) and the panel never auto-navigates — it
points at the ＋ FAB, the bottom-bar tabs, and the ✦ launcher, and the user taps. Everything
still ticks from the same derived data. The calendars step deliberately has no phone entry:
`MobileShell` owns its own settings state rather than the nav overlay, so `open-calendars`
would be a no-op there — the step's CTA opens it instead.

## Code map

| Concern | File |
|---|---|
| Both step registries + `ORIENTATION_VERSION` | `src/components/orientation/steps.tsx` |
| Target → selector / floor / phone equivalent | `src/components/orientation/teachTargets.ts` |
| The fork + the card path | `src/components/orientation/Orientation.tsx` |
| The docked panel, orb, and step driver | `src/components/orientation/TeachPanel.tsx` |
| `visible` · `mode` · `teachStep` persistence | `src/hooks/useOrientation.tsx` |

Targets are tagged `data-teach="<key>"` on the real elements (rail capture form, Inbox tab,
rail list, `FloorGuide`'s action, both planner rails' ＋, the first domain card, the agent
composer, the Calendars pane, the phone's FAB / tabs). Adding a destination is one registry
entry plus one tag — the same shape as
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
