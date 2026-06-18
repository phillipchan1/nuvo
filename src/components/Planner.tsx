import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { todayISO } from "../lib/dates";
import { fallbackPanelAnchor } from "../lib/appNav";
import type { ExternalEvent, Slot, Task } from "../lib/types";
import { useDayTasks, useInboxTasks, useRolloverGuard, useScheduledTasks, useSprintTasks, useTaskMutations } from "../hooks/useTasks";
import { useCalendarAccounts, useCalendarRefresh, useExternalEventMutations, useExternalEvents, useLabels } from "../hooks/useCalendar";
import { useSlots, useSlotTasks, useSlotMutations } from "../hooks/useSlots";
import { useRecurrences, useRecurrenceMutations } from "../hooks/useRecurrence";
import { useRealtime } from "../hooks/useRealtime";
import { useSettings } from "../hooks/useSettings";
import { useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { taskDomainColor } from "../lib/vertical";
import { deriveSlotTitle } from "../lib/slots";
import { writeAgentOpen } from "./AgentSidebar";
import LeftRail from "./LeftRail";
import type { FlowName } from "./Spine";
import CalendarPane from "./CalendarPane";
import CommandBar, { type Command } from "./CommandBar";
import { EventPopover, SlotPopover, TaskPopover } from "./SlideOver";
import SettingsModal from "./SettingsModal";
import ReconnectBanner from "./ReconnectBanner";
import { BigRocksBar } from "./floors/bigRocks";
import { EveningShutdown, MorningPlan } from "./Rituals";
import { useAgentContext } from "../hooks/useAgentContext";

export default function Planner({ openFlow }: { openFlow: (f: FlowName) => void }) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const {
    nav,
    setTab,
    setCalView,
    openOverlay,
    closeOverlay,
    toggleAgent,
    navigate,
    panelAnchor,
  } = useAppNavigation();

  const { tab, calView: view, overlay, overlayId, agentOpen, settingsSection, rung } = nav;
  const onSchedule = rung === "day";

  const morningAutoRef = useRef(false);

  const [range, setRangeLocal] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    return {
      start: new Date(now.getTime() - 7 * 86400_000).toISOString(),
      end: new Date(now.getTime() + 7 * 86400_000).toISOString(),
    };
  });
  const { setRange: setAgentRange } = useAgentContext();
  const syncRange = useCallback(
    (start: string, end: string) => {
      const next = { start, end };
      setRangeLocal(next);
      setAgentRange(next);
    },
    [setAgentRange],
  );

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
  const { refresh: refreshCalendars, fullRefresh: fullRefreshCalendars, refreshing: refreshingCalendars } = useCalendarRefresh();
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

  const slotTitle = useCallback(
    (s: Slot) => deriveSlotTitle(s, slotTasksBySlot[s.id] ?? [], vertical),
    [slotTasksBySlot, vertical],
  );

  const handleToggleAgent = () => {
    toggleAgent();
    writeAgentOpen(!agentOpen);
  };

  useRealtime(true);

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

  // Morning plan auto-prompt on first open of the day — replaces current entry, no stack push.
  useEffect(() => {
    if (!settingsLoaded) return;
    const key = `nuvo-morning-${today}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "1");
      morningAutoRef.current = true;
      navigate({ overlay: "morning" }, "replace");
    }
  }, [settingsLoaded, today, navigate]);

  const closeMorning = () => {
    if (morningAutoRef.current) {
      morningAutoRef.current = false;
      navigate({ overlay: "none" }, "replace");
    } else {
      closeOverlay();
    }
  };

  // ⌘K / Ctrl+K → command bar  |  ⌘J → agent  |  ⌘, → settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (overlay === "cmd") closeOverlay();
        else openOverlay("cmd");
      }
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        if (overlay === "settings") closeOverlay();
        else openOverlay("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  const allKnownTasks = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of [...inbox, ...weekTasks, ...todayTasks, ...scheduled, ...slotChildTasks])
      map.set(t.id, t);
    return map;
  }, [inbox, weekTasks, todayTasks, scheduled, slotChildTasks]);

  const taskAccent = useCallback((t: Task) => taskDomainColor(vertical, t), [vertical]);

  const allTasksArray = useMemo(() => [...allKnownTasks.values()], [allKnownTasks]);

  const taskPanel = overlay === "task" && overlayId ? { id: overlayId } : null;
  const eventPanel = overlay === "event" && overlayId ? { id: overlayId } : null;
  const slotPanel = overlay === "slot" && overlayId ? { id: overlayId } : null;
  const showCmd = overlay === "cmd";
  const showSettings = overlay === "settings";
  const showMorning = overlay === "morning";
  const showEvening = overlay === "evening";

  const panelRect = panelAnchor ?? fallbackPanelAnchor();

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
    { id: "plan", title: "Plan my day (morning ritual)", run: () => { morningAutoRef.current = false; openOverlay("morning"); } },
    { id: "shutdown", title: "Evening shutdown", run: () => openOverlay("evening") },
    { id: "view-day", title: "Calendar: day view", run: () => setCalView("timeGridDay") },
    { id: "view-week", title: "Calendar: week view", run: () => setCalView("timeGridWeek") },
    { id: "view-month", title: "Calendar: month view", run: () => setCalView("dayGridMonth") },
    { id: "connect", title: "Connect calendar…", run: () => openOverlay("settings") },
    { id: "label", title: "New label…", run: () => openOverlay("settings") },
    { id: "agent", title: "Toggle Nuvo agent", run: handleToggleAgent },
    { id: "settings", title: "Settings", run: () => openOverlay("settings") },
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
      {/* A quiet masthead — just the day, the hour, and the view. Plan/Shutdown
          live in the command bar (⌘K) + the morning prompt; Nuvo on the right
          edge (⌘J); settings on the spine (⌘,). The Schedule earns its calm. */}
      <header
        data-tauri-drag-region
        className="app-topbar flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-3"
      >
        <span className="mono text-meta text-muted">{format(now, "EEE MMM d")}</span>
        <span className="mono rounded border border-signal px-1 text-meta leading-snug text-signal">
          {format(now, "h:mm a")}
        </span>
        <div className="flex-1" />
        <div className="flex overflow-hidden rounded-md border border-line">
          {(["timeGridDay", "timeGridWeek", "dayGridMonth"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setCalView(v)}
              className={`fast px-2.5 py-1 text-label font-medium ${
                view === v ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {v === "timeGridDay" ? "Day" : v === "timeGridWeek" ? "Week" : "Month"}
            </button>
          ))}
        </div>
      </header>

      <ReconnectBanner accounts={accounts} />

      {/* the week's plan, docked above the calendar — big rocks live with the week */}
      <BigRocksBar />

      <div className="relative flex min-h-0 flex-1">
        <LeftRail
          tab={tab}
          setTab={setTab}
          inbox={inbox}
          week={weekTasks}
          today={todayTasks}
          labels={labels}
          mutations={mutations}
          onOpenTask={(t, anchor) => openOverlay("task", t.id, anchor)}
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
            onRefreshCalendars={accounts.length > 0 ? refreshCalendars : undefined}
            onFullRefreshCalendars={accounts.length > 0 ? fullRefreshCalendars : undefined}
            refreshingCalendars={refreshingCalendars}
            onOpenTask={(t, anchor) => openOverlay("task", t.id, anchor)}
            onOpenEvent={(e, anchor) => openOverlay("event", e.id, anchor)}
            onOpenSlot={(s, anchor) => openOverlay("slot", s.id, anchor)}
            onRangeChange={syncRange}
            railRef={railRef}
          />

          {onSchedule && openTask && taskPanel && (
            <TaskPopover
              task={openTask}
              anchor={panelRect}
              labels={labels}
              mutations={mutations}
              recurrence={openTask.recurrence_id ? recurrenceById.get(openTask.recurrence_id) ?? null : null}
              recurrenceMutations={recurrenceMutations}
              onClose={closeOverlay}
            />
          )}
          {onSchedule && openEvent && eventPanel && !openTask && (
            <EventPopover
              event={openEvent}
              anchor={panelRect}
              editable={openEventAccount?.provider === "google"}
              eventMutations={eventMutations}
              onClose={closeOverlay}
            />
          )}
          {onSchedule && openSlot && slotPanel && !openTask && (
            <SlotPopover
              slot={openSlot}
              anchor={panelRect}
              childTasks={slotTasksBySlot[openSlot.id] ?? []}
              taskMutations={mutations}
              slotMutations={slotMutations}
              recurrence={openSlot.recurrence_id ? recurrenceById.get(openSlot.recurrence_id) ?? null : null}
              recurrenceMutations={recurrenceMutations}
              onOpenTask={(t) => openOverlay("task", t.id, panelRect)}
              onClose={closeOverlay}
            />
          )}
        </div>
      </div>

      {showCmd && (
        <CommandBar
          labels={labels}
          commands={commands}
          onCreate={mutations.create}
          onClose={closeOverlay}
        />
      )}
      {showSettings && (
        <SettingsModal
          settings={settings}
          updateSettings={updateSettings}
          accounts={accounts}
          section={settingsSection}
          onClose={closeOverlay}
        />
      )}
      {showMorning && (
        <MorningPlan
          inbox={inbox}
          weekPool={weekTasks.filter((t) => t.status !== "done" && !t.do_date)}
          prepared={allTasksArray.filter((t) => t.status !== "done" && t.prework_at && t.prework)}
          todayCount={todayTasks.filter((t) => t.status !== "done").length}
          mutations={mutations}
          onClose={closeMorning}
        />
      )}
      {showEvening && (
        <EveningShutdown todayTasks={todayTasks} taskAccent={taskAccent} mutations={mutations} onClose={closeOverlay} />
      )}
    </div>
  );
}
