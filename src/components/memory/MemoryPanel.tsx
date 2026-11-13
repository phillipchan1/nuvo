/**
 * Memory (docs/memory.md §4.3) — what Nuvo has learned about you, how sure it
 * is, and what each answer changes. The kit Dialog, so the phone gets the
 * bottom Sheet for free (golden rule 3).
 *
 * Four tabs: Noticed (sure enough to ask) · What Nuvo uses (kept) · Still
 * watching (never shown anywhere else) · You said no. Every act says what it
 * will change BEFORE you press it — that line is the point of the surface.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, EmptyState, Switch, Tabs } from "../kit";
import type { Section } from "../../lib/memory";
import type { MemoryItem } from "../../hooks/useMemory";
import { useMemory } from "../../hooks/useMemory";

const TABS: { value: Section; label: string }[] = [
  { value: "new", label: "Noticed" },
  { value: "kept", label: "What Nuvo uses" },
  { value: "watch", label: "Still watching" },
  { value: "no", label: "You said no" },
];

const INTRO: Record<Section, string> = {
  new: "Sure enough to ask you. Nothing changes until you answer.",
  kept: "What Nuvo plans with now, and where each one is used.",
  watch: "Patterns Nuvo isn't sure of yet. They're never shown anywhere but here.",
  no: "Things you said weren't true, kept so they don't come back.",
};

const EMPTY: Record<Section, string> = {
  new: "Nothing new. Nuvo only asks when a pattern has held for weeks.",
  kept: "Nothing kept yet.",
  watch: "Nothing being watched.",
  no: "You haven't said no to anything.",
};

/** What the panel needs from Memory — the live hook, or a harness's fixture. */
export type MemoryApi = Pick<
  ReturnType<typeof useMemory>,
  "available" | "learning" | "items" | "keep" | "refuse" | "forget" | "askAgain" | "setLearning" | "markSeen" | "forgetAll" | "needsWorkDomain" | "domains" | "setWorkDomain"
>;

export default function MemoryPanel({ onClose }: { onClose: () => void }) {
  return <MemoryPanelView memory={useMemory()} onClose={onClose} />;
}

