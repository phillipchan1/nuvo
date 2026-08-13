import { admin } from "../_shared/admin.ts";
import { parseCapture } from "../_shared/nlp.ts";
// One rule for "how big is this block", shared with the Schedule's multi-drop —
// see docs/planning-kernel.md §3.
import { sizeSlotToCount } from "../_shared/slotSizing.ts";
import {
  accountPrimary,
  buildWritableCalendars,
  pickDefaultCalendar,
  type RawCalendarAccount,
  type WritableCal,
} from "./calendars.ts";
import { executeVerticalTool } from "./verticalTools.ts";
// The vocabulary lives in toolDefs.ts (pure data, importable outside Deno);
// this file is the behavior behind it. Re-exported so existing callers and
// the edge handler keep one import site.
import { isVerticalTool, type MarqueeDirective } from "./toolDefs.ts";
import { targetError } from "./toolGuards.ts";
import { INVITE_GUESTS_STAGED_NOTE, INVITE_STAGED_NOTE, inviteNote } from "./toolNotes.ts";
import { checkConfirmation } from "./confirmDestructive.ts";
export { buildPointAtTool, TOOL_DEFINITIONS } from "./toolDefs.ts";
export type { MarqueeDirective, MarqueeTargetSpec } from "./toolDefs.ts";
// The week's rules and the two placement ACTS — shared with the app, so the
// agent's "bring it into the week" is byte-for-byte the UI's.
import {
  bringIntoWeekPatch,
  dayOfWeek,
  fromProjectRow,
  planningWeekStart,
  spansWeek,
  takeOffWeekPatch,
  toRowPatch,
  dayMs,
  isoOf,
} from "../_shared/planningRules.ts";
import {
  describeRule,
  expandRule,
  HORIZON_DAYS,
  nextOccurrenceDate,
  toGoogleRRULE,
  type RecurrenceFreq,
  type RecurrenceRule,
} from "../_shared/recurrence.ts";
import { hasConference, shouldAddMeet } from "../_shared/conferencing.ts";
// One reminder vocabulary for the app and the chat — the leads the picker
// offers are the leads the chat may set, and both read them from here.
import {
  defaultLeadFor,
  describeLead,
  normalizeReminderPrefs,
  parseLead,
  reminderKey,
  REMINDER_LEADS,
  type ReminderAnchorKind,
  type ReminderTargetKind,
} from "../_shared/reminderRules.ts";
import { resolveRecipients, searchContacts } from "../_shared/contacts.ts";
// Staging an invite is the agent's half of D-046: it resolves who, and stops.
// The send is a tap on the card, through the client's own mutation.
import { supportsGuests, type InviteDraft } from "../_shared/invites.ts";

const DEFAULT_DURATION = 30;
const MIRROR_FIELDS = new Set(["start_time", "duration_minutes", "title", "status", "do_date"]);
const DAY_MS = 86_400_000;

function addDaysISO(iso: string, days: number): string {
  return isoOf(dayMs(iso) + days * DAY_MS);
}

async function createRecurringTaskSeries(
  userId: string,
  opts: {
    title: string;
    rule: RecurrenceRule;
    anchorISO: string;
    projectId?: string | null;
    initiativeId?: string | null;
    domainId?: string | null;
    duration?: number;
    priority?: string;
  },
) {
  const {
    title,
    rule,
    anchorISO,
    projectId,
    initiativeId,
    domainId,
    duration = DEFAULT_DURATION,
    priority = "none",
  } = opts;

  const { data: rec, error: recErr } = await admin
    .from("recurrences")
    .insert({
      user_id: userId,
      kind: "task",
      freq: rule.freq,
      interval: Math.max(1, rule.interval || 1),
      byweekday: rule.byweekday ?? [],
      bymonthday: rule.bymonthday ?? null,
      bysetpos: rule.bysetpos ?? null,
      bymonth: rule.bymonth ?? null,
      anchor_date: anchorISO,
      until_date: rule.until ?? null,
      max_count: rule.count ?? null,
      title: title.trim(),
      duration_minutes: duration,
      time_of_day_minutes: null,
      project_id: projectId ?? null,
      domain_id: domainId ?? null,
      priority,
    })
    .select("id")
    .single();
  if (recErr) throw new Error(recErr.message);

  const toISO = addDaysISO(anchorISO, HORIZON_DAYS);
  const dates = expandRule(rule, anchorISO, anchorISO, toISO, []);
  if (dates.length) {
    const rows = dates.map((d) => ({
      user_id: userId,
      title: title.trim(),
      status: "planned" as const,
      do_date: d,
      start_time: null,
      duration_minutes: duration,
      priority,
      project_id: projectId ?? null,
      initiative_id: initiativeId ?? null,
      domain_id: domainId ?? null,
      recurrence_id: rec.id,
      recurrence_date: d,
    }));
    const { error: taskErr } = await admin.from("tasks").insert(rows);
    if (taskErr && taskErr.code !== "23505") throw new Error(taskErr.message);
    await admin.from("recurrences").update({ last_materialized: toISO }).eq("id", rec.id);
  }

  const cadence = describeRule(rule, anchorISO);
  const nextDue = nextOccurrenceDate(rule, anchorISO, addDaysISO(anchorISO, 1), []);
  return { id: rec.id, cadence, nextDue, firstDue: dates[0] ?? anchorISO };
}

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
  kind: "task" | "event" | "priority" | "slot";
  id: string;
}

/** The inverse of an action, small enough to send and safe to apply blind.
 *  Undo lives on the card because the card is the only surface that still knows
 *  a trashed record existed — and because an agent that writes without a visible
 *  reverse is one the user learns not to trust with a big batch. */
export type AgentUndo =
  | { kind: "task"; patch: Record<string, unknown> }
  | { kind: "priority"; id: string; restore: BigRock | null }
  // Releasing a block is the inverse of holding one; the tasks it held are
  // named so undo can put them back inside rather than leaving them loose.
  | { kind: "slot"; patch: Record<string, unknown> }
  | { kind: "slot-delete"; id: string; childIds: string[] };

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

/**
 * Push a task's mirrored Google block.
 *
 * `tz` matters: the mirror used to stamp a hardcoded `America/Los_Angeles` on
 * every user's block. It now takes the zone from the request, and the agent's
 * requests carry the DEVICE's zone (D-082) — so a block the chat creates and a
 * block a tap creates render identically on the native calendar.
 */
