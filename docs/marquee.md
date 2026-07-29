# Marquee — Nuvo drives the canvas

> *Nuvo puts it in the limelight.*

Marquee lets the agent **show** an answer *alongside* telling it. When you ask Nuvo
something that lives on a screen — "what are my priorities this week?" — it brings
that surface forward and holds a warm **limelight orb** on the thing it's pointing
at, while the chat gives a real, self-contained reply. The visual reinforces the
words; the chat never depends on it.

It's a **held session, not a flash.** The glow persists until *you* act, and when
Nuvo moved you to get there, a **return pill** ("Nuvo brought you to Week's Plan ·
← Back") makes the takeover visible and one-tap reversible.

## How it scales — the vocabulary is data, not code

The thing that would otherwise rot is the agent's *vocabulary* (what it can point
at). Marquee keeps it from rotting by a single rule: **the vocabulary lives in a
client-side registry and is sent to the agent on every request.** The edge function
is generic — it only relays "point at `<key>`" — so **it never changes as targets
grow.**

`src/lib/marqueeRegistry.ts` is the single source of truth. Each target carries a
`nav` descriptor — how to bring it forward — so one registry covers every kind of
destination:

```ts
export type MarqueeNav =
  | { kind: "rung"; rung }                       // a floor (Today, Projects…)
  | { kind: "surface"; surface; rung }           // a local surface (Week's Plan)
  | { kind: "tab"|"calview"; …; rung }            // a rail tab / calendar view
  | { kind: "flow"; flow }                        // a ritual (Sunday, Refine…)
  | { kind: "settings"; section? }                // the settings overlay
  | { kind: "record"; entity: "project"|"initiative" } // a record — needs `ref`
  | { kind: "domain" } | { kind: "task" };        // open domain / task — need `ref`

export const MARQUEE_TARGETS: MarqueeTargetDef[] = [
  { key: "priorities", label: "Week's Plan", spotlight: "priorities",
    nav: { kind: "surface", surface: "week-plan", rung: "day" }, describe: "…" },
  { key: "project", label: "the project", entity: true,
    nav: { kind: "record", entity: "project" },
    describe: "A specific project's record. Pass the project's id as `ref`. …" },
  // …~22 entries: 5 floors, 4 entity records, Week's Plan + sections,
  //   Today sections, inbox, spread, 5 flows, settings.
];
```

**Two kinds of target:**
- **Static** — a fixed place (floor, surface, flow). The agent just names the `key`.
- **Entity** (`entity: true`) — a *specific item*. The agent passes its id as `ref`
  (it has ids in context); the controller opens that record. This is what "show me
  the Meridian 2 project" needs.

**To make a new destination pointable — one entry (+ a tag for spotlights):**
1. Add a `MARQUEE_TARGETS` entry: `key`, `label`, agent-facing `describe`, a `nav`
   descriptor, optional `spotlight` key, `entity: true` if it needs a `ref`.
2. For an in-surface spotlight, tag the element: `data-marquee="<key>"`.
3. A brand-new local surface also needs its owner to listen for
   `MARQUEE_OPEN_EVENT` / `MARQUEE_CLOSE_EVENT` (see Planner.tsx).

No edge change, no prompt edit, no redeploy. `marqueeManifest()` flows to the agent
in `useAgent.ts`; the edge's `buildPointAtTool(manifest)` builds `point_at`'s enum +
description (+ the `ref` param) from it each request, so the vocabulary is always
current. The controller (`Marquee.tsx`) interprets `nav` against `useAppNavigation`,
and adapts the return-pill / auto-clear to each kind (rung change, overlay close, or
flow close).

## The one concept — a `ui` channel on the agent reply

Alongside its prose, actions, and suggestions, the agent can return a **directive**:

```ts
// src/lib/marquee.ts — types stay loose (string keys); the registry validates.
interface MarqueeDirective {
  spotlight?: { target: string; label?: string }[];  // light these, in order
  caption?: string;                                  // short tag (the orb's poetry)
}
```

The agent sends only the **target key**; the client resolves *where it lives*
(surface, rung, pill label) from the registry. `target` is constrained by the
per-request enum — the agent can't invent one — and a target is any element tagged
`data-marquee="<key>"`. Enum + registry, never raw DOM: that's the safety gate.

## End-to-end flow

