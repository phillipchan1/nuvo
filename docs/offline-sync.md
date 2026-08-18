# Offline sync

**Status:** shipped — 123 Supabase writes reduced to 13, all 13 deliberate (see §6)
**Last updated:** 2026-08-07
**Code:** `src/lib/sync/` · migrations 53–55 (pushed) · `npm run check:sql`
**Tests:** `tests/sync/` — 100 tests (`npm test`) + 13 live checks (`npm run check:sql`)

---

## 1. What was wrong

Nuvo was a server-authoritative thin client. Postgres was the only source of
truth, TanStack Query held an **in-memory-only** cache, and all 123 write sites
called `supabase.from(...).insert/update/delete` directly.

Three consequences, all of them data-integrity failures:

1. **Writes made offline were destroyed.** A mutation threw,
   `isTransientWriteError` classified it transient, it retried three times with
   backoff, and then `onError` rolled the optimistic update back. The user
   watched their capture appear, sit for ~10 seconds, and vanish. Nothing was
   queued and nothing was retried after that.
2. **Nothing survived a reload.** The cache died with the process, so opening
   the app offline showed an empty planner — on the phone, where offline is the
   normal case.
3. **There was no conflict resolution.** Concurrent edits were per-column
   last-write-wins by accident of `UPDATE` semantics. No version column, no
   precondition, no defence against out-of-order delivery: a late-arriving
   refetch could serve an older row over a newer one.

There was also no native mobile target to speak of — Tauri macOS plus an iOS
PWA, no React Native, no SQLite/CoreData. "Test the local persistence layer" had
no layer to test.

## 2. The model

**A write is durable before it is sent.** `queueWrite` resolves when the op is
in IndexedDB, not when Postgres acknowledges it. The UI paints after that, and
nothing is ever rolled back. Delivery is the outbox's problem from then on,
across reconnects, restarts and force-quits.

```
  user action
      │
      ├─► patch the query cache          (instant, optimistic)
      └─► queueWrite ──► IndexedDB `ops` ──► drain ──► Postgres
                            (durable)      (ordered,
                                            idempotent)
```

Three properties carry the whole design:

- **Client-generated row ids, inserts included.** A server-side
  `gen_random_uuid()` cannot be replayed: if the insert lands and the response
  is lost, the retry creates a second row. Naming the id on the client makes the
  insert an idempotent `upsert ... ignoreDuplicates`.
- **Per-field timestamps** (`fieldTs`). Row-level LWW loses data whenever two
  devices touch different fields. Field-level LWW converges regardless of
  arrival order, which is what makes out-of-order delivery *correct* rather than
  merely survivable.
- **Monotonic `seq`** from IndexedDB's auto-increment — persisted across
  restarts and never reused, so a replayed child insert cannot overtake its
  parent.

## 3. The files

| File | Role |
|---|---|
| `ops.ts` | Op model, the `fold`/`coalesce` reducer, `mergeFieldLww` |
| `idb.ts` | The one IndexedDB (`ops` + `kv`), with an in-memory fallback |
| `outbox.ts` | Durable queue: enqueue, ack, park, unpark, discard, status |
| `engine.ts` | The drain loop and error classification |
| `transport.ts` | Supabase adapter — upsert / `apply_patch` RPC / delete |
| `coordinator.ts` | When to drain, and when a refetch is safe |
| `persist.ts` | Dehydrated query cache, so the app opens offline |
| `index.ts` | `queueWrite`, `makeOp`, `configureSync` — the public surface |

## 4. Rules that are easy to get wrong

**Coalescing.** A week of offline edits folds to the smallest equivalent set:
`insert→update` becomes one insert; `insert→delete` **annihilates** (the row
never reached the server); `update→delete` keeps only the delete; `delete→insert`
never folds, because it is a genuine recreate and the delete must land first.

**`seq` vs `throughSeq`.** A merged op keeps the *earliest* `seq` so it holds its
place in the replay order — but acks must use `throughSeq`, the highest stored
seq folded in. Getting this wrong left later edits in the store forever and the
queue re-sent the same patch on every drain. (Caught by a test; regression test
in `outbox.test.ts`.)

**Head-of-line blocking.** Order is preserved across a *retriable* failure —
otherwise a task insert overtakes the project it references. Order is abandoned
across a *fatal* one: a rejected row is parked and the drain continues past it,
because one poisoned write must never freeze every future write on the device.

**Parked ops are never dropped.** A write Postgres refuses stays in the store
with its error attached and is surfaced in `SyncStatus` until the user retries
or explicitly discards it. `discard` is the only path that throws away intent.

