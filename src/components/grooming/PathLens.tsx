// The Path lens — grooming the HOW as an outline (docs/grooming-lenses.md §6).
// A reshaping of what already existed in the card deck: the human rattles off
// steps (StepComposer), Nuvo proposes only the GAPS (the deployed scaffold /
// blueprint enrich pass) and sizes each, so On Deck's capacity math stays
// honest. Closes the PLANNED axis: a project has open steps; a bet has key
// results or child projects to carry it.

import { useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { type Energy } from "../../lib/energy";
import {
  domainById,
  isOpenStatus,
  projectsOf,
  tasksOf,
  type Initiative,
  type Project,
  type SoundnessVerdict,
  type VerticalData,
} from "../../lib/vertical";
import { StepComposer, SuggestList, SuggRow, type StepLine } from "./StepComposer";

type Kind = "project" | "initiative";
type SuggTask = { title: string; energy: Energy | null; durationMins: number; on: boolean };
type SuggKR = { name: string; baseline: number; target: number; unit: string; on: boolean };
type SuggProj = { name: string; outcome: string; tasks: { title: string; energy: Energy | null; durationMins: number }[]; on: boolean };
type SuggTree = { keyResults: SuggKR[]; projects: SuggProj[] };

/** The duration ladder a tap cycles through — quick · focused · a block. */
const MINS_CYCLE = [20, 45, 90];

export default function PathLens({
  data, kind, item, verdict, onDone, doneLabel,
}: {
  data: VerticalData;
  kind: Kind;
  item: Project | Initiative;
  verdict: SoundnessVerdict | null;
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

  // ── the human's new lines + Nuvo's gap-fill ─────────────────────────────────
  const [lines, setLines] = useState<StepLine[]>([{ id: 0, text: "" }]);
  const [mins, setMins] = useState<Record<number, number>>({});
  const [desc, setDesc] = useState((item.description ?? "").trim());
  const [suggesting, setSuggesting] = useState(false);
  const [suggTasks, setSuggTasks] = useState<SuggTask[] | null>(null);
  const [suggTree, setSuggTree] = useState<SuggTree | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const stepTitles = lines.map((l) => l.text.trim()).filter(Boolean);

  const persistDesc = () => {
    const v = desc.trim();
    if (v === (item.description ?? "").trim()) return;
    if (isProject) store.updateProject(item.id, { description: v });
    else store.updateInitiative(item.id, { description: v });
  };

  // Nuvo's enrich pass — opt-in, on top of the human's own steps + what exists.
  const runSuggest = async () => {
    setSuggesting(true);
    setNote(null);
    persistDesc();
    try {
      const have = new Set([
        ...stepTitles.map((t) => t.toLowerCase()),
        ...existingTasks.map((t) => t.title.trim().toLowerCase()),
        ...childProjects.map((p) => p.name.trim().toLowerCase()),
      ]);
      if (isProject) {
        const { data: res, error } = await supabase.functions.invoke("agent", {
          body: { scaffold: { projectId: item.id, draftTitles: stepTitles, description: desc.trim() || undefined } },
        });
        if (error) throw error;
        const drafts = ((res as { tasks?: SuggTask[] })?.tasks ?? []) as SuggTask[];
        setSuggTasks(drafts.filter((d) => !have.has(d.title.trim().toLowerCase())).map((d) => ({ ...d, on: true })));
      } else {
        const { data: res, error } = await supabase.functions.invoke("agent", {
          body: { blueprint: { name: item.name, outcome: item.outcome, domainId: item.domainId, description: desc.trim() || undefined, draftProjectNames: stepTitles } },
        });
        if (error) throw error;
        const r = res as { keyResults?: SuggKR[]; projects?: SuggProj[] };
        const haveKR = new Set(keyResults.map((k) => k.name.trim().toLowerCase()));
        setSuggTree({
          keyResults: (r?.keyResults ?? []).filter((k) => !haveKR.has(String(k.name).trim().toLowerCase())).map((k) => ({ ...k, on: true })),
          projects: (r?.projects ?? []).filter((p) => !have.has(String(p.name).trim().toLowerCase())).map((p) => ({ ...p, on: true })),
        });
      }
    } catch (e) {
      console.warn("[path] suggest failed", e);
      setNote(`Couldn't reach ${ASSISTANT_NAME} — your own steps still work.`);
    } finally {
      setSuggesting(false);
    }
  };

  // ── accept — write the outline's new pieces ─────────────────────────────────
  const addCount =
    stepTitles.length +
    (isProject
      ? (suggTasks ?? []).filter((s) => s.on).length
      : (suggTree?.projects ?? []).filter((p) => p.on).length + (suggTree?.keyResults ?? []).filter((k) => k.on).length);

  const accept = async () => {
    if (!addCount || busy) return;
    setBusy(true);
    setNote(null);
    try {
      persistDesc();
      if (isProject) {
        const picks = [
          ...lines.filter((l) => l.text.trim()).map((l) => ({ title: l.text.trim(), energy: null as Energy | null, durationMins: mins[l.id] ?? 20 })),
          ...(suggTasks ?? []).filter((s) => s.on).map((s) => ({ title: s.title, energy: s.energy, durationMins: s.durationMins })),
        ];
        if (picks.length) await store.addTasks({ projectId: item.id, initiativeId: (item as Project).initiativeId, domainId: item.domainId }, picks);
      } else {
        const projects = [
          ...stepTitles.map((name) => ({ name, outcome: "", tasks: [] as { title: string; energy: Energy | null; durationMins: number }[] })),
          ...(suggTree?.projects ?? []).filter((p) => p.on).map((p) => ({ name: p.name, outcome: p.outcome, tasks: p.tasks })),
        ];
        const krs = (suggTree?.keyResults ?? []).filter((k) => k.on).map((k) => ({ name: k.name, baseline: k.baseline, target: k.target, unit: k.unit }));
        if (projects.length || krs.length) await store.addInitiativeSubtree(item.id, { keyResults: krs, projects });
      }
      setLines([{ id: 0, text: "" }]);
      setMins({});
      setSuggTasks(null);
      setSuggTree(null);
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

  const missing = verdict?.steps.verdict === "thin" ? verdict.steps.missing ?? [] : [];

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

      {/* Nuvo's thin-steps verdict, inline where it matters */}
      {missing.length > 0 && (
        <div className="mt-3 rounded-lg px-3.5 py-2.5" style={{ background: "var(--accent-soft)" }}>
          <p className="text-caption leading-relaxed text-ink/85">
            ✦ {verdict?.steps.note || "Thin on steps."} Missing: {missing.join(", ")}.
          </p>
        </div>
      )}

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

      {/* the composer — human first */}
      <div className="mt-5 space-y-3">
        <div className="section-label !px-0 !pb-0">{isProject ? (existingTasks.length ? "Add steps" : "Write the steps") : (childProjects.length || keyResults.length ? "Add structure" : "Name the structure")}</div>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={persistDesc}
          placeholder={`Context for ${ASSISTANT_NAME} — what is this, why now? (optional, sharpens its help)`}
          className="w-full rounded-md border border-line bg-bg px-3 py-2 text-caption outline-none focus:border-accent placeholder:text-muted/50"
        />
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
        {isProject
          ? suggTasks && suggTasks.length > 0 && (
              <SuggestList accent={accent} label="Steps you might be missing">
                {suggTasks.map((s, i) => (
                  <SuggRow key={i} on={s.on} accent={accent} title={s.title} meta={`${s.durationMins}m`}
                    onToggle={() => setSuggTasks((p) => (p ?? []).map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
                ))}
              </SuggestList>
            )
          : suggTree && (suggTree.keyResults.length > 0 || suggTree.projects.length > 0) && (
              <SuggestList accent={accent} label="Structure you might be missing">
                {suggTree.keyResults.map((k, i) => (
                  <SuggRow key={`k${i}`} on={k.on} accent={accent} title={k.name} meta={`${k.baseline}→${k.target}${k.unit}`}
                    onToggle={() => setSuggTree((t) => t && { ...t, keyResults: t.keyResults.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) })} />
                ))}
                {suggTree.projects.map((p, i) => (
                  <SuggRow key={`p${i}`} on={p.on} accent={accent} title={p.name} meta={p.tasks.length ? `${p.tasks.length} tasks` : ""}
                    onToggle={() => setSuggTree((t) => t && { ...t, projects: t.projects.map((x, j) => (j === i ? { ...x, on: !x.on } : x)) })} />
                ))}
              </SuggestList>
            )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void runSuggest()}
            disabled={suggesting}
            className="tap fast inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-meta text-muted hover:border-line-strong hover:text-ink disabled:opacity-50"
            title="Nuvo reads your steps + context and proposes only the gaps"
          >
            <span style={{ color: accent }}>✦</span>
            {suggesting ? `${ASSISTANT_NAME} is looking…` : isProject ? (suggTasks ? "Ask again" : "Suggest steps I'm missing") : (suggTree ? "Ask again" : "Suggest structure")}
          </button>
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
        </div>
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
