/**
 * Memory — its own page (docs/memory.md, D-194; a page since 2026-11-13).
 *
 * It began as a dialog and was cramped on a real account: more was going to
 * live here, and a list in a box can't show what Nuvo has learned, only
 * itemise it. So it's a Flow surface (the Review's frame) with one hero, your
 * eight weeks drawn as a single week — the intelligence shown, not described —
 * and every section on one page: Noticed · What Nuvo uses · Still watching ·
 * You said no, with the trust controls at the foot.
 *
 * Every act still says what it changes before you press it.
 */

import { useEffect, useMemo, useState } from "react";
import { FlowFrame, FlowHead } from "../rituals/FlowShell";
import { Button, Switch } from "../kit";
import { atMin } from "../../lib/memory";
import type { MemoryItem } from "../../hooks/useMemory";
import { useMemory } from "../../hooks/useMemory";
import { isTypingIn } from "../../lib/a11y";

/** What the page needs from Memory — the live hook, or a harness's fixture. */
export type MemoryApi = Pick<
  ReturnType<typeof useMemory>,
  | "available"
  | "learning"
  | "items"
  | "keep"
  | "refuse"
  | "forget"
  | "askAgain"
  | "setLearning"
  | "markSeen"
  | "forgetAll"
  | "needsWorkDomain"
  | "domains"
  | "workDomainIds"
  | "setWorkDomain"
  | "heat"
  | "reading"
>;

export default function MemoryPage({ onClose, memory }: { onClose: () => void; memory?: MemoryApi }) {
  return memory ? <MemoryPageView memory={memory} onClose={onClose} /> : <LiveMemoryPage onClose={onClose} />;
}

function LiveMemoryPage({ onClose }: { onClose: () => void }) {
  return <MemoryPageView memory={useMemory()} onClose={onClose} />;
}

const SURE_WORD = { sure: "Sure", fairly: "Fairly sure", watch: "Not sure yet" } as const;

