/**
 * Draft the projects, on the phone (D-196). The same draft as the desktop's
 * quarter (`ondeck/ProjectDraftQuarter`), over the same hook — laid out for a
 * thumb: a strip of the quarter's weeks (how many projects run in each), then
 * the drafted projects as cards in start order. The card you tap carries every
 * act as a 44px button; nothing hides behind a gesture.
 */

import { useState } from "react";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { spanLabel } from "../../lib/projectDraft";
import type { Initiative } from "../../lib/vertical";
import { Icon } from "../Icon";
import { ChipButton, Input } from "../kit";
import { PROJECT_STEERS, useProjectDraft, type GhostProject } from "../ondeck/useProjectDraft";
import Sheet from "./Sheet";
import { SheetMast, SHEET_SCROLL } from "./sheetKit";
import { TouchButton } from "./touch";

export default function MobileProjectDraft({
  initiative,
  quarterLabel,
  domainName,
  color,
  weeks,
  onClose,
}: {
  initiative: Initiative;
  quarterLabel: string;
  domainName: string | null;
  color: string;
  weeks: string[];
  onClose: () => void;
}) {
  const draft = useProjectDraft(initiative, weeks);
  const [steer, setSteer] = useState("");
  const review = draft.phase === "review";
  const close = () => {
    if (draft.remaining && review) draft.discard();
    onClose();
  };

  return (
    <Sheet onClose={close} tall contentClassName={SHEET_SCROLL}>
      <div className="ph-body pb-4">
        <SheetMast color={color} crumb={[domainName, quarterLabel].filter(Boolean).join(" · ")} meta={initiative.outcome}>
          <h2 className="text-display masthead">{initiative.name}</h2>
        </SheetMast>

        <div className="pdm-strip" style={{ ["--n" as string]: weeks.length }} aria-label="Projects running each week">
          {draft.load.map((n, i) => (
            <span key={weeks[i]} data-load={Math.min(n, 3)} title={`${n} running`} />
          ))}
        </div>

        <div className="grid gap-2">
          {draft.own.map((o) => (
            <div key={o.id} className="pdm-card" data-own="" style={{ ["--h" as string]: color }}>
              <span className="pdm-name">{o.name}</span>
              {o.outcome && <span className="pdm-out">{o.outcome}</span>}
              <span className="pdm-span mono">{spanLabel(weeks, o)} · yours</span>
            </div>
          ))}
          {draft.ghosts.map((g) => (
            <GhostCard key={g.key} g={g} weeks={weeks} on={g.key === draft.cursor} draft={draft} />
          ))}
        </div>

        {(draft.phase === "reading" || draft.phase === "streaming") && (
          <p className="mt-3 text-caption text-muted">{ASSISTANT_NAME} is reading the outcome and the quarter…</p>
        )}
        {draft.message && <p className="mt-3 text-caption text-muted">{draft.message}</p>}
        {draft.phase === "done" && !draft.message && (
          <p className="mt-3 text-caption text-muted">
            {draft.held
              ? `Held ${draft.held} project${draft.held === 1 ? "" : "s"}. Each is on the project deck in its weeks.`
              : "Draft put away. Nothing changed."}
          </p>
        )}
      </div>

      <div className="path-draft-bar" role="region" aria-label="Drafted projects">
        {draft.phase === "reading" && <div className="path-draft-reading" role="progressbar" aria-label="Drafting" />}
        {review && draft.remaining > 0 && (
          <>
            <Input
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              placeholder="Steer what you haven't held…"
              aria-label="Steer the draft"
              enterKeyHint="send"
              onKeyDown={(e) => {
                if (e.key === "Enter" && steer.trim()) {
                  e.preventDefault();
                  void draft.steer(steer);
                  setSteer("");
                }
              }}
            />
            <div className="path-draft-chips">
              {PROJECT_STEERS.map((s) => (
                <ChipButton key={s} className="tap" onClick={() => void draft.steer(s)}>
                  {s}
                </ChipButton>
              ))}
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          {review && draft.remaining > 0 ? (
            <>
              <TouchButton kind="ghost" onClick={draft.discard}>
                Discard rest
              </TouchButton>
              <TouchButton kind="primary" onClick={draft.holdAll}>
                Hold all
              </TouchButton>
            </>
          ) : (
            <TouchButton kind="primary" onClick={onClose}>
              Done
            </TouchButton>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function GhostCard({ g, weeks, on, draft }: { g: GhostProject; weeks: string[]; on: boolean; draft: ReturnType<typeof useProjectDraft> }) {
  return (
    <div className="pdm-card" data-ghost="" data-on={on ? "" : undefined}>
      <button type="button" className="pdm-card-hit" onClick={() => draft.setCursor(g.key)} aria-expanded={on}>
        <span className="pdm-name">{g.name}</span>
        {g.outcome && <span className="pdm-out">{g.outcome}</span>}
        <span className="pdm-span mono">
          {spanLabel(weeks, g.span)}
          {g.versions.length > 1 && ` · version ${g.v + 1} of ${g.versions.length}`}
        </span>
      </button>
      {on && (
        <div className="grid gap-2 pt-1">
          {g.why && <p className="text-caption text-muted">{g.why}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <TouchButton compact kind="ghost" aria-label="A week earlier" onClick={() => draft.shift(g.key, -1)} icon={<Icon name="chevron-left" size={16} />} />
            <TouchButton compact kind="ghost" aria-label="A week later" onClick={() => draft.shift(g.key, 1)} icon={<Icon name="chevron-right" size={16} />} />
            <TouchButton compact kind="ghost" onClick={() => draft.stretch(g.key, -1)}>
              Shorter
            </TouchButton>
            <TouchButton compact kind="ghost" onClick={() => draft.stretch(g.key, 1)}>
              Longer
            </TouchButton>
          </div>
          <div className="flex flex-wrap gap-2">
            <TouchButton kind="primary" onClick={() => draft.hold(g.key)}>
              Hold
            </TouchButton>
            <TouchButton onClick={() => draft.drop(g.key)}>Drop</TouchButton>
            {g.versions.length > 1 && <TouchButton onClick={() => draft.version(g.key)}>Another version</TouchButton>}
          </div>
        </div>
      )}
    </div>
  );
}
