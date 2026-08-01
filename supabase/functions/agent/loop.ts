// The agent turn — one user message in, one reply (plus whatever it did) out.
//
// This is the part that used to live inline in the Deno handler, where nothing
// could reach it: stream the first round, run whatever tools the model asked
// for, feed the results back, repeat until it answers in words. Every rule the
// chat has about *sequencing* lives here — how many rounds it gets, what
// happens when a tool throws, what the bubble says when the model does
// something but says nothing.
//
// It's extracted for the same reason planningRules.ts is: the conformance
// battery (tests/agent/) drives THIS loop, with a scripted LLM and scripted
// tool results, so a passing battery is evidence about the deployed chat and
// not about a second implementation written to agree with it.
//
// Pure: no Deno globals, no service-role client, no env. The caller supplies a
// chat client and a tool executor. See docs/agent-conformance.md.

import { parseSuggestions, type AgentSuggestion } from "./suggestions.ts";
import { sanitizeUserFacingText } from "./sanitizeReply.ts";

/** How many times the model may call tools and look at the results before it
 *  has to answer in words. Five is enough for "clear my inbox" (a batch, then a
 *  summary) and short enough that a confused model can't spend a minute. */
export const MAX_ROUNDS = 5;

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** What the model asked for, already parsed — the battery asserts on these. */
export interface AttemptedCall {
  name: string;
  args: Record<string, unknown>;
  /** The round it was issued in (0 = the first, streaming round). */
  round: number;
  /** Set when the handler threw; the model saw this as the tool result. */
  error?: string;
}

/** The transport. Two shapes because the first round streams (text reaches the
 *  user as it's written) and later rounds don't (tool calls need whole JSON). */
export interface ChatClient {
  stream(messages: ChatMessage[], tools: unknown[]): Promise<ReadableStream<Uint8Array>>;
  complete(
    messages: ChatMessage[],
    tools: unknown[],
  ): Promise<{ content: string | null; tool_calls?: ToolCall[] }>;
}

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ result: string; action?: AgentAction; ui?: MarqueeDirectiveLike }>;

// Structural, not imported: tools.ts owns the real types, and importing them
// here would drag the service-role client back into a file that must stay pure.
export interface AgentAction {
  tool: string;
  summary: string;
  verb?: string;
  ref?: { kind: string; id: string };
  undo?: unknown;
}
export interface MarqueeDirectiveLike {
  spotlight?: { target: string; ref?: string; label?: string }[];
  caption?: string;
}

export interface TurnResult {
  /** The reply as the user sees it — suggestions stripped, ids scrubbed. */
  content: string;
  actions: AgentAction[];
  suggestions: AgentSuggestion[];
  ui?: MarqueeDirectiveLike;
  /** Every tool the model asked for this turn, in order. */
  calls: AttemptedCall[];
  /** How many LLM round-trips it took. */
  rounds: number;
  /** True when the model was still calling tools as MAX_ROUNDS ran out — it
   *  never got to answer, and the user got a synthesized line instead. */
  exhausted: boolean;
}

/**
 * Read a streaming chat-completion response. `onTextChunk` fires for each text
 * delta (never for a tool-call response — those carry null content). Returns
 * the accumulated text plus any tool calls reassembled from the deltas.
 */
export async function readStream(
  body: ReadableStream<Uint8Array>,
  onTextChunk: (chunk: string) => Promise<void>,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const acc = new Map<number, { id: string; name: string; arguments: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") break;
        // deno-lint-ignore no-explicit-any
        let data: any;
        try { data = JSON.parse(payload); } catch { continue; }
        const delta = data?.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === "string" && delta.content) {
          text += delta.content;
          await onTextChunk(delta.content);
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx: number = tc.index ?? 0;
            if (!acc.has(idx)) acc.set(idx, { id: "", name: "", arguments: "" });
            const entry = acc.get(idx)!;
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.arguments += tc.function.arguments;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const toolCalls: ToolCall[] = [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.arguments } }));

  return { text, toolCalls };
}

/** Tool arguments as the model sent them. Malformed JSON is an empty object,
 *  never a thrown turn — the handler's own validation gives a better error than
 *  a parse failure would, and the model can recover from a tool error. */
function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export interface RunTurnOptions {
  /** System messages + conversation, already assembled (see buildTurnMessages). */
  messages: ChatMessage[];
  tools: unknown[];
  llm: ChatClient;
  execute: ToolExecutor;
  /** Called with each streamed text delta, for SSE. */
  onText?: (chunk: string) => Promise<void> | void;
  maxRounds?: number;
}

/**
 * Run one turn to completion. `messages` is mutated as the turn progresses
 * (assistant tool calls + tool results are appended) so a caller can inspect
 * the full exchange afterwards.
 */
