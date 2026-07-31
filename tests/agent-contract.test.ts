// The half of the chat that can be pinned without a model.
//
// An LLM's judgment needs a live battery (tests/agent/, `npm run eval`), but
// most of the ways the chat has actually broken were not judgment at all:
//   · a tool the prompt describes that no longer exists
//   · a tool defined with no handler behind it — the model calls it, it throws
//   · a context field the prompt tells the model to read that stopped being sent
//   · two names for one thing, so "slot" meant a free window in one paragraph
//     and a real block of time in the next
//   · the turn loop swallowing a tool error, or answering with nothing at all
// None of those need a model to catch, and all of them are silent under
// typecheck. They run here, on every push, in milliseconds.
//
// Run: npm test

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { TOOL_DEFINITIONS, buildPointAtTool } from "../supabase/functions/agent/toolDefs.ts";
import { STATIC_SYSTEM_PROMPT } from "../supabase/functions/agent/prompt.ts";
import { buildTurnMessages } from "../supabase/functions/agent/turn.ts";
import { runAgentTurn, type ChatClient, type ChatMessage } from "../supabase/functions/agent/loop.ts";
import { MARQUEE_TARGETS, world } from "./agent/world.ts";
import { GROUPS, SCENARIOS } from "./agent/scenarios.ts";
import { WRITE_TOOLS } from "./agent/expect.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const toolNames = TOOL_DEFINITIONS.map((t) => t.function.name);
const handlerSource = read("supabase/functions/agent/tools.ts") + read("supabase/functions/agent/verticalTools.ts");
const handledCases = [...handlerSource.matchAll(/^\s*case "([a-z_]+)":/gm)].map((m) => m[1]);

// ── the vocabulary and the behavior behind it ────────────────────────────────

