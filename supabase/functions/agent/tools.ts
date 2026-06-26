import { admin, todayLA } from "../_shared/admin.ts";
import { parseCapture } from "../_shared/nlp.ts";
import { executeVerticalTool, isVerticalTool, VERTICAL_TOOL_DEFINITIONS } from "./verticalTools.ts";

const DEFAULT_DURATION = 30;
const MIRROR_FIELDS = new Set(["start_time", "duration_minutes", "title", "status", "do_date"]);

function fmtLATime(isoUtc: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoUtc));
}

function planningWeekStart(todayIso: string): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDay() === 0) dt.setUTCDate(dt.getUTCDate() + 1);
  const sinceMonday = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - sinceMonday);
  return dt.toISOString().slice(0, 10);
}

interface BigRock {
  id: string;
  title: string;
  win: string;
  initiative_id: string | null;
  project_id?: string | null;
  done_at: string | null;
  roll_count: number;
}

async function getSprintRocks(userId: string): Promise<{ sprintId: string | null; weekStart: string; rocks: BigRock[] }> {
  const weekStart = planningWeekStart(todayLA());
  const { data } = await admin
    .from("sprints")
    .select("id, big_rocks")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  return {
    sprintId: data?.id ?? null,
    weekStart,
    rocks: (data?.big_rocks ?? []) as BigRock[],
  };
}

async function saveSprintRocks(userId: string, weekStart: string, rocks: BigRock[]): Promise<void> {
  const { error } = await admin
    .from("sprints")
    .upsert({ user_id: userId, week_start: weekStart, big_rocks: rocks }, { onConflict: "user_id,week_start" });
  if (error) throw new Error(error.message);
}

export interface AgentAction {
  tool: string;
  summary: string;
}

/** Marquee — drive the client's left canvas (navigate + spotlight) alongside the
 *  reply. The edge is generic: it only relays "point at <target>". The client
 *  owns the surface/where-it-lives mapping (src/lib/marqueeRegistry.ts) and sends
 *  the available targets per request, so the edge never changes as targets grow. */
export interface MarqueeDirective {
  spotlight?: { target: string; ref?: string; label?: string }[];
  caption?: string;
}

export interface MarqueeTargetSpec {
  key: string;
  describe: string;
}

/** Build the `point_at` tool definition from the targets the client sent this
 *  request. The enum + description are derived from live app state, so the
 *  agent's vocabulary is always current — no hardcoded list, no redeploy to add
 *  a target. Falls back to a minimal default when the client sends nothing. */
export function buildPointAtTool(targets: MarqueeTargetSpec[]) {
  const list = targets.length ? targets : [{ key: "priorities", describe: "The week's priorities." }];
  const bullets = list.map((t) => `- "${t.key}": ${t.describe}`).join("\n");
  return {
    type: "function" as const,
    function: {
      name: "point_at",
      description:
        "Show alongside telling. Drive the user's screen: bring the relevant destination forward (a floor, surface, record, or flow) and, where it's a section, hold a spotlight on it — so your answer lands on something visible. Call this when the user asks to SEE, OPEN, or asks ABOUT one of the targets below. Some targets are a specific item (a project, initiative, domain, task) — for those, pass its id as `ref` (use the ids in your context). After calling, answer normally with a real, self-contained reply (the highlight reinforces your words, it doesn't replace them). Use only for a genuine show-me moment, never on every message.\n\nAvailable targets:\n" +
        bullets,
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            enum: list.map((t) => t.key),
            description: "What to bring forward / spotlight.",
          },
          ref: {
            type: "string",
            description: "For a specific-item target (project/initiative/domain/task), the item's id. Omit for general targets.",
          },
          caption: {
            type: "string",
            description: "Optional ≤6-word tag pinned to the highlight, e.g. 'your week, in lights'.",
          },
        },
        required: ["target"],
      },
    },
  };
}

/** Call a sibling edge function. Pass `token` (the user's JWT) for user-scoped
 *  functions like google-events; omit it for internal ones (task-mirror) that
 *  run as the service role. Returns whether the call succeeded. */
