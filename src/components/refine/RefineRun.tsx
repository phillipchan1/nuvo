// The Groom flow — one hub, gap-driven lenses (docs/grooming-lenses.md).
// On Deck (the When timeline) is the home; each item that needs work is routed
// to the single lens that closes its gap: The Brief (What → Defined) or The
// Path (How → Planned). The old card deck (ItemRun) is retired — its gaps
// dissolved into the lenses via the §4 map.
//
// The guided pass is per-PROJECT, not per-phase: "Groom the N that need it"
// deals the gapped items in demand order, each getting only its needed
// lens(es), with visible progress and a coverage-climb payoff at the end.
// Never a wizard — most items need exactly one lens.

import { useEffect, useMemo, useRef, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { useCapacity } from "../../hooks/useCapacity";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import {
  domainById,
  initiativeById,
  projectById,
  type Initiative,
  type Project,
  type SoundnessVerdict,
  type VerticalData,
} from "../../lib/vertical";
import {
  ripenessOfInitiative,
  ripenessOfProject,
  soundnessSig,
  verdictOf,
} from "../../lib/tending";
import { itemsNeedingLenses, lensesFor, LENS_LABEL, type LensKind, type LensRef } from "../../lib/lenses";
import { demandContext, readOnDeck } from "../../lib/onDeck";
import OnDeckTimeline from "../ondeck/OnDeckTimeline";
import BriefLens from "../grooming/BriefLens";
import PathLens from "../grooming/PathLens";

type Kind = "project" | "initiative";

// ─────────────────────────────────────────────────────────────────────────────
export default function RefineRun({ onClose }: { onClose: () => void }) {
  const { data, ready } = useVertical();
  const { nav } = useAppNavigation();
  const { byWeek, weeklyAvgMins } = useCapacity();
  const [queue, setQueue] = useState<LensRef[] | null>(null);
  const [idx, setIdx] = useState(0);

  // The coverage headline ("weeks stocked") — captured when a pass starts so
  // the finish can show the climb. Recomputed live as lenses write.
  const now = useRef(new Date()).current;
  const coverage = useMemo(
    () => readOnDeck(data, byWeek, weeklyAvgMins, now).coverageWeeks,
    [data, byWeek, weeklyAvgMins, now],
  );
  const coverageAtStart = useRef<number | null>(null);

  const startRun = (refs: LensRef[]) => {
    if (!refs.length) return;
    coverageAtStart.current = coverage;
    setQueue(refs);
    setIdx(0);
  };

  // Opened pointed somewhere: a single item (a to-groom row / gap chip tap) or
  // the Initiatives floor's guided pass (no On Deck at that altitude — §8).
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!ready || focusedRef.current) return;
    const f = nav.flowFocus;
    if (!f) return;
    focusedRef.current = true;
    if (f.pass === "initiative") {
      const refs = itemsNeedingLenses(data, "initiative", new Date()).map(
        ({ item }): LensRef => ({ kind: "initiative", id: item.id }),
      );
      coverageAtStart.current = coverage;
      setQueue(refs); // empty = straight to the "all groomed" state
      setIdx(0);
    } else if (f.pass === "project") {
      // The On Deck floor's "Groom the N" — rebuild the identical demand-ordered
      // queue the board's own button deals (readOnDeck, gapped lanes in order).
      const refs = readOnDeck(data, byWeek, weeklyAvgMins, now).lanes
        .filter((l) => l.gaps.length > 0)
        .map((l): LensRef => ({ kind: "project", id: l.project.id }));
      coverageAtStart.current = coverage;
      setQueue(refs);
      setIdx(0);
    } else if (f.kind && f.id) {
      startRun([{ kind: f.kind, id: f.id, lens: f.lens }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, nav.flowFocus, data]);

  if (!ready) return <Scaffold onClose={onClose}><Centered>Reading the portfolio…</Centered></Scaffold>;

  const finished = queue != null && idx >= queue.length;
  const inRun = queue != null && !finished;
  const current = inRun ? queue![idx] : null;
  const item = current ? (current.kind === "project" ? projectById(data, current.id) : initiativeById(data, current.id)) : null;

  // A hubless run never lands on the flow's in-flow timeline: both guided passes
  // (project + initiative) close straight back to the floor they were dealt from
  // — the On Deck / Initiatives floor is the real hub now.
  const hubless = queue != null && (nav.flowFocus?.pass != null || (queue.length > 0 && queue.every((r) => r.kind === "initiative")));
  // Initiative passes get bespoke finish copy ("ready for projects to run under
  // them"); everything project-shaped shows the weeks-stocked climb.
  const initiativePass = nav.flowFocus?.pass === "initiative" || (queue != null && queue.length > 0 && queue.every((r) => r.kind === "initiative"));
  const toHub = () => { setQueue(null); setIdx(0); };

  // the hub — the demand-phased On Deck board; every pass deals from it
  if (queue == null) {
    return (
      <Scaffold onClose={onClose}>
        <OnDeckTimeline data={data} onStart={startRun} />
      </Scaffold>
    );
  }

  if (finished || !item) {
    return (
      <Scaffold onClose={onClose} onBack={hubless ? undefined : toHub}>
        <PassDone
          count={queue.length}
          coverageFrom={coverageAtStart.current}
          coverageTo={coverage}
          closeToFloor={hubless}
          initiative={initiativePass}
          onBack={toHub}
          onClose={onClose}
        />
      </Scaffold>
    );
  }

  return (
    <Scaffold onClose={onClose} onBack={hubless ? undefined : toHub}>
      <ItemLensRun
        key={`${current!.kind}:${current!.id}`}
        data={data}
        kind={current!.kind}
        item={item}
        pinnedLens={current!.lens}
        position={queue!.length > 1 ? `${idx + 1} of ${queue!.length}` : null}
        isLast={idx === queue!.length - 1}
        onNext={() => setIdx((i) => i + 1)}
      />
    </Scaffold>
  );
}

// ── full-screen frame ─────────────────────────────────────────────────────────
function Scaffold({ children, onClose, onBack }: { children: React.ReactNode; onClose: () => void; onBack?: () => void }) {
  return (
    <div className="atmosphere fixed inset-0 z-50 flex flex-col bg-bg">
      <header className="mobile-topbar pt-safe flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <button onClick={onBack ?? onClose} aria-label={onBack ? "Back to On Deck" : "Close"} className="tap fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted active:scale-95">
          {onBack ? "←" : "✕"}
        </button>
        <span className="wordmark wordmark-grad text-lead">Groom</span>
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
// One item's turn in the pass: the lens(es) its gaps need, in ladder order
// (Brief before Path), frozen at entry so a closing axis never yanks the UI.
function ItemLensRun({
  data, kind, item, pinnedLens, position, isLast, onNext,
}: {
  data: VerticalData; kind: Kind; item: Project | Initiative;
  pinnedLens?: LensKind; position: string | null; isLast: boolean; onNext: () => void;
}) {
  const store = useVertical();
  const { byWeek, weeklyAvgMins } = useCapacity();
  const nowRef = useRef(new Date());

  const [lenses] = useState<LensKind[]>(() => {
    if (pinnedLens) return [pinnedLens];
    const needed = lensesFor(data, kind, item, nowRef.current);
    return needed.length ? needed : ["brief"]; // groom-anyway fallback: revisit the brief
  });
  const [li, setLi] = useState(0);
  const lens = lenses[li];

  // Nuvo's soundness verdict — fetched once a path exists, so the lens prefills
  // (sharper outcome, missing steps) can ride it. Same contract as the old deck.
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
      } catch (e) { console.warn("[groom] verify failed", e); }
      finally { if (live) setVerifying(false); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantVerdict, verdict, item.id]);

  // the "why now" band — the demand context this item was dealt by (projects only)
  const demand = demandContext(data, byWeek, weeklyAvgMins, { kind, id: item.id }, nowRef.current);

  const advance = async () => {
    if (li < lenses.length - 1) {
      setLi(li + 1);
      return;
    }
    try { await store.tend(kind, item.id); } catch (e) { console.warn("[groom] tend failed", e); }
    onNext();
  };

  const nextLens = li < lenses.length - 1 ? lenses[li + 1] : null;
  const doneLabel = nextLens
    ? `Next: the ${LENS_LABEL[nextLens]} →`
    : isLast
      ? (position ? "See the gain →" : "Done →")
      : "Next project →";

  const domain = domainById(data, item.domainId);

  return (
    <div className="pt-3">
      {/* the pass header — where you are, and why this one now */}
      <div className="flex items-center justify-between gap-3">
        <div className="section-label !p-0">
          {position ? `Groom · ${kind === "initiative" ? "bet" : "project"} ${position}` : `Groom · ${domain?.name ?? ""}`}
        </div>
        {lenses.length > 1 && (
          <div className="flex items-center gap-1.5">
            {lenses.map((l, i) => (
              <span
                key={l}
                className="rounded-full px-2 py-0.5 text-micro font-medium"
                style={
                  i === li
                    ? { background: "var(--accent)", color: "white" }
                    : i < li
                      ? { color: "var(--accent)" }
                      : { border: "1px solid var(--line)", color: "var(--muted)" }
                }
              >
                {i < li ? "✓ " : ""}{LENS_LABEL[l]}
              </span>
            ))}
          </div>
        )}
      </div>

      {demand && (
        <div className="mt-2 rounded-lg px-3.5 py-2.5" style={{ background: "var(--accent-soft)" }}>
          <div className="section-label !p-0" style={{ color: "var(--accent)" }}>Why now</div>
          <p className="mt-0.5 text-caption leading-relaxed text-ink/85">{demand.line}</p>
        </div>
      )}

      {verifying && !verdict && (
        <p className="mt-2 text-meta text-muted">✦ {ASSISTANT_NAME} is checking this one over in the background…</p>
      )}

      {lens === "brief" ? (
        <BriefLens
          key={`${item.id}:brief`}
          data={data}
          kind={kind}
          item={item}
          verdict={verdict}
          onDone={() => void advance()}
          doneLabel={doneLabel}
        />
      ) : (
        <PathLens
          key={`${item.id}:path`}
          data={data}
          kind={kind}
          item={item}
          onDone={() => void advance()}
          doneLabel={doneLabel}
        />
      )}
    </div>
  );
}

// ── the finish — the pass's payoff, coverage climbing ─────────────────────────
function PassDone({
  count, coverageFrom, coverageTo, closeToFloor, initiative, onBack, onClose,
}: {
  count: number; coverageFrom: number | null; coverageTo: number; closeToFloor: boolean; initiative: boolean; onBack: () => void; onClose: () => void;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setShow(true)); return () => cancelAnimationFrame(t); }, []);
  const climbed = coverageFrom != null && coverageTo > coverageFrom;
  return (
    <Centered>
      <div
        className="glass-card w-full rounded-xl border border-line px-5 py-8 text-center"
        style={{
          background: "color-mix(in srgb, var(--accent) 8%, var(--surface))",
          opacity: show ? 1 : 0,
          transform: show ? "scale(1)" : "scale(.96)",
          transition: "all .45s var(--ease-out)",
        }}
      >
        <div className="text-[30px]" style={{ color: "var(--accent)" }}>✦</div>
        <div className="mt-1 text-head masthead">
          {count === 0 ? "Nothing needs grooming" : `${count} groomed`}
        </div>
        {count === 0 ? (
          <p className="mt-1 text-caption text-muted">Every bet here is defined and planned — all at rest.</p>
        ) : initiative ? (
          <p className="mt-1 text-caption text-muted">Defined and planned — ready for projects to run under them.</p>
        ) : (
          <p className="mt-1 text-caption text-muted">
            {climbed
              ? <>Weeks stocked: <span className="mono">{coverageFrom}</span> → <span className="mono" style={{ color: "var(--accent)" }}>{coverageTo}</span></>
              : <>{coverageTo} weeks of ready work stocked.</>}
          </p>
        )}
        <button
          onClick={closeToFloor ? onClose : onBack}
          className="tap fast mt-5 rounded-lg px-5 py-2.5 text-body font-medium text-white active:scale-[.98]"
          style={{ background: "var(--accent)" }}
        >
          {closeToFloor ? "Done →" : "Back to On Deck →"}
        </button>
      </div>
    </Centered>
  );
}