export function MemoryPanelView({ memory, onClose }: { memory: MemoryApi; onClose: () => void }) {
  const counts = useMemo(() => {
    const c: Record<Section, number> = { new: 0, kept: 0, watch: 0, no: 0 };
    memory.items.forEach((i) => c[i.section]++);
    return c;
  }, [memory.items]);
  const [tab, setTab] = useState<Section>(() => (counts.new ? "new" : "kept"));
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [wiping, setWiping] = useState(false);

  // Opening Memory spends the dot (§4.1) — once, on open.
  const { markSeen } = memory;
  useEffect(() => {
    markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = memory.items.filter((i) => i.section === tab);

  return (
    <Dialog
      title="Memory"
      onClose={onClose}
      width={600}
      footer={
        <div className="memory-foot">
          <label className="memory-learn">
            <Switch checked={memory.learning} onChange={memory.setLearning} label="Keep learning" disabled={!memory.available} />
            <span>Keep learning</span>
          </label>
          {wiping ? (
            <div className="memory-confirm" role="group" aria-label="Forget everything">
              <span>Forget everything? What you kept stays in your settings; Nuvo forgets why, and starts learning from zero.</span>
              <Button size="sm" kind="danger" onClick={() => { memory.forgetAll(); setWiping(false); }}>Forget everything</Button>
              <Button size="sm" kind="ghost" onClick={() => setWiping(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" kind="ghost" onClick={() => setWiping(true)} disabled={!memory.available}>
              Forget everything…
            </Button>
          )}
        </div>
      }
    >
      <div className="memory">
        <p className="memory-lead">
          What Nuvo has learned from your calendar and your work. Only you can see it, and it never leaves your account.
        </p>
        {!memory.available && (
          <p className="memory-note">Memory isn't switched on for this account yet, so nothing you answer can be saved. What Nuvo sees is below.</p>
        )}
        {!memory.learning && <p className="memory-note">Learning is paused. Nuvo still uses what you kept, but looks for nothing new.</p>}
        {memory.needsWorkDomain && (
          <div className="memory-note">
            <span>Which domain is your paid work? Nuvo reads your working hours from it.</span>
            <div className="memory-acts">
              {memory.domains.filter((d) => d.kindStored).map((d) => (
                <Button key={d.id} size="xs" onClick={() => memory.setWorkDomain(d.id)}>{d.name}</Button>
              ))}
            </div>
          </div>
        )}

        <Tabs
          label="Memory"
          value={tab}
          onChange={(v) => { setTab(v); setForgetting(null); }}
          tabs={TABS.map((t) => ({ ...t, count: counts[t.value] || undefined }))}
        />
        <p className="memory-intro">{INTRO[tab]}</p>

        {list.length === 0 ? (
          <EmptyState>{EMPTY[tab]}</EmptyState>
        ) : (
          <section>
            {/* Grouped by area (§4.3) once there's more than one; Time is the only chapter built. */}
            {list.map((item) => (
              <MemoryRow
                key={item.key}
                item={item}
                canAnswer={memory.available}
                forgetting={forgetting === item.key}
                onKeep={() => void memory.keep(item)}
                onRefuse={() => memory.refuse(item)}
                onAskForget={() => setForgetting(item.key)}
                onCancelForget={() => setForgetting(null)}
                onForget={() => { setForgetting(null); void memory.forget(item); }}
                onAskAgain={() => memory.askAgain(item)}
              />
            ))}
          </section>
        )}
      </div>
    </Dialog>
  );
}

const SURE_WORD = { sure: "Sure", fairly: "Fairly sure", watch: "Not sure yet" } as const;

function MemoryRow({
  item,
  canAnswer,
  forgetting,
  onKeep,
  onRefuse,
  onAskForget,
  onCancelForget,
  onForget,
  onAskAgain,
}: {
  item: MemoryItem;
  canAnswer: boolean;
  forgetting: boolean;
  onKeep: () => void;
  onRefuse: () => void;
  onAskForget: () => void;
  onCancelForget: () => void;
  onForget: () => void;
  onAskAgain: () => void;
}) {
  const d = item.described;
  const o = item.observation;
  return (
    <div className="memory-item">
      <p className="memory-say">{d.statement}</p>
      <div className="memory-meta">
        {o && (
          <span className="memory-pips" aria-label={`${o.hits} of ${o.of}`}>
            {o.pips.map((p, i) => <i key={i} data-on={p ? "" : undefined} />)}
          </span>
        )}
        <span>{d.evidence}</span>
        {item.section !== "kept" && item.section !== "no" && (
          <span className="memory-sure" data-level={d.confidence}>{SURE_WORD[d.confidence]}</span>
        )}
        <span className="memory-src">{d.source}</span>
      </div>
      {d.uses.length > 0 && (item.section === "new" || item.section === "kept") && (
        <div className="memory-uses" aria-label="Used by">{d.uses.map((u) => <span key={u}>{u}</span>)}</div>
      )}

      {item.section === "new" && (
        <>
          <p className="memory-conseq"><b>Keep:</b> {d.keep}</p>
          <p className="memory-conseq"><b>Not true:</b> {d.no}</p>
          <div className="memory-acts">
            <Button size="sm" kind="primary" onClick={onKeep} disabled={!canAnswer}>Keep</Button>
            <Button size="sm" kind="ghost" onClick={onRefuse} disabled={!canAnswer}>Not true</Button>
          </div>
        </>
      )}
      {item.section === "watch" && (
        <>
          <p className="memory-src">{d.need}</p>
          <div className="memory-acts">
            <Button size="sm" kind="ghost" onClick={onRefuse} disabled={!canAnswer}>Not true</Button>
          </div>
        </>
      )}
      {item.section === "kept" &&
        (forgetting ? (
          <>
            <p className="memory-conseq"><b>Forget:</b> {d.forget}</p>
            <div className="memory-acts">
              <Button size="sm" kind="danger" onClick={onForget}>Forget it</Button>
              <Button size="sm" kind="ghost" onClick={onCancelForget}>Keep it</Button>
            </div>
          </>
        ) : (
          <div className="memory-acts">
            <Button size="sm" kind="ghost" onClick={onAskForget}>Forget…</Button>
          </div>
        ))}
      {item.section === "no" && (
        <div className="memory-acts">
          <Button size="sm" kind="ghost" onClick={onAskAgain}>Ask me again</Button>
        </div>
      )}
    </div>
  );
}
