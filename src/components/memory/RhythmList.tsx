/**
 * The Schedule's Rhythm popover (docs/memory.md §5.2): what Memory noticed about
 * your time, answered beside the week it's drawn on. Pointing at a row lights
 * its band on the grid. Sure and Fairly sure only — nothing unsure is drawn.
 */

import type { MemoryApi } from "./MemoryPanel";
import { Button } from "../kit";

export function RhythmList({ memory, onHot }: { memory: MemoryApi; onHot: (key: string | null) => void }) {
  const items = memory.items.filter((i) => i.section === "new" && i.observation);
  const kept = memory.items.filter((i) => i.section === "kept").length;
  return (
    <div className="rhythm-list" onPointerLeave={() => onHot(null)}>
      <p className="section-label">Rhythm</p>
      {!memory.available && <p className="memory-src">Memory isn't switched on for this account yet.</p>}
      {items.length === 0 ? (
        <p className="memory-src">
          {memory.learning ? "Nothing new about your time." : "Learning is paused."}
          {kept ? ` ${kept} kept — see Memory.` : ""}
        </p>
      ) : (
        items.map((it) => (
          <div
            key={it.key}
            className="memory-item"
            onPointerEnter={() => onHot(it.key)}
            onFocus={() => onHot(it.key)}
          >
            <p className="memory-say">{it.described.statement}</p>
            <div className="memory-meta">
              <span className="memory-pips" aria-label={it.described.evidence}>
                {it.observation!.pips.map((p, i) => <i key={i} data-on={p ? "" : undefined} />)}
              </span>
              <span>{it.described.evidence}</span>
            </div>
            <p className="memory-conseq"><b>Keep:</b> {it.described.keep}</p>
            <div className="memory-acts">
              <Button size="sm" kind="primary" disabled={!memory.available} onClick={() => void memory.keep(it)}>Keep</Button>
              <Button size="sm" kind="ghost" disabled={!memory.available} onClick={() => memory.refuse(it)}>Not true</Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
