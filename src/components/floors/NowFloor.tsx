// Today — the execution coach. Not a task-pusher and not a dashboard: it reads
// the live shape of your day back to you as a *recommendation*. A Call (the
// posture for the whole day), the one move that matters, the surprises worth
// fixing, and what slipped — set against a familiar day-view of the schedule
// you act on directly. The numbers live in coach.ts; here they only ever appear
// as the reason behind a move.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { useVertical } from "../../hooks/useVertical";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks, useAllTasks, useTaskMutations } from "../../hooks/useTasks";
import { useSettings } from "../../hooks/useSettings";
import { useWorkingDays } from "../../hooks/useWorkingDays";
import { useAgent } from "../../hooks/useAgent";
import { useCoachNudges, type CoachNudges } from "../../hooks/useCoachNudges";
import { todayISO, tomorrowISO } from "../../lib/dates";
import { domainById, initiativeById, initiativeProgress, taskDomainColor, type VerticalData } from "../../lib/vertical";
import { fmtMins, isEventHidden, readDay, toBusyBlocks, type BusyBlock, type Gap } from "../../lib/now";
import { composeCall, detectMoves, readVitals, type CoachMove, type DayCall, type SlippedItem } from "../../lib/coach";
import { composeWeek, fmtSlot, type ComposeResult, type DayContext } from "../../lib/compose";
import type { AgentMessage } from "../../lib/agentTypes";
import type { Task } from "../../lib/types";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { Btn, Modal } from "../ui";

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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
  const taskMutations = useTaskMutations();
  const { settings } = useSettings();
  const [workingDays] = useWorkingDays();
  const { nav, setNowMoment, back, openOverlay } = useAppNavigation();
  const { nowMoment, nowTaskId } = nav;

  const [blockCtxMenu, setBlockCtxMenu] = useState<{ b: BusyBlock; x: number; y: number } | null>(null);

  // a live "now" — the floor can stay open for hours
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Is today a day off? A Saturday — or any day you marked off — is not a day to
  // coach hard. The Call softens to a quiet "nothing's owed."
  const restDay = useMemo(() => {
    const ctx = (data.sprint?.day_contexts ?? {})[todayISO(now)];
    return ctx === "off" || !workingDays.includes(now.getDay());
  }, [data.sprint, workingDays, now]);

  // the real day: every busy thing on the live calendar (event or block).
  const horizon = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: new Date(start.getTime() + 24 * 3600_000).toISOString() };
  }, [now.getHours()]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: events = [] } = useExternalEvents(horizon.start, horizon.end);
  const { data: blocks = [] } = useScheduledTasks(horizon.start, horizon.end);
  const { data: allTasks = [] } = useAllTasks();
  const [order, setOrder] = useState<ComposeResult | null>(null);

  // How you're actually running today — set by talking to Nuvo.
  const [tired, setTired] = useState(false);
  const [chatOpen, setChatOpen] = useState(readChatOpen);
  useEffect(() => {
    try { localStorage.setItem(CHAT_KEY, chatOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [chatOpen]);
  const agent = useAgent({ start: horizon.start, end: horizon.end });
  const askBar = onAskNuvo ?? ((seed?: string) => { setChatOpen(true); if (seed) void agent.sendMessage(seed); });

  const busy = useMemo<BusyBlock[]>(
    () => toBusyBlocks(events, blocks, settings?.hidden_calendar_ids ?? [], (settings?.hidden_events ?? []).map((h) => h.key)),
    [events, blocks, settings],
  );

  // The work window, stretched to hold anything scheduled outside it so nothing
  // falls off the day-view.
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
  const vitals = useMemo(() => readVitals(now, busy, dayRead, windowStart, windowEnd), [now, busy, dayRead, windowStart, windowEnd]);
  const moves = useMemo(() => detectMoves(now, busy, dayRead, vitals, blocks, restDay), [now, busy, dayRead, vitals, blocks, restDay]);
  const offPlan = moves.slipped.length > 0;
  const call = useMemo(() => composeCall(now, vitals, dayRead, restDay, offPlan), [now, vitals, dayRead, restDay, offPlan]);
  const missedIds = useMemo(() => new Set(moves.slipped.map((s) => s.task.id)), [moves.slipped]);
  const nudges = useCoachNudges(now, busy, dayRead, blocks);

  // "Not now" tucks the primary move away until the day materially changes.
  const [dismissedPrimary, setDismissedPrimary] = useState(false);
  useEffect(() => { setDismissedPrimary(false); }, [call.chip]);
  const primary = dismissedPrimary ? null : moves.primary;
  // The window the canvas should glow as "yours" — the move's target block.
  const windowGap = (primary?.kind === "protect" || primary?.kind === "recover" ? primary.gap : null) ?? null;
  const recoverTask = primary?.taskId ? blocks.find((b) => b.id === primary.taskId) ?? null : null;

  // ── Actions on the calendar, every one reversible ────────────────────────
  const undoTask = (label: string, task: Task, apply: () => void) => {
    const snap = { do_date: task.do_date, start_time: task.start_time, status: task.status, duration_minutes: task.duration_minutes };
    apply();
    toast(label, { action: { label: "Undo", onClick: () => taskMutations.patchTask(task.id, snap) }, duration: 6000 });
  };
  const holdBlock = async (title: string, g: Gap, mins: number, label: string) => {
    const t = await taskMutations.create({ title, do_date: todayISO(now), start_time: g.start.toISOString(), duration_minutes: Math.min(mins, g.mins) });
    toast(label, { action: { label: "Undo", onClick: () => void taskMutations.trash(t) }, duration: 6000 });
  };
  const holdWindow = async (g: Gap) => { await holdBlock("Focus", g, 90, `Held ${clock(g.start)} for focus`); setDismissedPrimary(true); };
  const rollToTomorrow = (task: Task) => undoTask(`Rolled “${task.title}” to tomorrow`, task, () => taskMutations.planFor(task, tomorrowISO()));
  const dropAt = (task: Task, start: Date) => undoTask(`Moved “${task.title}” to ${clock(start)}`, task, () => taskMutations.block(task, start, task.duration_minutes ?? undefined));
  const toggleBlock = (task: Task) => (task.status === "done" ? taskMutations.uncomplete(task) : taskMutations.complete(task));
  // Fixes: take the safe own-block action when there's room; otherwise hand the
  // un-automatable part (trimming a read-only meeting) to Nuvo.
  const onFix = (m: CoachMove) => {
    if (m.kind === "no-lunch" && m.gap) return void holdBlock("Lunch", m.gap, 30, `Held a break at ${clock(m.gap.start)}`);
    if (m.kind === "no-buffer" && m.gap) return void holdBlock(`Prep: ${m.meetingTitle ?? "next"}`, m.gap, 15, `Blocked prep at ${clock(m.gap.start)}`);
    if (m.seed) return askBar(m.seed);
  };

  // ── Order my day — pull from the inbox/week and time-block today ──────────
  const proposeOrder = () => {
    const today = todayISO(now);
    const pool = allTasks.filter(
      (t) =>
        t.status !== "done" && t.status !== "trashed" && !t.start_time &&
        (t.do_date === today || (!t.do_date && (t.status === "inbox" || t.status === "backlog"))),
    );
    const hiddenEvKeys = new Set((settings?.hidden_events ?? []).map((h) => h.key));
    setOrder(
      composeWeek({
        weekStartISO: today,
        todayISO: today,
        now,
        tasks: pool,
        events: events.filter((e) => !(settings?.hidden_calendar_ids ?? []).includes(e.calendar_id) && !isEventHidden(e, hiddenEvKeys)),
        blocks,
        workStartMin: settings?.work_start_minutes ?? 480,
        workEndMin: settings?.work_end_minutes ?? 990,
        focusInitiativeIds: data.focusInitiativeIds,
        dayContexts: (data.sprint?.day_contexts ?? {}) as Record<string, DayContext>,
        workingDays: [now.getDay()],
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

  // ── Focusing / done are "moments": clear the day away, one thing only ──
  const activeTask = nowTaskId ? data.tasks.find((t) => t.id === nowTaskId) ?? null : null;
  if (activeTask && nowMoment === "focus") {
    const domain = domainById(data, activeTask.domainId);
    return (
      <Moment accent={domain?.color}>
        <div className="section-label">Focusing</div>
        <div className="mt-1.5 text-display font-medium">{activeTask.title}</div>
        <div className="mono mt-1 text-label text-muted">{activeTask.durationMins}m · everything else is quiet</div>
        <div className="mt-5 flex justify-center gap-2">
          <Btn kind="primary" onClick={() => { toggleTask(activeTask.id); setNowMoment("done", activeTask.id); }}>✓ done</Btn>
          <Btn onClick={back}>back</Btn>
        </div>
      </Moment>
    );
  }
  if (activeTask && nowMoment === "done") {
    const domain = domainById(data, activeTask.domainId);
    const initiative = initiativeById(data, activeTask.initiativeId);
    return (
      <Moment accent={domain?.color}>
        <div className="text-head font-medium" style={{ color: domain?.color }}>✓ logged as a gain</div>
        <div className="mt-1.5 text-body text-ink">{activeTask.title}</div>
        <div className="mt-2 space-y-0.5 text-caption text-muted">
          {initiative && <div>{initiative.name} — now {initiativeProgress(data, initiative)}%</div>}
          {domain && <div>{domain.name} tended · faithful again today</div>}
        </div>
        <div className="mt-4"><Btn onClick={() => setNowMoment("choose")}>what's next →</Btn></div>
      </Moment>
    );
  }

  return (
    <>
      <div className={`mx-auto w-full ${chatOpen ? "max-w-[1460px] 2xl:max-w-[1720px]" : "max-w-[1080px]"}`}>
        {order && (
          <OrderDayModal order={order} data={data} onApply={() => void applyOrder()} onClose={() => setOrder(null)} />
        )}

        <div className={chatOpen ? "xl:grid xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start xl:gap-x-10" : ""}>
          <div className="xl:col-start-1 xl:row-start-1">
            <CoachToday
              now={now}
              call={call}
              primary={primary}
              recoverTask={recoverTask}
              fixes={moves.fixes}
              slipped={moves.slipped}
              busy={busy}
              blocks={blocks}
              missedIds={missedIds}
              windowGap={windowGap}
              windowStart={windowStart}
              windowEnd={windowEnd}
              wide={!chatOpen}
              onHold={(g) => void holdWindow(g)}
              onRoll={rollToTomorrow}
              onDropAt={dropAt}
              onToggleBlock={toggleBlock}
              onFix={onFix}
              onDismissPrimary={() => setDismissedPrimary(true)}
              onOrder={proposeOrder}
              onPlan={() => openOverlay("morning")}
              onShutdown={() => openOverlay("evening")}
              onOpenDay={onOpenDay}
              nudges={nudges}
              onBlockMenu={(b, x, y) => { if (b.kind === "block" && b.taskId) setBlockCtxMenu({ b, x, y }); }}
            />
            {!chatOpen && <NuvoBar tired={tired} setTired={setTired} onAsk={askBar} />}
          </div>

          {chatOpen && (
            <div className="mt-4 xl:col-start-2 xl:row-start-1 xl:mt-0 xl:self-start xl:sticky xl:top-0">
              <NowAssistant agent={agent} tired={tired} setTired={setTired} onCollapse={() => setChatOpen(false)} />
            </div>
          )}
        </div>
      </div>

      {blockCtxMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[299]" onMouseDown={() => setBlockCtxMenu(null)} />
          <div
            className="fixed z-[300] min-w-[180px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl"
            style={{
              left: Math.min(blockCtxMenu.x, window.innerWidth - 196),
              top: Math.min(blockCtxMenu.y, window.innerHeight - 160),
            }}
          >
            {(() => {
              const task = blocks.find((t) => t.id === blockCtxMenu.b.taskId);
              if (!task) return null;
              const done = task.status === "done";
              return (
                <>
                  <button
                    className="fast flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-label hover:bg-accent-soft"
                    onClick={() => { openOverlay("task", task.id); setBlockCtxMenu(null); }}
                  >
                    <span>Open</span>
                    <span className="mono text-meta text-muted">↗</span>
                  </button>
                  <button
                    className="fast flex w-full items-center px-3 py-1.5 text-left text-label hover:bg-accent-soft"
                    onClick={() => { done ? taskMutations.uncomplete(task) : taskMutations.complete(task); setBlockCtxMenu(null); }}
                  >
                    {done ? "Mark not done" : "Mark done"}
                  </button>
                  <button
                    className="fast flex w-full items-center px-3 py-1.5 text-left text-label hover:bg-accent-soft"
                    onClick={() => { taskMutations.unblock(task); setBlockCtxMenu(null); }}
                  >
                    Unschedule
                  </button>
                  <div className="my-1 border-t border-line" />
                  <button
                    className="fast flex w-full items-center px-3 py-1.5 text-left text-label text-signal hover:bg-signal/10"
                    onClick={() => { taskMutations.trash(task); setBlockCtxMenu(null); }}
                  >
                    Delete
                  </button>
                </>
              );
            })()}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// The coach. Header + Call on top; the recommendation (moves) beside a
// familiar day-view of the schedule you act on directly.
function CoachToday({
  now, call, primary, recoverTask, fixes, slipped, busy, blocks, missedIds, windowGap,
  windowStart, windowEnd, wide,
  onHold, onRoll, onDropAt, onToggleBlock, onFix, onDismissPrimary, onOrder, onPlan, onShutdown, onOpenDay, nudges, onBlockMenu,
}: {
  now: Date;
  call: DayCall;
  primary: CoachMove | null;
  recoverTask: Task | null;
  fixes: CoachMove[];
  slipped: SlippedItem[];
  busy: BusyBlock[];
  blocks: Task[];
  missedIds: Set<string>;
  windowGap: Gap | null;
  windowStart: Date;
  windowEnd: Date;
  wide: boolean;
  onHold: (g: Gap) => void;
  onRoll: (t: Task) => void;
  onDropAt: (t: Task, start: Date) => void;
  onToggleBlock: (t: Task) => void;
  onFix: (m: CoachMove) => void;
  onDismissPrimary: () => void;
  onOrder: () => void;
  onPlan: () => void;
  onShutdown: () => void;
  onOpenDay: () => void;
  nudges: CoachNudges;
  onBlockMenu: (b: BusyBlock, x: number, y: number) => void;
}) {
  const weekday = now.toLocaleDateString([], { weekday: "long" });
  const evening = now.getHours() >= 17;
  const toneColor = call.tone === "good" ? "var(--accent)" : call.tone === "bad" ? "var(--signal)" : call.tone === "amber" ? "var(--signal)" : "var(--muted)";

  return (
    <div>
      {/* header — the live moment + the day's rituals */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="mono flex items-center gap-2 text-meta">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--signal)" }} />
          <span style={{ color: "var(--signal)" }}>{clock(now).toUpperCase()}</span>
          <span className="text-line">·</span>
          <span className="text-muted">{call.rightNow}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button onClick={onPlan} className={`fast rounded-full border px-2.5 py-1 text-label ${evening ? "border-line text-muted hover:border-accent hover:text-accent" : "border-accent/40 bg-accent-soft font-medium text-accent hover:bg-accent/15"}`}>✷ Plan</button>
          <button onClick={onShutdown} className={`fast rounded-full border px-2.5 py-1 text-label ${evening ? "border-accent/40 bg-accent-soft font-medium text-accent hover:bg-accent/15" : "border-line text-muted hover:border-accent hover:text-accent"}`}>☾ Shut down</button>
        </div>
      </div>

      {/* the Call — the posture for the whole day */}
      <div data-marquee="today-call" className="border-b border-line pb-5">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="mono rounded-full px-2 py-0.5 text-micro" style={{ color: toneColor, background: "color-mix(in srgb, " + toneColor + " 10%, transparent)", border: "0.5px solid color-mix(in srgb, " + toneColor + " 30%, transparent)" }}>{call.chip}</span>
          <span className="mono text-micro text-muted">{weekday}</span>
        </div>
        <h1 className="text-display masthead max-w-[680px] leading-[1.18]">{call.headline}</h1>
      </div>

      {/* recommendation | schedule */}
      <div className={`mt-6 ${wide ? "lg:grid lg:grid-cols-[minmax(0,1fr)_268px] lg:gap-x-8" : ""}`}>
        <div className="min-w-0">
          {primary && (
            <div data-marquee="today-move">
              <PrimaryMove
                move={primary}
                recoverTask={recoverTask}
                onHold={onHold}
                onRoll={onRoll}
                onDropAt={onDropAt}
                onDismiss={onDismissPrimary}
                onOrder={onOrder}
              />
            </div>
          )}

          {fixes.length > 0 && (
            <div className={primary ? "mt-6" : ""}>
              <div className="section-label mb-2.5">Worth a look</div>
              <div className="space-y-3">
                {fixes.map((f, i) => {
                  const verb = f.kind === "no-lunch" && f.gap ? "Hold a break" : f.kind === "no-buffer" && f.gap ? "Block prep" : f.seed ? "Ask Nuvo" : null;
                  return (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--signal)" }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-body text-ink">{f.title}</div>
                        <div className="text-caption text-muted">{f.reason}</div>
                      </div>
                      {verb && (
                        <button onClick={() => onFix(f)} className="fast shrink-0 rounded-full border border-line px-2.5 py-1 text-label text-muted hover:border-accent hover:text-accent">{verb}</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {slipped.length > 0 && (
            <div data-marquee="today-slipped" className="mt-6">
              <div className="section-label mb-2.5">Slipped today · {slipped.length}</div>
              <div className="space-y-1.5">
                {slipped.map((s) => (
                  <div key={s.task.id} className="group flex items-center gap-2.5">
                    <button
                      onClick={() => onToggleBlock(s.task)}
                      title="Mark done"
                      aria-label="Mark done"
                      className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 hover:scale-105"
                      style={{ borderColor: "var(--line-strong)" }}
                    >
                      <span className="text-[10px] leading-none opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--muted)" }}>✓</span>
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body text-ink">{s.task.title}</div>
                      <div className="mono text-meta text-muted">{s.reason}</div>
                    </div>
                    <button onClick={() => onRoll(s.task)} className="fast shrink-0 rounded-full border border-line px-2.5 py-1 text-label text-muted hover:border-accent hover:text-accent">tomorrow</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!primary && fixes.length === 0 && slipped.length === 0 && (
            <div className="rounded-lg border border-line bg-surface-2 p-5 text-body text-muted">
              Nothing to flag — the day reads clean. Open the schedule to shape it.
              <div className="mt-3"><Btn onClick={onOpenDay}>open day planner</Btn></div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <button onClick={onOpenDay} className="fast mono text-meta text-muted hover:text-accent">open full schedule →</button>
            {nudges.supported && (
              <button onClick={() => void nudges.toggle()} className="fast mono text-meta hover:text-accent" style={{ color: nudges.enabled ? "var(--accent)" : "var(--muted)" }}>
                {nudges.enabled ? "✓ nudging when plans slip" : "🔔 nudge me when plans slip"}
              </button>
            )}
          </div>
        </div>

        <div className="mt-7 lg:mt-0">
          <DayColumn
            now={now}
            busy={busy}
            blocks={blocks}
            missedIds={missedIds}
            windowGap={windowGap}
            windowStart={windowStart}
            windowEnd={windowEnd}
            onToggleBlock={onToggleBlock}
            onBlockMenu={onBlockMenu}
          />
        </div>
      </div>
    </div>
  );
}

// The hero recommendation — one move, with verbs that act on the calendar.
function PrimaryMove({
  move, recoverTask, onHold, onRoll, onDropAt, onDismiss, onOrder,
}: {
  move: CoachMove;
  recoverTask: Task | null;
  onHold: (g: Gap) => void;
  onRoll: (t: Task) => void;
  onDropAt: (t: Task, start: Date) => void;
  onDismiss: () => void;
  onOrder: () => void;
}) {
  const glyph = move.kind === "recover" ? "↻" : move.kind === "runway" ? "→" : "▣";
  return (
    <div className="rise rounded-lg border glass-card p-4" style={{ borderColor: "var(--accent)", borderWidth: 1.5 }}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-head" style={{ color: "var(--accent)" }}>{glyph}</span>
        <div className="min-w-0 flex-1">
          <div className="text-display font-medium leading-snug">{move.title}</div>
          <div className="mt-1 text-caption leading-relaxed text-muted">{move.reason}</div>

          <div className="mt-4 flex flex-wrap gap-2">
            {move.kind === "protect" && move.gap && (
              <>
                <Btn kind="primary" onClick={() => onHold(move.gap!)}>Hold the window</Btn>
                <Btn onClick={onDismiss}>Not now</Btn>
              </>
            )}
            {move.kind === "recover" && recoverTask && (
              <>
                {move.gap && <Btn kind="primary" onClick={() => onDropAt(recoverTask, move.gap!.start)}>Drop it at {clock(move.gap.start)}</Btn>}
                <Btn kind={move.gap ? undefined : "primary"} onClick={() => onRoll(recoverTask)}>Roll to tomorrow</Btn>
                <Btn onClick={onDismiss}>Leave it</Btn>
              </>
            )}
            {move.kind === "runway" && (
              <>
                <Btn kind="primary" onClick={onOrder}>Plan my day</Btn>
                <Btn onClick={onDismiss}>Not now</Btn>
              </>
            )}
          </div>
        </div>
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
// The day-view — the same modality as the Schedule, so the coach's words map
// to space. Events read as glass; your own blocks carry a check you can tap;
// the move's target window glows as "yours"; what slipped greys out; the live
// now-line runs across it.
function DayColumn({
  now, busy, blocks, missedIds, windowGap, windowStart, windowEnd, onToggleBlock, onBlockMenu,
}: {
  now: Date;
  busy: BusyBlock[];
  blocks: Task[];
  missedIds: Set<string>;
  windowGap: Gap | null;
  windowStart: Date;
  windowEnd: Date;
  onToggleBlock: (t: Task) => void;
  onBlockMenu: (b: BusyBlock, x: number, y: number) => void;
}) {
  const winMins = Math.max(60, (windowEnd.getTime() - windowStart.getTime()) / 60_000);
  const pxPerMin = Math.min(1.0, Math.max(0.52, 520 / winMins));
  const H = winMins * pxPerMin;
  const y = (d: Date) => ((d.getTime() - windowStart.getTime()) / 60_000) * pxPerMin;

  const hours: Date[] = [];
  const firstHour = new Date(windowStart);
  if (firstHour.getMinutes() > 0) firstHour.setHours(firstHour.getHours() + 1, 0, 0, 0);
  for (let t = new Date(firstHour); t <= windowEnd; t = new Date(t.getTime() + 3600_000)) hours.push(new Date(t));

  const nowY = y(now);
  const inWindow = now >= windowStart && now <= windowEnd;
  const laid = layoutColumns(busy.filter((b) => b.end > windowStart && b.start < windowEnd));

  return (
    <div className="min-w-0">
      <div className="section-label mb-2">Today</div>
      <div className="relative pl-10" style={{ height: H }}>
        {hours.map((hr) => (
          <div key={hr.getTime()} className="pointer-events-none absolute left-0 right-0 flex items-center" style={{ top: y(hr) }}>
            <span className="mono absolute left-0 -translate-y-1/2 text-micro text-line">
              {hr.toLocaleTimeString([], { hour: "numeric" }).replace(" ", "")}
            </span>
            <div className="ml-8 h-px flex-1" style={{ background: "color-mix(in srgb, var(--line) 60%, transparent)" }} />
          </div>
        ))}

        <div className="absolute bottom-0 top-0 w-px" style={{ left: 34, background: "var(--line)" }} />

        {/* the move's target window — drawn as "yours" */}
        {windowGap && (
          <div
            className="absolute rounded-md"
            style={{
              top: y(windowGap.start), height: Math.max(18, windowGap.mins * pxPerMin),
              left: 28, right: 0,
              background: "var(--accent-soft)",
              border: "1px dashed color-mix(in srgb, var(--accent) 45%, transparent)",
            }}
          >
            <span className="mono absolute right-2 top-1 text-micro text-accent">your window · {fmtMins(windowGap.mins)}</span>
          </div>
        )}

        {laid.map(({ b, col, cols }, i) => {
          const top = Math.max(0, y(b.start));
          const height = Math.max(16, y(b.end) - y(b.start));
          const past = b.end <= now;
          const ongoing = b.start <= now && now < b.end;
          const isBlock = b.kind === "block";
          const missed = !!b.taskId && missedIds.has(b.taskId);
          const bar = ongoing ? "var(--signal)" : isBlock ? "var(--accent)" : "var(--muted)";
          const left = `calc(28px + (100% - 28px) * ${col} / ${cols})`;
          const width = `calc((100% - 28px) / ${cols} - 3px)`;
          const task = b.taskId ? blocks.find((t) => t.id === b.taskId) ?? null : null;
          return (
            <div
              key={i}
              className="fast group absolute overflow-hidden rounded-md py-1 pl-2 pr-1.5 backdrop-blur-[3px]"
              style={{
                top, height, left, width,
                background: `color-mix(in srgb, ${bar} ${ongoing ? 18 : 13}%, transparent)`,
                borderLeft: `3px solid ${bar}`,
                opacity: b.done ? 0.5 : past && !ongoing && !missed ? 0.5 : 1,
                boxShadow: ongoing ? "var(--shadow-2)" : "none",
                zIndex: ongoing ? 5 : 1,
              }}
              onContextMenu={b.taskId ? (e) => { e.preventDefault(); onBlockMenu(b, e.clientX, e.clientY); } : undefined}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <div className="truncate text-label font-medium leading-tight" style={{ textDecoration: b.done ? "line-through" : undefined }}>
                    {b.title}
                  </div>
                  {height > 28 && cols === 1 && (
                    <div className="mono text-micro" style={{ color: missed ? "var(--signal)" : "var(--muted)" }}>
                      {missed ? "missed" : clock(b.start)}
                    </div>
                  )}
                </div>
                {isBlock && task && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleBlock(task); }}
                    title={b.done ? "Mark not done" : "Mark done"}
                    aria-label={b.done ? "Mark not done" : "Mark done"}
                    className="fast flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                    style={{ borderColor: bar, background: b.done ? bar : "transparent", color: "#fff" }}
                  >
                    <span className="text-[9px] leading-none" style={{ opacity: b.done ? 1 : 0 }}>✓</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {inWindow && (
          <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center" style={{ top: nowY }}>
            <span className="absolute h-2 w-2 -translate-y-1/2 rounded-full" style={{ left: 30, background: "var(--signal)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--signal) 22%, transparent)" }} />
            <div className="ml-[38px] h-px flex-1" style={{ background: "var(--signal)" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// Collapsed launcher — a single calm row: open Nuvo, or fire a common ask.
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
    <div className="mt-6 flex flex-wrap items-center gap-1.5">
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

// The expanded panel — the live conversation. Free text routes to the agent.
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
// "Order my day" — the proposed timeline, reviewed before it lands.
function OrderDayModal({
  order, data, onApply, onClose,
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
