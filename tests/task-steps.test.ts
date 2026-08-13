// Steps — and the one line that keeps them from becoming a fifth pool.
//
// A step is an ordinary `tasks` row. That is what makes the feature cheap, and
// it is also its single failure mode: any task query that forgets
// `.is("parent_task_id", null)` puts checklist items in the inbox, on the
// calendar, in capacity and in the funnel's rollups.
//
// Nobody catches that by eye — it is one missing line in one of eight queries,
// and the symptom appears on a surface far away from the edit. So it is
// asserted structurally: this walks the real query files.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stepProgress } from "../src/components/TaskSteps";
import type { Task } from "../src/lib/types";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Every `supabase.from("tasks").select(...)` chain in a file, as source text. */
function taskQueries(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /\.from\("tasks"\)\s*\n?\s*\.select\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // The chain runs to the first `;` at the end of a statement.
    const end = src.indexOf(";", m.index);
    const body = src.slice(m.index, end === -1 ? src.length : end);
    // Name it by the nearest enclosing `export function` / `const … =` above.
    const before = src.slice(0, m.index);
    const fn = [...before.matchAll(/(?:export )?function (\w+)|const (\w+) =/g)].pop();
    out.push({ name: fn?.[1] ?? fn?.[2] ?? `query@${before.split("\n").length}`, body });
  }
  return out;
}

describe("steps are not tasks", () => {
  it("every task list query excludes steps", () => {
    const offenders: string[] = [];
    for (const file of ["src/hooks/useTasks.ts", "src/hooks/useSlots.ts"]) {
      const src = read(file);
      for (const q of taskQueries(src)) {
        // The steps query is the one that deliberately asks FOR them.
        if (/\.eq\("parent_task_id"/.test(q.body)) continue;
        if (/\.is\("parent_task_id", null\)/.test(q.body)) continue;
        offenders.push(`${file} → ${q.name}`);
      }
    }
    expect(
      offenders,
      "These read tasks without excluding steps. A checklist item would show up as a task:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the schema forbids a step the fields that would make it schedulable", () => {
    // The restriction is what pays for reusing `tasks` instead of adding a pool
    // (Principle 10). If it ever softens, the trade stops being paid.
    const sql = read("supabase/migrations/00000000000060_task_steps.sql");
    for (const col of [
      "do_date",
      "start_time",
      "deadline",
      "slot_id",
      "project_id",
      "initiative_id",
      "domain_id",
      "sprint_id",
      "recurrence_id",
    ]) {
      expect(sql, `a step may still carry ${col}`).toMatch(new RegExp(`and ${col} is null|${col} is null`));
    }
  });

  it("steps are one level deep", () => {
    const sql = read("supabase/migrations/00000000000060_task_steps.sql");
    expect(sql).toMatch(/a step cannot hold steps/);
  });

  it("rollover never touches a step", () => {
    // A step has no date to roll, and rolling one would violate the check
    // constraint — so the query that rolls has to know.
    const sql = read("supabase/migrations/00000000000060_task_steps.sql");
    const fn = sql.slice(sql.indexOf("rollover_tasks"));
    expect(fn).toMatch(/parent_task_id is null/);
  });

  it("the agent can reach steps, and only through step tools", async () => {
    const { TOOL_DEFINITIONS } = await import("../supabase/functions/agent/toolDefs.ts");
    const names = TOOL_DEFINITIONS.map((t) => t.function.name);
    for (const t of ["add_step", "complete_step", "list_steps", "remove_step"]) {
      expect(names, `${t} is missing`).toContain(t);
    }
    // No step tool may take a scheduling argument — the same restriction the
    // schema enforces, at the vocabulary layer.
    const banned = ["do_date", "start_time", "deadline", "project_id", "priority", "duration_minutes"];
    for (const t of TOOL_DEFINITIONS.filter((d) => d.function.name.endsWith("_step") || d.function.name === "add_step")) {
      const props = Object.keys(t.function.parameters?.properties ?? {});
      for (const b of banned) {
        expect(props, `${t.function.name} accepts ${b} — a step is not schedulable`).not.toContain(b);
      }
    }
  });
});

describe("stepProgress", () => {
  const step = (status: Task["status"]): Task => ({ status } as Task);

  it("counts done over total", () => {
    expect(stepProgress([step("done"), step("backlog"), step("done")])).toEqual({ done: 2, total: 3 });
  });

  it("is zero-safe", () => {
    expect(stepProgress([])).toEqual({ done: 0, total: 0 });
  });
});
