// The guarantees that must hold whatever the model does.
//
// Everything here used to live in the system prompt as a request — "confirm
// before cancelling", "NEVER call create_calendar_event again for the same
// title/time", "one target per write". A rule stated in prose holds exactly as
// long as the model cooperates, and the chat's whole failure mode is that it
// stays fluent while it stops cooperating.
//
// So these test mechanisms, not phrasing. None of them needs a live model:
// the loop runs against a scripted client, and the guards are pure.
//
// Run: npm test

import { describe, expect, it } from "vitest";

import {
  createChatClient,
  runAgentTurn,
  stableArgs,
  MAX_ROUNDS,
  REPEATABLE_TOOLS,
  type ChatClient,
  type ChatMessage,
} from "../supabase/functions/agent/loop.ts";
import { TOOL_DEFINITIONS, buildPointAtTool } from "../supabase/functions/agent/toolDefs.ts";
import { REQUIRES_TARGET, targetError } from "../supabase/functions/agent/toolGuards.ts";
import {
  CONFIRMABLE_TOOLS,
  checkConfirmation,
  mintToken,
} from "../supabase/functions/agent/confirmDestructive.ts";
import { buildTurnTrace, traceIsNoteworthy } from "../supabase/functions/agent/trace.ts";
import {
  cellKey,
  diffRuns,
  isImprovement,
  lastRunForCell,
  parseHistory,
  serializeRecord,
  type RunRecord,
} from "./agent/history.ts";

// ── a scripted model, one entry per round ────────────────────────────────────

interface Round {
  content?: string;
  calls?: { name: string; args: Record<string, unknown> }[];
}

function scripted(rounds: Round[]): ChatClient {
  let i = 0;
  const next = () => rounds[Math.min(i++, rounds.length - 1)];
  const toCalls = (r: Round) =>
    (r.calls ?? []).map((c, n) => ({
      id: `call-${n}`,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.args) },
    }));
  return {
    stream(_m, _t) {
      const r = next();
      const calls = toCalls(r);
      const enc = new TextEncoder();
      const chunks: string[] = [];
      if (r.content) chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { content: r.content } }] })}\n\n`);
      calls.forEach((c, idx) =>
        chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: idx, id: c.id, function: c.function }] } }] })}\n\n`),
      );
      chunks.push("data: [DONE]\n\n");
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(ctrl) {
            for (const c of chunks) ctrl.enqueue(enc.encode(c));
            ctrl.close();
          },
        }),
      );
    },
    complete() {
      const r = next();
      const calls = toCalls(r);
      return Promise.resolve({ content: r.content ?? null, tool_calls: calls.length ? calls : undefined });
    },
  };
}

const base = (): ChatMessage[] => [{ role: "user", content: "go" }];

// ── 1. an unfinished turn says so ────────────────────────────────────────────

describe("a truncated turn cannot look like a finished one", () => {
  it("marks the turn exhausted when the model never stops calling tools", async () => {
    let executed = 0;
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      // Never answers in words — always another tool call.
      llm: scripted([{ calls: [{ name: "create_task", args: { title: "one" } }] }]),
      execute: (_n, a) => {
        executed += 1;
        return Promise.resolve({ result: "ok", action: { summary: `Created ${a.title}` } as never });
      },
      onText: () => {},
    });
    expect(turn.exhausted).toBe(true);
    expect(turn.rounds).toBe(MAX_ROUNDS);
    expect(executed).toBeGreaterThan(0);
  });

  it("says it ran out of steps instead of reading as a confirmation", async () => {
    // The regression this exists for: the loop synthesized "Created X" from
    // whatever landed, so a half-done turn was indistinguishable from success
    // and the dropped remainder was never mentioned.
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([{ calls: [{ name: "create_task", args: { title: "one" } }] }]),
      execute: () => Promise.resolve({ result: "ok", action: { summary: "Created one" } as never }),
      onText: () => {},
    });
    expect(turn.exhausted).toBe(true);
    expect(turn.content).toMatch(/step limit|as far as I got/i);
  });

  it("says nothing landed when it ran out before any write", async () => {
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([{ calls: [{ name: "list_tasks", args: {} }] }]),
      execute: () => Promise.resolve({ result: "[]" }),
      onText: () => {},
    });
    expect(turn.exhausted).toBe(true);
    expect(turn.content).toMatch(/nothing was changed/i);
  });

  it("leaves a turn that answers in words unexhausted", async () => {
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([
        { calls: [{ name: "create_task", args: { title: "one" } }] },
        { content: "Added it." },
      ]),
      execute: () => Promise.resolve({ result: "ok" }),
      onText: () => {},
    });
    expect(turn.exhausted).toBe(false);
    expect(turn.content).toBe("Added it.");
  });
});

