# Nuvo — Readiness: the funnel made visible

*Design proposal · June 2026*

This sits **on top of** [`execution-flows.md`](./execution-flows.md) (the rituals + the
pool/gate state model) and [`design-language.md`](./design-language.md) (Warm Paper).
Where execution-flows defines the *flows* (the walk) and the *gate* (the Week), this
defines the **readiness layer** — the always-on, gentle signal that tells you where the
funnel needs you, and that turns "everything groomed" into a *felt* reward instead of a
ledger of debt.

---

## 1 · The thesis

Nuvo is a **funnel**: intent narrows down the altitudes (Domain → Initiative → Project →
Week → Day) into *meaningful work every week, made visible.* Each altitude is kept
flowing by a ceremony, and **each ceremony's output is "readiness for the floor below."**
The product only delivers if the floors stay ready — but the ceremonies were hidden
behind a hover chip (`Spine.tsx`), so nothing tells you a floor is starving, and the
pitch (intelligent, informed scheduling) silently depends on a lift the app never asks
for. This layer surfaces that demand — in the steward's voice: **the app reports, you
decide.** It never commands, never shames, never auto-acts.

## 2 · One definition of "ready"

> A floor is ready when its open contents are **settled — each one either moving toward
> the floor below, or deliberately at rest.** Not "finished."

This is the load-bearing choice, and it's the whole defence against the app feeling like
a wall of incompleteness. The Zeigarnik nag is discharged by a **plan**, not by
completion (Masicampo & Baumeister 2011; GTD "mind like water"). So a deliberately
parked item is *settled by choice*, never debt — and a floor can reach calm without you
finishing your life. Calm becomes reachable weekly, which is the point.

```
settledScore(item) ∈ [0,1]
  complete / shipped      → 1
  resting (parked)        → 1     ← settled by choice, NOT 0 (see §7 gotcha)
  otherwise               → effectiveScore   (existing, soundness-aware:
                                              active-but-unsound = 2/3)

readiness(floor) = mean(settledScore over open ∪ resting items)
  empty floor → 1   (nothing to ready = ready)
```

## 3 · "Ready for the floor below," per altitude

Same shape everywhere, different contract — because each floor grooms for a different
consumer:

| Floor | Its items | "Ready" means | Meter source | The one cue |
|---|---|---|---|---|
| **Domain** | open initiatives (+ domain-level projects) | bets clear enough for projects to run | structural readiness | faithfulness — "untouched this week" (invested &lt; target / last-touched) |
| **Initiative** | open initiatives | projects defined enough to run | `ripenessOfInitiative` rollup | "N drifting" (silent) · "N to ready" (raw) |
| **Project** | open projects | tasks sized + a finish line, so the week can take them | `ripenessOfProject` rollup | "N drifting" · "N to ready" |
| **Week** (Schedule) | this week's committed tasks | the week is decided **and** every task traces to a domain | `composed × attributed` | "plan the week" (window open, not composed) · "N loose this week" |
| **Day** (Today) | today's commitments | today is sequenced, nothing orphaned | share shaped/ordered | "order today" |

Note the **two axes on Domain**: the meter is *structural* readiness (ready for the
floor below); *faithfulness* (did you spend time there) is a separate signal — it drives
the cue and the existing chapel lamp, not the meter. They mean different things and must
not be blended.

The Week's `attributed` term is the **up-flow**: loose / miscategorised tasks don't trace
to a domain, so they leak the "visible" half of the deliverable (domain balance
under-reports). That leak surfaces here as "N loose this week," and the intelligence that
fixes it is attribution (reuse `parseCapture` + the agent).

## 4 · Calm by default, exceptions only

