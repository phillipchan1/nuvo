// Passive inbox grooming — the client side of the `enrichInbox` edge path.
// Decides which captures still need a guess (none yet, or the capture changed
// under a stale one) and turns an accepted suggestion into a task patch. The
// guess itself is made server-side; this is purely the "when to ask" and "what
// accepting means" logic, kept in one place so both shells agree.

import type { InboxSuggestion, Task } from "./types";

/** A capture's identity for staleness — MUST stay byte-identical to
 *  enrichInbox.ts's suggestionSig (control chars stripped, whole-string trimmed,
 *  lowercased), or every guess reads as stale and never surfaces. */
// eslint-disable-next-line no-control-regex
const clean = (s: string): string => s.replace(/[\x00-\x1F\x7F]/g, " ").trim();
export function suggestionSig(title: string, notes: string): string {
  return clean(`${title ?? ""} ${notes ?? ""}`).toLowerCase();
}

/** An inbox capture worth grooming: titled, and either never groomed or groomed
 *  against an older version of the text (the user edited it since). A dismissed
 *  suggestion is left alone until the capture itself changes. */
export function needsGrooming(t: Task): boolean {
  if (t.status !== "inbox" || !t.title.trim()) return false;
  const s = t.suggestion;
  if (!s) return true;
  return s.sig !== suggestionSig(t.title, t.notes);
}

/** A fresh, actionable suggestion to surface on the row (not stale, not spent). */
export function liveSuggestion(t: Task): InboxSuggestion | null {
  if (t.status !== "inbox") return null;
  const s = t.suggestion;
  if (!s || s.dismissed) return null;
  // An automatic filing is a FACT on the row (the domain is already written), not
  // a proposal — it is read through `autoFiled`, never offered for Accept.
  if (s.auto) return null;
  if (s.sig !== suggestionSig(t.title, t.notes)) return null; // stale: re-grooming
  const hasPlacement = s.level !== "none" && s.targetId;
  if (!hasPlacement && !s.durationMinutes && !s.energy) return null; // nothing to offer
  return s;
}

/** A domain the router wrote onto this capture and the person hasn't yet reviewed.
 *  Null once they undo it, move it, or it goes stale because the text changed. It
 *  is only ever the DOMAIN (never a project, never a date) — the lowest-stakes
 *  field the router touches, and the one that keeps the week's read honest. */
export function autoFiled(t: Task): InboxSuggestion | null {
  const s = t.suggestion;
  if (t.status !== "inbox" || !s?.auto || s.dismissed || s.outcome) return null;
  if (s.sig !== suggestionSig(t.title, t.notes)) return null;
  if (!s.targetId || t.domain_id !== s.targetId) return null; // moved by hand since
  return s;
}

/** Undo an automatic filing: take the domain back off, spend the guess, and
 *  record that the router was wrong — the signal a too-broad domain is told about. */
export function undoAutoPatch(t: Task): Partial<Task> {
  const s = t.suggestion;
  if (!s) return { domain_id: null };
  return { domain_id: null, suggestion: { ...s, dismissed: true, outcome: "undone" } };
}

/** Accepting the guess applies whatever it proposed — placement, duration,
 *  energy — and marks it spent so it stops resurfacing. Stays in the inbox: the
 *  user files/sweeps as a separate, deliberate step. */
export function acceptPatch(t: Task): Partial<Task> {
  const s = t.suggestion;
  if (!s) return {};
  const patch: Partial<Task> = { suggestion: { ...s, dismissed: true, outcome: "accepted" } };
  if (s.level === "project") patch.project_id = s.targetId;
  else if (s.level === "initiative") patch.initiative_id = s.targetId;
  else if (s.level === "domain") patch.domain_id = s.targetId;
  // Thread the task up to its domain so the row picks up the right color even
  // when filed under a project/initiative.
  if (s.domainId && patch.domain_id == null && s.level !== "domain") patch.domain_id = s.domainId;
  if (s.durationMinutes) patch.duration_minutes = s.durationMinutes;
  if (s.energy) patch.energy = s.energy;
  return patch;
}

/** Dismissing keeps the capture untouched but spends the guess. */
export function dismissPatch(t: Task): Partial<Task> {
  return t.suggestion ? { suggestion: { ...t.suggestion, dismissed: true, outcome: "rejected" } } : {};
}