// ── 2. the schemas refuse what they should ───────────────────────────────────

describe("tool schemas", () => {
  it("rejects invented arguments on every tool", () => {
    const all = [...TOOL_DEFINITIONS, buildPointAtTool([{ key: "priorities", describe: "x" }])];
    for (const t of all) {
      const p = t.function.parameters as { additionalProperties?: boolean } | undefined;
      expect(p?.additionalProperties, `${t.function.name} accepts unknown properties`).toBe(false);
    }
  });

  it("declares confirm_token wherever confirmation is enforced", () => {
    // additionalProperties:false means an undeclared confirm_token would be
    // rejected before the guard ever saw it — the two changes have to agree.
    for (const name of CONFIRMABLE_TOOLS) {
      const def = TOOL_DEFINITIONS.find((t) => t.function.name === name);
      const props = def?.function.parameters?.properties as Record<string, unknown> | undefined;
      expect(props, `${name} missing`).toBeDefined();
      expect(Object.keys(props!), `${name} cannot receive confirm_token`).toContain("confirm_token");
    }
  });

  it("names a real tool for every targeting rule", () => {
    const names = new Set(TOOL_DEFINITIONS.map((t) => t.function.name));
    for (const tool of Object.keys(REQUIRES_TARGET)) {
      expect(names, `REQUIRES_TARGET names ${tool}, which no longer exists`).toContain(tool);
    }
  });

  // A read-only tool CAN be legitimately argument-free — "show me my most-met
  // contacts" is a real request. Declaring those explicitly keeps the rule below
  // strict without forcing a read tool into REQUIRES_TARGET, where a target
  // error would be nonsense. Anything that writes belongs in REQUIRES_TARGET,
  // never here.
  const ARGUMENTLESS_BY_DESIGN = new Set<string>([
    // An empty query returns the people they meet most — "who do I meet with?"
    // is a real request, and a target error on it would be nonsense.
    "find_contact",
  ]);

  it("guards every tool whose schema would otherwise accept an empty call", () => {
    // 22 of 38 tools had no `required` at all — "complete_task" with no task,
    // "cancel_event" with no event. Anything still in that state must be
    // covered by REQUIRES_TARGET or declared argument-free on purpose.
    const unguarded = TOOL_DEFINITIONS.filter((t) => {
      const p = t.function.parameters as { required?: string[] } | undefined;
      return !(p?.required?.length) &&
        !REQUIRES_TARGET[t.function.name] &&
        !ARGUMENTLESS_BY_DESIGN.has(t.function.name);
    }).map((t) => t.function.name);
    expect(
      unguarded,
      "these accept a call with no arguments at all — add a target rule, or declare them argument-free on purpose",
    ).toEqual([]);
  });

  it("never lets a write be declared argument-free", () => {
    const writeish = [...ARGUMENTLESS_BY_DESIGN].filter((n) =>
      /^(create|update|delete|move|schedule|plan|cancel|decline|complete|trash|add|reschedule|unschedule|propose)_/.test(n),
    );
    expect(writeish, "a tool that writes must name what it acts on").toEqual([]);
  });
});

// ── 3. a write with no target never reaches the database ─────────────────────

describe("no write without a target", () => {
  it("rejects an empty call for every targeted tool", () => {
    for (const [tool, keys] of Object.entries(REQUIRES_TARGET)) {
      const err = targetError(tool, {});
      expect(err, `${tool} accepted a call with no target`).toBeTruthy();
      expect(err, `${tool}'s error should name the arguments it wants`).toContain(keys[0]);
      expect(err, `${tool}'s error must say nothing happened`).toMatch(/nothing was changed/i);
    }
  });

  it("accepts a call that names any one of its targets", () => {
    for (const [tool, keys] of Object.entries(REQUIRES_TARGET)) {
      for (const key of keys) {
        const value = key === "delete_all_matching" ? true : key.endsWith("_ids") ? ["x"] : "x";
        expect(targetError(tool, { [key]: value }), `${tool} rejected a valid ${key}`).toBeNull();
      }
    }
  });

  it("treats blank and empty values as absent", () => {
    // "" and [] are what a model produces when it knows it should pass
    // something and doesn't have it — the worst case to let through.
    expect(targetError("complete_task", { task_id: "   " })).toBeTruthy();
    expect(targetError("delete_project", { project_ids: [] })).toBeTruthy();
    expect(targetError("delete_project", { delete_all_matching: false })).toBeTruthy();
  });

  it("leaves untargeted tools alone", () => {
    expect(targetError("list_tasks", {})).toBeNull();
    expect(targetError("point_at", { target: "priorities" })).toBeNull();
    expect(targetError("create_slot", { title: "x", start_local: "2026-08-01T09:00" })).toBeNull();
  });
});

