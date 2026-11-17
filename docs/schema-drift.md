# Schema drift — is `neon.sql` still production? (D-241)

**Run this before any migration:**

```bash
npm run check:schema-drift
```

It reads production with `pg_dump --schema-only -n public` (never a write), loads that into a
local scratch database, applies `worker/schema/neon.sql` + `better-auth.sql` + `field-ts.sql` to an
empty one beside it, and diffs the two catalogs: tables, columns (type · nullability · default ·
generated · identity), constraints, indexes, enums, triggers, functions. Exit 0 means `neon.sql`
describes production; exit 1 prints every difference and leaves both copies for inspection
(`nuvo_drift_prod`, `nuvo_drift_neon`).

## Why this exists

Production was not made by `neon.sql`. The cutover copied Supabase's tables
(`scripts/cutover_copy.py`), and `neon.sql` was hand-written for the rehearsal, so the two drifted
silently. Everything tested on `neon.sql` (every `worker/src/*.check.ts`, and every migration) was
being tested against a database that doesn't exist. On 2026-11-17 that had already caused:

- **Google calendar sync down in prod since 2026-11-13.** `external_events.recurring_event_id` is
  a *generated* column in prod (`raw ->> 'recurringEventId'`) and a plain one in `neon.sql`. Every
  Google write named it, and every one failed: `cannot insert a non-DEFAULT value into column
  "recurring_event_id"`.
- **Agent/MCP writes to two tables couldn't work.** `store.ts` wrote `recurrences.rrule` and
  `event_domain_routing.id`. Neither column exists in prod.
- **A change-feed migration that would have broken every routing write.** It passed against
  `neon.sql` (caught by hand, fixed in `6febf789`).

So `neon.sql`'s tables are now **generated from production**, and this check keeps them that way.

## Requirements

- `pg_dump` / `psql` on PATH, same major as Neon (17): `brew install postgresql@17`.
- A local Postgres. Default `postgres://postgres@127.0.0.1:5432/postgres`; override with
  `LOCAL_PG_URL`. It creates and drops `nuvo_drift_prod` / `nuvo_drift_neon` only.
- Production access: `PROD_DATABASE_URL`, or a logged-in `neonctl` (`npx neonctl auth`). The URL
  is fetched into the process and never printed.

## Making a schema change

1. **Check drift first.** `npm run check:schema-drift` must pass before you start. If it doesn't,
   fix `neon.sql` (or find out who changed prod) before anything else.
2. **Write the change in `neon.sql`.** Idempotent: `ADD COLUMN IF NOT EXISTS`, `CREATE … IF NOT
   EXISTS`, `DO` blocks for types and constraints. Put the same statements in a scratch file.
3. **Test it on production's shape:**

   ```bash
   node scripts/schema-drift.mjs --migration path/to/migration.sql
   ```

   That applies the migration to the pg_dump copy in **one transaction** (`psql -1`,
   `ON_ERROR_STOP`), then diffs. A clean diff means `neon.sql` and "prod + migration" agree.
   Exercise the writes it affects against the copy, too:

   ```bash
   PROD_COPY_URL=postgres://postgres@127.0.0.1:5432/nuvo_drift_prod \
     node --experimental-strip-types worker/src/prodShape.check.ts
   ```

4. **Apply to prod by hand.** Take a backup branch first
   (`neonctl branches create --parent main --name pre-<x>-<date> --no-compute`), then
   `psql -1 -v ON_ERROR_STOP=1` with `SET lock_timeout`.
5. **Check drift again.** It must be clean after the apply.

## Refreshing the generated section

If prod changed outside this flow, and you've confirmed the change is meant to stay:

```bash
node scripts/schema-drift.mjs --emit-tables > /tmp/tables.sql
```

That prints prod's tables in `neon.sql`'s form: enums in guarded `DO` blocks, then
`CREATE TABLE IF NOT EXISTS` in FK order with every constraint inline, then
`CREATE INDEX IF NOT EXISTS`. Replace the section between "Production's tables" and "Upgrades for a
database an older neon.sql made" with it. Better Auth (`better-auth.sql`), billing and the change
feed (`sync_changes`) are hand-written and not emitted.

## What the checks run against

`worker/src/isolationDb.ts` builds every PGlite check from `neon.sql`. Since D-241 that *is*
production's shape: enums, generated columns, `NOT NULL`s without defaults, and every `CHECK`
(`tasks_step_is_not_schedulable`, `reminders_one_target`, `recurrences_one_day_rule`…). A fixture
that prod would refuse now fails the check, which is the point. `worker/src/prodShape.check.ts`
drives the agent/MCP writes (recurrences, routing) and Google sync's write through it, and also runs
against the pg_dump copy itself when given `PROD_COPY_URL`.

## Shapes that have bitten

- `recurrences` has no `rrule`. The rule is columns (`freq`, `interval`, `byweekday`,
  `bymonthday`, `bysetpos`, `bymonth`, `anchor_date`, `until_date`, `max_count`), written exactly
  as the SPA's `useRecurrence` writes them.
- `event_domain_routing` has no `id`. It's keyed `(user_id, event_key)`. `domain_id` is the
  model's answer, `manual_domain_id` the person's. `/api/data/event_domain_routing/:key` takes the
  event_key.
- `external_events.recurring_event_id` is generated. Never write it.
- `reminders.id` has no default, so the writer supplies it. `tasks.status`, `tasks.priority`,
  `recurrences.priority`, `calendar_accounts.provider` / `sync_direction` are enums.
