// What a block IS, said in words — `Project · 3 tasks`, `Slot · 2 captures`,
// `Task`. Three surfaces print it now (Plan the week's grid, the Schedule, the
// phone's Day lens), and the whole reason it lives in `lib/slots` is that a
// designation spelled twice is a designation that drifts: the ritual would say
// "Project · 3 tasks" over a block the Schedule called "▸ Frontier Site", and
// nobody would notice until someone read both in the same minute.
//
// So this asserts the spelling AND that no surface re-spells it by hand.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { blockDesignation } from "../src/lib/slots";

describe("blockDesignation", () => {
  it("names the kind when it has nothing else to say", () => {
    expect(blockDesignation({ kind: "project" })).toBe("Project");
    expect(blockDesignation({ kind: "slot" })).toBe("Slot");
    expect(blockDesignation({ kind: "task" })).toBe("Task");
  });

  it("counts what it holds, in the unit of its altitude", () => {
    expect(blockDesignation({ kind: "project", holds: 3 })).toBe("Project · 3 tasks");
    expect(blockDesignation({ kind: "project", holds: 1 })).toBe("Project · 1 task");
    expect(blockDesignation({ kind: "slot", holds: 2, unit: "capture" })).toBe("Slot · 2 captures");
  });

  it("says which sitting of a split run it is, ahead of the count", () => {
    // A run carved across two days: "part 1 of 2" is the fact you need, and the
    // count of pieces inside is not — the parts are the story.
    expect(
      blockDesignation({ kind: "project", holds: 4, part: { part: 1, parts: 2 } }),
    ).toBe("Project · part 1 of 2");
    // A single part is not a split — don't announce one.
    expect(blockDesignation({ kind: "project", holds: 4, part: { part: 1, parts: 1 } })).toBe(
      "Project · 4 tasks",
    );
  });

  it("falls back to the project's name when the surface counts elsewhere", () => {
    // The Schedule keeps the count in its `2/3` progress badge, so it passes the
    // name instead — and passes nothing when its own title already IS the name.
    expect(blockDesignation({ kind: "project", name: "Frontier Site" })).toBe(
      "Project · Frontier Site",
    );
    expect(blockDesignation({ kind: "project", name: "  " })).toBe("Project");
    expect(blockDesignation({ kind: "project", name: null })).toBe("Project");
  });

  it("prefers a real count to a name — a block says what it holds first", () => {
    expect(blockDesignation({ kind: "project", holds: 2, name: "Frontier Site" })).toBe(
      "Project · 2 tasks",
    );
    // Zero is not a count worth printing: an empty sitting is still "Project".
    expect(blockDesignation({ kind: "project", holds: 0, name: "Frontier Site" })).toBe(
      "Project · Frontier Site",
    );
  });
});

// ── no second spelling ──────────────────────────────────────────────────────
// The literal a surface would reach for if it hand-rolled the designation. Only
// `lib/slots.ts` (the definition) and this test may contain it.
const HAND_ROLLED = /["'`]Project · |["'`]Slot · |Project · \$\{/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("one spelling, everywhere", () => {
  it("no surface builds the designation by hand", () => {
    const root = join(__dirname, "..", "src");
    const offenders = walk(root)
      .filter((p) => !p.endsWith(join("lib", "slots.ts")))
      .filter((p) => HAND_ROLLED.test(readFileSync(p, "utf8")))
      .map((p) => p.slice(root.length + 1));
    expect(offenders, "import blockDesignation from lib/slots instead").toEqual([]);
  });
});
