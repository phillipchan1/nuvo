// The prompt-level eval: does the model, given the REAL system prompt and the
// REAL tool definitions, reach for the right tool with the right arguments?
//
// This is the half of the harness that needs a live model, so it does not run in
// CI. `npm run eval` (needs OPENROUTER_API_KEY or OPENAI_API_KEY).
//
// It exists to make the prompt editable. The tool tests in agent-calendar.test.ts
// prove the code does what it's told; this proves the model is told the right
// thing — which is what you need before you can safely DELETE a rule. Workflow
// for shrinking the prompt: run at EVAL_RUNS=5 to get a baseline pass rate, cut
// the rule, run again. A rule whose removal doesn't move the numbers was
// costing tokens and attention for nothing.
//
// Flakiness is data, not noise. A case that passes 3/5 is a genuinely ambiguous
// instruction; go fix the prompt rather than re-running until it's green.
import { describe, expect, it } from "vitest";

import { TOOL_DEFINITIONS } from "../supabase/functions/agent/tools.ts";
import { dynamicContextPrompt, STATIC_SYSTEM_PROMPT } from "../supabase/functions/agent/systemPrompt.ts";
import { fixtureContext, TODAY } from "./agent/promptFixture.ts";

const KEY = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
const BASE = process.env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1";
const MODEL = process.env.AGENT_MODEL ?? (process.env.OPENROUTER_API_KEY ? "qwen/qwen3.6-flash" : "gpt-5.4-mini");
const RUNS = Number(process.env.EVAL_RUNS ?? 1);

interface Turn {
  role: "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** One turn through the real prompt. Returns the tool calls the model chose. */
async function ask(turns: Turn[], tz = "America/Los_Angeles"): Promise<{ calls: ToolCall[]; text: string }> {
  const ctx = fixtureContext();
  const messages = [
    { role: "system", content: STATIC_SYSTEM_PROMPT },
    {
      role: "system",
      content: dynamicContextPrompt(JSON.stringify(ctx, null, 2), ctx.today, ctx.nowLabel, ctx.nowISO, "", tz),
    },
    ...turns,
  ];

  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, tools: TOOL_DEFINITIONS, tool_choice: "auto" }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const msg = json.choices?.[0]?.message ?? {};
  const calls: ToolCall[] = (msg.tool_calls ?? []).map((t: { function: { name: string; arguments: string } }) => ({
    name: t.function.name,
    args: JSON.parse(t.function.arguments || "{}"),
  }));
  return { calls, text: msg.content ?? "" };
}

/** The assistant turn that says "you already created this event", so a case can
 *  start from the state a correction actually arrives in. */
function priorCreate(args: Record<string, unknown>, result: Record<string, unknown>): Turn[] {
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "create_calendar_event", arguments: JSON.stringify(args) } }],
    },
    { role: "tool", tool_call_id: "call_1", content: JSON.stringify(result) },
    { role: "assistant", content: `Added **${args.title}** to **${result.calendar}** on **${result.when}**.` },
  ];
}

/** Run a case RUNS times; report the pass rate rather than the first outcome. */
function evalCase(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const failures: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        await run();
      } catch (e) {
        failures.push(e instanceof Error ? e.message.split("\n")[0] : String(e));
      }
    }
    if (failures.length) {
      throw new Error(`${RUNS - failures.length}/${RUNS} passed — ${failures[0]}`);
    }
  }, 120_000);
}

const only = (calls: ToolCall[], expected: string): Record<string, unknown> => {
  expect(calls.map((c) => c.name), `expected ${expected}`).toContain(expected);
  return calls.find((c) => c.name === expected)!.args;
};

describe.skipIf(!KEY)(`prompt eval (${MODEL}, ${RUNS} run${RUNS > 1 ? "s" : ""} per case)`, () => {
  // ── the transcript, turn by turn ──────────────────────────────────────────

  evalCase("'next Wednesday' books the following week, not tomorrow", async () => {
    const { calls } = await ask([
      { role: "user", content: "Next Wednesday Kim's coming for dinner family calendar" },
    ]);
    const args = only(calls, "create_calendar_event");
    expect(String(args.start_local)).toMatch(/^2026-08-05T/);
    expect(String(args.calendar_name)).toMatch(/family/i);
  });

  evalCase("a corrected day moves the event instead of adding a second", async () => {
    const { calls } = await ask([
      { role: "user", content: "Next Wednesday Kim's coming for dinner family calendar" },
      ...priorCreate(
        { title: "Kim's coming for dinner", start_local: `${TODAY}T18:30`, end_local: `${TODAY}T20:00`, calendar_name: "Family" },
        { created: true, title: "Kim's coming for dinner", when: "Tue, Jul 28, 6:30–8:00 PM", calendar: "Family", id: "evt-1" },
      ),
      { role: "user", content: "Next Wednesday not tomorrow" },
    ]);
    expect(calls.map((c) => c.name)).not.toContain("create_calendar_event");
    const args = only(calls, "reschedule_event");
    expect(String(args.start_local)).toMatch(/^2026-08-05T/);
  });

  evalCase("a corrected calendar moves the event instead of adding a second", async () => {
    const { calls } = await ask([
      { role: "user", content: "Dinner with Kim next Wednesday at 6:30" },
      ...priorCreate(
        { title: "Dinner with Kim", start_local: "2026-08-05T18:30", end_local: "2026-08-05T20:00" },
        { created: true, title: "Dinner with Kim", when: "Wed, Aug 5, 6:30–8:00 PM", calendar: "phillipchan1@gmail.com", isDefault: true, id: "evt-1" },
      ),
      { role: "user", content: "that should be on the family calendar" },
    ]);
    expect(calls.map((c) => c.name)).not.toContain("create_calendar_event");
    only(calls, "move_event");
  });

  evalCase("a confirmed removal cancels rather than explaining it can't", async () => {
    const { calls } = await ask([
      { role: "user", content: "I put that dinner on the wrong day — can you take the old one off?" },
      { role: "assistant", content: "I can remove **Kim's coming for dinner** on Wed Jul 29 from **Family**. Want me to?" },
      { role: "user", content: "yes please" },
    ]);
    only(calls, "cancel_event");
  });

  // ── the guards that keep costing us ───────────────────────────────────────

  evalCase("a topical calendar is never inferred from who the event is with", async () => {
    const { calls } = await ask([
      { role: "user", content: "add a call with Tiffany Souers tomorrow at 2pm" },
    ]);
    const args = only(calls, "create_calendar_event");
    expect(args.calendar_name ?? "").not.toMatch(/women/i);
  });

  evalCase("a stated time is never shifted between zones", async () => {
    const { calls } = await ask(
      [{ role: "user", content: "lunch with Cory Thursday at noon" }],
      "America/New_York",
    );
    const args = only(calls, "create_calendar_event");
    expect(args.start_local).toBe("2026-07-30T12:00");
  });

  evalCase("'need to work on X' is not a date", async () => {
    const { calls } = await ask([
      { role: "user", content: "I need to work on the Meridian deck" },
    ]);
    const args = only(calls, "create_task");
    expect(args.do_date, "context describing work is not a plan for today").toBeFalsy();
  });

  evalCase("an appointment with no time still goes on the calendar", async () => {
    // Placement rule 0 vs. "named event, no time → plan_task" used to disagree
    // here, and the model resolved it by inventing a time silently.
    const { calls, text } = await ask([
      { role: "user", content: "the Hendersons are coming over for dinner on Thursday" },
    ]);
    only(calls, "create_calendar_event");
    void text;
  });
});
