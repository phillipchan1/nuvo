// The Capacity run — the play that moves the Standing's Capacity band. Where the
// Refine run makes what you keep READY, this decides what you CARRY: a worst-first
// pass over everything in flight, one verdict each — Keep · Park · Cut, and
// Reschedule for a slipped finish line. The band eases Overcommitted →
// Comfortable in real time as load sheds. Deterministic, no AI. See standing.ts.
//
// On the Flow layout (D-190): ✕ and the pass's position in the bar, the band as
// the hero with the load as its fact and meter, the one commitment in front of
// you as a kit Card, and the verdicts in the footer — Keep is the primary (↵).

import { useEffect, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { domainById, type ProjectStatus } from "../../lib/vertical";
import { readLoad, loadBand, type LoadItem, type Band } from "../../lib/standing";
import { proposeDueISO } from "../../lib/refine";
import { Button, Card, Dot, EmptyState, Input } from "../kit";
import { Icon } from "../Icon";
import { FlowFoot, FlowFrame, FlowHead, FlowMeter, keyIsTaken } from "../rituals/FlowShell";

const BAND_LABEL: Record<Band, string> = {
  comfortable: "Comfortable",
  tight: "Tight",
  overcommitted: "Overcommitted",
};
// The band reads in the app's two state hues, never the ember (--signal = now).
const bandColor = (b: Band) => (b === "comfortable" ? "var(--ok)" : "var(--warn)");
const bandFill = (b: Band) => (b === "comfortable" ? 0.34 : b === "tight" ? 0.66 : 1);

type Ref = { kind: "project" | "initiative"; id: string };

export default function CapacityRun({ onClose }: { onClose: () => void }) {
  const store = useVertical();
  const { data, ready } = store;
  const [queue, setQueue] = useState<Ref[] | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);

  // snapshot the deck once, when data is first ready — so parking or cutting an
  // item doesn't reshuffle the cards under you mid-pass.
  if (ready && queue == null) {
    setQueue(readLoad(data).map((i) => ({ kind: i.kind, id: i.id })));
  }

  // live read — the band + counts ease as statuses change beneath us
  const live = ready ? readLoad(data) : [];
  const liveIds = new Set(live.map((i) => i.id));
  const band = loadBand(live);
  const overdue = live.filter((i) => i.overdue).length;
  const noPlan = live.filter((i) => i.hollow).length;

  const remaining = (queue ?? []).filter((q) => !resolved.has(q.id) && liveIds.has(q.id));
  const finished = queue != null && remaining.length === 0;
  const current = finished || queue == null ? null : live.find((i) => i.id === remaining[0].id) ?? null;
  const position = queue ? `${Math.min(resolved.size + 1, queue.length)} of ${queue.length}` : "";

  const resolve = (id: string) => {
    setResolved((s) => new Set(s).add(id));
    setRescheduling(false);
  };
  const patch = async (item: LoadItem, p: { status?: ProjectStatus; targetDate?: string | null }) =>
    item.kind === "project" ? store.updateProject(item.id, p) : store.updateInitiative(item.id, p);
  const run = (fn: () => Promise<void> | void) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const keep = current ? run(() => resolve(current.id)) : undefined;
  const park = current ? run(async () => { await patch(current, { status: "waiting" }); resolve(current.id); }) : undefined;
  const cut = current ? run(async () => { await patch(current, { status: "cancelled" }); resolve(current.id); }) : undefined;
  const reschedule = (iso: string) =>
    current ? run(async () => { await patch(current, { targetDate: iso }); resolve(current.id); })() : undefined;

  // Esc leaves; ↵ keeps the one in front of you (or closes once settled)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const el = e.target as HTMLElement;
        if (el.tagName === "INPUT") return;
        onClose();
        return;
      }
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || keyIsTaken(e) || rescheduling) return;
      e.preventDefault();
      if (finished) onClose();
      else void keep?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const datable = !!current && (current.overdue || !!current.targetDate);

  return (
    <FlowFrame
      label="Capacity"
      onClose={onClose}
      center={<span className="f-top-title">Capacity</span>}
      right={queue && !finished ? <span className="f-top-meta">{position}</span> : undefined}
      footer={
        <FlowFoot
          summary={
            <>
              <b>{live.length}</b> in flight
              {overdue > 0 ? <> · <b>{overdue}</b> overdue</> : null}
              {noPlan > 0 ? <> · <b>{noPlan}</b> no plan</> : null}
            </>
          }
        >
          {finished || !current ? (
            <Button kind="primary" size="md" shortcut="↵" onClick={onClose} disabled={!finished}>
              Done
            </Button>
          ) : (
            <>
              <Button kind="ghost" size="md" className="f-danger" onClick={() => void cut?.()} disabled={busy} title="Drop it — it leaves your load">
                Cut
              </Button>
              <Button size="md" onClick={() => void park?.()} disabled={busy} title="Rest it out of flight — it eases your load">
                Park
              </Button>
              {datable && (
                <Button size="md" onClick={() => setRescheduling(true)} disabled={busy}>
                  Reschedule
                </Button>
              )}
              <Button kind="primary" size="md" shortcut="↵" onClick={() => void keep?.()} disabled={busy}>
                Keep
              </Button>
            </>
          )}
        </FlowFoot>
      }
    >
      <div className="f-scroll">
        <div className="f-page grid gap-6" data-width="narrow">
          {!ready || queue == null ? (
            <EmptyState>Reading your load…</EmptyState>
          ) : (
            <>
              {/* the persistent board — the load read, easing live */}
              <div className="grid gap-3">
                <FlowHead
                  kicker="What you're carrying"
                  hero={
                    <>
                      Your load is <span style={{ color: bandColor(band) }}>{BAND_LABEL[band].toLowerCase()}</span>.
                    </>
                  }
                />
                <FlowMeter
                  total={1}
                  segments={[{ key: "band", value: bandFill(band), color: bandColor(band), title: BAND_LABEL[band] }]}
                  ticks={[
                    { key: "t1", at: 0.34 },
                    { key: "t2", at: 0.66 },
                  ]}
                  label={`Load: ${BAND_LABEL[band]}`}
                />
              </div>

              {current ? (
                <LoadCard
                  key={current.id}
                  item={current}
                  rescheduling={rescheduling}
                  busy={busy}
                  onReschedule={(iso) => void reschedule(iso)}
                  onCancelReschedule={() => setRescheduling(false)}
                />
              ) : (
                <Settled band={band} reviewed={resolved.size} remaining={live.length} />
              )}
            </>
          )}
        </div>
      </div>
    </FlowFrame>
  );
}

