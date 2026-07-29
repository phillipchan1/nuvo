import { admin } from "../_shared/admin.ts";
import { parseCapture } from "../_shared/nlp.ts";
import {
  accountPrimary,
  buildWritableCalendars,
  pickDefaultCalendar,
  type RawCalendarAccount,
  type WritableCal,
} from "./calendars.ts";
import { executeVerticalTool, isVerticalTool, VERTICAL_TOOL_DEFINITIONS } from "./verticalTools.ts";
// The week's rules and the two placement ACTS — shared with the app, so the
// agent's "bring it into the week" is byte-for-byte the UI's.
import {
  bringIntoWeekPatch,
  fromProjectRow,
  planningWeekStart,
  spansWeek,
  takeOffWeekPatch,
  toRowPatch,
} from "../_shared/planningRules.ts";

const DEFAULT_DURATION = 30;
const MIRROR_FIELDS = new Set(["start_time", "duration_minutes", "title", "status", "do_date"]);

/** The zone to fall back on when the client didn't say where it is. The app's
 *  established home — see APP_TZ in src/lib/dates.ts. */
export const FALLBACK_TZ = "America/Los_Angeles";

/**
 * Convert a local datetime string ("YYYY-MM-DDTHH:MM") in `tz` to a UTC ISO
 * string. Done server-side to avoid LLM midnight-rollover errors.
 *
 * `tz` is the CLIENT'S zone, passed in per request — never a constant. The app
 * renders every instant in the device zone ("a 9am block should read as 9am
 * wherever you wake up" — src/lib/timezone.ts), so "3pm" from a user standing in
 * Chicago means 3pm in Chicago. Hardcoding Pacific here silently landed every
 * agent-created block at the wrong hour while traveling.
 */
function localToUtc(localStr: string, tz: string): string {
  // Treat the local string as UTC to get a reference point, then compute
  // the real zone→UTC offset at that approximate moment and apply it.
  const asIfUtc = new Date(localStr + ":00Z");
  const zoned = asIfUtc
    .toLocaleString("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    })
    .replace(", ", "T");
  const offsetMs = asIfUtc.getTime() - new Date(zoned + "Z").getTime();
  return new Date(asIfUtc.getTime() + offsetMs).toISOString();
}

function fmtZonedTime(isoUtc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(isoUtc));
}

/**
 * "Wed Aug 5, 6:30–8:00 PM" — the one sentence a calendar confirmation is
 * allowed to say about time.
 *
 * Every calendar tool returns this alongside the raw ISO, because the model was
 * being handed UTC and asked to narrate a local time: it announced a dinner at
 * "6:30–8:00 PM" over a card that read 5:15, and the user had no way to know
 * which one was on their calendar. The card renders the row; this string is
 * derived from the same row, so prose and card cannot drift apart.
 */
function whenLabel(startIsoUtc: string, endIsoUtc: string | null, tz: string): string {
  const start = new Date(startIsoUtc);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", month: "short", day: "numeric",
  }).format(start);
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  if (!endIsoUtc) return `${day}, ${time(start)}`;
  const end = new Date(endIsoUtc);
  const [sT, eT] = [time(start), time(end)];
  // "6:30–8:00 PM" reads better than "6:30 PM–8:00 PM" when both sit in the
  // same half of the day; keep both meridiems when they differ.
  const sameMeridiem = sT.slice(-2) === eT.slice(-2);
  return `${day}, ${sameMeridiem ? sT.slice(0, -3) : sT}–${eT}`;
}

/** The "YYYY-MM-DDTHH:MM" a tool would have been given for this instant — the
 *  exact round-trip of `localToUtc`, so a result can echo back what it stored. */
function utcToLocal(isoUtc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    // h23, not hour12:false — the latter renders midnight as "24:00" on the
    // previous day in some ICU builds, which reads back as the wrong day.
    hourCycle: "h23",
  })
    .format(new Date(isoUtc))
    .replace(", ", "T");
}

/** Today's calendar date in `tz` — the day the user is actually living. */
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

