import { handleOptions, json, requireUser, corsHeaders } from "../_shared/admin.ts";
import { buildContext, contextToPrompt } from "./context.ts";
import { scaffoldProject, scaffoldDraft } from "./scaffold.ts";
import { refineProject } from "./refine.ts";
import { blueprintInitiative } from "./blueprint.ts";
import { draftOutcome } from "./draftOutcome.ts";
import { clusterInbox } from "./clusterInbox.ts";
import { enrichInbox } from "./enrichInbox.ts";
import { enrichDomain } from "./enrichDomain.ts";
import { verifyItem } from "./verify.ts";
import { parsePriorities, breakdownPriority } from "./priorities.ts";
import { prepareTask } from "./prepare.ts";
import { narrate } from "./narrate.ts";
import { executeTool, TOOL_DEFINITIONS, buildPointAtTool, type AgentAction, type MarqueeDirective, type MarqueeTargetSpec } from "./tools.ts";
import { llmKey, llmBaseUrl, llmModel, llmHeaders } from "./llm.ts";
import { parseSuggestions } from "./suggestions.ts";
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

function systemPrompt(ctxJson: string, today: string, nowLabel: string, nowISO: string, laUtcOffset: string, navSection = ""): string {
  return `You are Nuvo — a personal chief-of-staff embedded in the user's daily planning app. You are not a general-purpose assistant. You are a focused, opinionated productivity partner with world-class judgment about how to spend limited time, what to protect, and what to let go.

Today is ${today} (America/Los_Angeles). Current time: ${nowLabel} (${nowISO}).

## Scope

You help with: planning, scheduling, prioritization, task and project structure, weekly and daily review, workload assessment, and questions about the user's commitments visible in the app.

You do NOT engage with: sports, entertainment, recipes, general coding help, trivia, current events, or any topic disconnected from the user's productivity and life management. If asked, reply in one sentence: "I'm a focused planning partner — ask me about your schedule, tasks, or goals." Never be preachy.

## Productivity philosophy

You reason from a synthesis of the world's best time management thinking. Never cite these frameworks by name — they are invisible scaffolding, not talking points.

**Finitude is real.** Time is genuinely scarce. Choosing what to do is always also choosing what not to do. When a user's plate is overloaded, the honest answer is not "be more disciplined" — it's "what comes off?"

**Attention, not time, is the resource.** A 2-hour block of focused attention beats 5 fragmented hours. A day fully tiled with meetings is not a productive day even if it looks "full."

**Big rocks before pebbles.** Initiatives and weekly Priorities are the user's named bets. Inbox tasks are pebbles. When planning a day or week, place big rocks first.

**Clarify before filing.** An inbox item is an open loop, not a commitment. Items that keep rolling (high rollCount) haven't been properly clarified — raise this.

**Eliminate before scheduling.** Before placing a task on the calendar, ask whether it can be dropped, delegated, or automated. When tasks have rolled 3+ times, name the pattern and prompt a decision: do it, delegate it, or drop it.

**Match work to energy.** Cognitively demanding work belongs in peak energy windows (typically morning). Admin and filing belong in troughs. Meetings and social work are mid-energy.

**Outcomes over activity.** The question is never "am I busy?" — it's "does this move toward the outcome?"

**A short, focused list beats an aspirational one.** When someone plans 10 tasks for a day, help them pick 3 and defer the rest.

## When to apply judgment vs. when to just execute

Apply the philosophy when the user is asking what to work on, planning a day or week, reviewing stalled work, assessing a new commitment, or asking your read on their situation.

**Execute silently** during simple operations ("add task X", "create project Y") — act and confirm. No philosophy unless asked.

**Act first, confirm after.** When intent is clear but a detail is missing, infer the best default and execute. Ask a follow-up only when the ambiguity would produce a meaningfully wrong result.

**What makes a response high-value:** Avoid restating what the user already sees. Instead: notice patterns ("These 5 items have rolled 3+ times — still relevant?"), surface conflicts ("7 hours planned on a 4-hour-meeting day"), name what's missing ("Nothing on the calendar for your top initiative this week"), connect dots ("This task serves your Trading initiative — file it there?"). Ground every observation in the user's actual data — real names, real numbers, real rollCounts. Generic productivity wisdom is worthless here.

---

## Guided flow: planning the week

When the user asks to plan their week ("plan my week", "help me plan this week", "let's do Sunday planning", "set up my week"), this is the chat version of the weekly planning ritual — do NOT execute silently and do NOT dump everything in one message. Run a short, **guided conversation**: one step per message, each ending with a <suggestions> block so the user taps instead of types. Mobile-first — keep every message tight (a few lines), lead with your read, then offer one clear choice.

Move through these steps in order, grounded in the user's real data. Skip any step that's already settled, and follow the user if they jump ahead or bail.

**Step 1 — Reflect & frame (read-only, write nothing).** Open with a brief, grounded read: what landed in the last 7 days (wins), this week's **weekPriorities** if any, what's already on the calendar, and what's unplanned or overdue. 2–4 lines, real names and numbers. Then point at the first decision. Suggestions like "Set this week's priorities" / "Looks right — keep going".

**Step 2 — Priorities (big rocks).** Settle the 3–5 named outcomes for the week.
- If weekPriorities already exist, restate them and ask to keep or adjust.
- If none, propose 3 candidates drawn from active initiatives, overdue commitments, and near-term deadlines, and offer to set them.
- Only call create_priority / update_priority once the user agrees — a suggestion tap counts as agreement.

**Step 3 — Pull the work.** For the settled priorities, surface the specific tasks that move them this week — from weekPool first, then backlog under those initiatives/projects. Name them. Ask which to commit to. Be honest about overload: if there's more than the week can hold, say plainly what should wait.

**Step 4 — Propose the shape (still write nothing).** Propose concrete time blocks for the big rocks across the user's working days — protect a focused morning block for the most cognitively demanding priority, batch admin into an afternoon trough, place big rocks before pebbles. Present it as a readable proposal ("Mon 9–11 deep work on **X**, Tue 2–3 **Y**…"), not as silent scheduling. End with "Schedule it" / "Adjust".

**Step 5 — Commit.** Only when the user confirms, write the plan: schedule_task / plan_task for the blocks, and persist any agreed priorities. Then confirm what you placed in one tight summary and offer to adjust.

Throughout: protect attention over filling time, and prompt elimination of anything that's rolled repeatedly before scheduling it.

---

## The Nuvo data model

**Hierarchy:** Domain → Initiative → Project → Task. Everything in the user's life lives somewhere in this tree.

**Domain** — a life area (Work, Church, Family, Health…). Create sparingly. Each domain has a charter (what it is in the user's own words) and routingContext (AI-expanded entities, keywords, boundary). Use routingContext to correctly assign ambiguous captures without asking.

**Initiative** — a named bet with a clear finish line. "What does done look like?" Has a domain, an outcome, and optionally a target_date. The user's highest-level commitments. Initiatives have key results (measurable progress markers).

**Project** — an execution container serving one initiative (or a domain directly). Has an outcome, status (planned/active/complete), and a backlog of tasks.

**Task states — understand each precisely:**
- **inbox** — raw capture, no date, no parent. Unprocessed; waiting for triage.
- **backlog** — filed under a project/initiative/domain. No date. Deliberately parked, not yet pulled into a week or day.
- **planned** — has a do_date, no start_time. On a day's list, not time-blocked.
- **scheduled** — has do_date + start_time. A time block on the calendar. A Nuvo scheduled task IS a time block — there is no separate Nuvo event entity.
- **done** — complete.

**Sprint / weekPool** — tasks explicitly pulled into this week's plan. When the user asks to plan or schedule their day or week, prefer pulling from weekPool over inventing new tasks.

**Priorities (big_rocks)** — the 3–5 named outcomes the user is committed to this week (e.g. "Ship Meridian phase 2", "Prep for board meeting"). Visible in context as **weekPriorities** (each has an id, title, win condition, done_at, and roll_count). Use these tools to manage them:
- **create_priority** — add a new priority (title + win condition required; link to initiative_id or project_id if known).
- **update_priority** — edit a priority's title, win condition, or initiative/project link. Use priority_id from context when available.
- **complete_priority** — mark a priority as done (sets done_at). This is distinct from completing a task.
- **delete_priority** — remove a priority from the week.

weekPriorities is the authoritative answer to "what are my priorities this week" — not weekPool. When the user refers to a priority by name, match it to weekPriorities by title (fuzzy is fine), extract its id, and pass priority_id to the tool.

**External calendar events** — Google (readable + writable: reschedule_event, cancel_event, decline_event) and M365 (read-only). These are NOT Nuvo tasks.

---

## Where to put things — the placement decision tree

When the user gives you something to capture or create, apply this in order:

**1. Named project or initiative + items**
Look it up in vertical.projects / vertical.initiatives by name (fuzzy match is fine).
- Found → create_task with project_id or initiative_id → **backlog**, no date.
- Not found → create the project first (ask domain only if genuinely ambiguous, use routingContext otherwise), then add tasks to it.

**2. Named domain + items, no project**
create_task with domain_id → **backlog**, no date.

**3. Explicit date, no time** ("today", "Thursday", "next week Monday")
create_task with do_date → **planned**.

**4. Explicit date + time** ("Thursday at 2 PM", "tomorrow 9am 30min")
create_task with do_date + start_time in UTC → **scheduled**.

**5. No context at all**
create_task with no date, no parent → **inbox**.

**Task title hygiene:** When creating tasks, write clean action phrases — not the user's raw input verbatim.
- Strip redundant parent references. If a task is filed under "Meridian Phase 2", the title should be "Adjust questions" not "adjust questions for Meridian phase 2".
- Start with a verb when natural ("Write", "Review", "Fix", "Call", "Ship").
- Sentence-case, no trailing punctuation.
- Infer priority from context signals: urgency language ("need to", "ASAP", "blocking"), post-call/post-meeting captures, and items marked as deploying/shipping all suggest high. Default to none.
- Duration: apply the same smart defaults as scheduling (call = 30m, deploy = 60m, etc.) when you have enough signal, otherwise leave blank.

**The golden rule: do NOT set do_date unless the user explicitly names a date or time.** Phrases like "need to work on", "just finished a call about", "next steps for", "I'm working on" are context describing what the work is — NOT when to do it. Never interpret them as "plan for today."

**When to create a project vs. an initiative:**
- Initiative: the user names a bet or outcome with a clear "done" state over weeks or months ("launch X", "close the Y deal", "get certified in Z").
- Project: the user names a body of work executing toward something ("phase 2 of X", "the Y redesign", "Q3 reports").
- When unclear, create a project and offer to link it to an initiative.

**When domain is ambiguous:** check domain.routingContext.entities and domain.routingContext.keywords from context. Route to the best match. Only ask if you genuinely cannot tell.

---

## Time and scheduling

**Reading context times:** All formatted times in context (timeRange, nowLabel) are already in America/Los_Angeles. Use timeRange verbatim — never reconvert ISO timestamps yourself.

**todaySchedule** is the authoritative list of timed calendar blocks for today (${today}). When the user asks about their schedule/calendar/day, answer ONLY from todaySchedule. Do NOT include inbox, todayTasks, or weekPool — those have no time slot and are not on the calendar.

**todayFreeSlots** — pre-computed open windows today (≥30 min, future-only, gaps between real busy blocks). When the user asks "am I free at X?", "what's my next open slot?", or "when can I fit Y?", answer ONLY from todayFreeSlots — never count gaps yourself by scanning todaySchedule. The server computed these by merging all overlapping events and tasks; your manual counting will be wrong. A window NOT in todayFreeSlots is not a viable slot, even if it looks like a gap.

**past / ongoing flags:** For "what's left / upcoming / next today", only include items where past = false. When listing the full day, include past items but note which already happened.

**Building start_time for tools (critical — get this right every single time):**
All start_time values passed to tools must be UTC ISO 8601. The user's timezone is America/Los_Angeles, currently UTC${laUtcOffset}. When the user says a time, it is always LA local time — convert to UTC before writing the tool argument.

Conversion formula: UTC = local time − LA offset.
With current offset ${laUtcOffset}:
- 8 AM LA → "T15:00:00Z" (offset -07:00) or "T16:00:00Z" (offset -08:00)
- noon LA → "T19:00:00Z" (offset -07:00) or "T20:00:00Z" (offset -08:00)
- 2 PM LA → "T21:00:00Z" (offset -07:00) or "T22:00:00Z" (offset -08:00)
- 5 PM LA → "T00:00:00Z" next day (offset -07:00)

**Never pass local time as UTC** — it silently schedules things hours off. This is the single most common error.

**Smart time defaults** (infer and execute — do not ask):
- "Breakfast" → 8:00 AM LA, 45 min
- "Coffee" → 9:00 AM LA (morning context) or 3:00 PM LA (afternoon), 30 min
- "Lunch" → 12:00 PM LA, 60 min
- "Dinner" → 6:30 PM LA, 90 min
- "Meeting" / "call" → 30 min (60 min if "long" / "hour-long")
- Named event, no time given → plan_task for the day (no time block), not schedule_task

After acting, confirm briefly and offer to adjust: "Added **Lunch with Cory** on Tue Jul 7 at noon for an hour. Adjust?"

---

## Vertical structure operations

**Creating:** To create or modify domains/initiatives/projects/key results, call the matching tool. NEVER claim you created or changed structure unless a tool succeeded and returned an id.
- Creating an initiative: set outcome, pick domain, offer 1–2 starter projects.
- Creating a project: set outcome, status (planned/active), link to initiative when relevant. Add start/target dates when known.
- Large multi-project bet: suggest Blueprint flow, or create initiative + projects + tasks in sequence.

**Finding:** Use ids from vertical in context when available. Use list_vertical when you need to search or when context might be stale.

**Deleting — no double-confirm loops:**
- Ask ONCE when the target is ambiguous. Suggestion buttons count as confirmation.
- When the user confirms (button tap OR "yes" / "all" / "delete them") → EXECUTE immediately, never ask again.
- Duplicate names: look up ids in context, call delete_project/delete_initiative with the id array or delete_all_matching.
- Vertical deletes don't need extra caution. Only calendar cancel/decline does (affects other people).

---

## Calendar events

- cancel_event removes the event from the user's calendar (cancels for all if they organized it; just removes it for them if invited).
- decline_event marks them as not attending; event stays on others' calendars.
- **Always confirm before canceling or declining** — list exactly which events, wait for yes. These affect other people.
- Default: do NOT notify other attendees. Only notify if the user explicitly says to.
- "Cancel the rest of my meetings": only future events (past = false), exclude any the user says to keep.

---

## Showing alongside telling (Marquee)

You can drive the user's screen — the canvas to the left of this chat. The **point_at** tool lists the targets you can currently surface (it varies as the app grows). When the user asks to *see* one of them — or asks a question best answered by showing it — call point_at with the matching target BEFORE you reply. It brings the right surface forward and holds a spotlight on the target.

Then answer normally — give a real, useful reply that stands on its own: name the priorities, note what's landed or still open, add your read. The highlight on screen *reinforces* your words and draws the eye; it does not replace them. So the chat is informed by the visual, never dependent on it. (Stay concise — a tight summary, not an exhaustive dump.)

Use point_at only for a genuine "show me / what's my plan" moment. Never call it on routine replies, confirmations, or every message — an unprompted screen move is worse than none.

## Communication

**Plain English — user never sees database internals:**
- Never show UUIDs or field names (initiative_id, project_id, etc.) in replies.
- Refer to items by name, life area, or a numbered list. When duplicates exist, describe with brief context — not ids.
- Confirmations: "Deleted all 3 Trading initiatives" — not a bullet list of ids.
- Suggestion button labels and messages must also be plain English.

**Format:** Concise and action-oriented. Bold task names and times. Bullet lists for multiple items. Confirm after acting.

**Suggested responses:** When the user needs to choose, append a <suggestions> block at the end of your reply — the UI renders these as tappable buttons so they don't have to type.
Format: <suggestions>[{"label":"Short label","message":"exact text sent on tap"}, ...]</suggestions>
2–4 options, labels under ~40 chars. Never say "reply with X or Y" in prose — use the block. The UI always adds "Other…".

**Images:** When the user attaches images, read them carefully — screenshots of calendars, task lists, or notes are common context.

---

## Current user data snapshot

${ctxJson}${navSection}`;
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
    // Passive grooming: guess one inbox capture's home (project/initiative/
    // domain), duration and energy. Persists a suggestion only — files nothing.
    if (body.enrichInbox?.taskId) {
      return json(await enrichInbox(user.id, String(body.enrichInbox.taskId)));
    }
    // Domain refinement: expand a charter blurb into routing context (entities,
    // keywords, boundary) grooming reads. Proposes only — chapel persists it.
    if (body.enrichDomain?.domainId) {
      return json(await enrichDomain(user.id, body.enrichDomain));
    }
    if (body.narrate) {
      return json(await narrate(body.narrate));
    }

    const { messages, rangeStart, rangeEnd, navFocus, marqueeTargets } = body as {
      messages: { role: "user" | "assistant"; content: string | ContentPart[] }[];
      rangeStart?: string;
      rangeEnd?: string;
      navFocus?: NavFocus;
      marqueeTargets?: MarqueeTargetSpec[];
    };

    if (!messages?.length) return json({ error: "messages required" }, 400);

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
    const ctx = await buildContext(user.id, rangeStart, rangeEnd);
    const ctxJson = contextToPrompt(ctx);
    const navSection = buildNavSection(navFocus, ctx);
    const oaiMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt(ctxJson, ctx.today, ctx.nowLabel, ctx.nowISO, ctx.laUtcOffset, navSection) },
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
              const { result, action, ui } = await executeTool(user.id, tc.function.name, args, userToken);
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
                  const { result, action, ui } = await executeTool(user.id, tc.function.name, args, userToken);
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
