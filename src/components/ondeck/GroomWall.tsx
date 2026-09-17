// On Deck — the GROOM face. The same deck you time-box, flipped 90°: instead of
// project bars laid across weeks, every in-flight project stands up as its own
// column with a live outline you pour steps into. No modal, no one-at-a-time
// flow — the board *is* the groom surface, and the readiness meter fills as you
// type. Thinnest-first, so the rawest projects present themselves on the left.
//
// Reuse-first: the lanes (axes / readyTier / pace) come straight from readOnDeck;
// the steps are the app's one task list (TaskListView — the real row, the shared
// keys, the one add box). This file only arranges them into a wall.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { useRecordContextMenu } from "../RecordContextMenu";
import { domainById, tasksOf, type VerticalData } from "../../lib/vertical";
import { type OnDeckLane, type ReadyTier } from "../../lib/onDeck";
import { hasRoutingSignal, proofreadOutcome, suggestDomain, type DomainSuggestion, type ProofreadResult } from "../../lib/groomAI";
import { PROJECT_STATUS_COLORS } from "../floors/parts";
import { READY } from "../floors/ReadinessBanner";
import { ProjectShipAssess } from "../record/ShipAssess";
import type { Task } from "../../lib/types";
import TaskListView from "../tasks/TaskListView";
import { byManualOrder } from "../../lib/taskOrder";
import { useAllTasks } from "../../hooks/useTasks";
import { useAppNavigation } from "../../hooks/useAppNavigation";

const CAUTION = PROJECT_STATUS_COLORS.waiting;

const TIER_COLOR: Record<ReadyTier, string> = {
  ready: READY,
  grooming: CAUTION,
  raw: "var(--line-strong)",
  parked: "var(--muted)",
  done: READY,
};

function readyText(l: OnDeckLane): string {
  if (l.readyTier === "parked") return "Parked";
  if (l.readyTier === "ready") return "3/3";
  if (l.readyTier === "raw") return "0/3";
  return `${l.readyCount}/3`;
}

