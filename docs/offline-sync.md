# Offline sync

**Status:** shipped — 123 Supabase writes reduced to 13, all 13 deliberate (see §6)
**Last updated:** 2026-10-15 (write races — §4 from "An ack is not the last echo", §6 "Provider events: one write at a time", D-156)
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

**Local cache writes opt out of the owing merge.** `preserveOwingRows` runs as
TanStack `structuralSharing` on *every* `setQueryData`, including our own
optimistic patches. A calendar → inbox drag (or a trash leaving Today) would
paint, then get glued back onto the filtered list the moment the table owed a
write — the desktop sat on a ghost block while the phone, which was not owing,
showed the truth. `runWithoutOwingPreserve` wraps `putTaskInCaches` /
`putSlotInCaches` / live apply so a local membership drop is the new truth,
not a stale snapshot to defend. Completing is not a membership drop — the
row stays on Today — so the same-id path now takes an incoming row when its
`updated_at` is newer, which is what `patchCaches` stamps. The rail and
calendar then merge fragments by that stamp (`mergeTaskLists`) so a stale
scheduled copy cannot uncheck a row the toast already announced.

**Launch catch-up.** Until the outbox has been read, `queryKeyOwesServer` is
true for every sync query so a launch refetch cannot clobber dehydrated rows.
`refetchOnMount` therefore no-ops on a desktop that restored from persist, and
Tauri never gets a focus event to retry. `catchUpAfterOwingKnown` runs once
that read finishes and invalidates stale queries that are not actually owed.

**Agent writes paint immediately.** Realtime used to only invalidate, so a
teammate's edit waited on a refetch — and if this device owed any write on
that table, the refetch waited on the outbox. `applyLiveChange` writes the
socket payload into the query caches as soon as it arrives, merging any
unsent local op for the *same row* through field-LWW. A Friday reschedule
lands on the Schedule the way a Google Doc edit lands on the page.

**The persisted cache is cleared on sign-out.** Nuvo is multi-tenant and the
cache is on disk; leaving it would rehydrate one account's tasks for the next
person to sign in on that device.

**A failed IndexedDB write is not a dropped write.** `idbAppendOp` falls back to
an in-memory store when the `ops` transaction fails — but `idbAllOps` used to
read *only* IndexedDB, so a single failed append made the op invisible to every
drain that followed. The capture was painted, dehydrated into the read cache,
never sent, and gone the first time anything refetched, with `isDurable()` still
reporting `true`. `idbAllOps` now returns the **union** of both stores, memory
keys are fractional (auto-increment only mints integers, so they cannot collide
and they still sort in replay order), `durable` flips so the UI stops claiming
crash-safety, and `reclaimMemoryOps` migrates them back — seq preserved — the
next time the store accepts a write. Appends also resolve on transaction
*commit* rather than `req.onsuccess`, which fires while the transaction is still
open.

**Parked rows are protected per-row, not per-table.** `owing` is computed from
*pending* ops only, and deliberately so: a table held owing forever would never
refetch and the device would go permanently stale. But that left a parked row —
the one state where the queue is clean while a row exists only on this device —
unprotected, so the next refetch dropped it and the task vanished with only a
Settings toast to explain it. `preserveOwingRows` now holds the specific ids
with a rejected write behind them when the table itself is not owing. A row
deleted on another device still leaves.

