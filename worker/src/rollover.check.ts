// Rollover (D-145 / D-147) — runs the Worker's real statement against Postgres.
// The first port was a copy of the pre-D-145 SQL; the vitest guard read the
// legacy Supabase migration, so nothing noticed. This drives the code that ships.
// Run: node --experimental-strip-types worker/src/rollover.check.ts

import { PGlite } from "@electric-sql/pglite";
import { applyIsolationSchema } from "./isolationDb.ts";
import { makePgliteSql } from "./pgliteSql.ts";
import { rolloverUserTasks } from "./rollover.ts";
import { findWronglyCarried, repairWronglyCarried } from "./rolloverRepair.ts";

const fails: string[] = [];
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) fails.push(msg);
}

const db = new PGlite();
await applyIsolationSchema(db);
const sql = makePgliteSql(db);

const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
await db.query(`INSERT INTO users (id, email) VALUES ($1, 'roll-me@example.test'), ($2, 'roll-other@example.test')`, [ME, OTHER]);
await db.query(`INSERT INTO user_settings (user_id) VALUES ($1), ($2) ON CONFLICT DO NOTHING`, [ME, OTHER]);

// Saturday 2026-11-14 — the day the weekly "Get ready for Sunday service" showed
// three copies on Today, one of them carried 114 days.
const TODAY = "2026-11-14";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

interface Seed {
  user?: string;
  title?: string;
  status?: string;
  doDate: string | null;
  startTime?: string | null;
  rollCount?: number;
  rec?: { series: string; date: string; overridden?: boolean };
  slotId?: string | null;
  parent?: string | null;
}