function GroomCard({ data, lane, onOpen }: { data: VerticalData; lane: OnDeckLane; onOpen: (id: string) => void }) {
  const store = useVertical();
  const { onContextMenu, menu } = useRecordContextMenu();
  const p = lane.project;
  const accent = domainById(data, p.domainId)?.color ?? "var(--accent)";
  const color = TIER_COLOR[lane.readyTier];
  // d.tasks is built pre-sorted by sort_order, so filtering preserves order.
  const existing = tasksOf(data, p.id).filter((t) => t.status !== "done");
  const axes = [lane.axes.defined, lane.axes.planned, lane.axes.fits];

  // The steps are real tasks, drawn by the app's one list (TaskListView).
  const { data: allTasks } = useAllTasks();
  const { openOverlay } = useAppNavigation();
  const stepRows = useMemo(() => {
    const byId = new Map((allTasks ?? []).map((t) => [t.id, t]));
    return byManualOrder(existing.map((v) => byId.get(v.id)).filter((t): t is Task => Boolean(t)));
  }, [existing, allTasks]);
  // A wall has many lists; only the card you're working in hears the keys.
  const [active, setActive] = useState(false);

  // ── defining the project: the outcome line closes the "Defined" axis ─────────
  const [outcome, setOutcome] = useState(p.outcome ?? "");
  const saveOutcome = () => {
    const v = outcome.trim();
    if (v !== (p.outcome ?? "").trim()) store.updateProject(p.id, { outcome: v });
  };

  // ── status: finish it (drops off the wall) or park it (rests, greys, sorts right)
  // Shipping asks first — same moment as the record and the deck. The card only
  // fades once you've said yes; the assessment owns the write.
  const [completing, setCompleting] = useState(false);
  const [shipping, setShipping] = useState(false);
  const parked = lane.readyTier === "parked";
  const markDone = () => setShipping(true);
  const togglePark = () => store.updateProject(p.id, { status: parked ? "in_progress" : "waiting" });

  // ── AI · auto domain suggestion (only when the area is empty + there's signal)
  const [domSug, setDomSug] = useState<DomainSuggestion | null>(null);
  const [domDismissed, setDomDismissed] = useState(false);
  const domFetched = useRef(false);
  const needsDomain = !p.domainId && hasRoutingSignal(data, p);
  useEffect(() => {
    if (!needsDomain || domDismissed || domFetched.current) return;
    domFetched.current = true;
    suggestDomain(data, p)
      .then((s) => setDomSug(s))
      .catch((e) => console.warn("[groom] domain suggest failed", e));
  }, [needsDomain, domDismissed, data, p]);
  const acceptDomain = () => {
    if (domSug) store.updateProject(p.id, { domainId: domSug.domain.id });
    setDomSug(null);
  };

  // ── AI · proofread the brief (on-demand — you press "tighten") ───────────────
  const [proof, setProof] = useState<ProofreadResult | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const tighten = async () => {
    if (proofBusy || !outcome.trim()) return;
    setProofBusy(true);
    setProof(null);
    try {
      // proofread the CURRENT text, saving first so the model sees your latest line.
      saveOutcome();
      const r = await proofreadOutcome(data, { ...p, outcome });
      setProof(r);
    } catch (e) {
      console.warn("[groom] proofread failed", e);
    } finally {
      setProofBusy(false);
    }
  };
  const acceptTighten = () => {
    if (proof?.tightened) {
      setOutcome(proof.tightened);
      store.updateProject(p.id, { outcome: proof.tightened });
    }
    setProof(null);
  };

  // pace is a separate axis — a red due-pill, never mixed into readiness color.
  const slipping = lane.pace.read === "overdue" || lane.pace.read === "behind" || lane.pace.read === "stalled";
  const due = p.targetDate ? format(new Date(p.targetDate + "T00:00:00"), "MMM d") : null;

  return (
    <div
      onFocus={() => setActive(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false);
      }}
      onPointerDown={() => setActive(true)}
      onContextMenu={onContextMenu("project", p.id)}
      className="fast flex w-[404px] shrink-0 flex-col gap-4 rounded-2xl border bg-surface px-6 pb-5 pt-5"
      style={{
        borderColor: "var(--line)",
        boxShadow: "var(--shadow-lift)",
        opacity: completing ? 0 : parked ? 0.6 : 1,
        transform: completing ? "scale(.97)" : undefined,
      }}
    >
      {menu}
      {/* left domain rail — color demarcation of the area (identity); readiness
          lives in the meter below (status). */}
      <div className="relative">
        <span className="absolute -left-5 top-0.5 h-[calc(100%-2px)] w-[3px] rounded-full" style={{ background: accent, opacity: 0.9 }} />
        <div className="flex items-start gap-2">
          {/* done check — "I've finished this, stop grooming it" (mirrors Schedule) */}
          <button
            onClick={markDone}
            aria-label="Mark project complete"
            title="Finished — mark complete"
            className={`group/chk fast mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${completing ? "bloom" : ""}`}
            style={completing ? { background: READY, borderColor: READY } : { borderColor: "var(--line-strong)" }}
          >
            <Icon name="check" size={10} className={completing ? "opacity-100" : "opacity-0 transition-opacity group-hover/chk:opacity-60"} style={{ color: completing ? "#fff" : READY }} />
          </button>
          <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
          <button
            onClick={() => onOpen(p.id)}
            className="fast min-w-0 flex-1 text-left text-body font-semibold leading-snug text-ink hover:underline"
            title="Open the record"
          >
            {p.name}
          </button>
          {slipping && due && (
            <span
              className="mono shrink-0 rounded-full px-1.5 py-0.5 text-micro font-medium"
              style={{ background: "color-mix(in srgb, var(--signal) 14%, transparent)", color: "var(--signal)" }}
            >
              ⚠ {due}
            </span>
          )}
        </div>
        <div className="mt-0.5 pl-[26px] text-micro text-muted">
          {domainById(data, p.domainId)?.name ?? "no area"}
          {parked ? " · parked" : lane.readyTier === "raw" ? " · raw idea" : ""}
        </div>
      </div>

      {/* AI · auto domain chip — surfaces only when the area is empty + there's
          signal (title + brief/steps). Proposes; the tap assigns. */}
      {domSug && !p.domainId && (
        <div
          className="flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-1.5"
          style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}
        >
          <span style={{ color: "var(--accent)" }}>✦</span>
          <button onClick={acceptDomain} className="fast min-w-0 flex-1 text-left text-caption text-ink" title={domSug.reason || "Assign this area"}>
            Looks like <span className="font-semibold" style={{ color: "var(--accent)" }}>{domSug.domain.name}</span>
            <span className="text-muted"> · tap to assign</span>
          </button>
          <button onClick={() => { setDomDismissed(true); setDomSug(null); }} className="fast shrink-0 px-1 text-micro text-muted hover:text-ink" title="Dismiss">✕</button>
        </div>
      )}

      {/* the brief — one line that defines done; closes the Defined axis. Plain
          text so iOS dictation works; saves on blur. "✦ tighten" proofreads it. */}
      <div className="group/brief relative -mx-1">
        <textarea
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          onBlur={saveOutcome}
          rows={3}
          placeholder="Define what done looks like…"
          className="fast w-full resize-none rounded-lg bg-transparent px-1.5 py-1.5 pr-14 text-body leading-relaxed text-ink outline-none transition-colors placeholder:italic placeholder:text-muted/45 hover:bg-surface-2/60 focus:bg-surface-2"
        />
        {outcome.trim() && !proof && (
          <button
            onClick={() => void tighten()}
            disabled={proofBusy}
            className="mono fast absolute right-1 top-1 rounded px-1.5 py-0.5 text-micro font-medium opacity-0 transition-opacity hover:underline group-hover/brief:opacity-100 group-focus-within/brief:opacity-100 disabled:opacity-50"
            style={{ color: "var(--accent)" }}
            title="Proofread — tighten this line"
          >
            {proofBusy ? "…" : "✦ tighten"}
          </button>
        )}
        {proof && (
          <div className="mt-1.5 rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            {proof.changed ? (
              <>
                <div className="text-caption leading-snug text-ink">{proof.tightened}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={acceptTighten} className="tap fast rounded-md px-2.5 py-1 text-micro font-medium text-white" style={{ background: "var(--accent)" }}>Use this</button>
                  <button onClick={() => setProof(null)} className="tap fast rounded-md px-2 py-1 text-micro text-muted hover:text-ink">Keep mine</button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-micro text-muted">✦ Already sharp — nothing to tighten.</span>
                <button onClick={() => setProof(null)} className="fast text-micro text-muted hover:text-ink">ok</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* the definition-of-ready meter — Defined · Planned · Fits */}
      <div>
        <div className="flex items-center gap-2.5">
          {/* A met criterion is always READY (--ok), never the lane's own tier
              colour. It used to inherit the tier, which meant a project in the
              "grooming" tier drew its MET pips in --warn — so amber read as
              "achieved" here and as "9d overdue", "no outcome", "at risk"
              everywhere else in the app. It also made the "raw" tier illegible:
              met pips were --line-strong against --line unmet, a distinction of
              almost nothing. The tier still speaks, in the count beside the
              meter — which is the right place for a status, and leaves the pips
              to answer only "is this one done". */}
          <span className="flex flex-1 items-center gap-1.5">
            {axes.map((met, i) => (
              <span key={i} className="h-[7px] flex-1 rounded-full transition-colors" style={{ background: met ? READY : "var(--line)" }} />
            ))}
          </span>
          <span className="mono text-caption font-semibold" style={{ color: lane.readyTier === "raw" ? "var(--muted)" : color }}>
            {readyText(lane)}
          </span>
        </div>
        <div className="mt-1 flex justify-between text-micro uppercase tracking-wide text-muted">
          <span>defined</span>
          <span>planned</span>
          <span>fits</span>
        </div>
      </div>

      {/* The steps — the app's one task list: the real row, the shared keys
          (while this card has focus), drag to reorder, and the one add box.
          Each line lands as you press ↵, so the meter above moves as you type;
          "30m" in the line sets its length. */}
      <TaskListView
        className="max-h-[46vh] overflow-y-auto"
        tasks={stepRows}
        context={{ projectId: p.id, initiativeId: p.initiativeId, domainId: p.domainId }}
        keyboard={active}
        onOpen={(t) => openOverlay("task-record", t.id)}
        flush
        composerPlaceholder={existing.length ? "Add a step…" : "What's the first move?"}
      />

      {/* footer — the ready badge, or what's still missing */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        {lane.readyTier === "ready" ? (
          <span className="flex items-center gap-1.5 text-caption font-medium" style={{ color: READY }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: READY }} /> Ready to pull in
          </span>
        ) : (
          <span className="text-micro text-muted">{lane.gaps.map((g) => g.label).join(" · ") || " "}</span>
        )}
        <button
          onClick={togglePark}
          className="fast tap shrink-0 rounded-md px-2 py-1 text-micro font-medium text-muted hover:text-ink"
          title={parked ? "Bring it back onto the deck" : "Park it — rest it without finishing"}
        >
          {parked ? "Unpark" : "Park"}
        </button>
      </div>

      {shipping && (
        <ProjectShipAssess id={p.id} onClose={() => setShipping(false)} onShipped={() => setCompleting(true)} />
      )}
    </div>
  );
}

export default function GroomWall({ lanes, onOpen }: { lanes: OnDeckLane[]; onOpen: (id: string) => void }) {
  const { data } = useVertical();
  // Thinnest-first: the rawest projects sort left so the deck presents the ones
  // begging to be shaped. Parked settle to the right (resting by choice). Done
  // projects have nothing to groom — they drop off this face entirely.
  const ordered = [...lanes].filter((l) => l.readyTier !== "done").sort((a, b) => {
    const pk = (l: OnDeckLane) => (l.readyTier === "parked" ? 1 : 0);
    return pk(a) - pk(b) || a.readyCount - b.readyCount || a.project.name.localeCompare(b.project.name);
  });

  if (ordered.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-line px-4 py-10 text-center text-caption text-muted">
        Nothing on deck to groom — place a project on the timeline first, then flip back here to shape it.
      </div>
    );
  }

  return (
    <div className="mt-5 flex gap-6 overflow-x-auto pb-3">
      {ordered.map((l) => (
        <GroomCard key={l.project.id} data={data} lane={l} onOpen={onOpen} />
      ))}
    </div>
  );
}
