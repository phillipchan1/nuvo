// "Groom with Nuvo" — a light, reviewable tidy for a project. Two jobs only:
//   1. Proofread — tighten the wording of existing task titles (AI, via the
//      `refine` endpoint; we use its `edits` and ignore anything else).
//   2. Route — if Nuvo is confident, propose moving the project to the domain /
//      initiative it clearly belongs under (offline token match, gated high).
// It never invents tasks. Proposes only — nothing changes until "Apply".

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import { useVertical, type TaskParent } from "../../hooks/useVertical";
import { projectById, type VTask } from "../../lib/vertical";
import { suggestRouteForProject } from "../../lib/initiativeDeck";

interface RefineEdit { id: string; original: string; title: string; reason?: string }

export default function TaskRefine({
  projectId,
  accent,
  onClose,
}: {
  projectId: string;
  parent: TaskParent;
  tasks: VTask[];
  accent: string;
  onClose: () => void;
}) {
  const { data, updateTask, updateProject } = useVertical();
  const project = projectById(data, projectId);
  const [edits, setEdits] = useState<RefineEdit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // which proposals are kept (default: all)
  const [keepEdits, setKeepEdits] = useState<Set<string>>(new Set());
  const [keepDomain, setKeepDomain] = useState(true);
  const [keepInitiative, setKeepInitiative] = useState(true);

  // Routing is offline + instant — compute it up front from the project's text.
  const route = project ? suggestRouteForProject(data, project) : { domain: null, initiative: null };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: res, error: fnErr } = await supabase.functions.invoke<{ edits?: RefineEdit[] }>("agent", {
          body: { refine: { projectId } },
        });
        if (fnErr) throw fnErr;
        if (cancelled) return;
        const e = res?.edits ?? [];
        setEdits(e);
        setKeepEdits(new Set(e.map((x) => x.id)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Groom failed");
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const nothing = edits !== null && edits.length === 0 && !route.domain && !route.initiative;

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };

  const apply = async () => {
    if (!edits || applying || !project) return;
    setApplying(true);
    try {
      const kept = edits.filter((e) => keepEdits.has(e.id));
      kept.forEach((e) => updateTask(e.id, { title: e.title }));

      let moves = 0;
      // Attaching to an initiative carries the project into that initiative's
      // domain too, so the spine stays consistent.
      if (route.initiative && keepInitiative) {
        updateProject(project.id, {
          initiativeId: route.initiative.initiative.id,
          domainId: route.initiative.initiative.domainId,
        });
        moves++;
      } else if (route.domain && keepDomain) {
        updateProject(project.id, { domainId: route.domain.domain.id });
        moves++;
      }

      const n = kept.length + moves;
      toast(n ? "Project groomed." : "No changes applied.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply");
      setApplying(false);
    }
  };

  const keptCount =
    keepEdits.size +
    (route.initiative && keepInitiative ? 1 : route.domain && keepDomain ? 1 : 0);

  return (
    <div className="glass-card mt-2 rounded-[var(--radius)] border border-line p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="mono text-micro font-semibold tracking-widest" style={{ color: accent }}>✦ NUVO GROOM</span>
        <div className="h-px flex-1" style={{ background: "var(--line)" }} />
        <button onClick={onClose} className="fast text-meta text-muted hover:text-ink" title="Dismiss">✕</button>
      </div>

      {error && <p className="text-label text-signal">{error}</p>}

      {!edits && !error && (
        <p className="flex items-center gap-2 text-label text-muted">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line border-t-current" style={{ color: accent }} />
          Proofreading the task wording…
        </p>
      )}

      {nothing && <p className="text-label text-muted">Nothing to groom — wording reads clean and it's well filed. ✓</p>}

      {edits && !nothing && (
        <div className="space-y-4">
          {edits.length > 0 && (
            <RefineSection title="Tighten wording">
              {edits.map((e) => (
                <Row key={e.id} checked={keepEdits.has(e.id)} onToggle={() => setKeepEdits((s) => toggle(s, e.id))} accent={accent}>
                  <span className="text-caption text-muted line-through">{e.original}</span>
                  <span className="text-caption">→ {e.title}</span>
                  {e.reason && <span className="mono text-micro text-muted">{e.reason}</span>}
                </Row>
              ))}
            </RefineSection>
          )}

          {(route.domain || route.initiative) && (
            <RefineSection title="File it right">
              {route.initiative ? (
                <Row checked={keepInitiative} onToggle={() => setKeepInitiative((v) => !v)} accent={accent}>
                  <span className="text-caption">Attach to</span>
                  <span className="text-caption font-medium" style={{ color: accent }}>{route.initiative.initiative.name}</span>
                  <span className="mono text-micro text-muted">initiative · confident match</span>
                </Row>
              ) : route.domain ? (
                <Row checked={keepDomain} onToggle={() => setKeepDomain((v) => !v)} accent={accent}>
                  <span className="text-caption">Move to</span>
                  <span className="text-caption font-medium" style={{ color: route.domain.domain.color }}>
                    {route.domain.domain.icon} {route.domain.domain.name}
                  </span>
                  <span className="mono text-micro text-muted">domain · confident match</span>
                </Row>
              ) : null}
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
