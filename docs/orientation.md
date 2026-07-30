# Orientation — set up your first week, together

**Status:** shipped 2026-07-30 · revised twice the same day — every step highlights,
travels and opens what it names (D-064's law card), and first-run went from a fork to a
single welcome (D-065).
Builds on [`personas.md`](./product/personas.md) §5 rows **O1/O6** and the onboarding
layers described in [`design-language.md`](./design-language.md).

> *A diagram of a screen you've never seen teaches less than the screen, with your own work
> in it. So the walkthrough doesn't describe the app — it hands it to you.*

Nuvo's concepts are the hard part of Nuvo. The funnel has four altitudes and two acts, and
a first-time reader has to hold all of it before a single screen makes sense. Teaching that
with **rebuilt art** is honest but leaves the reader one translation short.

The obvious fix — coach marks over the live app — **fails on a cold account**, and that
failure is the design constraint the whole thing is shaped around. `AppShell.tsx` gates the
shell on `domains.length === 0`, so `FirstRun` runs *first*: by the time orientation opens,
the account has **1–5 domains the user just named and nothing else.** Most of the ladder
would spotlight empty surfaces, and pointing at an empty Inbox teaches less than a drawing
of a full one.

So the walkthrough **teaches by making the thing exist** — every row it lands is created by
the user, in their words (D-026 holds: we still seed nothing) — and closes by naming the
rule they just lived through.

## The welcome

One screen, one promise, one button (D-065). Not a dialog-shaped card with a feature
diagram: full warm paper, a Fraunces line, generous air, and *Walk me through it*.

The promise comes from the canon rather than fresh copy — [`personas.md`](./product/personas.md)
defines success as *"Sunday takes 20 minutes and ends with a week you believe"* and names
the real failure as a domain going dark **silently**. The hero art is the funnel as a
feeling: loose motes gathering into one calm line, no labels, no altitude vocabulary. (The
word *life* stays out — D-057 keeps it to marketing.)

There was briefly a second door — a card tour of rebuilt art. It's retired: a diagram makes
the reader map a picture onto a screen they've never seen, which is the problem the live
path exists to remove, and Skip/Esc already served the "just show me" case.

`mode` and the step index are persisted (`nuvo.onboarding.{mode,step}`) alongside the
version flag, so a reload mid-walkthrough resumes rather than restarting.

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
| 4 | More than one task? A Project | Projects | the floor's ＋ (empty-state teacher, or the deck's foot pill) *+ the Spine rung* | a project exists |
| 5 | More than one project? An Initiative | Initiatives | the floor's ＋ *+ the Spine rung* | — |
| 6 | It all rolls up to a Domain | the Domain wall | the **first domain card** *+ the Spine rung* | — |
| 7 | This is Nuvo. Ask it something | the **agent rail, opened** | the chat composer | a user message exists |
| 8 | Bring your calendars in | **Settings → Calendars** | that pane | a calendar account exists |
| 9 | **Now — the rules that make it sing** | back to the Schedule, overlays closed | — | — |

Steps 1/3/4/7/8 are **exactly the five `GettingStarted` milestones, in order, read through
the same derivations** — this walkthrough *is* that tracker, performed live. Finishing it
retires the tracker through the path it already has, and clears the floors' empty states
because the floors now have data.

### The rules that keep it clear, and honest

- **Every step highlights something, and the ring is what does the pointing.** A
  `.teach-dim` layer sits *above* the modal layer with a box-shadow cut-out on the target,
  `pointer-events: none` so the app stays usable.
  **The scrim is one token, `--teach-scrim`, and the honest answer is that it should barely
  exist** — warm brown-black at **0.1** light / **0.14** dark. Getting there took four
  passes: mixing with `--bg` is invisible in light mode (a highlight nobody can see is no
  highlight); 0.45 is comfortable; 0.7 brings focus but reads as *overwhelming* and hides
  the surface the reader is supposed to be getting familiar with. The ring and glow were
  always doing the work — a heavy overlay makes the app feel **locked** rather than pointed
  at. Keep it a breath, not a blackout.

- **Travelling needs a second, quieter highlight — the Spine waypoint.** Changing floors
  with only the action lit reads as the app jumping on its own: a new screen appears and
  nothing says what moved or how to get back. So a step that travels also rings its Spine
  rung (`waypoint` in the registry), at half the voice of the main orb — no breathing, a
  tighter radius, lower alpha. It answers *where am I now*, which is context; the main orb
  answers *what do I click*, which is instruction. If they pulled equally the step would be
  pointing at two things at once. Phone steps don't need it — the bottom tab is already the
  primary target there.
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

- **The law comes last, and it's the shortest screen.** Stated up front, rules are terms of
  service — vocabulary with nothing to attach to. Stated after the reader has done all
  three, they consolidate a pattern already felt. Hence the closing card (D-064): *a task
  earns a day by getting a time · a project earns a week by having tasks · an initiative
  earns a quarter by having projects*. **"Earns", never "requires"** — an undated Backlog
  task is a legitimate resting state, so "every task needs a time" would be false on the
  second screen they visit.

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
