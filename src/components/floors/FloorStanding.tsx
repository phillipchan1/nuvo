// The Standing — where the Project / Initiative floor stands, on three honest
// axes (Defined · Capacity · Motion) read off the live snapshot. Assessment
// only: it reports, and each axis that isn't calm is the door to the play that
// moves it (Defined → Groom, Capacity → On Deck to triage). See
// src/lib/standing.ts and docs/refine-run.md.
//
// On the List layout (D-190) the Table has no hero, so the standing no longer
// stands above it as three cards and a sentence: it folds into the filter row
// as three readouts — a label, a 3px meter, the value — and the synthesis and
// each axis's blurb ride their tooltips.

import { useVertical } from "../../hooks/useVertical";
import { readStanding, type Band, type Kind } from "../../lib/standing";
import { PROJECT_STATUS_COLORS } from "./statusColors";
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

function Readout({
  label,
  value,
  fill,
  fillColor,
  blurb,
  onClick,
  action,
}: {
  label: string;
  value: string;
  fill: number; // 0..1
  fillColor: string;
  blurb: string;
  /** when present, the readout is the doorway to the play that moves it. */
  onClick?: () => void;
  /** what the door does — named in the tooltip and the accessible label. */
  action?: string;
}) {
  const inner = (
    <>
      <span>{label}</span>
      <span className="fl-stand-meter" aria-hidden>
        <i style={{ width: `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`, ["--fill" as string]: fillColor }} />
      </span>
      <b>{value}</b>
    </>
  );
  const title = action ? `${blurb} — ${action}` : blurb;
  if (onClick) {
    return (
      <button type="button" className="fl-stand-read" onClick={onClick} title={title} aria-label={`${label} ${value}. ${title}`}>
        {inner}
      </button>
    );
  }
  return (
    <span className="fl-stand-read" title={title}>
      {inner}
    </span>
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
  /** When false, the WIP Capacity readout is omitted — the surface owns that
   *  read elsewhere (e.g. the projects Commitment meter folds it in). */
  showCapacity?: boolean;
  /** @deprecated the synthesis rides the tooltip now — kept for call-site compat. */
  quietSynthesis?: boolean;
}) {
  const { data } = useVertical();
  const s = readStanding(data, kind);
  const definedPct = Math.round(s.defined * 100);

  return (
    <div className="fl-stand" role="group" aria-label="Standing" title={s.synthesis}>
      <Readout
        label="Defined"
        value={`${definedPct}%`}
        fill={s.defined}
        fillColor={READY}
        blurb={s.definedBlurb}
        onClick={s.calm ? undefined : onRefine}
        action={s.calm ? undefined : "Groom"}
      />
      {showCapacity && (
        <Readout
          label="Capacity"
          value={BAND_LABEL[s.capacity]}
          fill={bandFill(s.capacity)}
          fillColor={bandColor(s.capacity)}
          blurb={s.capacityBlurb}
          onClick={s.capacity === "comfortable" ? undefined : onAllocate}
          action={s.capacity === "comfortable" ? undefined : "Triage on On Deck"}
        />
      )}
      <Readout
        label="Motion"
        value={s.motionTotal ? `${s.motionMoving}/${s.motionTotal}` : "—"}
        fill={s.motionTotal ? s.motionMoving / s.motionTotal : 1}
        fillColor={s.motionTotal && s.motionMoving < s.motionTotal ? CAUTION : READY}
        blurb={s.motionBlurb}
      />
    </div>
  );
}
