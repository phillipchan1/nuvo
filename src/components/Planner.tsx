import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { addDays, format, startOfWeek } from "date-fns";
import { todayISO, toDateISO, planningWeekStartISO } from "../lib/dates";
import { useWeekReport } from "../hooks/useWeekReport";
import WeekPlanFloor from "./floors/WeekPlanFloor";
import { readRevealConfig, isRevealReady, isAcknowledged, acknowledge, wasToasted, markToasted } from "../lib/weekReveal";
import { fallbackPanelAnchor } from "../lib/appNav";
import { MARQUEE_OPEN_EVENT, MARQUEE_CLOSE_EVENT } from "../lib/marquee";
import type { ExternalEvent, Slot, Task } from "../lib/types";
import { useAllTasks, useDayTasks, useGroomInbox, useInboxTasks, usePlannedAnytimeTasks, useRolloverGuard, useScheduledTasks, useSprintTasks, useTaskMutations } from "../hooks/useTasks";
import { useCalendarAccounts, useCalendarRefresh, useExternalEventMutations, useExternalEvents, useHiddenEvents, useLabels } from "../hooks/useCalendar";
import { useSlots, useSlotTasks, useSlotMutations } from "../hooks/useSlots";
import { useRecurrences, useRecurrenceMutations } from "../hooks/useRecurrence";
import { useRealtime } from "../hooks/useRealtime";
import { useSettings } from "../hooks/useSettings";
import { useVertical } from "../hooks/useVertical";
import { useAppNavigation } from "../hooks/useAppNavigation";
import { taskDomainColor } from "../lib/vertical";
import { isWritableAccount } from "../lib/calendarWrite";
import {
  applySpotlightNav,
  buildSearchHits,
  SPOTLIGHT_NAVIGATE_EVENT,
  type SpotlightNav,
} from "../lib/spotlightNav";
import { deriveSlotTitle } from "../lib/slots";
import { writeAgentOpen } from "./AgentSidebar";
import LeftRail from "./LeftRail";
import type { FlowName } from "./Spine";
import CalendarPane from "./CalendarPane";
import NuvoSpotlight, { type Command, type SearchHit } from "./NuvoSpotlight";
import { EventPopover, SlotPopover, TaskPopover } from "./SlideOver";
import SettingsModal from "./SettingsModal";
import ReconnectBanner from "./ReconnectBanner";
import { EveningShutdown } from "./Rituals";
import { useAgentContext } from "../hooks/useAgentContext";

