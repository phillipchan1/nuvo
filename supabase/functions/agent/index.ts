import { handleOptions, json, requireUser, corsHeaders } from "../_shared/admin.ts";
import { buildContext } from "./context.ts";
import type { NavFocus } from "./prompt.ts";
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
import { executeTool, FALLBACK_TZ, TOOL_DEFINITIONS, buildPointAtTool, type MarqueeTargetSpec } from "./tools.ts";
import { llmKey, llmBaseUrl, llmModel, llmHeaders } from "./llm.ts";
import { buildTurnMessages } from "./turn.ts";
import { createChatClient, runAgentTurn, type ContentPart } from "./loop.ts";

// AGENT_MODEL overrides just the conversational agent (passive functions use OPENAI_MODEL).
// Useful for picking a faster model for chat without changing enrichment quality.
const MODEL = () => Deno.env.get("AGENT_MODEL") ?? llmModel("gpt-5.4-mini", "qwen/qwen3.6-flash");

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
    // keywords, boundary) grooming reads. Proposes only — the domain floor persists it.
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
    const oaiMessages = buildTurnMessages({ ctx, tz, navFocus, messages });

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
        const turn = await runAgentTurn({
          messages: oaiMessages,
          tools: reqTools,
          llm: createChatClient({ baseUrl: llmBaseUrl(), model: MODEL(), headers: llmHeaders(key) }),
          execute: (name, args) => executeTool(user.id, name, args, userToken, tz),
          onText: async (chunk) => { await sse({ t: "c", v: chunk }); },
        });

        await sse({
          t: "d",
          content: turn.content,
          actions: turn.actions,
          suggestions: turn.suggestions,
          ui: turn.ui,
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
