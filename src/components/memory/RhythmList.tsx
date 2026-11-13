/**
 * The Schedule's Rhythm popover (docs/memory.md §5.2): the few things Memory
 * noticed about your time that are drawn on this week, answered beside it.
 * Short on purpose — three at most, so it never scrolls. Everything else, and
 * everything kept, lives on the Memory page. Pointing at a row lights its band.
 */

import type { MemoryApi } from "./MemoryPage";
import { Button } from "../kit";

const SHOWN = 3;

export function RhythmList({
  memory,
  onHot,
  onOpenMemory,
}: {
  memory: MemoryApi;
  onHot: (key: string | null) => void;
  onOpenMemory?: () => void;
}) {
  const all = memory.items.filter((i) => i.section === "new" && i.observation);
  const items = all.slice(0, SHOWN);
  return (
    <div className="rhythm-list" onPointerLeave={() => onHot(null)}>
      {!memory.available && <p className="memory-src">Memory isn't switched on for this account yet.</p>}
      {items.length === 0 ? (
        <p className="memory-src">{memory.learning ? "Nothing new about your time." : "Learning is paused."}</p>
      ) : (
        items.map((it) => (
          <div key={it.key} className="memory-item" onPointerEnter={() => onHot(it.key)} onFocus={() => onHot(it.key)}>
            <p className="memory-say">{it.described.statement}</p>
            <div className="memory-meta">
              <span className="memory-pips" aria-label={it.described.evidence}>
                {it.observation!.pips.map((p, i) => <i key={i} data-on={p ? "" : undefined} />)}
              </span>
              <span>{it.described.evidence}</span>
            </div>
            <div className="memory-acts">
              <Button size="sm" kind="primary" disabled={!memory.available} onClick={() => void memory.keep(it)} title={it.described.keep}>
                Keep
              </Button>
              <Button size="sm" kind="ghost" disabled={!memory.available} onClick={() => memory.refuse(it)}>
                Not true
              </Button>
            </div>
          </div>
        ))
      )}
      {onOpenMemory && (
        <div className="rhythm-list-foot">
          <Button size="sm" kind="ghost" onClick={onOpenMemory}>
            {all.length > SHOWN ? `See all ${all.length} in Memory` : "Open Memory"}
          </Button>
        </div>
      )}
    </div>
  );
}
