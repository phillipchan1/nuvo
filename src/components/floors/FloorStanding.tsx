// The Standing — the interpretive front door of the Project / Initiative floors.
// Three honest axes (Defined · Capacity · Motion) read off the live snapshot, a
// Fraunces synthesis, and the single handoff to the Refine run. Assessment only —
// it reports where you stand and names the one convergent exception; the play that
// moves it is Refine. See src/lib/standing.ts and docs/refine-run.md.

import { useVertical } from "../../hooks/useVertical";
import { readStanding, type Band, type Kind } from "../../lib/standing";
import { PROJECT_STATUS_COLORS } from "./parts";
import { READY } from "./ReadinessBanner";

const CAUTION = PROJECT_STATUS_COLORS.waiting; // the one caution amber — tight & over

function bandColor(b: Band): string {
  return b === "comfortable" ? READY : CAUTION;
}
function bandFill(b: Band): number {
  return b === "comfortable" ? 0.34 : b === "tight" ? 0.66 : 1;
}
const BAND_LABEL: Record<Band, string> = {
  comfortable: "Comfortable",
  tight: "Tight",
  overcommitted: "Overcommitted",
};

function Gauge({
  label,
  value,
  valueColor,
  fill,
  fillColor,
  blurb,
  onClick,
  action,
}: {
  label: string;
  value: string;
  valueColor?: string;
  fill: number; // 0..1
  fillColor: string;
  blurb: string;
  /** when present, the whole gauge becomes the doorway to the play that moves it. */
  onClick?: () => void;
  /** the always-visible affordance label (e.g. "Groom") — no hover-only actions. */
  action?: string;
}) {
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="section-label !p-0">{label}</span>
        <span className="mono shrink-0 text-meta" style={{ color: valueColor ?? "var(--ink)" }}>
          {value}
        </span>
      </div>
      <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div
          className="fast absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.round(fill * 100)}%`, background: fillColor }}
        />
      </div>
      <p className="mt-2.5 text-caption text-muted">{blurb}</p>
      {action && (
        <div className="mt-3 flex items-center gap-1 text-caption font-medium" style={{ color: "var(--accent)" }}>
          {action}
          <span className="fast transition-transform group-hover:translate-x-0.5">›</span>
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="glass-card lift-anim group rounded-xl border border-line p-4 text-left shadow-[var(--shadow-2)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] active:scale-[.99]"
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="glass-card rounded-xl border border-line p-4" style={{ boxShadow: "var(--shadow-2)" }}>
      {inner}
    </div>
  );
}

export default function FloorStanding({
  kind,
  onRefine,
  onAllocate,
  showCapacity = true,
}: {
  kind: Kind;
  onRefine: () => void;
  onAllocate: () => void;
  /** When false, the WIP Capacity gauge is omitted — the surface owns that read
   *  elsewhere (e.g. the projects Commitment meter folds it in). */
  showCapacity?: boolean;
}) {
  const { data } = useVertical();
  const s = readStanding(data, kind);

  const definedPct = Math.round(s.defined * 100);

  return (
    <div className="mb-6 max-w-[920px]">
      <div className={`grid grid-cols-1 gap-3 ${showCapacity ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        <Gauge
          label="Defined"
          value={`${definedPct}%`}
          valueColor={s.defined >= 0.85 ? READY : "var(--muted)"}
          fill={s.defined}
          fillColor={READY}
          blurb={s.definedBlurb}
          onClick={s.calm ? undefined : onRefine}
          action={s.calm ? undefined : "Groom"}
        />
        {showCapacity && (
          <Gauge
            label="Capacity"
            value={BAND_LABEL[s.capacity]}
            valueColor={bandColor(s.capacity)}
            fill={bandFill(s.capacity)}
            fillColor={bandColor(s.capacity)}
            blurb={s.capacityBlurb}
            onClick={s.capacity === "comfortable" ? undefined : onAllocate}
            action={s.capacity === "comfortable" ? undefined : "Triage"}
          />
        )}
        <Gauge
          label="Motion"
          value={s.motionTotal ? `${s.motionMoving} / ${s.motionTotal} moving` : "—"}
          valueColor={s.motionTotal && s.motionMoving < s.motionTotal ? CAUTION : READY}
          fill={s.motionTotal ? s.motionMoving / s.motionTotal : 1}
          fillColor={READY}
          blurb={s.motionBlurb}
        />
      </div>

      <p className="masthead mt-5 max-w-[44ch] text-lead text-ink">{s.synthesis}</p>
    </div>
  );
}