async function mirrorTask(taskId: string, tz?: string) {
  await invokeFn("task-mirror", tz ? { taskId, tz } : { taskId });
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

/**
 * Resolve a task IN THE TRASH.
 *
 * Separate from `resolveTaskId` on purpose: that one searches live tasks, and a
 * trashed row is deliberately invisible to it. Searching the wrong pool would
 * make "restore the thing I deleted" fail with "no such task" while the task sat
 * right there — and, worse, could point `purge_task` at a live one.
 */
async function resolveTrashedTask(
  userId: string,
  args: Record<string, unknown>,
): Promise<{ id: string; title: string; project_id: string | null; initiative_id: string | null; domain_id: string | null; sprint_id: string | null }> {
  const cols = "id, title, project_id, initiative_id, domain_id, sprint_id";
  const a = args as { task_id?: string; task_title?: string };
  if (a.task_id) {
    const { data } = await admin
      .from("tasks")
      .select(cols)
      .eq("id", a.task_id)
      .eq("user_id", userId)
      .eq("status", "trashed")
      .maybeSingle();
    if (!data) throw new Error(`No trashed task with id ${a.task_id}. It may not be deleted at all.`);
    return data as Awaited<ReturnType<typeof resolveTrashedTask>>;
  }
  if (a.task_title) {
    const { data } = await admin
      .from("tasks")
      .select(cols)
      .eq("user_id", userId)
      .eq("status", "trashed")
      .ilike("title", `%${a.task_title}%`)
      .limit(5);
    const rows = (data ?? []) as { id: string; title: string }[];
    if (rows.length === 0) throw new Error(`Nothing in the trash matches "${a.task_title}".`);
    if (rows.length > 1) {
      throw new Error(
        `Several trashed tasks match "${a.task_title}": ${rows.map((r) => `"${r.title}" (${r.id})`).join(", ")}. Use task_id.`,
      );
    }
    return rows[0] as Awaited<ReturnType<typeof resolveTrashedTask>>;
  }
  throw new Error("Provide task_id or task_title — look it up with list_trashed_tasks.");
}

// ── reminders ───────────────────────────────────────────────────────────────

interface ReminderTarget {
  kind: ReminderTargetKind;
  anchor: ReminderAnchorKind;
  /** tasks.id / slots.id — null for an event. */
  id: string | null;
  /** `account_id:provider_event_id` — the resync-stable key for an event. */
  eventKey: string | null;
  title: string;
}

/**
 * Which thing the user meant. Exactly one target may be named — "remind me
 * about the standup" is ambiguous when it is both a task and a meeting, and
 * guessing would set the reminder on the wrong one silently.
 */
async function resolveReminderTarget(
  userId: string,
  args: Record<string, unknown>,
): Promise<ReminderTarget> {
  const a = args as {
    task_id?: string;
    task_title?: string;
    event_id?: string;
    event_title?: string;
    slot_id?: string;
    anchor?: string;
  };
  const named = [
    a.task_id || a.task_title ? "task" : null,
    a.event_id || a.event_title ? "event" : null,
    a.slot_id ? "slot" : null,
  ].filter(Boolean);
  if (named.length === 0) throw new Error("Name what to remind about: a task, an event, or a slot.");
  if (named.length > 1) {
    throw new Error(`Name only one target — you named ${named.join(" and ")}.`);
  }
  const anchor: ReminderAnchorKind = a.anchor === "deadline" ? "deadline" : "start";

  if (named[0] === "task") {
    const t = await resolveTaskId(userId, a);
    if (anchor === "deadline" && !t.deadline) {
      throw new Error(`"${t.title}" has no deadline to remind about. Set one first, or use anchor "start".`);
    }
    if (anchor === "start" && !t.start_time) {
      throw new Error(`"${t.title}" isn't scheduled, so there is no start to be early for. Schedule it first.`);
    }
    return { kind: "task", anchor, id: t.id, eventKey: null, title: t.title };
  }

  if (named[0] === "slot") {
    const { data, error } = await admin
      .from("slots")
      .select("id, title")
      .eq("id", a.slot_id!)
      .eq("user_id", userId)
      .single();
    if (error || !data) throw new Error(`Slot not found: ${a.slot_id}`);
    return { kind: "slot", anchor: "start", id: data.id, eventKey: null, title: data.title || "Block" };
  }

  const ev = await resolveEventId(userId, a);
  const { data, error } = await admin
    .from("external_events")
    .select("account_id, provider_event_id, title")
    .eq("id", ev.id)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error(`Event not found: ${ev.id}`);
  return {
    kind: "event",
    anchor: "start",
    id: null,
    // Keyed by the provider, not the mirror row: a resync renumbers
    // external_events.id and would orphan the reminder.
    eventKey: `${data.account_id}:${data.provider_event_id}`,
    title: data.title || ev.title,
  };
}

/** The existing override for a target, if any — the upsert's read half. */
async function findReminderRow(
  userId: string,
  target: ReminderTarget,
): Promise<{ id: string; lead_minutes: number | null } | null> {
  let q = admin
    .from("reminders")
    .select("id, lead_minutes")
    .eq("user_id", userId)
    .eq("target_kind", target.kind)
    .eq("anchor", target.anchor);
  q = target.kind === "event" ? q.eq("event_key", target.eventKey!) : q.eq("target_id", target.id!);
  const { data } = await q.maybeSingle();
  return (data as { id: string; lead_minutes: number | null } | null) ?? null;
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
/** Wall-clock time of an instant in `tz` ("2:30 PM") — the other half of
 *  `dateInTz`, and for the same reason: Deno runs in UTC. */
function localTimeInTz(isoUtc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoUtc));
}

function dateInTz(isoUtc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoUtc));
}

// ── slots ───────────────────────────────────────────────────────────────────

interface SlotRow {
  id: string;
  title: string;
  do_date: string;
  start_time: string;
  duration_minutes: number;
  google_event_id: string | null;
}

/** The block an action names. By id when the model read it out of context;
 *  otherwise by title, and an ambiguous title is an error rather than a guess —
 *  moving the wrong block silently rearranges someone's morning. */
async function resolveSlot(
  userId: string,
  args: { slot_id?: string; slot_title?: string },
): Promise<SlotRow> {
  const cols = "id, title, do_date, start_time, duration_minutes, google_event_id";
  if (args.slot_id) {
    const { data, error } = await admin
      .from("slots")
      .select(cols)
      .eq("id", args.slot_id)
      .eq("user_id", userId)
      .single();
    if (error || !data) throw new Error(`Slot not found: ${args.slot_id}`);
    return data as SlotRow;
  }
  if (args.slot_title) {
    const { data } = await admin
      .from("slots")
      .select(cols)
      .eq("user_id", userId)
      .ilike("title", `%${args.slot_title}%`)
      .order("start_time")
      .limit(5);
    if (!data?.length) throw new Error(`No block matching "${args.slot_title}"`);
    if (data.length > 1) {
      throw new Error(
        `Multiple blocks match "${args.slot_title}": ${data.map((s) => `"${s.title}"`).join(", ")}. Use slot_id.`,
      );
    }
    return data[0] as SlotRow;
  }
  throw new Error("Provide slot_id or slot_title");
}

interface SlotTaskInput {
  title: string;
  duration_minutes?: number;
  notes?: string;
}

/** Tolerate the two shapes models actually emit for a list of work: objects,
 *  or bare strings. A malformed item is dropped, not thrown — the block is
 *  still the right answer even if one line came through wrong. */