// ── 4. cancelling needs the user, not the model's word for it ────────────────

describe("cancel and decline are confirmed, not promised", () => {
  const turnA = "turn-a";
  const turnB = "turn-b";
  const args = { event_id: "evt-1" };

  it("changes nothing on the first call and asks for a real yes", () => {
    for (const tool of CONFIRMABLE_TOOLS) {
      const check = checkConfirmation(tool, args, turnA);
      expect(check.ok, `${tool} executed without confirmation`).toBe(false);
      expect(check.error).toMatch(/nothing was/i);
      expect(check.error, "must hand the model a usable token").toContain(mintToken(turnA, tool, "evt-1"));
    }
  });

  it("refuses a token minted in the same turn — the user hasn't answered yet", () => {
    // The whole mechanism. Without this the model can propose and confirm in
    // one breath, and "confirmation" means nothing.
    for (const tool of CONFIRMABLE_TOOLS) {
      const token = mintToken(turnA, tool, "evt-1");
      const check = checkConfirmation(tool, { ...args, confirm_token: token }, turnA);
      expect(check.ok, `${tool} self-confirmed inside one turn`).toBe(false);
      expect(check.error).toMatch(/hasn't answered/i);
    }
  });

  it("executes when the token comes back on a later turn", () => {
    for (const tool of CONFIRMABLE_TOOLS) {
      const token = mintToken(turnA, tool, "evt-1");
      expect(checkConfirmation(tool, { ...args, confirm_token: token }, turnB).ok).toBe(true);
    }
  });

  it("refuses a token issued for a different event or a different action", () => {
    const forOther = mintToken(turnA, "cancel_event", "evt-2");
    expect(checkConfirmation("cancel_event", { event_id: "evt-1", confirm_token: forOther }, turnB).ok).toBe(false);

    const forDecline = mintToken(turnA, "decline_event", "evt-1");
    expect(checkConfirmation("cancel_event", { event_id: "evt-1", confirm_token: forDecline }, turnB).ok).toBe(false);
  });

  it("refuses an invented token", () => {
    const check = checkConfirmation("cancel_event", { event_id: "evt-1", confirm_token: "yes" }, turnB);
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/isn't one I issued/i);
  });

  it("matches on title when that's how the event was named", () => {
    const token = mintToken(turnA, "cancel_event", "standup");
    expect(checkConfirmation("cancel_event", { event_title: "Standup", confirm_token: token }, turnB).ok).toBe(true);
  });

  it("leaves every other tool untouched", () => {
    expect(checkConfirmation("create_task", {}, turnA).ok).toBe(true);
    expect(checkConfirmation("delete_project", { project_id: "p" }, turnA).ok).toBe(true);
  });
});

// ── 5. the same write twice in one turn happens once ─────────────────────────

describe("duplicate writes are absorbed by the loop", () => {
  it("executes an identical repeated write only once", async () => {
    const seen: string[] = [];
    const turn = await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([
        {
          calls: [
            { name: "create_calendar_event", args: { title: "Lunch", start_local: "2026-08-01T12:00" } },
            { name: "create_calendar_event", args: { start_local: "2026-08-01T12:00", title: "Lunch" } },
          ],
        },
        { content: "Added Lunch." },
      ]),
      execute: (name) => {
        seen.push(name);
        return Promise.resolve({ result: JSON.stringify({ id: "evt-1", calendar: "Family" }) });
      },
      onText: () => {},
    });
    expect(seen).toEqual(["create_calendar_event"]);
    expect(turn.calls).toHaveLength(2);
    expect(turn.calls[1].deduped).toBe(true);
  });

  it("hands the model the first result, so it can still confirm accurately", async () => {
    let n = 0;
    await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([
        { calls: [{ name: "create_task", args: { title: "A" } }, { name: "create_task", args: { title: "A" } }] },
        { content: "done" },
      ]),
      execute: () => {
        n += 1;
        return Promise.resolve({ result: JSON.stringify({ id: "task-1" }) });
      },
      onText: () => {},
    });
    expect(n).toBe(1);
  });

  it("does not confuse two genuinely different writes", async () => {
    const seen: Record<string, unknown>[] = [];
    await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([
        { calls: [{ name: "create_task", args: { title: "A" } }, { name: "create_task", args: { title: "B" } }] },
        { content: "done" },
      ]),
      execute: (_n, a) => {
        seen.push(a);
        return Promise.resolve({ result: "ok" });
      },
      onText: () => {},
    });
    expect(seen).toHaveLength(2);
  });

  it("lets reads repeat, so a list after a write sees the write", async () => {
    let reads = 0;
    await runAgentTurn({
      messages: base(),
      tools: [],
      llm: scripted([
        { calls: [{ name: "list_tasks", args: {} }] },
        { calls: [{ name: "create_task", args: { title: "A" } }] },
        { calls: [{ name: "list_tasks", args: {} }] },
        { content: "done" },
      ]),
      execute: (name) => {
        if (name === "list_tasks") reads += 1;
        return Promise.resolve({ result: "[]" });
      },
      onText: () => {},
    });
    expect(reads).toBe(2);
    expect(REPEATABLE_TOOLS.has("list_tasks")).toBe(true);
  });

  it("fingerprints arguments independent of key order", () => {
    expect(stableArgs({ a: 1, b: 2 })).toBe(stableArgs({ b: 2, a: 1 }));
    expect(stableArgs({ a: 1 })).not.toBe(stableArgs({ a: 2 }));
  });
});

