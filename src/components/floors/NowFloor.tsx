// Now — the intelligent recommendation, set inside the real shape of the day.
// A four-domain operator can't hold "what am I in, what's next, where's open,
// am I going quiet somewhere" in their head — so the Now view shows it: a
// proportional spine of today on the left, the ranked Right Now anchored to
// the next open block on the right, and a domain-balance read framed as Gain.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { useVertical } from "../../hooks/useVertical";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks, useAllTasks } from "../../hooks/useTasks";
import { useSettings } from "../../hooks/useSettings";
import { useWorkingDays } from "../../hooks/useWorkingDays";
import { useAgent } from "../../hooks/useAgent";
import { todayISO } from "../../lib/dates";
import { domainById, faithfulness, initiativeById, initiativeProgress, taskDomainColor, type Domain, type VerticalData } from "../../lib/vertical";
import { fmtMins, OPEN_OFFER_MINS, rankNow, readDay, toBusyBlocks, type BusyBlock, type DayRead, type Gap, type NowContext, type Suggestion } from "../../lib/now";
import { composeWeek, fmtSlot, type ComposeResult, type DayContext } from "../../lib/compose";
import { composeBrief, type Brief } from "../../lib/brief";
import type { AgentMessage } from "../../lib/agentTypes";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { Btn, Modal } from "../ui";
import Standback from "./Standback";
import { BigRocksRibbon } from "./bigRocks";

const NAME = "Phil";

// Nuvo collapses by default so the day owns the hero space; expands to a rail
// only when you actually want to talk. Choice persists.
const CHAT_KEY = "nuvo.today.chat";
const readChatOpen = (): boolean => {
  try { return localStorage.getItem(CHAT_KEY) === "1"; } catch { return false; }
};