describe("tool vocabulary", () => {
  it("every tool the model is offered has a handler", () => {
    const orphans = toolNames.filter((n) => !handledCases.includes(n));
    expect(orphans, "defined for the model but nothing executes them").toEqual([]);
  });

  it("every handler is reachable — no dead branch pretending to be a capability", () => {
    // point_at is built per-request from the client's registry, not from the
    // static list, so it is handled without appearing in TOOL_DEFINITIONS.
    const known = new Set([...toolNames, "point_at"]);
    const dead = handledCases.filter((c) => !known.has(c));
    expect(dead, "handled but never offered to the model").toEqual([]);
  });

  it("every tool the prompt names by hand still exists", () => {
    // Only verb-shaped identifiers — the prompt is full of field names
    // (project_id, do_date, roll_count) that are not tools.
    const VERBS = /\b((?:create|update|delete|move|schedule|plan|cancel|decline|complete|trash|add|reschedule|unschedule|list|point)_[a-z_]+)\b/g;
    const claimed = new Set([...STATIC_SYSTEM_PROMPT.matchAll(VERBS)].map((m) => m[1]));
    // Some verb-shaped names are arguments, not tools (delete_all_matching).
    const paramNames = new Set(
      TOOL_DEFINITIONS.flatMap((t) => Object.keys(t.function.parameters?.properties ?? {})),
    );
    const known = new Set([...toolNames, "point_at"]);
    const missing = [...claimed].filter((c) => !known.has(c) && !paramNames.has(c));
    expect(missing, "the prompt tells the model to call these; they don't exist").toEqual([]);
  });

  it("every definition is a shape a provider will accept", () => {
    const broken: string[] = [];
    for (const t of [...TOOL_DEFINITIONS, buildPointAtTool(MARQUEE_TARGETS)]) {
      const f = t.function as {
        name: string;
        description?: string;
        parameters?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
      };
      if (!f.description?.trim()) broken.push(`${f.name}: no description`);
      const p = f.parameters;
      if (p?.type !== "object") broken.push(`${f.name}: parameters must be an object`);
      for (const r of p?.required ?? []) {
        if (!p?.properties || !(r in p.properties)) broken.push(`${f.name}: requires "${r}" but never defines it`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("keeps the write list honest — every mutating tool is one the battery knows is a write", () => {
    // A new write tool that isn't listed would silently pass every "propose,
    // don't act" scenario in the battery.
    const writeish = toolNames.filter((n) => /^(create|update|delete|move|schedule|plan|cancel|decline|complete|trash|add|reschedule|unschedule)_/.test(n));
    const missing = writeish.filter((n) => !WRITE_TOOLS.includes(n));
    expect(missing, "add these to WRITE_TOOLS in tests/agent/expect.ts").toEqual([]);
  });
});

// ── what the model is actually shown ─────────────────────────────────────────

describe("the snapshot the model reads", () => {
  const messages = buildTurnMessages({
    ctx: world("loaded"),
    tz: "America/Los_Angeles",
    messages: [{ role: "user", content: "hi" }],
  });
  const snapshot = messages[1].content as string;

  it("puts the cacheable half first, byte-identical, and the volatile half second", () => {
    expect(messages[0].content).toBe(STATIC_SYSTEM_PROMPT);
    expect(messages[0].content).not.toContain("2026-07-31"); // no date spliced into the cached prefix
    expect(snapshot).toContain("2026-07-31");
  });

  it("carries every field the prompt tells the model to read", () => {
    // The rename that motivated this: the prompt said todayFreeSlots long after
    // the context had stopped emitting it, and nothing failed.
    for (const field of [
      "todaySchedule", "todayOpenWindows", "todaySlots", "weekSlate",
      "needsASprint", "nextWeekSlate", "weekPriorities", "weekPool",
      "writableCalendars", "vertical", "inbox",
    ]) {
      expect(snapshot, `context stopped sending ${field}`).toContain(`"${field}"`);
      expect(STATIC_SYSTEM_PROMPT, `prompt never mentions ${field}`).toContain(field);
    }
  });

  it("names the user's zone, so the model reads the clock they're standing at", () => {
    const east = buildTurnMessages({
      ctx: world("traveling"),
      tz: "America/New_York",
      messages: [{ role: "user", content: "hi" }],
    })[1].content as string;
    expect(east).toContain("America/New_York");
  });
});

describe("one name, one meaning", () => {
  it("never calls a computed gap a slot — a Slot is a block the user holds", () => {
    // Principle 11. This collision is why "9am slot where I'll do X, Y and Z"
    // produced three tasks: the only "slot" the model knew was a free window.
    expect(STATIC_SYSTEM_PROMPT).not.toContain("todayFreeSlots");
    expect(STATIC_SYSTEM_PROMPT).not.toMatch(/free slot/i);
    expect(STATIC_SYSTEM_PROMPT).toContain("todayOpenWindows");
  });

  it("teaches the difference between a slot and a scheduled task", () => {
    expect(STATIC_SYSTEM_PROMPT).toMatch(/create_slot/);
    expect(STATIC_SYSTEM_PROMPT).toMatch(/schedule_task/);
  });
});

// ── the turn loop ────────────────────────────────────────────────────────────

/** A model on rails: hand it the rounds it should produce, in order. */
function scripted(rounds: { content?: string | null; calls?: { name: string; args: unknown }[] }[]): ChatClient {
  let i = 0;
  const next = () => rounds[i++] ?? { content: "" };
  const toCalls = (r: ReturnType<typeof next>) =>
    (r.calls ?? []).map((c, idx) => ({
      id: `call-${idx}`,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
  return {
    stream() {
      const r = next();
      const enc = new TextEncoder();
      const frames: string[] = [];
      if (r.content) frames.push(`data: ${JSON.stringify({ choices: [{ delta: { content: r.content } }] })}\n\n`);
      toCalls(r).forEach((tc, idx) =>
        frames.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: idx, id: tc.id, function: tc.function }] } }] })}\n\n`),
      );
      frames.push("data: [DONE]\n\n");
      return Promise.resolve(new ReadableStream<Uint8Array>({
        start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
      }));
    },
    complete() {
      const r = next();
      const calls = toCalls(r);
      return Promise.resolve({ content: r.content ?? null, tool_calls: calls.length ? calls : undefined });
    },
  };
}

const base = (): ChatMessage[] => [{ role: "user", content: "go" }];

describe("the turn loop", () => {
  it("streams a plain answer through untouched", async () => {
    const chunks: string[] = [];
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([{ content: "Nothing on today after 3." }]),
      execute: () => { throw new Error("should not run a tool"); },
      onText: (c) => { chunks.push(c); },
    });
    expect(turn.content).toBe("Nothing on today after 3.");
    expect(chunks.join("")).toBe("Nothing on today after 3.");
    expect(turn.calls).toEqual([]);
  });

  it("feeds a tool's result back and lets the model answer from it", async () => {
    const messages = base();
    const turn = await runAgentTurn({
      messages,
      tools: [],
      llm: scripted([
        { calls: [{ name: "create_task", args: { title: "Call Ann" } }] },
        { content: "Added **Call Ann** to your inbox." },
      ]),
      execute: (name, args) =>
        Promise.resolve({
          result: JSON.stringify({ id: "t1", ...args }),
          action: { tool: name, summary: "Created \"Call Ann\"" },
        }),
    });
    expect(turn.calls.map((c) => c.name)).toEqual(["create_task"]);
    expect(turn.actions).toHaveLength(1);
    expect(turn.content).toContain("Call Ann");
    expect(messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("hands a failing tool back to the model instead of killing the reply", async () => {
    // The alternative — throwing — leaves the user with a dead stream and no
    // idea whether anything was written.
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([
        { calls: [{ name: "schedule_task", args: { task_title: "nope" } }] },
        { content: "I couldn't find a task called that — want me to create it?" },
      ]),
      execute: () => Promise.reject(new Error('No task matching "nope"')),
    });
    expect(turn.calls[0].error).toContain("No task matching");
    expect(turn.content).toContain("couldn't find");
  });

  it("still says what it did when the model acts and then goes quiet", async () => {
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([
        { calls: [{ name: "trash_task", args: { task_id: "t1" } }] },
        { content: "" },
      ]),
      execute: (tool) => Promise.resolve({ result: "{}", action: { tool, summary: "Trashed \"Review the deck\"" } }),
    });
    expect(turn.content).toBe('Trashed "Review the deck"');
  });

  it("captions a point_at-only turn so the highlight isn't silent", async () => {
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([{ calls: [{ name: "point_at", args: { target: "schedule" } }] }, { content: "" }]),
      execute: () => Promise.resolve({ result: "{}", ui: { spotlight: [{ target: "schedule" }] } }),
    });
    expect(turn.content).toBe("Here it is — up on your screen.");
    expect(turn.ui).toBeDefined();
  });

  it("stops at the round limit instead of looping forever, and says so", async () => {
    const looping = Array.from({ length: 12 }, () => ({ calls: [{ name: "list_tasks", args: {} }] }));
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted(looping),
      execute: () => Promise.resolve({ result: "[]" }),
      maxRounds: 3,
    });
    expect(turn.rounds).toBe(3);
    expect(turn.exhausted).toBe(true);
    expect(turn.calls.length).toBe(3);
  });

  it("survives tool arguments that aren't valid JSON", async () => {
    const llm: ChatClient = {
      stream() {
        const enc = new TextEncoder();
        return Promise.resolve(new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "x", function: { name: "create_task", arguments: "{oh no" } }] } }] })}\n\n`));
            c.enqueue(enc.encode("data: [DONE]\n\n"));
            c.close();
          },
        }));
      },
      complete: () => Promise.resolve({ content: "Sorry — say that again?" }),
    };
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm,
      execute: (_n, args) => Promise.resolve({ result: JSON.stringify({ got: args }) }),
    });
    expect(turn.calls[0].args).toEqual({});
    expect(turn.content).toContain("say that again");
  });

  it("strips the suggestions block and scrubs ids before the user sees the reply", async () => {
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([{
        content:
          'Filed it under Dayspring (project_id: 33333333-3333-4333-8333-333333333332).' +
          '<suggestions>[{"label":"Plan it","message":"plan it for tomorrow"},{"label":"Leave it","message":"leave it in the backlog"}]</suggestions>',
      }]),
      execute: () => Promise.reject(new Error("no tools")),
    });
    expect(turn.content).not.toContain("33333333");
    expect(turn.content).not.toContain("project_id");
    expect(turn.content).not.toContain("<suggestions>");
    expect(turn.suggestions.map((s) => s.label)).toEqual(["Plan it", "Leave it"]);
  });
});

