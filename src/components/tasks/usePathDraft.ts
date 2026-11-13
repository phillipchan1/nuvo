/**
 * Draft the path (D-193) — Nuvo drafts a project's missing steps INTO its own
 * list, and you correct the draft instead of filling in a form.
 *
 * The same act as Plan the week, one clock speed down: a draft laid over the
 * real surface, walked one step at a time, ↵ keeps, ⇥ offers another version,
 * and nothing is yours until you keep it (P3). A kept step is written the way
 * the add box writes one — a `backlog` row on the project, never a week (P2).
 *
 * This hook owns the draft's state and keys; `TaskListView` draws it with the
 * real `TaskRow` (D-111) and `PathDraftBar` carries the steer and Keep all.
 * The pure decisions (placement, sizing, sort order) are `lib/pathDraft`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import type { Task } from "../../lib/types";
import type { useTaskMutations } from "../../hooks/useTasks";
import { useAllTasks } from "../../hooks/useTasks";
import { isTypingIn } from "../../lib/a11y";
import { announce } from "../../lib/announce";
import { pathDraftPending, settlePathDraft } from "../../lib/draftIntent";
import { ASSISTANT_NAME } from "../../lib/assistant";
import {
  cleanSteer,
  current,
  draftId,
  evidenceFor,
  isDraftId,
  keyOf,
  placeSteps,
  realOrder,
  reconcile,
  shiftIn,
  sortOrderAt,
  toSteps,
  type DraftStep,
  type ProposedStep,
} from "../../lib/pathDraft";

export type DraftPhase = "idle" | "reading" | "streaming" | "review" | "done";

export interface PathDraftHome {
  projectId: string;
  initiativeId: string | null;
  domainId: string | null;
}

/** One line of the list as drawn while a draft is open. */
export type DraftItem = { kind: "task"; task: Task } | { kind: "draft"; step: DraftStep; task: Task };

const REVEAL_MS = 110;

type Mutations = ReturnType<typeof useTaskMutations>;

