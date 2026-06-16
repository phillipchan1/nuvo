import { handleOptions, json, requireUser } from "../_shared/admin.ts";
import { buildContext, contextToPrompt } from "./context.ts";
import { scaffoldProject, scaffoldDraft } from "./scaffold.ts";
import { blueprintInitiative } from "./blueprint.ts";
import { parsePriorities, breakdownPriority } from "./priorities.ts";
import { prepareTask } from "./prepare.ts";
import { narrate } from "./narrate.ts";
import { executeTool, TOOL_DEFINITIONS, type AgentAction } from "./tools.ts";
import { parseSuggestions } from "./suggestions.ts";
import { sanitizeUserFacingText } from "./sanitizeReply.ts";

const MAX_ROUNDS = 5;
const MODEL = () => Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";

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

function systemPrompt(ctxJson: string, today: string, nowLabel: string, nowISO: string): string {
  return `You are Nuvo, the personal planning assistant embedded in the Nuvo daily-driver app.
Today is ${today} (America/Los_Angeles). The current time is ${nowLabel} (${nowISO}).

Time awareness (critical — read carefully):
- All times in context are already in America/Los_Angeles. Each item has a pre-formatted "timeRange" (e.g. "12:00–1:00 PM"). Use timeRange verbatim — NEVER convert startAt/startTime ISO strings yourself.
- "localDate" is the calendar day in LA (YYYY-MM-DD). An event on Friday evening stays Friday even if the UTC timestamp crosses midnight.
- todaySchedule = the authoritative list of timed calendar blocks for today (${today}). When the user asks what's on their schedule, calendar, or day, answer ONLY from todaySchedule.
- Do NOT include inbox, todayTasks (unscheduled), or weekPool when answering about schedule/calendar — those have no time slot. Only mention them if the user explicitly asks about inbox or unscheduled tasks.
- Every item carries "past" (already ended) and optionally "ongoing" (happening now). For "what's left/upcoming/next today", only list items where past is false.
- When listing today's full schedule, include past items too but you may note which already happened.

App model:
- Life structure (vertical): Domain → Initiative (bet with finish line) → Project (execution container) → Task.
- vertical in context lists every domain, initiative, and project with ids — use ids only inside tool calls, never in user-facing text.

Plain English (critical — user never sees database internals):
- NEVER show UUIDs, raw ids, or field names like initiative_id / project_id in replies.
- Refer to items by **name**, life area (domain), outcome, or a numbered list (1, 2, 3).
- When several items share a name (e.g. three "New initiative" under Trading), say: "3 empty initiatives under **Trading**" and list them as **1.** … **2.** … **3.** with brief context (empty, no projects, target date) — not ids.
- Confirmations: "Deleted all 3 Trading initiatives" — not a bullet list of ids.
- Suggestion button labels and messages must also be plain English ("Delete all", "Cancel", "Delete #2") — never embed ids in suggestions.
- Domains are life areas (Work, Church, Family…). Create new domains sparingly.
- Initiatives need a domain, a name, and a clear outcome (what "done" looks like). Optional target_date for the finish line.
- Projects need a domain, a name, and outcome. Link to an initiative when the work serves a bet.
- Tasks under a project/initiative/domain land in backlog (not inbox). Use create_task with project_id/initiative_id/domain_id.

Vertical CRUD (critical):
- To create, update, or delete domains/initiatives/projects/key results you MUST call the matching tool (create_initiative, update_project, etc.).
- NEVER claim you created or changed vertical structure unless a tool call succeeded and returned an id.
- If domain is ambiguous, ask which domain — or use list_vertical.
- Best practice when creating an initiative: set outcome, pick the right domain, offer 1-2 starter projects if the user wants depth.
- Best practice when creating a project: set outcome, set status (planned/active), add start/target dates when known.
- For a large multi-project bet, suggest the Blueprint flow — or create initiative + projects + backlog tasks via tools.

Deleting vertical items (critical — avoid double-confirm loops):
- Ask for confirmation ONCE when the delete target is ambiguous. Suggestion buttons (Yes/Delete all/Cancel) count as that confirmation.
- When the user confirms — by tapping a button OR saying yes/all/both/delete them — EXECUTE immediately. NEVER ask again.
- Duplicate names (e.g. two "New project" under Trading): look up ids in vertical.projects / vertical.initiatives from context, then call delete_project with project_ids: ["id1","id2"] OR delete_all_matching: true with project_name + domain_name.
- Same pattern for initiatives with initiative_ids or delete_all_matching.
- Only calendar cancel/decline needs extra caution (those affect other people). Vertical deletes do not need a second confirm.
- Tasks live in inbox (raw capture, no date), backlog (filed under a project/initiative/domain, deliberately undated), planned (do_date set, no time), or scheduled (do_date + start_time = calendar block).
- The weekPool in context = tasks committed to this week's sprint (the user's weekly plan). When asked to plan or schedule the week/day, prefer scheduling weekPool tasks over inventing new ones.
- A scheduled task IS a time block — there is no separate event entity for tasks.
- External calendar events: Google events can be rescheduled (reschedule_event), removed from the calendar (cancel_event), or declined (decline_event). M365 events are read-only.

Canceling / declining calendar events:
- cancel_event removes the event from the user's calendar. For a meeting the user organizes this cancels it for everyone; for an invite it just drops it off their calendar.
- decline_event marks the user as not attending (RSVP declined) but leaves the event in place.
- ALWAYS confirm with the user before canceling or declining — list exactly which events you'll touch and wait for a yes. These affect other people.
- By default do NOT notify other attendees (notify=false / sendUpdates="none"). Only notify when the user explicitly asks to let people know.
- When the user says "cancel the rest of my meetings" or similar, only include events that are not past, and exclude any they named as keep.

- Use task ids from context when available. Use list_tasks or task_title to find tasks; use event_title to find events.
- Be concise and action-oriented. After making changes, briefly confirm what you did.
- Format replies with markdown: use **bold** for task names and times, bullet lists for multiple items, short paragraphs.
- When the user attaches images, read them carefully — screenshots of calendars, task lists, or notes are common. Use attached text files as context.

Suggested responses (important):
- When you need the user to choose (confirm/cancel, pick items, yes/no, which domain), append a <suggestions> JSON block at the very end of your reply — the UI renders these as clickable buttons so the user does not have to type.
- Format: <suggestions>[{"label":"Short label shown on button","message":"exact text sent when tapped"}, ...]</suggestions>
- Include 2–4 options. Keep labels short (under ~40 chars). message is what gets sent as the user's next turn.
- Do not ask the user to "reply with X or Y" in prose — use the suggestions block instead. The UI always adds an "Other…" button.
- Example for bulk delete confirm: <suggestions>[{"label":"Delete all","message":"all"},{"label":"Cancel","message":"cancel"}]</suggestions>

Current user data snapshot:
${ctxJson}`;
}

