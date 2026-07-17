// Initiatives — the GROOM face. The initiative sibling of GroomWall (projects): the same
// deck you time-box onto quarters, flipped 90° into a wall of columns you shape in
// place. Where a project grooms on Defined · Planned · Fits (steps), an initiative grooms
// on its PRIME property — the OKR: a crisp Objective (the Defined axis) and
// measurable Key Results (the Measured axis). No modal, no one-at-a-time flow; the
// board IS the groom surface, and the readiness meter fills as you define + measure.
//
// Reuse-first: lanes come from allOpenInitiativeLanes (the same OKR/tending/lens
// rollup the quarter deck reads); the AI draft is the deployed draftOKRs (no new
// edge); the domain link is the deterministic suggestDomainForInitiative. This file
// only arranges them into a wall.

import { useRef, useState } from "react";
import { startOfQuarter } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useRecordContextMenu } from "../RecordContextMenu";
import {
  domainById,
  initiativeAttainment,
  krPct,
  type VerticalData,
} from "../../lib/vertical";
import {
  quarterEndISO,
  suggestDomainForInitiative,
  type InitiativeLane,
  type InitiativeLaneState,
} from "../../lib/initiativeDeck";
import { initiativeReadinessAxes } from "../../lib/lenses";
import { draftOKRs, type DraftKR } from "../../lib/draftOKRs";
import { judgeKeyResults, type KRRating, type KRVerdict } from "../../lib/judgeOKRs";
import { PROJECT_STATUS_COLORS, Bar, InlineNumber, InlineText } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";

const CAUTION = PROJECT_STATUS_COLORS.waiting;

// Tier color mirrors the quarter deck's card language: teal on-track, amber
// needs-work, faint idea, muted parked.
const STATE_COLOR: Record<InitiativeLaneState, string> = {
  on_track: READY,
  at_risk: "var(--signal)",
  needs_okrs: CAUTION,
  needs_shaping: CAUTION,
  idea: "var(--line-strong)",
  parked: "var(--muted)",
};

