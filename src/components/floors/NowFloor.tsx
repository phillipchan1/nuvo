// Now — the intelligent recommendation, set inside the real shape of the day.
// A four-domain operator can't hold "what am I in, what's next, where's open,
// am I going quiet somewhere" in their head — so the Now view shows it: a
// proportional spine of today on the left, the ranked Right Now anchored to
// the next open block on the right, and a domain-balance read framed as Gain.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { useVertical } from "../../hooks/useVertical";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks } from "../../hooks/useTasks";
import { useSettings } from "../../hooks/useSettings";
import { useWorkingDays } from "../../hooks/useWorkingDays";
import { useAgent } from "../../hooks/useAgent";
import { endOf, todayISO } from "../../lib/dates";
import { faithfulness, initiativeProgress, type Domain } from "../../lib/vertical";
import { fmtMins, rankNow, readDay, type BusyBlock, type DayRead, type Gap, type NowContext } from "../../lib/now";
import { composeBrief, type Brief } from "../../lib/brief";
import type { AgentMessage } from "../../lib/agentTypes";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { Btn } from "../ui";

const NAME = "Phil";

// Nuvo collapses by default so the day owns the hero space; expands to a rail
// only when you actually want to talk. Choice persists.
const CHAT_KEY = "nuvo.today.chat";
const readChatOpen = (): boolean => {
  try { return localStorage.getItem(CHAT_KEY) === "1"; } catch { return false; }
};

