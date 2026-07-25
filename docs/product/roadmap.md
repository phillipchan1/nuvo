# Roadmap — bets, not a backlog

**Status:** living · reviewed at each Summit (quarterly) and after any shipping burst
**Last set:** 2026-07-25

**Rules of this file.**

1. Every item is a **bet with a question it closes** — cite the row from the
   [Question Ledger](./personas.md#5--the-question-ledger). *No question, no bet.*
2. **Status lives in each spec's own header,** not here. This is a map of intent; if the
   two disagree, the spec wins.
3. **Now** holds at most **three** things. A fourth means something moves out, not in.
4. Parked is a real destination, not a graveyard — it's how we say "yes, and not now"
   without carrying the idea in our heads.

---

## Now — the three

| Bet | Closes | Why now | Spec |
|---|---|---|---|
| **Grooming lenses — What / How / In the way** | Q3 ✳, Q4 ◐, Q5 ✳, D5 ○ | On Deck (the *When* lens) is built and is the hub. Three of four lenses being spec is the largest gap between what the model promises and what the app does. **D5 — "who's waiting on me" — is currently unanswerable anywhere in the product.** | [`grooming-lenses.md`](../grooming-lenses.md) |
| **Loose weeks** | W7 ◐, and the capture-punishes-you bug | A Wednesday capture currently scores against a plan made on Sunday, and a loose task has no way to say "not now, then" — the only object in the system that can't answer *which week?* This makes readiness dishonest, which attacks Principle 6. | [`loose-weeks.md`](../loose-weeks.md) |
| **Standing slots → finish the loop** | W5 ◐, D3 ◐ | Partially landed (`src/lib/standingSlots.ts`). Affinity-as-magnet during Sunday compose is the mechanism that keeps a non-work domain from starving — the failure mode named in every persona. | [`standing-slots.md`](../standing-slots.md) |

## Next — earned, not scheduled

| Bet | Closes | The case | Spec |
|---|---|---|---|
| **Project slots** | W1 (accuracy), Q1 | On Deck's capacity counts *generic* free time, so it can call a week "fine" when there's zero protected project time. This makes the flagship number optimistic — the one number that must never lie. | [`project-slots.md`](../project-slots.md) |
| **Activity sources (GitHub as instance #2)** | W8 ◐ | The calendar already proved the pattern; GitHub names it. Makes work that never became a task visible as *actuals*. Note Principle 10: this is the rare abstraction that **earned** its name via a second instance. | [`activity-sources.md`](../activity-sources.md) |
| **A "what would this cost me?" read** | W3 ○, W4 ◐ | Two unanswered rows, one mechanism: we already compute demand ÷ capacity — showing the delta of adding or cutting one thing is arithmetic we own. Small surface, high answer-value. | *needs a spec* |
| **Retire `TendingFlow`** | — (Principle 11) | Two grooming paths is drift. Blocked on Q-04 in [`decisions.md`](./decisions.md). | — |
| **Transitional CTA on the marketing site** | funnel (brandscript §5) | Direct CTA only today. The lowest-cost, highest-leverage marketing gap. Q-05. | — |

## Later — believed, not designed

- **Watch capture via Shortcuts → the `agent` endpoint.** Feasibility already written
  ([`APPLE_WATCH.md`](../APPLE_WATCH.md)); zero app review. Closes part of A3.
- **Capture ubiquity** (the honest answer to A3 ○ — "a promise nowhere in the system").
  Our weakest position vs. Akiflow. Shape unknown; start from where promises are *made*
  (Slack, mail, hallway) rather than from an integrations list.
- **Mobile vertical** — floors/records on the phone. Blocked on Q-01.
- **Refusal as a first-class act** at Summit. Blocked on Q-02.
- **Series → mirror calendar**, once there's a batched writer (D-010).
- **Onboarding / cold start** — everything must be useful with an empty backlog
  (Principle 7); today the first week is unproven.

## Parked — decided *not now*, on purpose

Anything in [`decisions.md`](./decisions.md) §2 (the N-list) plus:

- Phase 2 LifeOS surfaces (anything beyond running a full quarter end-to-end).
- `packages/design` full extraction (N-09).
- Any team/collaboration shape (N-02).

---

## The quarterly roadmap ritual

At each **Summit**, in this order — it's the same walk as the [audit](./audit.md), one
altitude up:

1. **Re-score the Question Ledger** against the *running app*. Rows that slipped are the
   first candidates for Now.
2. **Check Now against the ledger.** A bet whose question got closed some other way is done
   — move it out.
3. **Re-read [`decisions.md`](./decisions.md) §2.** Has any N-item gotten new information?
   If not, it stays parked and stops costing you thought.
4. **Answer one open question** (§3 of the decision log). One per quarter is enough.
5. **Set the three.** Not four.
