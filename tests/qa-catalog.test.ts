/**
 * The QA catalog (qa/) is the script a QA bot follows against the live app.
 * It is only worth anything while it matches the app, so this holds it there:
 *
 *  • every scenario is well-formed (id, shell, priority, surface, steps, expect);
 *  • every place a user can navigate to — derived from the code's own
 *    registries, not a list kept here — is exercised by at least one scenario.
 *    Add a page, a bottom-bar tab, a calendar view, a build face or a Settings
 *    section and this fails until a scenario covers it. That is the "update the
 *    catalog on major changes" rule, enforced instead of remembered;
 *  • every «seeded record» a scenario names exists in the seed fixture, so
 *    renaming fixture data can't silently strand the bot.
 *
 * Small changes (a label's wording, a new menu item) don't trip it — those are
 * the CLAUDE.md rule's job. See qa/README.md.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs, no types
import { buildWorld, seededNames, addDays, mondayOf, at } from "../scripts/qa/fixture.mjs";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

interface Scenario {
  id: string;
  file: string;
  title: string;
  shell: string;
  priority: string;
  surfaces: string[];
  writes: string;
  manual: string | null;
  steps: number;
  expects: number;
  body: string;
}

function parseCatalog(): Scenario[] {
  const dir = join(ROOT, "qa/scenarios");
  const out: Scenario[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const text = readFileSync(join(dir, file), "utf8");
    const chunks = text.split(/^### /m).slice(1);
    for (const chunk of chunks) {
      const [heading, meta = "", ...rest] = chunk.split("\n");
      const body = rest.join("\n");
      const m = /^(QA-[A-Z]+-\d{2}) · (.+)$/.exec(heading.trim());
      const field = (k: string) => new RegExp(`(?:^|· )${k}: ([^·]+)`).exec(meta)?.[1]?.trim() ?? "";
      const stepsBlock = /\*\*Steps\*\*\n([\s\S]*?)(\n\*\*Expect\*\*|$)/.exec(body)?.[1] ?? "";
      const expectBlock = /\*\*Expect\*\*\n([\s\S]*)$/.exec(body)?.[1] ?? "";
      out.push({
        id: m?.[1] ?? `MALFORMED(${heading.trim().slice(0, 40)})`,
        file,
        title: m?.[2] ?? "",
        shell: field("Shell"),
        priority: field("Priority"),
        surfaces: field("Surface").split(",").map((s) => s.trim()).filter(Boolean),
        writes: field("Writes"),
        manual: /^Manual: (.+)$/m.exec(body)?.[1] ?? null,
        steps: (stepsBlock.match(/^\d+\. /gm) ?? []).length,
        expects: (expectBlock.match(/^- /gm) ?? []).length,
        body: chunk,
      });
    }
  }
  return out;
}

/** `{ id: "x", label: "Y" }` pairs inside the `const NAME … = [ … ];` block. */
function registry(path: string, constName: string, key: "id" | "value" | "label"): string[] {
  const src = read(path);
  const start = src.indexOf(`const ${constName}`);
  expect(start, `${constName} not found in ${path} — update tests/qa-catalog.test.ts`).toBeGreaterThan(-1);
  const end = src.indexOf("];", start);
  const block = src.slice(start, end);
  return [...block.matchAll(new RegExp(`${key}: "([^"]+)"`, "g"))].map((m) => m[1]);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Every place the code says a user can go, as the Surface ids scenarios use. */
function requiredSurfaces(): string[] {
  return [
    ...registry("src/components/Spine.tsx", "RUNGS", "label").map((l) => `desktop:${slug(l)}`),
    ...registry("src/components/mobile/MobileShell.tsx", "NAV", "id").map((id) => `phone:${id}`),
    ...registry("src/components/CalendarPane.tsx", "CAL_VIEWS", "label").map((l) => `calendar-view:${slug(l)}`),
    ...registry("src/components/FloorPane.tsx", "FACES", "value").map((v) => `build-face:${v}`),
    ...registry("src/components/SettingsModal.tsx", "SECTIONS", "id").map((id) => `settings:${id}`),
  ];
}

const SCENARIOS = parseCatalog();

describe("QA catalog", () => {
  it("parses a real catalog", () => {
    expect(SCENARIOS.length).toBeGreaterThan(50);
  });

  it("has well-formed, unique ids", () => {
    expect(SCENARIOS.filter((s) => s.id.startsWith("MALFORMED")).map((s) => s.id)).toEqual([]);
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const s of SCENARIOS) {
      if (seen.has(s.id)) dupes.push(`${s.id} (${seen.get(s.id)} and ${s.file})`);
      seen.set(s.id, s.file);
    }
    expect(dupes).toEqual([]);
  });

  it("gives every scenario a shell, priority, surface and a writes flag", () => {
    const bad = SCENARIOS.filter(
      (s) =>
        !["desktop", "phone", "both"].includes(s.shell) ||
        !["P0", "P1", "P2"].includes(s.priority) ||
        s.surfaces.length === 0 ||
        !["yes", "no"].includes(s.writes),
    ).map((s) => `${s.id}: shell=${s.shell} priority=${s.priority} surfaces=${s.surfaces.length} writes=${s.writes}`);
    expect(bad).toEqual([]);
  });

  it("has no scenario without steps or without expectations", () => {
    // A scenario that expects nothing is a green light that means nothing.
    const weak = SCENARIOS.filter((s) => s.steps === 0 || s.expects === 0).map((s) => `${s.id} (${s.steps} steps, ${s.expects} expects)`);
    expect(weak).toEqual([]);
  });

  it("covers every place the app can take you", () => {
    const covered = new Set(SCENARIOS.filter((s) => !s.manual).flatMap((s) => s.surfaces));
    const missing = requiredSurfaces().filter((s) => !covered.has(s));
    expect(missing, "a page/tab/view/section with no QA scenario — add one to qa/scenarios/ (see qa/README.md)").toEqual([]);
  });

  it("only names seeded records that the seed actually creates", () => {
    const names: Set<string> = seededNames();
    const files = [...readdirSync(join(ROOT, "qa/scenarios")).map((f) => `qa/scenarios/${f}`), "qa/WORLD.md"];
    const stranded: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/«([^»]+)»/g)) {
        if (m[1] === "guillemets") continue; // WORLD.md explaining the notation
        if (!names.has(m[1])) stranded.push(`${f}: «${m[1]}»`);
      }
    }
    expect(stranded, "«name» not in scripts/qa/fixture.mjs — rename it in the scenario or the fixture").toEqual([]);
  });

  it("keeps what the bot creates recognisable", () => {
    // Everything a scenario types as a new record starts with "QA " (RUNBOOK §2).
    const typed = SCENARIOS.flatMap((s) =>
      [...s.body.matchAll(/(?:type|Type|Send|Capture the task|Name it|Name:)[^"\n]*"([^"]+)"/g)].map((m) => ({ id: s.id, text: m[1] })),
    );
    const exempt = /^(QA|qa)|^\?|^what|^who|^remember|^split|^trash|^actually|^permanently|^nag|^delete$|^DELETE$|^9am|^case study$|@example\.com$/i;
    const bad = typed.filter((t) => !exempt.test(t.text)).map((t) => `${t.id}: "${t.text}"`);
    expect(bad).toEqual([]);
  });
});

describe("QA fixture", () => {
  const n = () => {
    let i = 0;
    return () => `00000000-0000-4000-8000-${String(++i).padStart(12, "0")}`;
  };

  it("dates the week from Monday, whatever day it is seeded", () => {
    expect(mondayOf("2026-11-18")).toBe("2026-11-16"); // Wed
    expect(mondayOf("2026-11-16")).toBe("2026-11-16"); // Mon
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // Sun
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09"); // across the DST change
  });

  it("puts wall-clock times in Los Angeles, across DST", () => {
    expect(at("2026-07-01", "09:00")).toBe("2026-07-01T16:00:00.000Z"); // PDT
    expect(at("2026-12-01", "09:00")).toBe("2026-12-01T17:00:00.000Z"); // PST
  });

  it("only points at rows it also creates, in an order the API accepts", () => {
    // The REST layer checks each FK against rows that already exist (rest.ts),
    // so a parent must be inserted in an earlier table than its child.
    for (const today of ["2026-11-16", "2026-11-18", "2026-11-22"]) {
      const w = buildWorld({ today, uuid: n() });
      const order = Object.keys(w.tables);
      const where = new Map<string, string>();
      for (const [table, rows] of Object.entries(w.tables) as [string, Record<string, unknown>[]][]) {
        for (const r of rows) if (typeof r.id === "string") where.set(r.id, table);
      }
      for (const [table, rows] of Object.entries(w.tables) as [string, Record<string, unknown>[]][]) {
        for (const r of rows) {
          for (const [col, v] of Object.entries(r)) {
            if (col === "id" || !col.endsWith("_id") || v == null) continue;
            const parent = where.get(v as string);
            expect(parent, `${table}.${col} points at nothing`).toBeDefined();
            expect(order.indexOf(parent!), `${table}.${col} → ${parent} is inserted later`).toBeLessThan(order.indexOf(table));
          }
        }
      }
    }
  });

  it("gives each recurring occurrence a unique date", () => {
    const w = buildWorld({ today: "2026-11-18", uuid: n() });
    const keys = w.tables.tasks.filter((t: { recurrence_id?: string }) => t.recurrence_id).map((t: { recurrence_id: string; recurrence_date: string }) => `${t.recurrence_id}:${t.recurrence_date}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
