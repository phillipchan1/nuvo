// The battery's engine: run one real agent turn against a fixture world.
//
// What makes this evidence rather than theatre — everything under test is the
// DEPLOYED code path:
//   · the real system prompt (prompt.ts)
//   · the real message assembly (turn.ts)
//   · the real tool definitions (toolDefs.ts), point_at included
//   · the real turn loop (loop.ts) — rounds, tool errors, the empty-reply rules
// Only two things are swapped: the database (worlds are fixtures) and, in
// replay mode, the model (recorded responses). Nothing about the chat's
// behavior is re-implemented here.
//
// Tool calls are RECORDED, not executed. A scenario asserts on what the agent
// decided to do, which is where chat bugs actually live. What a handler then
// does with those arguments is NOT covered here — it needs a database, and
// that gap is named in docs/agent-conformance.md §5 rather than papered over.
//
// Run: npm run eval           (live model — needs OPENAI_API_KEY / OPENROUTER_API_KEY)
//      npm run eval:replay    (recorded — deterministic, free, runs in CI)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createChatClient,
  runAgentTurn,
  type AttemptedCall,
  type ChatClient,
  type ChatMessage,
  type TurnResult,
} from "../../supabase/functions/agent/loop.ts";
import { buildPointAtTool, TOOL_DEFINITIONS } from "../../supabase/functions/agent/toolDefs.ts";
import { buildTurnMessages } from "../../supabase/functions/agent/turn.ts";
import { describeModelChoice, resolveAgentModel } from "../../supabase/functions/agent/modelChoice.ts";
import { readPromptVariant } from "../../supabase/functions/agent/prompt.ts";
import { MARQUEE_TARGETS, tzFor, world, type WorldName } from "./world.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASSETTE_DIR = join(HERE, "cassettes");

// ── what a tool call did, without doing it ───────────────────────────────────

/** What the model reads back after a tool call. A scenario can override this
 *  (see `respond`) to steer a multi-round conversation — "that task doesn't
 *  exist", "here are two matching projects" — which is how the error paths get
 *  exercised without a database. */
export type ToolResponder = (call: { name: string; args: Record<string, unknown> }) => unknown;

/** The default: every write "succeeds" with a plausible echo. Deliberately
 *  thin — the handlers' real return shapes are pinned separately; here it only
 *  has to be enough for the model to write its confirmation. */
function defaultResponse(call: { name: string; args: Record<string, unknown> }): unknown {
  const { name, args } = call;
  const id = `res-${createHash("sha1").update(name + JSON.stringify(args)).digest("hex").slice(0, 8)}`;
  if (name === "create_slot") {
    return {
      id,
      title: args.title,
      startTime: args.start_local,
      durationMinutes: args.duration_minutes ?? 60,
      tasks: (Array.isArray(args.tasks) ? args.tasks : []).map((t: unknown, i: number) => ({
        id: `${id}-t${i}`,
        title: typeof t === "string" ? t : (t as { title?: string })?.title,
      })),
    };
  }
  if (name === "point_at") return { ok: true, pointed: args.target };
  if (name === "list_tasks") return [];
  if (name === "list_vertical") return [];
  return { id, ok: true, ...args };
}

// ── the model ────────────────────────────────────────────────────────────────

interface Recorded {
  /** One entry per LLM round, in order. */
  rounds: { content: string | null; tool_calls?: unknown[] }[];
}

function cassettePath(id: string): string {
  return join(CASSETTE_DIR, `${id}.json`);
}

/** Replay a recorded run. Deterministic and free, so CI can catch the whole
 *  class of "the plumbing broke" regressions — a renamed tool, a context field
 *  that stopped being serialized, a loop that stopped feeding results back —
 *  without spending a token or waiting on a model's mood. It cannot catch a
 *  judgment regression; only a live run can, which is why `npm run eval` is
 *  the one that gates a prompt change. */
