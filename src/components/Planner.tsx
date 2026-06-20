import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { addDays, format, startOfWeek } from "date-fns";
import { todayISO, toDateISO } from "../lib/dates";
import { useWeekReport } from "../hooks/useWeekReport";
import WeekPlanFloor from "./floors/WeekPlanFloor";
import { readRevealConfig, isRevealReady, isAcknowledged, acknowledge, wasToasted, markToasted } from "../lib/weekReveal";
import { fallbackPanelAnchor } from "../lib/appNav";
import type { ExternalEvent, Slot, Task } from "../lib/types";
import { useDayTasks, useInboxTasks, usePlannedAnytimeTasks, useRolloverGuard, useScheduledTasks, useSprintTasks, useTaskMutations } from "../hooks/useTasks";
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
import NuvoSpotlight, { type Command } from "./NuvoSpotlight";
import { EventPopover, SlotPopover, TaskPopover } from "./SlideOver";
import SettingsModal from "./SettingsModal";
import ReconnectBanner from "./ReconnectBanner";
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
  const { agent, setRange: setAgentRange } = useAgentContext();
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

  // The current (lived) week — the toolbar's living emblem gauge. The week that
  // contains today (Monday-anchored). The floor shows a *viewed* week, which you
  // walk ‹ › backward through (past weeks render sealed); it resets to current
  // each time the door is opened.
  const currentWeekISO = useMemo(() => toDateISO(startOfWeek(now, { weekStartsOn: 1 })), [now]);
  const glyphReport = useWeekReport(currentWeekISO, now);
  const [weekPlanOpen, setWeekPlanOpen] = useState(false);
  const [viewedWeekISO, setViewedWeekISO] = useState(currentWeekISO);
  const viewedReport = useWeekReport(viewedWeekISO, now);
  const viewedIsCurrent = viewedWeekISO === currentWeekISO;
  // The Friday reveal — a gentle nudge that the Review is ready (it always is;
  // this is just the invitation). Per-week, per-device; acknowledged on open or
  // dismiss so the glow + toast don't nag.
  const [ackTick, setAckTick] = useState(0);
  const weekReady = useMemo(
    () => isRevealReady(now, currentWeekISO, readRevealConfig()) && !isAcknowledged(currentWeekISO),
    [now, currentWeekISO, ackTick],
  );
  const ackReveal = useCallback(() => {
    acknowledge(currentWeekISO);
    setAckTick((t) => t + 1);
  }, [currentWeekISO]);
  const openWeekPlan = useCallback(() => {
    ackReveal();
    setViewedWeekISO(currentWeekISO);
    setWeekPlanOpen(true);
  }, [currentWeekISO, ackReveal]);

  // One announcement toast per week when the reveal first arrives.
  useEffect(() => {
    if (!weekReady || wasToasted(currentWeekISO)) return;
    markToasted(currentWeekISO);
    toast("Your week is ready to review.", {
      action: { label: "Review →", onClick: openWeekPlan },
      duration: 8000,
    });
  }, [weekReady, currentWeekISO, openWeekPlan]);
  const walkWeek = useCallback(
    (deltaDays: number) =>
      setViewedWeekISO((iso) => {
        const next = toDateISO(addDays(new Date(iso + "T00:00:00"), deltaDays));
        return next > currentWeekISO ? currentWeekISO : next; // never walk past the current week
      }),
    [currentWeekISO],
  );
  const weekLabel = useMemo(() => {
    const s = new Date(viewedWeekISO + "T00:00:00");
    const e = addDays(s, 6);
    const sameMonth = s.getMonth() === e.getMonth();
    return `${format(s, "MMM d")} – ${format(e, sameMonth ? "d" : "MMM d")}`;
  }, [viewedWeekISO]);

  const { data: inbox = [] } = useInboxTasks();
  const { data: todayTasks = [] } = useDayTasks(today);
  const { data: weekTasks = [] } = useSprintTasks(vertical.sprint?.id ?? null);
  const { data: scheduled = [] } = useScheduledTasks(range.start, range.end);
  const { data: anytime = [] } = usePlannedAnytimeTasks(range.start, range.end);
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
    for (const t of [...inbox, ...weekTasks, ...todayTasks, ...scheduled, ...anytime, ...slotChildTasks])
      map.set(t.id, t);
    return map;
  }, [inbox, weekTasks, todayTasks, scheduled, anytime, slotChildTasks]);

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
    { id: "refine", title: "Refine — groom your projects toward done", run: () => openFlow("refine") },
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
    <div className="flex h-full flex-col">
      {/* No header bar at all. The macOS titlebar zone is filled by the rail and
          the calendar toolbar themselves (each carries `titlebar-pad` so its own
          surface rises to the window top, with the traffic lights floating over
          the spine) — nothing reads as an empty band. Window-drag lives on the
          spine top + the toolbar's empty spacer. Plan/Shutdown → ⌘K + the morning
          prompt; Nuvo → right edge (⌘J); settings → spine (⌘,). */}

      <ReconnectBanner accounts={accounts} />

      {/* Priorities moved off Schedule — too much for the workspace. They live on
          Today (the ribbon) for now; a dedicated dashboard view is TBD. */}

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
            onViewChange={setCalView}
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
            weekGlyph={onSchedule ? glyphReport.emblem : null}
            onOpenWeekPlan={onSchedule ? openWeekPlan : undefined}
            weekReady={onSchedule ? weekReady : undefined}
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

        {/* The Week's Plan / Review covers the whole work area (rail included) —
            a moment to receive, not to triage. */}
        {onSchedule && weekPlanOpen && (
          <WeekPlanFloor
            report={viewedReport}
            state={viewedIsCurrent ? "forming" : "sealed"}
            weekLabel={weekLabel}
            viewedWeekISO={viewedWeekISO}
            onClose={() => setWeekPlanOpen(false)}
            onPrevWeek={() => walkWeek(-7)}
            onNextWeek={() => walkWeek(7)}
            canGoNext={!viewedIsCurrent}
          />
        )}
      </div>

      {showCmd && (
        <NuvoSpotlight
          labels={labels}
          commands={commands}
          onCreate={mutations.create}
          agent={agent}
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