**Pending rows are protected per-row too — and nothing else is.** The owing
merge used to keep *every* cached id a refetch lacked whenever the table owed
anything at all. A launch nearly always owes something (occurrences materialize
on open; the rollover cron has just moved yesterday's blocks; a drag is queued),
so a row the server had deleted or moved — on the phone, by the agent or MCP,
by the trash purge, by the rollover — was glued back on as a "local-only extra"
in whichever fragments refetched in that window, went to disk with the
dehydrated cache, and was defended again on the next launch. Seen on the local
stack: a re-seed under an open Schedule left every block twice, the deleted ids
beside their replacements, through a full reload. A refetch is now the server's
word on its window except for the rows this device still owes: `markOwing` and
`refreshOwing` mirror the pending ops' `rowId`s, and `preserveOwingRows` holds a
missing row only when a pending or parked op is about it (`week_reviews` matches
by `week_start`, the key its ops use). A local create the refetch predates, or a
row just dragged into the list, still survives; everything else leaves.

**A row this device owes is placed by this device — in both directions.** The
rule above holds the rows a refetch *lacks*. Its mirror image is the rows a
refetch *has* that the list doesn't: a snapshot that predates a queued delete
still has the row, and one that predates a queued move still has it in the list
it left. Both were admitted as "new on the server", so a deleted slot came back
on the Schedule, a removed step came back on its checklist, and a block dragged
to next week stood in both weeks until the drain and a later refetch. Two fetch
paths reach this while owing because nothing gates them: `prefetchCalendarRange`
warming the neighbour weeks, and any key's first fetch. Now the mirror also
records each row's last queued op (`markOwing(table, rowId, kind)`;
`refreshOwing` takes it from the folded outbox, so a delete → insert recreate
counts as live again):

| The row in the refetch, with this queued | Before | Now |
|---|---|---|
| A delete | Admitted (or held as an extra) | Admitted nowhere — including a key's first fetch |
| An insert or update, and the list doesn't have it | Admitted | Dropped: the list's membership stands |
| An insert or update, and the list has it | Local body unless incoming is newer | Unchanged |
| Nothing (or only parked work) | Admitted | Unchanged |

"The list's membership" needs no second copy of the membership rule. Every
local write re-places the row in every mounted list (`putTaskInCaches`,
`putSlotInCaches`), so the previous list *is* the one rule's answer for the
row's local post-image. **What that cannot cover is a list with no previous
data.** On a key's first fetch there is no local answer to read, and computing
one means asking whether this device's copy of the row belongs in that key —
the hooks' rule, keyed on the query key that `structuralSharing` is never given.
Re-deriving it in the coordinator is the drift the header rules out, so a first
fetch still admits a row this device moved out of that window. It leaves at the
drain's refetch or the next local write to the row. On the Schedule it is
usually invisible: the fragment merge (`mergeTaskLists`, newest `updated_at`
wins) picks the local copy, stamped by `patchCaches`, whenever another merged
fragment still holds it. The cost runs the other way too:
a row the server moved *into* a list while this device owes a write on it stays
out of that list until the drain (Realtime's live apply places it at once when
the socket is up). Parked work is out of scope: a parked delete never drains, so
hiding the row would hide it for good on a server that still has it.

**Two windows, one outbox.** The desktop shell runs the main window and the
⌥Space panel as separate WKWebViews over one IndexedDB, so both drain the same
queue. Ops are idempotent, so a double send is harmless — but `recordFailure`'s
plain `put` could resurrect an op the other window had just acked away, and a
resurrected *delete* would eventually be re-sent against a legitimately
recreated row. `idbPutOp` now reads and writes inside one transaction and skips
an op that is already gone.

**Sixteen `postgres_changes` bindings on one channel deliver nothing.** This is
the root of the "my Mac is minutes behind my phone" report, and it failed
*silently*: `subscribe()` reported `SUBSCRIBED`, `channel.state` was `joined`,
all sixteen bindings were present client-side, and no row ever arrived.
Confirmed against the live project by subscribing two channels on one socket in
the same tick and writing a single row — the sixteen-binding channel got
nothing, a one-binding channel got the INSERT, and sixteen channels of one
binding each get everything. `useRealtime` now opens one channel per table
(`nuvo-rt-<table>`). Do not consolidate them again to save connections.

