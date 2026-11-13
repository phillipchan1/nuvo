/**
 * Memory — its own page (docs/memory.md §13, D-197).
 *
 * Reworked the same day it was prototyped, on the operator's read of the long
 * version: "actions I need to take, confirmation that it's learning me, less
 * reading". So the page has two faces in the frame's tabs:
 *
 *   Now          what Nuvo knows, as pills you glance at (the portrait) · what
 *                to answer, two a week at most · whether it's getting better,
 *                as three counts graded against what you did · your week as
 *                Nuvo would draw it.
 *   Everything   every memory in full, what counts as work, what you told Nuvo,
 *                the eight-week evidence, and the trust controls.
 *
 * The full sentence behind any pill is one tap away (a Popover on desktop, the
 * bottom Sheet on a phone). Every act still says what it changes before you
 * press it.
 */

import { useEffect, useMemo, useState } from "react";
import { FlowFrame } from "../rituals/FlowShell";
import { Button, Popover, Switch, Tabs } from "../kit";
import Sheet from "../mobile/Sheet";
import { atMin } from "../../lib/memory";
import { hoursSaid } from "../../lib/memoryGrade";
import type { MemoryItem, PortraitClause } from "../../hooks/useMemory";
import { useMemory } from "../../hooks/useMemory";
import { useIsMobile } from "../../hooks/useIsMobile";
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
  | "portrait"
  | "week"
  | "proof"
  | "questions"
  | "waiting"
  | "recent"
>;

export default function MemoryPage({ onClose, memory }: { onClose: () => void; memory?: MemoryApi }) {
  return memory ? <MemoryPageView memory={memory} onClose={onClose} /> : <LiveMemoryPage onClose={onClose} />;
}

function LiveMemoryPage({ onClose }: { onClose: () => void }) {
  return <MemoryPageView memory={useMemory()} onClose={onClose} />;
}

type Face = "now" | "all";
const SURE_WORD = { sure: "Sure", fairly: "Fairly sure", watch: "Not sure yet" } as const;

