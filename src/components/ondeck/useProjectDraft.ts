/**
 * Draft the projects (D-196) — Nuvo drafts the projects an initiative's outcome
 * is missing, as bars across its quarter, and you correct the draft. The same
 * act as Plan the week and Draft the path, one clock speed slower.
 *
 * Nothing is yours until you hold it (P3). Holding a bar writes one project
 * under the initiative with the span it stood on — the deck's own span formula,
 * so it reads on the project deck exactly where it stood here. Every write has
 * an Undo. The desktop quarter (`ProjectDraftQuarter`) and the phone sheet
 * (`mobile/MobileProjectDraft`) are two layouts over this hook.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import { announce } from "../../lib/announce";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { useVertical } from "../../hooks/useVertical";
import { projectsOf, type Initiative } from "../../lib/vertical";
import {
  atOnce,
  clampSpan,
  heldProjectPatch,
  ownBars,
  shapeProjectProposals,
  type ProjectProposal,
  type ProjectSpan,
  type ProjectVersion,
} from "../../lib/projectDraft";

export type ProjectDraftPhase = "reading" | "streaming" | "review" | "done";

/** One drafted project, not yet yours. `v` picks the version; `span`/`name`
 *  are what you've made of it (a drag, a rename), which beat the version's. */
export interface GhostProject {
  key: string;
  versions: ProjectVersion[];
  v: number;
  span: ProjectSpan;
  name: string;
  outcome: string;
  why: string;
}

export const PROJECT_STEERS = ["fewer projects", "start later", "smaller first step"] as const;

const REVEAL_MS = 180;

const fromProposal = (p: ProjectProposal, i: number): GhostProject => {
  const versions = [{ name: p.name, outcome: p.outcome, why: p.why, start: p.start, weeks: p.weeks }, ...p.alternatives];
  return { key: `g${Date.now().toString(36)}${i}`, versions, v: 0, span: { start: p.start, weeks: p.weeks }, name: p.name, outcome: p.outcome, why: p.why };
};

