/**
 * "Open this, with the draft already running." A one-shot hand-off between the
 * surface that offers a draft (the thin-path mark, D-196) and the surface that
 * draws it (the project's own task list, D-193). The mark doesn't own a second
 * copy of Draft the path; it opens the record and leaves a note.
 *
 * The note is READ on mount and CLEARED only once a draft has landed (or failed)
 * — not when it is first read. The record's list can mount, start, and be torn
 * down again while the record settles; a note taken on first read was lost with
 * that first list, and the list that stayed never drafted (seen in ?drafts).
 */

let pendingPath: { projectId: string; at: number } | null = null;

const FRESH_MS = 8000;

/** Ask the next mount of this project's task list to start Draft the path. */
export function requestPathDraft(projectId: string): void {
  pendingPath = { projectId, at: Date.now() };
}

/** Is a draft waiting for this project? (A note nobody acted on goes stale, so
 *  it never fires on some later, unrelated visit.) */
export function pathDraftPending(projectId: string): boolean {
  const p = pendingPath;
  if (!p || p.projectId !== projectId) return false;
  if (Date.now() - p.at >= FRESH_MS) {
    pendingPath = null;
    return false;
  }
  return true;
}

/** The draft landed (or couldn't) — the note is spent. */
export function settlePathDraft(projectId: string): void {
  if (pendingPath?.projectId === projectId) pendingPath = null;
}

/** Read and clear in one step — for callers that act immediately. */
export function takePathDraft(projectId: string): boolean {
  const ok = pathDraftPending(projectId);
  if (ok) settlePathDraft(projectId);
  return ok;
}