export default function NowFloor({ onOpenDay }: { onOpenDay: () => void }) {
  const { data, toggleTask } = useVertical();
  const { settings } = useSettings();
  const [workingDays] = useWorkingDays();
  const { nav, setNowMoment, back } = useAppNavigation();
  const { nowMoment, nowTaskId } = nav;

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

  // How you're actually running today — set by talking to Nuvo. Re-voices the
  // brief and re-ranks the day toward low-friction work when you're spent.
  const [tired, setTired] = useState(false);
  const [chatOpen, setChatOpen] = useState(readChatOpen);
  useEffect(() => {
    try { localStorage.setItem(CHAT_KEY, chatOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [chatOpen]);
  const agent = useAgent({ start: horizon.start, end: horizon.end });

  const busy = useMemo<BusyBlock[]>(() => {
    // respect the calendars the user has toggled off in settings
    const hidden = new Set(settings?.hidden_calendar_ids ?? []);
    return [
      ...events
        .filter((e) => e.busy && !e.all_day && !hidden.has(e.calendar_id))
        .map((e): BusyBlock => ({ title: e.title, start: new Date(e.start_at), end: new Date(e.end_at), kind: "event", location: e.location })),
      ...blocks
        .filter((t) => t.start_time)
        .map((t): BusyBlock => ({
          title: t.title,
          start: new Date(t.start_time!),
          end: endOf({ start_time: t.start_time!, duration_minutes: t.duration_minutes }),
          kind: "block",
          done: t.status === "done",
        })),
    ];
  }, [events, blocks, settings]);

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

  const ctx = useMemo<NowContext>(() => {
    const clockLabel = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const gapMins = activeGap?.mins ?? (now.getHours() >= 18 ? 90 : 120);
    const gapLabel = dayRead.current
      ? `in “${dayRead.current.title}” for ${Math.max(1, Math.round((dayRead.current.end.getTime() - now.getTime()) / 60_000))}m more`
      : dayRead.next
        ? `${Math.max(1, Math.round((dayRead.next.start.getTime() - now.getTime()) / 60_000))}m till ${dayRead.next.title}`
        : "open horizon — nothing scheduled";
    return { gapMins, deepWindow: dayRead.deepWindow, clockLabel, gapLabel, tired };
  }, [now, activeGap, dayRead, tired]);

  const suggestions = useMemo(() => rankNow(data, ctx), [data, ctx]);
  const [idx, setIdx] = useState(0);
  const top = suggestions[Math.min(idx, Math.max(0, suggestions.length - 1))] ?? null;
  const active = useMemo(
    () => (nowTaskId ? suggestions.find((s) => s.task.id === nowTaskId) ?? null : null),
    [nowTaskId, suggestions],
  );
  const brief = useMemo(() => composeBrief({ now, name: NAME, dayRead, top, tired, restDay }), [now, dayRead, top, tired, restDay]);

  // ── Focusing / done are "moments": clear the day away, one thing only ──
  if (active && nowMoment === "focus") {
    return (
      <Moment accent={active.domain?.color}>
        <div className="section-label">Focusing</div>
        <div className="mt-1.5 text-[20px] font-medium">{active.task.title}</div>
        <div className="mono mt-1 text-[11px] text-muted">{active.task.durationMins}m · everything else is quiet</div>
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
        <div className="text-[15px] font-medium" style={{ color: active.domain?.color }}>✓ logged as a gain</div>
        <div className="mt-1.5 text-[13px] text-ink">{active.task.title}</div>
        <div className="mt-2 space-y-0.5 text-[12px] text-muted">
          {active.initiative && <div>{active.initiative.name} — now {initiativeProgress(data, active.initiative)}%</div>}
          {active.domain && <div>{active.domain.name} tended · faithful again today</div>}
        </div>
        <div className="mt-4"><Btn onClick={() => { setNowMoment("choose"); setIdx(0); }}>what's next →</Btn></div>
      </Moment>
    );
  }

  return (
    <div className={`mx-auto w-full ${chatOpen ? "max-w-[1460px] 2xl:max-w-[1720px]" : "max-w-[1080px]"}`}>
      {/* Collapsed (default): one centered column, the day as the hero.
          Expanded: the chat earns a sticky right rail and reclaims the margin. */}
      <div className={chatOpen ? "xl:grid xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start xl:gap-x-10" : ""}>
        <div className="xl:col-start-1 xl:row-start-1">
          <NowBrief now={now} dayRead={dayRead} brief={brief} tired={tired} restDay={restDay} />
          {!chatOpen && (
            <NuvoBar agent={agent} tired={tired} setTired={setTired} onOpen={() => setChatOpen(true)} />
          )}
        </div>

        {chatOpen && (
          <div className="mt-4 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:mt-0 xl:self-start xl:sticky xl:top-0">
            <NowAssistant agent={agent} tired={tired} setTired={setTired} onCollapse={() => setChatOpen(false)} />
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-x-9 gap-y-7 md:grid-cols-[248px_1fr] xl:col-start-1 xl:row-start-2">
          <DaySpine now={now} busy={busy} gaps={dayRead.gaps} activeGap={activeGap} windowStart={windowStart} windowEnd={windowEnd} />

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

          {restDay && !showPicks ? (
            // The brief above is already Nuvo's rest message — so here we add
            // nothing that repeats it, only a quiet way in if you want one.
            suggestions.length > 0 ? (
              <div className={dayRead.current || dayRead.upcoming.length ? "mt-6" : "mt-1"}>
                <button
                  onClick={() => setShowPicks(true)}
                  className="fast text-[12.5px] text-muted underline-offset-2 hover:text-accent hover:underline"
                >
                  Want to get a jump on something? →
                </button>
              </div>
            ) : null
          ) : top ? (
            <div className={dayRead.current || dayRead.upcoming.length ? "mt-6" : ""}>
              <div className="section-label mb-2">
                {dayRead.current
                  ? activeGap
                    ? `When you're free · ${activeGap.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${fmtMins(activeGap.mins)}`
                    : "Line up next"
                  : restDay
                    ? "If you want to pick something up"
                    : "Right now"}
              </div>
              <div className="rise rounded-lg border bg-surface p-4" style={{ borderColor: top.domain?.color, borderWidth: 1.5 }}>
                <div className="text-[19px] font-medium leading-snug">{top.task.title}</div>
                <div className="mono mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                  {top.domain && <span style={{ color: top.domain.color }}>{top.domain.name}</span>}
                  {top.initiative && <><span className="text-line">·</span><span className="text-muted">{top.initiative.name}</span></>}
                </div>

                {!dayRead.current && <GapAnchor activeGap={activeGap} current={dayRead.current} accent={top.domain?.color} />}

                <div className="mt-3 space-y-1.5">
                  {top.reasons.map((r, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-[12px] text-muted">
                      <span className="w-3 text-center" style={{ color: top.domain?.color }}>{r.glyph}</span>
                      {r.text}
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {dayRead.current ? (
                    <>
                      <Btn kind="primary" onClick={onOpenDay}>
                        {activeGap ? `plan for ${activeGap.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} →` : "open day planner"}
                      </Btn>
                      <Btn onClick={() => top && setNowMoment("focus", top.task.id)}>start now</Btn>
                      <Btn onClick={() => setIdx((i) => (i + 1) % suggestions.length)}>not this</Btn>
                    </>
                  ) : (
                    <>
                      <Btn kind="primary" onClick={() => top && setNowMoment("focus", top.task.id)}>▶ start · {top.task.durationMins}m</Btn>
                      <Btn onClick={() => setIdx((i) => (i + 1) % suggestions.length)}>not now</Btn>
                      <Btn onClick={onOpenDay}>open day planner</Btn>
                    </>
                  )}
                </div>
              </div>

              {suggestions.length > 1 && (
                <div className="mt-3.5">
                  <div className="section-label mb-1.5">Or, also ready</div>
                  <div className="space-y-1">
                    {suggestions.map((s, i) =>
                      i === idx ? null : (
                        <button
                          key={s.task.id}
                          onClick={() => setIdx(i)}
                          className="fast group flex w-full items-center gap-2 text-left text-[12.5px] text-muted hover:text-ink"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.domain?.color ?? "var(--line-strong)" }} />
                          <span className="truncate group-hover:underline">{s.task.title}</span>
                          <span className="mono shrink-0 text-[10px] text-line">{s.task.durationMins}m</span>
                        </button>
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            !dayRead.current && (
              <div className="rounded-lg border border-line bg-surface-2 p-6 text-center text-[13px] text-muted">
                Nothing ready — inbox zero.
                <div className="mt-3"><Btn onClick={onOpenDay}>open day planner</Btn></div>
              </div>
            )
          )}

          <DomainBalance domains={data.domains} restDay={restDay} />
        </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// The brief — Nuvo talking to you. A first-person read of the whole day, the
// scannable stats underneath, and a composer so you can just say what you need.
function NowBrief({
  now, dayRead, brief, tired, restDay,
}: {
  now: Date;
  dayRead: DayRead;
  brief: Brief;
  tired: boolean;
  restDay: boolean;
}) {
  const weekday = now.toLocaleDateString([], { weekday: "short" });
  const clock = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const chips: { glyph: string; text: string; tone?: "accent" | "muted" }[] = [];
  // On a day off, open time isn't a number to fill — so we don't headline it.
  if (restDay) chips.push({ glyph: "—", text: "day off", tone: "muted" });
  else if (dayRead.openMins > 0) chips.push({ glyph: "⏱", text: `${fmtMins(dayRead.openMins)} open`, tone: "accent" });
  chips.push({ glyph: "◷", text: dayRead.remaining === 0 ? "no commitments left" : `${dayRead.remaining} commitment${dayRead.remaining > 1 ? "s" : ""} left` });
  if (!restDay && dayRead.deepWindow && dayRead.deepEndsLabel && !dayRead.current && !tired) chips.push({ glyph: "◆", text: `deep focus till ${dayRead.deepEndsLabel}` });
  if (tired) chips.push({ glyph: "☾", text: "low-energy mode" });

  return (
    <div className="border-b border-line pb-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="wordmark wordmark-grad text-[13px]">Nuvo</span>
          <span className="mono text-[10px] text-muted">your day</span>
        </div>
        <div className="mono text-[12px] text-muted">{weekday} · {clock}</div>
      </div>

      <h1 className="mt-2 text-[18px] font-semibold tracking-tight">{brief.greeting}</h1>
      <p className="mt-1 max-w-[680px] text-[14px] leading-relaxed text-ink/90">{brief.body}</p>

      <div className="mono mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px]">
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
function NuvoBar({
  agent, tired, setTired, onOpen,
}: {
  agent: ReturnType<typeof useAgent>;
  tired: boolean;
  setTired: (v: boolean) => void;
  onOpen: () => void;
}) {
  const ask = (text: string) => { onOpen(); void agent.sendMessage(text); };
  const pill = "fast rounded-full border px-2.5 py-1 text-[11px]";
  const ghost = `${pill} border-line text-muted hover:border-accent hover:text-accent`;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <button onClick={onOpen} className={`${pill} flex items-center gap-1.5 border-accent/40 bg-accent-soft font-medium text-accent hover:bg-accent/15`}>
        <span>✦</span> Ask Nuvo
      </button>
      <button onClick={() => setTired(!tired)} className={ghost}>
        {tired ? "↑ back to full energy" : "☾ I'm wiped — lighten today"}
      </button>
      <button onClick={() => ask("What should I prep for my next meeting? Give me a quick preread.")} className={ghost}>what should I prep?</button>
      <button onClick={() => ask("I'm short on time — push my non-urgent afternoon tasks to tomorrow.")} className={ghost}>move my afternoon</button>
      <button onClick={() => ask("Where are my open blocks for the rest of today?")} className={ghost}>what's open later?</button>
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
        <button onClick={onCollapse} title="Collapse" className="fast mono text-[10px] text-muted hover:text-ink">collapse ›</button>
      </div>

      {messages.length > 0 ? (
        <div className="mb-2.5 max-h-[260px] space-y-2.5 overflow-y-auto rounded-lg border border-line bg-surface p-3 xl:max-h-[calc(100vh-340px)]">
          {messages.map((m) => <Bubble key={m.id} message={m} />)}
          {loading && (
            <div className="agent-bubble agent-bubble-assistant w-fit">
              <span className="mono shimmer text-[11px]">Nuvo's on it…</span>
            </div>
          )}
        </div>
      ) : (
        <p className="mb-2.5 text-[12px] leading-relaxed text-muted">
          I've read your day. Ask me to move things, prep you for what's next, or lighten the load.
        </p>
      )}
      {error && !loading && (
        <div className="mb-2 rounded-md bg-signal-soft px-2.5 py-1.5 text-[11px] text-signal">{error}</div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.label}
            onClick={c.on}
            disabled={loading}
            className="fast rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="fast mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
        <span className="mono shrink-0 text-[10px] text-accent">›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(input); } }}
          placeholder="Tell Nuvo how you're running, or what to move…"
          disabled={loading}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted disabled:opacity-50"
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          className="fast shrink-0 rounded-md border border-accent bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-30"
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
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed">{message.content}</p>
        ) : (
          <div className="agent-markdown text-[12.5px] leading-relaxed"><ReactMarkdown>{message.content}</ReactMarkdown></div>
        )}
        {message.actions && message.actions.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-line/50 pt-2">
            {message.actions.map((a) => (
              <li key={a.summary} className="mono text-[10px] text-muted">✓ {a.summary}</li>
            ))}
          </ul>
        )}
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
    <div className="rise rounded-lg border bg-surface p-4" style={{ borderColor: "var(--signal)", borderWidth: 1.5 }}>
      <div className="flex items-center justify-between gap-3">
        <span className="section-label flex items-center gap-2" style={{ color: "var(--signal)" }}>
          <span className="pulse-glow inline-block h-2 w-2 rounded-full" style={{ background: "var(--signal)" }} />
          In a meeting
        </span>
        <span className="mono text-[12px]" style={{ color: "var(--signal)" }}>{fmtMins(minsLeft)} left</span>
      </div>
      <div className="mt-1.5 text-[19px] font-medium leading-snug">{current.title}</div>
      <div className="mono mt-0.5 text-[11px] text-muted">
        {range}{current.location ? ` · ${current.location}` : ""}
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div className="h-full rounded-full" style={{ width: `${(elapsed / total) * 100}%`, background: "var(--signal)" }} />
      </div>
      {overlapping.length > 0 && (
        <div className="mono mt-3 flex items-start gap-1.5 text-[10.5px]" style={{ color: "var(--signal)" }}>
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
            <div key={i} className="flex items-baseline gap-2.5 text-[12.5px]">
              <span className="mono w-16 shrink-0 text-right text-[10.5px]" style={{ color: soon ? "var(--signal)" : "var(--muted)" }}>
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
  now, busy, activeGap, windowStart, windowEnd,
}: {
  now: Date; busy: BusyBlock[]; gaps: Gap[]; activeGap: Gap | null; windowStart: Date; windowEnd: Date;
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
      <div className="section-label mb-2">Today</div>
      <div className="relative pl-11" style={{ height: H }}>
        {/* hour ticks + labels */}
        {hours.map((hr) => (
          <div key={hr.getTime()} className="pointer-events-none absolute left-0 right-0 flex items-center" style={{ top: y(hr) }}>
            <span className="mono absolute left-0 -translate-y-1/2 text-[9.5px] text-line">
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
            <span className="mono absolute right-2 top-1 text-[9.5px] text-accent">open · {fmtMins(activeGap.mins)}</span>
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
              className="fast absolute overflow-hidden rounded-md pl-2 pr-1.5 py-1"
              style={{
                top, height, left, width,
                background: ongoing ? "color-mix(in srgb, var(--signal) 10%, var(--surface))" : "var(--surface)",
                border: `1px solid ${ongoing ? "color-mix(in srgb, var(--signal) 40%, var(--line))" : "var(--line)"}`,
                borderLeft: `3px solid ${bar}`,
                opacity: past && !ongoing ? 0.42 : 1,
                boxShadow: ongoing ? "var(--shadow-1)" : "none",
                zIndex: ongoing ? 5 : 1,
              }}
            >
              <div className="truncate text-[11px] font-medium leading-tight" style={{ textDecoration: b.done ? "line-through" : undefined }}>
                {b.title}
              </div>
              {height > 30 && cols === 1 && (
                <div className="mono text-[9px] text-muted">
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
    <div className="mono mt-2 flex items-center gap-1.5 text-[10.5px]" style={{ color: accent ?? "var(--accent)" }}>
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
                  <span className="truncate text-[11.5px]">{d.name}</span>
                  <span className="mono shrink-0 text-[9px] text-muted">{f.note}</span>
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
        <div className="mono mt-3 flex items-center gap-1.5 text-[10.5px] text-muted">
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
      <div className="moment rounded-lg border bg-surface p-7 text-center" style={{ borderColor: accent ?? "var(--accent)", borderWidth: 1.5 }}>
        {children}
      </div>
    </div>
  );
}
