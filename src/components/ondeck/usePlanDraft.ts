/**
 * Plan projects' first phase — one project's drafted tasks, held in the walk
 * until you press (docs/offer-rules.md §4, D-216).
 *
 * The drafter is Draft the path's own (`askScaffold`, D-193) and its sizing is
 * Draft the path's own (`toSteps` → `sizeFromHistory`, against finished work in
 * the project's domain) — this hook only holds the lines while you shape them:
 * rename, resize, remove (with Undo), add your own, and steer the rest. A steer
 * never rewrites a line you touched (R12, `mergeSteer`). Nothing is written
 * here: the walk's commit is the one write.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cleanSteer, current, toSteps, type ProposedStep } from "../../lib/pathDraft";
import { captureTitle, parseCapture } from "../../lib/nlp";
import type { AskScaffold } from "../../lib/scaffoldAsk";
import { DEFAULT_LINE_MINS, mergeSteer, nextSize, redraftTitles, type PlanLine } from "../../lib/planProjects";

export type PlanDraftPhase = "drafting" | "review" | "none" | "failed";

let seq = 0;
const key = () => `pl${++seq}`;

export interface PlanDraftHome {
  projectId: string;
  /** a draft needs something to read: an outcome, or finished work to size from */
  canDraft: boolean;
  /** no finished work in the domain — every size is the 30m default, said */
  noHistory: boolean;
  finished: { title: string; duration_minutes: number | null }[];
}

export function usePlanDraft(home: PlanDraftHome, ask: AskScaffold) {
  const [phase, setPhase] = useState<PlanDraftPhase>(home.canDraft ? "drafting" : "none");
  const [lines, setLines] = useState<PlanLine[]>([]);
  const [removed, setRemoved] = useState<{ line: PlanLine; index: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const run = useRef(0);
  const homeRef = useRef(home);
  homeRef.current = home;

  const toLines = useCallback((proposals: ProposedStep[]): PlanLine[] => {
    const h = homeRef.current;
    return toSteps(proposals, h.finished).map((s) => ({
      key: key(),
      title: current(s).title,
      mins: h.noHistory ? DEFAULT_LINE_MINS : current(s).durationMins,
      from: "nuvo" as const,
      touched: false,
      measured: s.evidence.measured,
    }));
  }, []);

  const draft = useCallback(
    async (guidance?: string) => {
      const mine = ++run.current;
      setPhase("drafting");
      setMessage(null);
      try {
        const proposals = await ask(homeRef.current.projectId, guidance);
        if (mine !== run.current) return;
        const drafted = toLines(proposals);
        setLines((ls) => mergeSteer(ls, drafted));
        setPhase("review");
        if (!drafted.length) setMessage("Nuvo has nothing to add — the tasks it would draft are already here.");
      } catch {
        if (mine !== run.current) return;
        setPhase("failed");
        setMessage("Nuvo couldn't draft just now. Add your own, or try again.");
      }
    },
    [ask, toLines],
  );

  // A new project: a fresh draft (the walk was opened by your press; reading
  // is not writing).
  useEffect(() => {
    run.current++;
    setLines([]);
    setRemoved(null);
    setMessage(null);
    if (home.canDraft) void draft();
    else setPhase("none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home.projectId]);

  /** Redraft Nuvo's untouched lines in the direction you typed (R12). */
  const steer = useCallback(
    async (text: string) => {
      const guidance = cleanSteer(text);
      if (!guidance || phase === "drafting") return;
      const mine = ++run.current;
      const before = lines;
      setPhase("drafting");
      try {
        const proposals = await ask(homeRef.current.projectId, guidance, redraftTitles(before));
        if (mine !== run.current) return;
        const drafted = toLines(proposals);
        setLines((ls) => mergeSteer(ls, drafted));
        setPhase("review");
        setMessage(drafted.length ? "Redrafted. What you touched stayed." : "Nothing to add with that.");
      } catch {
        if (mine !== run.current) return;
        setPhase("review");
        setMessage("Nuvo couldn't redraft just now. The draft is as it was.");
      }
    },
    [ask, lines, phase, toLines],
  );

  const rename = useCallback((k: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    setLines((ls) => ls.map((l) => (l.key === k && l.title !== t ? { ...l, title: t, touched: true } : l)));
  }, []);

  const resize = useCallback((k: string) => {
    setLines((ls) => ls.map((l) => (l.key === k ? { ...l, mins: nextSize(l.mins), touched: true } : l)));
  }, []);

  const remove = useCallback(
    (k: string) => {
      const index = lines.findIndex((l) => l.key === k);
      if (index < 0) return;
      setRemoved({ line: lines[index], index });
      setLines(lines.filter((l) => l.key !== k));
    },
    [lines],
  );

  const undo = useCallback(() => {
    if (!removed) return;
    setLines((ls) => [...ls.slice(0, removed.index), removed.line, ...ls.slice(removed.index)]);
    setRemoved(null);
  }, [removed]);

  /** Your own line — a typed line means one thing everywhere (`parseCapture`):
   *  "Call Ana 45m" is a 45-minute task called "Call Ana". */
  const add = useCallback((text: string) => {
    const raw = text.trim();
    if (!raw) return;
    const p = parseCapture(raw);
    const title = captureTitle(p, raw) || raw;
    setLines((ls) => [...ls, { key: key(), title, mins: p.durationMinutes ?? DEFAULT_LINE_MINS, from: "you", touched: true }]);
    setPhase((ph) => (ph === "none" || ph === "failed" ? "review" : ph));
  }, []);

  return { phase, lines, removed, message, draft, steer, rename, resize, remove, undo, add };
}

export type PlanDraft = ReturnType<typeof usePlanDraft>;
