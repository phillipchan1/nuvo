// Initiatives → Groom — the Board (D-190), the initiative sibling of GroomWall.
// A column per tier — Raw · Grooming · Ready, and Parked — by how many of an
// initiative's two axes are met: Defined (a crisp objective with a finish
// line) and Measured (key results). Each initiative is one kit Card: its title,
// the two checks met (filled) and missing (faint), a meta row of chips.
//
// Pick a card and it opens in place into its workbench — the objective, the
// finish line, the key results (editable, each judged on demand), Nuvo's draft,
// Park and Done. A picked card holds its column while you work in it.
//
// Reuse-first: lanes come from allOpenInitiativeLanes (the same OKR/tending/lens
// rollup the quarter deck reads); the AI draft is the deployed draftOKRs (no new
// edge); the domain link is the deterministic suggestDomainForInitiative. This
// file only arranges them.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { format, startOfQuarter } from "date-fns";
import { Icon } from "../Icon";
import { useVertical } from "../../hooks/useVertical";
import { useRecordContextMenu } from "../RecordContextMenu";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { domainById, initiativeAttainment, krPct, type VerticalData } from "../../lib/vertical";
import { quarterEndISO, suggestDomainForInitiative, type InitiativeLane } from "../../lib/initiativeDeck";
import { initiativeReadinessAxes } from "../../lib/lenses";
import { draftOKRs, type DraftKR } from "../../lib/draftOKRs";
import { judgeKeyResults, type KRRating, type KRVerdict } from "../../lib/judgeOKRs";
import { Bar, InlineNumber, InlineText } from "../floors/parts";
import { isTypingIn } from "../../lib/a11y";
import DomainSymbol from "../domain/DomainSymbol";
import { Button, Card, Chip, EmptyState, IconButton, type ReadinessStep } from "../kit";
import { CardCheck, ColumnHead } from "./GroomWall";

export type InitiativeTier = "raw" | "grooming" | "ready" | "parked";

/** How groomed an initiative is: parked, else by how many of its two axes
 *  (Defined · Measured) are met — 0 raw, 1 grooming, 2 ready. The Groom head's
 *  hero counts with this too, so the hero and the columns agree. */
export function initiativeTier(data: VerticalData, lane: InitiativeLane): InitiativeTier {
  if (lane.state === "parked") return "parked";
  const a = initiativeReadinessAxes(data, lane.initiative);
  const met = (a.defined ? 1 : 0) + (a.planned ? 1 : 0);
  return met === 2 ? "ready" : met === 1 ? "grooming" : "raw";
}

const COLUMNS: { tier: InitiativeTier; label: string; step: ReadinessStep | null }[] = [
  { tier: "raw", label: "Raw", step: 0 },
  { tier: "grooming", label: "Grooming", step: 2 },
  { tier: "ready", label: "Ready", step: 3 },
  { tier: "parked", label: "Parked", step: null },
];

