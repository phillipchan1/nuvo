/**
 * First run for Memory (docs/memory.md §5.3): "Your week, as your calendar tells
 * it." Shown ONCE, the first time Memory has something sure to say about your
 * time — on a new account, that's right after a calendar connects (sync reads
 * the last 56 days). Every sure observation, a per-item Not true, one Use these.
 * With nothing sure to say it never appears; it never fills the space with a guess.
 */

import { useEffect, useState } from "react";
import { useMemory } from "../../hooks/useMemory";
import { Button, Dialog } from "../kit";

export default function RhythmIntro() {
  const memory = useMemory();
  const sure = memory.items.filter((i) => i.section === "new" && i.observation && i.described.confidence === "sure");
  const due = memory.available && memory.learning && !memory.introduced && sure.length >= 2;
  const [open, setOpen] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (due && !open) {
      setOpen(true);
      memory.markIntroduced();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due]);

  if (!open) return null;
  const take = sure.filter((i) => !off.has(i.key));
  return (
    <Dialog
      title="Your week, as your calendar tells it"
      onClose={() => setOpen(false)}
      width={560}
      footer={
        <>
          <Button kind="ghost" onClick={() => setOpen(false)}>Not now</Button>
          <Button
            kind="primary"
            disabled={!take.length}
            onClick={() => {
              setOpen(false);
              void memory.keepMany(take);
              sure.filter((i) => off.has(i.key)).forEach((i) => memory.refuse(i, { quiet: true }));
            }}
          >
            Use {take.length === sure.length ? "these" : `these ${take.length}`}
          </Button>
        </>
      }
    >
      <div className="memory">
        <p className="memory-lead">
          From the last eight weeks of your calendar. Keep what's true and Nuvo plans around it from today. You can change any of it later in Memory.
        </p>
        {sure.map((it) => (
          <div key={it.key} className="memory-item" data-off={off.has(it.key) ? "" : undefined}>
            <p className="memory-say">{it.described.statement}</p>
            <div className="memory-meta">
              <span className="memory-pips" aria-label={it.described.evidence}>
                {it.observation!.pips.map((p, i) => <i key={i} data-on={p ? "" : undefined} />)}
              </span>
              <span>{it.described.evidence}</span>
            </div>
            <p className="memory-conseq">{it.described.keep}</p>
            <div className="memory-acts">
              <Button
                size="sm"
                kind="ghost"
                aria-pressed={off.has(it.key)}
                onClick={() =>
                  setOff((s) => {
                    const n = new Set(s);
                    if (n.has(it.key)) n.delete(it.key);
                    else n.add(it.key);
                    return n;
                  })
                }
              >
                {off.has(it.key) ? "Undo" : "Not true"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