**Refetching is conditional.** Every mutation used to end in
`invalidateQueries`, but a refetch fired while writes are queued returns rows
that predate them and wipes the user's offline work. `invalidateWhenSafe`
refetches immediately when the table owes nothing, and defers until the drain
otherwise.

**Agent writes paint immediately.** Realtime used to only invalidate, so a
teammate's edit waited on a refetch — and if this device owed any write on
that table, the refetch waited on the outbox. `applyLiveChange` writes the
socket payload into the query caches as soon as it arrives, merging any
unsent local op for the *same row* through field-LWW. A Friday reschedule
lands on the Schedule the way a Google Doc edit lands on the page.

**The persisted cache is cleared on sign-out.** Nuvo is multi-tenant and the
cache is on disk; leaving it would rehydrate one account's tasks for the next
person to sign in on that device.

## 5. Conflict resolution

Per-field last-write-wins, implemented in three places that must agree:

- `mergeFieldLww` (`ops.ts`) — the client's optimistic view
- `apply_patch` (migration 53) — the authority
- the model in `tests/sync/multi-device.test.ts` — the proof

A field is overwritten only when the incoming stamp is strictly newer. Ties go
to the stored value (already durable, so the outcome does not depend on which
device asks). Deletes are terminal: a stale patch for a deleted row matches
nothing and does nothing, so both orderings converge on "deleted" with no
tombstone table.

`apply_patch` is **SECURITY INVOKER** on purpose — it writes arbitrary tenant
rows, and running it as definer would hand every caller a way around RLS. The
table name is allowlisted before it reaches `format(%I)`, and the SET list is
built through `jsonb_populate_record` against the table's own row type so
non-text columns are cast correctly.

**Known limit — clock skew.** `field_ts` is client wall-clock, so a device with
a wrong clock can win or lose exchanges it shouldn't. The RPC clamps
future-dated stamps to `now()`, which bounds a fast clock; a slow clock still
loses. A hybrid logical clock would close this and is deliberately out of scope.
There is a test documenting the behaviour rather than asserting it is desirable.

**Server-side writers must stamp.** Agent, MCP, and Capture update rows through
the service role and never call `apply_patch`. An unstamped column change loses
to the SPA's cache on the next merge (same stamp, local value wins). The
`stamp_unstamped_field_ts` trigger covers that forgotten-stamp case: it writes
`now()` only when the value changed and the stamp did not. SPA patches that
send value + stamp together are left alone.

## 6. What is converted, and what is not

**Offline-capable:** the task loop (capture, edit, complete, plan, block, slot,
trash, labels) · the vertical record CRUD for domains, initiatives, key results
and projects, plus both delete cascades · slots · record comments · labels ·
week reviews · the agent undo path · **the weekly ritual** (`planWeek`,
`commitTasksToSprint`, `applySchedule`, `applySlots`, `assignToStanding`) ·
**recurrences** · **settings** · onboarding · and every screen's reads.

**Still online-only — 13 sites, all deliberate:**

| Site | Why |
|---|---|
| `calendar_accounts` delete | OAuth identity; disconnecting must revoke tokens server-side |
| `activity_bindings` (2) | Binds a live GitHub/calendar feed — only meaningful against a reachable API |
| `external_events` update | A mirror the sync job rewrites wholesale; queued writes would be clobbered |
| `event_domain_routing` | Written by the AI router, not by hand |
| `addInitiativeTree` / `addInitiativeSubtree` (7) | AI-generated trees — the model call needs the network anyway |
| `ensureSprint`'s server upsert | See below |

**Down from 123 Supabase writes to 13.**

### The one place the ritual still needs a connection