**A table outside the `supabase_realtime` publication is just as silent.** The
channel joins and nothing arrives. Production's membership was set by hand in
the dashboard, and as of 2026-10-15 it is **four tables: `tasks`,
`external_events`, `calendar_accounts`, `user_settings`.** The other twelve
`nuvo-rt-*` channels, and `nuvo-subscription`, deliver nothing in production.
Slots, projects, domains, labels and the rest catch up only through the 60s
pull and focus refetches. The "sixteen channels get everything" check above
wrote a single row, which can only prove the table it was written to. A stack
built from migrations used to publish zero tables, so local testing saw no live
update or DELETE eviction at all; that is how the ghost-row bug hid locally.
Migration 89 now records production's four, so local matches production. It
adds only missing members, so applying it to production changes nothing.

Don't widen the publication to make the rest live. DELETEs are not
RLS-filtered: every subscriber to a published table receives the primary key
of every row any account deletes (confirmed locally). For `subscriptions` and
`event_domain_routing` that key carries the other account's user id. Live
updates for the other tables belong on per-account broadcast topics. Replica
identity stays DEFAULT: under RLS a DELETE carries only the primary key even
with FULL (checked locally), and that key is all `liveApply` reads.

**The desktop had no pull.** The other half of the same report. `refetchOnWindowFocus` rides TanStack's focus
manager, which listens for `visibilitychange` — a Tauri window that never leaves
the foreground never fires it. `refetchOnMount` has already decided. `syncNow`
only refetches tables *this* device just wrote. Pull-to-refresh is mobile-only.
So the entire desktop refresh story was one Realtime socket, which had no status
callback, no re-subscribe, and no backfill. Three fixes, each sufficient on its
own: `kick()` now runs `catchUpAfterOwingKnown` after every drain (so app focus
refreshes); `useRealtime` handles subscribe status, re-subscribes with capped
backoff, and **pulls on rejoin** because Realtime does not replay what was
missed while the socket was down; and `pullSyncTables` runs on a 60s timer while
the window is visible, scoped to the outbox's own tables and skipping
`["tasks","all"]` / `["tasks","trashed"]` so the heavy queries stay on the focus
path.

**A Realtime row must not destroy what it does not carry.** The payload is the
bare table row — no joins — so painting it straight over the cache erased
`task_labels` on every remote edit until the next refetch. `applyTask` merges
onto the cached row. Relatedly, a remote DELETE for a row this device has queued
work on used to return `true` (handled) while doing nothing, which suppressed
the fallback invalidate and left the row on this device permanently; it now
returns `false` so the caller defers an invalidate behind the drain.

**An ack is not the last echo.** Drag a block to 9, then to 10: both ops land,
and the echo of the 9 can still be on the wire. `applyLiveChange` used to merge
an echo only against ops still *pending*, so that echo painted raw and the block
jumped back. The outbox now keeps every op it acks for `RECENT_ACK_MS` (10s, in
memory — `recentlyAcked`), and live apply folds those through the same field-LWW
as pending ones. It costs nothing when the echo is genuinely newer: its stamps
win. Delivered ops never decide a DELETE — that branch is still only about work
this device owes.