// ── the focal card — one in-flight commitment, one verdict ────────────────────
function LoadCard({
  item,
  rescheduling,
  busy,
  onReschedule,
  onCancelReschedule,
}: {
  item: LoadItem;
  rescheduling: boolean;
  busy: boolean;
  onReschedule: (iso: string) => void;
  onCancelReschedule: () => void;
}) {
  const { data } = useVertical();
  const accent = domainById(data, item.domainId)?.color ?? "var(--accent)";
  const [date, setDate] = useState(item.targetDate || proposeDueISO());

  return (
    <Card className="!gap-3 !p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex h-5 items-center">
          <Dot color={accent} />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="f-title">{item.name}</h2>
          <span className="text-caption text-muted">{item.kind === "initiative" ? "Initiative" : "Project"}</span>
        </div>
      </div>

      <p className="f-line" style={{ color: item.liability ? "var(--warn)" : "var(--muted)" }}>
        {item.reason}
        {item.targetDate && !item.overdue ? ` · due ${fmtDate(item.targetDate)}` : ""}
      </p>

      {rescheduling && (
        <div className="flex flex-wrap items-center gap-2" style={{ boxShadow: "inset 0 1px 0 var(--line-1)", paddingTop: 12 }}>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            autoFocus
            icon={<Icon name="calendar" size={14} />}
            frameClassName="min-w-[180px] flex-1"
            aria-label="New finish line"
          />
          <Button kind="primary" size="md" onClick={() => onReschedule(date)} disabled={busy || !date}>
            {busy ? "Setting…" : "Set date"}
          </Button>
          <Button kind="ghost" size="md" onClick={onCancelReschedule} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
    </Card>
  );
}

// ── settled ───────────────────────────────────────────────────────────────────
function Settled({ band, reviewed, remaining }: { band: Band; reviewed: number; remaining: number }) {
  return (
    <Card className="!gap-1 !p-5">
      <div className="flex items-center gap-2">
        <span className="f-tick" data-done="" style={{ background: bandColor(band), borderColor: bandColor(band) }}>
          <Icon name="check" size={10} strokeWidth={2.6} />
        </span>
        <h2 className="f-title">Settled</h2>
      </div>
      <p className="f-fact pl-6">
        {reviewed > 0 ? (
          <>
            Reviewed <b>{reviewed}</b> ·{" "}
          </>
        ) : null}
        {remaining === 0 ? "nothing left in flight" : <><b>{remaining}</b> still in flight{band === "comfortable" ? ", and it fits" : ""}</>}
      </p>
    </Card>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
