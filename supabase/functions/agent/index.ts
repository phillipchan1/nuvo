import { handleOptions, json, requireUser, corsHeaders } from "../_shared/admin.ts";
import { buildContext, contextToPrompt } from "./context.ts";
import { scaffoldProject, scaffoldDraft } from "./scaffold.ts";
import { assessRecord } from "./assess.ts";
import { refineProject } from "./refine.ts";
import { blueprintInitiative } from "./blueprint.ts";
import { draftOutcome } from "./draftOutcome.ts";
import { clusterInbox } from "./clusterInbox.ts";
import { enrichInboxBatch } from "./enrichInbox.ts";
import { enrichDomain } from "./enrichDomain.ts";
import { verifyItem } from "./verify.ts";
import { parsePriorities, breakdownPriority } from "./priorities.ts";
import { prepareTask } from "./prepare.ts";
import { narrate } from "./narrate.ts";
import { narrateReviewFind } from "./reviewFind.ts";
import { executeTool, FALLBACK_TZ, TOOL_DEFINITIONS, buildPointAtTool, type AgentAction, type MarqueeDirective, type MarqueeTargetSpec } from "./tools.ts";
import { llmKey, llmBaseUrl, llmModel, llmHeaders } from "./llm.ts";
import { parseSuggestions } from "./suggestions.ts";
import { dynamicContextPrompt, STATIC_SYSTEM_PROMPT } from "./systemPrompt.ts";
import { sanitizeUserFacingText } from "./sanitizeReply.ts";

const MAX_ROUNDS = 5;
// AGENT_MODEL overrides just the conversational agent (passive functions use OPENAI_MODEL).
// Useful for picking a faster model for chat without changing enrichment quality.
const MODEL = () => Deno.env.get("AGENT_MODEL") ?? llmModel("gpt-5.4-mini", "qwen/qwen3.6-flash");

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface NavFocus {
  rung?: string;
  domainId?: string;
  initiativeId?: string;
  projectId?: string;
}

function buildNavSection(navFocus: NavFocus | null | undefined, ctx: { vertical: { domains: unknown[]; initiatives: unknown[]; projects: unknown[] } }): string {
  if (!navFocus?.rung) return "";
  const rungLabels: Record<string, string> = {
    now: "Today (Now)", day: "Today (Schedule)", project: "Projects", initiative: "Initiatives", domain: "Domains",
  };
  const parts: string[] = [`Floor: ${rungLabels[navFocus.rung] ?? navFocus.rung}`];
  // deno-lint-ignore no-explicit-any
  if (navFocus.domainId) { const d = (ctx.vertical.domains as any[]).find((x) => x.id === navFocus.domainId); if (d) parts.push(`Domain: ${d.name}`); }
  // deno-lint-ignore no-explicit-any
  if (navFocus.initiativeId) { const i = (ctx.vertical.initiatives as any[]).find((x) => x.id === navFocus.initiativeId); if (i) parts.push(`Initiative: ${i.name}`); }
  // deno-lint-ignore no-explicit-any
  if (navFocus.projectId) { const p = (ctx.vertical.projects as any[]).find((x) => x.id === navFocus.projectId); if (p) parts.push(`Project: ${p.name}`); }
  return `\n\n## User's current view\n${parts.join(" › ")}\nWhen the user refers to "this" or "here" without context, they mean the item above.`;
}

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

async function chatCompletion(messages: ChatMessage[], tools: unknown[] = TOOL_DEFINITIONS) {
  const key = llmKey();
  const res = await fetch(`${llmBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(key),
    body: JSON.stringify({
      model: MODEL(),
      messages,
      tools,
      tool_choice: "auto",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text}`);
  }
  return await res.json();
}

async function chatCompletionStream(messages: ChatMessage[], tools: unknown[] = TOOL_DEFINITIONS): Promise<ReadableStream<Uint8Array>> {
  const key = llmKey();
  const res = await fetch(`${llmBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(key),
    body: JSON.stringify({
      model: MODEL(),
      messages,
      tools,
      tool_choice: "auto",
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text}`);
  }
  return res.body!;
}

