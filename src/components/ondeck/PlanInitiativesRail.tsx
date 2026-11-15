// Plan initiatives — the rail's Plan mode on the initiative deck (D-216,
// docs/offer-rules.md §4): Plan projects' walk two clock speeds up. It walks
// the deck's not-Ready bets, rawest first, one at a time:
//
//   1 · Shape    what a bet needs to be Ready (an outcome, and one number it
//                moves — `initiativeReadinessAxes`), plus the deck's own ✦
//                Suggest projects (Draft the projects, D-196) for the work
//                under it. One press writes what you typed.
//   2 · Quarter  the quarter it finishes in, as at most two choices with their
//                collision named, plus Park it. Pointing at one lights that
//                quarter on the deck; pressing is the deck's own move.
//
// Nothing is written until you press; Esc leaves.

import { useEffect, useRef, useState } from "react";
import type { Initiative, VerticalData } from "../../lib/vertical";
import { domainById } from "../../lib/vertical";
import type { InitiativeLane, QuarterColumn } from "../../lib/initiativeDeck";
import { lookLast, quarterOffers, type QuarterOccupant } from "../../lib/planProjects";
import { Button, Dest, Dot, Input, OfferChip } from "../kit";
import { FlowHead } from "../rituals/FlowShell";
import { SpanChoice, WalkFinished, WalkShell } from "./PlanWalk";

export interface PlanInitiativesProps {
  data: VerticalData;
  lanes: readonly InitiativeLane[];
  order: readonly string[];
  ready: number;
  total: number;
  quarters: readonly QuarterColumn[];
  occupants: readonly QuarterOccupant[];
  cap: number;
  width?: string | number;
  /** write what the shape phase typed: an outcome, and/or a first key result */
  shape: (i: Initiative, typed: { outcome: string | null; keyResult: string | null }) => void;
  /** Draft the projects (D-196) — the deck's own door, when it has one */
  draftProjects: ((lane: InitiativeLane, from: DOMRect | null) => void) | null;
  canDraft: (lane: InitiativeLane) => boolean;
  place: (i: Initiative, quarterIdx: number) => void;
  park: (i: Initiative) => void;
  onPreview: (p: { id: string; quarter: number } | null) => void;
  onWalk: (id: string | null) => void;
  onClose: () => void;
}

export default function PlanInitiativesRail(props: PlanInitiativesProps) {
  const { data, order: initial, ready, total, onClose, onWalk, onPreview } = props;
  const [order, setOrder] = useState<string[]>(() => [...initial]);
  const [settled, setSettled] = useState<Set<string>>(() => new Set());
  const [phase, setPhase] = useState<"shape" | "quarter">("shape");
  const currentId = order.find((id) => !settled.has(id)) ?? null;
  const bet = currentId ? data.initiatives.find((i) => i.id === currentId) ?? null : null;
  const lane = bet ? props.lanes.find((l) => l.initiative.id === bet.id) ?? null : null;

  useEffect(() => {
    onWalk(bet?.id ?? null);
  }, [bet?.id, onWalk]);
  useEffect(() => () => onWalk(null), [onWalk]);

  const later = (id: string) => {
    onPreview(null);
    setOrder((o) => lookLast(o, id));
    setPhase("shape");
  };
  const next = (id: string) => {
    onPreview(null);
    setSettled((s) => new Set(s).add(id));
    setPhase("shape");
  };
  const live = useRef({ bet, later });
  live.current = { bet, later };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.matches("input, textarea") || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "j" || e.key === "J") && live.current.bet) {
        e.preventDefault();
        live.current.later(live.current.bet.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <WalkShell title="Plan initiatives" ready={ready} total={total} width={props.width} onClose={onClose}>
      {!bet || !lane ? (
        <WalkFinished ready={ready} total={total} onClose={onClose} />
      ) : phase === "shape" ? (
        <ShapeStep key={bet.id} {...props} bet={bet} lane={lane} onDone={() => setPhase("quarter")} onLater={() => later(bet.id)} />
      ) : (
        <QuarterStep key={bet.id} {...props} bet={bet} lane={lane} onSettled={() => next(bet.id)} onLater={() => later(bet.id)} />
      )}
    </WalkShell>
  );
}

function Head({ data, bet, phase }: { data: VerticalData; bet: Initiative; phase: "shape" | "quarter" }) {
  const domain = domainById(data, bet.domainId);
  return (
    <FlowHead
      kicker={
        <span className="inline-flex items-center gap-1.5">
          <Dot color={domain?.color ?? "var(--accent)"} />
          {domain?.name ?? "No area"}
        </span>
      }
      hero={bet.name}
      fact={phase === "shape" ? "First, what it's for." : "Then, the quarter."}
    />
  );
}

