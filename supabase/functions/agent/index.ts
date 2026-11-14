import { handleOptions, json, requireUser, corsHeaders } from "../_shared/admin.ts";
import { buildContext } from "./context.ts";
import type { NavFocus } from "./prompt.ts";
import { runOneShot } from "./oneShots.ts";
import { supabaseDeps } from "./supabaseDeps.ts";
import { executeTool, FALLBACK_TZ, TOOL_DEFINITIONS, buildPointAtTool, type MarqueeTargetSpec } from "./tools.ts";
import { llmKey, llmHeaders } from "./llm.ts";
import { resolveAgentModel } from "./modelChoice.ts";
import { buildTurnMessages } from "./turn.ts";
import { readPromptVariant } from "./prompt.ts";
import { buildTurnTrace, traceIsNoteworthy } from "./trace.ts";
import { createChatClient, runAgentTurn, type ContentPart } from "./loop.ts";
import { refuseFrozenWrite } from "../_shared/writeFreeze.ts";

// AGENT_MODEL overrides just the conversational agent (passive functions use OPENAI_MODEL).
// Useful for picking a faster model for chat without changing enrichment quality.
// The resolution itself lives in modelChoice.ts so the conformance battery reads
// the same one — it used to keep a hand-copied mirror of these defaults.
const MODEL_CHOICE = () =>
  resolveAgentModel({
    AGENT_MODEL: Deno.env.get("AGENT_MODEL"),
    OPENAI_MODEL: Deno.env.get("OPENAI_MODEL"),
    AGENT_REASONING: Deno.env.get("AGENT_REASONING"),
    OPENROUTER_API_KEY: Deno.env.get("OPENROUTER_API_KEY"),
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY"),
  });

/** Trust the client's zone only if Intl accepts it — the value flows straight
 *  into DateTimeFormat, where a junk id throws and would take the whole reply
 *  down rather than just mis-format a time. */
function resolveTz(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    console.warn(`[agent] unknown tz "${raw}" — falling back to ${FALLBACK_TZ}`);
    return FALLBACK_TZ;
  }
}


Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const frozen = refuseFrozenWrite(req);
  if (frozen) return frozen;

  try {
    const user = await requireUser(req);
    // The caller's JWT, forwarded to user-scoped sub-functions (google-events)
    // so they act as the user rather than the unauthenticated service role.
    const userToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const body = await req.json();

    // One-shot intelligence endpoints (oneShots.ts, shared with the Worker).
    // All of them propose; only `prepare` writes (to the task's own prework
    // field — never to the plan) and `enrichInbox` (suggestions only).
    const oneShot = await runOneShot(supabaseDeps, user.id, body);
    if (oneShot !== undefined) return json(oneShot);

    const { messages, rangeStart, rangeEnd, navFocus, marqueeTargets, tz: rawTz } = body as {
      messages: { role: "user" | "assistant"; content: string | ContentPart[] }[];
      rangeStart?: string;
      rangeEnd?: string;
      navFocus?: NavFocus;
      marqueeTargets?: MarqueeTargetSpec[];
      tz?: string;
    };

    if (!messages?.length) return json({ error: "messages required" }, 400);

    // Where the user physically is. Every stated time is read in this zone and
    // every time narrated back is written in it — the app renders instants in
    // the device zone, so the agent has to speak the same clock the screen does.
    // An older client that sends nothing falls back to the app's home zone.
    const tz = resolveTz(rawTz);

    // The agent's `point_at` vocabulary is whatever the client currently
    // supports — built fresh each request from the registry it sent. Adding a
    // pointable target is a client-only change; this function never needs it.
    const manifest: MarqueeTargetSpec[] = Array.isArray(marqueeTargets)
      ? marqueeTargets
          .filter((t) => t && typeof t.key === "string" && typeof t.describe === "string")
          .map((t) => ({ key: t.key, describe: t.describe }))
      : [];
    const reqTools = [...TOOL_DEFINITIONS, buildPointAtTool(manifest)];

    // Build context before opening the stream so auth/DB errors surface as
    // normal JSON error responses (not mid-stream failures).
    const ctx = await buildContext(user.id, rangeStart, rangeEnd, tz);
    const promptVariant = readPromptVariant(Deno.env.get("AGENT_PROMPT"));
    const oaiMessages = buildTurnMessages({
      ctx,
      tz,
      navFocus,
      messages,
      promptVariant,
    });

    // Open the SSE response stream before starting the agent loop so the
    // client receives text as it's generated rather than waiting for the
    // full response.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const sse = (data: Record<string, unknown>) =>
      writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

    (async () => {
      try {
        // The turn itself is the shared loop (loop.ts) — the same one the
        // conformance battery drives. This function's job is only to say where
        // the model lives, what a tool call actually does, and how bytes get
        // back to the browser.
        const key = llmKey();
        const choice = MODEL_CHOICE();
        const turnId = crypto.randomUUID();
        const startedAt = Date.now();
        const turn = await runAgentTurn({
          messages: oaiMessages,
          tools: reqTools,
          llm: createChatClient({
            baseUrl: choice.baseUrl,
            model: choice.model,
            headers: llmHeaders(key),
            reasoningEffort: choice.reasoningEffort,
          }),
          // One id per HTTP turn: a cancel proposed here can only be confirmed by a
          // later request, i.e. after the user has replied.
          execute: (name, args) => executeTool(user.id, name, args, userToken, tz, turnId),
          onText: async (chunk) => { await sse({ t: "c", v: chunk }); },
        });

        // One structured line per turn — the only signal that exists between
        // eval runs. Never allowed to affect the reply.
        try {
          const trace = buildTurnTrace({
            model: choice.model,
            promptVariant,
            reasoningEffort: choice.reasoningEffort,
            rounds: turn.rounds,
            exhausted: turn.exhausted,
            calls: turn.calls,
            actionCount: turn.actions.length,
            ms: Date.now() - startedAt,
            historyLength: messages.length,
          });
          console[traceIsNoteworthy(trace) ? "warn" : "log"](JSON.stringify(trace));
        } catch { /* a trace must never break a reply */ }

        await sse({
          t: "d",
          content: turn.content,
          actions: turn.actions,
          suggestions: turn.suggestions,
          ui: turn.ui,
          // A staged invite — a proposal, not a write. The client renders it as
          // the card that actually sends.
          invite: turn.invite,
          // Whether the turn finished. The client marks a partial turn so a
          // half-executed request can never look like a completed one.
          exhausted: turn.exhausted,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[agent]", msg);
        try { await sse({ t: "e", msg }); } catch { /* ignore */ }
      } finally {
        try { await writer.close(); } catch { /* ignore */ }
      }
    })();

    return new Response(readable, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...corsHeaders },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent]", msg);
    return json({ error: msg }, 500);
  }
});
