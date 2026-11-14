// Rollover lands unfinished day-work in anytime — asserted against the SQL.
//
// NB: this file reads the LEGACY Supabase migration, which nothing runs any more.
// Production rollover is the Worker's `worker/src/rollover.ts`, held by
// `worker/src/rollover.check.ts` (runs the real statement on PGlite) and by the
// last describe below. The Worker's first port dropped D-145 and nothing here
// noticed, because this file was guarding a copy.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "supabase/migrations");

function latestRolloverSql(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const src = readFileSync(join(MIGRATIONS, files[i]), "utf8");
    const at = src.lastIndexOf("create or replace function public.rollover_tasks");
    if (at === -1) continue;
    return src.slice(at);
  }
  throw new Error("no rollover_tasks definition in migrations");
}

describe("rollover lands in anytime", () => {
  const fn = latestRolloverSql();

  it("clears the clock so the block does not keep yesterday's hour", () => {
    expect(fn).toMatch(/start_time = null/);
    expect(fn).not.toMatch(/interval '1 day'/);
  });

  it("a slot child leaves the passed slot and does not inherit its clock", () => {
    expect(fn).toMatch(/slot_id = null/);
    expect(fn).toMatch(/left join public\.slots/);
    expect(fn).not.toMatch(/slot_start/);
  });

  it("never rolls a step", () => {
    expect(fn).toMatch(/parent_task_id is null/);
  });

  // D-145: a missed occurrence carries until the series' next one comes due.
  it("rolls a recurring occurrence only while no later occurrence is due", () => {
    expect(fn).toMatch(/t\.recurrence_id is null\s+or not exists/);
    expect(fn).toMatch(/nx\.recurrence_id = t\.recurrence_id/);
    expect(fn).toMatch(/nx\.recurrence_date > t\.recurrence_date/);
    expect(fn).toMatch(/nx\.recurrence_date <= p_today/);
  });

  it("pins a carried occurrence so an edit-all regeneration leaves it", () => {
    expect(fn).toMatch(/recurrence_overridden = t\.recurrence_overridden or t\.recurrence_id is not null/);
  });
});

// D-147: the ↻ badge reads as "how long", so the count is days, not runs.
describe("roll_count counts days carried", () => {
  it("adds the gap between the missed date and today", () => {
    expect(latestRolloverSql()).toMatch(/roll_count = t\.roll_count \+ \(p_today - d\.eff_date\)/);
  });
});

// The Worker is production. It must have ONE rollover, and it must carry the same rules.
describe("the Worker's rollover is one definition and keeps D-145 / D-147", () => {
  const worker = readFileSync(join(ROOT, "worker/src/rollover.ts"), "utf8");
  const cron = readFileSync(join(ROOT, "worker/src/cronJobs.ts"), "utf8");

  it("cron and the user route both call it, and neither carries its own UPDATE", () => {
    expect(cron).toMatch(/rolloverUserTasks\(sql, user\.id, today\)/);
    expect(cron).toMatch(/rolloverUserTasks\(got\.store\.sql, got\.store\.userId, today\)/);
    // A second copy is how the first port lost D-145: any task UPDATE that sets do_date to today.
    expect(cron).not.toMatch(/UPDATE tasks[\s\S]{0,120}SET do_date = \$\{today\}/);
  });

  it("holds the same rules as the legacy SQL", () => {
    expect(worker).toMatch(/t\.recurrence_id IS NULL\s+OR NOT EXISTS/);
    expect(worker).toMatch(/nx\.recurrence_id = t\.recurrence_id/);
    expect(worker).toMatch(/nx\.recurrence_date > t\.recurrence_date/);
    expect(worker).toMatch(/nx\.recurrence_date <= \$\{today\}::date/);
    expect(worker).toMatch(/nx\.status <> 'trashed'/);
    expect(worker).toMatch(/recurrence_overridden = t\.recurrence_overridden OR t\.recurrence_id IS NOT NULL/);
    expect(worker).toMatch(/roll_count = t\.roll_count \+ \(\$\{today\}::date - d\.eff_date\)/);
    expect(worker).toMatch(/LEFT JOIN slots/);
    expect(worker).toMatch(/parent_task_id IS NULL/);
    expect(worker).toMatch(/slot_id = NULL/);
  });
});
