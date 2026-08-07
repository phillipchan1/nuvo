// Passive inbox grooming — the client side of the `enrichInbox` edge path.
// Decides which captures still need a guess (none yet, or the capture changed
// under a stale one) and turns an accepted suggestion into a task patch. The
// guess itself is made server-side; this is purely the "when to ask" and "what
// accepting means" logic, kept in one place so both shells agree.

import type { InboxSuggestion, Task } from "./types";
import { isVerdictStale, ROUTING_CONFIDENCE_FLOOR } from "../../supabase/functions/_shared/domainRouting.ts";

/** A capture's identity for staleness — MUST stay byte-identical to
 *  enrichInbox.ts's suggestionSig (control chars stripped, whole-string trimmed,
 *  lowercased), or every guess reads as stale and never surfaces. */
// eslint-disable-next-line no-control-regex
const clean = (s: string): string => s.replace(/[\x00-\x1F\x7F]/g, " ").trim();
export function suggestionSig(title: string, notes: string): string {
  return clean(`${title ?? ""} ${notes ?? ""}`).toLowerCase();
}

/** An inbox capture worth grooming: titled, and either never groomed, groomed
 *  against an older version of the text (the user edited it since), or groomed
 *  before the domains themselves changed shape.
 *
 *  That last clause is the `epoch` (see `domainRoutingEpoch`): a guess made
 *  before a domain was re-groomed — or before a whole new domain existed — was
 *  answering a different question, and nothing used to re-open it. A DISMISSED
 *  suggestion is deliberately exempt: the user already ruled on that capture,
 *  and re-asking because an unrelated domain changed is nagging. */
export function needsGrooming(t: Task, epoch?: string): boolean {
  if (t.status !== "inbox" || !t.title.trim()) return false;
  const stale = isVerdictStale(t.suggested_at ?? null, epoch ?? "");
  const s = t.suggestion;
  // No suggestion but a stamp = the model was asked and declined to judge this
  // one. That is an answer, and re-asking it on every inbox change was a
  // completion spent over and over on the same capture. Ask again only when the
  // capture's text changes, or when the domains themselves do.
  if (!s) return !t.suggested_at || stale;
  if (s.sig !== suggestionSig(t.title, t.notes)) return true;
  if (s.dismissed) return false;
  return stale;
}

/** Whether a suggestion's PLACEMENT is worth acting on. A home the model isn't
 *  sure of is worse than no home: it puts a confident-looking wrong answer in
 *  front of someone who taps accept. Duration and energy are separate judgments
 *  and survive the floor.
 *
 *  Read by both `liveSuggestion` (what the row shows) and `acceptPatch` (what
 *  the tap applies) — one rule, or the two disagree and the UI offers nothing
 *  while the tap files it anyway. */
function placementHolds(s: InboxSuggestion): boolean {
  return s.level !== "none" && !!s.targetId && s.confidence >= ROUTING_CONFIDENCE_FLOOR;
}

/** A fresh, actionable suggestion to surface on the row (not stale, not spent,
 *  not a coin flip). */
export function liveSuggestion(t: Task): InboxSuggestion | null {
  if (t.status !== "inbox") return null;
  const s = t.suggestion;
  if (!s || s.dismissed) return null;
  if (s.sig !== suggestionSig(t.title, t.notes)) return null; // stale: re-grooming
  const placed = placementHolds(s);
  if (!placed && !s.durationMinutes && !s.energy) return null; // nothing to offer
  return placed ? s : { ...s, level: "none", targetId: null };
}

/** Accepting the guess applies whatever it proposed — placement, duration,
 *  energy — and marks it spent so it stops resurfacing. Stays in the inbox: the
 *  user files/sweeps as a separate, deliberate step. */
export function acceptPatch(t: Task): Partial<Task> {
  const s = t.suggestion;
  if (!s) return {};
  const patch: Partial<Task> = { suggestion: { ...s, dismissed: true } };
  // Same floor the row was rendered against — accepting must never file
  // something the row didn't offer.
  if (placementHolds(s)) {
    if (s.level === "project") patch.project_id = s.targetId;
    else if (s.level === "initiative") patch.initiative_id = s.targetId;
    else if (s.level === "domain") patch.domain_id = s.targetId;
    // Thread the task up to its domain so the row picks up the right color even
    // when filed under a project/initiative.
    if (s.domainId && patch.domain_id == null && s.level !== "domain") patch.domain_id = s.domainId;
  }
  if (s.durationMinutes) patch.duration_minutes = s.durationMinutes;
  if (s.energy) patch.energy = s.energy;
  return patch;
}

/** Dismissing keeps the capture untouched but spends the guess. */
export function dismissPatch(t: Task): Partial<Task> {
  return t.suggestion ? { suggestion: { ...t.suggestion, dismissed: true } } : {};
}