export function usePathDraft(home: PathDraftHome | null, tasks: Task[], mutations: Mutations) {
  const { data: all } = useAllTasks();
  // Your finished work is the only honest source for "how long does this take".
  const finished = useMemo(
    () => (all ?? []).filter((t) => t.status === "done" && t.duration_minutes).map((t) => ({ title: t.title, duration_minutes: t.duration_minutes })),
    [all],
  );

  const [phase, setPhase] = useState<DraftPhase>("idle");
  const [steps, setSteps] = useState<Map<string, DraftStep>>(new Map());
  const [layout, setLayout] = useState<string[]>([]);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [kept, setKept] = useState(0);
  const [landed, setLanded] = useState<Set<string>>(new Set());
  const run = useRef(0);
  const revealTimer = useRef<number | null>(null);
  const doneTimer = useRef<number | null>(null);

  const realIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const active = phase !== "idle";

  // The list moves under the draft (a row added in the box, one completed on
  // another device): keep the layout honest without moving the drafts.
  useEffect(() => {
    if (!active) return;
    setLayout((l) => {
      const next = reconcile(l, realIds, new Set(steps.keys()));
      return next.length === l.length && next.every((x, i) => x === l[i]) ? l : next;
    });
  }, [active, realIds, steps]);

  useEffect(
    () => () => {
      if (revealTimer.current) window.clearInterval(revealTimer.current);
      if (doneTimer.current) window.clearTimeout(doneTimer.current);
    },
    [],
  );

  const ghostKeys = useCallback(
    (l: string[] = layout, s: Set<string> = shown) => l.filter((id) => isDraftId(id) && s.has(keyOf(id))).map(keyOf),
    [layout, shown],
  );

  const finishIfEmpty = useCallback((remaining: number) => {
    if (remaining > 0) return;
    setPhase("done");
    setCursor(null);
    setEditing(null);
    if (doneTimer.current) window.clearTimeout(doneTimer.current);
    doneTimer.current = window.setTimeout(() => {
      setPhase((p) => (p === "done" ? "idle" : p));
      setLayout([]);
      setSteps(new Map());
      setShown(new Set());
      setMessage(null);
    }, 4000);
  }, []);

  /** Reveal drafted steps one at a time, so you watch the path fill in. */
  const reveal = useCallback((keys: string[], then: () => void) => {
    if (revealTimer.current) window.clearInterval(revealTimer.current);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || keys.length === 0) {
      setShown((s) => new Set([...s, ...keys]));
      then();
      return;
    }
    let i = 0;
    setPhase("streaming");
    revealTimer.current = window.setInterval(() => {
      const k = keys[i++];
      setShown((s) => new Set([...s, k]));
      if (i >= keys.length) {
        if (revealTimer.current) window.clearInterval(revealTimer.current);
        revealTimer.current = null;
        then();
      }
    }, REVEAL_MS);
  }, []);

  const ask = useCallback(
    async (guidance?: string, redraft?: string[]) => {
      if (!home) return null;
      const { data, error } = await supabase.functions.invoke<{ tasks?: ProposedStep[] }>("agent", {
        body: { scaffold: { projectId: home.projectId, guidance, redraft } },
      });
      if (error) throw error;
      return (data?.tasks ?? []).filter((p) => p && typeof p.title === "string" && p.title.trim());
    },
    [home, tasks],
  );

  const start = useCallback(async () => {
    if (!home || phase === "reading" || phase === "streaming" || phase === "review") return;
    if (doneTimer.current) window.clearTimeout(doneTimer.current);
    const mine = ++run.current;
    setPhase("reading");
    setMessage(null);
    setKept(0);
    setSteps(new Map());
    setShown(new Set());
    setLayout(realIds);
    try {
      const proposals = await ask();
      if (mine !== run.current || !proposals) return;
      if (!proposals.length) {
        setPhase("idle");
        toast(`${ASSISTANT_NAME} has nothing to add — every step it would draft is already here.`);
        return;
      }
      const drafted = toSteps(proposals, finished);
      setSteps(new Map(drafted.map((s) => [s.key, s])));
      setLayout(placeSteps(realIds, (id) => byId.get(id)?.title ?? "", drafted, proposals));
      announce(`${ASSISTANT_NAME} drafted ${drafted.length} step${drafted.length === 1 ? "" : "s"}`);
      reveal(
        drafted.map((s) => s.key),
        () => {
          setPhase("review");
          setCursor(drafted[0]?.key ?? null);
        },
      );
    } catch {
      if (mine !== run.current) return;
      setPhase("idle");
      setLayout([]);
      toast.error(`${ASSISTANT_NAME} couldn't draft the path. Your list is unchanged — try again in a moment.`);
    }
  }, [home, phase, realIds, byId, ask, finished, reveal]);

  // Opened from a thin-path mark (D-196): the mark asked for this draft before
  // the list existed, so the list starts it once, on arrival — the mark never
  // owns a second copy of the draft.
  const homeId = home?.projectId ?? null;
  // A tick late, so a mount that's torn straight down again (StrictMode, a
  // remount while the record settles) never takes the note it can't keep.
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!homeId) return;
    const t = window.setTimeout(() => {
      if (pathDraftPending(homeId)) void startRef.current();
    }, 0);
    return () => window.clearTimeout(t);
  }, [homeId]);
  // the note is spent once this list's draft has landed, or given up
  useEffect(() => {
    if (homeId && (phase === "streaming" || phase === "review" || phase === "idle")) {
      if (phase !== "idle" || run.current > 0) settlePathDraft(homeId);
    }
  }, [homeId, phase]);

  const nextAfter = (key: string, l: string[]) => {
    const ghosts = ghostKeys(l);
    const i = ghosts.indexOf(key);
    return ghosts.slice(i + 1).find((k) => k !== key) ?? ghosts.slice(0, i).reverse().find((k) => k !== key) ?? null;
  };

  /** Write one drafted step as a real task at its place. Returns the new id. */
  const write = (step: DraftStep, l: string[], undo: "silent" | false): { id: string; layout: string[]; task: Promise<Task> } | null => {
    if (!home) return null;
    const v = current(step);
    const id = crypto.randomUUID();
    const sort = sortOrderAt(l, draftId(step.key), (rid) => byId.get(rid)?.sort_order);
    const task = mutations.create(
      {
        title: v.title,
        duration_minutes: v.durationMins,
        energy: step.energy,
        project_id: home.projectId,
        initiative_id: home.initiativeId,
        domain_id: home.domainId,
        status: "backlog",
        sort_order: sort,
        clientId: id,
      },
      { undo, label: `Kept — ${v.title}` },
    );
    return { id, layout: l.map((x) => (x === draftId(step.key) ? id : x)), task };
  };

  const land = (ids: string[]) => {
    setLanded((s) => new Set([...s, ...ids]));
    window.setTimeout(() => setLanded((s) => new Set([...s].filter((x) => !ids.includes(x)))), 700);
  };

  const keep = useCallback(
    (key: string) => {
      const step = steps.get(key);
      if (!step || phase !== "review") return;
      const w = write(step, layout, "silent");
      if (!w) return;
      const nx = nextAfter(key, layout);
      const nextSteps = new Map(steps);
      nextSteps.delete(key);
      setSteps(nextSteps);
      setLayout(w.layout);
      setKept((k) => k + 1);
      setCursor(nx);
      setEditing(null);
      land([w.id]);
      announce(`Kept ${current(step).title}`);
      finishIfEmpty(nextSteps.size);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, layout, phase, home, byId, mutations],
  );

  const keepAll = useCallback(() => {
    if (phase !== "review") return;
    let l = layout;
    const made: { id: string; task: Promise<Task> }[] = [];
    for (const key of ghostKeys(layout)) {
      const step = steps.get(key);
      if (!step) continue;
      const w = write(step, l, false);
      if (!w) continue;
      l = w.layout;
      made.push({ id: w.id, task: w.task });
    }
    if (!made.length) return;
    setLayout(l);
    setSteps(new Map());
    setKept((k) => k + made.length);
    land(made.map((m) => m.id));
    finishIfEmpty(0);
    const n = made.length;
    toast(`Kept ${n} step${n === 1 ? "" : "s"}`, {
      action: {
        label: "Undo",
        onClick: () => {
          void Promise.all(made.map((m) => m.task)).then((ts) => ts.forEach((t) => mutations.trash(t, { undo: false })));
        },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, layout, steps, ghostKeys, mutations, finishIfEmpty]);

  const restore = (saved: { steps: Map<string, DraftStep>; layout: string[]; shown: Set<string> }) => {
    if (doneTimer.current) window.clearTimeout(doneTimer.current);
    setSteps(saved.steps);
    setLayout(reconcile(saved.layout, realIds, new Set(saved.steps.keys())));
    setShown(saved.shown);
    setPhase("review");
    setCursor([...saved.steps.keys()][0] ?? null);
  };

  const drop = useCallback(
    (key: string) => {
      const step = steps.get(key);
      if (!step || phase !== "review") return;
      const saved = { steps, layout, shown };
      const nx = nextAfter(key, layout);
      const nextSteps = new Map(steps);
      nextSteps.delete(key);
      setSteps(nextSteps);
      setLayout(layout.filter((x) => x !== draftId(key)));
      setCursor(nx);
      setEditing(null);
      finishIfEmpty(nextSteps.size);
      toast(`Dropped “${current(step).title}”`, { action: { label: "Undo", onClick: () => restore(saved) } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, layout, shown, phase, finishIfEmpty],
  );

  const discard = useCallback(() => {
    if (phase === "reading" || phase === "streaming") {
      run.current++;
      if (revealTimer.current) window.clearInterval(revealTimer.current);
      setPhase("idle");
      setSteps(new Map());
      setLayout([]);
      return;
    }
    const n = steps.size;
    if (!n) return;
    const saved = { steps, layout, shown };
    setSteps(new Map());
    setLayout(layout.filter((x) => !isDraftId(x)));
    finishIfEmpty(0);
    toast(`Discarded ${n} drafted step${n === 1 ? "" : "s"}`, { action: { label: "Undo", onClick: () => restore(saved) } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, steps, layout, shown, finishIfEmpty]);

  const version = useCallback(
    (key: string, dir: 1 | -1) => {
      const s = steps.get(key);
      if (!s || s.versions.length < 2) return;
      const next = { ...s, version: (s.version + dir + s.versions.length) % s.versions.length };
      next.evidence = evidenceFor(next, finished);
      setSteps(new Map(steps).set(key, next));
      announce(`Version ${next.version + 1} of ${next.versions.length}: ${current(next).title}`);
    },
    [steps, finished],
  );

  const rename = useCallback(
    (key: string, title: string | null) => {
      setEditing(null);
      const s = steps.get(key);
      if (!s || !title?.trim()) return;
      const versions = s.versions.map((v, i) => (i === s.version ? { ...v, title: title.trim() } : v));
      setSteps(new Map(steps).set(key, { ...s, versions }));
    },
    [steps],
  );

  /** ⌥↑↓ — a drafted step moves among everything; your steps don't move. */
  const move = useCallback(
    (key: string, delta: number) => {
      const next = shiftIn(layout, draftId(key), delta);
      if (!next) return announce("Can't move this step any further");
      setLayout(next);
    },
    [layout],
  );

  /** A drag (desktop) or hold (phone) settled a new order of the whole list. */
  const reorder = useCallback(
    (next: string[]) => {
      setLayout(next);
      const real = realOrder(next);
      const before = tasks.map((t) => t.id);
      if (real.some((id, i) => id !== before[i])) mutations.reorder(tasks, real);
    },
    [tasks, mutations],
  );

  /** Redraft what you haven't kept, in the direction you typed. */
  const steer = useCallback(
    async (text: string) => {
      const guidance = cleanSteer(text);
      if (!guidance || phase !== "review") return;
      const mine = ++run.current;
      const redraft = [...steps.values()].map((s) => current(s).title);
      const before = steps.size;
      setPhase("reading");
      try {
        const proposals = await ask(guidance, redraft);
        if (mine !== run.current || !proposals) return;
        const realNow = layout.filter((x) => !isDraftId(x));
        const drafted = toSteps(proposals, finished);
        setSteps(new Map(drafted.map((s) => [s.key, s])));
        setShown(new Set());
        setLayout(placeSteps(realNow, (id) => byId.get(id)?.title ?? "", drafted, proposals));
        setMessage(
          drafted.length
            ? `Redrafted: ${before} out, ${drafted.length} in. What you kept stayed put.`
            : `${ASSISTANT_NAME} has nothing to add with that steer.`,
        );
        if (!drafted.length) return finishIfEmpty(0);
        reveal(
          drafted.map((s) => s.key),
          () => {
            setPhase("review");
            setCursor(drafted[0].key);
          },
        );
      } catch {
        if (mine !== run.current) return;
        setPhase("review");
        setMessage(`${ASSISTANT_NAME} couldn't redraft just now. The draft is as it was.`);
      }
    },
    [phase, steps, ask, layout, finished, byId, reveal, finishIfEmpty],
  );

  // ── the list as drawn ──────────────────────────────────────────────────────
  const items: DraftItem[] | null = useMemo(() => {
    if (!active || !home) return null;
    const out: DraftItem[] = [];
    for (const id of layout) {
      if (isDraftId(id)) {
        const step = steps.get(keyOf(id));
        if (step && shown.has(step.key)) out.push({ kind: "draft", step, task: ghostTask(step, home) });
      } else {
        const t = byId.get(id);
        if (t) out.push({ kind: "task", task: t });
      }
    }
    return out;
  }, [active, home, layout, steps, shown, byId]);

  // ── keys — registered once, read through a ref, so this listener stays ahead
  // of the record's own Escape in the capture phase (effects run child-first). ──
  const live = useRef({ phase, cursor, editing, keep, drop, keepAll, discard, version, move, ghosts: [] as string[], setCursor, setEditing });
  live.current = { phase, cursor, editing, keep, drop, keepAll, discard, version, move, ghosts: ghostKeys(), setCursor, setEditing };
  const keysOn = useRef(false);
  const steerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = live.current;
      if (!keysOn.current || s.phase === "idle" || s.phase === "done") return;
      if (isTypingIn(e.target) || e.metaKey || e.ctrlKey) return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (s.phase === "reading" || s.phase === "streaming") {
        if (e.key === "Escape") {
          stop();
          s.discard();
        }
        return;
      }
      const k = s.cursor;
      const i = k ? s.ghosts.indexOf(k) : -1;
      switch (e.key) {
        case "ArrowDown":
        case "j":
          if (e.altKey && k) return stop(), s.move(k, 1);
          stop();
          s.setCursor(s.ghosts[Math.min(s.ghosts.length - 1, i + 1)] ?? null);
          return;
        case "ArrowUp":
        case "k":
          if (e.altKey && k) return stop(), s.move(k, -1);
          stop();
          s.setCursor(s.ghosts[Math.max(0, i - 1)] ?? null);
          return;
        case "Enter":
          stop();
          if (e.shiftKey) s.keepAll();
          else if (k) s.keep(k);
          return;
        case "Backspace":
        case "Delete":
          if (k) stop(), s.drop(k);
          return;
        case "Tab":
          if (k) stop(), s.version(k, e.shiftKey ? -1 : 1);
          return;
        case "e":
        case "E":
          if (k) stop(), s.setEditing(k);
          return;
        case "/":
          stop();
          steerRef.current?.focus();
          return;
        case "Escape":
          stop();
          s.discard();
          return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return {
    phase,
    active,
    items,
    cursor,
    setCursor,
    editing,
    setEditing,
    landed,
    message,
    kept,
    remaining: steps.size,
    steerRef,
    /** The host says whether the draft's keys are live (desktop, nothing above it). */
    setKeys: (on: boolean) => {
      keysOn.current = on;
    },
    start,
    keep,
    keepAll,
    drop,
    discard,
    version,
    rename,
    move,
    reorder,
    steer,
  };
}

export type PathDraft = ReturnType<typeof usePathDraft>;

/** A drafted step drawn as a task, so the one `TaskRow` can draw it (D-111). */
function ghostTask(step: DraftStep, home: PathDraftHome): Task {
  const v = current(step);
  const now = new Date(0).toISOString();
  return {
    id: draftId(step.key),
    user_id: "",
    created_at: now,
    updated_at: now,
    title: v.title,
    notes: "",
    status: "backlog",
    do_date: null,
    start_time: null,
    duration_minutes: v.durationMins,
    deadline: null,
    priority: "none",
    roll_count: 0,
    completed_at: null,
    trashed_at: null,
    project_id: home.projectId,
    initiative_id: home.initiativeId,
    domain_id: home.domainId,
    key_result_id: null,
    sprint_id: null,
    big_rock_id: null,
    energy: step.energy,
    assignee: "me",
    prework: "",
    prework_at: null,
    suggestion: null,
    suggested_at: null,
    google_event_id: null,
    sort_order: 0,
    slot_id: null,
    parent_task_id: null,
    recurrence_id: null,
    recurrence_date: null,
    recurrence_overridden: false,
    task_labels: [],
  };
}
