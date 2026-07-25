# The landscape — who else is in this field, and what we refuse to copy

**Status:** canonical v1 (2026-07-25) · revisit quarterly; competitor facts drift fast.
**Purpose:** kill feature envy before it costs a sprint. The point of this doc is not to
track competitors — it's to be able to say *"they do that because of a constraint we don't
have"* and move on.

---

## 1 · The gap we own

Every tool in this space picks an altitude and stays there:

```
   deadlines ──────────────────────────────► the portfolio
                                             Asana · Linear · Notion · Monday
                                             "what matters"  ✅   "when"  ✗

        ??? no shared currency ???        ◄── THIS IS THE PRODUCT

   hours ─────────────────────────────────► the week
                                             Akiflow · Sunsama · Motion · Things
                                             "when"  ✅   "what matters"  ✗
```

The portfolio speaks **deadlines**. The week speaks **hours**. With no conversion between
them, *"am I over-committed?"* is unanswerable, and the important project dies in a board.
Nuvo's claim is the conversion itself (`required pace = remaining effort ÷ weeks to
target` — see [`commitment-model.md`](../commitment-model.md)).

**One sentence:** *Everyone else owns an altitude. We own the elevator.*

---

## 2 · The field

| Tool | Nails | Structural ceiling | We take | We refuse |
|---|---|---|---|---|
| **Akiflow** | Capture (⌥Space is the gold standard), calendar unification, time-blocking | The week is the ceiling — nothing above it, so a project can't be *behind* | The capture bar, the keyboard model, "one surface" | Command-bar-as-everything; a flat task universe |
| **Sunsama** | The daily planning ritual; calm, deliberate pacing | Same ceiling; the ritual costs more than it returns in a chaotic week | The ceremony idea (ours: Sunday · Sunrise · the Review) | A ritual you can't skip; guilt as a retention mechanic |
| **Motion** | Auto-scheduling; genuinely impressive optimization | It owns your day. When it's wrong, you have no model of *why* | Deadline-first placement in the composer | **Auto-commit.** Nuvo composes for you to *accept* (Principle 3) |
| **Reclaim / Clockwise** | Defending focus time against meeting sprawl | Calendar-only; no vertical, no intent | The idea of *protected* time → standing slots, project slots | Automatic defense with no human in the loop |
| **Things 3** | Taste. The best pure task app. Areas/Projects hierarchy | No calendar truth, no capacity, no pace | Restraint. Areas ≈ our domains | Beauty without arithmetic |
| **Todoist** | Ubiquity, natural-language dates, the quick-add lane | A flat list at scale; no time model | NL parsing; the fast composer's quick lane | Karma/streaks — wrong identity (Principle 9) |
| **Amazing Marvin** | Configurability; every methodology available | You must build your own product before using it | Nothing directly; a warning | Settings as a substitute for opinions |
| **Asana / Linear / Monday** | Portfolios, dependencies, real project structure | Team-shaped, deadline-only. Work enters and never lands on a Tuesday | Dependency thinking → the *In the way* lens | Multi-user objects (Principle 12) |
| **Notion / Obsidian** | Infinite modeling; the second brain | A blank canvas is a product you have to finish. Nothing schedules | Nothing | Databases-as-a-service; wiki drift |
| **Google / Apple Calendar** | Truth about meetings. Everyone already lives here | Zero intent — your priorities aren't on it, so they don't happen | We *integrate*, we don't replace. The mirror calendar means the phone still shows truth | Becoming a calendar client |

---

## 3 · What we're genuinely differentiated on

Ranked by defensibility — how hard it would be for the tool above to copy it:

1. **The elevator** — one row of truth from domain to a 40-minute block. A team tool can't
   do this without inventing a personal layer nobody would adopt; a week tool can't do it
   without inventing a portfolio nobody would maintain.
2. **Honest capacity** — demand ÷ capacity, calibrated against *your own proven pace* from
   completed blocks. Motion optimizes; nobody tells you *"you can't carry this."*
3. **Evidence-based closing** — the Review with receipts and one scored Find. Everyone
   else's weekly review is a text box.
4. **Multi-domain by construction** — domains as *areas you're called to be faithful in*,
   not folders. Family and church are first-class, not "personal" leftovers.
5. **Two shells, one bundle** — a real macOS app and a real installable phone app from one
   SPA, with a mirror calendar so your phone shows truth even outside the app.

## 4 · Where we're genuinely behind — say it out loud

- **Capture ubiquity.** Akiflow integrates with everything (Slack, Gmail, Notion…). Our
  capture is excellent but reaches fewer places. *A3 in the [Question Ledger](./personas.md)
  ("a promise I made that's nowhere in the system") is the live wound.*
- **Mobile depth.** Rituals, record screens, floors, and the real calendar pane are
  desktop-only. The phone is capture + agenda + Refine.
- **Onboarding.** Single-user and self-hosted-ish means the cold-start path is unpolished.
- **Grooming.** Three of the four lenses are spec, so keeping projects ready is still
  more manual than the model promises.

Being behind on these is fine. Being *surprised* by them isn't.

## 5 · The feature-envy guardrail

Before building anything you saw in another tool, answer all four in writing:

1. **What constraint makes that feature necessary for them?** (Usually: they're
   team-shaped, calendar-only, or monetizing engagement.) Do we share it?
2. **Which [Question Ledger](./personas.md) row does it close for *our* persona?** If none,
   stop.
3. **Which [principle](./principles.md) does it strain?** Auto-scheduling strains #3 and #4.
   Configurability strains #10. Streaks strain #9.
4. **What's our version?** Almost always: the same *job*, done in our grammar. Motion's
   auto-schedule → Sunday's *compose-and-accept*. Reclaim's defense → *standing slots.*
   Asana's dependencies → the *In the way* lens.

> The healthiest outcome of this exercise is usually a **no** with a sentence explaining
> why — which goes in [`decisions.md`](./decisions.md) so it stays a no.