**A refetch already on the wire is cancelled by a write.** The owing gates stop a
refetch from *starting* over queued work; they cannot stop one that started a
moment before the user acted (the focus catch-up, the minute's pull). Its answer
predates the edit — landing after the patch it moved the task back, and put a
task dragged out of the inbox straight back into it; landing after the ack,
nothing defended against it at all. `holdFetchesBehindWrite` runs before every
optimistic task and slot patch (`patchCaches`, `createTask`, `patchSlotCaches`,
`insertSlotCache`): it cancels the in-flight fetches that already hold data —
TanStack restores the last written state, so the patch survives — and defers
each key behind the drain like any other invalidate. A first load is never
cancelled: it has no state to restore and would sit empty with nothing left to
fetch it.

**A row this device is writing keeps its local body.** `withholdOwedRows` runs
before the owing merge: a refetched row with a queued op keeps the cached body
even when its `updated_at` is newer (a read taken after op1 landed and before op2
did is newer than the cache and older than the user), and one the list doesn't
have is not admitted — its absence is this device's own placement. Like the
merge, it stands down for local writes (`runWithoutOwingPreserve`).

**Server work that reads a row back waits for the row.** `task-mirror` reads the
task from Postgres, and every caller fired it right after queueing the edit — so
it mirrored the block as it was before the drag, or 404'd a task created a moment
earlier. `queueWrite` remembers each row's newest write; `whenRowDelivered`
resolves when it is acked (`false` if it is parked or discarded), and
`mirrorTask` waits on it. A refused write is never mirrored.

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

### Provider events: one write at a time

`external_events` stays online-only, but "online-only" did not mean "ordered".
An edit is two writes — the mirror row, so every device moves now, and the
provider PATCH, after which `google-events` / `icloud-events` rewrite the row from
the answer — and both fired the moment a drag ended. Two drags inside a second:
the first PATCH's rewrite could land after the second drag's row write (the block
jumped back on every screen), and Google kept whichever PATCH arrived last.

| Piece | Where | What it does |
|---|---|---|
| The lane | `lib/eventWriteback.ts` `queueEventWrite` | One row write + PATCH per event at a time, in order. Plain single-instance edits that pile up behind a slow PATCH fold into one (later fields win); series and recurrence edits never merge. |
| Echo filter | `isStaleEventEcho`, read by `applyLiveChange` | While an event is being written its echoes are not painted; for 10s after, an echo carrying times this device wrote and then replaced is not either. Anything else — another device, the sync — paints. |
| Server guard | `_shared/eventWriteback.ts` `rewriteMirrorRow` | The client sends `rowAt` (the times its row write left); the function's rewrite applies only while the row still holds them. The fields are the version — no column, no migration, and a client without `rowAt` gets the old unconditional rewrite. |
| Creates | `beginEventCreate` / `swapCreatedEvent` | The optimistic row carries its account and calendar (it was blank, so it drew as a hatched read-only M365 block) and stays still until the real row replaces it — from the function's answer or its Realtime INSERT, whichever lands first. No refetch of every range after. |

Task → Event (`convertTaskToEvent`) trashes the task as the event is drawn and
restores it if the create fails; it used to wait for Google, so the hour held
three blocks for the round trip.

What is still open: a *refetch* of `external_events` that starts while an event
is being written is not filtered (only echoes are) — the onMutate cancel covers
one already in flight. And two devices editing one event at once still race at
the provider; the guard only keeps the mirror row honest.

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
| `idb-partial-failure.test.ts` (2) | A healthy store that refuses one write: the op stays reachable and `durable` tells the truth |
| `parked-rows-survive.test.ts` (3) | A rejected write keeps its row through a refetch, without freezing the table |
| `refetch-authoritative.test.ts` (7) | A refetch while owing drops server-deleted / moved-away rows and keeps only owed ones; the re-seed-then-reload case through dehydrate/hydrate |
| `stale-refetch-removals.test.ts` (8) | A stale snapshot does not hand back a row this device deleted (existing list, first fetch, extras) or moved out of a list; a recreate and an unowed remote move still get in |
| `two-windows.test.ts` (3) | Two WKWebViews on one queue: an acked op is never resurrected |
| `desktop-pull.test.ts` (5) | The 60s pull: scope, owing gate, skipped heavy fragments |
| `live-apply-fidelity.test.ts` (3) | Realtime keeps `task_labels`; a DELETE with queued work defers instead of claiming success |
| `task-offline.test.tsx` (12) | The real `useTaskMutations` hook: offline create, reconnect delivery, force-quit survival, coalesced edits, label diffing, parked rejections |
| `write-races.test.ts` (13) | A late echo after the ack; a refetch in flight across a drag (and its re-run after the drain); first loads never cancelled; delivery waits for the mirror |
| `../event-writeback.test.tsx` (7) | The real `useExternalEventMutations` over a held-open transport: one PATCH at a time, coalesced, stale echoes ignored; the create's temp row and its swap; Task → Event |
| `../event-writeback-row.test.ts` (5) | The functions' guarded row rewrite |
