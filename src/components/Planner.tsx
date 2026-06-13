import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { todayISO } from "../lib/dates";
import type { ExternalEvent, Slot, Task } from "../lib/types";
import { useDayTasks, useInboxTasks, useRolloverGuard, useScheduledTasks, useSprintTasks, useTaskMutations } from "../hooks/useTasks";
import { useCalendarAccounts, useExternalEventMutations, useExternalEvents, useLabels } from "../hooks/useCalendar";
import { useSlots, useSlotTasks, useSlotMutations } from "../hooks/useSlots";
import { useRecurrences, useRecurrenceMutations } from "../hooks/useRecurrence";
import { useRealtime } from "../hooks/useRealtime";
import { useSettings } from "../hooks/useSettings";
import { useVertical } from "../hooks/useVertical";
import { taskDomainColor } from "../lib/vertical";
import { deriveSlotTitle } from "../lib/slots";
import LeftRail, { type RailTab } from "./LeftRail";
import type { FlowName } from "./Spine";
import CalendarPane, { type CalView } from "./CalendarPane";
import CommandBar, { type Command } from "./CommandBar";
import { EventPopover, SlotPopover, TaskPopover } from "./SlideOver";
import SettingsModal from "./SettingsModal";
import ReconnectBanner from "./ReconnectBanner";
import { EveningShutdown, MorningPlan } from "./Rituals";
import AgentSidebar, { readAgentOpen, writeAgentOpen } from "./AgentSidebar";
import { useAgent } from "../hooks/useAgent";
import { Keycap } from "./ui";