function InitiativeGroomCard({
  data,
  lane,
  selected,
  onSelect,
  onOpen,
}: {
  data: VerticalData;
  lane: InitiativeLane;
  selected: boolean;
  onSelect: () => void;
  onOpen: (id: string) => void;
}) {
  const store = useVertical();
  const { onContextMenu, menu } = useRecordContextMenu();
  const i = lane.initiative;
  const domain = domainById(data, i.domainId);
  const accent = domain?.color ?? "var(--accent)";
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
        setAiNote("Nothing to add.");
      }
    } catch (e) {
      console.warn("[groom] OKR draft failed", e);
      setAiNote("Couldn't reach Nuvo.");
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

  const due = i.targetDate ? format(new Date(i.targetDate + "T00:00:00"), "MMM d") : null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.key !== "Enter") return;
    e.preventDefault();
    if (selected) onOpen(i.id);
    else onSelect();
  };

  return (
    <Card
      interactive
      selected={selected}
      tabIndex={0}
      aria-label={i.name}
      aria-expanded={selected}
      data-parked={parked ? "" : undefined}
      data-leaving={completing ? "" : undefined}
      className="fl-card"
      onClick={(e) => {
        // a click from a portal (the record menu) isn't a pick
        if (!selected && e.currentTarget.contains(e.target as Node)) onSelect();
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, input, textarea, [contenteditable=true], [role=textbox]")) return;
        onOpen(i.id);
      }}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu("initiative", i.id)}
    >
      {menu}
      <div className="fl-card-top">
        <div className="fl-card-title">{i.name}</div>
        {selected && (
          <div className="fl-card-acts">
            <IconButton size="xs" label="Open the record" icon={<ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />} onClick={() => onOpen(i.id)} />
          </div>
        )}
      </div>

      <div className="fl-checks">
        <CardCheck met={axes.defined}>Objective</CardCheck>
        <CardCheck met={axes.planned}>{i.keyResults.length ? `Key results · ${i.keyResults.length}` : "Key results"}</CardCheck>
      </div>

      <div className="fl-meta">
        {domain ? <Chip dot={domain.color}>{domain.name}</Chip> : <Chip>No domain</Chip>}
        {due && (
          <Chip tone={lane.overdue ? "danger" : "neutral"} icon={<Icon name="calendar" size={12} />}>
            {due}
          </Chip>
        )}
        {attainment != null && <span className="fl-meta-fact">{attainment}% attained</span>}
        {lane.atRisk.atRisk && !lane.overdue && <Chip title={lane.atRisk.reasons[0]}>At risk</Chip>}
      </div>

      {selected && (
        <div className="fl-work" onClick={(e) => e.stopPropagation()}>
          {/* domain link — deterministic keyword match, one tap */}
          {suggestion && (
            <div className="fl-propose" data-dashed="">
              <div className="flex items-center gap-2">
                <span className="inline-flex" style={{ color: suggestion.domain.color }}>
                  <DomainSymbol value={suggestion.domain.icon} size={14} />
                </span>
                <span>
                  Looks like <span className="font-semibold">{suggestion.domain.name}</span>
                </span>
              </div>
              <div className="fl-work-row">
                <Button kind="primary" size="xs" className="tap" onClick={() => setDomain(suggestion.domain.id)} title="Link this initiative to its area">
                  Link it
                </Button>
              </div>
            </div>
          )}

          {/* the Objective — one line that defines the win; closes the Defined axis */}
          <div className="grid gap-1.5">
            <div className="k-field fl-tight" data-multiline="">
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                onBlur={saveObjective}
                rows={2}
                placeholder="What winning looks like"
                aria-label="Objective"
              />
            </div>
            {proposedObj && (
              <div className="fl-propose" data-dashed="">
                <div>{proposedObj}</div>
                <div className="fl-work-row">
                  <Button kind="primary" size="xs" className="tap" onClick={acceptObj}>Use this</Button>
                  <Button kind="ghost" size="xs" className="tap" onClick={() => setProposedObj(null)}>Keep mine</Button>
                </div>
              </div>
            )}
          </div>

          {/* finish line — quick-set when an initiative has none (Defined needs one) */}
          {!i.targetDate && (
            <div className="fl-work-row">
              <div className="k-field" data-size="sm" style={{ width: "auto" }}>
                <input type="date" value="" onChange={(e) => setDue(e.target.value || null)} aria-label="Finish line" />
              </div>
              <Button kind="ghost" size="sm" className="tap" onClick={() => setDue(quarterEndISO(startOfQuarter(new Date())))}>
                This quarter's end
              </Button>
            </div>
          )}

          {/* the key results — the prime property, editable in place, each judged */}
          <div className="grid gap-2">
            <div className="fl-work-row">
              <span className="fl-label">Key results</span>
              <span className="k-grow" />
              {i.keyResults.length > 0 && (
                <Button
                  kind="ghost"
                  size="xs"
                  icon={<Icon name="sparkles" size={13} />}
                  onClick={() => void judge()}
                  disabled={judging}
                  title="Nuvo grades each measure on how measurable, specific, and feasible it is"
                >
                  {judging ? "Judging…" : "Judge"}
                </Button>
              )}
            </div>

            {i.keyResults.map((kr) => {
              const v = verdicts[kr.id];
              return (
                <div key={kr.id} className="fl-kr">
                  <div className="flex items-center gap-2">
                    <InlineText value={kr.name} onChange={(x) => store.updateKeyResult(i.id, kr.id, { name: x })} className="min-w-0 flex-1 text-caption font-medium" />
                    <IconButton
                      className="fl-kr-del"
                      size="xs"
                      label="Delete result"
                      icon={<Icon name="close" size={12} />}
                      tabIndex={-1}
                      onClick={() => store.deleteKeyResult(i.id, kr.id)}
                    />
                  </div>
                  <div className="fl-kr-nums">
                    <InlineNumber value={kr.baseline} onChange={(x) => store.updateKeyResult(i.id, kr.id, { baseline: x })} />
                    <span>→</span>
                    <span style={{ color: "var(--ink)" }}>
                      <InlineNumber value={kr.current} onChange={(x) => store.updateKeyResult(i.id, kr.id, { current: x })} />
                    </span>
                    <span>→</span>
                    <InlineNumber value={kr.target} onChange={(x) => store.updateKeyResult(i.id, kr.id, { target: x })} />
                    <InlineText value={kr.unit} onChange={(x) => store.updateKeyResult(i.id, kr.id, { unit: x })} placeholder="unit" className="ml-1 min-w-[2.5rem] whitespace-nowrap" />
                  </div>
                  <Bar pct={krPct(kr)} color={accent} h={1} />
                  {v && <VerdictLine verdict={v} />}
                </div>
              );
            })}

            {/* Nuvo-proposed key results — dashed, accept or dismiss */}
            {proposedKRs.map((kr, k) => (
              <div key={`p${k}:${kr.name}`} className="fl-propose" data-dashed="">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{kr.name}</div>
                    <div className="fl-kr-nums mt-1">
                      {kr.baseline} → {kr.target}
                      {kr.unit}
                    </div>
                  </div>
                  <Button kind="primary" size="xs" className="tap" onClick={() => acceptKR(k)}>Add</Button>
                  <IconButton size="xs" label="Dismiss" icon={<Icon name="close" size={12} />} onClick={() => setProposedKRs((p) => p.filter((_, x) => x !== k))} />
                </div>
              </div>
            ))}

            {/* inline composer — type a measure, ⏎ commits it (fast, like project steps) */}
            <div className="k-field" data-size="sm">
              <Icon name="plus" size={14} />
              <input
                value={newKR}
                onChange={(e) => setNewKR(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addResult(); } }}
                placeholder={i.keyResults.length ? "Add a measure" : "The first measure"}
                aria-label="Add a key result"
              />
            </div>
            {proposedKRs.length > 1 && (
              <div className="fl-work-row">
                <Button kind="secondary" size="xs" className="tap" onClick={acceptAllKRs}>Add all {proposedKRs.length}</Button>
              </div>
            )}
          </div>

          <div className="fl-work-row">
            {!(axes.defined && axes.planned) && (
              <Button
                kind="primary"
                size="xs"
                className="tap"
                icon={<Icon name="sparkles" size={13} />}
                onClick={() => void draft()}
                disabled={drafting}
                title="Nuvo drafts the objective + measurable key results — you adjudicate each"
              >
                {drafting ? "Drafting…" : "Draft OKRs"}
              </Button>
            )}
            <Button
              kind="secondary"
              size="xs"
              className="tap"
              icon={<Icon name="check" size={13} />}
              onClick={markDone}
              aria-label="Mark initiative complete"
              title="Finished — mark complete"
            >
              Done
            </Button>
            <Button
              kind="ghost"
              size="xs"
              className="tap"
              onClick={togglePark}
              title={parked ? "Bring it back onto the deck" : "Park it — rest it without finishing"}
            >
              {parked ? "Unpark" : "Park"}
            </Button>
          </div>
          {aiNote && <p className="fl-note">{aiNote}</p>}
        </div>
      )}
    </Card>
  );
}

