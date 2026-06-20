// The Refine run — grooming as a winnable card game (docs/refine-run.md).
// Two surfaces: the portfolio MAP (the overworld — where to start, and where the
// gain cascades back to) and the RUN (one item on a persistent board, a stack of
// atomic gap-cards falling through it — Accept · Tweak · Skip, by tap or swipe).
//
// A NEW interaction model over EXISTING logic: the gap decomposition is refine.ts;
// every proposal/mutation reuses the same primitives the desktop TendingFlow uses
// (draftOutcome · scaffold · blueprint · verify→verdict · updateProject/Initiative
// · addTasks · addInitiativeSubtree · tend). No new backend.

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, startOfDay } from "date-fns";
import { useVertical, type InitiativeSubtree } from "../../hooks/useVertical";
import { useSettings } from "../../hooks/useSettings";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks } from "../../hooks/useTasks";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { type Energy } from "../../lib/energy";
import { toBusyBlocks } from "../../lib/now";
import {
  domainById,
  initiativeById,
  projectById,
  projectsOf,
  tasksOf,
  type Initiative,
  type Project,
  type SoundnessVerdict,
  type VerticalData,
} from "../../lib/vertical";
import {
  readTending,
  ripenessOfInitiative,
  ripenessOfProject,
  soundnessSig,
  verdictOf,
  type GroomCandidate,
} from "../../lib/tending";
import {
  REFINE_CARD_LABEL,
  proposeDueISO,
  refineCards,
  refineReadiness,
  type RefineCard,
  type RefineCardKind,
} from "../../lib/refine";
import { computeFeasibility, type Feasibility } from "../../lib/refineFeasibility";
import RefinePortfolio, { snapshotReadiness, type ReadinessSnapshot } from "./RefinePortfolio";

type Kind = "project" | "initiative";
type Ref = { kind: Kind; id: string };

// ─────────────────────────────────────────────────────────────────────────────
export default function RefineRun({ onClose }: { onClose: () => void }) {
  const { data, ready } = useVertical();
  const baseline = useRef<ReadinessSnapshot | null>(null);
  const [queue, setQueue] = useState<Ref[] | null>(null);
  const [idx, setIdx] = useState(0);

  if (!ready) return <Scaffold onClose={onClose}><Centered>Reading the portfolio…</Centered></Scaffold>;

  const startRun = (from: Ref | undefined) => {
    baseline.current = snapshotReadiness(data);
    const g: Ref[] = readTending(data).groomable.map((c) => ({ kind: c.kind, id: c.id }));
    const q = from ? [from, ...g.filter((x) => x.id !== from.id)] : g;
    setQueue(q.length ? q : from ? [from] : []);
    setIdx(0);
  };

  const finished = queue != null && idx >= queue.length;
  const inRun = queue != null && !finished;
  const current = inRun ? queue![idx] : null;
  const item = current ? (current.kind === "project" ? projectById(data, current.id) : initiativeById(data, current.id)) : null;

  // map (home, or the cascade landing after a finished run)
  if (!inRun || !item) {
    return (
      <Scaffold onClose={onClose}>
        <RefinePortfolio data={data} from={finished ? baseline.current : null} onStart={startRun} />
      </Scaffold>
    );
  }

  return (
    <Scaffold onClose={onClose} onBack={() => { setQueue(null); setIdx(0); }}>
      <ItemRun
        key={current!.id}
        data={data}
        kind={current!.kind}
        item={item}
        position={`${idx + 1} of ${queue!.length}`}
        isLast={idx === queue!.length - 1}
        onSealNext={() => setIdx((i) => i + 1)}
      />
    </Scaffold>
  );
}

