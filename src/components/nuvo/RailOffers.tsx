/**
 * Nuvo's offers on the rows they change (D-205) — the live half of
 * `lib/railOffers`. Three chips, one per row, each written as where the thing
 * goes, nothing written until pressed (P3):
 *
 *   PathOffer — a crown project row with a thin path → "Draft the path"
 *   HoldOffer — a today task with no time            → "Hold 2–2:30pm", or
 *               "Hold Mon 9–9:30am" when today is full (D-206)
 *   FileOffer — an inbox capture with a router guess → "→ Garage studio"
 *
 * Each press goes through the path the act already takes: Draft the path is
 * `requestPathDraft` + open the record (the panel's offer, D-198, and the
 * deck's ThinDoor); a hold is the calendar's own `block`; filing is the router
 * guess's own `acceptPatch`, out of triage like the Move menu's filing. So the
 * suggestion log (D-197) grades each one where it always has.
 */

import { useEffect, useMemo, useRef } from "react";
import { OfferChip } from "../kit";
import { requestPathDraft } from "../../lib/draftIntent";
import { reachToCrown } from "../../lib/motion";
import { haptic } from "../../lib/haptics";
import { thinChip, type ThinPath } from "../../lib/thinPath";
import { acceptPatch, liveSuggestion } from "../../lib/grooming";
import { parseDateISO, todayISO } from "../../lib/dates";
import { span } from "../mobile/dayPlan";
import { budgetOffers, offerKey, offersByRow, type RailOfferCandidate } from "../../lib/railOffers";
import { ROUTE_SUGGEST } from "../../../supabase/functions/_shared/domainRouting.ts";
import { useTodayHolds } from "../../hooks/useFindTime";
import type { Placement } from "../../lib/compose";
import type { Task } from "../../lib/types";
import type { useTaskMutations } from "../../hooks/useTasks";
import { notNow, useSnoozed } from "./offerSnooze";

type Mutations = ReturnType<typeof useTaskMutations>;

// ── the budget, live ────────────────────────────────────────────────────────

/** Which rows carry an offer: the pure budget over the live snoozed set. */
export function useOfferBudget(candidates: readonly RailOfferCandidate[], max: number): Map<string, RailOfferCandidate> {
  const snoozed = useSnoozed();
  return useMemo(() => offersByRow(budgetOffers(candidates, { max, snoozed })), [candidates, max, snoozed]);
}

/** Keeps a candidate list's identity until its keys change — the lists are
 *  rebuilt every render, the budget shouldn't be. */
