import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { todayISO } from "../lib/dates";
import type { ExternalEvent, Task } from "../lib/types";
import { useDayTasks, useInboxTasks, useRolloverGuard, useScheduledTasks, useTaskMutations } from "../hooks/useTasks";
import { useCalendarAccounts, useExternalEventMutations, useExternalEvents, useLabels } from "../hooks/useCalendar";
import { useRealtime } from "../hooks/useRealtime";
import { useSettings } from "../hooks/useSettings";
import LeftRail, { type RailTab } from "./LeftRail";
import CalendarPane, { type CalView } from "./CalendarPane";
import CommandBar, { type Command } from "./CommandBar";
import { EventSlideOver, TaskSlideOver } from "./SlideOver";
import SettingsModal from "./SettingsModal";
import ReconnectBanner from "./ReconnectBanner";
import { EveningShutdown, MorningPlan } from "./Rituals";
import { Keycap } from "./ui";

export default function Planner() {
  const railRef = useRef<HTMLDivElement | null>(null);

  const [tab, setTab] = useState<RailTab>("today");
  const [view, setView] = useState<CalView>(() =>
    window.innerWidth < 1100 ? "timeGridDay" : "timeGridWeek",
  );
  const [range, setRange] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    return {
      start: new Date(now.getTime() - 7 * 86400_000).toISOString(),
      end: new Date(now.getTime() + 7 * 86400_000).toISOString(),
    };
  });
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [showCmd, setShowCmd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMorning, setShowMorning] = useState(false);
  const [showEvening, setShowEvening] = useState(false);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const today = todayISO(now);
  const { settings, update: updateSettings } = useSettings();
  const { data: inbox = [] } = useInboxTasks();
  const { data: todayTasks = [] } = useDayTasks(today);
  const { data: scheduled = [] } = useScheduledTasks(range.start, range.end);
  const { data: events = [] } = useExternalEvents(range.start, range.end);
  const { data: accounts = [] } = useCalendarAccounts();
  const { labels } = useLabels();
  const mutations = useTaskMutations();
  const eventMutations = useExternalEventMutations();

  useRealtime(true);

  // Defensive client-side rollover on first open of a new day
  const rollover = useRolloverGuard(settings?.last_rollover_date);
  const settingsLoaded = Boolean(settings);
  useEffect(() => {
    if (!settingsLoaded) return;
    void rollover();
    const onVisible = () => document.visibilityState === "visible" && void rollover();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, today]);

  // Morning plan auto-prompt on first open of the day
  useEffect(() => {
    if (!settingsLoaded) return;
    const key = `nuvo-morning-${today}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "1");
      setShowMorning(true);
    }
  }, [settingsLoaded, today]);

  // ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCmd((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const allKnownTasks = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of [...inbox, ...todayTasks, ...scheduled]) map.set(t.id, t);
    return map;
  }, [inbox, todayTasks, scheduled]);

  const openTask = openTaskId ? (allKnownTasks.get(openTaskId) ?? null) : null;
  const openEvent: ExternalEvent | null = openEventId
    ? (events.find((e) => e.id === openEventId) ?? null)
    : null;
  const openEventAccount = openEvent ? accounts.find((a) => a.id === openEvent.account_id) : null;

  const anyModalOpen = showCmd || showSettings || showMorning || showEvening || Boolean(openTask) || Boolean(openEvent);

  const commands: Command[] = [
    { id: "today", title: "Go to today", run: () => setTab("today") },
    { id: "inbox", title: "Go to inbox", run: () => setTab("inbox") },
    { id: "plan", title: "Plan my day (morning ritual)", run: () => setShowMorning(true) },
    { id: "shutdown", title: "Evening shutdown", run: () => setShowEvening(true) },
    { id: "view-day", title: "Calendar: day view", run: () => setView("timeGridDay") },
    { id: "view-week", title: "Calendar: week view", run: () => setView("timeGridWeek") },
    { id: "connect", title: "Connect calendar…", run: () => setShowSettings(true) },
    { id: "label", title: "New label…", run: () => setShowSettings(true) },
    { id: "settings", title: "Settings", run: () => setShowSettings(true) },
    {
      id: "theme",
      title: "Toggle dark mode",
      run: () =>
        updateSettings({
          theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
        }),
    },
  ];

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* Header */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <span className="text-[14px] font-semibold tracking-tight">Nuvo</span>
        <span className="mono text-[11px] text-muted">{format(now, "EEE MMM d")}</span>
        <span className="mono border border-signal px-1 text-[10px] leading-snug text-signal">
          {format(now, "HH:mm")}
        </span>
        <div className="flex-1" />
        <button onClick={() => setShowMorning(true)} className="fast border border-line px-2 py-1 text-[11px] font-medium text-muted hover:text-ink">
          Plan
        </button>
        <button onClick={() => setShowEvening(true)} className="fast border border-line px-2 py-1 text-[11px] font-medium text-muted hover:text-ink">
          Shutdown
        </button>
        <div className="flex border border-line">
          {(["timeGridDay", "timeGridWeek"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`fast px-2 py-1 text-[11px] font-medium ${
                view === v ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {v === "timeGridDay" ? "Day" : "Week"}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCmd(true)} className="flex items-center gap-1.5 text-[11px] text-muted hover:text-ink">
          <Keycap>⌘K</Keycap>
        </button>
        <button
          onClick={() => setShowSettings(true)}
          title="Settings"
          className="fast text-[15px] text-muted hover:text-ink"
        >
          ⚙
        </button>
      </header>

      <ReconnectBanner accounts={accounts} />

      {/* Main two-pane surface */}
      <div className="relative flex min-h-0 flex-1">
        <LeftRail
          tab={tab}
          setTab={setTab}
          inbox={inbox}
          today={todayTasks}
          labels={labels}
          mutations={mutations}
          onOpenTask={(t) => setOpenTaskId(t.id)}
          hotkeysEnabled={!anyModalOpen}
          now={now}
          railRef={railRef}
        />
        <CalendarPane
          view={view}
          tasks={scheduled}
          events={events}
          accounts={accounts}
          settings={settings}
          now={now}
          mutations={mutations}
          eventMutations={eventMutations}
          onOpenTask={(t) => setOpenTaskId(t.id)}
          onOpenEvent={(e) => setOpenEventId(e.id)}
          onRangeChange={(start, end) => setRange({ start, end })}
          railRef={railRef}
        />

        {openTask && (
          <TaskSlideOver
            task={openTask}
            labels={labels}
            mutations={mutations}
            onClose={() => setOpenTaskId(null)}
          />
        )}
        {openEvent && !openTask && (
          <EventSlideOver
            event={openEvent}
            editable={openEventAccount?.provider === "google"}
            eventMutations={eventMutations}
            onClose={() => setOpenEventId(null)}
          />
        )}
      </div>

      {showCmd && (
        <CommandBar
          labels={labels}
          commands={commands}
          onCreate={mutations.create}
          onClose={() => setShowCmd(false)}
        />
      )}
      {showSettings && (
        <SettingsModal
          settings={settings}
          updateSettings={updateSettings}
          accounts={accounts}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showMorning && (
        <MorningPlan
          inbox={inbox}
          todayCount={todayTasks.filter((t) => t.status !== "done").length}
          mutations={mutations}
          onClose={() => setShowMorning(false)}
        />
      )}
      {showEvening && (
        <EveningShutdown todayTasks={todayTasks} mutations={mutations} onClose={() => setShowEvening(false)} />
      )}
    </div>
  );
}