export function MemoryPageView({ memory, onClose }: { memory: MemoryApi; onClose: () => void }) {
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [wiping, setWiping] = useState(false);
  const by = useMemo(() => {
    const g: Record<MemoryItem["section"], MemoryItem[]> = { new: [], kept: [], watch: [], no: [] };
    memory.items.forEach((i) => g[i.section].push(i));
    return g;
  }, [memory.items]);

  // Opening Memory spends the sidebar's dot (§4.1) — once, on open.
  const { markSeen } = memory;
  useEffect(() => {
    markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape leaves — unless a field or an open confirm owns it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isTypingIn(e.target) || e.defaultPrevented) return;
      if (wiping || forgetting) {
        setWiping(false);
        setForgetting(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, wiping, forgetting]);

  const row = (item: MemoryItem) => (
    <MemoryRow
      key={item.key}
      item={item}
      canAnswer={memory.available}
      forgetting={forgetting === item.key}
      onKeep={() => void memory.keep(item)}
      onRefuse={() => memory.refuse(item)}
      onAskForget={() => setForgetting(item.key)}
      onCancelForget={() => setForgetting(null)}
      onForget={() => {
        setForgetting(null);
        void memory.forget(item);
      }}
      onAskAgain={() => memory.askAgain(item)}
    />
  );

  return (
    <FlowFrame
      label="Memory"
      onClose={onClose}
      right={
        <label className="memory-learn">
          <Switch checked={memory.learning} onChange={memory.setLearning} label="Keep learning" disabled={!memory.available} />
          <span>Keep learning</span>
        </label>
      }
    >
      <div className="f-scroll">
        <div className="f-page memory-page">
          <section className="memory-hero">
            <div className="memory-hero-words">
              <FlowHead
                kicker="Memory"
                hero="What Nuvo knows about your week"
                fact={
                  <>
                    Read from <b className="mono">{memory.reading.weeks}</b> weeks of your calendar,{" "}
                    <b className="mono">{memory.reading.events}</b> events, and the{" "}
                    <b className="mono">{memory.reading.written}</b> tasks you wrote.
                  </>
                }
              />
              <p className="memory-trust">
                Only you can see it, and it never leaves your account. Nothing here changes how Nuvo plans until you keep it.
              </p>
              <dl className="memory-tally">
                <div><dt>Noticed</dt><dd className="mono">{by.new.length}</dd></div>
                <div><dt>In use</dt><dd className="mono">{by.kept.length}</dd></div>
                <div><dt>Still watching</dt><dd className="mono">{by.watch.length}</dd></div>
              </dl>
            </div>
            <WeekPortrait heat={memory.heat} weeks={memory.reading.weeks} />
          </section>

          {!memory.available && (
            <p className="memory-note">Memory isn't switched on for this account yet, so nothing you answer can be saved.</p>
          )}
          {!memory.learning && <p className="memory-note">Learning is paused. Nuvo still uses what you kept, but looks for nothing new.</p>}

          {memory.domains.some((d) => d.kindStored) && (
            <section className="memory-section">
              <h2 className="section-label">What counts as work</h2>
              <p className="memory-src">
                {memory.workDomainIds.length
                  ? "Nuvo reads your working hours from these domains only. Tap one to change it."
                  : "Nuvo reads your working hours only from domains you mark as paid work. Until you pick, it doesn't guess them."}
              </p>
              <div className="memory-domains" role="group" aria-label="Domains that are paid work">
                {memory.domains
                  .filter((d) => d.kindStored)
                  .map((d) => {
                    const on = memory.workDomainIds.includes(d.id);
                    return (
                      <Button key={d.id} size="sm" kind={on ? "primary" : "secondary"} aria-pressed={on} onClick={() => memory.setWorkDomain(d.id, !on)}>
                        {d.name}
                      </Button>
                    );
                  })}
              </div>
            </section>
          )}

          <section className="memory-section">
            <h2 className="section-label">
              Noticed <span className="memory-count mono">{by.new.length || ""}</span>
            </h2>
            <p className="memory-src">Sure enough to ask you. Nothing changes until you answer.</p>
            {by.new.length ? by.new.map(row) : <p className="memory-empty">Nothing new. Nuvo only asks when a pattern has held for weeks.</p>}
          </section>

          <div className="memory-cols">
            <section className="memory-section">
              <h2 className="section-label">
                What Nuvo uses <span className="memory-count mono">{by.kept.length || ""}</span>
              </h2>
              <p className="memory-src">What it plans with now, and where each one is used.</p>
              {by.kept.length ? by.kept.map(row) : <p className="memory-empty">Nothing kept yet.</p>}
            </section>
            <section className="memory-section">
              <h2 className="section-label">
                Still watching <span className="memory-count mono">{by.watch.length || ""}</span>
              </h2>
              <p className="memory-src">Not sure yet. These are never shown anywhere but here.</p>
              {by.watch.length ? by.watch.map(row) : <p className="memory-empty">Nothing being watched.</p>}
            </section>
          </div>

          {by.no.length > 0 && (
            <section className="memory-section">
              <h2 className="section-label">
                You said no <span className="memory-count mono">{by.no.length}</span>
              </h2>
              <p className="memory-src">Kept so they don't come back.</p>
              {by.no.map(row)}
            </section>
          )}

          <footer className="memory-foot">
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
          </footer>
        </div>
      </div>
    </FlowFrame>
  );
}

const PORTRAIT_FROM = 5;
const PORTRAIT_TO = 23;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Eight weeks drawn as one week: a cell per weekday-hour, darker where
 *  something of yours was there in more of the weeks. */
function WeekPortrait({ heat, weeks }: { heat: number[][]; weeks: number }) {
  const hours = Array.from({ length: PORTRAIT_TO - PORTRAIT_FROM }, (_, i) => PORTRAIT_FROM + i);
  return (
    <figure className="memory-portrait" aria-label={`Your last ${weeks} weeks, drawn as one week`}>
      <div className="memory-portrait-grid">
        <span />
        {DAYS.map((d) => (
          <span key={d} className="memory-portrait-day">{d}</span>
        ))}
        {hours.map((h) => (
          <PortraitRow key={h} hour={h} heat={heat} weeks={weeks} />
        ))}
      </div>
      <figcaption>
        Eight weeks as one week. Darker means more of the weeks.
      </figcaption>
    </figure>
  );
}

function PortraitRow({ hour, heat, weeks }: { hour: number; heat: number[][]; weeks: number }) {
  return (
    <>
      <span className="memory-portrait-hour mono">{hour % 3 === 0 ? atMin(hour * 60) : ""}</span>
      {DAYS.map((_, d) => {
        const n = heat[d]?.[hour] ?? 0;
        return (
          <span
            key={d}
            className="memory-portrait-cell"
            data-on={n ? "" : undefined}
            style={n ? { ["--v" as string]: String(0.14 + (n / weeks) * 0.76) } : undefined}
            title={`${DAYS[d]} ${atMin(hour * 60)}: ${n} of ${weeks} weeks`}
          />
        );
      })}
    </>
  );
}

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
    <article className="memory-item" data-section={item.section}>
      <p className="memory-say">{d.statement}</p>
      <div className="memory-meta">
        {o && (
          <span className="memory-pips" aria-label={`${o.hits} of ${o.of}`}>
            {o.pips.map((p, i) => <i key={i} data-on={p ? "" : undefined} />)}
          </span>
        )}
        <span>{d.evidence}</span>
        {(item.section === "new" || item.section === "watch") && (
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
    </article>
  );
}
