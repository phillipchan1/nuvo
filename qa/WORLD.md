# The seeded world

What the QA account holds right after `npm run qa:seed`. Scenarios write these
records in «guillemets». Source of truth: `scripts/qa/fixture.mjs` — this page
describes it; a test fails if a scenario names a seeded record the fixture lacks.

All dates are relative to the day the seed ran, in `America/Los_Angeles`.
Weeks start **Monday**. Working hours 9:00am–5:30pm. Theme: light. The welcome
walkthrough is already marked seen.

> **Seeded for an early-morning run.** Today's blocks start at 7:15am. Seed and run
> before then (see `RUNBOOK.md`), or past blocks show as late/missed.
>
> **Google Calendar is not connected.** The seed can't create calendar events
> (they come only from a real provider). Scenarios that need meetings are marked
> `Manual:` unless the person running you connected a test Google account.

## Domains — four

| Domain | Weekly target | Intention |
|---|---|---|
| «Studio» | 25h | Ship work clients feel |
| «Family» | 8h | Be home when home |
| «Health» | 5h | Move every day |
| «Side project» | 4h | Small, steady |

## Initiatives — two

- «Q4 relaunch» (Studio) — in progress, started 3 weeks ago, ends in ~6 weeks.
  Key result: «Annual plan signups» 12 of 40.
- «Home reset» (Family) — in progress.

## Projects — eight

**On this week** (start Monday, target Friday):
- «Marketing site v2» (Studio · Q4 relaunch). It has one comment: "Client wants the Fernwood study first."
- «Billing migration» (Studio · Q4 relaunch)
- «Garage clean-out» (Family · Home reset)
- «Meetup talk» (Side project, no initiative)

**Not on the week** (backlog):
- «Pricing page experiment» (Studio · Q4 relaunch)
- «Family photo book» (Family)

**Parked** (waiting): «Shed roof repair» (Family · Home reset)

**Shipped** last week: «Newsletter relaunch» (Side project). Both of its tasks are done.

The week's goal: «Site live, billing cut over».

## Tasks

**Inbox** (no date, no project), in this order:
«Reply to Dana about the venue» (label *calls*) · «Renew passport» (priority high) ·
«Look into standing desk» · «Schedule dentist» · «Read: Shape Up ch. 3» (low) ·
«Return the router» (label *errand*)

**Today**:
| Time | Task | Notes |
|---|---|---|
| 7:15am, 40m | «Run» | Health |
| 8:30am, 15m | «Invoice October retainer» | **already done** |
| 9:00am, 90m | «Write case study: Fernwood» | Marketing site v2, high priority |
| 11:30am, 45m | «Review billing cutover plan» | Billing migration |
| 3:15pm, 30m | «Pick up kids» | Family |
| 5:00pm, 15m | «Shutdown review» | repeats every weekday |
| anytime | «Call the plumber» | Family, label *calls*, has notes with a phone number |
| anytime | «Order printer ink» | label *errand* |

**Earlier this week** (only if today isn't Monday): a done «Inbox zero» block each
morning at 8:00am, done «Shutdown review»s, and one task left behind on Monday at
2:00pm: «Draft migration email to customers» — the app may have rolled it to today.

**Later this week**: «Homepage hero copy» tomorrow 10:00am · «Rehearse talk (run 1)»
tomorrow 7:30pm · «Haul boxes to donation» the day after tomorrow 10:00am.

**On the week, no time yet** ("loose"): «Case study: Northpine» · «Redirect map for old URLs» (Marketing site v2) ·
«Map old plans to new plans» · «Test proration on staging» (Billing migration) ·
«Sell the old tablesaw» (Garage clean-out) · «Outline talk» · «Build demo repo» (Meetup talk)

**Backlog of off-week projects**: «Design annual toggle» · «Set up experiment flag»
(Pricing page experiment) · «Pick 40 photos» (Family photo book)

**Trash**: «Old gym membership form» (trashed yesterday).

## Calendar blocks (slots)

- **Wednesday 1:00–3:00pm** — a «Marketing site v2» sitting holding «Case study photos» and «Nav + footer pass».
- **Friday 9:00–11:00am** — «Deep work» (Studio), empty.

## Recurring

- «Shutdown review» — every weekday at 5:00pm, 15m, Studio.

## Labels

«calls» · «errand»