function normalizeSlotTasks(raw: unknown): SlotTaskInput[] {
  if (!Array.isArray(raw)) return [];
  const out: SlotTaskInput[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ title: item.trim() });
    } else if (item && typeof item === "object") {
      const t = String((item as Record<string, unknown>).title ?? "").trim();
      if (!t) continue;
      const d = (item as Record<string, unknown>).duration_minutes;
      const n = (item as Record<string, unknown>).notes;
      out.push({
        title: t,
        duration_minutes: typeof d === "number" ? d : undefined,
        notes: typeof n === "string" ? n : undefined,
      });
    }
  }
  return out;
}

/** Put work inside a block: existing tasks move in, new ones are created there.
 *  Either way the task loses its own start_time — the block IS the time — and
 *  takes the block's day. */
async function fillSlot(
  userId: string,
  slotId: string,
  doDate: string,
  newTasks: SlotTaskInput[],
  taskIds: string[],
): Promise<{ id: string; title: string }[]> {
  const placed: { id: string; title: string }[] = [];

  if (taskIds.length) {
    const { data, error } = await admin
      .from("tasks")
      .update({ slot_id: slotId, do_date: doDate, start_time: null, status: "planned" })
      .in("id", taskIds)
      .eq("user_id", userId)
      .select("id, title");
    if (error) throw new Error(error.message);
    for (const t of data ?? []) {
      placed.push({ id: t.id as string, title: t.title as string });
      // The task no longer holds its own block on Google — the slot does.
      await mirrorTask(t.id as string);
    }
  }

  if (newTasks.length) {
    const { data, error } = await admin
      .from("tasks")
      .insert(
        newTasks.map((t, i) => ({
          user_id: userId,
          title: t.title,
          notes: t.notes ?? "",
          status: "planned",
          do_date: doDate,
          start_time: null,
          duration_minutes: t.duration_minutes ?? DEFAULT_DURATION,
          slot_id: slotId,
          sort_order: i,
        })),
      )
      .select("id, title");
    if (error) throw new Error(error.message);
    for (const t of data ?? []) placed.push({ id: t.id as string, title: t.title as string });
  }

  return placed;
}

/**
 * Which edge function owns write-back for an event — the agent's copy of the
 * app's `eventsFunctionFor`. Google and Apple/iCloud are both writable; M365
 * and subscriptions are not, and saying so by name beats a generic failure.
 */