function replayClient(id: string): ChatClient {
  const path = cassettePath(id);
  if (!existsSync(path)) throw new Error(`No cassette for "${id}" — run: npm run eval -- --only ${id}`);
  const tape = JSON.parse(readFileSync(path, "utf8")) as Recorded;
  let i = 0;
  const next = () => {
    const round = tape.rounds[i++];
    if (!round) throw new Error(`Cassette "${id}" ran out of rounds (asked for ${i})`);
    return round;
  };
  return {
    stream() {
      const round = next();
      const chunks: string[] = [];
      if (round.content) chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { content: round.content } }] })}\n\n`);
      if (round.tool_calls?.length) {
        // deno-lint-ignore no-explicit-any
        (round.tool_calls as any[]).forEach((tc, idx) => {
          chunks.push(
            `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: idx, id: tc.id, function: tc.function }] } }] })}\n\n`,
          );
        });
      }
      chunks.push("data: [DONE]\n\n");
      const enc = new TextEncoder();
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const c of chunks) controller.enqueue(enc.encode(c));
            controller.close();
          },
        }),
      );
    },
    complete() {
      const round = next();
      // deno-lint-ignore no-explicit-any
      return Promise.resolve({ content: round.content, tool_calls: round.tool_calls as any });
    },
  };
}

/** Wrap a client so every round it produces is written to a cassette. */
function recording(inner: ChatClient, tape: Recorded): ChatClient {
  return {
    async stream(messages, tools) {
      const body = await inner.stream(messages, tools);
      // Tee the stream: the loop reads it as normal, we accumulate a copy.
      const [a, b] = body.tee();
      void (async () => {
        const { text, toolCalls } = await import("../../supabase/functions/agent/loop.ts").then((m) =>
          m.readStream(b, async () => {}),
        );
        tape.rounds.push({
          content: text || null,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        });
      })();
      return a;
    },
    async complete(messages, tools) {
      const res = await inner.complete(messages, tools);
      tape.rounds.push({ content: res.content, tool_calls: res.tool_calls });
      return res;
    },
  };
}

export function liveModel(): { model: string; client: ChatClient } {
  const orKey = process.env.OPENROUTER_API_KEY;
  const key = orKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Set OPENROUTER_API_KEY or OPENAI_API_KEY to run the battery live");
  // The battery must exercise the model the chat actually ships with, so the
  // resolution is IMPORTED from the edge function rather than mirrored here.
  // The old copy of these defaults could drift from index.ts without any test
  // noticing — and then the battery certifies a model nobody runs.
  const choice = resolveAgentModel({
    AGENT_MODEL: process.env.AGENT_MODEL,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    AGENT_REASONING: process.env.AGENT_REASONING,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  const model = choice.model;
  // An unpinned run is not comparable across keys — say so once, loudly, rather
  // than letting a green matrix hide the fact that two cells ran two families.
  if (!choice.pinned) console.warn(`  ! ${describeModelChoice(choice)}`);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (orKey) {
    headers["HTTP-Referer"] = "https://nuvo.app";
    headers["X-Title"] = "Nuvo eval";
  }
  return {
    model,
    client: createChatClient({
      baseUrl: choice.baseUrl,
      model,
      headers,
      // Pinned low so a scenario's pass rate measures the prompt, not sampling
      // noise. The shipped chat runs at the provider default — a scenario that
      // only passes at temperature 0 is a scenario that will fail in the app,
      // so this is a floor for judging, never a claim about production.
      //
      // NOTE: a reasoning request drops the temperature floor (createChatClient
      // sends one or the other), so on a 5.6 model with AGENT_REASONING set,
      // --repeat matters MORE, not less — there is no sampling floor left.
      temperature: 0,
      reasoningEffort: choice.reasoningEffort,
    }),
  };
}

// ── running a scenario ───────────────────────────────────────────────────────

export interface RunOptions {
  id: string;
  worldName: WorldName;
  /** The conversation. Strings are user turns; `{assistant}` seeds a prior reply. */
  turns: (string | { assistant: string })[];
  /** Override what a tool call hands back to the model. */
  respond?: ToolResponder;
  navFocus?: { rung: string; projectId?: string; domainId?: string; initiativeId?: string };
  mode: "live" | "replay";
  client?: ChatClient;
}

export interface RunOutcome {
  calls: AttemptedCall[];
  turn: TurnResult;
  /** The exact messages sent — lets a test assert on what the model was shown. */
  messages: ChatMessage[];
}

export async function runScenario(opts: RunOptions): Promise<RunOutcome> {
  const ctx = world(opts.worldName);
  const tz = tzFor(opts.worldName);

  const history = opts.turns.map((t) =>
    typeof t === "string"
      ? { role: "user" as const, content: t }
      : { role: "assistant" as const, content: t.assistant },
  );

  const messages = buildTurnMessages({
    ctx,
    tz,
    navFocus: opts.navFocus,
    messages: history,
    // The battery must send the prompt the app sends — same env var, same
    // resolution. This is what makes an AGENT_MODEL x AGENT_PROMPT matrix cell
    // mean something rather than describing a prompt nobody runs.
    promptVariant: readPromptVariant(process.env.AGENT_PROMPT),
  });
  const tools = [...TOOL_DEFINITIONS, buildPointAtTool(MARQUEE_TARGETS)];

  const tape: Recorded = { rounds: [] };
  // Only a real model's answers are worth recording. A scripted client (the
  // harness's own tests) must never leave a cassette behind — replaying one
  // would be the suite grading its own homework and always passing.
  const recordable = opts.mode === "live" && !opts.client;
  const client =
    opts.mode === "replay"
      ? replayClient(opts.id)
      : recordable
        ? recording(liveModel().client, tape)
        : (opts.client ?? recording(liveModel().client, tape));

  const respond = opts.respond ?? defaultResponse;
  const calls: AttemptedCall[] = [];

  const turn = await runAgentTurn({
    messages,
    tools,
    llm: client,
    execute: (name, args) => {
      calls.push({ name, args, round: 0 });
      return Promise.resolve({ result: JSON.stringify(respond({ name, args }) ?? { ok: true }) });
    },
  });

  if (recordable) {
    mkdirSync(CASSETTE_DIR, { recursive: true });
    // Give the teed stream a tick to finish accumulating before we write.
    await new Promise((r) => setTimeout(r, 0));
    writeFileSync(cassettePath(opts.id), JSON.stringify(tape, null, 2));
  }

  // runAgentTurn's own `calls` carries the round numbers; ours carries order.
  return { calls: turn.calls.length ? turn.calls : calls, turn, messages };
}