// ── 6. the turn leaves a trace ───────────────────────────────────────────────

describe("the per-turn trace", () => {
  const input = {
    model: "gpt-5.6-terra",
    promptVariant: "full",
    rounds: 2,
    exhausted: false,
    calls: [{ name: "create_task" }, { name: "create_task", deduped: true }, { name: "update_task", error: "no match" }],
    actionCount: 1,
    ms: 1234.6,
    historyLength: 8,
  };

  it("records what a regression would show up in", () => {
    const t = buildTurnTrace(input);
    expect(t).toMatchObject({
      evt: "agent.turn",
      model: "gpt-5.6-terra",
      rounds: 2,
      toolCount: 3,
      errorCount: 1,
      dedupedCount: 1,
      ms: 1235,
    });
  });

  it("carries no message content or arguments", () => {
    // This runs over a real person's planner. A debugging aid must not quietly
    // become a transcript of their life.
    const serialized = JSON.stringify(buildTurnTrace(input));
    expect(serialized).not.toMatch(/content|args|title|notes/i);
  });

  it("flags the turns worth being woken up by", () => {
    expect(traceIsNoteworthy(buildTurnTrace({ ...input, calls: [{ name: "create_task" }] }))).toBe(false);
    expect(traceIsNoteworthy(buildTurnTrace({ ...input, exhausted: true, calls: [] }))).toBe(true);
    expect(traceIsNoteworthy(buildTurnTrace(input))).toBe(true);
  });
});

// ── 7. the transport never sends a combination the provider rejects ──────────

describe("reasoning and tools cannot be sent together", () => {
  /** Capture the request body createChatClient actually builds. */
  async function bodyFor(opts: { reasoningEffort?: string; temperature?: number }, tools: unknown[]) {
    let sent: Record<string, unknown> = {};
    const client = createChatClient({
      baseUrl: "https://example.invalid/v1",
      model: "gpt-5.6-terra",
      headers: {},
      ...opts,
      fetchImpl: ((_u: string, init: { body: string }) => {
        sent = JSON.parse(init.body);
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
        );
      }) as unknown as typeof fetch,
    });
    await client.complete([{ role: "user", content: "hi" }], tools);
    return sent;
  }

  const someTools = [{ type: "function", function: { name: "create_task", parameters: {} } }];

  it("omits reasoning_effort whenever tools are present", async () => {
    // The live 400 this exists for:
    //   "Function tools with reasoning_effort are not supported for
    //    gpt-5.6-terra in /v1/chat/completions."
    // The agent turn always carries tools, so honouring the setting would fail
    // every message. A config mistake costs the setting, never the chat.
    const sent = await bodyFor({ reasoningEffort: "medium" }, someTools);
    expect(sent.reasoning_effort).toBeUndefined();
    expect(sent.tools).toBeDefined();
  });

  it("keeps the temperature floor when reasoning is dropped", async () => {
    // This is what the battery measures the prompt with, rather than sampling.
    const sent = await bodyFor({ reasoningEffort: "high", temperature: 0 }, someTools);
    expect(sent.reasoning_effort).toBeUndefined();
    expect(sent.temperature).toBe(0);
  });

  it("still sends reasoning when there are no tools at all", async () => {
    // Keeps the setting meaningful for a future /v1/responses transport, and
    // for any tool-less call.
    const sent = await bodyFor({ reasoningEffort: "medium" }, []);
    expect(sent.reasoning_effort).toBe("medium");
  });

  it("treats 'none' as no reasoning at all", async () => {
    const sent = await bodyFor({ reasoningEffort: "none", temperature: 0 }, []);
    expect(sent.reasoning_effort).toBeUndefined();
    expect(sent.temperature).toBe(0);
  });
});

