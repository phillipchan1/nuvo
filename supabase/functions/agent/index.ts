import { handleOptions, json, requireUser } from "../_shared/admin.ts";
import { buildContext, contextToPrompt } from "./context.ts";
import { scaffoldProject } from "./scaffold.ts";
import { blueprintInitiative } from "./blueprint.ts";
import { prepareTask } from "./prepare.ts";
import { narrate } from "./narrate.ts";
import { executeTool, TOOL_DEFINITIONS, type AgentAction } from "./tools.ts";

const MAX_ROUNDS = 5;
const MODEL = () => Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function systemPrompt(ctxJson: string, today: string): string {
  return `You are Nuvo, the personal planning assistant embedded in the Nuvo daily-driver app.
Today is ${today} (America/Los_Angeles).

App model:
- Tasks live in inbox (raw capture, no date), backlog (filed under a project/initiative/domain, deliberately undated), planned (do_date set, no time), or scheduled (do_date + start_time = calendar block).
- The weekPool in context = tasks committed to this week's sprint (the user's weekly plan). When asked to plan or schedule the week/day, prefer scheduling weekPool tasks over inventing new ones.
- A scheduled task IS a time block — there is no separate event entity for tasks.
- External calendar events (Google/M365) are read-only except Google events can be rescheduled.
- Use task ids from context when available. Use list_tasks or task_title to find tasks.
- Be concise and action-oriented. After making changes, briefly confirm what you did.
- Format replies with markdown: use **bold** for task names and times, bullet lists for multiple items, short paragraphs.

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
    const body = await req.json();

    // One-shot intelligence endpoints. All of them propose; only `prepare`
    // writes (to the task's own prework field — never to the plan).
    if (body.scaffold?.projectId) {
      return json(await scaffoldProject(user.id, String(body.scaffold.projectId)));
    }
    if (body.blueprint) {
      return json(await blueprintInitiative(user.id, body.blueprint));
    }
    if (body.prepare?.taskId) {
      return json(await prepareTask(user.id, String(body.prepare.taskId)));
    }
    if (body.narrate) {
      return json(await narrate(body.narrate));
    }

    const { messages, rangeStart, rangeEnd } = body as {
      messages: { role: "user" | "assistant"; content: string }[];
      rangeStart?: string;
      rangeEnd?: string;
    };

    if (!messages?.length) return json({ error: "messages required" }, 400);

    const ctx = await buildContext(user.id, rangeStart, rangeEnd);
    const ctxJson = contextToPrompt(ctx);

    const oaiMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt(ctxJson, ctx.today) },
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
            const { result, action } = await executeTool(user.id, tc.function.name, args);
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

    return json({ reply, actions });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent]", msg);
    return json({ error: msg }, 500);
  }
});