export function MemoryPageView({ memory, onClose, initialFace = "now" }: { memory: MemoryApi; onClose: () => void; initialFace?: Face }) {
  const [face, setFace] = useState<Face>(initialFace);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [wiping, setWiping] = useState(false);
  const [open, setOpen] = useState<{ clause: PortraitClause; anchor: HTMLElement } | null>(null);
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

  // Escape leaves — unless a field, an open detail or a confirm owns it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isTypingIn(e.target) || e.defaultPrevented) return;
      if (open) return setOpen(null);
      if (wiping || forgetting) {
        setWiping(false);
        setForgetting(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, wiping, forgetting, open]);

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

  const known = memory.portrait.filter((c) => c.state === "kept").length;

  return (
    <FlowFrame
      label="Memory"
      onClose={onClose}
      center={
        <Tabs
          label="Memory"
          value={face}
          onChange={setFace}
          tabs={[
            { value: "now", label: "Now", count: memory.questions.length || undefined },
            { value: "all", label: "Everything" },
          ]}
        />
      }
      right={
        <label className="memory-learn">
          <Switch checked={memory.learning} onChange={memory.setLearning} label="Keep learning" disabled={!memory.available} />
          <span>Keep learning</span>
        </label>
      }
    >
      <div className="f-scroll">
        <div className="f-page memory-page">
          {!memory.available && <p className="memory-note">Memory isn't switched on for this account yet, so nothing you answer can be saved.</p>}
          {!memory.learning && <p className="memory-note">Learning is paused. Nuvo uses what you kept and looks for nothing new.</p>}

          {face === "now" ? (
            <>
              <div className="mem-now">
                <h1 className="text-display masthead mem-hero">
                  {known ? `Nuvo knows ${known} thing${known === 1 ? "" : "s"} about your week` : "Nuvo is getting to know your week"}
                </h1>
                <div className="mem-know">
                  {memory.portrait.length > 0 ? (
                    <ul className="mem-pills" aria-label="What Nuvo knows">
                      {memory.portrait.map((c) => (
                        <li key={c.key}>
                          <button
                            type="button"
                            className="mem-pill"
                            data-state={c.state}
                            aria-expanded={open?.clause.key === c.key}
                            title={c.text}
                            onClick={(e) => setOpen(open?.clause.key === c.key ? null : { clause: c, anchor: e.currentTarget })}
                          >
                            {c.chip}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="memory-empty">Nothing yet. It reads your calendar as the weeks go by.</p>
                  )}
                  <p className="mem-key" aria-hidden>
                    <span data-state="kept">Kept</span>
                    <span data-state="asking">Asking</span>
                    <span data-state="watch">Watching</span>
                  </p>
                </div>
                <Learning memory={memory} />
                <Questions
                  memory={memory}
                  onWhy={(item, anchor) => {
                    const c = memory.portrait.find((p) => p.key === item.key);
                    if (c) setOpen({ clause: c, anchor });
                  }}
                />
                <PredictedWeek memory={memory} />
              </div>
              <p className="mem-trust">Only you can see this. It never leaves your account.</p>
            </>
          ) : (
            <>
              {memory.domains.some((d) => d.kindStored) && (
                <section className="memory-section">
                  <h2 className="section-label">What counts as work</h2>
                  <p className="memory-src">
                    {memory.workDomainIds.length ? "Nuvo reads your working hours from these only." : "Pick your paid work. Until then, Nuvo doesn't guess your hours."}
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

              <div className="memory-cols">
                <section className="memory-section">
                  <h2 className="section-label">
                    What Nuvo uses <span className="memory-count mono">{by.kept.length || ""}</span>
                  </h2>
                  {by.kept.length ? by.kept.map(row) : <p className="memory-empty">Nothing kept yet.</p>}
                </section>
                <section className="memory-section">
                  <h2 className="section-label">
                    Still watching <span className="memory-count mono">{by.watch.length || ""}</span>
                  </h2>
                  {by.watch.length ? by.watch.map(row) : <p className="memory-empty">Nothing being watched.</p>}
                </section>
              </div>

              {by.new.length > memory.questions.length && (
                <section className="memory-section">
                  <h2 className="section-label">
                    Waiting to ask <span className="memory-count mono">{by.new.length - memory.questions.length}</span>
                  </h2>
                  {by.new.filter((i) => !memory.questions.includes(i)).map(row)}
                </section>
              )}

              <section className="memory-section">
                <h2 className="section-label">You told Nuvo</h2>
                {memory.domains.filter((d) => d.charter || d.intention).length ? (
                  memory.domains
                    .filter((d) => d.charter || d.intention)
                    .map((d) => (
                      <article key={d.id} className="memory-item">
                        <p className="memory-say">
                          {d.name}
                          {d.kind ? <span className="mem-kind"> · {d.kind === "work" ? "paid work" : d.kind}</span> : null}
                        </p>
                        {d.charter && <p className="memory-src mem-quote">“{d.charter}”</p>}
                        {d.intention && <p className="memory-src">Asks of you: {d.intention}</p>}
                      </article>
                    ))
                ) : (
                  <p className="memory-empty">Nothing written on your domains yet.</p>
                )}
                <p className="memory-src">Change these on the domain, where you wrote them.</p>
              </section>

              {by.no.length > 0 && (
                <section className="memory-section">
                  <h2 className="section-label">
                    You said no <span className="memory-count mono">{by.no.length}</span>
                  </h2>
                  {by.no.map(row)}
                </section>
              )}

              <section className="memory-section">
                <h2 className="section-label">What it reads</h2>
                <WeekPortrait heat={memory.heat} weeks={memory.reading.weeks} />
                <p className="memory-src">
                  {memory.reading.weeks} weeks of your calendar, {memory.reading.events} events, {memory.reading.written} tasks you wrote. Only you can see
                  it, and it never leaves your account.
                </p>
              </section>

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
            </>
          )}
        </div>
      </div>
      {open && <ClauseDetail memory={memory} clause={open.clause} anchor={open.anchor} onClose={() => setOpen(null)} onEverything={() => { setOpen(null); setFace("all"); }} />}
    </FlowFrame>
  );
}

// ── Now: is it learning? ──────────────────────────────────────────────────────

/** Three counts graded against what you did (§13.4). They grade Nuvo, never you:
 *  counts in the evidence voice, never a percentage (N-04). Exported so another
 *  surface (a sidebar of Nuvo's) can carry the same proof. */
export function Learning({ memory }: { memory: Pick<MemoryApi, "proof" | "recent"> }) {
  const { keptAsDrafted: kad, drawn } = memory.proof;
  return (
    <aside className="mem-learning" aria-label="Is Nuvo learning">
      <div className="mem-tiles">
        <div className="mem-tile" data-gated={kad.gated ? "" : undefined}>
          <span className="mem-tile-n mono">{kad.gated ? `${kad.soFar}/${kad.need}` : `${kad.kept} of ${kad.of}`}</span>
          <span className="mem-tile-l">{kad.gated ? "drafts graded so far" : "drafts kept as written"}</span>
          {!kad.gated && kad.before && <span className="mem-tile-was mono">was {kad.before.kept} of {kad.before.of}</span>}
        </div>
        <div className="mem-tile" data-gated={drawn.gated ? "" : undefined}>
          <span className="mem-tile-n mono">{drawn.gated ? "—" : `${hoursSaid(drawn.hit)} of ${hoursSaid(drawn.total)}h`}</span>
          <span className="mem-tile-l">
            {drawn.gated
              ? drawn.why === "weeks"
                ? "needs four weeks"
                : drawn.why === "kept"
                  ? "needs one thing kept"
                  : "last week was empty"
              : "of last week, drawn ahead"}
          </span>
        </div>
        <div className="mem-tile" data-gated="">
          <span className="mem-tile-n mono">—</span>
          <span className="mem-tile-l">corrections you no longer make</span>
        </div>
      </div>
      <div className="mem-recent">
        <p className="section-label">Learned lately</p>
        {memory.recent.length ? (
          <ul>
            {memory.recent.map((r) => (
              <li key={r.key}>
                <span>{r.text}</span>
                <span className="mono">{new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="memory-empty">Nothing kept yet.</p>
        )}
      </div>
    </aside>
  );
}

// ── Now: what to answer ───────────────────────────────────────────────────────

/** This week's questions — two a week at most (§13.2). Exported for the same reason as `Learning`. */
export function Questions({
  memory,
  onWhy,
}: {
  memory: Pick<MemoryApi, "questions" | "waiting" | "keep" | "refuse" | "available" | "learning">;
  onWhy?: (item: MemoryItem, anchor: HTMLElement) => void;
}) {
  return (
    <section className="mem-ask" aria-label="To answer">
      <h2 className="section-label">
        To answer
        {memory.waiting > 0 && <span className="memory-count"> · {memory.waiting} more next week</span>}
      </h2>
      {memory.questions.length ? (
        <div className="mem-asks">
          {memory.questions.map((it) => (
            <article key={it.key} className="mem-q">
              <p className="mem-q-say">{it.described.statement}</p>
              <p className="mem-q-keep">
                {it.observation && (
                  <span className="memory-pips" aria-label={it.described.evidence}>
                    {it.observation.pips.map((p, i) => <i key={i} data-on={p ? "" : undefined} />)}
                  </span>
                )}
                <span>Keep: {it.described.keep}</span>
              </p>
              <div className="memory-acts">
                <Button size="sm" kind="primary" onClick={() => void memory.keep(it)} disabled={!memory.available}>Keep</Button>
                <Button size="sm" kind="secondary" onClick={() => memory.refuse(it)} disabled={!memory.available}>Not true</Button>
                {onWhy && <Button size="sm" kind="ghost" onClick={(e) => onWhy(it, e.currentTarget)}>Why</Button>}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="memory-empty">{memory.learning ? "Nothing to answer this week." : "Learning is paused."}</p>
      )}
    </section>
  );
}

// ── Now: the week Nuvo would draw ─────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const W_FROM = 6;
const W_TO = 22;

function PredictedWeek({ memory }: { memory: Pick<MemoryApi, "week" | "proof" | "domains"> }) {
  const [compare, setCompare] = useState(true);
  const lived = memory.proof.lastWeekDrawn;
  const hue = (id: string | null) => memory.domains.find((d) => d.id === id)?.color ?? null;
  const W = 720;
  const H = 300;
  const L = 44;
  const T = 24;
  const B = 8;
  const cw = (W - L - 4) / 7;
  const ph = (H - T - B) / (W_TO - W_FROM);
  const y = (min: number) => T + (Math.min(Math.max(min / 60, W_FROM), W_TO) - W_FROM) * ph;
  const x = (d: number) => L + d * cw;
  if (!memory.week.length && !lived.length) return null;
  return (
    <section className="mem-week" aria-label="Your week, as Nuvo would draw it">
      <div className="mem-week-h">
        <h2 className="section-label">Your week, as Nuvo would draw it</h2>
        {lived.length > 0 && (
          <label className="memory-learn">
            <Switch checked={compare} onChange={setCompare} label="Show last week" />
            <span>Last week</span>
          </label>
        )}
      </div>
      <div className="mem-week-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Kept blocks solid, asking dashed, watching dotted">
          <defs>
            <pattern id="mem-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="5" className="mem-hatch-line" />
            </pattern>
          </defs>
          {DAYS.map((d, i) => (
            <text key={d} x={x(i) + cw / 2} y={14} textAnchor="middle" className="mem-w-day">{d}</text>
          ))}
          {[8, 12, 16, 20].map((h) => (
            <g key={h}>
              <line x1={L} x2={W - 4} y1={y(h * 60)} y2={y(h * 60)} className="mem-w-rule" />
              <text x={L - 8} y={y(h * 60) + 4} textAnchor="end" className="mem-w-hour">{atMin(h * 60)}</text>
            </g>
          ))}
          {memory.week.map((b, i) => {
            const top = y(b.startMin) + 1;
            const h = Math.max(4, y(b.endMin) - y(b.startMin) - 2);
            const col = b.open ? "var(--slot)" : hue(b.domainId) ?? "var(--ink-2)";
            return (
              <g key={`${b.key}-${i}`} className="mem-w-block" data-state={b.state} style={{ ["--c" as string]: col }}>
                <rect x={x(b.weekday) + 3} y={top} width={cw - 6} height={h} rx={4} />
                {b.label && h > 15 && (
                  <text x={x(b.weekday) + 9} y={top + 13} className="mem-w-label">{b.label}</text>
                )}
              </g>
            );
          })}
          {compare &&
            lived.map((b, i) => {
              const top = y(b.startMin) + 1;
              const h = Math.max(4, y(b.endMin) - y(b.startMin) - 2);
              return <rect key={i} x={x(b.weekday) + cw - 12} y={top} width={6} height={h} rx={2} className="mem-w-lived" data-ahead={b.ahead ? "" : undefined} />;
            })}
        </svg>
      </div>
      <p className="mem-week-key">
        <span data-k="kept">Kept</span>
        <span data-k="asking">Asking</span>
        <span data-k="watch">Watching</span>
        {compare && lived.length > 0 && (
          <>
            <span data-k="ahead">Last week, drawn ahead</span>
            <span data-k="missed">Last week, missed</span>
          </>
        )}
      </p>
    </section>
  );
}

// ── the detail behind a pill ──────────────────────────────────────────────────

function ClauseDetail({
  memory,
  clause,
  anchor,
  onClose,
  onEverything,
}: {
  memory: MemoryApi;
  clause: PortraitClause;
  anchor: HTMLElement;
  onClose: () => void;
  onEverything: () => void;
}) {
  const mobile = useIsMobile();
  const [forgetting, setForgetting] = useState(false);
  const it = clause.item;
  const d = it?.described;
  const o = it?.observation;
  const body = (
    <div className="mem-detail" data-sheet={mobile ? "" : undefined}>
      {!mobile && <p className="mem-detail-h">{clause.text}</p>}
      {it && d ? (
        <>
          <p className="memory-meta">
            {o && (
              <span className="memory-pips" aria-label={`${o.hits} of ${o.of}`}>
                {o.pips.map((p, i) => <i key={i} data-on={p ? "" : undefined} />)}
              </span>
            )}
            <span>{d.evidence}</span>
            {it.section !== "kept" && <span className="memory-sure" data-level={d.confidence}>{SURE_WORD[d.confidence]}</span>}
          </p>
          <p className="memory-src">{d.source}</p>
          {d.uses.length > 0 && <div className="memory-uses" aria-label="Used by">{d.uses.map((u) => <span key={u}>{u}</span>)}</div>}
          {it.section === "new" && (
            <>
              <p className="memory-conseq"><b>Keep:</b> {d.keep}</p>
              <p className="memory-conseq"><b>Not true:</b> {d.no}</p>
              <div className="memory-acts">
                <Button size="sm" kind="primary" disabled={!memory.available} onClick={() => { void memory.keep(it); onClose(); }}>Keep</Button>
                <Button size="sm" kind="secondary" disabled={!memory.available} onClick={() => { memory.refuse(it); onClose(); }}>Not true</Button>
              </div>
            </>
          )}
          {it.section === "watch" && (
            <>
              {d.need && <p className="memory-src">{d.need}</p>}
              <div className="memory-acts">
                <Button size="sm" kind="secondary" disabled={!memory.available} onClick={() => { memory.refuse(it); onClose(); }}>Not true</Button>
              </div>
            </>
          )}
          {it.section === "kept" &&
            (forgetting ? (
              <>
                <p className="memory-conseq"><b>Forget:</b> {d.forget}</p>
                <div className="memory-acts">
                  <Button size="sm" kind="danger" onClick={() => { void memory.forget(it); onClose(); }}>Forget it</Button>
                  <Button size="sm" kind="ghost" onClick={() => setForgetting(false)}>Keep it</Button>
                </div>
              </>
            ) : (
              <div className="memory-acts">
                <Button size="sm" kind="ghost" onClick={() => setForgetting(true)}>Forget…</Button>
              </div>
            ))}
        </>
      ) : (
        <>
          <p className="memory-src">You said so, when you marked your domains.</p>
          <div className="memory-acts">
            <Button size="sm" kind="secondary" onClick={onEverything}>Change it</Button>
          </div>
        </>
      )}
    </div>
  );
  if (mobile) return <Sheet onClose={onClose} title={clause.text}>{body}</Sheet>;
  return (
    <Popover anchor={anchor} open onClose={onClose} label={clause.text} className="mem-pop">
      {body}
    </Popover>
  );
}

// ── Everything: the eight weeks, as evidence ──────────────────────────────────

const PORTRAIT_FROM = 5;
const PORTRAIT_TO = 23;

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
      <figcaption>Eight weeks as one week. Darker means more of the weeks.</figcaption>
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
          <div className="memory-acts">
            <Button size="sm" kind="primary" onClick={onKeep} disabled={!canAnswer}>Keep</Button>
            <Button size="sm" kind="ghost" onClick={onRefuse} disabled={!canAnswer}>Not true</Button>
          </div>
        </>
      )}
      {item.section === "watch" && (
        <div className="memory-acts">
          <Button size="sm" kind="ghost" onClick={onRefuse} disabled={!canAnswer}>Not true</Button>
        </div>
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