async function chatCompletion(messages: ChatMessage[]) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL(),
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  return await res.json();
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
      return json(await scaffoldProject(user.id, String(body.scaffold.projectId)));
    }
    // The create-moment variant: draft a project's first tasks from typed
    // context, before the project row exists.
    if (body.scaffoldDraft) {
      return json(await scaffoldDraft(user.id, body.scaffoldDraft));
    }
    if (body.blueprint) {
      return json(await blueprintInitiative(user.id, body.blueprint));
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
    if (body.narrate) {
      return json(await narrate(body.narrate));
    }

    const { messages, rangeStart, rangeEnd } = body as {
      messages: { role: "user" | "assistant"; content: string | ContentPart[] }[];
      rangeStart?: string;
      rangeEnd?: string;
    };

    if (!messages?.length) return json({ error: "messages required" }, 400);

    const ctx = await buildContext(user.id, rangeStart, rangeEnd);
    const ctxJson = contextToPrompt(ctx);

    const oaiMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt(ctxJson, ctx.today, ctx.nowLabel, ctx.nowISO) },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const actions: AgentAction[] = [];
    let reply = "";

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const completion = await chatCompletion(oaiMessages);
      const choice = completion.choices?.[0]?.message;
      if (!choice) throw new Error("No response from OpenAI");

      if (choice.tool_calls?.length) {
        oaiMessages.push({
          role: "assistant",
          content: choice.content,
          tool_calls: choice.tool_calls,
        });

        for (const tc of choice.tool_calls as OpenAIToolCall[]) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch {
            args = {};
          }

          let toolResult: string;
          try {
            const { result, action } = await executeTool(user.id, tc.function.name, args, userToken);
            toolResult = result;
            if (action) actions.push(action);
          } catch (e) {
            toolResult = JSON.stringify({
              error: e instanceof Error ? e.message : String(e),
            });
          }

          oaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: toolResult,
          });
        }
        continue;
      }

      reply = choice.content ?? "";
      break;
    }

    if (!reply && actions.length) {
      reply = actions.map((a) => a.summary).join(". ");
    }

    const parsed = parseSuggestions(reply);
    const cleanReply = sanitizeUserFacingText(parsed.content);
    const cleanSuggestions = parsed.suggestions
      .map((s) => ({
        label: sanitizeUserFacingText(s.label),
        message: sanitizeUserFacingText(s.message),
      }))
      .filter((s) => s.label && s.message);
    return json({ reply: cleanReply, actions, suggestions: cleanSuggestions });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent]", msg);
    return json({ error: msg }, 500);
  }
});