async function eventsFunctionForEvent(userId: string, eventId: string): Promise<string> {
  const { data } = await admin
    .from("external_events")
    .select("account_id")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  const accountId = (data as { account_id?: string } | null)?.account_id;
  if (!accountId) return "google-events";
  const { data: acct } = await admin
    .from("calendar_accounts")
    .select("provider")
    .eq("id", accountId)
    .maybeSingle();
  const provider = (acct as { provider?: string } | null)?.provider;
  if (provider === "icloud") return "icloud-events";
  if (provider === "m365" || provider === "ics") {
    throw new Error(
      provider === "ics"
        ? "That's a subscribed calendar — it's read-only, so it can't be answered or changed from here."
        : "Microsoft 365 calendars are read-only in Nuvo, so this has to be done in Outlook.",
    );
  }
  return "google-events";
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

function eventsFnFor(provider: string): "google-events" | "icloud-events" {
  return provider === "icloud" ? "icloud-events" : "google-events";
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

/** Move (or copy+delete across accounts) an event onto a target calendar. */
async function moveEventToTarget(
  userId: string,
  evt: EventRow,
  target: WritableCal,
  userToken?: string,
): Promise<{ result: string; action: AgentAction }> {
  const sourceProvider =
    evt.calendar_accounts?.provider ?? "google";
  if (sourceProvider !== "google" && sourceProvider !== "icloud") {
    throw new Error(`Can't move events from ${sourceProvider} — only Google and Apple calendars are writable.`);
  }

  if (target.accountId === evt.account_id && target.calendarId === evt.calendar_id) {
    return {
      result: JSON.stringify({ id: evt.id, alreadyOn: target.name, calendar: target.name }),
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
      result: JSON.stringify({ id: evt.id, calendar: target.name, provider: target.provider }),
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

/** The account's standing answer to "does a meeting get a video link". */
async function meetPreference(userId: string): Promise<unknown> {
  const { data } = await admin
    .from("user_settings")
    .select("auto_add_meet")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.auto_add_meet;
}

type RawAttendee = { email?: string };

/** `args.recurrence` (RECURRENCE_PARAM_SCHEMA's shape, toolDefs.ts) → a
 *  RecurrenceRule, or undefined when the model didn't ask for a series.
 *  `byweekday` defaults to the anchor's own weekday, same as the calendar
 *  UI's repeat presets (`presetsFor` in _shared/recurrence.ts). */
function recurrenceRuleFromArgs(args: Record<string, unknown>, startLocal: string): RecurrenceRule | undefined {
  const raw = args.recurrence as
    | { freq?: string; interval?: number; byweekday?: number[]; count?: number; until?: string }
    | undefined;
  if (!raw?.freq) return undefined;
  const freq = raw.freq as RecurrenceFreq;
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly") return undefined;
  const rule: RecurrenceRule = { freq, interval: Math.max(1, raw.interval || 1) };
  if (freq === "weekly") {
    rule.byweekday = raw.byweekday?.length ? raw.byweekday : [dayOfWeek(startLocal.slice(0, 10))];
  }
  if (raw.count) rule.count = Math.max(1, raw.count);
  else if (raw.until) rule.until = raw.until;
  return rule;
}

/**
 * Stage an invite — resolve who, work out where and when, send nothing.
 *
 * This is the only path in the agent that may involve another human, and it
 * deliberately dead-ends in a draft. The model gets back a description it can
 * narrate; the client gets a card with the recipients named and two explicit
 * ways forward (D-046). If the model never mentions the card, the worst case is
 * a confirmation the user didn't expect — not mail they didn't authorize.
 */
async function stageInvite(
  userId: string,
  args: Record<string, unknown>,
  tz: string,
): Promise<{ result: string; invite?: InviteDraft }> {
  const tokens = (args.attendees as string[] | undefined ?? []).map((t) => String(t)).filter(Boolean);
  if (!tokens.length) throw new Error("Nobody to invite — pass attendees (names or addresses).");

  const { recipients, unresolved } = await resolveRecipients(userId, tokens);

  // Nobody resolved — a card with no recipients is a Send button over an empty
  // list. Hand the question back instead; the model asks, the user answers, and
  // we stage on the next turn.
  if (!recipients.length) {
    return {
      result: JSON.stringify({
        staged: false,
        unresolved,
        note:
          "Nothing staged — none of these names resolved to exactly one person. Ask the user: name each one and offer its candidates in a <suggestions> block, or ask for the address if there are none. Never guess.",
      }),
    };
  }

  // Adding to an event that already exists — named outright, or found sitting at
  // the time the model was about to book. "Invite Matt to Friday lunch" when
  // Friday lunch is already on the calendar is one act, not a duplicate event.
  let existing: EventRow | null = null;
  if (args.event_id || args.event_title) {
    const { id } = await resolveEventId(userId, args as { event_id?: string; event_title?: string });
    const { data } = await admin
      .from("external_events")
      .select("id, title, start_at, end_at, location, account_id, calendar_id, raw, calendar_accounts(provider)")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    existing = (data as EventRow | null) ?? null;
    if (!existing) throw new Error("Event not found");
  }

  const title = (args.title as string | undefined)?.trim();
  const startLocal = args.start_local as string | undefined;
  const endLocal = args.end_local as string | undefined;

  if (!existing && title && startLocal) {
    existing = await findNearDuplicate(userId, title, localToUtc(startLocal, tz));
  }

  const writable = await loadWritableCalendars(userId);

  if (existing) {
    const provider = existing.calendar_accounts?.provider ?? "google";
    if (!supportsGuests(provider)) {
      throw new Error(
        `"${existing.title}" is on an Apple calendar, and Apple calendars can't carry guests — Google only. Offer to move it to a Google calendar first; don't create it without them.`,
      );
    }
    const raw = (existing.raw ?? {}) as { attendees?: RawAttendee[] };
    const already = new Set((raw.attendees ?? []).map((a) => (a.email ?? "").toLowerCase()).filter(Boolean));
    const fresh = recipients.filter((r) => !already.has(r.email));
    const onIt = recipients.filter((r) => already.has(r.email));

    if (!fresh.length) {
      return {
        result: JSON.stringify({
          staged: false,
          alreadyInvited: onIt.map((r) => r.name ?? r.email),
          event: existing.title,
          unresolved,
          note: "Everyone named is already on this event. Say so — nothing was staged or sent.",
        }),
      };
    }

    const invite: InviteDraft = {
      mode: "add_guests",
      eventId: existing.id,
      title: existing.title,
      startAt: existing.start_at,
      endAt: existing.end_at,
      recipients: fresh,
      calendarName: calendarLabel(writable, existing.account_id, existing.calendar_id, provider),
      ...(existing.location ? { location: existing.location } : {}),
      // Whether the invite carries a link is a fact about the event, not a
      // choice being made now — say only what's true.
      addMeet: hasConference(existing.raw as Parameters<typeof hasConference>[0]),
      ...(unresolved.length ? { unresolved } : {}),
    };

    return {
      result: JSON.stringify({
        staged: true,
        mode: "add_guests",
        event: existing.title,
        when: fmtZonedTime(existing.start_at, tz),
        recipients: fresh.map((r) => r.name ?? r.email),
        alreadyOnIt: onIt.map((r) => r.name ?? r.email),
        unresolved,
        note: inviteNote(INVITE_GUESTS_STAGED_NOTE, unresolved.length),
      }),
      invite,
    };
  }

  // New event.
  if (!title) throw new Error("title is required for a new event");
  if (!startLocal || !endLocal) throw new Error("start_local and end_local are required for a new event");

  const calendarName = (args.calendar_name as string | undefined)?.trim();
  const target = calendarName ? resolveCalendarByName(writable, calendarName) : pickDefaultCalendar(writable);
  if (!target) {
    throw new Error(
      writable.length
        ? "Every writable calendar is hidden — ask which one this should go on, then pass calendar_name."
        : "No writable calendar connected",
    );
  }
  if (!supportsGuests(target.provider)) {
    throw new Error(
      `"${target.name}" is an Apple calendar and can't carry guests — Nuvo can only invite people on a Google calendar. Ask which Google calendar to use; don't silently drop the guests.`,
    );
  }

  const addMeet =
    typeof args.add_meet === "boolean"
      ? (args.add_meet as boolean)
      : shouldAddMeet(await meetPreference(userId), recipients.length);

  const recurrenceRule = recurrenceRuleFromArgs(args, startLocal);
  const recurrence = recurrenceRule ? toGoogleRRULE(recurrenceRule) : undefined;

  const invite: InviteDraft = {
    mode: "create",
    title,
    startAt: localToUtc(startLocal, tz),
    endAt: localToUtc(endLocal, tz),
    recipients,
    calendarName: target.name,
    accountEmail: target.accountEmail,
    accountId: target.accountId,
    calendarId: target.calendarId,
    ...(args.location ? { location: String(args.location) } : {}),
    addMeet,
    ...(recurrence ? { recurrence } : {}),
    ...(unresolved.length ? { unresolved } : {}),
  };

  return {
    result: JSON.stringify({
      staged: true,
      mode: "create",
      title,
      when: fmtZonedTime(invite.startAt!, tz),
      calendar: target.name,
      account: target.accountEmail,
      addMeet,
      recurring: recurrenceRule ? describeRule(recurrenceRule, startLocal.slice(0, 10)) : undefined,
      recipients: recipients.map((r) => r.name ?? r.email),
      unresolved,
      note: inviteNote(INVITE_STAGED_NOTE, unresolved.length),
    }),
    invite,
  };
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
  /** Identifies THIS turn. Cancel/decline may only be confirmed by a token
   *  minted in an earlier turn, which is what forces the round trip through the
   *  user. Defaults to a fresh id, so a caller that forgets it gets the safe
   *  behavior (propose, never execute) rather than the unsafe one. */
  turnId: string = crypto.randomUUID(),
): Promise<{ result: string; action?: AgentAction; ui?: MarqueeDirective; invite?: InviteDraft }> {
  // Before anything touches the database: does this call name what it acts on?
  // The schema can't require "id or title" portably, so the guarantee lives
  // here, where no amount of fluency gets around it. A rejection is an ordinary
  // tool error — the loop hands it back and the model retries in the same turn.
  const missingTarget = targetError(name, args);
  if (missingTarget) return { result: missingTarget };

  // Cancel/decline affect other people. Enforced, not requested — see
  // confirmDestructive.ts for why the token is turn-scoped.
  const confirmation = checkConfirmation(name, args, turnId);
  if (!confirmation.ok) return { result: confirmation.error! };

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

      if (startTime) await mirrorTask(data.id, tz);

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

    case "create_recurring_task": {
      let title = args.title as string | undefined;
      let freq = args.freq as RecurrenceRule["freq"] | undefined;
      let interval = (args.interval as number | undefined) ?? 1;
      let anchorISO = args.anchor_date as string | undefined;
      let duration = args.duration_minutes as number | null | undefined;
      let priority = (args.priority as string) ?? "none";

      if (args.capture) {
        const parsed = parseCapture(args.capture as string);
        title = parsed.title || title;
        if (parsed.recurrence) {
          freq = parsed.recurrence.freq;
          interval = parsed.recurrence.interval;
        }
        anchorISO = anchorISO ?? parsed.recurrenceAnchor ?? parsed.doDate ?? undefined;
        duration = duration ?? parsed.durationMinutes;
        if (parsed.priority !== "none") priority = parsed.priority;
      }

      if (!title?.trim()) throw new Error("Task title is required");
      if (!freq) throw new Error("Recurrence freq is required (daily, weekly, monthly or yearly)");

      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      anchorISO = anchorISO ?? today;

      const rule: RecurrenceRule = {
        freq,
        interval: Math.max(1, interval),
      };
      if (freq === "weekly") {
        rule.byweekday = [new Date(dayMs(anchorISO)).getUTCDay()];
      }
      // "The last Friday of the month" — positional rather than by-date. The
      // two are mutually exclusive (the DB enforces it), so setting one is
      // enough; the weekday comes from the anchor unless the caller named one.
      const setpos = args.bysetpos as number | undefined;
      if (setpos && (freq === "monthly" || freq === "yearly")) {
        rule.bysetpos = setpos;
        rule.byweekday = [
          typeof args.byweekday === "number"
            ? (args.byweekday as number)
            : new Date(dayMs(anchorISO)).getUTCDay(),
        ];
      }
      if (freq === "yearly") rule.bymonth = new Date(dayMs(anchorISO)).getUTCMonth() + 1;

      let projectId = args.project_id as string | undefined;
      let initiativeId: string | undefined;
      let domainId = args.domain_id as string | undefined;

      if (projectId) {
        const { data: proj } = await admin
          .from("projects")
          .select("domain_id, initiative_id")
          .eq("id", projectId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!proj) throw new Error(`Project not found: ${projectId}`);
        initiativeId = proj.initiative_id ?? undefined;
        domainId = domainId ?? proj.domain_id ?? undefined;
      }

      const created = await createRecurringTaskSeries(userId, {
        title,
        rule,
        anchorISO,
        projectId: projectId ?? null,
        initiativeId: initiativeId ?? null,
        domainId: domainId ?? null,
        duration: duration ?? DEFAULT_DURATION,
        priority,
      });

      const when = created.firstDue === today ? "today" : created.firstDue;
      const next = created.nextDue ? ` Next due ${created.nextDue}.` : "";
      return {
        result: JSON.stringify(created),
        action: {
          tool: name,
          summary: `Set up "${title.trim()}" — ${created.cadence}, first on ${when}.${next} View in Schedule → Recurring upkeep.`,
          verb: "created",
          ref: { kind: "task", id: created.id },
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
      await mirrorTask(id, tz);
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
      await mirrorTask(id, tz);
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

    // ── Slots: one block of time that owns several tasks ────────────────────
    // The act the chat was missing. Asked for "a 9am slot where I'll do X, Y
    // and Z" it had no way to say yes, so it fanned the three out into three
    // consecutive hour blocks — inventing an order the user never gave and
    // filling a morning that was supposed to be one held block.

    case "create_slot": {
      const title = String(args.title ?? "").trim();
      if (!title) throw new Error("A slot needs a title — name the through-line of the work inside it");
      const startLocal = String(args.start_local ?? "");
      if (!startLocal) throw new Error("start_local is required (YYYY-MM-DDTHH:MM in the user's zone)");
      const startTime = startLocal.includes("Z") || startLocal.includes("+")
        ? startLocal
        : localToUtc(startLocal, tz);

      const newTasks = normalizeSlotTasks(args.tasks);
      const taskIds = (args.task_ids as string[] | undefined)?.filter(Boolean) ?? [];

      // Size the block to what's in it when the model didn't say — a stated
      // length always wins, but "9am, three things" is not a 30-minute block.
      const duration = (args.duration_minutes as number | undefined) ?? sizeSlotToCount(newTasks.length + taskIds.length);

      const doDate = dateInTz(startTime, tz);
      const { data: slot, error } = await admin
        .from("slots")
        .insert({
          user_id: userId,
          title,
          do_date: doDate,
          start_time: startTime,
          duration_minutes: duration,
          project_id: (args.project_id as string) ?? null,
          domain_id: (args.domain_id as string) ?? null,
        })
        .select("id, title")
        .single();
      if (error) throw new Error(error.message);

      const placed = await fillSlot(userId, slot.id, doDate, newTasks, taskIds);

      // The block itself is what shows on Google — its children are unblocked,
      // so mirroring them individually would double-book the same hour.
      await invokeFn("slot-mirror", { slotId: slot.id });

      return {
        result: JSON.stringify({
          id: slot.id,
          title: slot.title,
          startTime,
          durationMinutes: duration,
          tasks: placed.map((t) => ({ id: t.id, title: t.title })),
        }),
        action: {
          tool: name,
          summary: `Held "${slot.title}" — ${fmtZonedTime(startTime, tz)} (${duration}m), ${placed.length} inside`,
          verb: "slotted",
          ref: { kind: "slot", id: slot.id },
          undo: { kind: "slot-delete", id: slot.id, childIds: placed.map((t) => t.id) },
        },
      };
    }

    case "add_to_slot": {
      const slot = await resolveSlot(userId, args as { slot_id?: string; slot_title?: string });
      const newTasks = normalizeSlotTasks(args.tasks);
      const taskIds = (args.task_ids as string[] | undefined)?.filter(Boolean) ?? [];
      if (!newTasks.length && !taskIds.length) throw new Error("Nothing to add — pass tasks or task_ids");

      const placed = await fillSlot(userId, slot.id, slot.do_date, newTasks, taskIds);
      return {
        result: JSON.stringify({ id: slot.id, added: placed.map((t) => ({ id: t.id, title: t.title })) }),
        action: {
          tool: name,
          summary: `Added ${placed.length === 1 ? `"${placed[0].title}"` : `${placed.length} items`} to "${slot.title}"`,
          verb: "slotted",
          ref: { kind: "slot", id: slot.id },
        },
      };
    }

    case "reschedule_slot": {
      const slot = await resolveSlot(userId, args as { slot_id?: string; slot_title?: string });
      const startLocalRaw = args.start_local as string | undefined;
      const patch: Record<string, unknown> = {};
      if (startLocalRaw) {
        const startTime = startLocalRaw.includes("Z") || startLocalRaw.includes("+")
          ? startLocalRaw
          : localToUtc(startLocalRaw, tz);
        patch.start_time = startTime;
        patch.do_date = dateInTz(startTime, tz);
      }
      if (args.duration_minutes != null) patch.duration_minutes = args.duration_minutes;
      if (!Object.keys(patch).length) throw new Error("Nothing to change — pass start_local or duration_minutes");

      const { error } = await admin.from("slots").update(patch).eq("id", slot.id).eq("user_id", userId);
      if (error) throw new Error(error.message);

      // The block moved, so its children's day moves with it — they carry no
      // time of their own, but they do carry a date.
      if (patch.do_date) {
        await admin.from("tasks").update({ do_date: patch.do_date }).eq("slot_id", slot.id).eq("user_id", userId);
      }
      await invokeFn("slot-mirror", { slotId: slot.id });

      const when = patch.start_time ? fmtZonedTime(patch.start_time as string, tz) : "same time";
      return {
        result: JSON.stringify({ id: slot.id, ...patch }),
        action: {
          tool: name,
          summary: `Moved "${slot.title}" to ${when}`,
          verb: "moved",
          ref: { kind: "slot", id: slot.id },
          undo: {
            kind: "slot",
            patch: { start_time: slot.start_time, do_date: slot.do_date, duration_minutes: slot.duration_minutes },
          },
        },
      };
    }

    case "delete_slot": {
      const slot = await resolveSlot(userId, args as { slot_id?: string; slot_title?: string });
      const { data: children } = await admin
        .from("tasks")
        .select("id")
        .eq("slot_id", slot.id)
        .eq("user_id", userId);
      // The tasks are not the block. Releasing the time keeps the work on the
      // day, un-blocked — the same thing dropping the slot does in the UI.
      const { error } = await admin.from("slots").delete().eq("id", slot.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      await invokeFn("slot-mirror", { slotId: slot.id, deleted: true, googleEventId: slot.google_event_id });

      const kept = (children ?? []).length;
      return {
        result: JSON.stringify({ id: slot.id, releasedTasks: kept }),
        action: {
          tool: name,
          summary: kept
            ? `Released "${slot.title}" — ${kept} item${kept === 1 ? "" : "s"} kept on the day, un-blocked`
            : `Released "${slot.title}"`,
          verb: "unslotted",
        },
      };
    }

    case "unschedule_task": {
      const before = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { id, title } = before;
      const { error } = await admin.from("tasks").update({ start_time: null }).eq("id", id);
      if (error) throw new Error(error.message);
      await mirrorTask(id, tz);
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
      await mirrorTask(id, tz);
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
      await mirrorTask(id, tz);
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
      await mirrorTask(id, tz);
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
      await mirrorTask(id, tz);
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
      if (args.duration_minutes !== undefined) {
        const mins = Number(args.duration_minutes);
        if (!Number.isFinite(mins) || mins <= 0) throw new Error("duration_minutes must be a positive number");
        patch.duration_minutes = Math.round(mins);
      }
      if (args.energy !== undefined) patch.energy = args.energy || null;
      // Filing carries the whole chain. Setting project_id and leaving the
      // initiative/domain stale is the exact shape of D-088 — four projects'
      // hours credited to the wrong domains because a denormalized copy went
      // stale — so the parent's values are read and written together.
      if (args.project_id !== undefined) {
        const pid = String(args.project_id || "");
        if (pid) {
          const { data: proj } = await admin
            .from("projects")
            .select("initiative_id, domain_id")
            .eq("id", pid)
            .eq("user_id", userId)
            .maybeSingle();
          if (!proj) throw new Error(`Project not found: ${pid}`);
          patch.project_id = pid;
          patch.initiative_id = proj.initiative_id ?? null;
          patch.domain_id = proj.domain_id ?? null;
        } else {
          patch.project_id = null;
          patch.initiative_id = null;
        }
      } else if (args.domain_id !== undefined) {
        patch.domain_id = String(args.domain_id || "") || null;
      }
      if (!Object.keys(patch).length) throw new Error("No fields to update");
      const { error } = await admin.from("tasks").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      if (Object.keys(patch).some((k) => MIRROR_FIELDS.has(k))) await mirrorTask(id, tz);
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

    case "find_contact": {
      const query = ((args.query as string | undefined) ?? "").trim();
      const candidates = await searchContacts(userId, query);
      return {
        result: JSON.stringify({
          query,
          candidates: candidates.slice(0, 8).map((c) => ({
            email: c.email,
            name: c.displayName,
            // Where we know them from — an address book is a stronger claim than
            // "turned up on an event", and the user is entitled to that
            // distinction before mail goes out in their name.
            sources: c.sources,
            metCount: c.freq,
          })),
          note: candidates.length
            ? "Read-only. To invite any of them, call propose_invite — you cannot send mail yourself."
            : "No match in their address books. Ask for the address; never guess one.",
        }),
      };
    }

    case "propose_invite":
      return await stageInvite(userId, args, tz);

    case "create_calendar_event": {
      const title = (args.title as string)?.trim();
      const attendees = (args.attendees as string[] | undefined) ?? [];
      // Guests make this an outbound-mail act, and this tool has no consent
      // step. Rather than fail the turn, hand it to the staging path — the user
      // sees the same card either way, and there is no wording the model can
      // choose that emails someone straight from a create call.
      if (attendees.length) {
        return await stageInvite(userId, { ...args, attendees }, tz);
      }
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
          return moveEventToTarget(userId, existing, target, userToken);
        }
        const provider = existing.calendar_accounts?.provider ?? "google";
        const where = calendarLabel(writable, existing.account_id, existing.calendar_id, provider);
        return {
          result: JSON.stringify({
            alreadyExists: true,
            id: existing.id,
            calendar: where,
            title: existing.title,
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
      // Both write-back providers accept RRULE lines on create (Google expands
      // the series natively; icloud-events writes them into the VEVENT) — same
      // shape the calendar UI's repeat picker sends via toGoogleRRULE.
      const recurrenceRule = recurrenceRuleFromArgs(args, startLocal);
      const recurrence = recurrenceRule ? toGoogleRRULE(recurrenceRule) : undefined;
      const res = await invokeFnJson(
        fn,
        {
          action: "create",
          title,
          start_at,
          end_at,
          ...(location ? { location } : {}),
          ...(recurrence ? { recurrence } : {}),
          // No attendees ever reach here — a guest list is routed to
          // stageInvite above, so this call can never put mail on the wire.
          // Omitted → the account's auto_add_meet preference decides, the same
          // rule the grid composer starts from, so booking by chat and booking
          // by drag produce the same event.
          ...(typeof args.add_meet === "boolean" && provider === "google"
            ? { addMeet: args.add_meet as boolean }
            : {}),
          accountId: target.accountId,
          calendarId: target.calendarId,
        },
        userToken,
      );
      if (!res) {
        throw new Error(`Failed to create event on "${target.name}" — is that ${provider} account connected?`);
      }

      const eventId = (res.event as { id?: string } | null)?.id;
      const meetUrl = (res.meetUrl as string | null) ?? null;
      return {
        result: JSON.stringify({
          created: true,
          title,
          start_at,
          calendar: target.name,
          account: target.accountEmail,
          isDefault: target.isDefault,
          provider,
          // Told, not assumed: the model can only say "with a Meet link" when
          // Google actually returned one.
          ...(meetUrl ? { meetUrl } : {}),
          ...(recurrenceRule ? { recurring: describeRule(recurrenceRule, startLocal.slice(0, 10)) } : {}),
        }),
        action: {
          tool: name,
          summary: `Added "${title}" to ${target.name} at ${fmtZonedTime(start_at, tz)}${recurrenceRule ? ` (${describeRule(recurrenceRule, startLocal.slice(0, 10))})` : ""}`,
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
      return moveEventToTarget(userId, evt as EventRow, target, userToken);
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
          summary: `Rescheduled event "${evt.title}" to ${fmtZonedTime(patch.start_at, tz)}`,
          verb: "moved",
          ref: { kind: "event", id: eventId },
          // No undo on calendar writes: reversing means another round-trip to
          // Google (and possibly re-notifying attendees). The card shows the
          // event; reversing it is a fresh instruction, not a one-tap.
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
      const fn = await eventsFunctionForEvent(userId, id);
      const ok = await invokeFn(
        fn,
        { eventId: id, action: "rsvp", responseStatus: "declined", sendNotifications: Boolean(args.notify) },
        userToken,
      );
      if (!ok) throw new Error(`Couldn't decline "${title}".`);
      return {
        result: JSON.stringify({ id, declined: true }),
        action: { tool: name, summary: `Declined "${title}"${args.notify ? " (organizer notified)" : ""}` },
      };
    }

    case "duplicate_event": {
      const { id } = await resolveEventId(userId, args as { event_id?: string; event_title?: string });
      const { data: src } = await admin
        .from("external_events")
        .select("account_id, calendar_id, title, start_at, end_at, all_day, location, raw")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!src) throw new Error("Event not found");
      const row = src as {
        account_id: string; calendar_id: string; title: string;
        start_at: string; end_at: string; all_day: boolean; location: string | null;
        raw: { description?: string } | null;
      };

      const lengthMs = Date.parse(row.end_at) - Date.parse(row.start_at);
      const start_at = args.start_local ? localToUtc(args.start_local as string, tz) : row.start_at;
      const end_at = args.end_local
        ? localToUtc(args.end_local as string, tz)
        : new Date(Date.parse(start_at) + lengthMs).toISOString();

      const title = ((args.title as string | undefined) ?? row.title ?? "").trim() || "(no title)";
      const fn = await eventsFunctionForEvent(userId, id);
      // No attendees, no recurrence — see the tool description. `notifyGuests`
      // is moot with no guests, and passing false makes that explicit.
      const created = await invokeFnJson(
        fn,
        {
          action: "create",
          title,
          start_at,
          end_at,
          all_day: row.all_day,
          location: row.location ?? undefined,
          description: row.raw?.description,
          accountId: row.account_id,
          calendarId: row.calendar_id,
          // No `notifyGuests`: the copy carries no attendees, so there is
          // nobody to mail — and whether guests get told is a decision that
          // belongs to a human on the invite card, never to a tool argument
          // (tests/invites.test.ts enforces that the agent can't name it).
        },
        userToken,
      );
      if (!created) throw new Error(`Couldn't duplicate "${row.title}"`);
      return {
        result: JSON.stringify({ copiedFrom: id, title, start_local: args.start_local ?? null }),
        action: {
          tool: name,
          summary: `Copied "${row.title}"`,
          verb: "created",
        },
      };
    }

    case "rsvp_event": {
      // The counterpart the agent never had: it could say no and never yes.
      const response = String(args.response ?? "");
      if (response !== "accepted" && response !== "tentative") {
        throw new Error('response must be "accepted" or "tentative" — to decline, call decline_event.');
      }
      const { id, title } = await resolveEventId(userId, args as { event_id?: string; event_title?: string });
      const fn = await eventsFunctionForEvent(userId, id);
      const ok = await invokeFn(
        fn,
        { eventId: id, action: "rsvp", responseStatus: response, sendNotifications: args.notify !== false },
        userToken,
      );
      if (!ok) throw new Error(`Couldn't answer "${title}".`);
      return {
        result: JSON.stringify({ id, response }),
        action: {
          tool: name,
          summary: response === "accepted" ? `Accepted "${title}"` : `Marked "${title}" tentative`,
          verb: "updated",
        },
      };
    }

    case "list_tasks": {
      const matches = await findTaskByTitle(userId, args.query as string);
      return { result: JSON.stringify(matches) };
    }

    case "add_step": {
      const parent = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const titles = ((args.steps as string[] | undefined) ?? [])
        .map((t) => String(t ?? "").trim())
        .filter(Boolean);
      if (!titles.length) throw new Error("Give at least one step title.");
      // A step is not a task: it carries a title, a done state and an order, and
      // NOTHING that would make it schedulable. The DB enforces this (migration
      // 60) — the omission here is deliberate, not an oversight.
      const { data: existing } = await admin
        .from("tasks")
        .select("sort_order")
        .eq("parent_task_id", parent.id)
        .eq("user_id", userId)
        .order("sort_order", { ascending: false })
        .limit(1);
      const base = ((existing?.[0] as { sort_order?: number } | undefined)?.sort_order ?? -1) + 1;
      const rows = titles.map((title, i) => ({
        user_id: userId,
        parent_task_id: parent.id,
        title,
        status: "backlog" as const,
        sort_order: base + i,
      }));
      const { error } = await admin.from("tasks").insert(rows);
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ task: parent.title, added: titles }),
        action: {
          tool: name,
          summary: titles.length === 1 ? `Added a step to "${parent.title}"` : `Added ${titles.length} steps to "${parent.title}"`,
          verb: "updated",
          ref: { kind: "task", id: parent.id },
        },
      };
    }

    case "list_steps": {
      const parent = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const { data } = await admin
        .from("tasks")
        .select("id, title, status")
        .eq("parent_task_id", parent.id)
        .eq("user_id", userId)
        .neq("status", "trashed")
        .order("sort_order");
      const steps = (data ?? []) as { id: string; title: string; status: string }[];
      return {
        result: JSON.stringify({
          task: parent.title,
          steps: steps.map((s) => ({ title: s.title, done: s.status === "done" })),
          note: steps.length ? undefined : "This task has no steps yet.",
        }),
      };
    }

    case "complete_step":
    case "remove_step": {
      const parent = await resolveTaskId(userId, args as { task_id?: string; task_title?: string });
      const wanted = ((args.step_title as string | undefined) ?? "").trim();
      if (!wanted) throw new Error("Which step? Pass step_title.");
      // Scoped to THIS task's steps — a title match across the whole account
      // could tick a step of someone else's checklist entirely.
      const { data } = await admin
        .from("tasks")
        .select("id, title")
        .eq("parent_task_id", parent.id)
        .eq("user_id", userId)
        .neq("status", "trashed")
        .ilike("title", `%${wanted}%`)
        .limit(5);
      const matches = (data ?? []) as { id: string; title: string }[];
      if (!matches.length) throw new Error(`"${parent.title}" has no step matching "${wanted}".`);
      if (matches.length > 1) {
        throw new Error(`Several steps match "${wanted}": ${matches.map((m) => m.title).join(", ")}. Be more specific.`);
      }
      const step = matches[0];

      if (name === "remove_step") {
        const { error } = await admin.from("tasks").delete().eq("id", step.id).eq("user_id", userId);
        if (error) throw new Error(error.message);
        return {
          result: JSON.stringify({ task: parent.title, removed: step.title }),
          action: { tool: name, summary: `Removed "${step.title}"`, verb: "updated", ref: { kind: "task", id: parent.id } },
        };
      }

      const done = args.done !== false;
      const { error } = await admin
        .from("tasks")
        .update({ status: done ? "done" : "backlog", completed_at: done ? new Date().toISOString() : null })
        .eq("id", step.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ task: parent.title, step: step.title, done }),
        action: {
          tool: name,
          summary: done ? `Ticked "${step.title}"` : `Unticked "${step.title}"`,
          verb: "updated",
          ref: { kind: "task", id: parent.id },
        },
      };
    }

    case "list_trashed_tasks": {
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
      let q = admin
        .from("tasks")
        .select("id, title, trashed_at, updated_at")
        .eq("user_id", userId)
        .eq("status", "trashed")
        .order("trashed_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      const query = ((args.query as string | undefined) ?? "").trim();
      if (query) q = q.ilike("title", `%${query}%`);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { id: string; title: string; trashed_at: string | null }[];
      return {
        result: JSON.stringify({
          trashed: rows.map((t) => ({
            id: t.id,
            title: t.title,
            deleted_on: t.trashed_at ? dateInTz(t.trashed_at, tz) : null,
          })),
          note: rows.length
            ? "restore_task brings one back. purge_task deletes it forever and cannot be undone."
            : "The trash is empty — nothing was deleted, so nothing is recoverable this way.",
        }),
      };
    }

    case "restore_task": {
      const before = await resolveTrashedTask(userId, args);
      // The destination is the resting status, not "wherever it was" — the same
      // rule the UI's Restore uses (restingStatus in lib/types.ts). A task
      // deleted three weeks ago must not come back dated to a day that passed.
      const resting = before.project_id || before.initiative_id || before.domain_id || before.sprint_id
        ? "backlog"
        : "inbox";
      const { error } = await admin
        .from("tasks")
        .update({ status: resting, trashed_at: null })
        .eq("id", before.id)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ id: before.id, title: before.title, status: resting }),
        action: {
          tool: name,
          summary: `Restored "${before.title}"`,
          verb: "updated",
          ref: { kind: "task", id: before.id },
          undo: { kind: "task", patch: { status: "trashed" } },
        },
      };
    }

    case "purge_task": {
      const before = await resolveTrashedTask(userId, args);
      const { error } = await admin.from("tasks").delete().eq("id", before.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      // No `undo` on the action, deliberately: there is nothing to undo to, and
      // offering an Undo button that silently fails would be worse than none.
      return {
        result: JSON.stringify({ id: before.id, title: before.title, permanent: true }),
        action: {
          tool: name,
          summary: `Deleted "${before.title}" permanently`,
          verb: "deleted",
        },
      };
    }

    case "search_events": {
      const raw = ((args.query as string | undefined) ?? "").trim();
      // The same sanitize the app does: PostgREST's `or()` reads commas and
      // parens as filter syntax, so they cannot reach it as search text.
      const q = raw.replace(/[,()%*\\]/g, " ").replace(/\s+/g, " ").trim();
      if (q.length < 2) throw new Error("Give at least two characters to search for.");
      const direction = (args.direction as string | undefined) ?? "both";
      const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));
      const nowISO = new Date().toISOString();
      const filter = `title.ilike.%${q}%,location.ilike.%${q}%`;
      const cols = "id, title, start_at, end_at, all_day, location";

      const wants = (d: string) => direction === "both" || direction === d;
      const [ahead, behind] = await Promise.all([
        wants("upcoming")
          ? admin.from("external_events").select(cols).eq("user_id", userId).or(filter)
              .gte("start_at", nowISO).order("start_at", { ascending: true }).limit(limit)
          : Promise.resolve({ data: [], error: null }),
        wants("past")
          ? admin.from("external_events").select(cols).eq("user_id", userId).or(filter)
              .lt("start_at", nowISO).order("start_at", { ascending: false }).limit(limit)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (ahead.error) throw new Error(ahead.error.message);
      if (behind.error) throw new Error(behind.error.message);

      // Times go back in the USER's zone, not the server's — Deno runs in UTC
      // and an evening meeting would otherwise read as tomorrow (D-082).
      const shape = (rows: unknown[]) =>
        (rows as { id: string; title: string; start_at: string; end_at: string; all_day: boolean; location: string | null }[])
          .map((e) => ({
            id: e.id,
            title: e.title,
            date: dateInTz(e.start_at, tz),
            start_local: e.all_day ? null : localTimeInTz(e.start_at, tz),
            all_day: e.all_day,
            location: e.location,
          }));

      const upcoming = shape(ahead.data ?? []);
      const past = shape(behind.data ?? []);
      return {
        result: JSON.stringify({
          query: q,
          upcoming,
          past,
          note:
            upcoming.length + past.length === 0
              ? "Nothing on their calendar matches. Say so plainly — don't guess a date."
              : "Dates are in the user's own time zone. Name the date, not just that it exists.",
        }),
      };
    }

    case "set_reminder": {
      const lead = parseLead(args.lead_minutes);
      if (lead === undefined) {
        throw new Error(
          `lead_minutes must be one of ${REMINDER_LEADS.join(", ")} or "off" — got "${String(args.lead_minutes)}"`,
        );
      }
      const target = await resolveReminderTarget(userId, args);
      const existing = await findReminderRow(userId, target);

      if (existing) {
        const { error } = await admin
          .from("reminders")
          .update({ lead_minutes: lead })
          .eq("id", existing.id)
          .eq("user_id", userId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await admin.from("reminders").insert({
          id: crypto.randomUUID(),
          user_id: userId,
          target_kind: target.kind,
          anchor: target.anchor,
          target_id: target.kind === "event" ? null : target.id,
          event_key: target.kind === "event" ? target.eventKey : null,
          lead_minutes: lead,
        });
        if (error) throw new Error(error.message);
      }

      const said = lead == null ? `No reminder for "${target.title}"` : `${describeLead(lead)} — "${target.title}"`;
      return {
        result: JSON.stringify({ target: target.kind, title: target.title, anchor: target.anchor, lead_minutes: lead }),
        action: {
          tool: name,
          summary: said,
          verb: "updated",
          ref: target.kind === "task" ? { kind: "task", id: target.id! } : undefined,
        },
      };
    }

    case "clear_reminder": {
      const target = await resolveReminderTarget(userId, args);
      const existing = await findReminderRow(userId, target);
      if (!existing) {
        return {
          result: JSON.stringify({
            title: target.title,
            changed: false,
            note: "No override on this one — it already follows the defaults.",
          }),
        };
      }
      const { error } = await admin.from("reminders").delete().eq("id", existing.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return {
        result: JSON.stringify({ title: target.title, changed: true }),
        action: {
          tool: name,
          summary: `"${target.title}" follows your default reminder again`,
          verb: "updated",
          ref: target.kind === "task" ? { kind: "task", id: target.id! } : undefined,
        },
      };
    }

    case "list_reminders": {
      const { data: settings } = await admin
        .from("user_settings")
        .select("reminder_prefs")
        .eq("user_id", userId)
        .maybeSingle();
      const prefs = normalizeReminderPrefs(settings?.reminder_prefs);
      const { data: rows } = await admin
        .from("reminders")
        .select("target_kind, anchor, target_id, event_key, lead_minutes")
        .eq("user_id", userId);
      return {
        result: JSON.stringify({
          enabled: prefs.enabled,
          defaults: {
            before_a_meeting: describeLead(prefs.event_lead),
            before_a_block: describeLead(prefs.block_lead),
            on_a_deadline: describeLead(prefs.deadline_lead),
            deadline_speaks_at_minutes_after_midnight: prefs.deadline_time_minutes,
          },
          overrides: (rows ?? []).map((r) => ({
            kind: r.target_kind,
            anchor: r.anchor,
            id: r.target_id ?? r.event_key,
            lead: describeLead(r.lead_minutes),
          })),
          note: prefs.enabled
            ? "Everything not listed as an override follows the defaults."
            : "Reminders are OFF. Nothing will fire until the user turns them on in Settings → Reminders.",
        }),
      };
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