// ── full-screen frame ─────────────────────────────────────────────────────────
function Scaffold({ children, onClose, onBack }: { children: React.ReactNode; onClose: () => void; onBack?: () => void }) {
  return (
    <div className="atmosphere fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="mobile-topbar pt-safe flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <button onClick={onBack ?? onClose} aria-label={onBack ? "Back to map" : "Close"} className="tap fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted active:scale-95">
          {onBack ? "←" : "✕"}
        </button>
        <span className="wordmark wordmark-grad text-lead">Refine</span>
        <div className="flex-1" />
        {onBack && <button onClick={onClose} aria-label="Close" className="tap fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted active:scale-95">✕</button>}
      </header>
      <main className="mobile-scroll relative min-h-0 flex-1 overflow-y-auto px-4 pb-safe">
        <div className="mx-auto w-full max-w-[680px]">{children}</div>
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">{children}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// One item's persistent board + its falling cards. Cards = the live gap
// decomposition minus what's been skipped this visit.
function ItemRun({
  data, kind, item, position, isLast, onSealNext,
}: {
  data: VerticalData; kind: Kind; item: Project | Initiative;
  position: string; isLast: boolean; onSealNext: () => void;
}) {
  const store = useVertical();
  const accent = domainById(data, item.domainId)?.color ?? "var(--accent)";
  const [skipped, setSkipped] = useState<RefineCardKind[]>([]);

  // Nuvo's soundness verdict — fetched once the structural gaps close (a path
  // exists), so the sharpen / reality cards can appear. Mirrors TendingFlow.
  const verdict = verdictOf(data, kind, item.id);
  const [verifying, setVerifying] = useState(false);
  const stage = (kind === "project" ? ripenessOfProject(data, item as Project) : ripenessOfInitiative(data, item as Initiative)).stage;
  const wantVerdict = stage === "scaffolded" || stage === "active";
  useEffect(() => {
    if (!wantVerdict || verdict || verifying) return;
    let live = true;
    void (async () => {
      setVerifying(true);
      try {
        const { data: res, error } = await supabase.functions.invoke("agent", { body: { verify: { kind, id: item.id } } });
        if (error) throw error;
        if (live && res) await store.saveVerdict(kind, item.id, { ...(res as Omit<SoundnessVerdict, "sig">), sig: soundnessSig(data, kind, item.id) });
      } catch (e) { console.warn("[refine] verify failed", e); }
      finally { if (live) setVerifying(false); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantVerdict, verdict, item.id]);

  // the real feasibility read — only this app can make it (work est vs live calendar)
  const nowRef = useRef(new Date());
  const now = nowRef.current;
  const startISO = startOfDay(now).toISOString();
  const endISO = (item.targetDate ? new Date(item.targetDate + "T23:59:59") : addDays(now, 21)).toISOString();
  const { settings } = useSettings();
  const { data: events = [] } = useExternalEvents(startISO, endISO);
  const { data: sched = [] } = useScheduledTasks(startISO, endISO);
  const feasibility: Feasibility | null = useMemo(() => {
    const est = verdict?.time.estHours ?? 0;
    if (!item.targetDate || !est) return null;
    const busy = toBusyBlocks(events, sched, settings?.hidden_calendar_ids ?? []);
    return computeFeasibility(busy, now, item.targetDate, settings?.work_start_minutes ?? 480, settings?.work_end_minutes ?? 990, est);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, sched, settings, item.targetDate, verdict?.time.estHours]);

  const candidate: GroomCandidate = {
    kind, id: item.id, name: item.name, domainId: item.domainId,
    ripeness: kind === "project" ? ripenessOfProject(data, item as Project) : ripenessOfInitiative(data, item as Initiative),
    reasons: [], priority: 0, silent: false, daysSinceTouch: null, sound: false, verified: false,
  };
  const cards = useMemo(
    () => refineCards(data, candidate, verdict).filter((c) => !skipped.includes(c.kind)),
    [data, candidate, verdict, skipped],
  );
  const current = cards[0] ?? null;
  const ring = refineReadiness(data, candidate);
  const resolve = (k: RefineCardKind) => setSkipped((s) => (s.includes(k) ? s : [...s, k]));

  return (
    <div className="pt-3">
      <Board data={data} kind={kind} item={item} accent={accent} ring={ring} verdict={verdict} verifying={verifying} feasibility={feasibility} position={position} remaining={cards.length} />

      <div className="mt-5 pb-8">
        {current ? (
          <RefineCardView
            key={`${item.id}:${current.kind}`}
            kind={kind} item={item} accent={accent}
            card={current} verdict={verdict} feasibility={feasibility}
            onResolved={() => resolve(current.kind)} onSkip={() => resolve(current.kind)}
          />
        ) : wantVerdict && verifying && !verdict ? (
          <div className="glass-card rounded-xl border border-line px-5 py-6 text-center text-body text-muted">✦ {ASSISTANT_NAME} is checking this over…</div>
        ) : (
          <Sealed ring={ring} isLast={isLast} accent={accent} onNext={async () => { await store.tend(kind, item.id); onSealNext(); }} />
        )}
      </div>
    </div>
  );
}

// ── the persistent board ──────────────────────────────────────────────────────
function Board({
  data, kind, item, accent, ring, verdict, verifying, feasibility, position, remaining,
}: {
  data: VerticalData; kind: Kind; item: Project | Initiative; accent: string; ring: number;
  verdict: SoundnessVerdict | null; verifying: boolean; feasibility: Feasibility | null; position: string; remaining: number;
}) {
  const pathCount = kind === "project"
    ? tasksOf(data, item.id).filter((t) => t.status !== "done").length
    : projectsOf(data, item.id).length;
  const feasRead = feasibility?.read ?? (verifying && !verdict ? "checking" : verdict ? verdict.time.read : null);
  const feasLabel = feasRead === "comfortable" ? "comfortable" : feasRead === "tight" ? "tight" : feasRead === "unrealistic" ? "unrealistic" : null;
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="section-label">Refine · {kind === "initiative" ? "bet" : "project"} {position}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
            <h1 className="truncate text-lead masthead leading-tight">{item.name}</h1>
          </div>
        </div>
        <Ring pct={ring} />
      </div>

      <div className="mt-4 rounded-lg border border-line glass-card px-3.5 py-1">
        <SpecRow label="Outcome" value={item.outcome.trim() || null} empty="not defined" />
        <SpecRow label="Due" value={item.targetDate} empty="no date" mono />
        <SpecRow label={kind === "initiative" ? "Projects" : "Tasks"} value={pathCount > 0 ? `${pathCount} ${kind === "initiative" ? "under it" : "open"}` : null} empty="none yet" mono />
        <SpecRow label="Feasibility" value={feasLabel} empty={feasRead === "checking" ? "checking…" : "unchecked"} />
      </div>

      <div className="mt-3 section-label text-muted">{remaining > 0 ? `${remaining} card${remaining === 1 ? "" : "s"} left` : "stack clear"}</div>
    </div>
  );
}

function SpecRow({ label, value, empty, mono }: { label: string; value: string | null; empty: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line py-2 text-body last:border-0">
      <span className="w-[84px] shrink-0 text-muted">{label}</span>
      {value ? <span className={`min-w-0 flex-1 ${mono ? "mono" : ""}`}>{value}</span> : <span className="min-w-0 flex-1 italic text-muted/70">{empty}</span>}
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const R = 22, C = 2 * Math.PI * R;
  return (
    <div className="relative h-[58px] w-[58px] shrink-0">
      <svg viewBox="0 0 58 58" className="h-[58px] w-[58px]">
        <circle cx="29" cy="29" r={R} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle cx="29" cy="29" r={R} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 29 29)"
          style={{ transition: "stroke-dashoffset .5s var(--ease-out)" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-label font-medium">{pct}%</div>
    </div>
  );
}

// ── the focal card — a verdict you confirm (tap or swipe) ─────────────────────
type TaskDraft = { title: string; energy: Energy | null; durationMins: number; on: boolean };
type Tree = { keyResults: InitiativeSubtree["keyResults"]; projects: InitiativeSubtree["projects"] };

function RefineCardView({
  kind, item, accent, card, verdict, feasibility, onResolved, onSkip,
}: {
  kind: Kind; item: Project | Initiative; accent: string;
  card: RefineCard; verdict: SoundnessVerdict | null; feasibility: Feasibility | null;
  onResolved: () => void; onSkip: () => void;
}) {
  const store = useVertical();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [tweaking, setTweaking] = useState(false);
  const [text, setText] = useState<string>(card.kind === "due" ? proposeDueISO() : "");
  const [tasks, setTasks] = useState<TaskDraft[] | null>(null);
  const [tree, setTree] = useState<Tree | null>(null);
  const [loadingProposal, setLoadingProposal] = useState(false);

  // auto-fetch the proposal — the heavy lift Nuvo does before you decide
  useEffect(() => {
    let live = true;
    if (card.kind === "sharpen") { setText(verdict?.outcome.suggestion?.trim() ?? ""); return; }
    if (card.kind === "outcome") {
      setLoadingProposal(true);
      void (async () => {
        try {
          const { data: res, error } = await supabase.functions.invoke("agent", { body: { draftOutcome: { kind, id: item.id } } });
          if (error) throw error;
          if (live) setText(String(res?.outcome ?? "").trim());
        } catch (e) { console.warn("[refine] draftOutcome failed", e); }
        finally { if (live) setLoadingProposal(false); }
      })();
    } else if (card.kind === "tasks") {
      setLoadingProposal(true);
      void (async () => {
        try {
          if (kind === "project") {
            const { data: res, error } = await supabase.functions.invoke("agent", { body: { scaffold: { projectId: item.id } } });
            if (error) throw error;
            const drafts = (res?.tasks ?? []) as { title: string; energy: Energy | null; durationMins: number }[];
            if (live) setTasks(drafts.map((d) => ({ ...d, on: true })));
          } else {
            const { data: res, error } = await supabase.functions.invoke("agent", { body: { blueprint: { name: item.name, outcome: item.outcome, domainId: item.domainId } } });
            if (error) throw error;
            if (live) setTree({ keyResults: res?.keyResults ?? [], projects: res?.projects ?? [] });
          }
        } catch (e) { console.warn("[refine] path proposal failed", e); }
        finally { if (live) setLoadingProposal(false); }
      })();
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.kind, item.id]);

  const setOutcome = (v: string) => (kind === "project" ? store.updateProject(item.id, { outcome: v }) : store.updateInitiative(item.id, { outcome: v }));
  const setDue = (v: string | null) => (kind === "project" ? store.updateProject(item.id, { targetDate: v }) : store.updateInitiative(item.id, { targetDate: v }));

  const accept = async () => {
    setBusy(true); setNote(null);
    try {
      if (card.kind === "outcome" || card.kind === "sharpen") {
        const v = text.trim(); if (!v) { setBusy(false); return; }
        setOutcome(v);
      } else if (card.kind === "due") {
        setDue(text || null);
      } else if (card.kind === "tasks") {
        if (kind === "project" && tasks) {
          const accepted = tasks.filter((t) => t.on);
          if (accepted.length) await store.addTasks({ projectId: item.id, initiativeId: (item as Project).initiativeId, domainId: item.domainId }, accepted.map((t) => ({ title: t.title, energy: t.energy, durationMins: t.durationMins })));
        } else if (kind === "initiative" && tree) {
          await store.addInitiativeSubtree(item.id, { keyResults: tree.keyResults, projects: tree.projects });
        }
      }
      onResolved(); // "reality" is an acknowledgment — no mutation
    } catch (e) {
      console.warn("[refine] accept failed", e);
      setNote("Couldn't save that — try again, or skip.");
      setBusy(false);
    }
  };

  const treeCount = (tree?.keyResults.length ?? 0) + (tree?.projects.length ?? 0);
  const canAccept =
    card.kind === "reality" ? true
    : card.kind === "tasks" ? (kind === "project" ? !!tasks && tasks.some((t) => t.on) : !!tree && treeCount > 0)
    : text.trim().length > 0;
  const acceptText =
    card.kind === "reality" ? "Lock it in"
    : card.kind === "tasks" ? (kind === "project" ? `Add ${(tasks ?? []).filter((t) => t.on).length || ""}`.trim() : `Build it`)
    : "Accept";

  // ── swipe — pointer events (Tauri-safe), right = accept · left = skip ────────
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x0: number; on: boolean }>({ x0: 0, on: false });
  const THRESH = 110;
  const onDown = (e: React.PointerEvent) => {
    if (tweaking || busy) return;
    if ((e.target as HTMLElement).closest("button,input,textarea")) return;
    drag.current = { x0: e.clientX, on: true };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => { if (drag.current.on) setDx(e.clientX - drag.current.x0); };
  const onUp = () => {
    if (!drag.current.on) return;
    drag.current.on = false;
    if (dx > THRESH && canAccept) { setDx(360); void accept(); }
    else if (dx < -THRESH) { setDx(-360); onSkip(); }
    else setDx(0);
  };

  const hint = dx > 40 ? (canAccept ? "var(--accent)" : "var(--line-strong)") : dx < -40 ? "var(--line-strong)" : "transparent";

  return (
    <div
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      className="glass-lift relative overflow-hidden rounded-xl border-2 px-5 py-4 touch-pan-y"
      style={{
        borderColor: dx !== 0 ? `color-mix(in srgb, ${hint} 60%, var(--line))` : "color-mix(in srgb, var(--accent) 45%, var(--line))",
        boxShadow: "var(--shadow-lift)",
        transform: `translateX(${dx}px) rotate(${dx * 0.018}deg)`,
        transition: drag.current.on ? "none" : "transform .3s var(--ease-out), border-color .2s",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="section-label" style={{ color: "var(--accent)" }}>{REFINE_CARD_LABEL[card.kind]}</span>
        {Math.abs(dx) > 40 && <span className="mono text-micro" style={{ color: hint }}>{dx > 0 ? (canAccept ? "release to accept" : "—") : "release to skip"}</span>}
      </div>
      <p className="text-body leading-relaxed text-ink/90">{card.kind === "reality" && feasibility ? feasibility.reason : card.reason}</p>

      <div className="mt-3.5">
        {card.kind === "tasks" ? (
          kind === "project"
            ? <TaskProposal accent={accent} tasks={tasks} loading={loadingProposal} setTasks={setTasks} />
            : <TreeProposal tree={tree} loading={loadingProposal} />
        ) : card.kind === "reality" ? (
          <FeasibilityProposal feasibility={feasibility} verdict={verdict} />
        ) : card.kind === "due" ? (
          tweaking
            ? <input type="date" value={text} onChange={(e) => setText(e.target.value)} autoFocus className="w-full rounded-md border border-line bg-bg px-3 py-2.5 text-body outline-none focus:border-accent" />
            : <Proposal>{text ? fmtDate(text) : "—"}</Proposal>
        ) : (
          tweaking
            ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus placeholder="Write it in one line…" className="w-full resize-y rounded-md border border-line bg-bg px-3 py-2 text-body outline-none focus:border-accent" />
            : <Proposal>{loadingProposal ? <span className="text-muted">✦ {ASSISTANT_NAME} is drafting…</span> : (text || <span className="italic text-muted">no suggestion — tweak to write your own</span>)}</Proposal>
        )}
      </div>

      {note && <div className="mt-2 text-label text-muted">{note}</div>}

      <div className="mt-4 flex items-center gap-2">
        <button onClick={() => void accept()} disabled={busy || !canAccept} className="tap fast flex-1 rounded-lg px-4 py-2.5 text-body font-medium text-white active:scale-[.98] disabled:opacity-40" style={{ background: "var(--accent)" }}>
          {busy ? "…" : acceptText}
        </button>
        {card.kind !== "reality" && (
          <button onClick={() => setTweaking((v) => !v)} disabled={busy} className="tap fast rounded-lg border border-line px-4 py-2.5 text-body text-muted active:scale-[.98]">{tweaking ? "Done" : "Tweak"}</button>
        )}
        <button onClick={onSkip} disabled={busy} className="tap fast rounded-lg border border-line px-4 py-2.5 text-body text-muted active:scale-[.98]">Skip</button>
      </div>
    </div>
  );
}

function Proposal({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md bg-surface-2/60 px-3 py-2.5 text-body">{children}</div>;
}

function TaskProposal({ accent, tasks, loading, setTasks }: {
  accent: string; tasks: TaskDraft[] | null; loading: boolean;
  setTasks: (fn: (t: TaskDraft[] | null) => TaskDraft[] | null) => void;
}) {
  if (loading && !tasks) return <Proposal><span className="text-muted">✦ {ASSISTANT_NAME} is proposing the steps…</span></Proposal>;
  if (!tasks || tasks.length === 0) return <Proposal><span className="italic text-muted">No steps to add — skip this one.</span></Proposal>;
  return (
    <div className="space-y-1">
      {tasks.map((t, i) => (
        <button key={i} onClick={() => setTasks((p) => (p ?? []).map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} className="tap fast flex w-full items-center gap-2.5 rounded-md border border-line px-2.5 py-2 text-left">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-micro text-white" style={{ borderColor: t.on ? accent : "var(--line)", background: t.on ? accent : "transparent" }}>{t.on ? "✓" : ""}</span>
          <span className={`min-w-0 flex-1 truncate text-body ${t.on ? "" : "text-muted line-through"}`}>{t.title}</span>
          <span className="mono shrink-0 text-meta text-muted">{t.durationMins}m</span>
        </button>
      ))}
    </div>
  );
}

function TreeProposal({ tree, loading }: { tree: Tree | null; loading: boolean }) {
  if (loading && !tree) return <Proposal><span className="text-muted">✦ {ASSISTANT_NAME} is proposing the structure…</span></Proposal>;
  if (!tree || (tree.keyResults.length === 0 && tree.projects.length === 0)) return <Proposal><span className="italic text-muted">No structure proposed — skip this one.</span></Proposal>;
  return (
    <div className="space-y-2.5">
      {tree.keyResults.length > 0 && (
        <div>
          <div className="section-label mb-1">Key results · {tree.keyResults.length}</div>
          {tree.keyResults.map((k, i) => (
            <div key={i} className="flex items-baseline justify-between border-b border-line py-1 text-caption last:border-0">
              <span className="min-w-0 truncate pr-2">{k.name}</span>
              <span className="mono shrink-0 text-micro text-muted">{k.baseline}→{k.target}{k.unit}</span>
            </div>
          ))}
        </div>
      )}
      {tree.projects.length > 0 && (
        <div>
          <div className="section-label mb-1">Projects · {tree.projects.length}</div>
          {tree.projects.map((p, i) => (
            <div key={i} className="border-b border-line py-1 text-caption last:border-0">
              <span className="font-medium">{p.name}</span>
              {p.tasks?.length ? <span className="mono ml-2 text-micro text-muted">{p.tasks.length} tasks</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeasibilityProposal({ feasibility, verdict }: { feasibility: Feasibility | null; verdict: SoundnessVerdict | null }) {
  const read = feasibility?.read ?? verdict?.time.read ?? "tight";
  const tone = read === "comfortable" ? "var(--accent)" : "#D97706";
  const est = feasibility?.estHours ?? verdict?.time.estHours ?? 0;
  return (
    <Proposal>
      <span className="font-medium" style={{ color: tone }}>{read === "comfortable" ? "Comfortable" : read === "tight" ? "Tight but doable" : "Unrealistic as scoped"}</span>
      {est ? <span className="mono ml-2 text-meta text-muted">≈{est}h{feasibility ? ` · ~${feasibility.openHours}h open` : ""}</span> : null}
    </Proposal>
  );
}

// ── seal ──────────────────────────────────────────────────────────────────────
function Sealed({ ring, isLast, onNext, accent }: { ring: number; isLast: boolean; onNext: () => void; accent: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setShow(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <div className="glass-card rounded-xl border border-line px-5 py-7 text-center" style={{ background: "color-mix(in srgb, var(--accent) 8%, var(--surface))", opacity: show ? 1 : 0, transform: show ? "scale(1)" : "scale(.96)", transition: "all .45s var(--ease-out)" }}>
      <div className="text-[30px]" style={{ color: accent }}>✦</div>
      <div className="mt-1 text-head masthead">Sealed at {ring}%</div>
      <p className="mt-1 text-caption text-muted">This one's ready to work.</p>
      <button onClick={onNext} className="tap fast mt-5 rounded-lg px-5 py-2.5 text-body font-medium text-white active:scale-[.98]" style={{ background: "var(--accent)" }}>
        {isLast ? "See the gain →" : "Next →"}
      </button>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
