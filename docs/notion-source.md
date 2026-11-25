# Notion → inbox

**Status:** built 2026-11-24, not deployed · decision [D-257](./product/decisions.md) · siblings: [`inbound-email.md`](./inbound-email.md) (the other door into the
inbox), [`activity-sources.md`](./activity-sources.md) (GitHub, the token-sealing pattern this copies)

Work that lives in someone else's tool has to reach the week, or W1 reads lighter than it is.
**Nuvo reads one rule out of Notion — assigned to you and still open — and lands each match once,
in the inbox, as your task.** No rules engine, no direction to choose, no mirror: the person switches
databases on, and that is the whole configuration.

## What the person does

1. Settings → **Notion** → **Connect**. Notion's own screen picks which pages Nuvo may see.
2. Back in Settings → **Notion**, every database Notion shared is listed, off. Switch on the ones
   that count. Work arrives at once, then every 10 minutes.
3. If a database has several person fields, a select picks the one that means "assigned to".
   One with no person field can't be switched on, and says so.

**Choose pages in Notion** re-runs the consent screen (the only place access changes).
**Disconnect** stops new arrivals; imported tasks stay.

## Mechanism

| Piece | Where |
|---|---|
| Schema reading (assignee, done, filter, title) — pure, tested | `worker/src/notion/feeds.ts`, `tests/notion-feeds.test.ts` |
| OAuth, listing, sync, `/notion` actions, cron runner | `worker/src/notion/index.ts` |
| Tables | `task_sources` (one row per workspace: sealed token, `me_id`, `feeds` JSONB), `task_source_items` (every page ever imported, keyed `user_id, kind, external_id`) in `worker/schema/neon.sql` |
| Cron | `*/10 * * * *` → `notion-poll` (`cronJobs.ts`, `wrangler.jsonc`; post-flip only) |
| Client | `src/hooks/useNotion.ts`, `src/components/NotionPane.tsx`; `AppShell` reopens Settings → Notion on `?notion=` |

- **"Open"** = not in the status property's **last group** (Notion fixes groups as To-do →
  In progress → Complete; only names change). Else an unticked checkbox named like Done. Else
  nothing excluded.
- **Once, ever.** The ledger row is claimed (`ON CONFLICT DO NOTHING`) before the task is written,
  and released if the write fails. It outlives a disconnect on purpose.
- **Reconnect.** A 401/403, or a token that won't unseal, sets `needs_reconnect`; the pane shows
  **Reconnect** and the poll skips the source.
- Uses Notion API version `2025-09-03` (data sources). At most 50 new tasks per source per run,
  3 pages of 100 per database.

## Setup (once, by the operator)

1. Create a **public** integration at notion.so/profile/integrations — capabilities: *Read
   content*, *Read user information without email*. Redirect URI:
   `https://api.nuvo.day/functions/v1/notion-oauth` (and `http://localhost:8787/functions/v1/notion-oauth`
   for local).
2. `npx wrangler secret put NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` (and in `.dev.vars` locally).
3. Apply the two `CREATE TABLE` blocks at the end of `neon.sql` to Neon (drift check first —
   see the schema-change routine).
4. Deploy the API Worker (it owns the cron and the routes).

## Not built, on purpose

- Writeback to Notion when a task is done (still open — D-257).
- Closing a Nuvo task when the Notion page closes — the copy is yours (P12 mitigation).
- Any second source. The pattern gets its general name at the second instance (P10).