/** Read a streaming chat-completion response. Calls onTextChunk for each text
 *  delta (never called when the response is tool calls — they have null content).
 *  Returns the full accumulated text and any tool calls assembled from deltas. */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onTextChunk: (chunk: string) => Promise<void>,
): Promise<{ text: string; toolCalls: OpenAIToolCall[] }> {
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

  const toolCalls: OpenAIToolCall[] = [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: tc.arguments } }));

  return { text, toolCalls };
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    // The caller's JWT, forwarded to user-scoped sub-functions (google-events)
    // so they act as the user rather than the unauthenticated service role.
    const userToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const body = await req.json();

    // One-shot intelligence endpoints. All of them propose; only `prepare`
    // writes (to the task's own prework field — never to the plan).
    if (body.scaffold?.projectId) {
      return json(await scaffoldProject(user.id, String(body.scaffold.projectId), {
        guidance: body.scaffold.guidance,
        draftTitles: Array.isArray(body.scaffold.draftTitles) ? body.scaffold.draftTitles.map(String) : undefined,
        description: body.scaffold.description ? String(body.scaffold.description) : undefined,
      }));
    }
    // Refine an existing backlog: typo/wording fixes + missing steps + a
    // sensible order, all proposed as a reviewable diff the client applies.
    if (body.refine?.projectId) {
      return json(await refineProject(user.id, String(body.refine.projectId)));
    }
    // Assess: a world-class coach's pass over a project or initiative, returning
    // anchored findings the client overlays as inline margin notes (Accept/Dismiss).
    if (body.assess?.id && (body.assess.kind === "project" || body.assess.kind === "initiative")) {
      return json(await assessRecord(user.id, body.assess.kind, String(body.assess.id)));
    }
    // Tending's "raw → shaped" advance: draft one outcome line for a project /
    // initiative that has a name but no goal yet.
    if (body.draftOutcome?.id) {
      return json(await draftOutcome(user.id, body.draftOutcome));
    }
    // Tending's soundness judgment: is this item genuinely ready (outcome, steps,
    // time, dates), or just structurally filled in?
    if (body.verify?.id) {
      return json(await verifyItem(user.id, body.verify));
    }
    // The create-moment variant: draft a project's first tasks from typed
    // context, before the project row exists.
    if (body.scaffoldDraft) {
      return json(await scaffoldDraft(user.id, body.scaffoldDraft));
    }
    if (body.blueprint) {
      return json(await blueprintInitiative(user.id, {
        ...body.blueprint,
        draftProjectNames: Array.isArray(body.blueprint.draftProjectNames)
          ? body.blueprint.draftProjectNames.map(String)
          : undefined,
      }));
    }
    // Free-text → the week's priorities (outcomes), inferring each win + the bet
    // it serves. The client appends the parse to the sprint's big_rocks.
    if (body.priorities) {
      return json(await parsePriorities(user.id, body.priorities));
    }
    // "What moves this priority?" → propose this week's next actions.
    if (body.breakdown) {
      return json(await breakdownPriority(user.id, body.breakdown));
    }
    if (body.prepare?.taskId) {
      return json(await prepareTask(user.id, String(body.prepare.taskId)));
    }
    // Plan's "theme the inbox": group loose captures into a few named runs the
    // client can place as focus blocks across the week's open time.
    if (body.clusterInbox) {
      return json(await clusterInbox(user.id, body.clusterInbox));
    }
    // Passive grooming: guess a batch of inbox captures' homes (project/
    // initiative/domain), duration and energy in one call. Persists
    // suggestions only — files nothing.
    if (body.enrichInbox?.taskIds) {
      const taskIds = Array.isArray(body.enrichInbox.taskIds) ? body.enrichInbox.taskIds.map(String) : [];
      return json(await enrichInboxBatch(user.id, taskIds));
    }
    // Domain refinement: expand a charter blurb into routing context (entities,
    // keywords, boundary) grooming reads. Proposes only — chapel persists it.
    if (body.enrichDomain?.domainId) {
      return json(await enrichDomain(user.id, body.enrichDomain));
    }
    if (body.narrate) {
      return json(await narrate(body.narrate));
    }
    // Weekly Review Find — warm the one pre-selected discovery. Numbers stay client-side.
    if (body.reviewFind) {
      return json(await narrateReviewFind(body.reviewFind));
    }

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
    const ctxJson = contextToPrompt(ctx);
    const navSection = buildNavSection(navFocus, ctx);
    const oaiMessages: ChatMessage[] = [
      { role: "system", content: STATIC_SYSTEM_PROMPT },
      { role: "system", content: dynamicContextPrompt(ctxJson, ctx.today, ctx.nowLabel, ctx.nowISO, navSection, tz) },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    // Open the SSE response stream before starting the agent loop so the
    // client receives text as it's generated rather than waiting for the
    // full response.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const sse = (data: Record<string, unknown>) =>
      writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

    (async () => {
      const actions: AgentAction[] = [];
      const directives: MarqueeDirective[] = [];
      let fullText = "";

      try {
        // First round: streaming — text chunks flow to the client immediately.
        // When the model issues tool calls instead, delta.content is null so
        // onTextChunk is never called and no text is forwarded.
        const streamBody = await chatCompletionStream(oaiMessages, reqTools);
        const { text: firstText, toolCalls: firstToolCalls } = await readStream(
          streamBody,
          async (chunk) => { await sse({ t: "c", v: chunk }); },
        );
        fullText = firstText;

        if (firstToolCalls.length > 0) {
          oaiMessages.push({ role: "assistant", content: firstText || null, tool_calls: firstToolCalls });
          for (const tc of firstToolCalls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
            let toolResult: string;
            try {
              const { result, action, ui } = await executeTool(user.id, tc.function.name, args, userToken, tz);
              toolResult = result;
              if (action) actions.push(action);
              if (ui) directives.push(ui);
            } catch (e) {
              toolResult = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
            }
            oaiMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
          }

          // Subsequent rounds non-streaming (tool-call responses need full JSON).
          for (let round = 1; round < MAX_ROUNDS; round++) {
            const completion = await chatCompletion(oaiMessages, reqTools);
            const choice = completion.choices?.[0]?.message;
            if (!choice) break;

            if (choice.tool_calls?.length) {
              oaiMessages.push({ role: "assistant", content: choice.content, tool_calls: choice.tool_calls });
              for (const tc of choice.tool_calls as OpenAIToolCall[]) {
                let args: Record<string, unknown> = {};
                try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
                let toolResult: string;
                try {
                  const { result, action, ui } = await executeTool(user.id, tc.function.name, args, userToken, tz);
                  toolResult = result;
                  if (action) actions.push(action);
                  if (ui) directives.push(ui);
                } catch (e) {
                  toolResult = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
                }
                oaiMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
              }
              continue;
            }

            fullText = choice.content ?? "";
            if (fullText) await sse({ t: "c", v: fullText });
            break;
          }
        }

        if (!fullText && actions.length) {
          fullText = actions.map((a) => a.summary).join(". ");
          await sse({ t: "c", v: fullText });
        }
        // A point_at-only turn carries a directive but no action/text — give the
        // bubble a one-liner so the highlight on screen has a caption beside it.
        if (!fullText && directives.length) {
          fullText = "Here it is — up on your screen.";
          await sse({ t: "c", v: fullText });
        }

        const parsed = parseSuggestions(fullText);
        const cleanContent = sanitizeUserFacingText(parsed.content);
        const cleanSuggestions = parsed.suggestions
          .map((s) => ({ label: sanitizeUserFacingText(s.label), message: sanitizeUserFacingText(s.message) }))
          .filter((s) => s.label && s.message);

        await sse({ t: "d", content: cleanContent, actions, suggestions: cleanSuggestions, ui: directives[0] });
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