// ── the battery's own hygiene ────────────────────────────────────────────────

describe("the battery", () => {
  it("has unique scenario ids", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("only asserts on tools that exist", () => {
    const known = new Set([...toolNames, "point_at"]);
    const bad: string[] = [];
    const src = read("tests/agent/scenarios.ts");
    for (const m of src.matchAll(/(?:called|notCalled|calledTimes)\(\s*"([a-z_]+)"/g)) {
      if (!known.has(m[1])) bad.push(m[1]);
    }
    expect(bad, "scenarios reference tools the agent doesn't have").toEqual([]);
  });

  it("covers every capability group the conformance map claims", () => {
    const doc = read("docs/agent-conformance.md");
    const documented = [...doc.matchAll(/^###\s+[A-H]\s+·\s+.*`([a-z]+)`/gm)].map((m) => m[1]);
    expect(documented.length, "the map lists no groups").toBeGreaterThan(0);
    const uncovered = documented.filter((g) => !GROUPS.includes(g));
    expect(uncovered, "documented as covered, but no scenario exists").toEqual([]);
    const undocumented = GROUPS.filter((g) => !documented.includes(g));
    expect(undocumented, "scenarios exist for a group the map doesn't name").toEqual([]);
  });

  it("keeps every must-scenario asserting something a model could get wrong", () => {
    const weak = SCENARIOS.filter((s) => s.weight === "must" && s.expect.length === 0);
    expect(weak.map((s) => s.id)).toEqual([]);
  });
});
