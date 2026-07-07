// The Path lens — grooming the HOW as a plain outline (docs/grooming-lenses.md §6).
// You rattle off the steps yourself. Nuvo no longer proposes subtasks: it was too
// often wrong / not context-aware, and authoring the work is the human's job
// (Nuvo enriches, it doesn't invent the task list). Closes the PLANNED axis: a
// project has open steps; a bet has key results or child projects to carry it.

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { type Energy } from "../../lib/energy";
import {
  domainById,
  isOpenStatus,
  projectsOf,
  tasksOf,
  type Initiative,
  type Project,
  type VerticalData,
} from "../../lib/vertical";
import { StepComposer, type StepLine } from "./StepComposer";

type Kind = "project" | "initiative";

/** The duration ladder a tap cycles through — quick · focused · a block. */
const MINS_CYCLE = [20, 45, 90];

export default function PathLens({
  data, kind, item, onDone, doneLabel,
}: {
  data: VerticalData;
  kind: Kind;
  item: Project | Initiative;
  onDone: () => void;
  doneLabel: string;
}) {
  const store = useVertical();
  const isProject = kind === "project";
  const accent = domainById(data, item.domainId)?.color ?? "var(--accent)";

  // ── what already exists — the outline's spine ───────────────────────────────
  const existingTasks = useMemo(
    () => (isProject ? tasksOf(data, item.id).filter((t) => t.status !== "done") : []),
    [data, item.id, isProject],
  );
  const childProjects = useMemo(
    () => (!isProject ? projectsOf(data, item.id).filter((p) => isOpenStatus(p.status)) : []),
    [data, item.id, isProject],
  );
  const keyResults = !isProject ? (item as Initiative).keyResults : [];
  const planned = isProject ? existingTasks.length > 0 : keyResults.length > 0 || childProjects.length > 0;

  // ── the human's own lines ───────────────────────────────────────────────────
  const [lines, setLines] = useState<StepLine[]>([{ id: 0, text: "" }]);
  const [mins, setMins] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const stepTitles = lines.map((l) => l.text.trim()).filter(Boolean);
  const addCount = stepTitles.length;

  const accept = async () => {
    if (!addCount || busy) return;
    setBusy(true);
    setNote(null);
    try {
      if (isProject) {
        const picks = lines
          .filter((l) => l.text.trim())
          .map((l) => ({ title: l.text.trim(), energy: null as Energy | null, durationMins: mins[l.id] ?? 20 }));
        if (picks.length) await store.addTasks({ projectId: item.id, initiativeId: (item as Project).initiativeId, domainId: item.domainId }, picks);
      } else {
        const projects = stepTitles.map((name) => ({ name, outcome: "", tasks: [] as { title: string; energy: Energy | null; durationMins: number }[] }));
        if (projects.length) await store.addInitiativeSubtree(item.id, { keyResults: [], projects });
      }
      setLines([{ id: 0, text: "" }]);
      setMins({});
    } catch (e) {
      console.warn("[path] accept failed", e);
      setNote("Couldn't save that — try again.");
    } finally {
      setBusy(false);
    }
  };

  const cycleMins = (id: number) =>
    setMins((m) => {
      const cur = m[id] ?? 20;
      const next = MINS_CYCLE[(MINS_CYCLE.indexOf(cur) + 1) % MINS_CYCLE.length];
      return { ...m, [id]: next };
    });

  return (
    <div className="pt-3 pb-8">
      <div className="section-label" style={{ color: "var(--accent)" }}>The Path · how it gets done</div>
      <div className="mt-1 flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
        <h1 className="min-w-0 text-lead masthead leading-tight">{item.name}</h1>
      </div>
      {item.outcome.trim() && <p className="mt-1.5 text-caption leading-relaxed text-muted">{item.outcome}</p>}

      {/* the Planned axis, live */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-full px-2 py-0.5 text-meta font-medium"
          style={
            planned
              ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" }
              : { border: "1px solid var(--line)", color: "var(--muted)" }
          }
        >
          {planned ? "✓ " : ""}{isProject ? `Steps${existingTasks.length ? ` · ${existingTasks.length} open` : ""}` : `Structure${keyResults.length + childProjects.length ? ` · ${keyResults.length + childProjects.length}` : ""}`}
        </span>
        {planned && <span className="text-meta font-medium" style={{ color: "var(--accent)" }}>— planned</span>}
      </div>

      {/* the outline — what already exists */}
      {(existingTasks.length > 0 || keyResults.length > 0 || childProjects.length > 0) && (
        <div className="mt-5">
          <div className="section-label !px-0 !pb-1">{isProject ? "The steps so far" : "The structure so far"}</div>
          <div>
            {keyResults.map((k) => (
              <div key={k.id} className="flex items-baseline gap-2.5 border-b border-line py-2">
                <span className="shrink-0 text-[10px]" style={{ color: accent }}>◎</span>
                <span className="min-w-0 flex-1 truncate text-body">{k.name}</span>
                <span className="mono shrink-0 text-micro text-muted">{k.baseline}→{k.target}{k.unit}</span>
              </div>
            ))}
            {childProjects.map((p) => (
              <div key={p.id} className="flex items-baseline gap-2.5 border-b border-line py-2">
                <span className="shrink-0 text-[10px]" style={{ color: accent }}>▸</span>
                <span className="min-w-0 flex-1 truncate text-body">{p.name}</span>
                <span className="mono shrink-0 text-micro text-muted">{tasksOf(data, p.id).filter((t) => t.status !== "done").length} open</span>
              </div>
            ))}
            {existingTasks.map((t) => (
              <div key={t.id} className="flex items-baseline gap-2.5 border-b border-line py-2">
                <span className="shrink-0 text-[10px]" style={{ color: accent }}>◦</span>
                <span className="min-w-0 flex-1 truncate text-body">{t.title}</span>
                <span className="mono shrink-0 text-micro text-muted">{t.durationMins}m</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* the composer — you write the steps */}
      <div className="mt-5 space-y-3">
        <div className="section-label !px-0 !pb-0">{isProject ? (existingTasks.length ? "Add steps" : "Write the steps") : (childProjects.length || keyResults.length ? "Add structure" : "Name the structure")}</div>
        <StepComposer
          lines={lines}
          setLines={setLines}
          accent={accent}
          placeholder={isProject ? "Write your first step…  ⏎ for the next" : "Name a project under this bet…  ⏎ for the next"}
          meta={(line) => (
            <button
              onClick={() => cycleMins(line.id)}
              tabIndex={-1}
              className="mono fast shrink-0 rounded px-1.5 py-0.5 text-micro text-muted hover:text-ink"
              title="Tap to resize — 20m · 45m · 90m"
            >
              {mins[line.id] ?? 20}m
            </button>
          )}
        />
        {addCount > 0 && (
          <button
            onClick={() => void accept()}
            disabled={busy}
            className="tap fast rounded-md px-3.5 py-1.5 text-caption font-medium text-white active:scale-[.98] disabled:opacity-50"
            style={{ background: accent }}
          >
            {busy ? "…" : isProject ? `Add ${addCount} step${addCount === 1 ? "" : "s"}` : `Build ${addCount}`}
          </button>
        )}
        {note && <div className="text-label text-muted">{note}</div>}
      </div>

      {/* the handoff */}
      <button
        onClick={onDone}
        className="tap fast mt-7 w-full rounded-xl py-3 text-body font-medium text-white active:scale-[.98]"
        style={{ background: "var(--accent)" }}
      >
        {doneLabel}
      </button>
    </div>
  );
}