async function getSprintRocks(userId: string, tz: string): Promise<{ sprintId: string | null; weekStart: string; rocks: BigRock[] }> {
  const weekStart = planningWeekStart(todayIn(tz));
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

// ── the week's slate — a priority IS a project committed to the week ─────────
// The app derives the week's priorities from each project's On Deck span
// (src/lib/priorities.ts); the sprint's big_rocks jsonb only carries the verdict.
// So a priority written as a rock alone is a phantom: it appears nowhere the user
// plans. Every priority write below therefore moves the PROJECT — bringing one in
// writes its span for this week, taking one off clears it — exactly what dragging
// its card onto (or off) this week's column does.

interface ProjectSpanRow {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  target_date: string | null;
}

/** The project a priority tool is aimed at: by id, else by name (fuzzy), else by
 *  the name of a project already on this week's slate. */
async function findProjectForPriority(
  userId: string,
  weekStart: string,
  args: { project_id?: string; priority_title?: string; title?: string },
): Promise<ProjectSpanRow | null> {
  const { data } = await admin
    .from("projects")
    .select("id, name, status, start_date, target_date")
    .eq("user_id", userId)
    .not("status", "in", "(cancelled,dropped)");
  const rows = (data ?? []) as ProjectSpanRow[];
  if (args.project_id) return rows.find((p) => p.id === args.project_id) ?? null;

  const q = (args.priority_title ?? args.title ?? "").trim().toLowerCase();
  if (!q) return null;
  const byName = rows.filter((p) => p.name.toLowerCase().includes(q) || q.includes(p.name.toLowerCase()));
  if (byName.length === 1) return byName[0];
  // ambiguous by name — prefer one already committed to this week
  const onSlate = byName.filter((p) => spansWeek(fromProjectRow(p), weekStart));
  return onSlate.length === 1 ? onSlate[0] : null;
}

/** Commit a project to the planning week (the "bring it in" write). The patch is
 *  the kernel's — the same object the Priorities editor and the phone's slate
 *  apply — so this tool cannot place a project differently than a tap does.
 *  Returns the project's name when it actually moved, so the reply can say so. */
async function bringProjectIntoWeek(userId: string, weekStart: string, p: ProjectSpanRow): Promise<string | null> {
  const patch = bringIntoWeekPatch(fromProjectRow(p), weekStart);
  if (!patch) return null; // already this week's
  const { error } = await admin.from("projects").update(toRowPatch(patch)).eq("user_id", userId).eq("id", p.id);
  if (error) throw new Error(error.message);
  return p.name;
}

/** Take a project off this week — back to "needs a sprint", same as dragging its
 *  card off the board. Only touches a project actually committed to this week. */
async function pushProjectOutOfWeek(userId: string, weekStart: string, p: ProjectSpanRow): Promise<string | null> {
  if (!spansWeek(fromProjectRow(p), weekStart)) return null;
  const { error } = await admin
    .from("projects")
    .update(toRowPatch(takeOffWeekPatch()))
    .eq("user_id", userId)
    .eq("id", p.id);
  if (error) throw new Error(error.message);
  return p.name;
}

async function saveSprintRocks(userId: string, weekStart: string, rocks: BigRock[]): Promise<void> {
  const { error } = await admin
    .from("sprints")
    .upsert({ user_id: userId, week_start: weekStart, big_rocks: rocks }, { onConflict: "user_id,week_start" });
  if (error) throw new Error(error.message);
}

/** What an action DID to the record — drives the card's ribbon, not its layout. */
export type AgentVerb =
  | "created"
  | "slotted"
  | "moved"
  | "updated"
  | "done"
  | "trashed"
  | "unslotted";

/** A pointer to the row an action touched. The edge never serializes the record
 *  itself: the client renders it from its live cache, so a card scrolled back to
 *  an hour later shows what's true NOW, not what was true at reply time. */
export interface AgentRef {
  kind: "task" | "event" | "priority";
  id: string;
}

/** The inverse of an action, small enough to send and safe to apply blind.
 *  Undo lives on the card because the card is the only surface that still knows
 *  a trashed record existed — and because an agent that writes without a visible
 *  reverse is one the user learns not to trust with a big batch. */
export type AgentUndo =
  | { kind: "task"; patch: Record<string, unknown> }
  | { kind: "priority"; id: string; restore: BigRock | null };

export interface AgentAction {
  tool: string;
  /** Always populated — the card degrades to this line when the ref can't render. */
  summary: string;
  verb?: AgentVerb;
  ref?: AgentRef;
  undo?: AgentUndo;
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
        "Show alongside telling. Drive the user's screen: bring the relevant destination forward (a floor, surface, record, or flow) and, where it's a section, hold a spotlight on it — so your answer lands on something visible. **Default to calling this whenever your answer is ABOUT one of the targets below — a data answer counts, not just an explicit 'show me' / 'open'.** Some targets are a specific item (a project, initiative, domain, task) — for those, pass its id as `ref` (use the ids in your context). After calling, answer normally with a real, self-contained reply (the highlight reinforces your words, it doesn't replace them). Skip it only for pure confirmations, chit-chat, or answers with no on-screen home — and don't re-surface the same target twice in a row.\n\nAvailable targets:\n" +
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
  return (await invokeFnJson(name, body, token)) !== null;
}

/** invokeFn, but hands back the parsed response instead of just "did it work".
 *  Some functions already return the row they wrote (google-events upserts into
 *  external_events and returns it) — that id is what lets an action carry a ref
 *  and render as a card instead of a receipt line. */
async function invokeFnJson(
  name: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<Record<string, unknown> | null> {
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
    return null;
  }
  // A body that isn't JSON still means the call succeeded — don't fail the tool
  // over it; the caller just won't get a ref.
  return await res.json().catch(() => ({}));
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
          start_time: { type: "string", description: "The user's own local wall clock (their zone is named at the top of the snapshot): 'YYYY-MM-DDTHH:MM' (24h, no offset, no Z). Server converts to UTC." },
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
          start_time: { type: "string", description: "The user's own local wall clock (their zone is named at the top of the snapshot): 'YYYY-MM-DDTHH:MM' (24h, no offset, no Z). Server converts to UTC." },
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
          start_time: { type: "string", description: "The user's own local wall clock (their zone is named at the top of the snapshot): 'YYYY-MM-DDTHH:MM' (24h, no offset, no Z). Server converts to UTC." },
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
      name: "move_event",
      description:
        "Put an EXISTING event on a different calendar: 'put it on Family', 'apple family', 'switch to Work', 'move to …'. Pass event_id from the event you just created, or event_title. A cross-account move copies then deletes the original.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "Event id from context / prior create action when known." },
          event_title: { type: "string", description: "Search by title if id unknown." },
          calendar_name: {
            type: "string",
            description:
              "Destination the user named — a calendar from writableCalendars ('Family', 'apple family calendar') or an account ('phil@frontierchurch.com').",
          },
        },
        required: ["calendar_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_calendar_event",
      description:
        "Create a NEW calendar event (Google or Apple/iCloud) — an event that does not exist yet. To change one that does, use move_event / reschedule_event / cancel_event.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title." },
          start_local: {
            type: "string",
            description:
              "Start in the user's own local time (the zone named at the top of the snapshot) — 'YYYY-MM-DDTHH:MM' (24h, no offset). Example: Tuesday Jun 30 at 5pm → '2026-06-30T17:00'. The server handles UTC conversion; never shift the stated time yourself.",
          },
          end_local: {
            type: "string",
            description: "End in the user's own local time — 'YYYY-MM-DDTHH:MM' (24h, no offset).",
          },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Email addresses of attendees to invite (optional; Google only).",
          },
          calendar_name: {
            type: "string",
            description:
              "The destination the user NAMED, verbatim — a display name from writableCalendars ('Family', 'Apple Family') or an account ('phil@frontierchurch.com'). Matched loosely server-side. Omit entirely when they named none; the server routes to their default.",
          },
          location: { type: "string", description: "Optional location." },
        },
        required: ["title", "start_local", "end_local"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reschedule_event",
      description:
        "Change an EXISTING calendar event's day, time or title — Google and Apple/iCloud alike (not a Nuvo task block). This is how you fix an event you just created when the user corrects you ('next Wednesday not tomorrow', '6:30 not 5'): move the one you made, never add a second. Pass event_id from your own create action when you have it.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "Event id from context or a prior create/move action." },
          event_title: { type: "string", description: "Search by title if id unknown." },
          start_local: {
            type: "string",
            description:
              "New start in the user's local time — 'YYYY-MM-DDTHH:MM' (24h, no offset). The server converts to UTC. Omit to keep the current start.",
          },
          end_local: {
            type: "string",
            description:
              "New end in the user's local time — 'YYYY-MM-DDTHH:MM'. Omit when only the start moves and the length is unchanged; the server keeps the duration.",
          },
          title: { type: "string", description: "New title, when the correction is to the name." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_event",
      description:
        "Remove a calendar event from the user's calendar (cancel it) — Google and Apple/iCloud alike, including one you just created. For meetings the user organizes this cancels for everyone; for an invite it drops off their calendar. Confirm with the user before calling. Only set notify=true if the user explicitly wants attendees told.",
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
      description: "Set a priority for this week. A priority IS a project committed to the week, so this brings the project onto this week's slate (writes its sprint span, Mon–Fri) — pass project_id whenever one matches. Without a project it only leaves a note on the week and will not show on the week's plan.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The priority's name / outcome statement." },
          win: { type: "string", description: "What winning looks like — the definition of done in one line." },
          initiative_id: { type: "string", description: "The initiative this priority serves (optional)." },
          project_id: { type: "string", description: "The project being committed to this week — use an id from weekSlate / needsASprint / vertical.projects. Strongly preferred: this is what puts the priority on the week." },
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
      description: "Mark a weekly priority as landed. Works for a priority that has no stored record yet — pass the project's id or name and it records the verdict for this week.",
      parameters: {
        type: "object",
        properties: {
          priority_id: { type: "string", description: "The priority's id from weekSlate.priorityId / weekPriorities, when it has one." },
          priority_title: { type: "string", description: "The priority or project name, if no id." },
          project_id: { type: "string", description: "The slate project's id — use this when the priority has no stored id." },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_priority",
      description: "Take a priority off this week. Because a priority IS a project committed to the week, this clears that project's week span — the project goes back to \"needs a sprint\" with its work intact. Nothing is deleted.",
      parameters: {
        type: "object",
        properties: {
          priority_id: { type: "string", description: "The priority's id from weekSlate.priorityId / weekPriorities, when it has one." },
          priority_title: { type: "string", description: "The priority or project name, if no id." },
          project_id: { type: "string", description: "The slate project's id — use this when the priority has no stored id." },
        },
      },
    },
  },
  // NOTE: `point_at` is intentionally NOT here — it's built per-request from the
  // targets the client sends (see buildPointAtTool), so its vocabulary is always
  // current. The handler appends it to this list.
  ...VERTICAL_TOOL_DEFINITIONS,
];

