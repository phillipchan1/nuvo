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

const listeners = new Set<(projectId: string) => void>();

/** Ask this project's task list to start Draft the path — the next mount of it,
 *  or the one already on screen (the Nuvo panel offers a draft for the project
 *  you're looking at, D-198, so there may be no mount to wait for). */
export function requestPathDraft(projectId: string): void {
  pendingPath = { projectId, at: Date.now() };
  listeners.forEach((fn) => fn(projectId));
}

/** A mounted list hears a request made while it is already showing. */
export function onPathDraftRequest(fn: (projectId: string) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
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
