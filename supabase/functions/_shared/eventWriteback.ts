// The provider answered a PATCH: put its answer in the mirror row — unless the
// row has moved on since the write this answer is for.
//
// Zero-import, like the planning kernel, so the rule is testable outside Deno.
// The I/O is passed in as the narrow slice of a PostgREST builder it needs.
//
// Why it is conditional: the client writes the row first (so every device
// moves now), then asks the function to PATCH the provider, and the function
// rewrites the row from the provider's answer. Two drags inside a second meant
// two of those in flight, and the first one's rewrite could land after the
// second drag's row write — every screen watching the row jumped back to the
// first drag. The client now sends `rowAt`, the times its own row write left,
// and the rewrite only applies while the row still holds them. A newer write
// (this device, another tab, another device) owns the row; its own answer will
// rewrite it. The client also queues one write per event (src/lib/
// eventWriteback.ts), so this is the guard for every writer that isn't that
// lane: an older client, a second window, a phone.
//
// The fields themselves are the version: no column, so nothing to migrate and
// nothing a client written before this change can break.

/** The row's times as the client's write left them. */
export interface EventRowAt {
  start_at: string;
  end_at: string;
}

/** `rowAt` from a request body, or null when absent or malformed — then the
 *  rewrite is unconditional, as it was for every client before this. */
export function parseRowAt(raw: unknown): EventRowAt | null {
  if (!raw || typeof raw !== "object") return null;
  const { start_at, end_at } = raw as Record<string, unknown>;
  if (typeof start_at !== "string" || typeof end_at !== "string") return null;
  if (Number.isNaN(Date.parse(start_at)) || Number.isNaN(Date.parse(end_at))) return null;
  return { start_at, end_at };
}

/** The slice of `admin.from("external_events")` the rewrite uses. */
export interface MirrorRowTable {
  update(values: Record<string, unknown>): MirrorRowFilter;
}

export interface MirrorRowFilter {
  eq(column: string, value: string): MirrorRowFilter;
  select(columns: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
}

/**
 * Rewrite the mirror row with the provider's answer. `superseded` means the row
 * no longer holds `rowAt`: a newer write owns it, and this answer is dropped.
 * The comparison is Postgres's (`timestamptz` equality), so `Z` and `+00:00`
 * spellings of one instant match.
 *
 * `failed` is reported, not thrown: the provider already has the edit, and the
 * next sync repairs a mirror row that missed it. Failing the request here would
 * tell the user an edit that landed did not.
 */
export async function rewriteMirrorRow(
  table: MirrorRowTable,
  eventId: string,
  values: Record<string, unknown>,
  rowAt: EventRowAt | null,
): Promise<"written" | "superseded" | "failed"> {
  let query = table.update(values).eq("id", eventId);
  if (rowAt) query = query.eq("start_at", rowAt.start_at).eq("end_at", rowAt.end_at);
  const { data, error } = await query.select("id");
  if (error) return "failed";
  return rowAt && !(data ?? []).length ? "superseded" : "written";
}