The meter and the cue are **decoupled**: the meter is the ambient *state* (how ready);
the cue is the single highest-priority *exception* (what's actually slipping).

- A floor renders **calm** when `readiness ≥ CALM` (≈ 0.85) **and** it has zero
  exceptions — quiet line, no cue, meter in the calm tone.
- A floor raises **one** cue (its top exception), never a list. Exception sources, in
  priority order, reuse `readTending` where they already exist: `silent` (in-flight,
  undated, quiet ≥ 14d) → raw-and-imminent → domain faithfulness → week not-composed →
  week loose → day unordered.

This is the anti-deficit rule made literal: you never see "everything that isn't 100%";
you see the one or two things genuinely at risk — usually few, often none. (Negativity
bias + calm-technology: an ambient surface should recede until it's relevant.)

## 5 · The surface — where it lives

**Desktop — it *is* the spine.** The spine already lists the five altitudes
(`Spine.tsx` `RUNGS`). The readiness gauge attaches to each rung, **replacing the
hover-only ◇ chip** (`Spine.tsx`, the `group-hover` block). The hover chip is exactly the
thing this kills: invisible at rest, signals unimportant, no mobile path.

Warm-Paper rules this must obey:
- **Transparent rail** (cardinal rule — never an opaque bg over `.atmosphere`). The gauge
  is hairline elements on the paper, not a panel.
- **Reuse the existing atoms**: the meter is `Bar` (`parts.tsx`) with a `--line` track;
  the cue is a `RipenessPip` or a low-sat dot. No new visual vocabulary.
- **Semantic color only**: domain color on the Domain rung; `--accent` = invitation
  (window open); the established caution amber (`RIPE_AMBER` / `PROJECT_STATUS_COLORS.waiting`)
  = needs readying. Never a new hue.
- **140px constraint** (`--spine-width`): the cue *label* won't fit inline. So — the
  meter + cue *dot* are always visible (discoverable, no hover); hovering/focusing a rung
  reveals the labeled cue **and the inline ceremony entry** (e.g. "Shape these 3 bets →"),
  replacing the floating popover. The demand's *existence* is never hover-gated; only its
  detail is progressive.
- The active-rung glass pill stays exactly as is.

**Mobile — no spine, and the Build floors aren't mounted** (Project / Initiative / Domain
are desktop-only). So the gauge distils:
- **Day + Week readiness are actionable on mobile** → they ride the Now screen's woven
  demand line ("your week composes from 6 ready items — 3 more are one step away") and a
  gentle cue badge on the **Plan** tab.
- **Build-floor demand is *not* actionable on mobile** → surface it as quiet *awareness*
  that routes to the **Nuvo** chat (which can help) or notes "tend on desktop." Never a
  cue that leads to a dead end.
- The "all at rest" state (§6) appears as a serene confirmation on Now.

## 6 · The reward state

Reward the **act** — the Tending Yield already does this (the readiness meter rising,
"you ripened 3 items"). And design the **resting state as the prize**: when a floor
crosses into ready, and when the *whole spine* is calm, the surface changes character
(the chapel idiom) — serene, settled, "mind like water." This is the magnet the entire
gauge trends toward, and it's the one genuinely *new* build (everything else in §2–§5 is
framing on data we already compute). Peak-end rule + competence (SDT): the experience is
judged by its peak and its end, so make crossing-into-ready and all-at-rest feel earned.

Bigger asks ride **fresh-start landmarks** (Dai/Milkman/Riis 2014): the ambient gauge
stays quiet day-to-day; the invitation to deeply ready-up concentrates at the boundary
windows (Sunday, the Summit) when the motivation to begin is naturally high. Continuous
asking reads as nagging; landmark asking reads as ritual. Always show the **near-term**
payoff ("this makes *this* week composable") to beat present bias.

## 7 · Code shape

- **New `src/lib/readiness.ts`** — pure over a `VerticalData` snapshot (+ sprint / day),
  exactly like `tending.ts` / `standback.ts`. Exports: `settledScore`,
  `readinessOf{Domain,Initiative,Project,Week,Day}`, `floorReadiness(rung)` and
  `floorException(rung)` for the spine, and `spineReadiness()` + `allAtRest` for the
  rollup / reward state.
- **Reuse, don't duplicate**: `effectiveScore` / `readTending` / `silent` / `raw`
  (`tending.ts`), `readDay` / `toBusyBlocks` (`now.ts`) for day/week shape, and the
  derived faithfulness / sprint data (`vertical.ts`, per execution-flows §7).
- **`Spine.tsx`** — per-rung meter + cue replacing the hover chip; active glass pill
  unchanged.
- **Mobile** (`NowFloor` / `MobilePlan`) — the demand line + Plan-tab cue.

**Gotcha:** do **not** roll up readiness with the existing `tendedScore` — it returns `0`
for resting items (`effectiveScore ?? 0`), which would make a deliberately-parked item
*drag a floor down* and break "calm." `settledScore` must score resting as `1`. This one
sign flip is the difference between calm-is-reachable and the deficit trap. `effectiveScore`
is currently un-exported in `tending.ts` — export it (or lift `settledScore` there).

## 8 · Open knobs (tune against the running app, not in the abstract)

- `CALM` threshold (≈ 0.85?) — where a floor goes quiet.
- Week-readiness weights — `composed` vs `attributed` split.
- Domain meter — structural-only (recommended) vs blended with faithfulness.
- Faithfulness window — what counts as "untouched."
- Day-readiness definition — how much "shaped" is shaped.
