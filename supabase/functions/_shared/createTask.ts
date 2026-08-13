// The canonical "create a task" path, factored out of the agent's create_task
// tool so the public `capture` function inserts through the exact same logic:
// parent resolution → local→UTC time conversion → status derivation → insert →
// labels → calendar mirror.
//
// Every write is scoped to the passed `userId`; a caller must never pass a
// user_id it took from an untrusted request body. `capture` resolves it from the
// connection token's row, never from the payload.
import { admin } from "./admin.ts";
import { FALLBACK_TZ, localToUtc } from "./dayShape.ts";
import { parseCapture, type TaskPriority } from "./nlp.ts";

const DEFAULT_DURATION = 30;

// The app's home zone and the local→UTC conversion both live in the day-shape
// kernel now; re-exported because `capture` imports them from here.
export { FALLBACK_TZ, localToUtc };

/** Map label names to this user's existing label ids (unknown names dropped). */
export async function resolveLabelIds(userId: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const { data } = await admin.from("labels").select("id, name").eq("user_id", userId);
  const labels = data ?? [];
  return names
    .map((n) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id)
    .filter((id): id is string => Boolean(id));
}

/** Fire the calendar mirror for a scheduled task (best-effort; never blocks). */
export async function mirrorTask(taskId: string): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL")!;
  try {
    await fetch(`${url}/functions/v1/task-mirror`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ taskId }),
    });
  } catch (e) {
    console.warn(`[createTask] mirror failed for ${taskId}:`, e);
  }
}

export interface CreateTaskInput {
  userId: string;
  tz?: string;
  /** Free-text capture ("call David tomorrow 9am 30m #work !high"). Parsed when
   *  `title` is absent; explicit fields below always win over the parse. */
  capture?: string;
  title?: string;
  doDate?: string | null;
  /** Local "YYYY-MM-DDTHH:MM" (converted using tz) or an absolute ISO with Z/offset. */
  startTime?: string | null;
  durationMinutes?: number | null;
  priority?: TaskPriority;
  notes?: string;
  labelNames?: string[];
  projectId?: string;
  initiativeId?: string;
  domainId?: string;
  /** Provenance — set by ingestion callers (capture), left null by the agent. */
  source?: string | null;
  connectionId?: string | null;
  externalId?: string | null;
}

export interface CreatedTask {
  id: string;
  title: string;
  status: string;
  doDate: string | null;
  startTime: string | null;
}

/**
 * Insert one task from either a free-text capture or structured fields,
 * resolving parentage, converting time, deriving status, attaching labels and
 * mirroring to the calendar. Returns the created row's essentials.
 */
export async function createTaskCore(input: CreateTaskInput): Promise<CreatedTask> {
  const tz = input.tz ?? FALLBACK_TZ;

  let title = input.title;
  let doDate = input.doDate;
  let startTimeRaw = input.startTime;
  let duration = input.durationMinutes;
  let priority: TaskPriority = input.priority ?? "none";
  let labelNames = input.labelNames ?? [];
  const notes = input.notes ?? "";

  // Only parse when no explicit title was given — the structured form skips NLP.
  if (title == null && input.capture) {
    const parsed = parseCapture(input.capture);
    title = parsed.title || input.capture;
    doDate = doDate ?? parsed.doDate;
    startTimeRaw = startTimeRaw ?? parsed.startTime?.toISOString() ?? null;
    duration = duration ?? parsed.durationMinutes;
    if (parsed.priority !== "none") priority = parsed.priority;
    labelNames = [...labelNames, ...parsed.labels];
  }

  if (!title?.trim()) throw new Error("Task title is required");

  const projectId = input.projectId;
  let initiativeId = input.initiativeId;
  let domainId = input.domainId;

  // A parented task belongs to its parent's domain — resolved here rather than
  // trusting a caller-supplied domain_id, which goes stale the moment a project
  // is re-homed (D-088).
  if (projectId) {
    const { data: proj } = await admin
      .from("projects")
      .select("domain_id, initiative_id")
      .eq("id", projectId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (!proj) throw new Error(`Project not found: ${projectId}`);
    initiativeId = initiativeId ?? proj.initiative_id ?? undefined;
    domainId = domainId ?? proj.domain_id ?? undefined;
  } else if (initiativeId && !domainId) {
    const { data: init } = await admin
      .from("initiatives")
      .select("domain_id")
      .eq("id", initiativeId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (init?.domain_id) domainId = init.domain_id;
  }

  const parented = Boolean(projectId || initiativeId || domainId);

  // Convert local time to UTC if the caller passed "YYYY-MM-DDTHH:MM".
  const startTime =
    startTimeRaw && !startTimeRaw.includes("Z") && !startTimeRaw.includes("+")
      ? localToUtc(startTimeRaw, tz)
      : (startTimeRaw ?? null);

  // A dated task is always "planned"; a parented-but-undated one is backlog;
  // otherwise it lands in the inbox.
  const status = doDate ? "planned" : parented ? "backlog" : "inbox";
  const dur = startTime != null ? (duration ?? DEFAULT_DURATION) : (duration ?? null);

  const { data, error } = await admin
    .from("tasks")
    .insert({
      user_id: input.userId,
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
      source: input.source ?? null,
      connection_id: input.connectionId ?? null,
      external_id: input.externalId ?? null,
    })
    .select("id, title")
    .single();
  if (error) throw new Error(error.message);

  const labelIds = await resolveLabelIds(input.userId, labelNames);
  if (labelIds.length) {
    await admin
      .from("task_labels")
      .insert(labelIds.map((label_id) => ({ task_id: data.id, label_id })));
  }

  if (startTime) await mirrorTask(data.id);

  return { id: data.id, title: data.title, status, doDate: doDate ?? null, startTime };
}
