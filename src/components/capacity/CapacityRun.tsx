// The Capacity run — the play that moves the Standing's Capacity band. Where the
// Refine run makes what you keep READY, this decides what you CARRY: a worst-first
// pass over everything in flight, one verdict each — Keep · Park · Cut, and
// Reschedule for a slipped finish line. The band eases Overcommitted →
// Comfortable in real time as load sheds. Deterministic, no AI. See standing.ts.

import { useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { domainById, type ProjectStatus } from "../../lib/vertical";
import { readLoad, loadBand, type LoadItem, type Band } from "../../lib/standing";
import { proposeDueISO } from "../../lib/refine";
import { READY } from "../floors/ReadinessBanner";
import { PROJECT_STATUS_COLORS } from "../floors/parts";

const CAUTION = PROJECT_STATUS_COLORS.waiting; // the one caution amber
const BAND_LABEL: Record<Band, string> = {
  comfortable: "Comfortable",
  tight: "Tight",
  overcommitted: "Overcommitted",
};
const bandColor = (b: Band) => (b === "comfortable" ? READY : CAUTION);
const bandFill = (b: Band) => (b === "comfortable" ? 0.34 : b === "tight" ? 0.66 : 1);

type Ref = { kind: "project" | "initiative"; id: string };

export default function CapacityRun({ onClose }: { onClose: () => void }) {
  const store = useVertical();
  const { data, ready } = store;
  const [queue, setQueue] = useState<Ref[] | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  // snapshot the deck once, when data is first ready — so parking or cutting an
  // item doesn't reshuffle the cards under you mid-pass.
  if (ready && queue == null) {
    setQueue(readLoad(data).map((i) => ({ kind: i.kind, id: i.id })));
  }

  if (!ready || queue == null) {
    return <Scaffold onClose={onClose}><Centered>Reading your load…</Centered></Scaffold>;
  }

  // live read — the band + counts ease as statuses change beneath us
  const live = readLoad(data);
  const liveIds = new Set(live.map((i) => i.id));
  const band = loadBand(live);
  const overdue = live.filter((i) => i.overdue).length;
  const noPlan = live.filter((i) => i.hollow).length;

  const remaining = queue.filter((q) => !resolved.has(q.id) && liveIds.has(q.id));
  const finished = remaining.length === 0;
  const current = finished ? null : live.find((i) => i.id === remaining[0].id) ?? null;
  const position = `${resolved.size + 1} of ${queue.length}`;

  const resolve = (id: string) => setResolved((s) => new Set(s).add(id));
  const patch = async (item: LoadItem, p: { status?: ProjectStatus; targetDate?: string | null }) =>
    item.kind === "project" ? store.updateProject(item.id, p) : store.updateInitiative(item.id, p);

  return (
    <Scaffold onClose={onClose}>
      <div className="pt-3">
        <Board band={band} inFlight={live.length} overdue={overdue} noPlan={noPlan} position={finished ? null : position} />

        <div className="mt-5 pb-8">
          {current ? (
            <LoadCard
              key={current.id}
              item={current}
              onKeep={() => resolve(current.id)}
              onPark={async () => { await patch(current, { status: "waiting" }); resolve(current.id); }}
              onCut={async () => { await patch(current, { status: "cancelled" }); resolve(current.id); }}
              onReschedule={async (iso) => { await patch(current, { targetDate: iso }); resolve(current.id); }}
            />
          ) : (
            <Settled band={band} reviewed={resolved.size} remaining={live.length} onClose={onClose} />
          )}
        </div>
      </div>
    </Scaffold>
  );
}

// ── full-screen frame ─────────────────────────────────────────────────────────
function Scaffold({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="atmosphere fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="mobile-topbar pt-safe flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <button onClick={onClose} aria-label="Close" className="tap fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted active:scale-95">✕</button>
        <span className="wordmark wordmark-grad text-lead">Capacity</span>
      </header>
      <main className="mobile-scroll relative min-h-0 flex-1 overflow-y-auto px-4 pb-safe">
        <div className="mx-auto w-full max-w-[680px]">{children}</div>
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center text-center text-body text-muted">{children}</div>;
}

// ── the persistent board — the load read, easing live ─────────────────────────
function Board({ band, inFlight, overdue, noPlan, position }: {
  band: Band; inFlight: number; overdue: number; noPlan: number; position: string | null;
}) {
  return (
    <div>
      <div className="section-label">What you're carrying{position ? ` · ${position}` : ""}</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <h1 className="text-lead masthead leading-tight">Your load</h1>
        <span className="mono shrink-0 text-meta" style={{ color: bandColor(band) }}>{BAND_LABEL[band]}</span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.round(bandFill(band) * 100)}%`, background: bandColor(band), transition: "width .5s var(--ease-out), background .4s" }} />
      </div>
      <div className="mono mt-2 text-micro text-muted">
        {inFlight} in flight{overdue > 0 ? ` · ${overdue} overdue` : ""}{noPlan > 0 ? ` · ${noPlan} no plan` : ""}
      </div>
    </div>
  );
}

// ── the focal card — one in-flight commitment, one verdict ────────────────────
function LoadCard({ item, onKeep, onPark, onCut, onReschedule }: {
  item: LoadItem;
  onKeep: () => void;
  onPark: () => Promise<void>;
  onCut: () => Promise<void>;
  onReschedule: (iso: string) => Promise<void>;
}) {
  const { data } = useVertical();
  const accent = domainById(data, item.domainId)?.color ?? "var(--accent)";
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(item.targetDate || proposeDueISO());
  const datable = item.overdue || !!item.targetDate;

  const run = (fn: () => Promise<void> | void) => async () => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className="glass-card rounded-2xl border border-line p-4" style={{ boxShadow: "var(--shadow-2)" }}>
      <div className="flex items-start gap-2.5">
        <span className="mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lead leading-snug">{item.name}</h2>
          <div className="mt-0.5 section-label !p-0 text-muted">{item.kind === "initiative" ? "Bet" : "Project"}</div>
        </div>
      </div>

      <p className="mt-3 text-body leading-relaxed" style={{ color: item.liability ? CAUTION : "var(--muted)" }}>
        {item.reason}{item.targetDate && !item.overdue ? ` · due ${fmtDate(item.targetDate)}` : ""}
      </p>

      {rescheduling ? (
        <div className="mt-3.5 flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            autoFocus
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2.5 text-body outline-none focus:border-accent"
          />
          <button onClick={run(() => onReschedule(date))} disabled={busy || !date} className="tap fast rounded-lg px-4 py-2.5 text-body font-medium text-white active:scale-[.98] disabled:opacity-40" style={{ background: READY }}>
            {busy ? "…" : "Set date"}
          </button>
          <button onClick={() => setRescheduling(false)} disabled={busy} className="tap fast rounded-lg border border-line px-3 py-2.5 text-body text-muted hover:text-ink active:scale-[.98]">Cancel</button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button onClick={run(onKeep)} disabled={busy} className="tap fast flex-1 rounded-xl border border-line px-4 py-2.5 text-body font-medium hover:bg-accent-soft active:scale-[.98]">Keep</button>
          {datable && (
            <button onClick={() => setRescheduling(true)} disabled={busy} className="tap fast rounded-xl border px-4 py-2.5 text-body font-medium active:scale-[.98]" style={{ borderColor: `color-mix(in srgb, ${READY} 45%, var(--line))`, color: READY }}>Reschedule</button>
          )}
          <button onClick={run(onPark)} disabled={busy} className="tap fast rounded-xl px-4 py-2.5 text-body font-medium active:scale-[.98]" style={{ background: `color-mix(in srgb, ${CAUTION} 14%, transparent)`, color: CAUTION }}>Park</button>
          <button onClick={run(onCut)} disabled={busy} className="tap fast rounded-xl border border-line px-4 py-2.5 text-body text-muted hover:text-ink active:scale-[.98]">Cut</button>
        </div>
      )}

      <p className="mt-3 text-meta text-muted">
        <span className="font-medium">Park</span> rests it out of flight · <span className="font-medium">Cut</span> drops it · both ease your load.
      </p>
    </div>
  );
}

// ── settled ───────────────────────────────────────────────────────────────────
function Settled({ band, reviewed, remaining, onClose }: { band: Band; reviewed: number; remaining: number; onClose: () => void }) {
  const tone = bandColor(band);
  return (
    <div className="glass-card rounded-2xl border border-line px-5 py-8 text-center" style={{ background: `color-mix(in srgb, ${tone} 8%, var(--surface))`, boxShadow: "var(--shadow-2)" }}>
      <div className="text-[30px]" style={{ color: tone }}>{band === "comfortable" ? "✓" : "◐"}</div>
      <div className="mt-1 text-head masthead">Load is {BAND_LABEL[band]}</div>
      <p className="mt-1.5 text-caption text-muted">
        {reviewed > 0 ? `Reviewed ${reviewed}. ` : ""}
        {remaining === 0 ? "Nothing left in flight." : `${remaining} still in flight${band === "comfortable" ? " — and it fits." : "."}`}
      </p>
      <button onClick={onClose} className="tap fast mt-5 rounded-lg px-5 py-2.5 text-body font-medium text-white active:scale-[.98]" style={{ background: "var(--accent)" }}>Done</button>
    </div>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