export default function NowFloor({
  onOpenDay,
  onAskNuvo,
}: {
  onOpenDay: () => void;
  /** Mobile: route "Ask Nuvo" to the global chat sheet instead of the inline
   *  rail. Optional — desktop leaves it unset and keeps the inline rail. */
  onAskNuvo?: (seed?: string) => void;
}) {
  const { data, toggleTask, applySchedule } = useVertical();
  const { settings } = useSettings();
  const [workingDays] = useWorkingDays();
  const { nav, setNowMoment, back, openRecord, focusDomain, goRung, openOverlay } = useAppNavigation();
  const { nowMoment, nowTaskId } = nav;

  // Today has two faces: the tactical "now" (what to start next) and the
  // strategic "step back" (the board — bets, drift, blind spots). Same rung,
  // one toggle between them. Local state: leaving Today resets to the now face.
  const [mode, setMode] = useState<"now" | "standback">("now");

  // a live "now" — the floor can stay open for hours
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Is today a day off? A Saturday — or any day you marked off — is not an open
  // gap to fill with the work backlog. When it is, Now drops its "start this
  // next" posture: it shows only what's actually planned and protects the rest,
  // with a quiet opt-in for the times you genuinely want to pick something up.
  const restDay = useMemo(() => {
    const ctx = (data.sprint?.day_contexts ?? {})[todayISO(now)];
    return ctx === "off" || !workingDays.includes(now.getDay());
  }, [data.sprint, workingDays, now]);
  // opt-in reveal of suggestions on a rest day — off by default, you choose
  const [showPicks, setShowPicks] = useState(false);
  useEffect(() => { if (!restDay) setShowPicks(false); }, [restDay]);

  // the real day: every busy thing on the live calendar (event or block).
  // Query window is keyed to the hour so it doesn't churn every minute.
  const horizon = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: new Date(start.getTime() + 24 * 3600_000).toISOString() };
  }, [now.getHours()]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: events = [] } = useExternalEvents(horizon.start, horizon.end);
  const { data: blocks = [] } = useScheduledTasks(horizon.start, horizon.end);
  // raw rows for the "order my day" pool (inbox + backlog + today's untimed)
  const { data: allTasks = [] } = useAllTasks();
  const [order, setOrder] = useState<ComposeResult | null>(null);

  // How you're actually running today — set by talking to Nuvo. Re-voices the
  // brief and re-ranks the day toward low-friction work when you're spent.
  const [tired, setTired] = useState(false);
  const [chatOpen, setChatOpen] = useState(readChatOpen);
  useEffect(() => {
    try { localStorage.setItem(CHAT_KEY, chatOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [chatOpen]);
  const agent = useAgent({ start: horizon.start, end: horizon.end });
  // "Ask Nuvo": on mobile hand off to the global chat sheet (onAskNuvo); on
  // desktop open the inline rail and seed the shared agent.
  const askBar = onAskNuvo ?? ((seed?: string) => { setChatOpen(true); if (seed) void agent.sendMessage(seed); });

  const busy = useMemo<BusyBlock[]>(
    // respect the calendars the user has toggled off in settings
    () => toBusyBlocks(events, blocks, settings?.hidden_calendar_ids ?? []),
    [events, blocks, settings],
  );

  // The work window (the part of the day where focus lives), stretched to hold
  // anything scheduled outside it so nothing falls off the spine.
  const { windowStart, windowEnd } = useMemo(() => {
    const base = new Date(now);
    const ws = new Date(base);
    ws.setHours(0, (settings?.work_start_minutes ?? 480), 0, 0);
    const we = new Date(base);
    we.setHours(0, (settings?.work_end_minutes ?? 990), 0, 0);
    for (const b of busy) {
      if (b.start < ws) ws.setTime(b.start.getTime());
      if (b.end > we) we.setTime(b.end.getTime());
    }
    return { windowStart: ws, windowEnd: we };
  }, [busy, now, settings]);

  const dayRead = useMemo(() => readDay(now, busy, windowStart, windowEnd), [now, busy, windowStart, windowEnd]);
  const activeGap = dayRead.gaps[0] ?? null;
  // The block worth filling: the largest open stretch ahead. "Now" only offers
  // a suggestion when this is genuinely big — otherwise it stays out of the way
  // and just reflects the planned day, rather than pushing unplanned work.
  const focusGap = useMemo(
    () => dayRead.gaps.reduce<Gap | null>((best, g) => (!best || g.mins > best.mins ? g : best), null),
    [dayRead.gaps],
  );
  const worthOffering = !!focusGap && focusGap.mins >= OPEN_OFFER_MINS;

  const ctx = useMemo<NowContext>(() => {
    const clockLabel = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const gapMins = (focusGap ?? activeGap)?.mins ?? (now.getHours() >= 18 ? 90 : 120);
    const gapLabel = dayRead.current
      ? `in “${dayRead.current.title}” for ${Math.max(1, Math.round((dayRead.current.end.getTime() - now.getTime()) / 60_000))}m more`
      : dayRead.next
        ? `${Math.max(1, Math.round((dayRead.next.start.getTime() - now.getTime()) / 60_000))}m till ${dayRead.next.title}`
        : "open horizon — nothing scheduled";
    return { gapMins, deepWindow: dayRead.deepWindow, clockLabel, gapLabel, tired };
  }, [now, focusGap, activeGap, dayRead, tired]);

  const suggestions = useMemo(() => rankNow(data, ctx), [data, ctx]);
  // A suggestion (only ever shown on opt-in) targets the big open block and must
  // fit it; fall back to the full list only when nothing fits.
  const gapMins = focusGap?.mins ?? Number.POSITIVE_INFINITY;
  const fitting = useMemo(() => suggestions.filter((s) => s.task.durationMins <= gapMins), [suggestions, gapMins]);
  const pool = fitting.length ? fitting : suggestions;
  const [idx, setIdx] = useState(0);
  const top = pool[Math.min(idx, Math.max(0, pool.length - 1))] ?? null;
  const topFits = !!top && top.task.durationMins <= gapMins;
  const focusIsNow = !!focusGap && focusGap.start.getTime() <= now.getTime() + 60_000;
  // Frame as a future block when you're mid-meeting, the big block is later, or
  // the best task needs more room than that block — never a misfit "start now".
  const futureFrame = !!dayRead.current || !focusIsNow || (!!top && !topFits);
  const targetGap = topFits
    ? focusGap
    : top
      ? dayRead.gaps.find((g) => g.mins >= top.task.durationMins) ?? focusGap
      : focusGap;
  const derivedActive = useMemo<Suggestion | null>(() => {
    if (!nowTaskId) return null;
    const inSug = suggestions.find((s) => s.task.id === nowTaskId);
    if (inSug) return inSug;
    // The task may have just left the ready pool (you completed it) — rebuild a
    // minimal suggestion from the full task list so the focus/done moment holds.
    const t = data.tasks.find((x) => x.id === nowTaskId);
    if (!t) return null;
    return { task: t, domain: domainById(data, t.domainId), initiative: initiativeById(data, t.initiativeId), score: 0, reasons: [] };
  }, [nowTaskId, suggestions, data]);
  // Keep the last resolved suggestion so the focus/done moment survives even if
  // the task drops out of both the ready pool AND the cache mid-completion.
  const lastActiveRef = useRef<Suggestion | null>(null);
  if (derivedActive) lastActiveRef.current = derivedActive;
  const active = derivedActive ?? (nowTaskId && lastActiveRef.current?.task.id === nowTaskId ? lastActiveRef.current : null);
  const brief = useMemo(() => composeBrief({ now, name: NAME, dayRead, top, tired, restDay }), [now, dayRead, top, tired, restDay]);

  // ── Order my day — pull from the inbox/week and time-block today around the
  //    real calendar, reusing the week composer over a one-day window. ────────
  const proposeOrder = () => {
    const today = todayISO(now);
    const pool = allTasks.filter(
      (t) =>
        t.status !== "done" && t.status !== "trashed" && !t.start_time &&
        (t.do_date === today || (!t.do_date && (t.status === "inbox" || t.status === "backlog"))),
    );
    setOrder(
      composeWeek({
        weekStartISO: today,
        todayISO: today,
        now,
        tasks: pool,
        events: events.filter((e) => !(settings?.hidden_calendar_ids ?? []).includes(e.calendar_id)),
        blocks,
        workStartMin: settings?.work_start_minutes ?? 480,
        workEndMin: settings?.work_end_minutes ?? 990,
        focusInitiativeIds: data.focusInitiativeIds,
        dayContexts: (data.sprint?.day_contexts ?? {}) as Record<string, DayContext>,
        workingDays: [now.getDay()], // only today is "working" — every block lands today
        weeklyBudgetMins: null,
      }),
    );
  };
  const applyOrder = async () => {
    if (!order) return;
    await applySchedule(
      order.placements.map((p) => {
        const [y, mo, d] = p.dayISO.split("-").map(Number);
        return {
          id: p.task.id,
          doDateISO: p.dayISO,
          startISO: new Date(y, mo - 1, d, Math.floor(p.startMin / 60), p.startMin % 60).toISOString(),
        };
      }),
    );
    setOrder(null);
  };

  // ── The strategic face: a step back to the board ──────────────────────────
  if (mode === "standback") {
    return (
      <div className="mx-auto w-full max-w-[1080px]">
        <ModeToggle mode={mode} setMode={setMode} />
        <Standback
          data={data}
          now={now}
          onOpenInitiative={(id) => openRecord("initiative", id)}
          onOpenDomain={(id) => { focusDomain({ domainId: id, initiativeId: "", projectId: "" }); goRung("domain"); }}
        />
      </div>
    );
  }

  // ── Focusing / done are "moments": clear the day away, one thing only ──
  if (active && nowMoment === "focus") {
    return (
      <Moment accent={active.domain?.color}>
        <div className="section-label">Focusing</div>
        <div className="mt-1.5 text-display font-medium">{active.task.title}</div>
        <div className="mono mt-1 text-label text-muted">{active.task.durationMins}m · everything else is quiet</div>
        <div className="mt-5 flex justify-center gap-2">
          <Btn kind="primary" onClick={() => { toggleTask(active.task.id); setNowMoment("done", active.task.id); }}>✓ done</Btn>
          <Btn onClick={back}>back</Btn>
        </div>
      </Moment>
    );
  }
  if (active && nowMoment === "done") {
    return (
      <Moment accent={active.domain?.color}>
        <div className="text-head font-medium" style={{ color: active.domain?.color }}>✓ logged as a gain</div>
        <div className="mt-1.5 text-body text-ink">{active.task.title}</div>
        <div className="mt-2 space-y-0.5 text-caption text-muted">
          {active.initiative && <div>{active.initiative.name} — now {initiativeProgress(data, active.initiative)}%</div>}
          {active.domain && <div>{active.domain.name} tended · faithful again today</div>}
        </div>
        <div className="mt-4"><Btn onClick={() => { setNowMoment("choose"); setIdx(0); }}>what's next →</Btn></div>
      </Moment>
    );
  }

  return (
    <div className={`mx-auto w-full ${chatOpen ? "max-w-[1460px] 2xl:max-w-[1720px]" : "max-w-[1080px]"}`}>
      <ModeToggle mode={mode} setMode={setMode} />
      {/* big rocks — held all week, the first thing Today shows (when set) */}
      <BigRocksRibbon />
      {order && (
        <OrderDayModal order={order} data={data} onApply={() => void applyOrder()} onClose={() => setOrder(null)} />
      )}
      {/* Collapsed (default): one centered column, the day as the hero.
          Expanded: the chat earns a sticky right rail and reclaims the margin. */}
      <div className={chatOpen ? "xl:grid xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start xl:gap-x-10" : ""}>
        <div className="xl:col-start-1 xl:row-start-1">
          <NowBrief now={now} dayRead={dayRead} brief={brief} tired={tired} restDay={restDay} onPlan={() => openOverlay("morning")} onShutdown={() => openOverlay("evening")} />
          {!chatOpen && (
            <NuvoBar tired={tired} setTired={setTired} onAsk={askBar} />
          )}
        </div>

        {chatOpen && (
          <div className="mt-4 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:mt-0 xl:self-start xl:sticky xl:top-0">
            <NowAssistant agent={agent} tired={tired} setTired={setTired} onCollapse={() => setChatOpen(false)} />
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-x-9 gap-y-7 md:grid-cols-[248px_1fr] xl:col-start-1 xl:row-start-2">
          <DaySpine now={now} busy={busy} gaps={dayRead.gaps} activeGap={activeGap} windowStart={windowStart} windowEnd={windowEnd} onOrder={proposeOrder} />

        <div className="min-w-0">
          {/* RIGHT NOW — the meeting you're in, when you're in one; else the task to start */}
          {dayRead.current ? (
            <>
              <div className="section-label mb-2">Right now</div>
              <MeetingNow now={now} current={dayRead.current} overlapping={dayRead.overlapping} />
            </>
          ) : null}

          {dayRead.upcoming.length > 0 && (
            <UpNext now={now} items={dayRead.upcoming} className={dayRead.current ? "mt-5" : ""} />
          )}

          {/* By default Now does NOT push unplanned work — it only suggests when
              you've opted in (showPicks). The card targets the big open block. */}
          {showPicks && top ? (
            <div className={dayRead.current || dayRead.upcoming.length ? "mt-6" : ""}>
              <div className="section-label mb-2">
                {futureFrame
                  ? targetGap
                    ? `${dayRead.current ? "When you're free" : "Your next block"} · ${targetGap.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${fmtMins(targetGap.mins)}`
                    : "Line up next"
                  : restDay
                    ? "If you want to pick something up"
                    : "Right now"}
              </div>
              <div className="rise rounded-lg border glass-card p-4" style={{ borderColor: top.domain?.color, borderWidth: 1.5 }}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => { toggleTask(top.task.id); setNowMoment("done", top.task.id); }}
                    title="Mark done"
                    aria-label="Mark done"
                    className="group/check fast mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 hover:scale-105"
                    style={{ borderColor: top.domain?.color ?? "var(--line-strong)" }}
                  >
                    <span className="text-[11px] leading-none opacity-0 transition-opacity group-hover/check:opacity-100" style={{ color: top.domain?.color }}>✓</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-display font-medium leading-snug">{top.task.title}</div>
                    <div className="mono mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-label">
                      {top.domain && <span style={{ color: top.domain.color }}>{top.domain.name}</span>}
                      {top.initiative && <><span className="text-line">·</span><span className="text-muted">{top.initiative.name}</span></>}
                    </div>
                  </div>
                </div>

                {!futureFrame && <GapAnchor activeGap={activeGap} current={dayRead.current} accent={top.domain?.color} />}

                <div className="mt-3 space-y-1.5">
                  {top.reasons.map((r, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-caption text-muted">
                      <span className="w-3 text-center" style={{ color: top.domain?.color }}>{r.glyph}</span>
                      {r.text}
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {futureFrame ? (
                    <>
                      <Btn kind="primary" onClick={onOpenDay}>
                        {targetGap ? `plan for ${targetGap.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} →` : "open day planner"}
                      </Btn>
                      <Btn onClick={() => top && setNowMoment("focus", top.task.id)}>start anyway</Btn>
                      <Btn onClick={() => setIdx((i) => (i + 1) % pool.length)}>not this</Btn>
                    </>
                  ) : (
                    <>
                      <Btn kind="primary" onClick={() => top && setNowMoment("focus", top.task.id)}>▶ start · {top.task.durationMins}m</Btn>
                      <Btn onClick={() => setIdx((i) => (i + 1) % pool.length)}>not now</Btn>
                      <Btn onClick={onOpenDay}>open day planner</Btn>
                    </>
                  )}
                </div>
              </div>

              {suggestions.length > 1 && (() => {
                // Now is a decision, not a list: at most two ranked alternates
                // that also fit the window, then the rest of the backlog behind
                // one quiet link to the day planner (where browsing belongs).
                const alts = pool.map((s, i) => ({ s, i })).filter((x) => x.i !== idx).slice(0, 2);
                const more = suggestions.length - 1 - alts.length;
                return (
                  <div className="mt-3.5">
                    {alts.length > 0 && (
                      <>
                        <div className="section-label mb-1.5">Or</div>
                        <div className="space-y-1">
                          {alts.map(({ s, i }) => (
                            <button
                              key={s.task.id}
                              onMouseDown={(e) => { e.preventDefault(); setIdx(i); }}
                              className="fast group flex w-full items-center gap-2 text-left text-caption text-muted hover:text-ink"
                            >
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.domain?.color ?? "var(--line-strong)" }} />
                              <span className="truncate group-hover:underline">{s.task.title}</span>
                              <span className="mono shrink-0 text-meta text-line">{s.task.durationMins}m</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {more > 0 && (
                      <button onClick={onOpenDay} className={`fast mono text-meta text-muted hover:text-accent ${alts.length ? "mt-2" : ""}`}>
                        + {more} more ready · open day planner →
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : suggestions.length > 0 && (restDay || worthOffering) && focusGap ? (
            // A genuinely big open block — Nuvo offers, it doesn't push.
            <OpenInvite
              focusGap={focusGap}
              now={now}
              restDay={restDay}
              inMeeting={!!dayRead.current}
              spaced={!!(dayRead.current || dayRead.upcoming.length)}
              onAccept={() => setShowPicks(true)}
            />
          ) : suggestions.length === 0 && !dayRead.current ? (
            <div className="mt-6 rounded-lg border border-line bg-surface-2 p-6 text-center text-body text-muted">
              Nothing ready — inbox zero.
              <div className="mt-3"><Btn onClick={onOpenDay}>open day planner</Btn></div>
            </div>
          ) : null}

          <DomainBalance domains={data.domains} restDay={restDay} />
        </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// The two faces of Today: "Right now" (tactical — what to start) and "Step
// back" (strategic — the board). A quiet segmented control, not a new rung, so
// the altitude ladder keeps its muscle memory and the two reads stay paired.
function ModeToggle({ mode, setMode }: { mode: "now" | "standback"; setMode: (m: "now" | "standback") => void }) {
  const tabs: { id: "now" | "standback"; label: string }[] = [
    { id: "now", label: "Right now" },
    { id: "standback", label: "Step back" },
  ];
  return (
    <div className="mb-4 inline-flex items-center gap-0.5 rounded-full border border-line bg-surface-2 p-0.5">
      {tabs.map((t) => {
        const on = t.id === mode;
        return (
          <button
            key={t.id}
            onClick={() => setMode(t.id)}
            className="fast mono rounded-full px-3 py-1 text-label"
            style={{
              background: on ? "var(--surface)" : "transparent",
              color: on ? "var(--accent)" : "var(--muted)",
              fontWeight: on ? 600 : 400,
              boxShadow: on ? "var(--shadow-1)" : "none",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// The brief — Nuvo talking to you. A first-person read of the whole day, the
// scannable stats underneath, and a composer so you can just say what you need.
function NowBrief({
  now, dayRead, brief, tired, restDay, onPlan, onShutdown,
}: {
  now: Date;
  dayRead: DayRead;
  brief: Brief;
  tired: boolean;
  restDay: boolean;
  /** The day's rituals, relocated here from the Schedule top bar — Plan in the
   *  morning, shut down in the evening. They live in Today now. */
  onPlan: () => void;
  onShutdown: () => void;
}) {
  const weekday = now.toLocaleDateString([], { weekday: "short" });
  const clock = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // Lead with the ritual that fits the hour, but keep both reachable.
  const evening = now.getHours() >= 17;

  const chips: { glyph: string; text: string; tone?: "accent" | "muted" }[] = [];
  // On a day off, open time isn't a number to fill — so we don't headline it.
  if (restDay) chips.push({ glyph: "—", text: "day off", tone: "muted" });
  else if (dayRead.openMins > 0) chips.push({ glyph: "⏱", text: `${fmtMins(dayRead.openMins)} open`, tone: "accent" });
  chips.push({ glyph: "◷", text: dayRead.remaining === 0 ? "no commitments left" : `${dayRead.remaining} commitment${dayRead.remaining > 1 ? "s" : ""} left` });
  if (!restDay && dayRead.deepWindow && dayRead.deepEndsLabel && !dayRead.current && !tired) chips.push({ glyph: "◆", text: `deep focus till ${dayRead.deepEndsLabel}` });
  if (tired) chips.push({ glyph: "☾", text: "low-energy mode" });

  return (
    <div className="border-b border-line pb-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="mono text-meta text-muted">{weekday} · {clock}</div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onPlan}
            className={`fast rounded-full border px-2.5 py-1 text-label ${evening ? "border-line text-muted hover:border-accent hover:text-accent" : "border-accent/40 bg-accent-soft font-medium text-accent hover:bg-accent/15"}`}
          >
            ✷ Plan
          </button>
          <button
            onClick={onShutdown}
            className={`fast rounded-full border px-2.5 py-1 text-label ${evening ? "border-accent/40 bg-accent-soft font-medium text-accent hover:bg-accent/15" : "border-line text-muted hover:border-accent hover:text-accent"}`}
          >
            ☾ Shut down
          </button>
        </div>
      </div>

      <h1 className="text-display masthead">{brief.greeting}</h1>
      <p className="mt-1.5 max-w-[680px] text-head leading-relaxed text-ink/90">{brief.body}</p>

      <div className="mono mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-label">
        {chips.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5" style={{ color: c.tone === "accent" ? "var(--accent)" : "var(--muted)" }}>
            <span>{c.glyph}</span>
            {c.text}
          </span>
        ))}
      </div>
    </div>
  );
}

// Collapsed launcher — a single calm row under the brief: open Nuvo, or fire a
// common ask straight away. Keeps control one tap away without holding space.
// onAsk(seed?) opens the conversation (inline rail on desktop, global sheet on
// mobile) and optionally seeds it with a message.
function NuvoBar({
  tired, setTired, onAsk,
}: {
  tired: boolean;
  setTired: (v: boolean) => void;
  onAsk: (seed?: string) => void;
}) {
  const pill = "fast rounded-full border px-2.5 py-1 text-label";
  const ghost = `${pill} border-line text-muted hover:border-accent hover:text-accent`;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <button onClick={() => onAsk()} className={`${pill} flex items-center gap-1.5 border-accent/40 bg-accent-soft font-medium text-accent hover:bg-accent/15`}>
        <span>✦</span> Ask Nuvo
      </button>
      <button onClick={() => setTired(!tired)} className={ghost}>
        {tired ? "↑ back to full energy" : "☾ I'm wiped — lighten today"}
      </button>
      <button onClick={() => onAsk("What should I prep for my next meeting? Give me a quick preread.")} className={ghost}>what should I prep?</button>
      <button onClick={() => onAsk("I'm short on time — push my non-urgent afternoon tasks to tomorrow.")} className={ghost}>move my afternoon</button>
      <button onClick={() => onAsk("Where are my open blocks for the rest of today?")} className={ghost}>what's open later?</button>
    </div>
  );
}

// The expanded panel — the live conversation. Talk to Nuvo; free text routes to
// the real agent (which can move blocks for you).
function NowAssistant({
  agent, tired, setTired, onCollapse,
}: {
  agent: ReturnType<typeof useAgent>;
  tired: boolean;
  setTired: (v: boolean) => void;
  onCollapse: () => void;
}) {
  const { messages, loading, error, sendMessage } = agent;
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const send = (text: string) => {
    if (!text.trim() || loading) return;
    setInput("");
    void sendMessage(text);
  };

  const chips: { label: string; on: () => void }[] = [
    tired
      ? { label: "↑ back to full energy", on: () => setTired(false) }
      : { label: "☾ I'm wiped — lighten today", on: () => setTired(true) },
    { label: "what should I prep?", on: () => send("What should I prep for my next meeting? Give me a quick preread.") },
    { label: "move my afternoon", on: () => send("I'm short on time — push my non-urgent afternoon tasks to tomorrow.") },
    { label: "what's open later?", on: () => send("Where are my open blocks for the rest of today?") },
  ];

  return (
    <div className="rise rounded-lg border border-line bg-surface-2 p-3.5">
      <div className="mb-3 flex items-center justify-between">
        <span className="section-label">Ask Nuvo</span>
        <button onClick={onCollapse} title="Collapse" className="fast mono text-meta text-muted hover:text-ink">collapse ›</button>
      </div>

      {messages.length > 0 ? (
        <div className="mb-2.5 max-h-[260px] space-y-2.5 overflow-y-auto rounded-lg border border-line bg-surface p-3 xl:max-h-[calc(100vh-340px)]">
          {messages.map((m) => <Bubble key={m.id} message={m} />)}
          {loading && (
            <div className="agent-bubble agent-bubble-assistant w-fit">
              <span className="mono shimmer text-label">Nuvo's on it…</span>
            </div>
          )}
        </div>
      ) : (
        <p className="mb-2.5 text-caption leading-relaxed text-muted">
          I've read your day. Ask me to move things, prep you for what's next, or lighten the load.
        </p>
      )}
      {error && !loading && (
        <div className="mb-2 rounded-md bg-signal-soft px-2.5 py-1.5 text-label text-signal">{error}</div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.label}
            onClick={c.on}
            disabled={loading}
            className="fast rounded-full border border-line bg-surface px-2.5 py-1 text-label text-muted hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="fast mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
        <span className="mono shrink-0 text-meta text-accent">›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(input); } }}
          placeholder="Tell Nuvo how you're running, or what to move…"
          disabled={loading}
          className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted disabled:opacity-50"
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          className="fast shrink-0 rounded-md border border-accent bg-accent px-2.5 py-1 text-label font-medium text-white disabled:opacity-30"
        >
          ↩
        </button>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`agent-bubble max-w-[88%] ${isUser ? "agent-bubble-user" : "agent-bubble-assistant"}`}>
        {isUser ? (
          <p className="whitespace-pre-wrap text-caption leading-relaxed">{message.content}</p>
        ) : (
          <div className="agent-markdown text-caption leading-relaxed"><ReactMarkdown>{message.content}</ReactMarkdown></div>
        )}
        {message.actions && message.actions.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-line/50 pt-2">
            {message.actions.map((a) => (
              <li key={a.summary} className="mono text-meta text-muted">✓ {a.summary}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// When you've a genuinely big open block, Nuvo doesn't push a task — it asks.
// The default Now stays out of your way; this is the only door into a pick.
function OpenInvite({
  focusGap, now, restDay, inMeeting, spaced, onAccept,
}: {
  focusGap: Gap;
  now: Date;
  restDay: boolean;
  inMeeting: boolean;
  spaced: boolean;
  onAccept: () => void;
}) {
  const isNow = focusGap.start.getTime() <= now.getTime() + 60_000;
  const at = focusGap.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const when = isNow ? "right now" : inMeeting ? `at ${at}, once you're free` : `at ${at}`;
  return (
    <div className={spaced ? "mt-6" : "mt-2"}>
      <div className="rounded-lg border border-dashed border-line bg-surface-2/50 p-4">
        <div className="text-body">
          {restDay
            ? `It's a day off — but you've ${fmtMins(focusGap.mins)} clear ${when} if you want it.`
            : `You've a ${fmtMins(focusGap.mins)} open block ${when}.`}
        </div>
        <button
          onClick={onAccept}
          className="fast mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-label font-medium text-accent hover:bg-accent/15"
        >
          <span>✦</span> Want me to find something valuable? →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// You're inside committed time — so "now" is the meeting, not a task. Orient:
// what it is, how much is left, what's stacked on top of it.
function MeetingNow({ now, current, overlapping }: { now: Date; current: BusyBlock; overlapping: BusyBlock[] }) {
  const total = Math.max(1, (current.end.getTime() - current.start.getTime()) / 60_000);
  const elapsed = Math.min(total, Math.max(0, (now.getTime() - current.start.getTime()) / 60_000));
  const minsLeft = Math.max(1, Math.round((current.end.getTime() - now.getTime()) / 60_000));
  const range = `${current.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${current.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

  return (
    <div className="rise rounded-lg border glass-card p-4" style={{ borderColor: "var(--signal)", borderWidth: 1.5 }}>
      <div className="flex items-center justify-between gap-3">
        <span className="section-label flex items-center gap-2" style={{ color: "var(--signal)" }}>
          <span className="pulse-glow inline-block h-2 w-2 rounded-full" style={{ background: "var(--signal)" }} />
          In a meeting
        </span>
        <span className="mono text-caption" style={{ color: "var(--signal)" }}>{fmtMins(minsLeft)} left</span>
      </div>
      <div className="mt-1.5 text-display font-medium leading-snug">{current.title}</div>
      <div className="mono mt-0.5 text-label text-muted">
        {range}{current.location ? ` · ${current.location}` : ""}
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div className="h-full rounded-full" style={{ width: `${(elapsed / total) * 100}%`, background: "var(--signal)" }} />
      </div>
      {overlapping.length > 0 && (
        <div className="mono mt-3 flex items-start gap-1.5 text-meta" style={{ color: "var(--signal)" }}>
          <span>⚠</span>
          <span>
            {overlapping.length} more on your calendar now — {overlapping.map((o) => o.title).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

// The runway — the next few commitments in order, so nothing lands as a surprise.
function UpNext({ now, items, className = "" }: { now: Date; items: BusyBlock[]; className?: string }) {
  return (
    <div className={className}>
      <div className="section-label mb-2">Up next</div>
      <div className="space-y-1.5">
        {items.map((b, i) => {
          const soon = b.start.getTime() - now.getTime() <= 15 * 60_000;
          return (
            <div key={i} className="flex items-baseline gap-2.5 text-caption">
              <span className="mono w-16 shrink-0 text-right text-meta" style={{ color: soon ? "var(--signal)" : "var(--muted)" }}>
                {b.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
              <span className="h-1.5 w-1.5 shrink-0 translate-y-[3px] rounded-full" style={{ background: b.kind === "block" ? "var(--accent)" : "var(--line-strong)" }} />
              <span className="truncate text-ink">{b.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Greedy interval colouring: give each block the lowest free column within its
// overlap cluster; every block in a cluster shares the cluster's peak width.
function layoutColumns(blocks: BusyBlock[]): { b: BusyBlock; col: number; cols: number }[] {
  const sorted = [...blocks].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime(),
  );
  const out: { b: BusyBlock; col: number; cols: number }[] = [];
  let cluster: { b: BusyBlock; col: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = cluster.reduce((m, c) => Math.max(m, c.col + 1), 1);
    for (const c of cluster) out.push({ b: c.b, col: c.col, cols });
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start.getTime() >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => c.b.end.getTime() > b.start.getTime()).map((c) => c.col));
    let col = 0;
    while (taken.has(col)) col++;
    cluster.push({ b, col });
    clusterEnd = Math.max(clusterEnd, b.end.getTime());
  }
  flush();
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// The spine of today — a proportional, hairline timeline. The literal arc of
// the day: what's behind you dims, what you're in glows, open blocks read as
// the breathing room they are.
function DaySpine({
  now, busy, activeGap, windowStart, windowEnd, onOrder,
}: {
  now: Date; busy: BusyBlock[]; gaps: Gap[]; activeGap: Gap | null; windowStart: Date; windowEnd: Date; onOrder: () => void;
}) {
  const winMins = Math.max(60, (windowEnd.getTime() - windowStart.getTime()) / 60_000);
  // Fit the day into a comfortable band while keeping proportions honest.
  const pxPerMin = Math.min(1.1, Math.max(0.5, 470 / winMins));
  const H = winMins * pxPerMin;
  const y = (d: Date) => ((d.getTime() - windowStart.getTime()) / 60_000) * pxPerMin;

  // Hour guides
  const hours: Date[] = [];
  const firstHour = new Date(windowStart);
  if (firstHour.getMinutes() > 0) firstHour.setHours(firstHour.getHours() + 1, 0, 0, 0);
  for (let t = new Date(firstHour); t <= windowEnd; t = new Date(t.getTime() + 3600_000)) hours.push(new Date(t));

  const nowY = y(now);
  const inWindow = now >= windowStart && now <= windowEnd;

  // Lay overlapping commitments into side-by-side columns so a stacked calendar
  // (three meetings at 11am) reads as a conflict instead of a pile of titles.
  const laid = layoutColumns(busy.filter((b) => b.end > windowStart && b.start < windowEnd));

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="section-label">Today</span>
        <button
          onClick={onOrder}
          title="Pull from your inbox + week and time-block today around your calendar"
          className="fast mono text-meta text-accent hover:underline"
        >
          ✦ order my day
        </button>
      </div>
      <div className="relative pl-11" style={{ height: H }}>
        {/* hour ticks + labels */}
        {hours.map((hr) => (
          <div key={hr.getTime()} className="pointer-events-none absolute left-0 right-0 flex items-center" style={{ top: y(hr) }}>
            <span className="mono absolute left-0 -translate-y-1/2 text-micro text-line">
              {hr.toLocaleTimeString([], { hour: "numeric" }).replace(" ", "")}
            </span>
            <div className="ml-9 h-px flex-1" style={{ background: "color-mix(in srgb, var(--line) 60%, transparent)" }} />
          </div>
        ))}

        {/* the spine rail */}
        <div className="absolute bottom-0 top-0 w-px" style={{ left: 38, background: "var(--line)" }} />

        {/* the active open block — where the recommendation lives */}
        {activeGap && (
          <div
            className="absolute rounded-md"
            style={{
              top: y(activeGap.start), height: Math.max(16, (activeGap.mins * pxPerMin)),
              left: 32, right: 0,
              background: "var(--accent-soft)",
              border: "1px dashed color-mix(in srgb, var(--accent) 40%, transparent)",
            }}
          >
            <span className="mono absolute right-2 top-1 text-micro text-accent">open · {fmtMins(activeGap.mins)}</span>
          </div>
        )}

        {/* busy blocks — placed into overlap columns */}
        {laid.map(({ b, col, cols }, i) => {
          const top = Math.max(0, y(b.start));
          const height = Math.max(15, y(b.end) - y(b.start));
          const past = b.end <= now;
          const ongoing = b.start <= now && now < b.end;
          const isBlock = b.kind === "block";
          const bar = ongoing ? "var(--signal)" : isBlock ? "var(--accent)" : "var(--muted)";
          // column geometry within the rail (rail starts at 32px from the left)
          const left = `calc(32px + (100% - 32px) * ${col} / ${cols})`;
          const width = `calc((100% - 32px) / ${cols} - 3px)`;
          return (
            <div
              key={i}
              className="fast absolute overflow-hidden rounded-md pl-2 pr-1.5 py-1 backdrop-blur-[3px]"
              style={{
                top, height, left, width,
                // Tinted glass keyed to the block's own colour — the paper + hour
                // guides read through it (frosted), so a block is a pane of glass
                // like the Schedule's events, not an opaque white slab. The solid
                // 3px left bar still carries the true colour; no busy outline.
                background: `color-mix(in srgb, ${bar} ${ongoing ? 18 : 13}%, transparent)`,
                borderLeft: `3px solid ${bar}`,
                opacity: past && !ongoing ? 0.42 : 1,
                boxShadow: ongoing ? "var(--shadow-2)" : "none",
                zIndex: ongoing ? 5 : 1,
              }}
            >
              <div className="truncate text-label font-medium leading-tight" style={{ textDecoration: b.done ? "line-through" : undefined }}>
                {b.title}
              </div>
              {height > 30 && cols === 1 && (
                <div className="mono text-micro text-muted">
                  {b.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </div>
              )}
            </div>
          );
        })}

        {/* the now line */}
        {inWindow && (
          <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center" style={{ top: nowY }}>
            <span className="absolute h-2 w-2 -translate-y-1/2 rounded-full" style={{ left: 34, background: "var(--signal)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--signal) 22%, transparent)" }} />
            <div className="ml-[42px] h-px flex-1" style={{ background: "var(--signal)" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// A small line tying the recommendation to the block it fills.
function GapAnchor({ activeGap, current, accent }: { activeGap: Gap | null; current: BusyBlock | null; accent?: string }) {
  if (!activeGap) return null;
  const future = activeGap.start.getTime() > Date.now() + 60_000;
  const at = activeGap.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const text = future
    ? current
      ? `your next open block — ${fmtMins(activeGap.mins)} free at ${at}`
      : `${fmtMins(activeGap.mins)} free at ${at}`
    : `slots into your open ${fmtMins(activeGap.mins)} block`;
  return (
    <div className="mono mt-2 flex items-center gap-1.5 text-meta" style={{ color: accent ?? "var(--accent)" }}>
      <span>↳</span> {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Domain balance — the faithfulness read, framed as Gain not Gap. The quietest
// domain rises to the top with a gentle nudge: don't go silent here. On a day
// off the nudge softens — it's a note for the week ahead, not a task for today.
function DomainBalance({ domains, restDay }: { domains: Domain[]; restDay: boolean }) {
  if (!domains.length) return null;
  const quietest = [...domains].sort((a, b) => b.lastTouchedDays - a.lastTouchedDays)[0];
  const nudge = quietest && quietest.lastTouchedDays >= 4 ? quietest : null;

  return (
    <div className="mt-7 border-t border-line pt-4">
      <div className="section-label mb-2.5">Domain balance · this week</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
        {domains.map((d) => {
          const f = faithfulness(d);
          const target = d.weeklyTargetHours || 0;
          const pct = target > 0 ? Math.min(1, d.investedThisWeek / target) : 0;
          return (
            <div key={d.id} className="flex items-center gap-2.5" style={{ opacity: f.lit ? 1 : 0.62 }}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-label">{d.name}</span>
                  <span className="mono shrink-0 text-micro text-muted">{f.note}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                  <div className="grow-x h-full rounded-full" style={{ width: `${Math.max(pct * 100, target > 0 ? 3 : 0)}%`, background: d.color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {nudge && (
        <div className="mono mt-3 flex items-center gap-1.5 text-meta text-muted">
          <span style={{ color: nudge.color }}>⚖</span>
          {restDay
            ? nudge.lastTouchedDays >= 99
              ? `${nudge.name} stayed untouched this week — one for the week ahead, not today.`
              : `${nudge.name} has been quiet ${nudge.lastTouchedDays}d — something for the week ahead.`
            : nudge.lastTouchedDays >= 99
              ? `${nudge.name} is untouched — a short task here would start the arc.`
              : `${nudge.name} has been quiet ${nudge.lastTouchedDays}d — a short task here would tend it.`}
        </div>
      )}
    </div>
  );
}

// A centered "moment" surface for focusing / completion.
function Moment({ accent, children }: { accent?: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-10 max-w-[460px]">
      <div className="moment rounded-lg border glass-card p-7 text-center" style={{ borderColor: accent ?? "var(--accent)", borderWidth: 1.5 }}>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// "Order my day" — the proposed timeline, reviewed before it lands. Each row is
// a placement with its reason (deep window, batched, due-pressure). You place
// the lot or walk away; nothing changes until you say so.
function OrderDayModal({
  order,
  data,
  onApply,
  onClose,
}: {
  order: ComposeResult;
  data: VerticalData;
  onApply: () => void;
  onClose: () => void;
}) {
  const placed = order.placements;
  return (
    <Modal onClose={onClose} width="max-w-md">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="text-lead masthead">Order my day</div>
        <div className="mono text-caption text-muted">
          {placed.length} placed{order.unplaced.length ? ` · ${order.unplaced.length} kept back` : ""}
        </div>
      </div>

      {placed.length === 0 ? (
        <div className="p-5 text-center text-body text-muted">
          Nothing to place — your inbox and week pool are clear, or today's already full.
        </div>
      ) : (
        <div className="max-h-[55vh] space-y-1 overflow-y-auto p-3">
          {placed.map((p) => {
            const color = taskDomainColor(data, p.task) ?? "var(--accent)";
            return (
              <div key={p.task.id} className="flex items-start gap-2.5 border-b border-line py-1.5 last:border-0">
                <span className="mono mt-0.5 w-[96px] shrink-0 text-meta" style={{ color }}>{fmtSlot(p)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body">{p.task.title || "untitled"}</div>
                  <div className="mono truncate text-micro text-muted">{p.reason}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {order.unplaced.length > 0 && (
        <div className="border-t border-line px-4 py-2 text-label text-muted">
          {order.unplaced.length} didn't fit today — they stay in your pool.
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-line p-3">
        {placed.length > 0 && (
          <Btn kind="primary" onClick={onApply}>Place {placed.length} on today →</Btn>
        )}
        <Btn onClick={onClose}>{placed.length > 0 ? "Cancel" : "Close"}</Btn>
      </div>
    </Modal>
  );
}
