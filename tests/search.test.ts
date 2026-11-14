// Search — the one ranking both shells read (D-210). The phone's Search sheet
// and the desktop's `/` door are layouts; what "the best answer" is lives in
// lib/search.ts and is pinned here.

import { beforeAll, describe, expect, it } from "vitest";
import { nlpReady } from "../src/lib/nlp";
import { dateIntent, matchText, queryWords, recentHits, searchSections, taskWhen, type SearchInput } from "../src/lib/search";
import type { Task } from "../src/lib/types";
import type { VerticalData } from "../src/lib/vertical";

const TODAY = "2026-11-14"; // a Saturday

const domain = (id: string, name: string, over = {}) => ({ id, name, color: "#123456", icon: "circle", intention: "", ...over });
const project = (id: string, name: string, over = {}) => ({
  id,
  name,
  domainId: "d-work",
  initiativeId: null,
  outcome: "",
  status: "in_progress",
  ...over,
});
const initiative = (id: string, name: string, over = {}) => ({ id, name, domainId: "d-work", outcome: "", status: "in_progress", ...over });

const vertical = {
  domains: [domain("d-work", "Work"), domain("d-church", "Sunday Church Experience")],
  initiatives: [initiative("i-launch", "Launch the paid plan")],
  projects: [
    project("p-deck", "Investor deck", { initiativeId: "i-launch" }),
    project("p-old", "Old deck archive", { status: "complete" }),
  ],
  tasks: [],
} as unknown as VerticalData;

const task = (id: string, title: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    title,
    notes: "",
    status: "backlog",
    do_date: null,
    deadline: null,
    project_id: null,
    initiative_id: null,
    domain_id: null,
    parent_task_id: null,
    ...over,
  }) as Task;

const tasks: Task[] = [
  task("t-today", "Send deck to Sam", { do_date: TODAY, status: "planned", project_id: "p-deck" }),
  task("t-later", "Send deck to Priya", { do_date: "2026-12-20", status: "planned" }),
  task("t-done", "Send deck to Lee", { status: "done" }),
  task("t-trash", "Send deck to trash", { status: "trashed" }),
  task("t-step", "Send deck — step", { parent_task_id: "t-today" }),
  task("t-notes", "Call the bank", { notes: "ask about the wire for the deck printer" }),
];

const input = (over: Partial<SearchInput> = {}): SearchInput => ({ vertical, tasks, today: TODAY, ...over });
const ids = (q: string, over?: Partial<SearchInput>) => searchSections(q, input(over)).flatMap((s) => s.hits.map((h) => h.id));

describe("matching", () => {
  it("takes words in any order, at the start of words", () => {
    expect(matchText(queryWords("deck inv"), "Investor deck")).not.toBeNull();
    expect(matchText(queryWords("vestor"), "Investor deck")).not.toBeNull(); // 3+ chars, inside a word
    expect(matchText(queryWords("es"), "Investor deck")).toBeNull(); // too short to match mid-word
  });

  it("needs every word to land", () => {
    expect(matchText(queryWords("deck banana"), "Investor deck")).toBeNull();
  });

  it("reads initials as an acronym", () => {
    const m = matchText(["sce"], "Sunday Church Experience");
    expect(m).not.toBeNull();
    expect(m!.ranges).toEqual([[0, 1], [7, 8], [14, 15]]);
  });

  it("ignores case and accents, and keeps ranges on the original text", () => {
    const m = matchText(queryWords("cafe"), "Café run");
    expect(m!.ranges).toEqual([[0, 4]]);
  });

  it("drops capture's # and @ sigils so a habit doesn't break the search", () => {
    expect(queryWords("#work @deck")).toEqual(["work", "deck"]);
  });
});