export default function Planner({ openFlow }: { openFlow: (f: FlowName) => void }) {
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
  const [taskPanel, setTaskPanel] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [eventPanel, setEventPanel] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [slotPanel, setSlotPanel] = useState<{ id: string; anchor: DOMRect } | null>(null);
  const [showCmd, setShowCmd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMorning, setShowMorning] = useState(false);
  const [showEvening, setShowEvening] = useState(false);
  const [agentOpen, setAgentOpen] = useState(readAgentOpen);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const today = todayISO(now);
  const { settings, update: updateSettings } = useSettings();
  const { data: vertical } = useVertical();
  const { data: inbox = [] } = useInboxTasks();
  const { data: todayTasks = [] } = useDayTasks(today);
  const { data: weekTasks = [] } = useSprintTasks(vertical.sprint?.id ?? null);
  const { data: scheduled = [] } = useScheduledTasks(range.start, range.end);
  const { data: events = [] } = useExternalEvents(range.start, range.end);
  const { data: slots = [] } = useSlots(range.start, range.end);
  const slotIds = useMemo(() => slots.map((s) => s.id), [slots]);
  const { data: slotChildTasks = [] } = useSlotTasks(slotIds);
  const { data: accounts = [] } = useCalendarAccounts();
  const { data: recurrences = [] } = useRecurrences();
  const { labels } = useLabels();
  const mutations = useTaskMutations();
  const eventMutations = useExternalEventMutations();
  const slotMutations = useSlotMutations();
  const recurrenceMutations = useRecurrenceMutations();

  const recurrenceById = useMemo(
    () => new Map(recurrences.map((r) => [r.id, r])),
    [recurrences],
  );

  const slotTasksBySlot = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of slotChildTasks) {
      if (!t.slot_id) continue;
      (m[t.slot_id] ??= []).push(t);
    }
    return m;
  }, [slotChildTasks]);

  /** Display title for a slot — derived from its contents when unnamed. */
  const slotTitle = useCallback(
    (s: Slot) => deriveSlotTitle(s, slotTasksBySlot[s.id] ?? [], vertical),
    [slotTasksBySlot, vertical],
  );

  const agent = useAgent(range);

  const toggleAgent = () => {
    setAgentOpen((open) => {
      const next = !open;
      writeAgentOpen(next);
      return next;
    });
  };

  useRealtime(true);

  // Defensive client-side rollover + recurrence top-up on first open of a new
  // day (and whenever the tab regains focus): repeating series walk their
  // horizon forward one day at a time, even if the cron never ran.
  const rollover = useRolloverGuard(settings?.last_rollover_date);
  const settingsLoaded = Boolean(settings);
  useEffect(() => {
    if (!settingsLoaded) return;
    void (async () => { await rollover(); await recurrenceMutations.materializeAll(); })();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => { await rollover(); await recurrenceMutations.materializeAll(); })();
    };
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

  // ⌘K / Ctrl+K → command bar  |  ⌘J → agent  |  ⌘, → settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowCmd((s) => !s);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleAgent();
      }
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setShowSettings((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allKnownTasks = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of [...inbox, ...weekTasks, ...todayTasks, ...scheduled, ...slotChildTasks])
      map.set(t.id, t);
    return map;
  }, [inbox, weekTasks, todayTasks, scheduled, slotChildTasks]);

  /** Calendar blocks carry their domain color — the thread up the vertical.
   *  Stable identity (useCallback) so CalendarPane's event memo holds. */
  const taskAccent = useCallback((t: Task) => taskDomainColor(vertical, t), [vertical]);

  const allTasksArray = useMemo(() => [...allKnownTasks.values()], [allKnownTasks]);

  const openTask = taskPanel ? (allKnownTasks.get(taskPanel.id) ?? null) : null;
  const openEvent: ExternalEvent | null = eventPanel
    ? (events.find((e) => e.id === eventPanel.id) ?? null)
    : null;
  const openEventAccount = openEvent ? accounts.find((a) => a.id === openEvent.account_id) : null;
  const openSlot = slotPanel ? (slots.find((s) => s.id === slotPanel.id) ?? null) : null;

  const anyModalOpen = showCmd || showSettings || showMorning || showEvening || Boolean(taskPanel) || Boolean(eventPanel) || Boolean(slotPanel);

  const commands: Command[] = [
    { id: "today", title: "Go to today", run: () => setTab("today") },
    { id: "week", title: "Go to this week", run: () => setTab("week") },
    { id: "inbox", title: "Go to inbox", run: () => setTab("inbox") },
    { id: "sunday", title: "Sunday — compose the week", run: () => openFlow("sunday") },
    { id: "summit", title: "Summit — decide the quarter", run: () => openFlow("summit") },
    { id: "blueprint", title: "Blueprint — shape a new bet", run: () => openFlow("blueprint") },
    { id: "plan", title: "Plan my day (morning ritual)", run: () => setShowMorning(true) },
    { id: "shutdown", title: "Evening shutdown", run: () => setShowEvening(true) },
    { id: "view-day", title: "Calendar: day view", run: () => setView("timeGridDay") },
    { id: "view-week", title: "Calendar: week view", run: () => setView("timeGridWeek") },
    { id: "view-month", title: "Calendar: month view", run: () => setView("dayGridMonth") },
    { id: "connect", title: "Connect calendar…", run: () => setShowSettings(true) },
    { id: "label", title: "New label…", run: () => setShowSettings(true) },
    { id: "agent", title: "Toggle Nuvo agent", run: toggleAgent },
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
      {/* Header — data-tauri-drag-region lets you drag the window. The macOS
          traffic lights now sit over the Spine rail, so no left inset here. */}
      <header
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-3"
      >
        <span className="wordmark wordmark-grad text-head">Nuvo</span>
        <span className="mono text-meta text-muted">{format(now, "EEE MMM d")}</span>
        <span className="mono rounded border border-signal px-1 text-meta leading-snug text-signal">
          {format(now, "h:mm a")}
        </span>
        <div className="flex-1" />
        <button onClick={() => setShowMorning(true)} className="fast rounded-md border border-line px-2 py-1 text-label font-medium text-muted hover:border-line-strong hover:text-ink">
          Plan
        </button>
        <button onClick={() => setShowEvening(true)} className="fast rounded-md border border-line px-2 py-1 text-label font-medium text-muted hover:border-line-strong hover:text-ink">
          Shutdown
        </button>
        <div className="flex overflow-hidden rounded-md border border-line">
          {(["timeGridDay", "timeGridWeek", "dayGridMonth"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`fast px-2 py-1 text-label font-medium ${
                view === v ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {v === "timeGridDay" ? "Day" : v === "timeGridWeek" ? "Week" : "Month"}
            </button>
          ))}
        </div>
        <button
          onClick={toggleAgent}
          className={`flex items-center gap-1.5 text-label ${agentOpen ? "text-accent" : "text-muted hover:text-ink"}`}
          title="Nuvo agent"
        >
          <Keycap>⌘J</Keycap>
        </button>
        <button onClick={() => setShowCmd(true)} className="flex items-center gap-1.5 text-label text-muted hover:text-ink">
          <Keycap>⌘K</Keycap>
        </button>
        <button
          onClick={() => setShowSettings(true)}
          title="Settings"
          className="fast text-head text-muted hover:text-ink"
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
          week={weekTasks}
          today={todayTasks}
          labels={labels}
          mutations={mutations}
          onOpenTask={(t, anchor) => setTaskPanel({ id: t.id, anchor })}
          hotkeysEnabled={!anyModalOpen}
          now={now}
          railRef={railRef}
        />
        <div className="relative flex min-h-0 flex-1">
          <CalendarPane
            view={view}
            tasks={allTasksArray}
            events={events}
            slots={slots}
            slotTasks={slotTasksBySlot}
            accounts={accounts}
            settings={settings}
            now={now}
            taskAccent={taskAccent}
            slotTitle={slotTitle}
            mutations={mutations}
            eventMutations={eventMutations}
            slotMutations={slotMutations}
            recurrenceMutations={recurrenceMutations}
            onOpenTask={(t, anchor) => setTaskPanel({ id: t.id, anchor })}
            onOpenEvent={(e, anchor) => setEventPanel({ id: e.id, anchor })}
            onOpenSlot={(s, anchor) => setSlotPanel({ id: s.id, anchor })}
            onRangeChange={(start, end) => setRange({ start, end })}
            railRef={railRef}
          />

          {openTask && taskPanel && (
            <TaskPopover
              task={openTask}
              anchor={taskPanel.anchor}
              labels={labels}
              mutations={mutations}
              recurrence={openTask.recurrence_id ? recurrenceById.get(openTask.recurrence_id) ?? null : null}
              recurrenceMutations={recurrenceMutations}
              onClose={() => setTaskPanel(null)}
            />
          )}
          {openEvent && eventPanel && !openTask && (
            <EventPopover
              event={openEvent}
              anchor={eventPanel.anchor}
              editable={openEventAccount?.provider === "google"}
              eventMutations={eventMutations}
              onClose={() => setEventPanel(null)}
            />
          )}
          {openSlot && slotPanel && !openTask && (
            <SlotPopover
              slot={openSlot}
              anchor={slotPanel.anchor}
              childTasks={slotTasksBySlot[openSlot.id] ?? []}
              taskMutations={mutations}
              slotMutations={slotMutations}
              recurrence={openSlot.recurrence_id ? recurrenceById.get(openSlot.recurrence_id) ?? null : null}
              recurrenceMutations={recurrenceMutations}
              onOpenTask={(t) => {
                const anchor = slotPanel.anchor;
                setSlotPanel(null);
                setTaskPanel({ id: t.id, anchor });
              }}
              onClose={() => setSlotPanel(null)}
            />
          )}
        </div>

        <AgentSidebar agent={agent} open={agentOpen} onToggle={toggleAgent} />
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
          weekPool={weekTasks.filter((t) => t.status !== "done" && !t.do_date)}
          prepared={allTasksArray.filter((t) => t.status !== "done" && t.prework_at && t.prework)}
          todayCount={todayTasks.filter((t) => t.status !== "done").length}
          mutations={mutations}
          onClose={() => setShowMorning(false)}
        />
      )}
      {showEvening && (
        <EveningShutdown todayTasks={todayTasks} taskAccent={taskAccent} mutations={mutations} onClose={() => setShowEvening(false)} />
      )}
    </div>
  );
}