export function useStableCandidates(candidates: RailOfferCandidate[]): RailOfferCandidate[] {
  const sig = candidates.map((c) => `${c.key}@${c.order}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => candidates, [sig]);
}

// ── path ────────────────────────────────────────────────────────────────────

/** A crown row's candidate: a thin path on a project that hasn't landed. */
export function pathCandidates(rows: readonly { projectId: string; done: boolean }[], thin: ReadonlyMap<string, ThinPath>): RailOfferCandidate[] {
  const out: RailOfferCandidate[] = [];
  rows.forEach((r, i) => {
    if (!r.done && thin.has(r.projectId)) out.push({ key: offerKey("path", r.projectId), kind: "path", rowId: r.projectId, order: i });
  });
  return out;
}

export function PathOffer({ thin, onOpenProject, phone = false }: { thin: ThinPath; onOpenProject: (projectId: string) => void; phone?: boolean }) {
  return (
    <OfferChip
      verb="Draft the path"
      title={`${thinChip(thin)} · Nuvo drafts the missing steps. Nothing is added until you keep it.`}
      onPress={() => {
        if (phone) haptic("light");
        requestPathDraft(thin.projectId);
        onOpenProject(thin.projectId);
      }}
      onDismiss={() => {
        if (phone) haptic("selection");
        notNow(offerKey("path", thin.projectId));
      }}
    />
  );
}

// ── hold ────────────────────────────────────────────────────────────────────

/** Today's tasks that could take a hold: dated today, no time, not in a slot. */
export function holdable(tasks: readonly Task[], todayISO: string): Task[] {
  return tasks.filter((t) => t.status !== "done" && t.status !== "trashed" && t.do_date === todayISO && !t.start_time && !t.slot_id);
}

export function holdStart(p: Placement): Date {
  const d = parseDateISO(p.dayISO);
  d.setHours(Math.floor(p.startMin / 60), p.startMin % 60, 0, 0);
  return d;
}

/** "2–2:30pm" — the clock vocabulary (dayPlan `span`). */
export function holdSpan(p: Placement): string {
  const start = holdStart(p);
  return span(start, new Date(start.getTime() + p.durationMin * 60_000));
}

/** "2–2:30pm" today, "Mon 9–9:30am" on a later day (D-206) — the day word,
 *  then the span; never a second time format. */
export function holdWhen(p: Placement, today: string): string {
  if (p.dayISO === today) return holdSpan(p);
  return `${parseDateISO(p.dayISO).toLocaleDateString("en-US", { weekday: "short" })} ${holdSpan(p)}`;
}

export function holdCandidates(holds: ReadonlyMap<string, Placement>): RailOfferCandidate[] {
  // Soonest first: today's holds, then a later day's (minutes since the epoch
  // keep the day in the order, not just the time of day).
  return [...holds.values()].map((p) => ({
    key: offerKey("hold", p.task.id),
    kind: "hold" as const,
    rowId: p.task.id,
    order: Math.round(holdStart(p).getTime() / 60_000),
  }));
}

/** Asks Find time about today's loose work — mounted only while the Today face
 *  shows and something could take a hold, so the composer runs only for rows
 *  you can see (capped at `HOLDS_CAP`). Reports up; draws nothing. */
export function HoldsProbe({ tasks, now, onHolds }: { tasks: readonly Task[]; now: Date; onHolds: (holds: Map<string, Placement>) => void }) {
  const holds = useTodayHolds(tasks, now);
  const sig = [...holds.values()].map((p) => `${p.task.id}@${p.dayISO}:${p.startMin}+${p.durationMin}`).join("|");
  const report = useRef(onHolds);
  report.current = onHolds;
  useEffect(() => {
    report.current(holds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  useEffect(() => () => report.current(new Map()), []);
  return null;
}

export function HoldOffer({ task, placement, mutations, phone = false }: { task: Task; placement: Placement; mutations: Mutations; phone?: boolean }) {
  const today = todayISO();
  const when = holdWhen(placement, today);
  const later = placement.dayISO !== today;
  return (
    <OfferChip
      verb="Hold"
      name={when}
      whole
      title={
        later
          ? `Hold ${when} for ${task.title} — today is full; this is the next time that fits this week`
          : `Hold ${when} today for ${task.title} — the first time that fits`
      }
      onPress={(el) => {
        if (phone) haptic("light");
        // Reach first: the chip is about to leave the row it stands in.
        if (task.project_id) void reachToCrown(el, task.project_id);
        mutations.block(task, holdStart(placement), placement.durationMin, { undo: "toast", label: `Held ${when} — ${task.title}` });
      }}
      onDismiss={() => {
        if (phone) haptic("selection");
        notNow(offerKey("hold", task.id));
      }}
    />
  );
}

// ── file ────────────────────────────────────────────────────────────────────

/** The router's guess for an inbox capture, when it names a place it is sure
 *  enough of. Read from the row (`task.suggestion`) — never a model call. */
export function fileGuess(t: Task): { targetId: string; level: "project" | "initiative" | "domain"; name: string } | null {
  const s = liveSuggestion(t);
  if (!s || s.level === "none" || !s.targetId || !s.targetLabel) return null;
  if ((s.confidence ?? 0) < ROUTE_SUGGEST) return null;
  return { targetId: s.targetId, level: s.level, name: s.targetLabel };
}

export function fileCandidates(inbox: readonly Task[]): RailOfferCandidate[] {
  const out: RailOfferCandidate[] = [];
  inbox.forEach((t, i) => {
    if (fileGuess(t)) out.push({ key: offerKey("file", t.id), kind: "file", rowId: t.id, order: i });
  });
  return out;
}

/** Filing on the guess: the guess's own patch (which grades it "accepted"),
 *  threaded up to the home's initiative and domain, and out of triage — the
 *  Move menu's filing (TaskMenus), on the router's choice. */
export function filePatch(t: Task, home: { initiativeId: string | null; domainId: string | null } | null): Partial<Task> {
  const patch: Partial<Task> = { ...acceptPatch(t), status: "backlog" };
  if (t.suggestion?.level === "project" && home) {
    patch.initiative_id = home.initiativeId;
    if (home.domainId) patch.domain_id = home.domainId;
  }
  return patch;
}

export function FileOffer({
  task,
  mutations,
  homeOfProject,
  phone = false,
}: {
  task: Task;
  mutations: Mutations;
  homeOfProject: (projectId: string) => { initiativeId: string | null; domainId: string | null } | null;
  phone?: boolean;
}) {
  const guess = fileGuess(task);
  if (!guess) return null;
  return (
    <OfferChip
      // Destination only (D-206): the arrow says "goes to", so the place gets
      // the room; a screen reader still hears the whole act.
      verb="→"
      name={guess.name}
      said={`File in ${guess.name}`}
      dest
      title={task.suggestion?.rationale || undefined}
      onPress={(el) => {
        if (phone) haptic("light");
        const patch = filePatch(task, guess.level === "project" ? homeOfProject(guess.targetId) : null);
        const before: Partial<Task> = {};
        for (const k of Object.keys(patch) as (keyof Task)[]) (before as Record<string, unknown>)[k] = task[k];
        if (guess.level === "project") void reachToCrown(el, guess.targetId);
        mutations.patchTask(task.id, patch, {
          before,
          undo: "toast",
          kind: "fileToProject",
          title: task.title,
          label: `Filed in ${guess.name} — ${task.title}`,
        });
      }}
      onDismiss={() => {
        if (phone) haptic("selection");
        notNow(offerKey("file", task.id));
      }}
    />
  );
}
