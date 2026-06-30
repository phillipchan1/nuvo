# Agent tools — letting Nuvo _do_ a new thing

Nuvo has two ways to grow with the app. Know which one your feature needs:

| You want Nuvo to… | Where it lives | Grows how |
| --- | --- | --- |
| **know about / show** a surface ("show me my projects") | `src/lib/marqueeRegistry.ts` | **Client, hot.** Add one entry → chat `point_at` *and* ⌘K Spotlight both pick it up. No deploy. |
| **act / mutate data** ("file this GitHub issue as a task") | `supabase/functions/agent/tools.ts` | **Server, deploy.** Add a tool definition + handler, then `supabase functions deploy agent`. |

This doc is the second row. The first row is `marqueeRegistry.ts` (and the
"every new feature is reachable from Spotlight *and* Nuvo" rule in `CLAUDE.md`).

## Why actions can't hot-grow like navigation

A `point_at` target is just client UI state — the browser can declare the full
list on every request, so the agent's vocabulary is always current with zero
deploys. An **action's handler runs server-side with service-role database
access** (it writes your tasks, sprints, calendar). You can't ship that from the
client, so a new action is a real code change in the edge function and needs a
redeploy. That asymmetry is inherent, not an oversight.

## Adding a tool — three steps, one file

All three live in `supabase/functions/agent/tools.ts` (or `verticalTools.ts` for
domain/initiative/project/key-result CRUD). A ready-to-copy template sits at the
top of `tools.ts` under **"Adding a new agent tool."**

1. **Declare** it — add an entry to `TOOL_DEFINITIONS`. The `description` is the
   agent's only cue for *when* to call the tool, so write it as a usage note, not
   a label.
2. **Handle** it — add a matching `case "<name>":` to `executeTool()`. Do the
   work, then `return { result, action }` — `result` is JSON the model reads
   back; `action.summary` is the human-facing chip. Add `ui` if it should also
   drive the canvas (see `point_at`).
3. **Deploy** — `supabase functions deploy agent`. Until you do, Nuvo doesn't
   have the tool. **Say this out loud when you ship the feature** — it's the one
   step the registry path doesn't need.

## Checklist when shipping a feature

- Navigable surface/flow/section? → `marqueeRegistry.ts` entry (gets ⌘K + chat
  awareness for free).
- New thing Nuvo should *do*? → tool here + redeploy.
- Both? Do both. Neither? Say so and move on.

When in doubt, the CLAUDE.md rule has me **ask you** before calling the feature
done — so this list gets run every time.