type TaskRow = Record<string, unknown> & { id: string; title: string };

/** Resolve the task an action names — and hand back the row as it stands BEFORE
 *  the write, which is what every undo patch is built from. */
async function resolveTaskId(
  userId: string,
  args: { task_id?: string; task_title?: string },
): Promise<TaskRow> {
  if (args.task_id) return (await getTask(userId, args.task_id)) as TaskRow;
  if (args.task_title) {
    const matches = await findTaskByTitle(userId, args.task_title);
    if (matches.length === 0) throw new Error(`No task matching "${args.task_title}"`);
    if (matches.length > 1) {
      throw new Error(
        `Multiple tasks match "${args.task_title}": ${matches.map((m) => `"${m.title}" (${m.id})`).join(", ")}. Use task_id.`,
      );
    }
    return (await getTask(userId, matches[0].id)) as TaskRow;
  }
  throw new Error("Provide task_id or task_title");
}

/** The inverse of a write: the touched fields as they were. Undoing is then one
 *  blind `update` on the client — no re-derivation, no second guess at intent. */
function undoTask(before: TaskRow, ...fields: string[]): AgentUndo {
  const patch: Record<string, unknown> = {};
  for (const f of fields) patch[f] = before[f] ?? null;
  return { kind: "task", patch };
}

/** The calendar date an instant falls on in `tz` — the user's day, not the
 *  server's. Deno runs in UTC, so deriving this from the server clock put an
 *  evening block on tomorrow's date. */
function dateInTz(isoUtc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoUtc));
}

/** An event the agent is about to write to — resolved WITH its provider, because
 *  which function can edit it is a property of the row, not of the caller's
 *  hopes. Cancel used to assume Google and told the user their own brand-new
 *  Apple event was "on a non-Google calendar" and therefore unremovable. */
interface ResolvedEvent {
  id: string;
  title: string;
  provider: string;
  start_at: string;
  end_at: string;
}

const EVENT_REF_COLS = "id, title, start_at, end_at, calendar_accounts(provider)";

function asResolved(row: Record<string, unknown>): ResolvedEvent {
  return {
    id: row.id as string,
    title: row.title as string,
    provider: (row.calendar_accounts as { provider: string } | null)?.provider ?? "google",
    start_at: row.start_at as string,
    end_at: row.end_at as string,
  };
}

async function resolveEventId(
  userId: string,
  args: { event_id?: string; event_title?: string },
): Promise<ResolvedEvent> {
  if (args.event_id) {
    const { data, error } = await admin
      .from("external_events")
      .select(EVENT_REF_COLS)
      .eq("id", args.event_id)
      .eq("user_id", userId)
      .single();
    if (error || !data) throw new Error(`Event not found: ${args.event_id}`);
    return asResolved(data);
  }
  if (args.event_title) {
    const { data } = await admin
      .from("external_events")
      .select(EVENT_REF_COLS)
      .eq("user_id", userId)
      .ilike("title", `%${args.event_title}%`)
      .limit(5);
    if (!data?.length) throw new Error(`No event matching "${args.event_title}"`);
    if (data.length > 1) {
      throw new Error(
        `Multiple events match "${args.event_title}": ${data.map((e) => `"${e.title}" (${e.id})`).join(", ")}. Use event_id.`,
      );
    }
    return asResolved(data[0]);
  }
  throw new Error("Provide event_id or event_title");
}

function eventsFnFor(provider: string): "google-events" | "icloud-events" {
  return provider === "icloud" ? "icloud-events" : "google-events";
}

/** Both writable providers, in the words the user uses. Anything else (M365) is
 *  read-only, and saying so beats a generic failure. */
function assertWritableProvider(provider: string, verb: string, title: string): void {
  if (provider === "google" || provider === "icloud") return;
  throw new Error(
    `"${title}" is on a ${provider === "m365" ? "Microsoft" : provider} calendar, which Nuvo can read but not write — ${verb} it in that app.`,
  );
}

/** Every writable calendar, hidden ones included and flagged. The hidden ones
 *  are here so an explicitly named calendar still resolves — never so one can
 *  be picked by default. See agent/calendars.ts. */