// One measure's verdict — a line under its bar: the rating as a mark, then the
// one-line critique.
function VerdictLine({ verdict }: { verdict: KRVerdict }) {
  const tone: Record<KRRating, { color: string; label: string }> = {
    strong: { color: "var(--ok)", label: "Strong" },
    fair: { color: "var(--warn)", label: "Fair" },
    weak: { color: "var(--danger)", label: "Weak" },
  };
  const t = tone[verdict.rating];
  return (
    <div className="fl-verdict">
      <b style={{ color: t.color }}>{t.label}</b>
      {verdict.note && <span className="min-w-0">{verdict.note}</span>}
    </div>
  );
}

export default function InitiativeGroomWall({ lanes, onOpen }: { lanes: InitiativeLane[]; onOpen: (id: string) => void }) {
  const { data } = useVertical();
  const { openFloorModal } = useAppNavigation();
  const [picked, setPicked] = useState<{ id: string; tier: InitiativeTier } | null>(null);

  const rows = lanes.map((l) => {
    const a = initiativeReadinessAxes(data, l.initiative);
    return { lane: l, met: (a.defined ? 1 : 0) + (a.planned ? 1 : 0), tier: initiativeTier(data, l) };
  });
  const tierOf = (r: (typeof rows)[number]) => (picked?.id === r.lane.initiative.id ? picked.tier : r.tier);
  // Thinnest-first inside a column.
  const columns = COLUMNS.map((c) => ({
    ...c,
    rows: rows
      .filter((r) => tierOf(r) === c.tier)
      .sort((a, b) => a.met - b.met || a.lane.initiative.name.localeCompare(b.lane.initiative.name)),
  })).filter((c) => c.tier !== "parked" || c.rows.length > 0);

  useEffect(() => {
    if (picked && !lanes.some((l) => l.initiative.id === picked.id)) setPicked(null);
  }, [lanes, picked]);

  useEffect(() => {
    if (!picked) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || isTypingIn(e.target)) return;
      setPicked(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  if (lanes.length === 0) return <EmptyState>Nothing to groom</EmptyState>;

  return (
    <div
      className="fl-board"
      style={{ ["--fl-n" as string]: columns.length }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (e.currentTarget.contains(t) && !t.closest(".fl-card")) setPicked(null);
      }}
    >
      {columns.map((c) => (
        <section key={c.tier} className="fl-col" aria-label={c.label}>
          <ColumnHead
            step={c.step}
            label={c.label}
            count={c.rows.length}
            onAdd={c.tier === "raw" ? () => openFloorModal("new-initiative") : undefined}
            addLabel="New initiative"
          />
          {c.rows.length === 0 && <div className="fl-col-empty">None</div>}
          {c.rows.map((r) => (
            <InitiativeGroomCard
              key={r.lane.initiative.id}
              data={data}
              lane={r.lane}
              selected={picked?.id === r.lane.initiative.id}
              onSelect={() => setPicked({ id: r.lane.initiative.id, tier: r.tier })}
              onOpen={onOpen}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