export function useProjectDraft(initiative: Initiative, weeks: string[]) {
  const { data, addProject, deleteProject } = useVertical();
  const [phase, setPhase] = useState<ProjectDraftPhase>("reading");
  const [ghosts, setGhosts] = useState<GhostProject[]>([]);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [held, setHeld] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const run = useRef(0);
  const timer = useRef<number | null>(null);

  const own = useMemo(() => ownBars(projectsOf(data, initiative.id), weeks), [data, initiative.id, weeks]);
  const order = useMemo(() => [...ghosts].sort((a, b) => a.span.start - b.span.start || a.span.weeks - b.span.weeks), [ghosts]);
  const visible = useMemo(() => order.filter((g) => shown.has(g.key)), [order, shown]);
  const load = useMemo(() => atOnce([...own, ...visible.map((g) => g.span)], weeks.length), [own, visible, weeks.length]);

  const ask = useCallback(
    async (guidance?: string, redraft?: string[]) => {
      const { data: res, error } = await supabase.functions.invoke<{ projects?: unknown[] }>("agent", {
        body: { draftProjects: { initiativeId: initiative.id, weekStarts: weeks, guidance, redraft } },
      });
      if (error) throw error;
      // shape again on this side: an older deploy, or a model that wandered,
      // still yields spans inside this quarter and no duplicate of yours
      return shapeProjectProposals(res?.projects, weeks.length, own.map((o) => o.name));
    },
    [initiative.id, weeks, own],
  );

  const reveal = useCallback((keys: string[], then: () => void) => {
    if (timer.current) window.clearInterval(timer.current);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !keys.length) {
      setShown((s) => new Set([...s, ...keys]));
      then();
      return;
    }
    let i = 0;
    setPhase("streaming");
    timer.current = window.setInterval(() => {
      const k = keys[i++];
      setShown((s) => new Set([...s, k]));
      if (i >= keys.length) {
        if (timer.current) window.clearInterval(timer.current);
        timer.current = null;
        then();
      }
    }, REVEAL_MS);
  }, []);

  /** Stream a fresh draft in, then put the keys on its earliest bar. */
  const land = useCallback(
    (list: GhostProject[]) => {
      const sorted = [...list].sort((a, b) => a.span.start - b.span.start);
      reveal(
        sorted.map((g) => g.key),
        () => {
          setPhase("review");
          setCursor(sorted[0]?.key ?? null);
        },
      );
    },
    [reveal],
  );

  const start = useCallback(async () => {
    const mine = ++run.current;
    setPhase("reading");
    setMessage(null);
    try {
      const proposals = await ask();
      if (mine !== run.current) return;
      if (!proposals.length) {
        setPhase("done");
        setMessage(`${ASSISTANT_NAME} has nothing to add — your projects already cover the outcome.`);
        return;
      }
      const list = proposals.map(fromProposal);
      setGhosts(list);
      announce(`${ASSISTANT_NAME} drafted ${list.length} project${list.length === 1 ? "" : "s"}`);
      land(list);
    } catch {
      if (mine !== run.current) return;
      setPhase("done");
      setMessage(`${ASSISTANT_NAME} couldn't draft the projects. Nothing changed — try again in a moment.`);
    }
  }, [ask, land]);

  // the draft starts the moment the quarter opens — that press WAS the ask
  useEffect(() => {
    void start();
    return () => {
      run.current++;
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextAfter = useCallback(
    (key: string, list: GhostProject[]) => {
      const sorted = [...list].sort((a, b) => a.span.start - b.span.start);
      const i = sorted.findIndex((g) => g.key === key);
      const rest = sorted.filter((g) => g.key !== key);
      return (sorted.slice(i + 1).find((g) => g.key !== key) ?? rest[0])?.key ?? null;
    },
    [],
  );

  const finishIfEmpty = (remaining: number) => {
    if (remaining === 0) {
      setPhase("done");
      setMessage(null);
    }
  };

  /** Write one ghost as a project. Returns the new id. */
  const write = useCallback(
    async (g: GhostProject): Promise<string | null> => {
      try {
        const p = await addProject(initiative.domainId, initiative.id, {
          name: g.name,
          outcome: g.outcome,
          ...heldProjectPatch(weeks, g.span),
          status: "backlog",
        });
        return p.id;
      } catch {
        toast.error(`Couldn't add ${g.name}. Try again in a moment.`);
        return null;
      }
    },
    [addProject, initiative.domainId, initiative.id, weeks],
  );

  const restore = useCallback((list: GhostProject[], cur: string | null) => {
    setGhosts((gs) => [...gs, ...list.filter((g) => !gs.some((x) => x.key === g.key))]);
    setShown((s) => new Set([...s, ...list.map((g) => g.key)]));
    setPhase("review");
    setCursor(cur);
  }, []);

  const hold = useCallback(
    (key: string) => {
      const g = ghosts.find((x) => x.key === key);
      if (!g || phase !== "review") return;
      const rest = ghosts.filter((x) => x.key !== key);
      setGhosts(rest);
      setCursor(nextAfter(key, ghosts));
      setHeld((n) => n + 1);
      finishIfEmpty(rest.length);
      announce(`Held ${g.name}`);
      void write(g).then((id) => {
        if (!id) return restore([g], key);
        toast(`Held · ${g.name}`, {
          action: {
            label: "Undo",
            onClick: () => {
              deleteProject(id);
              setHeld((n) => Math.max(0, n - 1));
              restore([g], key);
            },
          },
        });
      });
    },
    [ghosts, phase, nextAfter, write, deleteProject, restore],
  );

  const drop = useCallback(
    (key: string) => {
      const g = ghosts.find((x) => x.key === key);
      if (!g || phase !== "review") return;
      const rest = ghosts.filter((x) => x.key !== key);
      setGhosts(rest);
      setCursor(nextAfter(key, ghosts));
      finishIfEmpty(rest.length);
      toast(`Dropped · ${g.name}`, { action: { label: "Undo", onClick: () => restore([g], key) } });
    },
    [ghosts, phase, nextAfter, restore],
  );

  const patch = useCallback((key: string, f: (g: GhostProject) => GhostProject) => {
    setGhosts((gs) => gs.map((g) => (g.key === key ? f(g) : g)));
  }, []);

  /** Another version (⇥ cycles, 1–3 picks). The version brings its own span. */
  const version = useCallback(
    (key: string, n?: number) =>
      patch(key, (g) => {
        if (g.versions.length < 2) return g;
        const v = n != null ? Math.min(Math.max(0, n), g.versions.length - 1) : (g.v + 1) % g.versions.length;
        const x = g.versions[v];
        return { ...g, v, name: x.name, outcome: x.outcome, why: x.why, span: { start: x.start, weeks: x.weeks } };
      }),
    [patch],
  );

  const setSpan = useCallback(
    (key: string, span: ProjectSpan) => patch(key, (g) => ({ ...g, span: clampSpan(span.start, span.weeks, weeks.length) })),
    [patch, weeks.length],
  );
  const shift = useCallback(
    (key: string, d: number) =>
      patch(key, (g) => ({ ...g, span: clampSpan(Math.min(weeks.length - g.span.weeks, g.span.start + d), g.span.weeks, weeks.length) })),
    [patch, weeks.length],
  );
  const stretch = useCallback(
    (key: string, d: number) => patch(key, (g) => ({ ...g, span: clampSpan(g.span.start, g.span.weeks + d, weeks.length) })),
    [patch, weeks.length],
  );
  const rename = useCallback((key: string, name: string) => {
    const n = name.trim();
    if (n) patch(key, (g) => ({ ...g, name: n }));
  }, [patch]);

  const holdAll = useCallback(() => {
    if (phase !== "review" || !ghosts.length) return;
    const list = ghosts;
    setGhosts([]);
    setCursor(null);
    setHeld((n) => n + list.length);
    setPhase("done");
    setMessage(null);
    void Promise.all(list.map(write)).then((ids) => {
      const ok = ids.filter((x): x is string => !!x);
      toast(`Held ${ok.length} project${ok.length === 1 ? "" : "s"} under ${initiative.name}`, {
        action: {
          label: "Undo",
          onClick: () => {
            ok.forEach((id) => deleteProject(id));
            setHeld((n) => Math.max(0, n - ok.length));
            restore(list, list[0]?.key ?? null);
          },
        },
      });
    });
  }, [phase, ghosts, write, initiative.name, deleteProject, restore]);

  const discard = useCallback(() => {
    run.current++;
    if (timer.current) window.clearInterval(timer.current);
    const list = ghosts;
    setGhosts([]);
    setCursor(null);
    setPhase("done");
    if (list.length)
      toast(`Put away ${list.length} drafted project${list.length === 1 ? "" : "s"}`, {
        action: { label: "Undo", onClick: () => restore(list, list[0]?.key ?? null) },
      });
  }, [ghosts, restore]);

  /** Reshape what you haven't held — free text, so dictation works. */
  const steer = useCallback(
    async (text: string) => {
      const guidance = text.trim();
      if (!guidance || phase !== "review") return;
      const mine = ++run.current;
      const before = ghosts;
      setPhase("reading");
      setMessage(null);
      try {
        const proposals = await ask(guidance, before.map((g) => g.name));
        if (mine !== run.current) return;
        const list = proposals.map(fromProposal);
        setGhosts(list);
        setShown(new Set());
        setMessage(list.length ? `Redrafted what you hadn't held: “${guidance}”` : `Nothing left to draft after “${guidance}”.`);
        if (list.length) land(list);
        else setPhase("done");
      } catch {
        if (mine !== run.current) return;
        setPhase("review");
        setMessage(`${ASSISTANT_NAME} couldn't redraft. Your draft is as it was.`);
      }
    },
    [phase, ghosts, ask, land],
  );

  return {
    phase,
    ghosts: visible,
    own,
    load,
    cursor,
    setCursor,
    held,
    message,
    remaining: ghosts.length,
    hold,
    drop,
    version,
    setSpan,
    shift,
    stretch,
    rename,
    holdAll,
    discard,
    steer,
    retry: start,
  };
}

export type ProjectDraft = ReturnType<typeof useProjectDraft>;