export async function runAgentTurn(opts: RunTurnOptions): Promise<TurnResult> {
  const { messages, tools, llm, execute } = opts;
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS;
  const onText = opts.onText ?? (() => {});

  const actions: AgentAction[] = [];
  const directives: MarqueeDirectiveLike[] = [];
  const calls: AttemptedCall[] = [];
  let fullText = "";
  let rounds = 1;
  let exhausted = false;

  /** Run the batch the model just asked for, appending each result as the tool
   *  message it will read next round. A handler that throws returns its error
   *  AS the tool result rather than killing the turn: "no task matching X" is
   *  something the model can apologize for or route around, and a dead stream
   *  is not. */
  const runCalls = async (toolCalls: ToolCall[], round: number) => {
    for (const tc of toolCalls) {
      const args = parseArgs(tc.function.arguments);
      const attempt: AttemptedCall = { name: tc.function.name, args, round };
      let toolResult: string;
      try {
        const { result, action, ui } = await execute(tc.function.name, args);
        toolResult = result;
        if (action) actions.push(action);
        if (ui) directives.push(ui);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        attempt.error = msg;
        toolResult = JSON.stringify({ error: msg });
      }
      calls.push(attempt);
      messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
    }
  };

  // Round 0 streams, so words reach the user while the model is still writing.
  const streamBody = await llm.stream(messages, tools);
  const { text: firstText, toolCalls: firstToolCalls } = await readStream(streamBody, async (chunk) => {
    await onText(chunk);
  });
  fullText = firstText;

  if (firstToolCalls.length > 0) {
    messages.push({ role: "assistant", content: firstText || null, tool_calls: firstToolCalls });
    await runCalls(firstToolCalls, 0);

    // Later rounds don't stream: a tool-call response has to be read whole.
    exhausted = true;
    for (let round = 1; round < maxRounds; round++) {
      rounds = round + 1;
      const choice = await llm.complete(messages, tools);

      if (choice.tool_calls?.length) {
        messages.push({ role: "assistant", content: choice.content ?? null, tool_calls: choice.tool_calls });
        await runCalls(choice.tool_calls, round);
        continue;
      }

      fullText = choice.content ?? "";
      if (fullText) await onText(fullText);
      exhausted = false;
      break;
    }
  }

  // The model acted and said nothing (or ran out of rounds mid-batch). The
  // bubble still has to say what happened, so the actions narrate themselves.
  if (!fullText && actions.length) {
    fullText = actions.map((a) => a.summary).join(". ");
    await onText(fullText);
  }
  // A point_at-only turn carries a directive but no action and no text — give
  // the bubble a one-liner so the highlight on screen has a caption beside it.
  if (!fullText && directives.length) {
    fullText = "Here it is — up on your screen.";
    await onText(fullText);
  }

  const parsed = parseSuggestions(fullText);
  const content = sanitizeUserFacingText(parsed.content);
  const suggestions = parsed.suggestions
    .map((s) => ({ label: sanitizeUserFacingText(s.label), message: sanitizeUserFacingText(s.message) }))
    .filter((s) => s.label && s.message);

  return { content, actions, suggestions, ui: directives[0], calls, rounds, exhausted };
}

// ── the transport, wired by the caller ───────────────────────────────────────

export interface ChatClientConfig {
  baseUrl: string;
  model: string;
  headers: Record<string, string>;
  /** Passed through to the provider. Left unset for chat (the default sampling
   *  is what ships); the battery pins it so a scenario's pass rate means
   *  something. Ignored when reasoningEffort is set — see below. */
  temperature?: number;
  /** GPT-5.6's reasoning axis ("none" … "max"). Unset leaves the provider
   *  default, which is what the chat ran on before this existed. */
  reasoningEffort?: string;
  fetchImpl?: typeof fetch;
}

/** One HTTP shape for both runtimes — the edge function and the battery differ
 *  only in where the key comes from, never in how the request is made. */
export function createChatClient(cfg: ChatClientConfig): ChatClient {
  const doFetch = cfg.fetchImpl ?? fetch;
  // Reasoning and temperature are treated as mutually exclusive: providers
  // commonly reject an explicit temperature on a reasoning request, and a 400
  // here kills the whole turn rather than degrading it. Conservative until the
  // first live run says otherwise — if 5.6 accepts both, relax this and the
  // battery gets its temperature floor back.
  const reasoning = cfg.reasoningEffort && cfg.reasoningEffort !== "none"
    ? { reasoning_effort: cfg.reasoningEffort }
    : null;
  const body = (messages: ChatMessage[], tools: unknown[], stream: boolean) =>
    JSON.stringify({
      model: cfg.model,
      messages,
      tools,
      tool_choice: "auto",
      ...(reasoning ?? (cfg.temperature != null ? { temperature: cfg.temperature } : {})),
      ...(stream ? { stream: true } : {}),
    });

  return {
    async stream(messages, tools) {
      const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: cfg.headers,
        body: body(messages, tools, true),
      });
      if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
      return res.body!;
    },
    async complete(messages, tools) {
      const res = await doFetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: cfg.headers,
        body: body(messages, tools, false),
      });
      if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
      const json = await res.json();
      const choice = json.choices?.[0]?.message;
      return { content: choice?.content ?? null, tool_calls: choice?.tool_calls };
    },
  };
}