function InitiativeGroomCard({
  data,
  lane,
  onOpen,
}: {
  data: VerticalData;
  lane: InitiativeLane;
  onOpen: (id: string) => void;
}) {
  const store = useVertical();
  const { onContextMenu, menu } = useRecordContextMenu();
  const i = lane.initiative;
  const accent = domainById(data, i.domainId)?.color ?? "var(--accent)";
  const color = STATE_COLOR[lane.state];
  const axes = initiativeReadinessAxes(data, i); // { defined, planned(measured), fits:null }
  const attainment = initiativeAttainment(data, i);

  // ── the Objective — one crisp line; closes the Defined axis (with a finish line)
  const [objective, setObjective] = useState(i.outcome ?? "");
  const saveObjective = () => {
    const v = objective.trim();
    if (v !== (i.outcome ?? "").trim()) store.updateInitiative(i.id, { outcome: v });
  };

  // ── finish line — an initiative without one can't be Defined; quick-set to quarter's end
  const setDue = (iso: string | null) => store.updateInitiative(i.id, { targetDate: iso });

  // ── status: finish it (drops off the wall) or park it (rests, greys, sorts right)
  const [completing, setCompleting] = useState(false);
  const parked = lane.state === "parked";
  const markDone = () => {
    setCompleting(true);
    window.setTimeout(() => store.updateInitiative(i.id, { status: "complete" }), 240);
  };
  const togglePark = () => store.updateInitiative(i.id, { status: parked ? "in_progress" : "waiting" });

  // ── domain link — deterministic keyword match, one tap (mirrors the deck) ─────
  const suggestion = lane.needsDomain ? suggestDomainForInitiative(data, i) : null;
  const setDomain = (domainId: string) => {
    store.updateInitiative(i.id, { domainId });
    data.projects.filter((p) => p.initiativeId === i.id).forEach((p) => store.updateProject(p.id, { domainId }));
  };

  // ── AI · draft the OKR (objective + key results) — opt-in, on-demand ──────────
  const [proposedKRs, setProposedKRs] = useState<DraftKR[]>([]);
  const [proposedObj, setProposedObj] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const liveItem = useRef(i);
  liveItem.current = i;
  const norm = (s: string) => s.trim().toLowerCase();
  const draft = async () => {
    if (drafting) return;
    setDrafting(true);
    setAiNote(null);
    try {
      saveObjective();
      const res = await draftOKRs({ d: data, item: { ...liveItem.current, outcome: objective } });
      const have = new Set(liveItem.current.keyResults.map((k) => norm(k.name)));
      setProposedKRs((prev) => {
        const seen = new Set([...prev.map((k) => norm(k.name)), ...have]);
        return [...prev, ...res.keyResults.filter((k) => !seen.has(norm(k.name)))];
      });
      if (res.objective && norm(res.objective) !== norm(objective)) setProposedObj(res.objective);
      if (!res.keyResults.length && (!res.objective || norm(res.objective) === norm(objective))) {
        setAiNote("Nothing to add — these measures look complete.");
      }
    } catch (e) {
      console.warn("[groom] OKR draft failed", e);
      setAiNote("Couldn't reach Nuvo — set the measures by hand.");
    } finally {
      setDrafting(false);
    }
  };
  const acceptKR = (idx: number) => {
    const kr = proposedKRs[idx];
    if (kr) store.addKeyResult(i.id, kr);
    setProposedKRs((p) => p.filter((_, k) => k !== idx));
  };
  const acceptAllKRs = () => {
    proposedKRs.forEach((kr) => store.addKeyResult(i.id, kr));
    setProposedKRs([]);
  };
  const acceptObj = () => {
    if (proposedObj) {
      setObjective(proposedObj);
      store.updateInitiative(i.id, { outcome: proposedObj });
    }
    setProposedObj(null);
  };

  // ── fast inline add — type a measure, ⏎ commits it (like adding project steps)
  const [newKR, setNewKR] = useState("");
  const addResult = () => {
    const name = newKR.trim();
    if (!name) return;
    // sensible starting frame — refine the numbers inline once it lands.
    store.addKeyResult(i.id, { name, baseline: 0, current: 0, target: 100, unit: "%" });
    setNewKR("");
  };

  // ── AI · judge the measures — quality + feasibility, per result (not all OKRs
  //     are created equal). On-demand, non-mutating: it annotates, you sharpen.
  const [verdicts, setVerdicts] = useState<Record<string, KRVerdict>>({});
  const [judging, setJudging] = useState(false);
  const judge = async () => {
    if (judging || i.keyResults.length === 0) return;
    setJudging(true);
    try {
      const vs = await judgeKeyResults({ d: data, item: liveItem.current });
      setVerdicts((prev) => {
        const m = { ...prev };
        vs.forEach((v) => { m[v.id] = v; });
        return m;
      });
    } catch (e) {
      console.warn("[groom] OKR judge failed", e);
    } finally {
      setJudging(false);
    }
  };

  const slipping = lane.overdue || lane.atRisk.atRisk;
  const meter = [axes.defined, axes.planned]; // Defined · Measured
  const readyN = meter.filter(Boolean).length;

  return (
    <div
      onContextMenu={onContextMenu("initiative", i.id)}
      className="fast flex w-[404px] shrink-0 flex-col gap-4 rounded-2xl border bg-surface px-6 pb-5 pt-5"
      style={{
        borderColor: "var(--line)",
        boxShadow: "var(--shadow-lift)",
        opacity: completing ? 0 : parked ? 0.6 : 1,
        transform: completing ? "scale(.97)" : undefined,
      }}
    >
      {menu}
      {/* header — domain rail, done check, name, slip pill */}
      <div className="relative">
        <span className="absolute -left-5 top-0.5 h-[calc(100%-2px)] w-[3px] rounded-full" style={{ background: accent, opacity: 0.9 }} />
        <div className="flex items-start gap-2">
          <button
            onClick={markDone}
            aria-label="Mark initiative complete"
            title="Finished — mark complete"
            className={`group/chk fast mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${completing ? "bloom" : ""}`}
            style={completing ? { background: READY, borderColor: READY } : { borderColor: "var(--line-strong)" }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={completing ? "opacity-100" : "opacity-0 transition-opacity group-hover/chk:opacity-60"} style={{ color: completing ? "#fff" : READY }}>
              <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
          <button
            onClick={() => onOpen(i.id)}
            className="fast min-w-0 flex-1 text-left text-body font-semibold leading-snug text-ink hover:underline"
            title="Open the record"
          >
            {i.name}
          </button>
          {slipping && (
            <span
              className="mono shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium"
              style={{ background: "color-mix(in srgb, var(--signal) 14%, transparent)", color: "var(--signal)" }}
            >
              ⚠ {lane.overdue ? "overdue" : "at risk"}
            </span>
          )}
        </div>
        <div className="mt-0.5 pl-[26px] text-micro text-muted">
          {domainById(data, i.domainId)?.name ?? "no area"}
          {parked ? " · parked" : lane.state === "idea" ? " · no finish line" : lane.state === "needs_okrs" ? " · needs OKRs" : ""}
        </div>
      </div>

      {/* domain link — deterministic keyword match, one tap */}
      {suggestion && (
        <button
          onClick={() => setDomain(suggestion.domain.id)}
          className="flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5 text-left"
          style={{ borderColor: suggestion.domain.color, background: `${suggestion.domain.color}12` }}
          title="Link this initiative to its area"
        >
          <span>{suggestion.domain.icon}</span>
          <span className="min-w-0 flex-1 text-caption text-ink">
            Looks like <span className="font-semibold" style={{ color: suggestion.domain.color }}>{suggestion.domain.name}</span>
            <span className="text-muted"> · tap to link</span>
          </span>
        </button>
      )}

      {/* the Objective — one line that defines the win; closes the Defined axis */}
      <div className="-mx-1">
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          onBlur={saveObjective}
          rows={2}
          placeholder="The outcome, in one crisp line — what winning looks like…"
          className="fast w-full resize-none rounded-lg bg-transparent px-1.5 py-1.5 text-body leading-relaxed text-ink outline-none transition-colors placeholder:italic placeholder:text-muted/45 hover:bg-surface-2/60 focus:bg-surface-2"
        />
        {proposedObj && (
          <div className="mt-1 flex items-center gap-2 rounded-md border border-dashed px-2.5 py-1" style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--line))` }}>
            <span className="min-w-0 flex-1 py-0.5 text-caption leading-relaxed text-ink/80">{proposedObj}</span>
            <button onClick={acceptObj} className="tap fast shrink-0 rounded-md px-2 py-0.5 text-caption font-medium text-white active:scale-95" style={{ background: accent }}>✓</button>
            <button onClick={() => setProposedObj(null)} className="tap fast shrink-0 px-1 text-caption text-muted/70 hover:text-ink">✕</button>
          </div>
        )}
      </div>

      {/* the readiness meter — Defined · Measured (an initiative's two axes) + attainment */}
      <div>
        <div className="flex items-center gap-2.5">
          <span className="flex flex-1 items-center gap-1.5">
            {meter.map((met, k) => (
              <span key={k} className="h-[7px] flex-1 rounded-full transition-colors" style={{ background: met ? color : "var(--line)" }} />
            ))}
          </span>
          <span className="mono text-caption font-semibold" style={{ color: readyN === 2 ? color : "var(--muted)" }}>
            {readyN}/2
          </span>
        </div>
        <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wide text-muted">
          <span>defined</span>
          <span>measured</span>
        </div>
      </div>

      {/* finish line — quick-set when an initiative has none (Defined needs one) */}
      {!i.targetDate && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value=""
            onChange={(e) => setDue(e.target.value || null)}
            className="tap fast rounded-md border border-line bg-bg/40 px-2.5 py-1.5 text-caption outline-none focus:border-accent"
          />
          <button
            onClick={() => setDue(quarterEndISO(startOfQuarter(new Date())))}
            className="tap fast rounded-md border border-dashed px-2.5 py-1.5 text-caption text-muted hover:text-ink"
            style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--line))` }}
          >
            ✦ this quarter's end
          </button>
        </div>
      )}

      {/* the key results — the prime property, editable in place, each judged */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="section-label !p-0">Key results</span>
          {i.keyResults.length > 0 && (
            <span className="flex items-center gap-2.5">
              {attainment != null && <span className="mono text-micro" style={{ color: accent }}>{attainment}% attained</span>}
              <button
                onClick={() => void judge()}
                disabled={judging}
                className="mono fast text-micro font-medium disabled:opacity-50"
                style={{ color: "var(--accent)" }}
                title="Nuvo grades each measure on how measurable, specific, and feasible it is"
              >
                {judging ? "✦ judging…" : "✦ judge"}
              </button>
            </span>
          )}
        </div>

        {i.keyResults.map((kr) => {
          const v = verdicts[kr.id];
          return (
            <div key={kr.id} className="group/kr rounded-lg border border-line bg-surface-2/50 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <InlineText value={kr.name} onChange={(x) => store.updateKeyResult(i.id, kr.id, { name: x })} className="min-w-0 flex-1 text-caption font-medium" />
                <button
                  onClick={() => store.deleteKeyResult(i.id, kr.id)}
                  tabIndex={-1}
                  className="fast shrink-0 px-1 text-micro text-muted/50 opacity-0 transition-opacity hover:text-signal group-hover/kr:opacity-100"
                  title="Delete result"
                >
                  ✕
                </button>
              </div>
              <div className="mono mt-1 flex items-center gap-1 text-micro text-muted">
                <InlineNumber value={kr.baseline} onChange={(x) => store.updateKeyResult(i.id, kr.id, { baseline: x })} />
                <span>→</span>
                <span style={{ color: accent }}><InlineNumber value={kr.current} onChange={(x) => store.updateKeyResult(i.id, kr.id, { current: x })} /></span>
                <span>→</span>
                <InlineNumber value={kr.target} onChange={(x) => store.updateKeyResult(i.id, kr.id, { target: x })} />
                <InlineText value={kr.unit} onChange={(x) => store.updateKeyResult(i.id, kr.id, { unit: x })} placeholder="unit" className="ml-1 w-10" />
              </div>
              <Bar pct={krPct(kr)} color={accent} />
              {v && <VerdictLine verdict={v} />}
            </div>
          );
        })}

        {/* AI-proposed key results — dashed accent rows, accept or dismiss */}
        {proposedKRs.map((kr, k) => (
          <div key={`p${k}:${kr.name}`} className="rounded-lg border border-dashed px-2.5 py-2" style={{ borderColor: `color-mix(in srgb, ${accent} 45%, var(--line))` }}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-caption font-medium text-ink/85">{kr.name}</div>
                <div className="mono mt-0.5 text-micro text-muted">{kr.baseline} → {kr.target}{kr.unit}</div>
              </div>
              <button onClick={() => acceptKR(k)} className="tap fast shrink-0 rounded-md px-2 py-0.5 text-caption font-medium text-white active:scale-95" style={{ background: accent }}>✓</button>
              <button onClick={() => setProposedKRs((p) => p.filter((_, x) => x !== k))} className="tap fast shrink-0 px-1 text-caption text-muted/70 hover:text-ink">✕</button>
            </div>
          </div>
        ))}

        {i.keyResults.length === 0 && proposedKRs.length === 0 && (
          <div className="rounded-lg border border-dashed border-line px-3 py-2.5 text-center text-micro text-muted">
            No key results yet — the number this initiative moves. Type one below, or draft with Nuvo.
          </div>
        )}

        {/* inline composer — type a measure, ⏎ commits it (fast, like project steps) */}
        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 focus-within:border-accent">
          <span className="shrink-0 text-[9px]" style={{ color: accent }}>◇</span>
          <input
            value={newKR}
            onChange={(e) => setNewKR(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addResult(); } }}
            placeholder="Add a measure…  ⏎ to add"
            className="fast min-w-0 flex-1 bg-transparent text-caption text-ink outline-none placeholder:text-muted/50"
          />
          {newKR.trim() && (
            <button onClick={addResult} className="mono fast shrink-0 text-micro font-medium" style={{ color: accent }}>add ⏎</button>
          )}
        </div>
        {proposedKRs.length > 1 && (
          <button onClick={acceptAllKRs} className="tap fast mono self-start text-micro font-medium" style={{ color: accent }}>accept all suggestions</button>
        )}
      </div>

      {/* footer — draft with Nuvo / ready badge + Park */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {axes.defined && axes.planned ? (
          <span className="flex items-center gap-1.5 text-caption font-medium" style={{ color: READY }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: READY }} /> Measured & defined
          </span>
        ) : (
          <button
            onClick={() => void draft()}
            disabled={drafting}
            className="tap fast rounded-lg px-3 py-1.5 text-caption font-medium text-white active:scale-[.98] disabled:opacity-50"
            style={{ background: "var(--accent)" }}
            title="Nuvo drafts the objective + measurable key results — you adjudicate each"
          >
            {drafting ? "✦ drafting…" : "✦ Draft OKRs"}
          </button>
        )}
        <button
          onClick={togglePark}
          className="fast tap shrink-0 rounded-md px-2 py-1 text-micro font-medium text-muted hover:text-ink"
          title={parked ? "Bring it back onto the deck" : "Park it — rest it without finishing"}
        >
          {parked ? "Unpark" : "Park"}
        </button>
      </div>
      {aiNote && <div className="-mt-2 text-micro text-muted">{aiNote}</div>}
    </div>
  );
}