async function invokeFn(name: string, body: Record<string, unknown>, token?: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const bearer = token || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[agent] ${name} failed: ${res.status} ${text}`);
    return false;
  }
  return true;
}

async function mirrorTask(taskId: string) {
  await invokeFn("task-mirror", { taskId });
}

async function getTask(userId: string, taskId: string) {
  const { data, error } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error(`Task not found: ${taskId}`);
  return data;
}

async function findTaskByTitle(userId: string, title: string) {
  const q = title.toLowerCase();
  const { data } = await admin
    .from("tasks")
    .select("id, title, status, do_date, start_time")
    .eq("user_id", userId)
    .neq("status", "trashed")
    .ilike("title", `%${title}%`)
    .limit(5);
  return data ?? [];
}

async function resolveLabelIds(userId: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const { data } = await admin.from("labels").select("id, name").eq("user_id", userId);
  const labels = data ?? [];
  return names
    .map((n) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id)
    .filter((id): id is string => Boolean(id));
}

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "create_task",
      description:
        "Create a new task. Use capture for natural language (e.g. 'call David tomorrow 9am 30m #church !high') or explicit fields.",
      parameters: {
        type: "object",
        properties: {
          capture: { type: "string", description: "Natural language task capture string" },
          title: { type: "string" },
          notes: { type: "string" },
          do_date: { type: "string", description: "YYYY-MM-DD" },
          start_time: { type: "string", description: "ISO 8601 timestamp" },
          duration_minutes: { type: "integer" },
          priority: { type: "string", enum: ["none", "low", "medium", "high"] },
          label_names: { type: "array", items: { type: "string" } },
          project_id: { type: "string", description: "Parent project — task lands in backlog" },
          initiative_id: { type: "string", description: "Parent initiative if no project" },
          domain_id: { type: "string", description: "Parent domain if no project/initiative" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "plan_task",
      description: "Plan a task for a day without a time block.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string", description: "Search by title if id unknown" },
          do_date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["do_date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "schedule_task",
      description: "Schedule a task as a time block on the calendar.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
          start_time: { type: "string", description: "ISO 8601 timestamp" },
          duration_minutes: { type: "integer" },
        },
        required: ["start_time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "unschedule_task",
      description: "Remove a task from the calendar but keep it planned for its day.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reschedule_task",
      description: "Move a scheduled task to a new start time and/or duration.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
          start_time: { type: "string", description: "ISO 8601 timestamp" },
          duration_minutes: { type: "integer" },
        },
        required: ["start_time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "complete_task",
      description: "Mark a task as done.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "trash_task",
      description: "Trash a task.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "move_to_inbox",
      description: "Move a task back to inbox, clearing dates and times.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_task",
      description: "Update task fields (title, notes, priority, deadline).",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          task_title: { type: "string" },
          title: { type: "string" },
          notes: { type: "string" },
          priority: { type: "string", enum: ["none", "low", "medium", "high"] },
          deadline: { type: "string", description: "YYYY-MM-DD or null to clear" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reschedule_event",
      description: "Reschedule a Google calendar event (not a Nuvo task block).",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          event_title: { type: "string" },
          start_at: { type: "string", description: "ISO 8601 timestamp" },
          end_at: { type: "string", description: "ISO 8601 timestamp" },
          title: { type: "string" },
        },
        required: ["start_at", "end_at"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_event",
      description:
        "Remove a Google calendar event from the user's calendar (cancel it). For meetings the user organizes this cancels for everyone; for an invite it drops off their calendar. Confirm with the user before calling. Only set notify=true if the user explicitly wants attendees told.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          event_title: { type: "string", description: "Search by title if id unknown" },
          notify: { type: "boolean", description: "Email attendees that it's cancelled. Default false." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "decline_event",
      description:
        "Decline a Google calendar event (RSVP declined) without removing it. Confirm with the user before calling. Only set notify=true if the user wants the organizer told.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          event_title: { type: "string", description: "Search by title if id unknown" },
          notify: { type: "boolean", description: "Tell the organizer you declined. Default false." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_tasks",
      description: "Search tasks by title when you need to find an id.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_priority",
      description: "Add a new weekly priority (big rock) to this week's plan.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The priority's name / outcome statement." },
          win: { type: "string", description: "What winning looks like — the definition of done in one line." },
          initiative_id: { type: "string", description: "The initiative this priority serves (optional)." },
          project_id: { type: "string", description: "The project this priority spotlights (optional)." },
        },
        required: ["title", "win"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_priority",
      description: "Edit a weekly priority's title or win condition.",
      parameters: {
        type: "object",
        properties: {
          priority_id: { type: "string", description: "The priority's id from context." },
          priority_title: { type: "string", description: "Search by title if id unknown." },
          title: { type: "string", description: "New title." },
          win: { type: "string", description: "New win condition." },
          initiative_id: { type: "string", description: "Update the linked initiative (pass null to clear)." },
          project_id: { type: "string", description: "Update the linked project (pass null to clear)." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "complete_priority",
      description: "Mark a weekly priority as done/complete.",
      parameters: {
        type: "object",
        properties: {
          priority_id: { type: "string", description: "The priority's id from context." },
          priority_title: { type: "string", description: "Search by title if id unknown." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_priority",
      description: "Remove a weekly priority from this week's plan.",
      parameters: {
        type: "object",
        properties: {
          priority_id: { type: "string", description: "The priority's id from context." },
          priority_title: { type: "string", description: "Search by title if id unknown." },
        },
      },
    },
  },
  // NOTE: `point_at` is intentionally NOT here — it's built per-request from the
  // targets the client sends (see buildPointAtTool), so its vocabulary is always
  // current. The handler appends it to this list.
  ...VERTICAL_TOOL_DEFINITIONS,
];

async function resolveTaskId(
  userId: string,
  args: { task_id?: string; task_title?: string },
): Promise<{ id: string; title: string }> {
  if (args.task_id) {
    const t = await getTask(userId, args.task_id);
    return { id: t.id, title: t.title };
  }
  if (args.task_title) {
    const matches = await findTaskByTitle(userId, args.task_title);
    if (matches.length === 0) throw new Error(`No task matching "${args.task_title}"`);
    if (matches.length > 1) {
      throw new Error(
        `Multiple tasks match "${args.task_title}": ${matches.map((m) => `"${m.title}" (${m.id})`).join(", ")}. Use task_id.`,
      );
    }
    return { id: matches[0].id, title: matches[0].title };
  }
  throw new Error("Provide task_id or task_title");
}

function localDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function resolveEventId(
  userId: string,
  args: { event_id?: string; event_title?: string },
): Promise<{ id: string; title: string }> {
  if (args.event_id) {
    const { data, error } = await admin
      .from("external_events")
      .select("id, title")
      .eq("id", args.event_id)
      .eq("user_id", userId)
      .single();
    if (error || !data) throw new Error(`Event not found: ${args.event_id}`);
    return { id: data.id, title: data.title };
  }
  if (args.event_title) {
    const { data } = await admin
      .from("external_events")
      .select("id, title")
      .eq("user_id", userId)
      .ilike("title", `%${args.event_title}%`)
      .limit(5);
    if (!data?.length) throw new Error(`No event matching "${args.event_title}"`);
    if (data.length > 1) {
      throw new Error(
        `Multiple events match "${args.event_title}": ${data.map((e) => `"${e.title}" (${e.id})`).join(", ")}. Use event_id.`,
      );
    }
    return { id: data[0].id, title: data[0].title };
  }
  throw new Error("Provide event_id or event_title");
}

function resolvePriority(rocks: BigRock[], args: { priority_id?: string; priority_title?: string }): BigRock {
  if (args.priority_id) {
    const r = rocks.find((x) => x.id === args.priority_id);
    if (!r) throw new Error(`Priority not found: ${args.priority_id}`);
    return r;
  }
  if (args.priority_title) {
    const q = args.priority_title.toLowerCase();
    const matches = rocks.filter((x) => x.title.toLowerCase().includes(q));
    if (matches.length === 0) throw new Error(`No priority matching "${args.priority_title}"`);
    if (matches.length > 1) {
      throw new Error(`Multiple priorities match "${args.priority_title}": ${matches.map((r) => `"${r.title}"`).join(", ")}. Use priority_id.`);
    }
    return matches[0];
  }
  throw new Error("Provide priority_id or priority_title");
}

export async function executeTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
  userToken?: string,
): Promise<{ result: string; action?: AgentAction; ui?: MarqueeDirective }> {
  if (isVerticalTool(name)) return executeVerticalTool(userId, name, args);

  switch (name) {
    case "create_task": {
      let title = args.title as string | undefined;
      let doDate = args.do_date as string | null | undefined;
      let startTime = args.start_time as string | null | undefined;
      let duration = args.duration_minutes as number | null | undefined;
      let priority = (args.priority as string) ?? "none";
      let labelNames = (args.label_names as string[]) ?? [];
      const notes = (args.notes as string) ?? "";

      if (args.capture) {
        const parsed = parseCapture(args.capture as string);
        title = parsed.title || (args.capture as string);
        doDate = doDate ?? parsed.doDate;
        startTime = startTime ?? parsed.startTime?.toISOString() ?? null;
        duration = duration ?? parsed.durationMinutes;
        if (parsed.priority !== "none") priority = parsed.priority;
        labelNames = [...labelNames, ...parsed.labels];
      }

      if (!title?.trim()) throw new Error("Task title is required");

      const projectId = args.project_id as string | undefined;
      let initiativeId = args.initiative_id as string | undefined;
      let domainId = args.domain_id as string | undefined;

      if (projectId) {
        const { data: proj } = await admin
          .from("projects")
          .select("domain_id, initiative_id")
          .eq("id", projectId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!proj) throw new Error(`Project not found: ${projectId}`);
        initiativeId = initiativeId ?? proj.initiative_id ?? undefined;
        domainId = domainId ?? proj.domain_id ?? undefined;
      } else if (initiativeId && !domainId) {
        const { data: init } = await admin
          .from("initiatives")
          .select("domain_id")
          .eq("id", initiativeId)
          .eq("user_id", userId)
          .maybeSingle();
        if (init?.domain_id) domainId = init.domain_id;
      }

      const parented = Boolean(projectId || initiativeId || domainId);

      const status = parented ? "backlog" : doDate ? "planned" : "inbox";
      const dur =
        startTime != null ? (duration ?? DEFAULT_DURATION) : (duration ?? null);

      const { data, error } = await admin
        .from("tasks")
        .insert({
          user_id: userId,
          title: title.trim(),
          notes,
          status,
          do_date: doDate ?? null,
          start_time: startTime ?? null,
          duration_minutes: dur,
          priority,
          project_id: projectId ?? null,
          initiative_id: initiativeId ?? null,
          domain_id: domainId ?? null,
        })
        .select("id, title")
        .single();
      if (error) throw new Error(error.message);

      const labelIds = await resolveLabelIds(userId, labelNames);
      if (labelIds.length) {
        await admin
          .from("task_labels")
          .insert(labelIds.map((label_id) => ({ task_id: data.id, label_id })));
      }

      if (startTime) await mirrorTask(data.id);

      const when = startTime
        ? `scheduled for ${fmtLATime(startTime)}`
        : doDate
          ? `planned for ${doDate}`
          : parented
            ? "added to project backlog"
            : "added to inbox";
      return {
        result: JSON.stringify({ id: data.id, title: data.title, status, doDate, startTime }),
        action: { tool: name, summary: `Created "${data.title}" — ${when}` },
      };
    }

    case "plan_task": {
      const { id, title } = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const doDate = args.do_date as string;
      const { error } = await admin
        .from("tasks")
        .update({ status: "planned", do_date: doDate, start_time: null })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id, doDate }),
        action: { tool: name, summary: `Planned "${title}" for ${doDate}` },
      };
    }

    case "schedule_task": {
      const { id, title } = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const startTime = args.start_time as string;
      const duration = (args.duration_minutes as number) ?? DEFAULT_DURATION;
      const doDate = localDateISO(new Date(startTime));
      const { error } = await admin
        .from("tasks")
        .update({
          status: "planned",
          do_date: doDate,
          start_time: startTime,
          duration_minutes: duration,
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id, startTime, duration }),
        action: {
          tool: name,
          summary: `Scheduled "${title}" for ${fmtLATime(startTime)} (${duration}m)`,
        },
      };
    }

    case "unschedule_task": {
      const { id, title } = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { error } = await admin.from("tasks").update({ start_time: null }).eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id }),
        action: { tool: name, summary: `Unscheduled "${title}" from calendar` },
      };
    }

    case "reschedule_task": {
      const { id, title } = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const startTime = args.start_time as string;
      const patch: Record<string, unknown> = {
        do_date: localDateISO(new Date(startTime)),
        start_time: startTime,
      };
      if (args.duration_minutes != null) patch.duration_minutes = args.duration_minutes;
      const { error } = await admin.from("tasks").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id, ...patch }),
        action: {
          tool: name,
          summary: `Rescheduled "${title}" to ${fmtLATime(startTime)}`,
        },
      };
    }

    case "complete_task": {
      const { id, title } = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { error } = await admin
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id }),
        action: { tool: name, summary: `Completed "${title}"` },
      };
    }

    case "trash_task": {
      const { id, title } = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { error } = await admin.from("tasks").update({ status: "trashed" }).eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id }),
        action: { tool: name, summary: `Trashed "${title}"` },
      };
    }

    case "move_to_inbox": {
      const { id, title } = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { error } = await admin
        .from("tasks")
        .update({ status: "inbox", do_date: null, start_time: null })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id }),
        action: { tool: name, summary: `Moved "${title}" to inbox` },
      };
    }

    case "update_task": {
      const { id, title } = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const patch: Record<string, unknown> = {};
      if (args.title) patch.title = args.title;
      if (args.notes !== undefined) patch.notes = args.notes;
      if (args.priority) patch.priority = args.priority;
      if (args.deadline !== undefined) patch.deadline = args.deadline || null;
      if (!Object.keys(patch).length) throw new Error("No fields to update");
      const { error } = await admin.from("tasks").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      if (Object.keys(patch).some((k) => MIRROR_FIELDS.has(k))) await mirrorTask(id);
      return {
        result: JSON.stringify({ id, patch }),
        action: { tool: name, summary: `Updated "${title}"` },
      };
    }

    case "reschedule_event": {
      let eventId = args.event_id as string | undefined;
      if (!eventId && args.event_title) {
        const { data } = await admin
          .from("external_events")
          .select("id, title")
          .eq("user_id", userId)
          .ilike("title", `%${args.event_title}%`)
          .limit(5);
        if (!data?.length) throw new Error(`No event matching "${args.event_title}"`);
        if (data.length > 1) {
          throw new Error(
            `Multiple events match: ${data.map((e) => `"${e.title}" (${e.id})`).join(", ")}`,
          );
        }
        eventId = data[0].id;
      }
      if (!eventId) throw new Error("Provide event_id or event_title");

      const patch: Record<string, string> = {
        start_at: args.start_at as string,
        end_at: args.end_at as string,
      };
      if (args.title) patch.title = args.title as string;

      const { data: evt, error } = await admin
        .from("external_events")
        .select("id, title, account_id, calendar_accounts(provider)")
        .eq("id", eventId)
        .eq("user_id", userId)
        .single();
      if (error || !evt) throw new Error("Event not found");

      const provider = (evt.calendar_accounts as { provider: string } | null)?.provider;
      if (provider !== "google") throw new Error("Only Google events can be rescheduled");

      const { error: updErr } = await admin.from("external_events").update(patch).eq("id", eventId);
      if (updErr) throw new Error(updErr.message);

      await invokeFn("google-events", { eventId, patch }, userToken);

      return {
        result: JSON.stringify({ id: eventId, patch }),
        action: {
          tool: name,
          summary: `Rescheduled event "${evt.title}" to ${fmtLATime(patch.start_at)}`,
        },
      };
    }

    case "cancel_event": {
      const { id, title } = await resolveEventId(userId, args as { event_id?: string; event_title?: string });
      const ok = await invokeFn(
        "google-events",
        { eventId: id, action: "delete", sendUpdates: args.notify ? "all" : "none" },
        userToken,
      );
      if (!ok) throw new Error(`Couldn't cancel "${title}" — only Google events can be cancelled.`);
      return {
        result: JSON.stringify({ id, cancelled: true }),
        action: { tool: name, summary: `Cancelled "${title}"${args.notify ? " (attendees notified)" : ""}` },
      };
    }

    case "decline_event": {
      const { id, title } = await resolveEventId(userId, args as { event_id?: string; event_title?: string });
      const ok = await invokeFn(
        "google-events",
        { eventId: id, action: "rsvp", responseStatus: "declined", sendNotifications: Boolean(args.notify) },
        userToken,
      );
      if (!ok) throw new Error(`Couldn't decline "${title}" — only Google events can be declined.`);
      return {
        result: JSON.stringify({ id, declined: true }),
        action: { tool: name, summary: `Declined "${title}"${args.notify ? " (organizer notified)" : ""}` },
      };
    }

    case "list_tasks": {
      const matches = await findTaskByTitle(userId, args.query as string);
      return { result: JSON.stringify(matches) };
    }

    case "create_priority": {
      const { weekStart, rocks } = await getSprintRocks(userId);
      const title = (args.title as string)?.trim();
      if (!title) throw new Error("Priority title is required");
      const newRock: BigRock = {
        id: crypto.randomUUID(),
        title,
        win: (args.win as string)?.trim() || "",
        initiative_id: (args.initiative_id as string) ?? null,
        project_id: (args.project_id as string) ?? null,
        done_at: null,
        roll_count: 0,
      };
      await saveSprintRocks(userId, weekStart, [...rocks, newRock]);
      return {
        result: JSON.stringify({ id: newRock.id, title: newRock.title }),
        action: { tool: name, summary: `Added priority "${newRock.title}"` },
      };
    }

    case "update_priority": {
      const { weekStart, rocks } = await getSprintRocks(userId);
      const rock = resolvePriority(rocks, args as { priority_id?: string; priority_title?: string });
      const updated = rocks.map((r) => {
        if (r.id !== rock.id) return r;
        const patch: Partial<BigRock> = {};
        if (args.title) patch.title = (args.title as string).trim();
        if (args.win !== undefined) patch.win = (args.win as string).trim();
        if ("initiative_id" in args) patch.initiative_id = (args.initiative_id as string | null) ?? null;
        if ("project_id" in args) patch.project_id = (args.project_id as string | null) ?? null;
        return { ...r, ...patch };
      });
      await saveSprintRocks(userId, weekStart, updated);
      return {
        result: JSON.stringify({ id: rock.id }),
        action: { tool: name, summary: `Updated priority "${rock.title}"` },
      };
    }

    case "complete_priority": {
      const { weekStart, rocks } = await getSprintRocks(userId);
      const rock = resolvePriority(rocks, args as { priority_id?: string; priority_title?: string });
      const updated = rocks.map((r) =>
        r.id === rock.id ? { ...r, done_at: new Date().toISOString() } : r,
      );
      await saveSprintRocks(userId, weekStart, updated);
      return {
        result: JSON.stringify({ id: rock.id, done: true }),
        action: { tool: name, summary: `Completed priority "${rock.title}"` },
      };
    }

    case "delete_priority": {
      const { weekStart, rocks } = await getSprintRocks(userId);
      const rock = resolvePriority(rocks, args as { priority_id?: string; priority_title?: string });
      await saveSprintRocks(userId, weekStart, rocks.filter((r) => r.id !== rock.id));
      return {
        result: JSON.stringify({ id: rock.id, deleted: true }),
        action: { tool: name, summary: `Removed priority "${rock.title}"` },
      };
    }

    case "point_at": {
      // A UI-only tool: it mutates nothing, it just relays where to point. The
      // tool's enum (built per-request from the client's manifest) already
      // constrained `target` to a real key, so the client resolves the surface.
      const target = String(args.target ?? "");
      if (!target) throw new Error("point_at needs a target");
      const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined;
      const caption =
        typeof args.caption === "string" && args.caption.trim()
          ? args.caption.trim().slice(0, 60)
          : undefined;
      return {
        result: JSON.stringify({ shown: target, ref }),
        ui: { spotlight: [{ target, ref }], caption },
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