describe("ranking", () => {
  it("puts today's task above the same words due later, and done last", () => {
    const order = ids("send deck").filter((id) => id.startsWith("t-"));
    expect(order.slice(0, 3)).toEqual(["t-today", "t-later", "t-done"]);
  });

  it("keeps a done title match below live work found through its project", () => {
    const local = [
      task("live", "Draft the runbook", { do_date: TODAY, status: "planned", project_id: "p-deck" }),
      task("old", "Investor deck backup", { status: "done" }),
    ];
    const order = ids("investor deck", { tasks: local }).filter((id) => id === "live" || id === "old");
    expect(order).toEqual(["live", "old"]);
  });

  it("never shows trashed tasks or a task's steps", () => {
    const found = ids("send deck");
    expect(found).not.toContain("t-trash");
    expect(found).not.toContain("t-step");
  });

  it("reads an acronym on an item's own name, never through its parent", () => {
    // "id" = Investor deck. Its tasks must not ride along on their project's initials.
    const found = ids("id");
    expect(found).toContain("p-deck");
    expect(found).not.toContain("t-today");
  });

  it("finds a task through its notes, and its parent project's name", () => {
    expect(ids("printer")).toContain("t-notes");
    expect(ids("investor sam")).toContain("t-today");
  });

  it("orders sections by their best hit, so ↵ opens the best answer of any kind", () => {
    const sections = searchSections("investor deck", input());
    expect(sections[0].kind).toBe("project");
    expect(sections[0].hits[0].id).toBe("p-deck");
  });

  it("sinks a shipped project below a live one with the same word", () => {
    const projects = searchSections("deck", input()).find((s) => s.kind === "project")!.hits.map((h) => h.id);
    expect(projects).toEqual(["p-deck", "p-old"]);
  });

  it("lifts what you opened from search before", () => {
    const before = ids("send deck").indexOf("t-later");
    const after = ids("send deck", { recent: [{ kind: "task", id: "t-later" }] }).indexOf("t-later");
    expect(after).toBeLessThan(before);
  });

  it("returns nothing for an empty query", () => {
    expect(searchSections("   ", input())).toEqual([]);
  });
});

describe("the empty search", () => {
  it("shows recents that still exist, in order", () => {
    const hits = recentHits(
      input({ recent: [{ kind: "project", id: "p-deck" }, { kind: "task", id: "gone" }, { kind: "domain", id: "d-church" }] }),
    );
    expect(hits.map((h) => h.id)).toEqual(["p-deck", "d-church"]);
  });
});

describe("a task's when", () => {
  it("speaks relatively where a word pins the day", () => {
    expect(taskWhen({ do_date: TODAY, status: "planned", deadline: null }, TODAY)).toBe("Today");
    expect(taskWhen({ do_date: "2026-11-15", status: "planned", deadline: null }, TODAY)).toBe("Tomorrow");
    expect(taskWhen({ do_date: "2026-11-17", status: "planned", deadline: null }, TODAY)).toBe("Tue");
    expect(taskWhen({ do_date: "2026-11-10", status: "planned", deadline: null }, TODAY)).toBe("Overdue");
    expect(taskWhen({ do_date: "2027-01-03", status: "planned", deadline: null }, TODAY)).toBe("Jan 3, 2027");
    expect(taskWhen({ do_date: TODAY, status: "done", deadline: null }, TODAY)).toBeUndefined();
  });
});

describe("a date is a place", () => {
  beforeAll(async () => {
    await nlpReady;
  });
  const now = new Date(2026, 10, 14, 10, 0);

  it("offers the day when the whole query is a date", () => {
    expect(dateIntent("tomorrow", now)?.dateISO).toBe("2026-11-15");
    expect(dateIntent("dec 3", now)?.dateISO).toBe("2026-12-03");
    expect(dateIntent("friday", now)?.label).toMatch(/Friday/);
  });

  it("stays out of a search that merely contains a date", () => {
    expect(dateIntent("call mom friday", now)).toBeNull();
    expect(dateIntent("deck", now)).toBeNull();
    expect(dateIntent("every monday", now)).toBeNull();
  });
});
