// Rollover lands unfinished day-work in anytime — asserted against the live SQL.

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

  it("still never rolls a recurring occurrence or a step", () => {
    expect(fn).toMatch(/recurrence_id is null/);
    expect(fn).toMatch(/parent_task_id is null/);
  });
});