function ShapeStep({
  data,
  bet,
  lane,
  shape,
  draftProjects,
  canDraft,
  onDone,
  onLater,
}: PlanInitiativesProps & { bet: Initiative; lane: InitiativeLane; onDone: () => void; onLater: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [kr, setKr] = useState("");
  const needsOutcome = bet.outcome.trim() === "";
  const needsKr = bet.keyResults.length === 0;
  const projects = data.projects.filter((p) => p.initiativeId === bet.id).length;
  const typedOutcome = needsOutcome && outcome.trim() ? outcome.trim() : null;
  const typedKr = needsKr && kr.trim() ? kr.trim() : null;
  const verb =
    typedOutcome && typedKr
      ? { verb: "Set the outcome and a number for", name: bet.name }
      : typedOutcome
        ? { verb: "Set the outcome of", name: bet.name }
        : typedKr
          ? { verb: "Add a key result to", name: bet.name }
          : null;
  return (
    <>
      <Head data={data} bet={bet} phase="shape" />
      {needsOutcome ? (
        <div className="grid gap-1.5">
          <span className="text-label font-semibold text-[var(--faint)]">Outcome</span>
          <Input size="sm" placeholder="What's true when it's done?" aria-label="The outcome" value={outcome} onChange={(e) => setOutcome(e.currentTarget.value)} />
        </div>
      ) : (
        <p className="pw-said">{bet.outcome}</p>
      )}
      {needsKr ? (
        <div className="grid gap-1.5">
          <span className="text-label font-semibold text-[var(--faint)]">The number it moves</span>
          <Input size="sm" placeholder="“Members reached”" aria-label="A key result" value={kr} onChange={(e) => setKr(e.currentTarget.value)} />
        </div>
      ) : (
        <p className="pw-said">
          {bet.keyResults.length} key result{bet.keyResults.length === 1 ? "" : "s"}
        </p>
      )}
      {/* Nuvo's offer reads like every other one (D-205): accent ink after
          the fact it answers, flush with it — not a ghost button indented by
          its own padding. */}
      <p className="pw-said flex flex-wrap items-baseline gap-x-2">
        <span>{projects === 0 ? "No projects under it yet." : `${projects} project${projects === 1 ? "" : "s"} under it.`}</span>
        {draftProjects && canDraft(lane) && (
          <OfferChip
            verb="Suggest projects"
            title="Nuvo drafts the projects this outcome is missing, across the quarter. Nothing is added until you hold it."
            onPress={(el) => draftProjects(lane, el.getBoundingClientRect())}
          />
        )}
      </p>
      <div className="grid gap-1.5">
        <Button
          kind={verb ? "primary" : "secondary"}
          size="md"
          full
          onClick={() => {
            if (typedOutcome || typedKr) shape(bet, { outcome: typedOutcome, keyResult: typedKr });
            onDone();
          }}
        >
          {verb ? <Dest verb={verb.verb} name={verb.name} /> : "On to the quarter"}
        </Button>
        <Button size="sm" kind="ghost" full shortcut="J" onClick={onLater}>
          Look at it last
        </Button>
      </div>
    </>
  );
}

function QuarterStep({
  data,
  bet,
  lane,
  quarters,
  occupants,
  cap,
  place,
  park,
  onPreview,
  onSettled,
  onLater,
}: PlanInitiativesProps & { bet: Initiative; lane: InitiativeLane; onSettled: () => void; onLater: () => void }) {
  const offers = quarterOffers({
    id: bet.id,
    domainId: bet.domainId ?? null,
    earliest: lane.quarterIdx ?? 0,
    quarters: quarters.length,
    labelOf: (q) => quarters[q]?.shortLabel ?? `Q${q}`,
    others: occupants,
    cap,
  });
  return (
    <>
      <Head data={data} bet={bet} phase="quarter" />
      <div className="grid gap-3">
        {offers.map((o, i) => (
          <SpanChoice
            key={o.quarter}
            verb="Finish in"
            name={quarters[o.quarter]?.shortLabel ?? ""}
            cost={o.cost}
            reason={o.reason ?? (o.cost ? null : "A clear quarter")}
            primary={i === 0}
            onPick={() => {
              onPreview(null);
              place(bet, o.quarter);
              onSettled();
            }}
            onPoint={(on) => onPreview(on ? { id: bet.id, quarter: o.quarter } : null)}
          />
        ))}
      </div>
      <div className="grid gap-1.5">
        <Button
          size="sm"
          kind="ghost"
          full
          onClick={() => {
            onPreview(null);
            park(bet);
            onSettled();
          }}
        >
          Park it
        </Button>
        <Button size="sm" kind="ghost" full shortcut="J" onClick={onLater}>
          Look at it last
        </Button>
      </div>
    </>
  );
}
