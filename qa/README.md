# QA — end-to-end scenario catalog

A script a QA bot (or a person) follows against the **live app**, as a real user,
in a dedicated account whose data is reset before every pass. Unit tests and the
fixture-harness Playwright suite (`npm run e2e`) prove components; this proves the
deployed product works end to end: sign-in, sync, the API, the chat, both shells.

| File | For | What |
|---|---|---|
| [`RUNBOOK.md`](RUNBOOK.md) | the bot | How a run works, rules of engagement, how to judge, the report shape. **Point the bot here first.** |
| [`WORLD.md`](WORLD.md) | the bot | Exactly what the account holds after a seed. |
| [`scenarios/`](scenarios/) | the bot | ~80 scenarios in 11 files, run in file order. |
| [`report-template.md`](report-template.md) | the bot | The report it hands back. |
| `scripts/qa/seed.mjs` | runner | `npm run qa:seed` — resets the account to the world. |
| `scripts/qa/fixture.mjs` | both | The world as data. Source of truth for `WORLD.md`. |
| `tests/qa-catalog.test.ts` | CI | Keeps the catalog honest (below). |

## The format

Plain Markdown with a fixed shape — readable by any model, parseable by the test:

```markdown
### QA-CAP-01 · Free text becomes structure
Shell: both · Priority: P0 · Surface: capture · Writes: yes

**Steps**
1. Open capture.
2. With **Task** selected, type exactly: "QA call the bank tomorrow 2pm 30m #calls !high"

**Expect**
- Tomorrow has a 2:00–2:30pm block titled "QA call the bank".
```

- **Shell** `desktop` | `phone` | `both` (both = run once per shell).
- **Priority** `P0` smoke/critical · `P1` core · `P2` edges.
- **Surface** tags; some are coverage ids the test checks (`desktop:schedule`,
  `phone:calendar`, `calendar-view:month`, `build-face:groom`, `settings:labels`).
- **Writes** whether it changes data.
- Optional `Manual: <why>` — needs a human-provided precondition; skipped by default.
- **Bold** = a visible label or accessible name. `"Quoted"` = type it exactly.
  «Guillemets» = a seeded record by exact title.

## One-time setup (production)

1. **Make the account with a password.** Pick an email whose local part contains
   `qa` as a word (e.g. `nuvo-qa@yourdomain`) and a long random password:

   ```bash
   curl -X POST https://api.nuvo.day/api/auth/sign-up/email -H 'content-type: application/json' -H 'Origin: https://app.nuvo.day' -d '{"email":"nuvo-qa@yourdomain","password":"<long random>","name":"QA Bot"}'
   ```

2. **Verify it and keep it out of the paywall** — once, in Neon. Password
   sign-in needs a verified address (`requireEmailVerification`), and the trial
   would lock the account after 14 days:

   ```sql
   update "user" set "emailVerified" = true where email = 'nuvo-qa@yourdomain';
   update subscriptions set status = 'active'
   where user_id = (select id from "user" where email = 'nuvo-qa@yourdomain');
   ```

   (`status = 'active'` with no `plan_source` is entitled indefinitely — the same
   thing done for the App Review account. The subscription row appears on the
   account's first signed-in request; if the second `update` touches 0 rows, run
   `npm run qa:seed -- --dry-run` once and repeat it.) The seed warns if it lapses.
3. **Give the runner the four values** in `RUNBOOK.md` §0 as secrets/env:
   `QA_APP_URL`, `QA_API_URL`, `QA_EMAIL`, `QA_PASSWORD`.
4. Optional: connect a **test** Google account to the QA account to un-skip the
   calendar-sync scenario (`QA-ACCT-05`).

## Running it

```bash
QA_API_URL=https://api.nuvo.day/api QA_EMAIL=… QA_PASSWORD=… npm run qa:seed
```

Then hand the bot `qa/RUNBOOK.md`. It re-seeds before each scenario file and each
shell pass (≈2s each), so a full run is about 11 files × 2 shells. A smoke-only
run is `00-smoke.md` in both shells.

The seed only ever touches the signed-in QA account: it signs in as that user and
writes through the same session-scoped REST API the app uses (`worker/src/rest.ts`
ANDs the owner onto every statement). It refuses an email without `qa` in it and
refuses if the session reports any other email. No database credentials needed.
`--dry-run` signs in and prints the plan without writing.

The chat scenarios (`70-chat.md`) cost real model tokens — 11 messages per shell.

Locally: point it at `wrangler dev` (`QA_API_URL=http://localhost:8787/api
QA_APP_URL=http://localhost:5717`). A local database built from
`worker/schema/neon.sql` lacks some production columns; the seed drops what the
server says is missing and prints a `warn:` line for each.

## Keeping it current

Two mechanisms, split by how big the change is:

- **Major — enforced.** `npm test` fails when the app gains a place to go that no
  scenario visits. It reads the code's own registries — the sidebar's `RUNGS`
  (`Spine.tsx`), the phone's `NAV` (`MobileShell.tsx`), `CAL_VIEWS`
  (`CalendarPane.tsx`), the build `FACES` (`FloorPane.tsx`), Settings `SECTIONS`
  (`SettingsModal.tsx`) — so a new page, tab, view or section can't ship without
  one. It also fails when a scenario names a seeded record the fixture no longer
  creates, and on malformed or empty scenarios.
- **Everything else — the CLAUDE.md rule.** A change that alters what a user
  sees or does on a surface (a renamed button, a moved act, a new flow, a removed
  feature) updates the scenarios that touch it in the same commit. Find them by
  the label: `grep -rn "Old label" qa/`.

Not every change needs a scenario: styling, copy that no scenario quotes,
internal refactors, perf work — leave the catalog alone.