Tasks reference `sprint_id`, so committing work to a week needs the sprint's
real id. When the week's row is in cache — true whenever the app has been opened
online at any point that week — the whole ritual runs offline. When it is not,
the client refuses rather than inventing one: another device may already have
created that week's row, our insert would lose the `unique (user_id,
week_start)` race, and every task referencing the invented id would fail its
foreign key and park. Refusing costs a clear message; guessing costs the plan.

### Set-based writes became cache-resolved

Most of what was left used server-evaluated predicates —
`.eq("sprint_id", …)`, `.in("id", ids)`, `.eq("recurrence_id", …)`. A predicate
the server resolves days later matches a different set than the user acted on,
so each one now resolves its rows from the cache at action time and queues one
op each. The trade, stated plainly: rows this device has never loaded are not
touched. Foreign keys remain the backstop.

### `recurrences`: rejected, then done properly

N-15 rejected this because materialisation needed a *server read* to know which
occurrences existed. The escape clause was that it could be computed from cache
instead — which it now is.

**That first attempt failed loudly and is worth recording.** Reading the cache
naively treated "I cannot see any occurrences" as "there are none", and because
`materializeAll` runs on app open — potentially before the task query resolves —
it queued **385 inserts for occurrences that already existed**, every one
rejected by `tasks_recurrence_occurrence_uniq` and parked. Two fixes:

1. `occurrenceDates` returns `null` when the unfiltered pool has not loaded, and
   the caller skips. Unknown means skip, never "empty".
2. `materializeAll` reports that skip, so the mobile shell's once-per-day guard
   does not record a cold-cache skip as a completed run.

And a third, more general: **a `23505` on an insert is now treated as
satisfied, not fatal.** A unique violation means the row is already there, so
the op has nothing left to do. `ignoreDuplicates` only covers the declared
conflict target; a collision on any *other* unique constraint was being
classified fatal and parking a write with no work left in it.

## 7. Deployment

**Migrations 53 and 54 are pushed and live** (2026-08-07). Field-level conflict
resolution is active in production, verified by exercising the RPC against a
real row from an authenticated session:

| Probe | Result |
|---|---|
| Empty patch | `{applied: [], matched: 0}` — callable |
| Non-syncable table (`subscriptions`) | `42501` refused — allowlist enforced |
| Protected column (`user_id`) | rejected, never written |
| Fresh stamp | applied, `field_ts` recorded |
| Ancient stamp | rejected, stored value intact |

If the RPC is ever unavailable the transport still degrades safely: it probes
once, detects `PGRST202`, and falls back to a plain `UPDATE` (row-level LWW) for
the session. `conflictResolutionAvailable()` reports which mode is live.

### Migration 54 exists because 53 was broken

`apply_patch` as first written failed with `42702 column reference "id" is
ambiguous` on **every patch that had a field to apply**. The UPDATE joins the
incoming values as `s`, so the WHERE built from `p_match` matched both `t.id`
and `s.id`. It slipped through because the paths that return early — an empty
patch, or one whose fields are all rejected — never reach the UPDATE.

The failure mode was worse than a dropped write: PostgREST returns 42702 as a
4xx with a `42…` SQLSTATE, which `classifyError` correctly reads as a considered
refusal, so **every queued update would have gone straight to PARKED** and the
sync strip would have filled with the user's edits marked "couldn't be saved"
while the database was perfectly healthy.

### The coverage gap this exposed — now closed

Nothing in `npm test` executes SQL. `multi-device.test.ts` models `apply_patch`'s
*rule* in TypeScript, which pins the semantics but cannot catch a syntax or
aliasing error in the plpgsql, so the bug shipped green.

`npm run check:sql` closes it. It exercises the **deployed** function — the thing
that actually broke — and asserts the whole contract: callable, allowlist
enforced (including an injection-shaped table name), empty match refused, fresh
stamp applies and records `field_ts`, stale stamp rejected, a second field merges
without disturbing the first, and `user_id` refused rather than written.

```bash
npm run check:sql            # read-only checks
npm run check:sql -- --write # + the merge half, via a self-cleaning scratch row
```

The merge checks need a row to patch, so `--write` creates one (born `trashed`,
so it never reaches a real surface) and deletes it in a `finally`. It is not part
of `npm test` because it needs credentials and touches a live database — run it
after any change to the RPC.

A `supabase db start` harness would be the textbook answer and would run
unattended in CI; it needs Docker, which was not available on this machine.

## 8. Test map

| File | Covers |
|---|---|
| `ops.test.ts` (21) | Coalescing rules, `applyOp`, field-LWW merge |
| `outbox.test.ts` (41) | Durability, restart survival, ordering, head-of-line blocking, attempt budget, acks, storage sweeping, error classification, no-storage fallback |
| `multi-device.test.ts` (12) | Concurrent edits, convergence, out-of-order permutations, delete-vs-edit, idempotent replay, clock skew |
| `check-apply-patch.mjs` (13, opt-in) | The **deployed** RPC: allowlist, injection-shaped names, empty match, apply/reject by stamp, cross-field merge, protected columns |
| `transport.test.ts` (10) | Row identity: plain id, composite key, natural key; conflict targets; missing-session backoff |
| `task-offline.test.tsx` (12) | The real `useTaskMutations` hook: offline create, reconnect delivery, force-quit survival, coalesced edits, label diffing, parked rejections |
