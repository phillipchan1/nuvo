/**
 * Notion → inbox, the pure half (D-257). No IO, so `npm test` can hold it.
 *
 * A **feed** is one Notion data source (a database's table) the person has
 * switched on. The only rule is D-257's: **assigned to me and still open.**
 * Everything here exists to read that one rule out of a schema nobody
 * standardised — Notion has no built-in "assignee" or "done", so we find the
 * people field and the status field, and say so honestly when there isn't one.
 */

export interface NotionUserRef {
  id: string;
}

/** Notion's property schema, only the parts we read. */
export interface NotionPropSchema {
  id: string;
  name: string;
  type: string;
  status?: {
    options?: Array<{ id: string; name: string }>;
    groups?: Array<{ id: string; name: string; option_ids?: string[] }>;
  };
}

/** How "still open" is read for one feed. */
export type DoneRule =
  | { kind: "status"; prop: string; values: string[] }
  | { kind: "checkbox"; prop: string };

/** One switchable database. Stored in `task_sources.feeds`. */
export interface Feed {
  /** Notion data source id. */
  id: string;
  title: string;
  url: string | null;
  /** The people property that means "assigned to". Null → can't be a feed. */
  assignee: string | null;
  /** Every people property, so the person can pick when there's more than one. */
  people: Array<{ id: string; name: string }>;
  done: DoneRule | null;
  on: boolean;
}

const ASSIGNEE_NAME = /assign|owner|dri|responsible|who/i;
const DONE_NAME = /done|complete|finished|closed/i;

/** The people property that most plausibly means "assigned to". */
export function pickAssignee(props: NotionPropSchema[]): string | null {
  const people = props.filter((p) => p.type === "people");
  if (!people.length) return null;
  return (people.find((p) => ASSIGNEE_NAME.test(p.name)) ?? people[0]).id;
}

/**
 * How to tell an item is finished. A status property's **last group** is
 * Notion's "Complete" (groups are fixed To-do → In progress → Complete; only
 * their names can change), so every option in it counts as done. Without a
 * status, a checkbox named like Done. Without either, nothing is excluded —
 * assigned is still the filter, and the person sees everything assigned.
 */
export function pickDone(props: NotionPropSchema[]): DoneRule | null {
  const status = props.find((p) => p.type === "status");
  if (status) {
    const groups = status.status?.groups ?? [];
    const options = status.status?.options ?? [];
    const last = groups[groups.length - 1];
    const ids = new Set(last?.option_ids ?? []);
    const values = options.filter((o) => ids.has(o.id)).map((o) => o.name);
    if (values.length) return { kind: "status", prop: status.id, values };
  }
  const box = props.find((p) => p.type === "checkbox" && DONE_NAME.test(p.name));
  if (box) return { kind: "checkbox", prop: box.id };
  return null;
}

/** A feed from a fresh schema, keeping the person's own choices from `prev`. */
export function feedFromSchema(
  ds: { id: string; title: string; url: string | null; props: NotionPropSchema[] },
  prev?: Feed,
): Feed {
  const people = ds.props.filter((p) => p.type === "people").map((p) => ({ id: p.id, name: p.name }));
  const keptAssignee = prev?.assignee && people.some((p) => p.id === prev.assignee) ? prev.assignee : null;
  const assignee = keptAssignee ?? pickAssignee(ds.props);
  return {
    id: ds.id,
    title: ds.title,
    url: ds.url,
    assignee,
    people,
    done: pickDone(ds.props),
    // A feed that lost its people field can't stay on: nothing would mean "mine".
    on: Boolean(prev?.on && assignee),
  };
}

/** Merge a fresh listing over the stored feeds. Feeds that vanished drop out. */
export function mergeFeeds(
  fresh: Array<{ id: string; title: string; url: string | null; props: NotionPropSchema[] }>,
  stored: Feed[],
): Feed[] {
  const byId = new Map(stored.map((f) => [f.id, f]));
  return fresh
    .map((ds) => feedFromSchema(ds, byId.get(ds.id)))
    .sort((a, b) => Number(b.on) - Number(a.on) || a.title.localeCompare(b.title));
}

/** The query filter: assigned to `me`, and not in the done set. */
export function feedFilter(feed: Feed, me: string): Record<string, unknown> | null {
  if (!feed.assignee) return null;
  const and: Array<Record<string, unknown>> = [{ property: feed.assignee, people: { contains: me } }];
  if (feed.done?.kind === "status") {
    for (const v of feed.done.values) and.push({ property: feed.done.prop, status: { does_not_equal: v } });
  } else if (feed.done?.kind === "checkbox") {
    and.push({ property: feed.done.prop, checkbox: { equals: false } });
  }
  return { and };
}

type RichText = Array<{ plain_text?: string }>;

// deno-lint-ignore no-control-regex
const clean = (s: string): string => s.replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();

/** Plain text of a title / rich-text array. */
export function plain(rt: unknown): string {
  if (!Array.isArray(rt)) return "";
  return clean((rt as RichText).map((t) => t.plain_text ?? "").join(""));
}

/** A page's title — whichever property is the title. */
export function pageTitle(page: { properties?: Record<string, { type?: string; title?: unknown }> }): string {
  for (const p of Object.values(page.properties ?? {})) {
    if (p?.type === "title") return plain(p.title) || "Untitled";
  }
  return "Untitled";
}

/**
 * The task's notes: where it came from, and the way back. Sources are labelled,
 * not blended (D-257) — and `recognize` makes the link tappable on both shells.
 */
export function importNotes(feedTitle: string, url: string | null): string {
  return url ? `From Notion · ${feedTitle}\n${url}` : `From Notion · ${feedTitle}`;
}

/** Parse the stored JSONB defensively — a bad row is an empty list, never a throw. */
export function readFeeds(raw: unknown): Feed[] {
  const arr = typeof raw === "string" ? safeParse(raw) : raw;
  if (!Array.isArray(arr)) return [];
  return arr.filter((f): f is Feed => Boolean(f && typeof f === "object" && typeof (f as Feed).id === "string"));
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