1. **Edge tool** (`supabase/functions/agent/tools.ts`) — `point_at` is a UI-only
   tool: it mutates nothing, just relays `{ ui: { spotlight: [{ target }], caption } }`.
   Its schema is built per request by `buildPointAtTool(manifest)`, so the `target`
   enum reflects the client's live registry. The edge knows nothing about where a
   target lives — the client resolves that.
2. **Emit** (`supabase/functions/agent/index.ts`) — directives collected from the
   tool loop ride out on the `d` (done) SSE event: `{ ..., ui: directives[0] }`.
3. **Parse** (`src/hooks/useAgent.ts`) — `ui` is pulled off the done event and hung
   on the `AgentMessage`.
4. **Run** (`src/components/Marquee.tsx`) — a top-level controller watches the
   transcript; a new assistant message with `ui` triggers a **session**: capture
   the return point (current rung) → bring the surface forward → wait for the
   target → scroll into view → hold the orb + show the return pill.
5. **Orb** — a `prefers-reduced-motion`-aware portal (`.marquee-orb` in `index.css`)
   glowing in `--signal`, repositioned to the target on every scroll/resize so it
   stays pinned as the page moves. **Persists** until the session ends.

### The session lifecycle (the interaction model)

A directive starts a session, not a one-shot. The held glow ends three ways:

- **← Back** — restore the return point (`closeMarqueeSurface` + `goRung(returnRung)`).
  Only shown when Nuvo *actually navigated* — if the target was already on screen,
  it just lights, no pill.
- **Dismiss (✕ / Esc)** — clear the glow but stay put (you accept the new location).
- **Self-navigate** — you change rung yourself → the session cedes control (the
  surface lives on the `day` rung; any rung ≠ `day` means you left, so it clears).
  The orb also clears if its target leaves the DOM (you closed the surface).

The return point is the rung you were on; `RUNG_LABEL` (Marquee.tsx) + the registry's
surface `label` turn it into the pill's wording ("brought you to **Week's Plan** ·
← Back to **Projects**"). The surface's `rung` is what "self-navigate clears it" keys
off — leave that rung and the session ends.

### Why a surface event, not a nav patch

Most surfaces are global nav (`Partial<AppNavState>`), but **Week's Plan is local
Planner state** (`weekPlanOpen`). So the controller dispatches a decoupled window
event (`MARQUEE_OPEN_EVENT`); Planner listens and opens the surface at the planning
horizon. Surface keys are a cleaner contract than raw nav patches anyway — the agent
picks a stable name, blind to internal nav shape.

## Mobile — disabled live, degrades to a chip

The premise is *narrate beside canvas, simultaneously.* On a phone Nuvo chat is a
full-screen tab — there's no left canvas to drive while you read the reply. So
`<Marquee>` is **desktop only** (not mounted in `MobileShell`). The edge keeps
emitting the identical directive; the planned mobile presentation is a tappable
"Show me →" chip under the reply that navigates + lights the orb sequentially.
*(Chip not yet built — directive currently no-ops on mobile.)*

## Guardrails (anti-tacky, baked in)

- **Show *alongside* tell.** A `point_at` turn still gives a real, self-contained
  reply (names the priorities, adds a read); the highlight reinforces, never
  replaces. The chat is informed by the visual, not dependent on it. (System prompt.)
- **One held spotlight, always reversible.** No orb confetti; the move Nuvo made is
  labeled and one-tap undoable via the return pill.
- **Only real, hand-reachable UI.** The orb lands on the actual block you can click.
- **Intentional, not reflexive.** The model calls `point_at` only on a genuine
  show-me moment — never every message.
- **Reduced-motion** → quiet tint, no fly-around.

## Extending the vocabulary

See **"How it scales"** above — it's a registry entry + a `data-marquee` tag, and (for
a brand-new surface) an open/close listener. No edge or prompt changes.

## Dev / verify

`window.__marquee(directive)` (DEV only, in `Marquee.tsx`) drives the orb without a
live backend — fire it from the console / `preview_eval` to test navigation +
spotlight against real data.

## Deploy

The edge function only needs deploying when *its own* logic changes (the generic
relay, the tool builder, the prompt) — **not** when you add a target. After the
registry refactor, adding a pointable target is a frontend-only change that ships
with the normal web/desktop build. Redeploy the agent (**`supabase functions deploy
agent`**) only when you touch `index.ts` / `tools.ts` / the system prompt.
