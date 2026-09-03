# Keeping Nuvo fast while it grows

**Status:** live · guards run on every push (`npm test`), the budget runs on demand (`npm run perf`)
**Why this exists:** [`perf-audit-2026-09-03-schedule.md`](perf-audit-2026-09-03-schedule.md)

---

## The problem this solves

Three separate perf regressions shipped into `master` in 2026, and **every one passed typecheck,
passed the full test suite, and looked like a purely visual change**:

| Landed | What it did | What it cost |
|---|---|---|
| `cf2cc32` "Warm Paper" | `backdrop-filter` on `.fc-event` | one compositing layer **per event** — 87 on a lived-in week |
| `c557404` "Aurora" | `backdrop-filter` on `.app-shell` + `.app-canvas` | two nested **full-window** blurs that rendered **nothing** |
| (drift) | `.fc-event` transitioning `box-shadow` | every click animated a 60px-blur shadow, against the design law |
| (original) | `syncCalendarEvents` mutating one event at a time | paging a week = 24,184 forced layouts, a **1,467ms frame** |

None of them were bad code. They were reasonable-looking changes whose cost is invisible in source
review and in a JS-only profile. That is the gap this closes.

---

## Two tiers, deliberately

### Tier 1 — `npm test` (every push, milliseconds, no browser)

`tests/perf-budget.test.ts` encodes the *classes* of mistake above as static assertions:

- no `backdrop-filter` on a full-bleed structural container (`.app-shell`, `.app-canvas`,
  `.app-ground`, `.atmosphere`, `.nuvo-cal-host`) — their backdrop is flat, so the blur is a
  mathematical no-op at full cost
- no `backdrop-filter` on `.fc-event` — one layer per block; `.evt-focused` is exempt (one at a time)
- a **budget on how many blurred surfaces exist at all** (currently 16)
- `.fc .fc-event` transitions **only `filter`** — the design law says the Schedule's lift is instant
- the calendar reconcile stays wrapped in `batchRendering`

Each was verified by **replaying the real regression** and watching the guard fail. They are not
hypothetical.

Also enforcing structure: `tests/calendar-element-stability.test.ts` (the `<FullCalendar>` element
must stay memoized, with no ticking value in its deps) and `tests/sync-calendar-events.test.ts`
(every mutation happens inside the batch).

### Tier 2 — `npm run perf` (on demand, real browser, real numbers)

```bash
npm run dev          # in another shell
npm run perf
```

Drives a real, visible Chrome over CDP (zero dependencies — Node's global `WebSocket`) through every
interaction in `scripts/perf/interactions.mjs` and checks each against
`scripts/perf/budgets.json`. Non-zero exit on a breach.

| flag | effect |
|---|---|
| `--update` | re-baseline budgets from this run (then explain it in the commit) |
| `--headful` | watch it drive |
| `--url=…` | point at another port |
| `--repeats=N` | trials per interaction (default 3, median reported) |

**Run it before shipping anything that touches a shared surface** — the calendar, the rail, the
floors, `index.css`, or any data hook the Schedule reads.

---

## The three metrics, and why these

- **`forcedLayout`** — every `getBoundingClientRect`, `offset*` getter and `getComputedStyle`.
  **This is the metric that found every real regression.** It is deterministic and it *is* layout
  thrash, rather than a proxy for it. Prefer it to wall-clock when comparing two builds.
- **`blockedMs`** — long tasks. What "the app froze" actually means.
- **`dropped` / `worstFrameMs`** — real frame pacing.

---

## Two traps that cost hours; do not re-learn them

**1. A hidden browser tab silently invalidates everything.** It clamps `setTimeout` to 1000ms and
**never runs `requestAnimationFrame`**. Frame pacing then reads as perfect, timing reads as noise,
and any rAF-coalesced code under test never executes. Two rounds of this audit were measured that
way and one fix was wrongly assessed because of it. `npm run perf` launches its own visible browser
for exactly this reason — never measure in a background tab.

**2. Synthetic events are not trusted events.** `el.dispatchEvent(new MouseEvent(...))` does not
produce Event Timing entries (so INP reads 0) and does not arm libraries that check `isTrusted` —
FullCalendar's dragger among them, which is why drag could not be measured at all until this rig
used CDP `Input.dispatch*`.

---

## Adding a feature without giving back the wins

1. **Adding a surface?** Add it to `scripts/perf/interactions.mjs`. An interaction nobody measures is
   one nobody notices getting slower. Alternate the action on `i` so a repeat genuinely changes
   state — clicking "Inbox" when already on Inbox measures nothing and reports a perfect score.
2. **Reaching for glass?** It costs a compositing layer and a blur of everything beneath it,
   recomputed whenever that backdrop changes. Ask what is actually behind it: **over a flat or
   linear backdrop a blur is a no-op at full price.** Prove it with a screenshot before *and* after
   rather than assuming it reads differently.
3. **Anything that repeats per row/event/card** is the dangerous multiplier. One blur is free;
   eighty-seven is the app.
4. **Mutating a third-party view in a loop?** Look for its batching API first. Eighty
   `addEvent` calls were 1,475ms; the same eighty inside `batchRendering` were 73ms.
5. **Changing something the design language documents?** Check
   [`design-language.md`](design-language.md) first — the `box-shadow` transition was a *drift from*
   the documented law, so the fix restored intent rather than trading it away.
6. **WebKit is not Chromium.** Nuvo.app runs WKWebView, where `backdrop-filter` and forced layout are
   markedly dearer. A Chromium number is a lower bound on what the desktop app pays.

---

## Why Tier 2 is not in CI

It needs a dev server, real credentials, and a real Chrome — and its budgets scale with **how much
data the account holds**, so a shared runner would be flaky in a way that trains people to ignore it.
A perf check that cries wolf is worse than none.

The path to CI-ing it, if that changes: point the rig at a fixture-backed harness route (the repo
already renders surfaces over fixtures at `?horizon`, `?build`, `?domains`, `?weekcrown`, `?year`)
so the data volume is fixed. Until then Tier 1 holds the line automatically and Tier 2 is the
operator's tool.
