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
import DomainSymbol from "../domain/DomainSymbol";
import { Icon } from "../Icon";
import { Button, Checkbox, IconButton } from "../kit";

interface RefineEdit { id: string; original: string; title: string; reason?: string }

export default function TaskRefine({
  projectId,
  onClose,
}: {
  projectId: string;
  parent: TaskParent;
  tasks: VTask[];
  /** @deprecated the diff wears the kit's accent now — kept for call-site compat. */
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
    <div className="fl-panel mt-2">
      <div className="fl-panel-head">
        <span className="inline-flex" style={{ color: "var(--accent)" }}>
          <Icon name="sparkles" size={13} />
        </span>
        <span>Groom with Nuvo</span>
        <span className="k-grow" />
        <IconButton size="xs" label="Dismiss" icon={<Icon name="close" size={13} />} onClick={onClose} />
      </div>

      {error && <p className="fl-note" style={{ color: "var(--danger)" }}>{error}</p>}

      {!edits && !error && <p className="fl-note">Proofreading the wording…</p>}

      {nothing && <p className="fl-note">Nothing to groom — the wording reads clean and it's well filed.</p>}

      {edits && !nothing && (
        <div className="grid gap-4">
          {edits.length > 0 && (
            <RefineSection title="Tighten wording">
              {edits.map((e) => (
                <Row key={e.id} checked={keepEdits.has(e.id)} onToggle={() => setKeepEdits((s) => toggle(s, e.id))} label={e.title}>
                  <span className="text-caption text-muted line-through">{e.original}</span>
                  <span className="text-body">→ {e.title}</span>
                  {e.reason && <span className="text-caption text-muted">{e.reason}</span>}
                </Row>
              ))}
            </RefineSection>
          )}

          {(route.domain || route.initiative) && (
            <RefineSection title="File it right">
              {route.initiative ? (
                <Row checked={keepInitiative} onToggle={() => setKeepInitiative((v) => !v)} label={`Attach to ${route.initiative.initiative.name}`}>
                  <span className="text-body">Attach to</span>
                  <span className="text-body font-semibold">{route.initiative.initiative.name}</span>
                  <span className="text-caption text-muted">initiative · confident match</span>
                </Row>
              ) : route.domain ? (
                <Row checked={keepDomain} onToggle={() => setKeepDomain((v) => !v)} label={`Move to ${route.domain.domain.name}`}>
                  <span className="text-body">Move to</span>
                  <span className="flex items-center gap-1 text-body font-semibold">
                    <span className="inline-flex" style={{ color: route.domain.domain.color }}>
                      <DomainSymbol value={route.domain.domain.icon} size={14} />
                    </span>
                    {route.domain.domain.name}
                  </span>
                  <span className="text-caption text-muted">domain · confident match</span>
                </Row>
              ) : null}
            </RefineSection>
          )}

          <div className="fl-work-row">
            <Button kind="primary" size="xs" className="tap" onClick={apply} disabled={applying || keptCount === 0}>
              {applying ? "Applying…" : `Apply ${keptCount}`}
            </Button>
            <Button kind="ghost" size="xs" className="tap" onClick={onClose}>Dismiss</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RefineSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="fl-label">{title}</span>
      <div className="grid gap-0.5">{children}</div>
    </div>
  );
}

function Row({
  checked,
  onToggle,
  label,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="mt-[2px] inline-flex">
        <Checkbox checked={checked} onChange={onToggle} label={label} />
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">{children}</span>
    </div>
  );
}
