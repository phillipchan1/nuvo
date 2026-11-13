/**
 * What Memory noticed, inside a ritual you opened (docs/memory.md §4.5) — the
 * phone's Plan the week. Only Sure observations, three at most, each with the
 * consequence of Keep said before the press. The desktop rail shows the same
 * items as rows in its own To-settle stack.
 */

import { useMemory } from "../../hooks/useMemory";
import { Button } from "../kit";

const RANK = { hours: 0, window: 1, habit: 2, repeat: 3 } as const;

export default function MemoryNoticed() {
  const memory = useMemory();
  const items = memory.items
    .filter((i) => i.section === "new" && i.observation && i.described.confidence === "sure")
    .sort((a, b) => RANK[a.observation!.kind] - RANK[b.observation!.kind])
    .slice(0, 3);
  if (!memory.available || !items.length) return null;
  return (
    <section className="memory-noticed" aria-label="What Nuvo noticed">
      <p className="section-label">What Nuvo noticed</p>
      {items.map((it) => (
        <div key={it.key} className="memory-item">
          <p className="memory-say">{it.described.statement}</p>
          <div className="memory-meta">
            <span className="memory-pips" aria-label={it.described.evidence}>
              {it.observation!.pips.map((p, i) => <i key={i} data-on={p ? "" : undefined} />)}
            </span>
            <span>{it.described.evidence}</span>
          </div>
          <p className="memory-conseq"><b>Keep:</b> {it.described.keep}</p>
          <div className="memory-acts">
            <Button size="sm" kind="primary" onClick={() => void memory.keep(it)}>Keep</Button>
            <Button size="sm" kind="ghost" onClick={() => memory.refuse(it)}>Not true</Button>
          </div>
        </div>
      ))}
    </section>
  );
}