// ── 8. the battery remembers ─────────────────────────────────────────────────

describe("battery history", () => {
  const scen = (id: string, verdict: "pass" | "flaky" | "fail") => ({ id, verdict, passes: verdict === "pass" ? 5 : 0, runs: 5 });
  const run = (at: string, scenarios: ReturnType<typeof scen>[], over: Partial<RunRecord> = {}): RunRecord => ({
    at, model: "gpt-5.6-terra", prompt: "full", reasoning: "default", mode: "live", repeat: 5,
    scenarios, passed: scenarios.filter((s) => s.verdict === "pass").length, total: scenarios.length,
    blocked: scenarios.filter((s) => s.verdict !== "pass").length, seconds: 10, ...over,
  });

  it("only compares runs from the same cell", () => {
    // Comparing a terra run to a sol run and calling the delta a prompt result
    // is the exact mistake the matrix exists to prevent.
    const history = [
      run("2026-08-01T10:00:00Z", [scen("a", "pass")], { model: "gpt-5.6-sol" }),
      run("2026-08-01T11:00:00Z", [scen("a", "fail")], { prompt: "thin" }),
      run("2026-08-01T12:00:00Z", [scen("a", "pass")]),
    ];
    const target = cellKey({ model: "gpt-5.6-terra", prompt: "full", reasoning: "default" });
    expect(lastRunForCell(history, target)?.at).toBe("2026-08-01T12:00:00Z");
    expect(lastRunForCell(history, "nope · full · default")).toBeNull();
  });

  it("surfaces a regression even when the score is unchanged", () => {
    // The reason a score is not enough: 1/2 both times, but one scenario broke
    // and another got fixed. Scores hide this; per-scenario verdicts don't.
    const before = run("2026-08-01T10:00:00Z", [scen("a", "pass"), scen("b", "fail")]);
    const after = run("2026-08-01T11:00:00Z", [scen("a", "fail"), scen("b", "pass")]);
    expect(after.passed).toBe(before.passed);
    const d = diffRuns(before, after);
    expect(d.regressed).toEqual(["a"]);
    expect(d.fixed).toEqual(["b"]);
    expect(isImprovement(d)).toBe(false);
  });

  it("calls it an improvement only when nothing went backwards", () => {
    const before = run("2026-08-01T10:00:00Z", [scen("a", "fail"), scen("b", "fail")]);
    expect(isImprovement(diffRuns(before, run("2026-08-01T11:00:00Z", [scen("a", "pass"), scen("b", "fail")])))).toBe(true);
    expect(isImprovement(diffRuns(before, run("2026-08-01T11:00:00Z", [scen("a", "fail"), scen("b", "fail")])))).toBe(false);
  });

  it("separates a fail↔flaky move from a fix", () => {
    const d = diffRuns(
      run("2026-08-01T10:00:00Z", [scen("a", "fail")]),
      run("2026-08-01T11:00:00Z", [scen("a", "flaky")]),
    );
    expect(d.fixed).toEqual([]);
    expect(d.shifted).toEqual([{ id: "a", from: "fail", to: "flaky" }]);
  });

  it("notices scenarios added to or dropped from the suite", () => {
    const d = diffRuns(
      run("2026-08-01T10:00:00Z", [scen("a", "pass"), scen("gone", "pass")]),
      run("2026-08-01T11:00:00Z", [scen("a", "pass"), scen("new", "pass")]),
    );
    expect(d.added).toEqual(["new"]);
    expect(d.removed).toEqual(["gone"]);
    expect(d.regressed).toEqual([]);
  });

  it("survives a corrupt line rather than losing the history", () => {
    const good = serializeRecord(run("2026-08-01T10:00:00Z", [scen("a", "pass")]));
    const parsed = parseHistory(`${good}\n{ not json\n\n${good}\n`);
    expect(parsed).toHaveLength(2);
  });

  it("round-trips a record", () => {
    const r = run("2026-08-01T10:00:00Z", [scen("a", "pass")], { git: "abc1234" });
    expect(parseHistory(serializeRecord(r))[0]).toEqual(r);
  });
});