async function task(s: Seed): Promise<string> {
  const tid = id();
  await db.query(
    `INSERT INTO tasks (id, user_id, title, status, do_date, start_time, roll_count,
                        recurrence_id, recurrence_date, recurrence_overridden, slot_id, parent_task_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      tid,
      s.user ?? ME,
      s.title ?? "t",
      s.status ?? "planned",
      s.doDate,
      s.startTime ?? null,
      s.rollCount ?? 0,
      s.rec?.series ?? null,
      s.rec?.date ?? null,
      s.rec?.overridden ?? false,
      s.slotId ?? null,
      s.parent ?? null,
    ],
  );
  return tid;
}

interface Row {
  do_date: string;
  status: string;
  roll_count: number;
  start_time: string | null;
  slot_id: string | null;
  recurrence_overridden: boolean;
}
async function row(tid: string): Promise<Row> {
  const r = await db.query<Row>(
    `SELECT do_date::text, status, roll_count, start_time::text, slot_id, recurrence_overridden FROM tasks WHERE id = $1`,
    [tid],
  );
  return r.rows[0]!;
}

// ── A weekly Thursday series, as in the screenshot ──────────────────────────
// Oct 29 and Nov 5 were missed; Nov 12 was ticked; Nov 19 is materialised ahead.
const WEEKLY = id();
const jul = await task({ title: "Get Ready for Sunday Service", doDate: "2026-07-23", rec: { series: WEEKLY, date: "2026-07-23" } });
const oct29 = await task({ title: "Get Ready for Sunday Service", doDate: "2026-10-29", rec: { series: WEEKLY, date: "2026-10-29" } });
const nov5 = await task({ title: "Get Ready for Sunday Service", doDate: "2026-11-05", rec: { series: WEEKLY, date: "2026-11-05" } });
const nov12 = await task({ title: "Get Ready for Sunday Service", status: "done", doDate: "2026-11-12", rec: { series: WEEKLY, date: "2026-11-12" } });
const nov19 = await task({ title: "Get Ready for Sunday Service", doDate: "2026-11-19", rec: { series: WEEKLY, date: "2026-11-19" } });

// ── A weekly series whose latest due occurrence is the open one ─────────────
const WRITE = id();
const writeOld = await task({ title: "Write", doDate: "2026-11-03", rec: { series: WRITE, date: "2026-11-03" } });
const writeNow = await task({ title: "Write", doDate: "2026-11-10", startTime: "2026-11-10T18:00:00Z", rec: { series: WRITE, date: "2026-11-10" } });

// ── A daily habit: today's supersedes yesterday's ───────────────────────────
const DAILY = id();
const dailyYesterday = await task({ title: "Stretch", doDate: "2026-11-13", rec: { series: DAILY, date: "2026-11-13" } });
const dailyToday = await task({ title: "Stretch", doDate: TODAY, rec: { series: DAILY, date: TODAY } });

// ── A trashed later occurrence supersedes nothing ───────────────────────────
const TRASH = id();
const trashEarly = await task({ title: "Review", doDate: "2026-11-09", rec: { series: TRASH, date: "2026-11-09" } });
await task({ title: "Review", status: "trashed", doDate: "2026-11-12", rec: { series: TRASH, date: "2026-11-12" } });

// ── Ordinary work ───────────────────────────────────────────────────────────
const plain = await task({ title: "Call David", doDate: "2026-11-11", startTime: "2026-11-11T17:00:00Z", rollCount: 2 });
const inbox = await task({ title: "Inbox thing", status: "inbox", doDate: "2026-11-12" });
const future = await task({ title: "Later", doDate: "2026-11-20" });
const undated = await task({ title: "Someday", status: "inbox", doDate: null });
const done = await task({ title: "Finished", status: "done", doDate: "2026-11-10" });
const parent = await task({ title: "Project work", doDate: TODAY });
const step = await task({ title: "A step", doDate: "2026-11-09", parent });
const theirs = await task({ user: OTHER, title: "Theirs", doDate: "2026-11-01" });

// A task whose own date is stale but whose slot passed on Nov 13.
const slotId = id();
await db.query(
  `INSERT INTO slots (id, user_id, title, do_date, start_time, duration_minutes)
   VALUES ($1, $2, 'Deep work', '2026-11-13', '2026-11-13T17:00:00Z', 60)`,
  [slotId, ME],
);
const inSlot = await task({ title: "In a slot", doDate: TODAY, startTime: "2026-11-13T17:00:00Z", slotId });

const moved = await rolloverUserTasks(sql, ME, TODAY);

// Superseded occurrences stay exactly where they were — the bug was moving them.
for (const [name, tid, date] of [
  ["Jul 23 (114 days stale)", jul, "2026-07-23"],
  ["Oct 29", oct29, "2026-10-29"],
  ["Nov 5", nov5, "2026-11-05"],
] as const) {
  const r = await row(tid);
  ok(r.do_date === date, `${name}: a superseded occurrence stays on ${date} (got ${r.do_date})`);
  ok(r.roll_count === 0, `${name}: no carry mark (got ↻${r.roll_count}d)`);
  ok(!moved.includes(tid), `${name}: not in the moved set`);
}
ok((await row(nov12)).status === "done" && (await row(nov12)).do_date === "2026-11-12", "a ticked occurrence is untouched");
ok((await row(nov19)).do_date === "2026-11-19", "a future occurrence is untouched");

// The one open occurrence with nothing after it carries, pinned, with days.
const wn = await row(writeNow);
ok(wn.do_date === TODAY, `the latest due occurrence carries to today (got ${wn.do_date})`);
ok(wn.roll_count === 4, `…and says how many days: ↻4d (got ${wn.roll_count})`);
ok(wn.recurrence_overridden === true, "…and is pinned so an edit-all leaves it");
ok(wn.start_time === null, "…and lands in anytime");
ok((await row(writeOld)).do_date === "2026-11-03", "the older Write stays superseded: at most one per series");

// Daily habits never pile up.
ok((await row(dailyYesterday)).do_date === "2026-11-13", "a daily habit's yesterday stays yesterday");
ok((await row(dailyToday)).do_date === TODAY, "today's occurrence is where it was");

// A trashed later occurrence is not a stand-in.
ok((await row(trashEarly)).do_date === TODAY, "a trashed later occurrence does not supersede");

// Ordinary work.
const p = await row(plain);
ok(p.do_date === TODAY && p.roll_count === 5 && p.start_time === null, `plain task carries and adds the gap (↻${p.roll_count}d, ${p.do_date})`);
ok(p.recurrence_overridden === false, "a plain task is never pinned");
ok((await row(inbox)).do_date === TODAY && (await row(inbox)).status === "planned", "an inbox row with a past date carries and becomes planned");
ok((await row(future)).do_date === "2026-11-20", "future work stays");
ok((await row(undated)).do_date === null, "undated work stays undated");
ok((await row(done)).do_date === "2026-11-10", "done work stays");
ok((await row(step)).do_date === "2026-11-09", "a step is never rolled");
ok((await row(theirs)).do_date === "2026-11-01", "another user's work is never touched");

// Slot children are judged by the slot's date and leave the slot.
const s = await row(inSlot);
ok(s.slot_id === null && s.start_time === null, "a task in a passed slot leaves it and drops the clock");
ok(s.roll_count === 1 && s.do_date === TODAY, `a task in a passed slot is one day late by the slot's date (↻${s.roll_count}d)`);

// Exactly the carried set.
const expected = [writeNow, trashEarly, plain, inbox, inSlot].sort();
ok(JSON.stringify([...moved].sort()) === JSON.stringify(expected), `moved exactly the carried set (got ${moved.length}, want ${expected.length})`);

const last = await db.query<{ d: string }>(`SELECT last_rollover_date::text AS d FROM user_settings WHERE user_id = $1`, [ME]);
ok(last.rows[0]?.d === TODAY, "stamps last_rollover_date");

// Idempotent: a second run the same day moves nothing.
const again = await rolloverUserTasks(sql, ME, TODAY);
ok(again.length === 0, `a second run the same day moves nothing (moved ${again.length})`);

// ── Repair: rows the buggy Worker already dragged to today ──────────────────
// Reproduce the damage by hand: superseded occurrences moved onto the rollover
// day with a carry mark, exactly as the first port left them.
const damaged = [jul, oct29, nov5];
await db.query(`UPDATE tasks SET do_date = $1, roll_count = 114 WHERE id = ANY($2::uuid[])`, [TODAY, damaged]);
// Decoys the repair must leave: the live carried occurrence, a superseded row a person
// put on a different day by hand (no carry mark), and another series' live row.
await db.query(`UPDATE tasks SET do_date = '2026-11-16' WHERE id = $1`, [writeOld]);

const found = await findWronglyCarried(sql, { today: TODAY });
ok(
  JSON.stringify(found.map((f) => f.id).sort()) === JSON.stringify([...damaged].sort()),
  `repair finds exactly the superseded rows on the rollover day (found ${found.length})`,
);
ok(!found.some((f) => f.id === writeNow), "repair never lists the series' live occurrence");
ok(!found.some((f) => f.id === writeOld), "repair never lists a hand-moved row with no carry mark");
ok((await findWronglyCarried(sql, { today: TODAY, email: "roll-other@example.test" })).length === 0, "repair can be scoped to one account");

const restored = await repairWronglyCarried(sql, found.map((f) => f.id), "restore");
ok(restored === 3, `repair restores all three (restored ${restored})`);
const j = await row(jul);
ok(j.do_date === "2026-07-23" && j.roll_count === 0, "…back on their own dates with no carry mark");
ok((await findWronglyCarried(sql, { today: TODAY })).length === 0, "…and a second repair finds nothing");
// The fixed rollover leaves the restored rows exactly where they are.
await rolloverUserTasks(sql, ME, TODAY);
ok((await row(jul)).do_date === "2026-07-23", "…and the next rollover does not carry them again");

await db.query(`UPDATE tasks SET do_date = $1, roll_count = 9 WHERE id = $2`, [TODAY, oct29]);
const trashed = await repairWronglyCarried(sql, [oct29], "trash");
ok(trashed === 1 && (await row(oct29)).status === "trashed", "trash mode sends one to the Trash instead");

if (fails.length) {
  console.error(`rollover.check: ${fails.length} of ${checks} failed`);
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`rollover.check: ${checks} checks passed`);