// One measure's verdict — a colored line under its bar: teal strong, amber fair,
// red weak, with the one-line critique.
function VerdictLine({ verdict }: { verdict: KRVerdict }) {
  const tone: Record<KRRating, { color: string; label: string }> = {
    strong: { color: READY, label: "strong" },
    fair: { color: CAUTION, label: "fair" },
    weak: { color: "var(--signal)", label: "weak" },
  };
  const t = tone[verdict.rating];
  return (
    <div className="mono mt-1.5 flex items-start gap-1.5 text-micro">
      <span className="shrink-0 font-medium" style={{ color: t.color }}>✦ {t.label}</span>
      {verdict.note && <span className="min-w-0 text-muted">— {verdict.note}</span>}
    </div>
  );
}

export default function InitiativeGroomWall({ lanes, onOpen }: { lanes: InitiativeLane[]; onOpen: (id: string) => void }) {
  const { data } = useVertical();
  // Thinnest-first: the rawest initiatives sort left (fewest axes met), parked settle
  // right (resting by choice).
  const met = (l: InitiativeLane) => initiativeReadinessAxes(data, l.initiative);
  const score = (l: InitiativeLane) => [met(l).defined, met(l).planned].filter(Boolean).length;
  const ordered = [...lanes].sort((a, b) => {
    const pk = (l: InitiativeLane) => (l.state === "parked" ? 1 : 0);
    return pk(a) - pk(b) || score(a) - score(b) || a.initiative.name.localeCompare(b.initiative.name);
  });

  if (ordered.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-line px-4 py-10 text-center text-caption text-muted">
        No initiatives to groom — every initiative is shaped, or make a new one from the On Deck rail.
      </div>
    );
  }

  return (
    <div className="mt-5 flex gap-6 overflow-x-auto pb-3">
      {ordered.map((l) => (
        <InitiativeGroomCard key={l.initiative.id} data={data} lane={l} onOpen={onOpen} />
      ))}
    </div>
  );
}
