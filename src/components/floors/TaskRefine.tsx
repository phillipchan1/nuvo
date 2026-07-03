// "Refine with Nuvo" — a reviewable diff over a project's backlog. One call to
// the agent's `refine` endpoint returns three kinds of proposal (wording fixes,
// missing steps, a sensible order); the user ticks what to keep and applies in
// one pass. Proposes only — nothing changes until "Apply" (the agent proposes,
// the user promotes). Gated on a real projectId by the caller.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import { useVertical, type TaskParent } from "../../hooks/useVertical";
import type { VTask } from "../../lib/vertical";

interface RefineEdit { id: string; original: string; title: string; reason?: string }
interface RefineAddition { title: string; energy: VTask["energy"]; durationMins: number; rationale?: string }
interface RefineResult { edits: RefineEdit[]; additions: RefineAddition[]; order: string[] }

export default function TaskRefine({
  projectId,
  parent,
  tasks,
  accent,
  onClose,
}: {
  projectId: string;
  parent: TaskParent;
  tasks: VTask[];
  accent: string;
  onClose: () => void;
}) {
  const { updateTask, addTasks, reorderTasks } = useVertical();
  const [result, setResult] = useState<RefineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // which proposals are kept (default: all)
  const [keepEdits, setKeepEdits] = useState<Set<string>>(new Set());
  const [keepAdds, setKeepAdds] = useState<Set<number>>(new Set());
  const [keepOrder, setKeepOrder] = useState(true);

  const titleById = (id: string) => tasks.find((t) => t.id === id)?.title || "untitled";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke<RefineResult>("agent", {
          body: { refine: { projectId } },
        });
        if (fnErr) throw fnErr;
        if (cancelled) return;
        const r: RefineResult = {
          edits: data?.edits ?? [],
          additions: data?.additions ?? [],
          order: data?.order ?? [],
        };
        setResult(r);
        setKeepEdits(new Set(r.edits.map((e) => e.id)));
        setKeepAdds(new Set(r.additions.map((_, i) => i)));
        setKeepOrder(r.order.length > 0);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Groom failed");
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const nothing =
    result !== null &&
    result.edits.length === 0 &&
    result.additions.length === 0 &&
    result.order.length === 0;

  const toggle = <T,>(set: Set<T>, key: T): Set<T> => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };

  const apply = async () => {
    if (!result || applying) return;
    setApplying(true);
    try {
      const edits = result.edits.filter((e) => keepEdits.has(e.id));
      const adds = result.additions.filter((_, i) => keepAdds.has(i));
      edits.forEach((e) => updateTask(e.id, { title: e.title }));
      if (keepOrder && result.order.length) reorderTasks(result.order);
      if (adds.length) {
        await addTasks(
          parent,
          adds.map((a) => ({ title: a.title, energy: a.energy, durationMins: a.durationMins })),
        );
      }
      const n = edits.length + adds.length + (keepOrder && result.order.length ? 1 : 0);
      toast(n ? "Backlog groomed." : "No changes applied.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply");
      setApplying(false);
    }
  };

  const keptCount =
    keepEdits.size + keepAdds.size + (keepOrder && (result?.order.length ?? 0) > 0 ? 1 : 0);

  return (
    <div className="glass-card mt-2 rounded-[var(--radius)] border border-line p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="mono text-micro font-semibold tracking-widest" style={{ color: accent }}>✦ NUVO GROOM</span>
        <div className="h-px flex-1" style={{ background: "var(--line)" }} />
        <button onClick={onClose} className="fast text-meta text-muted hover:text-ink" title="Dismiss">✕</button>
      </div>

      {error && <p className="text-label text-signal">{error}</p>}

      {!result && !error && (
        <p className="flex items-center gap-2 text-label text-muted">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line border-t-current" style={{ color: accent }} />
          Reading the project and its tasks…
        </p>
      )}

      {nothing && <p className="text-label text-muted">Nothing to groom — this backlog already reads clean. ✓</p>}

      {result && !nothing && (
        <div className="space-y-4">
          {result.edits.length > 0 && (
            <RefineSection title="Tighten wording">
              {result.edits.map((e) => (
                <Row key={e.id} checked={keepEdits.has(e.id)} onToggle={() => setKeepEdits((s) => toggle(s, e.id))} accent={accent}>
                  <span className="text-caption text-muted line-through">{e.original}</span>
                  <span className="text-caption">→ {e.title}</span>
                  {e.reason && <span className="mono text-micro text-muted">{e.reason}</span>}
                </Row>
              ))}
            </RefineSection>
          )}

          {result.additions.length > 0 && (
            <RefineSection title="Add missing steps">
              {result.additions.map((a, i) => (
                <Row key={i} checked={keepAdds.has(i)} onToggle={() => setKeepAdds((s) => toggle(s, i))} accent={accent}>
                  <span className="text-caption">{a.title}</span>
                  <span className="mono text-micro text-muted">{a.durationMins}m{a.rationale ? ` · ${a.rationale}` : ""}</span>
                </Row>
              ))}
            </RefineSection>
          )}

          {result.order.length > 0 && (
            <RefineSection title="Suggested order">
              <Row checked={keepOrder} onToggle={() => setKeepOrder((v) => !v)} accent={accent}>
                <ol className="ml-1 list-decimal space-y-0.5 pl-4 text-caption text-muted">
                  {result.order.map((id) => <li key={id}>{titleById(id)}</li>)}
                </ol>
              </Row>
            </RefineSection>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={apply}
              disabled={applying || keptCount === 0}
              className="fast rounded-md border px-2.5 py-1 text-meta font-medium disabled:opacity-40"
              style={{ borderColor: `${accent}55`, color: accent, background: `${accent}12` }}
            >
              {applying ? "Applying…" : `Apply ${keptCount}`}
            </button>
            <button onClick={onClose} className="fast text-meta text-muted hover:text-ink">Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RefineSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="section-label mb-1">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  checked,
  onToggle,
  accent,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-accent-soft">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
        style={{ accentColor: accent }}
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">{children}</span>
    </label>
  );
}