async function loadWritableCalendars(userId: string): Promise<WritableCal[]> {
  const [accountsRes, settingsRes] = await Promise.all([
    admin
      .from("calendar_accounts")
      .select("id, provider, email, sync_direction, calendars")
      .eq("user_id", userId),
    admin
      .from("user_settings")
      .select("hidden_calendar_ids, default_calendar_account_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  return buildWritableCalendars(
    (accountsRes.data ?? []) as RawCalendarAccount[],
    (settingsRes.data?.hidden_calendar_ids as string[] | null) ?? [],
    (settingsRes.data?.default_calendar_account_id as string | null) ?? null,
  );
}

/** Match a phrase against connected ACCOUNTS ("phil@frontierchurch.com", "my
 *  frontierchurch account", "gmail"), not calendar names. Returns that account's
 *  primary calendar — or, if the phrase also names one of its calendars, that
 *  one. Null when the phrase points at no account, or at more than one. */
function resolveAccountRef(cals: WritableCal[], q: string): WritableCal | null {
  const emails = [...new Set(cals.map((c) => c.accountEmail.toLowerCase()))];
  const hit = emails.filter((e) => {
    if (q.includes(e)) return true;
    const [local, domain] = e.split("@");
    const org = domain?.split(".")[0] ?? "";
    // "frontierchurch" / "phillipchan1" — the part a person actually says out
    // loud. Two chars is a false-positive machine, so require some length.
    return (
      (org.length >= 4 && new RegExp(`\\b${escapeRe(org)}\\b`).test(q)) ||
      (local.length >= 4 && new RegExp(`\\b${escapeRe(local)}\\b`).test(q))
    );
  });
  if (hit.length !== 1) return null;

  const mine = cals.filter((c) => c.accountEmail.toLowerCase() === hit[0]);
  // "the Family calendar on my iCloud account" — the account narrows it, the
  // rest picks within it.
  const residual = q.replace(hit[0], " ").replace(/\b(account|calendar|cal|my|on|the)\b/g, " ").trim();
  if (residual) {
    const named = mine.filter((c) => {
      const n = c.name.toLowerCase();
      return n === residual || n.includes(residual) || residual.includes(n);
    });
    if (named.length === 1) return named[0];
  }
  return accountPrimary(cals, mine[0].accountId) ?? null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fuzzy-match a user phrase ("apple family calendar", "phil@frontierchurch.com")
 *  to a writable calendar. Hidden calendars match here — naming one is the user
 *  deciding, which is exactly when a hidden calendar is a legitimate target. */
function resolveCalendarByName(cals: WritableCal[], query: string): WritableCal {
  const q = query.trim().toLowerCase();
  if (!q) throw new Error("calendar_name is required");
  if (!cals.length) throw new Error("No writable calendars connected");

  // An ACCOUNT, not a calendar — "phil@frontierchurch.com", "my frontierchurch
  // account". The user naming an account outranks any stored default: they said
  // where it goes. Resolves to that account's primary unless they also named a
  // calendar inside it.
  const byAccount = resolveAccountRef(cals, q);
  if (byAccount) return byAccount;

  const prefersApple = /\b(apple|icloud|family)\b/.test(q);
  const prefersGoogle = /\bgoogle\b/.test(q);
  // Strip provider words so "apple family calendar" still matches a cal named "Family".
  const nameQ = q
    .replace(/\b(apple|icloud|google|calendar|cal)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const score = (c: WritableCal): number => {
    const name = c.name.toLowerCase();
    let s = 0;
    if (name === q || name === nameQ) s += 100;
    else if (nameQ && (name.includes(nameQ) || nameQ.includes(name))) s += 60;
    else if (name.includes(q) || q.includes(name)) s += 40;
    else return 0;
    if (prefersApple && c.provider === "icloud") s += 25;
    if (prefersGoogle && c.provider === "google") s += 25;
    // "family" alone → prefer a calendar literally named Family on iCloud.
    if (/\bfamily\b/.test(q) && name.includes("family") && c.provider === "icloud") s += 15;
    // Two calendars answer to the same phrase and one is hidden: the one still
    // on the board is what the user meant. Breaks the tie instead of erroring.
    if (!c.hidden) s += 1;
    return s;
  };

  const ranked = cals
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (!ranked.length) {
    const names = cals.map((c) => `"${c.name}" (${c.provider})`).join(", ");
    throw new Error(`No calendar matching "${query}". Writable calendars: ${names}`);
  }
  if (ranked.length > 1 && ranked[0].s === ranked[1].s) {
    throw new Error(
      `Multiple calendars match "${query}": ${ranked
        .filter((x) => x.s === ranked[0].s)
        .map((x) => `"${x.c.name}" (${x.c.provider})`)
        .join(", ")}. Be more specific.`,
    );
  }
  return ranked[0].c;
}

/** Display name for a calendar_id within an account (falls back to provider). */
function calendarLabel(cals: WritableCal[], accountId: string, calendarId: string, provider: string): string {
  const hit = cals.find((c) => c.accountId === accountId && c.calendarId === calendarId);
  if (hit) return hit.name;
  return provider === "icloud" ? "Apple Calendar" : "Google Calendar";
}

type EventRow = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  account_id: string;
  calendar_id: string;
  raw: unknown;
  calendar_accounts: { provider: string } | null;
};

/** Find an existing event with the same title whose start is within ±5 minutes.
 *  Guards against the model re-creating instead of moving. Prefer a row that
 *  is NOT already on `preferOffTarget` so a prior duplicate can still be cleaned up. */
async function findNearDuplicate(
  userId: string,
  title: string,
  startAt: string,
  preferOffTarget?: WritableCal | null,
): Promise<EventRow | null> {
  const startMs = new Date(startAt).getTime();
  if (!Number.isFinite(startMs)) return null;
  const windowMs = 5 * 60_000;
  const from = new Date(startMs - windowMs).toISOString();
  const to = new Date(startMs + windowMs).toISOString();

  const pick = (rows: EventRow[]): EventRow | null => {
    if (!rows.length) return null;
    if (preferOffTarget) {
      const off = rows.find(
        (r) =>
          !(r.account_id === preferOffTarget.accountId && r.calendar_id === preferOffTarget.calendarId),
      );
      if (off) return off;
    }
    return rows[0];
  };

  const { data } = await admin
    .from("external_events")
    .select("id, title, start_at, end_at, location, account_id, calendar_id, raw, calendar_accounts(provider)")
    .eq("user_id", userId)
    .ilike("title", title)
    .gte("start_at", from)
    .lte("start_at", to)
    .limit(8);
  const exact = pick((data ?? []) as EventRow[]);
  if (exact) return exact;

  // Looser title match (partial) — slight variants of the same event.
  const { data: loose } = await admin
    .from("external_events")
    .select("id, title, start_at, end_at, location, account_id, calendar_id, raw, calendar_accounts(provider)")
    .eq("user_id", userId)
    .ilike("title", `%${title}%`)
    .gte("start_at", from)
    .lte("start_at", to)
    .limit(8);
  return pick((loose ?? []) as EventRow[]);
}

/**
 * The same event, somewhere else on the calendar — a title match within ±14
 * days that is NOT the row we're about to write.
 *
 * The near-duplicate check above only sees a re-create at the *same* time, so it
 * never fires on the shape that actually bit: the model put a dinner on the
 * wrong day, the user corrected the day, and the model answered the correction
 * with a second create a week later. Two dinners, and the confirmation mentioned
 * only one. This can't decide which the user wants — a fortnightly standing
 * dinner is a real thing — so it doesn't block the write; it hands the twin back
 * in the result, and the prompt requires the reply to raise it.
 */
async function findLooseDuplicate(
  userId: string,
  title: string,
  startAt: string,
  excludeId?: string,
): Promise<EventRow | null> {
  const startMs = new Date(startAt).getTime();
  if (!Number.isFinite(startMs)) return null;
  const windowMs = 14 * 86_400_000;
  const { data } = await admin
    .from("external_events")
    .select("id, title, start_at, end_at, location, account_id, calendar_id, raw, calendar_accounts(provider)")
    .eq("user_id", userId)
    .ilike("title", title)
    .gte("start_at", new Date(startMs - windowMs).toISOString())
    .lte("start_at", new Date(startMs + windowMs).toISOString())
    .limit(8);
  return ((data ?? []) as EventRow[]).find((r) => r.id !== excludeId) ?? null;
}

/** Move (or copy+delete across accounts) an event onto a target calendar. */
async function moveEventToTarget(
  userId: string,
  evt: EventRow,
  target: WritableCal,
  tz: string,
  userToken?: string,
): Promise<{ result: string; action: AgentAction }> {
  const sourceProvider =
    evt.calendar_accounts?.provider ?? "google";
  if (sourceProvider !== "google" && sourceProvider !== "icloud") {
    throw new Error(`Can't move events from ${sourceProvider} — only Google and Apple calendars are writable.`);
  }
  const when = whenLabel(evt.start_at, evt.end_at, tz);

  if (target.accountId === evt.account_id && target.calendarId === evt.calendar_id) {
    return {
      result: JSON.stringify({ id: evt.id, alreadyOn: target.name, calendar: target.name, when }),
      action: {
        tool: "move_event",
        summary: `"${evt.title}" is already on ${target.name}`,
        verb: "moved",
        ref: { kind: "event", id: evt.id },
      },
    };
  }

  if (target.accountId === evt.account_id) {
    const ok = await invokeFn(
      eventsFnFor(sourceProvider),
      { action: "move", eventId: evt.id, calendarId: target.calendarId },
      userToken,
    );
    if (!ok) throw new Error(`Couldn't move "${evt.title}" to ${target.name}`);
    return {
      result: JSON.stringify({ id: evt.id, calendar: target.name, provider: target.provider, when }),
      action: {
        tool: "move_event",
        summary: `Moved "${evt.title}" to ${target.name}`,
        verb: "moved",
        ref: { kind: "event", id: evt.id },
      },
    };
  }

  const description =
    ((evt.raw as { description?: string } | null)?.description as string | undefined) ??
    undefined;
  const created = await invokeFnJson(
    eventsFnFor(target.provider),
    {
      action: "create",
      title: evt.title,
      start_at: evt.start_at,
      end_at: evt.end_at,
      accountId: target.accountId,
      calendarId: target.calendarId,
      ...(evt.location ? { location: evt.location } : {}),
      ...(description ? { description } : {}),
    },
    userToken,
  );
  if (!created) throw new Error(`Couldn't create "${evt.title}" on ${target.name}`);
  const newId = (created.event as { id?: string } | null)?.id;

  const deleted = await invokeFn(
    eventsFnFor(sourceProvider),
    { action: "delete", eventId: evt.id, scope: "THIS", sendUpdates: "none" },
    userToken,
  );
  if (!deleted) {
    throw new Error(
      `Created "${evt.title}" on ${target.name}, but couldn't remove the original — you may have a duplicate.`,
    );
  }

  return {
    result: JSON.stringify({
      from: sourceProvider,
      to: target.name,
      calendar: target.name,
      provider: target.provider,
      id: newId ?? null,
      when,
    }),
    action: {
      tool: "move_event",
      summary: `Moved "${evt.title}" to ${target.name}`,
      verb: "moved",
      ...(newId ? { ref: { kind: "event" as const, id: newId } } : {}),
    },
  };
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
  /** The zone the CLIENT is in — every user-stated time is read in it, and every
   *  time we narrate back is written in it. Defaults to the app's home zone when
   *  an older client doesn't send one. */
  tz: string = FALLBACK_TZ,
): Promise<{ result: string; action?: AgentAction; ui?: MarqueeDirective }> {
  if (isVerticalTool(name)) return executeVerticalTool(userId, name, args);

  switch (name) {
    case "create_task": {
      let title = args.title as string | undefined;
      let doDate = args.do_date as string | null | undefined;
      let startTimeRaw = args.start_time as string | null | undefined;
      let duration = args.duration_minutes as number | null | undefined;
      let priority = (args.priority as string) ?? "none";
      let labelNames = (args.label_names as string[]) ?? [];
      const notes = (args.notes as string) ?? "";

      if (args.capture) {
        const parsed = parseCapture(args.capture as string);
        title = parsed.title || (args.capture as string);
        doDate = doDate ?? parsed.doDate;
        startTimeRaw = startTimeRaw ?? parsed.startTime?.toISOString() ?? null;
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

      // Convert local LA time to UTC if the LLM passed "YYYY-MM-DDTHH:MM" format.
      const startTime =
        startTimeRaw && !startTimeRaw.includes("Z") && !startTimeRaw.includes("+")
          ? localToUtc(startTimeRaw, tz)
          : (startTimeRaw ?? null);

      // A task with a scheduled date/time is always "planned" — never backlog —
      // so it surfaces in Today and the calendar regardless of parent assignment.
      const status = doDate ? "planned" : parented ? "backlog" : "inbox";
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
        ? `scheduled for ${fmtZonedTime(startTime, tz)}`
        : doDate
          ? `planned for ${doDate}`
          : parented
            ? "added to project backlog"
            : "added to inbox";
      return {
        result: JSON.stringify({ id: data.id, title: data.title, status, doDate, startTime }),
        action: {
          tool: name,
          summary: `Created "${data.title}" — ${when}`,
          verb: "created",
          ref: { kind: "task", id: data.id },
          // Undoing a create trashes it rather than hard-deleting: "trashed" IS
          // deleted app-wide, and it stays recoverable from the tombstone card.
          undo: { kind: "task", patch: { status: "trashed" } },
        },
      };
    }

    case "plan_task": {
      const before = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { id, title } = before;
      const doDate = args.do_date as string;
      const { error } = await admin
        .from("tasks")
        .update({ status: "planned", do_date: doDate, start_time: null })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id, doDate }),
        action: {
          tool: name,
          summary: `Planned "${title}" for ${doDate}`,
          verb: "slotted",
          ref: { kind: "task", id },
          undo: undoTask(before, "status", "do_date", "start_time"),
        },
      };
    }

    case "schedule_task": {
      const before = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { id, title } = before;
      const startTimeRaw = args.start_time as string;
      const startTime =
        startTimeRaw && !startTimeRaw.includes("Z") && !startTimeRaw.includes("+")
          ? localToUtc(startTimeRaw, tz)
          : startTimeRaw;
      const duration = (args.duration_minutes as number) ?? DEFAULT_DURATION;
      const doDate = dateInTz(startTime, tz);
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
          summary: `Scheduled "${title}" for ${fmtZonedTime(startTime, tz)} (${duration}m)`,
          verb: "slotted",
          ref: { kind: "task", id },
          undo: undoTask(before, "status", "do_date", "start_time", "duration_minutes"),
        },
      };
    }

    case "unschedule_task": {
      const before = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { id, title } = before;
      const { error } = await admin.from("tasks").update({ start_time: null }).eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id }),
        action: {
          tool: name,
          summary: `Unscheduled "${title}" from calendar`,
          verb: "unslotted",
          ref: { kind: "task", id },
          undo: undoTask(before, "start_time"),
        },
      };
    }

    case "reschedule_task": {
      const before = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { id, title } = before;
      const startTimeRaw = args.start_time as string;
      const startTime =
        startTimeRaw && !startTimeRaw.includes("Z") && !startTimeRaw.includes("+")
          ? localToUtc(startTimeRaw, tz)
          : startTimeRaw;
      const patch: Record<string, unknown> = {
        do_date: dateInTz(startTime, tz),
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
          summary: `Rescheduled "${title}" to ${fmtZonedTime(startTime, tz)}`,
          verb: "moved",
          ref: { kind: "task", id },
          undo: undoTask(before, "do_date", "start_time", "duration_minutes"),
        },
      };
    }

    case "complete_task": {
      const before = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { id, title } = before;
      const { error } = await admin
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id }),
        action: {
          tool: name,
          summary: `Completed "${title}"`,
          verb: "done",
          ref: { kind: "task", id },
          undo: undoTask(before, "status", "completed_at"),
        },
      };
    }

    case "trash_task": {
      const before = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { id, title } = before;
      const { error } = await admin.from("tasks").update({ status: "trashed" }).eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id }),
        action: {
          tool: name,
          summary: `Trashed "${title}"`,
          verb: "trashed",
          ref: { kind: "task", id },
          undo: undoTask(before, "status"),
        },
      };
    }

    case "move_to_inbox": {
      const before = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { id, title } = before;
      const { error } = await admin
        .from("tasks")
        .update({ status: "inbox", do_date: null, start_time: null })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id);
      return {
        result: JSON.stringify({ id }),
        action: {
          tool: name,
          summary: `Moved "${title}" to inbox`,
          verb: "moved",
          ref: { kind: "task", id },
          undo: undoTask(before, "status", "do_date", "start_time"),
        },
      };
    }

    case "update_task": {
      const before = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { id, title } = before;
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
        action: {
          tool: name,
          summary: `Updated "${title}"`,
          verb: "updated",
          ref: { kind: "task", id },
          undo: undoTask(before, ...Object.keys(patch)),
        },
      };
    }

    case "create_calendar_event": {
      const title = (args.title as string)?.trim();
      const attendees = (args.attendees as string[] | undefined) ?? [];
      if (!title) throw new Error("title is required");

      const startLocal = args.start_local as string;
      const endLocal = args.end_local as string;
      if (!startLocal || !endLocal) throw new Error("start_local and end_local are required");

      const start_at = localToUtc(startLocal, tz);
      const end_at = localToUtc(endLocal, tz);
      const location = (args.location as string | undefined)?.trim() || undefined;

      const writable = await loadWritableCalendars(userId);
      let target: WritableCal | null = null;
      const calendarName = (args.calendar_name as string | undefined)?.trim();
      if (calendarName) {
        target = resolveCalendarByName(writable, calendarName);
      } else {
        // Unnamed → the user's default. Never a hidden calendar, never "first
        // row wins": that's how "Call with Tiffany Souers" landed on Women's.
        target = pickDefaultCalendar(writable);
      }

      // Safety net: the model often re-creates instead of moving. If the same
      // title already sits at this time, relocate (or no-op) instead of duplicating.
      const existing = await findNearDuplicate(userId, title, start_at, target);
      if (existing) {
        if (target) {
          return moveEventToTarget(userId, existing, target, tz, userToken);
        }
        const provider = existing.calendar_accounts?.provider ?? "google";
        const where = calendarLabel(writable, existing.account_id, existing.calendar_id, provider);
        return {
          result: JSON.stringify({
            alreadyExists: true,
            id: existing.id,
            calendar: where,
            title: existing.title,
            when: whenLabel(existing.start_at, existing.end_at, tz),
          }),
          action: {
            tool: name,
            summary: `"${existing.title}" is already on ${where}`,
            verb: "moved",
            ref: { kind: "event", id: existing.id },
          },
        };
      }

      if (!target) {
        throw new Error(
          writable.length
            ? "Every writable calendar is hidden — ask which one this should go on, then pass calendar_name."
            : "No writable calendar connected",
        );
      }

      const provider = target.provider;
      const fn = eventsFnFor(provider);
      const res = await invokeFnJson(
        fn,
        {
          action: "create",
          title,
          start_at,
          end_at,
          ...(location ? { location } : {}),
          ...(attendees.length && provider === "google" ? { attendees } : {}),
          accountId: target.accountId,
          calendarId: target.calendarId,
        },
        userToken,
      );
      if (!res) {
        throw new Error(`Failed to create event on "${target.name}" — is that ${provider} account connected?`);
      }

      const eventId = (res.event as { id?: string } | null)?.id;
      // The same title already sitting a few days either side is usually the
      // wrong-day version of THIS event, corrected. Hand it back so the reply
      // has to account for both instead of confirming one and stranding the other.
      const twin = await findLooseDuplicate(userId, title, start_at, eventId);
      const when = whenLabel(start_at, end_at, tz);
      return {
        result: JSON.stringify({
          created: true,
          title,
          when,
          start_local: utcToLocal(start_at, tz),
          end_local: utcToLocal(end_at, tz),
          start_at,
          calendar: target.name,
          account: target.accountEmail,
          isDefault: target.isDefault,
          provider,
          ...(twin
            ? {
                possibleDuplicate: {
                  id: twin.id,
                  title: twin.title,
                  when: whenLabel(twin.start_at, twin.end_at, tz),
                  calendar: calendarLabel(
                    writable,
                    twin.account_id,
                    twin.calendar_id,
                    twin.calendar_accounts?.provider ?? "google",
                  ),
                  note:
                    "Same title, nearby day — if this is the version the user just corrected, tell them it's still there and offer to remove it.",
                },
              }
            : {}),
        }),
        action: {
          tool: name,
          summary: `Added "${title}" to ${target.name} on ${when}`,
          verb: "created",
          ...(eventId ? { ref: { kind: "event" as const, id: eventId } } : {}),
        },
      };
    }

    case "move_event": {
      const calendarName = (args.calendar_name as string)?.trim();
      if (!calendarName) throw new Error("calendar_name is required");

      let eventId = args.event_id as string | undefined;
      if (!eventId) {
        const resolved = await resolveEventId(userId, {
          event_id: args.event_id as string | undefined,
          event_title: args.event_title as string | undefined,
        });
        eventId = resolved.id;
      }

      const { data: evt, error } = await admin
        .from("external_events")
        .select("id, title, start_at, end_at, location, account_id, calendar_id, raw, calendar_accounts(provider)")
        .eq("id", eventId)
        .eq("user_id", userId)
        .single();
      if (error || !evt) throw new Error(`Event not found: ${eventId}`);

      const target = resolveCalendarByName(await loadWritableCalendars(userId), calendarName);
      return moveEventToTarget(userId, evt as EventRow, target, tz, userToken);
    }

    case "reschedule_event": {
      const evt = await resolveEventId(userId, args as { event_id?: string; event_title?: string });
      // Apple events reschedule over CalDAV exactly as Google ones do over the
      // API — this used to hard-fail on anything non-Google, which meant a
      // corrected dinner on Family could only be fixed by adding a second one.
      assertWritableProvider(evt.provider, "reschedule", evt.title);

      // Local wall-clock is the contract everywhere else in this file; the old
      // ISO-only signature made the model do its own zone math to call it.
      const startLocal = args.start_local as string | undefined;
      const endLocal = args.end_local as string | undefined;
      const start_at = startLocal ? localToUtc(startLocal, tz) : (args.start_at as string | undefined);
      const end_at = endLocal ? localToUtc(endLocal, tz) : (args.end_at as string | undefined);
      const title = (args.title as string | undefined)?.trim();
      if (!start_at && !end_at && !title) {
        throw new Error("Nothing to change — pass start_local/end_local, or a new title.");
      }

      // Keep the duration when only one edge moved, so "make it 7" doesn't
      // silently stretch or crush the event.
      const durationMs = new Date(evt.end_at).getTime() - new Date(evt.start_at).getTime();
      const nextStart = start_at ?? evt.start_at;
      const nextEnd = end_at ?? (start_at ? new Date(new Date(start_at).getTime() + durationMs).toISOString() : evt.end_at);

      const patch: Record<string, string> = { start_at: nextStart, end_at: nextEnd };
      if (title) patch.title = title;

      const ok = await invokeFn(eventsFnFor(evt.provider), { eventId: evt.id, patch, scope: "THIS" }, userToken);
      if (!ok) throw new Error(`Couldn't reschedule "${evt.title}" — the write to ${evt.provider} failed.`);
      // Mirror locally AFTER the provider write, not before: google-events only
      // refreshes `raw` on a patch, so without this the card in the transcript
      // shows the old time until the next sync — and writing it first would zero
      // the delta the series path measures against the stored start.
      const { error: mirrorErr } = await admin.from("external_events").update(patch).eq("id", evt.id);
      if (mirrorErr) throw new Error(mirrorErr.message);
      const when = whenLabel(nextStart, nextEnd, tz);

      return {
        result: JSON.stringify({
          id: evt.id,
          title: title ?? evt.title,
          when,
          start_local: utcToLocal(nextStart, tz),
          end_local: utcToLocal(nextEnd, tz),
          rescheduled: true,
          provider: evt.provider,
        }),
        action: {
          tool: name,
          summary: `Moved "${title ?? evt.title}" to ${when}`,
          verb: "moved",
          ref: { kind: "event", id: evt.id },
          // No undo on calendar writes: reversing means another round-trip to
          // the provider (and possibly re-notifying attendees). The card shows
          // the event; reversing it is a fresh instruction, not a one-tap.
        },
      };
    }

    case "cancel_event": {
      const { id, title, provider, start_at, end_at } = await resolveEventId(
        userId,
        args as { event_id?: string; event_title?: string },
      );
      assertWritableProvider(provider, "cancel", title);
      const when = whenLabel(start_at, end_at, tz);
      const ok = await invokeFn(
        eventsFnFor(provider),
        {
          eventId: id,
          action: "delete",
          scope: "THIS",
          // sendUpdates only — google-events reads it to decide whether guests
          // are told, and its own organizer-aware default stays intact.
          sendUpdates: args.notify ? "all" : "none",
        },
        userToken,
      );
      if (!ok) throw new Error(`Couldn't cancel "${title}" — the delete on ${provider} failed.`);
      return {
        result: JSON.stringify({ id, title, when, cancelled: true, provider }),
        action: { tool: name, summary: `Cancelled "${title}" (${when})${args.notify ? " — attendees notified" : ""}` },
      };
    }

    case "decline_event": {
      const { id, title, provider } = await resolveEventId(userId, args as { event_id?: string; event_title?: string });
      if (provider !== "google") {
        throw new Error(`RSVP only works on Google events — "${title}" is on ${provider}. Cancel it instead to take it off the calendar.`);
      }
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
      const { weekStart, rocks } = await getSprintRocks(userId, tz);
      const title = (args.title as string)?.trim();
      if (!title) throw new Error("Priority title is required");
      // Naming a priority = bringing its project into the week. Without this the
      // rock is a phantom: the week's own surfaces derive the slate from project
      // spans, so a rock with no committed project shows up nowhere.
      const project = await findProjectForPriority(userId, weekStart, args as { project_id?: string; title?: string });
      const brought = project ? await bringProjectIntoWeek(userId, weekStart, project) : null;
      const existing = project ? rocks.find((r) => r.project_id === project.id) ?? null : null;
      if (existing) {
        return {
          result: JSON.stringify({ id: existing.id, title: existing.title, alreadyOnSlate: project!.name, weekStart }),
          action: {
            tool: name,
            summary: brought
              ? `Brought "${brought}" into this week`
              : `"${project!.name}" is already this week's`,
            verb: brought ? "slotted" : "updated",
            ref: { kind: "priority", id: existing.id },
          },
        };
      }
      const newRock: BigRock = {
        id: crypto.randomUUID(),
        title,
        win: (args.win as string)?.trim() || "",
        initiative_id: (args.initiative_id as string) ?? null,
        project_id: project?.id ?? (args.project_id as string) ?? null,
        done_at: null,
        roll_count: 0,
      };
      await saveSprintRocks(userId, weekStart, [...rocks, newRock]);
      return {
        result: JSON.stringify({
          id: newRock.id,
          title: newRock.title,
          projectId: newRock.project_id,
          broughtIntoWeek: brought,
          weekStart,
          note: newRock.project_id
            ? undefined
            : "No project matched, so this priority is a note on the week only — it will not appear on the week's slate. Offer to create a project for it.",
        }),
        action: {
          tool: name,
          summary: brought ? `Brought "${brought}" into this week` : `Added priority "${newRock.title}"`,
          verb: brought ? "slotted" : "created",
          ref: { kind: "priority", id: newRock.id },
          undo: { kind: "priority", id: newRock.id, restore: null },
        },
      };
    }

    case "update_priority": {
      const { weekStart, rocks } = await getSprintRocks(userId, tz);
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
        action: {
          tool: name,
          summary: `Updated priority "${rock.title}"`,
          verb: "updated",
          ref: { kind: "priority", id: rock.id },
          undo: { kind: "priority", id: rock.id, restore: rock },
        },
      };
    }

    case "complete_priority": {
      const { weekStart, rocks } = await getSprintRocks(userId, tz);
      // Most of the week's priorities have no stored rock yet — they're derived
      // from the project's span, and the rock is written the first time a verdict
      // is recorded. So checking one off may have to create it.
      const known = rocks.find(
        (r) =>
          r.id === args.priority_id ||
          (args.priority_title != null && r.title.toLowerCase().includes(String(args.priority_title).toLowerCase())),
      );
      if (!known) {
        const project = await findProjectForPriority(userId, weekStart, args as { project_id?: string; priority_title?: string });
        if (project && spansWeek(fromProjectRow(project), weekStart)) {
          const landed: BigRock = {
            id: crypto.randomUUID(),
            title: project.name,
            win: "",
            initiative_id: null,
            project_id: project.id,
            done_at: new Date().toISOString(),
            roll_count: 0,
          };
          await saveSprintRocks(userId, weekStart, [...rocks, landed]);
          return {
            result: JSON.stringify({ id: landed.id, done: true, project: project.name }),
            action: {
              tool: name,
              summary: `Marked "${project.name}" landed this week`,
              verb: "done",
              ref: { kind: "priority", id: landed.id },
              undo: { kind: "priority", id: landed.id, restore: null },
            },
          };
        }
      }
      const rock = resolvePriority(rocks, args as { priority_id?: string; priority_title?: string });
      const updated = rocks.map((r) =>
        r.id === rock.id ? { ...r, done_at: new Date().toISOString() } : r,
      );
      await saveSprintRocks(userId, weekStart, updated);
      return {
        result: JSON.stringify({ id: rock.id, done: true }),
        action: {
          tool: name,
          summary: `Completed priority "${rock.title}"`,
          verb: "done",
          ref: { kind: "priority", id: rock.id },
          undo: { kind: "priority", id: rock.id, restore: rock },
        },
      };
    }

    case "delete_priority": {
      const { weekStart, rocks } = await getSprintRocks(userId, tz);
      const known = rocks.find(
        (r) =>
          r.id === args.priority_id ||
          (args.priority_title != null && r.title.toLowerCase().includes(String(args.priority_title).toLowerCase())),
      );
      // Taking a priority off the week is taking its PROJECT off the week — the
      // span goes back to "needs a sprint", same as dragging its card off the deck.
      const project = await findProjectForPriority(
        userId,
        weekStart,
        { project_id: (args.project_id as string) ?? known?.project_id ?? undefined, priority_title: args.priority_title as string | undefined },
      );
      const pushedOut = project ? await pushProjectOutOfWeek(userId, weekStart, project) : null;
      if (!known && pushedOut) {
        return {
          result: JSON.stringify({ pushedOutOfWeek: pushedOut, weekStart }),
          action: { tool: name, summary: `Took "${pushedOut}" off this week`, verb: "unslotted" },
        };
      }
      const rock = resolvePriority(rocks, args as { priority_id?: string; priority_title?: string });
      await saveSprintRocks(userId, weekStart, rocks.filter((r) => r.id !== rock.id));
      return {
        result: JSON.stringify({ id: rock.id, deleted: true, pushedOutOfWeek: pushedOut }),
        action: {
          tool: name,
          summary: pushedOut ? `Took "${pushedOut}" off this week` : `Removed priority "${rock.title}"`,
          verb: "trashed",
          // The rock is gone from the sprint — the card carries the only copy
          // left, which is exactly why it renders from `restore` and not a ref.
          ref: { kind: "priority", id: rock.id },
          undo: { kind: "priority", id: rock.id, restore: rock },
        },
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