export default function Planner({
  openFlow,
  focusMode = false,
  onToggleFocus,
}: {
  openFlow: (f: FlowName) => void;
  /** Focus mode: the inbox·today rail slides closed and the calendar goes full-bleed. */
  focusMode?: boolean;
  onToggleFocus?: () => void;
}) {
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
    openProject,
    openInitiative,
  } = useAppNavigation();

  const { tab, calView: view, overlay, overlayId, agentOpen, settingsSection, rung } = nav;
  const onSchedule = rung === "day";

  const [range, setRangeLocal] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    return {
      start: new Date(now.getTime() - 7 * 86400_000).toISOString(),
      end: new Date(now.getTime() + 7 * 86400_000).toISOString(),
    };
  });
  const { agent, navFocus, setRange: setAgentRange } = useAgentContext();
  const syncRange = useCallback(
    (start: string, end: string) => {
      // Bail when the view's range didn't actually change — datesSet can re-fire
      // after event drag/resize, and a fresh `{start,end}` object would re-render
      // the whole planner for nothing.
      setRangeLocal((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
      setAgentRange({ start, end });
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

  const contextLabel = useMemo(() => {
    if (!navFocus) return undefined;
    const { projectId, initiativeId, domainId } = navFocus;
    if (projectId) return vertical.projects.find((p) => p.id === projectId)?.name;
    if (initiativeId) return vertical.initiatives.find((i) => i.id === initiativeId)?.name;
    if (domainId) return vertical.domains.find((d) => d.id === domainId)?.name;
    return undefined;
  }, [navFocus, vertical]);

  // The current (lived) week — the toolbar's living emblem gauge. The week that
  // contains today (Monday-anchored). The floor shows a *viewed* week, which you
  // walk ‹ › backward through (past weeks render sealed); it resets to current
  // each time the door is opened.
  const currentWeekISO = useMemo(() => toDateISO(startOfWeek(now, { weekStartsOn: 1 })), [now]);
  // The forward horizon — the furthest week you can view/plan. On the weekend the
  // week you plan is *next* week (Sunday isn't reviewing the week that's ending,
  // it's planning the one ahead), so the plannable window extends one week past
  // the lived week. On weekdays this equals currentWeekISO.
  const horizonWeekISO = useMemo(() => planningWeekStartISO(now), [now]);
  const glyphReport = useWeekReport(currentWeekISO, now);
  const weekPlanOpen = overlay === "week-plan";
  const [viewedWeekISO, setViewedWeekISO] = useState(currentWeekISO);
  const viewedReport = useWeekReport(viewedWeekISO, now);
  // The lived week and any week ahead are *forming* (a plan you build/adjust);
  // only a week that has truly ended is *sealed* (the Review / history).
  const viewedState: "forming" | "sealed" = viewedWeekISO < currentWeekISO ? "sealed" : "forming";
  // "ahead" = a not-yet-started week you're planning; "current" = the lived week
  // (build + check in); "past" = sealed. Drives the surface's tense + eyebrow.
  const viewedTense: "ahead" | "current" | "past" =
    viewedWeekISO > currentWeekISO ? "ahead" : viewedWeekISO === currentWeekISO ? "current" : "past";
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
  // The turn of the week (Sun + Mon): the door faces forward. Even when the
  // closing week's Friday review is still glowing, by Sunday the dominant job is
  // planning the week ahead — so Plan *wins* over Review here (mirrors the
  // Sunday-nudge window in AppShell). The review stays reachable inside.
  const planForward = useMemo(() => {
    const dow = now.getDay();
    return dow === 0 || dow === 1;
  }, [now]);
  // Open the Week's Plan *surface*. `story` plays the paced recap animation —
  // that's the Review's reveal moment ONLY. A mid-week check-in ("the week's
  // plan") opens straight to the static detail (no animation).
  const [weekPlanStory, setWeekPlanStory] = useState(false);
  const openWeekPlanAt = useCallback((weekISO: string, story = false) => {
    setViewedWeekISO(weekISO);
    setWeekPlanStory(story);
    openOverlay("week-plan");
  }, [openOverlay]);
  const openReview = useCallback(() => {
    ackReveal();
    openWeekPlanAt(currentWeekISO, true);
  }, [ackReveal, openWeekPlanAt, currentWeekISO]);

  // Marquee: Nuvo can ask to bring the Week's Plan forward (e.g. "what are my
  // priorities this week"). Open it straight to the static detail at the
  // planning-horizon week — the Marquee controller lights the priorities next.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const surface = (e as CustomEvent<{ surface?: string }>).detail?.surface;
      if (surface === "week-plan") openWeekPlanAt(horizonWeekISO);
    };
    const onClose = (e: Event) => {
      const surface = (e as CustomEvent<{ surface?: string }>).detail?.surface;
      if (surface === "week-plan" && overlay === "week-plan") closeOverlay();
    };
    window.addEventListener(MARQUEE_OPEN_EVENT, onOpen);
    window.addEventListener(MARQUEE_CLOSE_EVENT, onClose);
    return () => {
      window.removeEventListener(MARQUEE_OPEN_EVENT, onOpen);
      window.removeEventListener(MARQUEE_CLOSE_EVENT, onClose);
    };
  }, [openWeekPlanAt, horizonWeekISO, overlay, closeOverlay]);

  // Is the plan-target week already composed? planWeek() stamps the sprint on
  // commit (the same signal the Sunday nudge reads), and data.sprint resolves to
  // the planning week (planningWeekStartISO), so this reflects the week the door
  // concerns.
  const weekPlanned = Boolean(vertical.sprint?.reviewed_at);

  // The week button rides the week's lifecycle (short labels — the emblem carries
  // the ambient read; long copy was fighting the view pill in the toolbar):
  //  · plan   — not composed yet → "Plan" → the compose ritual
  //  · view   — composed         → "This week" → the surface (re-run / shift)
  //  · review — Friday reveal     → "Review" → the surface (look back)
  // Forward states (plan/view) win over a still-glowing review at the turn of the
  // week (Sun/Mon); the Friday review wins the rest of the time.
  const weekDoorMode: "plan" | "view" | "review" =
    !planForward && weekReady ? "review" : weekPlanned ? "view" : "plan";
  const weekButtonLabel =
    weekDoorMode === "review" ? "Review" : weekDoorMode === "view" ? "This week" : "Plan";
  const weekButtonTitle =
    weekDoorMode === "review"
      ? "Your week is ready to review"
      : weekDoorMode === "view"
        ? "The week's plan"
        : "Plan the week";

  const openWeekDoor = useCallback(() => {
    if (weekDoorMode === "review") return openReview();
    if (weekDoorMode === "view") return openWeekPlanAt(horizonWeekISO);
    openFlow("sunday"); // "plan" → the compose ritual (matches the bottom nudge)
  }, [weekDoorMode, openReview, openWeekPlanAt, horizonWeekISO, openFlow]);

  // One announcement toast per week when the reveal first arrives.
  useEffect(() => {
    if (!weekReady || wasToasted(currentWeekISO)) return;
    markToasted(currentWeekISO);
    toast("Your week is ready to review.", {
      action: { label: "Review →", onClick: openReview },
      duration: 8000,
    });
  }, [weekReady, currentWeekISO, openReview]);
  const walkWeek = useCallback(
    (deltaDays: number) =>
      setViewedWeekISO((iso) => {
        const next = toDateISO(addDays(new Date(iso + "T00:00:00"), deltaDays));
        return next > horizonWeekISO ? horizonWeekISO : next; // forward only as far as the week you can plan
      }),
    [horizonWeekISO],
  );
  const weekLabel = useMemo(() => {
    const s = new Date(viewedWeekISO + "T00:00:00");
    const e = addDays(s, 6);
    const sameMonth = s.getMonth() === e.getMonth();
    return `${format(s, "MMM d")} – ${format(e, sameMonth ? "d" : "MMM d")}`;
  }, [viewedWeekISO]);

  const { data: inbox = [] } = useInboxTasks();
  useGroomInbox(inbox);
  const { data: todayTasks = [] } = useDayTasks(today);
  const { data: weekTasks = [] } = useSprintTasks(vertical.sprint?.id ?? null);
  const { data: scheduled = [] } = useScheduledTasks(range.start, range.end);
  const { data: anytime = [] } = usePlannedAnytimeTasks(range.start, range.end);
  // Every non-trashed task (shares the vertical store's cache) — lets ⌘K open any
  // task as the centered modal, scheduled or buried in a project backlog.
  const { data: allTasks = [] } = useAllTasks();
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
  const { hide: hideEvent } = useHiddenEvents();

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

  // Today's slot children augmented with their slot's start_time so they appear
  // in the "Scheduled on Calendar" section of the Today rail (slot children have
  // start_time null in the DB — the slot carries the time, not the task).
  // Dedupe by id and prefer the slot-augmented copy: an optimistic assignToSlot
  // used to leave the day-query row in place (with slot_id stamped) *and* add
  // it via slotChildren, so the same task rendered twice.
  const todayTasksForRail = useMemo(() => {
    const todaySlotMap = new Map(
      slots.filter((s) => s.do_date === today).map((s) => [s.id, s]),
    );
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const t of slotChildTasks) {
      if (!t.slot_id || !todaySlotMap.has(t.slot_id) || t.status === "trashed") continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ ...t, start_time: todaySlotMap.get(t.slot_id)!.start_time });
    }
    for (const t of todayTasks) {
      if (t.slot_id || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  }, [todayTasks, slotChildTasks, slots, today]);

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
  const showEvening = overlay === "evening";

  const panelRect = panelAnchor ?? fallbackPanelAnchor();

  const openTask = taskPanel ? (allKnownTasks.get(taskPanel.id) ?? null) : null;
  // The centered task modal (⌘K) — resolve from any task, not just loaded lists.
  // Prefer allKnownTasks (carries task_labels) and fall back to the full cache.
  const recordTask =
    overlay === "task-record" && overlayId
      ? (allKnownTasks.get(overlayId) ?? allTasks.find((t) => t.id === overlayId) ?? null)
      : null;
  const openEvent: ExternalEvent | null = eventPanel
    ? (events.find((e) => e.id === eventPanel.id) ?? null)
    : null;
  const openEventAccount = openEvent ? accounts.find((a) => a.id === openEvent.account_id) : null;
  const openEventCalendar = openEvent && openEventAccount
    ? (openEventAccount.calendars.find((c) => c.id === openEvent.calendar_id) ?? null)
    : null;
  const openSlot = slotPanel ? (slots.find((s) => s.id === slotPanel.id) ?? null) : null;

  const anyModalOpen = showCmd || showSettings || showEvening || Boolean(taskPanel) || Boolean(eventPanel) || Boolean(slotPanel) || Boolean(recordTask);

  // The searchable vertical for ⌘K — every task / project / initiative / domain
  // as a SearchHit whose `run` navigates to it. Built from the shared builder
  // (the same one the ⌥Space panel uses), each serialized intent applied through
  // the live nav API so in-window search and cross-window pull-up stay identical.
  const searchHits = useMemo<SearchHit[]>(
    () =>
      buildSearchHits(vertical).map((h) => ({
        ...h,
        run: () => applySpotlightNav(h.nav, { openOverlay, openProject, openInitiative, navigate }),
      })),
    [vertical, openOverlay, openProject, openInitiative, navigate],
  );

  // The global ⌥Space panel lives in its own Tauri window without the nav API, so
  // a record it pulls up arrives here as an event — replayed against the live nav
  // exactly like an in-window ⌘K selection. (No-op in the browser / PWA.)
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in globalThis)) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<SpotlightNav>(SPOTLIGHT_NAVIGATE_EVENT, (e) =>
        applySpotlightNav(e.payload, { openOverlay, openProject, openInitiative, navigate }),
      ).then((u) => (unlisten = u)),
    );
    return () => unlisten?.();
  }, [openOverlay, openProject, openInitiative, navigate]);

  const commands: Command[] = [
    { id: "today", title: "Go to today", run: () => setTab("today") },
    { id: "week", title: "Go to the week (Spread)", run: () => setCalView("board") },
    { id: "inbox", title: "Go to inbox", run: () => setTab("inbox") },
    { id: "sunday", title: "Plan the week", run: () => openFlow("sunday") },
    { id: "summit", title: "Summit — decide the quarter", run: () => openFlow("summit") },
    { id: "shutdown", title: "Evening shutdown", run: () => openOverlay("evening") },
    { id: "view-day", title: "Calendar: day view", run: () => setCalView("timeGridDay") },
    { id: "view-week", title: "Calendar: week view", run: () => setCalView("timeGridWeek") },
    { id: "view-month", title: "Calendar: month view", run: () => setCalView("dayGridMonth") },
    { id: "connect", title: "Connect calendar…", run: () => openOverlay("settings") },
    { id: "label", title: "New label…", run: () => openOverlay("settings") },
    { id: "agent", title: "Toggle Nuvo agent", run: handleToggleAgent },
    { id: "settings", title: "Settings", run: () => openOverlay("settings") },
    { id: "shortcuts", title: "Keyboard shortcuts", run: () => openOverlay("shortcuts") },
    {
      id: "theme",
      title: "Toggle dark mode",
      run: () =>
        updateSettings({
          theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
        }),
    },
  ];

  // Close the ⌘K palette and run the command in one step. We close with a
  // `replace` (not `closeOverlay`'s `history.back()`) because back() fires an
  // async popstate that would revert the command's own navigation a tick later
  // — that race is why "Plan the week" (and every navigating
  // command) appeared to do nothing.
  const runCommand = useCallback(
    (cmd: Command) => {
      navigate({ overlay: "none", overlayId: null }, "replace");
      cmd.run();
    },
    [navigate],
  );

  const handleConvertEventToTask = useCallback(
    (event: ExternalEvent) => {
      const start = new Date(event.start_at);
      const end = new Date(event.end_at);
      const duration = Math.round((end.getTime() - start.getTime()) / 60000);
      mutations.create({
        title: event.title,
        do_date: toDateISO(start),
        start_time: event.start_at,
        duration_minutes: duration > 0 ? duration : 30,
      });
      hideEvent(event, "THIS");
      toast.success("Task created");
    },
    [mutations, hideEvent],
  );

  const handleConvertTaskToEvent = useCallback(
    async (task: Task) => {
      if (!task.start_time) return;
      const durationMs = (task.duration_minutes ?? 30) * 60000;
      const end = new Date(new Date(task.start_time).getTime() + durationMs).toISOString();
      try {
        await eventMutations.createEvent({ title: task.title, start_at: task.start_time, end_at: end });
        mutations.trash(task);
        toast.success("Event created");
      } catch {
        toast.error("Couldn't create event — is Google Calendar connected?");
      }
    },
    [eventMutations, mutations],
  );

  return (
    <div className="flex h-full flex-col">
      {/* No header bar at all. The macOS titlebar zone is filled by the rail and
          the calendar toolbar themselves (each carries `titlebar-pad` so its own
          surface rises to the window top, with the traffic lights floating over
          the spine) — nothing reads as an empty band. Window-drag lives on the
          spine top + the toolbar's empty spacer. Plan/Shutdown → ⌘K + the morning
          prompt; Nuvo → right edge (⌘J); settings → spine (⌘,). */}

      <ReconnectBanner accounts={accounts} onManualReconnect={() => openOverlay("settings")} />

      {/* Priorities moved off Schedule — too much for the workspace. They live on
          Today (the ribbon) for now; a dedicated dashboard view is TBD. */}

      <div className="relative flex min-h-0 flex-1">
        <LeftRail
          tab={tab}
          setTab={setTab}
          inbox={inbox}
          today={todayTasksForRail}
          labels={labels}
          mutations={mutations}
          onOpenTask={(t, anchor) => openOverlay("task", t.id, anchor)}
          hotkeysEnabled={!anyModalOpen && !focusMode}
          now={now}
          railRef={railRef}
          collapsed={focusMode}
          weekDoor={
            onSchedule
              ? {
                  mode: weekDoorMode,
                  title: weekButtonTitle,
                  glow: weekDoorMode === "review",
                  glyph: glyphReport.emblem,
                  onOpen: openWeekDoor,
                }
              : undefined
          }
        />
        <div className="relative flex min-h-0 flex-1 min-w-[280px]">
          {/* The week door lives on the rail's Week's Plan header — on top of the
              priorities it opens. The toolbar's right cluster acts on the canvas
              (zone · view · tools); the door acts on the plan, so it was the one
              stranger there. It stays here ONLY in focus mode, where the rail is
              slid shut: one door, always visible, never two opposite corners. */}
          <CalendarPane
            view={view}
            onViewChange={setCalView}
            hotkeysEnabled={!anyModalOpen}
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
            onConvertTaskToEvent={handleConvertTaskToEvent}
            onConvertEventToTask={handleConvertEventToTask}
            weekGlyph={onSchedule && focusMode ? glyphReport.emblem : null}
            onOpenWeekPlan={onSchedule && focusMode ? openWeekDoor : undefined}
            weekButtonLabel={weekButtonLabel}
            weekButtonTitle={weekButtonTitle}
            weekButtonGlow={onSchedule && weekDoorMode === "review"}
            focusMode={focusMode}
            onToggleFocus={onToggleFocus}
            domains={vertical.domains}
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
              onConvertToEvent={() => handleConvertTaskToEvent(openTask)}
            />
          )}
          {onSchedule && openEvent && eventPanel && !openTask && (
            <EventPopover
              event={openEvent}
              anchor={panelRect}
              editable={isWritableAccount(openEventAccount)}
              calendarId={openEvent.calendar_id}
              calendarName={openEventCalendar?.summary}
              calendarColor={openEventCalendar?.color}
              accounts={accounts}
              accountEmail={openEventAccount?.email}
              eventMutations={eventMutations}
              onClose={closeOverlay}
              onConvertToTask={() => handleConvertEventToTask(openEvent)}
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
            state={viewedState}
            tense={viewedTense}
            weekLabel={weekLabel}
            viewedWeekISO={viewedWeekISO}
            onClose={closeOverlay}
            onPrevWeek={() => walkWeek(-7)}
            onNextWeek={() => walkWeek(7)}
            canGoNext={viewedWeekISO < horizonWeekISO}
            onCompose={() => {
              // Replace the week-plan history entry so Back from the ritual
              // returns to Schedule — not a reopened week plan.
              navigate(
                { flow: "sunday", flowStep: 0, flowFocus: null, overlay: "none", overlayId: null, floorModal: null },
                "replace",
              );
            }}
            composeLabel={weekPlanned && viewedWeekISO === horizonWeekISO ? "Re-plan the week" : "Plan the week"}
            story={weekPlanStory}
          />
        )}
      </div>

      {showCmd && (
        <NuvoSpotlight
          labels={labels}
          commands={commands}
          searchHits={searchHits}
          onCreate={mutations.create}
          agent={agent}
          onClose={closeOverlay}
          onRunCommand={runCommand}
          contextLabel={contextLabel}
        />
      )}
      {recordTask && (
        <TaskPopover
          task={recordTask}
          anchor={panelRect}
          variant="centered"
          labels={labels}
          mutations={mutations}
          recurrence={recordTask.recurrence_id ? recurrenceById.get(recordTask.recurrence_id) ?? null : null}
          recurrenceMutations={recurrenceMutations}
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
      {showEvening && (
        <EveningShutdown todayTasks={todayTasks} taskAccent={taskAccent} mutations={mutations} onClose={closeOverlay} />
      )}
    </div>
  );
}
