# MCP — a teammate acts through the chat's tools

Status: **built** (2026-08-18 · D-112). Source: `supabase/functions/mcp/`. Auth:
`connections` bearer token with `account` scope, minted in Settings → **Apps & devices**.
Sits under [`agent-conformance.md`](./agent-conformance.md) (the vocabulary) and
[`APPLE_WATCH.md`](./APPLE_WATCH.md) (the first consumer of the same token table).

A teammate the operator owns — Grok Bot, Cursor, another agent — needs to *see and
write* their Nuvo. The failure mode is a second API. **MCP is a connector, not a
vocabulary.** The tools Grok Bot gets are the tools the in-app chat already has,
minus screen-driving `point_at`, plus `get_snapshot` (the chat gets that injected
as context).

This function does **not** call a model. Nested brains (Grok Bot → Nuvo chat →
tools) is how two answers for one week get born.

---

## 1 · What it is

```
Grok Bot
  → POST https://<project>.supabase.co/functions/v1/mcp
    Authorization: Bearer <connection token>
    → the same executeTool / executeVerticalTool the chat uses
    → the same buildContext snapshot
    → the same week/project patches as the planning kernel
```

Streamable HTTP JSON-RPC (`initialize`, `tools/list`, `tools/call`, `ping`).
`verify_jwt` is off: the bearer is our opaque token, not a Supabase JWT, same as
Capture.

## 2 · Auth — one token, one operator

The URL is the product (every account hits the same function). **The token is the
person.** Minted while signed in, stored as `connections.user_id`, and every
`buildContext` / `executeTool` call uses that id. There is no shared Nuvo key,
no Phil backdoor, and a `user_id` in a tool argument is stripped.

Do not put this token in a Grok Bot *team* connector. Each operator mints their
own in their own Settings. A copied token is that operator, not a seat.

Settings → **Apps & devices** → **Full account**. The token is shown once; we
store `sha256` + last four. Revoke is a timestamp.

| Scope | What it opens |
|---|---|
| `inbox:write` | Capture API only (watch, shortcuts, another app's inbox) |
| `account` | MCP — the full tool list. Also satisfies Capture (`account` includes inbox) |

The gateway still wants an `apikey` (the public anon key). The URL Settings copies
already has it as a query param, so Grok Bot only has to paste **URL + Bearer**.

Calendar writes from MCP have no user JWT to forward. `google-events` /
`icloud-events` accept the service-role key **only** when `actingUserId` is the
connection's owner (`requireActor`). A leaked id without that key is still 401.

Agent / MCP / Capture write rows through the service role, not `apply_patch`,
so they used to change a column and leave `field_ts` for that column untouched.
The SPA's last-write-wins merge then treated the write as if it had never
happened: same stamp, local cache wins, and a "Done, it's at 1:00" never
appeared on the Schedule. A `BEFORE INSERT OR UPDATE` trigger
(`stamp_unstamped_field_ts`) now stamps a column only when the value changed
and the stamp did not. Client patches that send value + stamp together pass
through unchanged.

The SPA paints those writes as soon as Realtime delivers the row
(`applyLiveChange`) rather than waiting on a refetch that can sit behind the
outbox. Unsent local edits to the *same* row still win when their stamp is
newer.

## 3 · What it deliberately does not do

- **No `point_at`.** That drives the operator's screen.
- **No nested chat.** MCP is tools, not `/agent`.
- **Cancel / decline / purge still need a confirm_token** from a *previous* call.
  Propose, then spend. Same mechanism as the chat (`confirmDestructive.ts`).
- **Invites still stage, never send.**
- **The week composer stays client-only.** MCP can bring a project onto the week
  (`create_priority`); it cannot run Sunday.

## 4 · Wiring Grok Bot

1. Deploy: `npx supabase functions deploy mcp --no-verify-jwt`
2. In the running app: Settings → Apps & devices → **Full account** → name it
   `Grok Bot` → Create token → **Copy URL + token**
3. Tell Grok Bot: custom connector, that URL, `Authorization: Bearer <token>`

If the connector asks for a login card: it wants OAuth, which this endpoint does
not speak. Bearer is the auth. Paste the header.
