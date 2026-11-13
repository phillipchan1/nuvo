import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMemory } from "../../hooks/useMemory";
import { Icon } from "../Icon";
import { IconButton } from "../kit";
import { TouchSegmented, SegCount } from "./touch";
import { PhoneNav, PhoneTopBar } from "./ShellChrome";
import { format } from "date-fns";
import { todayISO, toDateISO } from "../../lib/dates";
import { useMobileOverlayHistory } from "../../hooks/useMobileOverlayHistory";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";
import { useSettings } from "../../hooks/useSettings";
import { useVertical } from "../../hooks/useVertical";
import {
  useInboxTasks,
  useDayTasks,
  useSprintTasks,
  useAllTasks,
  useTaskMutations,
  useRolloverGuard,
  useTrashedTasks,
  TRASH_LIMIT,
} from "../../hooks/useTasks";
import { useLabels, useCalendarAccounts } from "../../hooks/useCalendar";
import { useRecurrenceMutations } from "../../hooks/useRecurrence";
import { useSlotMutations, useSlots } from "../../hooks/useSlots";
import { todayWithSlotChildren } from "../../lib/slotRuns";
import { deriveSlotTitle } from "../../lib/slots";
import { toggleGroup } from "../../lib/selection";
import { useRealtime } from "../../hooks/useRealtime";
import { useAgentContext } from "../../hooks/useAgentContext";
import { taskDomainColor } from "../../lib/vertical";
import { mergeTaskLists } from "../../lib/taskMerge";
import { isTauri } from "../../lib/platform";
import { shortcutFromUrl, type Shortcut } from "../../lib/shortcuts";
import type { Floor } from "../../lib/readiness";
import { DEFAULT_DURATION_MINUTES, type Slot, type Task } from "../../lib/types";
import SettingsModal from "../SettingsModal";
import type { AltitudeKind } from "../icons";
import { TrialBanner } from "../billing/TrialBanner";
import Orientation from "../orientation/Orientation";
import MobileTaskList, { type MobileTab } from "./MobileTaskList";
import TaskFilter from "../TaskFilter";
import BulkBar from "../BulkBar";
import { useBulkOps } from "../../hooks/useBulkOps";
import { useTaskFilter } from "../../hooks/useTaskFilter";
import { describeQuery, queryFacetCount } from "../../lib/taskFilter";
import MobileCalendar from "./MobileCalendar";
import MobileRepairCard from "./MobileRepairCard";
import type { CalHero } from "./CalendarChrome";
import TaskRow from "../TaskRow";
import RecurringUpkeepPanel from "../RecurringUpkeepPanel";
import MobileProjects from "./MobileProjects";
import MobileInitiatives from "./MobileInitiatives";
import MobileDomains from "./MobileDomains";
import MobileReadiness from "./MobileReadiness";
import { WeekCompanions } from "./WeekPlanCard";
import MobilePlanWeek from "./MobilePlanWeek";
import MobileGetReady from "./MobileGetReady";
import MobileSearch, { type JumpKind } from "./MobileSearch";
import { revealOnCalendar } from "../../lib/calendarReveal";
import { eventHitDateISO, type EventHit } from "../../lib/eventSearch";
import PullIndicator from "./PullIndicator";
import MobileDetailSheet from "./detail/MobileDetailSheet";
import type { DetailTarget, Frame } from "./detail/verticalDetail";
import MobileCapture, { type CaptureKind } from "./MobileCapture";
import NuvoSheet from "./NuvoSheet";
import MobileTaskSheet from "./MobileTaskSheet";
import { useWeekCommitAct } from "../tasks/TaskActionsMenu";
import { MobileOpenTaskContext } from "./openTask";
import MobileEventSheet, { type CalendarTap } from "./MobileEventSheet";

const MemoryPage = lazy(() => import("../memory/MemoryPage"));
const RhythmIntro = lazy(() => import("../memory/RhythmIntro"));

// Top-level destinations — the five surfaces you work from on the phone, the
// desktop altitudes in order: Calendar · Tasks, then the three strategic ones —
// Projects, Initiatives and the anchor they all hang off, Domains. Capture (＋)
// and Nuvo (✦) are *actions*, not places, so they float above the bar instead of
// taking a slot; Nuvo opens as an overlay over whatever screen you're on, so its
// answers carry that screen's context.
type Tab = "calendar" | "tasks" | "projects" | "initiatives" | "domains";
const EMPTY_SLOT_ROWS: Slot[] = [];
const TAB_KEY = "nuvo-mobile-tab-v3";
const TAB_KEY_V2 = "nuvo-mobile-tab-v2"; // pre-redesign: now|calendar|tasks|plan|nuvo
const SUB_KEY = "nuvo-mobile-tasksub";
const LEGACY_KEY = "nuvo-mobile-tab"; // pre-v2: now|today|week|inbox

// The glyphs are the shared altitude family (`components/icons.tsx`) — the same
// set the desktop spine and the command palette draw from, so a project looks
// like a project on every surface.
const NAV: { id: Tab; label: string; kind: AltitudeKind }[] = [
  { id: "calendar", label: "Calendar", kind: "day" },
  { id: "tasks", label: "Tasks", kind: "task" },
  // The concrete near-term unit (weeks) and the longer multi-facet arc (quarters),
  // each opening to its read-first On Deck.
  { id: "projects", label: "Projects", kind: "project" },
  { id: "initiatives", label: "Initiatives", kind: "initiative" },
  // The anchor — the fixtures everything else hangs off. Read-first like the
  // other two, and the one altitude measured by presence, not throughput.
  { id: "domains", label: "Domains", kind: "domain" },
];

const SUBTABS: { id: MobileTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "inbox", label: "Inbox" },
];

const isTab = (v: string | null): v is Tab => !!v && NAV.some((t) => t.id === v);

// Read the active tab, migrating older single-key state forward once. The v2 nav
// had a "plan" tab (now split into Projects/Initiatives) and a "nuvo" tab (now a
// floating overlay); the "now" tab was retired with the Today rung. All of them
// fold back to a live destination.
function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (isTab(v)) return v;
    const v2 = localStorage.getItem(TAB_KEY_V2);
    if (v2 === "plan") return "projects";
    if (v2 === "nuvo" || v2 === "now") return "calendar";
    if (isTab(v2)) return v2; // calendar | tasks carry over unchanged
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "now") return "calendar";
    if (legacy === "today" || legacy === "week" || legacy === "inbox") return "tasks";
  } catch {
    /* ignore */
  }
  return "calendar";
}

function readSub(): MobileTab {
  try {
    const v = localStorage.getItem(SUB_KEY) as MobileTab | null;
    if (v && SUBTABS.some((t) => t.id === v)) return v;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "today" || legacy === "week" || legacy === "inbox") return legacy;
  } catch {
    /* ignore */
  }
  return "today";
}

const TAB_HERO: Record<Tab, string> = {
  calendar: "Calendar",
  tasks: "Tasks",
  projects: "Projects",
  initiatives: "Initiatives",
  domains: "Domains",
};

export default function MobileShell() {
  const [tab, setTabState] = useState<Tab>(readTab);
  const [sub, setSubState] = useState<MobileTab>(readSub);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // The tab the session opened on — what the root history entry (which carries
  // no nuvoTab payload) means when back walks all the way down.
  const launchTab = useRef(tab);
  const setTab = (t: Tab) => {
    // Each destination change gets a history entry, so hardware back walks the
    // tab trail before it can leave the app.
    if (t !== tabRef.current) history.pushState({ nuvoTab: t }, "");
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  // Restore the tab a popped history entry names. Overlay-level entries are
  // owned by useMobileOverlayHistory; entries with neither payload are the root.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = e.state as { nuvoTab?: string; nuvoOverlay?: string } | null;
      if (s?.nuvoOverlay) return;
      const t = isTab(s?.nuvoTab ?? null) ? (s!.nuvoTab as Tab) : launchTab.current;
      if (t !== tabRef.current) {
        setTabState(t);
        try {
          localStorage.setItem(TAB_KEY, t);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const setSub = (s: MobileTab) => {
    setSubState(s);
    try {
      localStorage.setItem(SUB_KEY, s);
    } catch {
      /* ignore */
    }
  };


  // Capture — ONE sheet for both kinds (D-125). `null` is shut; a kind is the
  // face it opens on. `at` is a tap on empty Day-canvas time (D-130) — the
  // same door, already told when.
  const [capture, setCapture] = useState<{
    kind: CaptureKind;
    at?: { start: Date; durationMinutes: number };
  } | null>(null);
  // Plan the week — the phone's weekly ritual, a full-screen overlay like the chat.
  const [planOpen, setPlanOpen] = useState(false);
  // Get ready (D-206) — the crown's door: a sheet of cards that take the week to ready.
  const [readyOpen, setReadyOpen] = useState(false);
  // The Nuvo chat overlay — a floating action, reachable over any screen.
  const [nuvoOpen, setNuvoOpen] = useState(false);
  // Memory (docs/memory.md §4.1): on the phone its dot rides the ✦, and it opens
  // from the chat's header.
  const memory = useMemory();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [calendarTap, setCalendarTap] = useState<CalendarTap | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"appearance" | "apps">("appearance");
  const [upkeepOpen, setUpkeepOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // A strategic-vertical detail to open in the shared Sheet — from a tab row or a
  // global-search jump. `detailFrame` mirrors the Sheet's current breadcrumb frame
  // so the agent's screen context follows you into the item.
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);
  const [detailFrame, setDetailFrame] = useState<Frame | null>(null);

  // Every overlay is history-backed: Android hardware-back and the iOS
  // standalone back-swipe close the top overlay instead of exiting the app.
  // (detailTarget is handled inside MobileDetailSheet, which also gives each
  // breadcrumb frame its own entry via useMobileSheetStackHistory.)
  useMobileOverlayHistory(nuvoOpen, () => setNuvoOpen(false), "nuvo");
  useMobileOverlayHistory(memoryOpen, () => setMemoryOpen(false), "memory");
  useMobileOverlayHistory(planOpen, () => setPlanOpen(false), "plan");
  useMobileOverlayHistory(readyOpen, () => setReadyOpen(false), "ready");
  useMobileOverlayHistory(Boolean(capture), () => setCapture(null), "capture");
  useMobileOverlayHistory(Boolean(taskId), () => setTaskId(null), "task");
  useMobileOverlayHistory(Boolean(calendarTap), () => setCalendarTap(null), "event");
  // A task on the calendar opens the SAME sheet a task opens anywhere (D-111,
  // D-162) — it had its own thinner "Task block" sheet with an "Edit task" door
  // into the real one. Events and standing blocks keep theirs.
  const openTap = (tap: CalendarTap) => {
    if (tap.kind === "block") setTaskId(tap.taskId);
    else setCalendarTap(tap);
  };
  useMobileOverlayHistory(settingsOpen, () => setSettingsOpen(false), "settings");
  useMobileOverlayHistory(upkeepOpen, () => setUpkeepOpen(false), "upkeep");
  useMobileOverlayHistory(searchOpen, () => setSearchOpen(false), "search");

  // What the Calendar is looking at — its hero, handed up so the top bar can
  // print it in the slot every other tab already reserves for a date, and so a
  // capture from that tab files to the day on screen (D-125).
  const [calHero, setCalHero] = useState<CalHero | null>(null);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Every door that opens the phone somewhere other than your last tab lands
  // here — the PWA manifest shortcuts, the iOS widgets' `nuvo://` links, and
  // whatever App Intents add next. One applier, so a lock-screen ＋ and a
  // long-pressed icon can't drift into meaning different things.
  const applyShortcut = useCallback((act: Shortcut) => {
    if (act === "capture") {
      setNuvoOpen(false);
      setCapture({ kind: "task" });
    } else if (act === "chat") {
      // The widget and icon shortcut still say "chat" (installed phones keep
      // their links); it opens the ✦'s sheet — Memory and Connect (D-205).
      setCapture(null);
      setNuvoOpen(true);
    } else {
      setTabState("tasks");
      setSubState("today");
    }
  }, []);

  // Manifest shortcuts (long-press the installed app's icon). Consumed once,
  // then stripped from the URL so a reload doesn't re-open the overlay.
  const shortcutDone = useRef(false);
  useEffect(() => {
    if (shortcutDone.current) return;
    shortcutDone.current = true;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("shortcut")) return;
    const act = shortcutFromUrl(url.href);
    url.searchParams.delete("shortcut");
    window.history.replaceState(history.state, "", url);
    if (act) applyShortcut(act);
  }, [applyShortcut]);

  // The native shell's deep links — what the lock-screen widgets actually fire
  // (`nuvo://capture`, `nuvo://chat`). Two paths, because a cold launch and a
  // resume deliver the URL differently: `getCurrent()` reads the link the app
  // was *started* by, `onOpenUrl` catches every one after that. Loaded lazily so
  // the PWA/web bundle never pulls the Tauri plugin in.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let done = false;
    const open = (urls: string[] | null) => {
      if (done || !urls?.length) return;
      const act = shortcutFromUrl(urls[urls.length - 1]);
      if (!act) return;
      done = true;
      applyShortcut(act);
    };
    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        unlisten = await onOpenUrl((urls) => {
          done = false; // a fresh tap is a fresh act
          open(urls);
        });
        open(await getCurrent());
      } catch {
        /* no deep-link plugin (older shell / web) — the ＋ and ✦ still work */
      }
    })();
    return () => unlisten?.();
  }, [applyShortcut]);

  // Filters (audit rank 6) — the phone's half. Same hook, same kernel predicate
  // and the same saved views the desktop rail reads; only the frame differs
  // (a bottom Sheet, never a cursor-anchored popover).
  const filter = useTaskFilter(now);
  const filtering = queryFacetCount(filter.query) > 0;

  // Multi-select — the phone had none, so every bulk verb was desktop-only
  // (audit §Bulk actions). Entered by HOLDING a row, the same 450ms gesture the
  // record sheet and the deck already use; a tap then toggles.
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const clearPicked = useCallback(() => setPickedIds(new Set()), []);
  // Selecting is per-screen: leaving the Tasks screen (or changing segment)
  // drops it, so a selection can never act on rows you can no longer see.
  useEffect(() => {
    setPickedIds(new Set());
  }, [tab, sub]);

  const today = todayISO(now);
  const range = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: new Date(start.getTime() + 24 * 3600_000).toISOString() };
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps

  const { settings, update: updateSettings } = useSettings();
  const { data: vertical, ready: verticalReady } = useVertical();
  const { data: inbox = [], isPending: inboxPending } = useInboxTasks();
  const { data: todayTasks = [], isPending: todayPending } = useDayTasks(today);
  const { data: weekTasks = [], isPending: weekPending } = useSprintTasks(vertical.sprint?.id ?? null);
  const { data: allTasks = [] } = useAllTasks();
  // The floor under delete. Its own query (every other read excludes trashed
  // rows), and the lens that reveals it appears only when it holds something.
  const { data: trashed = [] } = useTrashedTasks();
  // The trash lens can vanish under the thumb — restore the last row, or empty
  // it — and a segmented control left on a segment that no longer exists shows
  // an empty screen with no way back.
  useEffect(() => {
    if (sub === "trash" && trashed.length === 0) setSub("today");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, trashed.length]);

  const { labels } = useLabels();
  const { data: accounts = [] } = useCalendarAccounts();
  const mutations = useTaskMutations();
  const slotMutations = useSlotMutations();
  const recurrenceMutations = useRecurrenceMutations();
  // Commit to / off this week, from the task sheet — the desktop menu's act.
  const weekCommit = useWeekCommitAct(mutations);
  const { setRange, setNavFocus } = useAgentContext();
  useEffect(() => {
    setRange(range);
  }, [range, setRange]);

  // Live screen context to the agent: the current tab, or — when a vertical detail
  // is open — that item plus its parents. Set even while the chat is closed; it's
  // only read on the next send, so the context is already right when you summon it.
  useEffect(() => {
    setNavFocus(navFocusFor(tab, detailFrame, vertical));
  }, [tab, detailFrame, vertical, setNavFocus]);

  useRealtime(true);

  // Keep data fresh the way the desktop Planner does: roll overdue tasks forward
  // and materialize recurrences on load and whenever the app returns to focus.
  // Debounced: every foreground already triggers a full TanStack refetch and a
  // Realtime reconnect, so re-running the heavy resume work on each of several
  // quick app switches was pure waste — rollover runs at most once a minute,
  // materializeAll at most once per day.
  const rollover = useRolloverGuard(settings?.last_rollover_date);
  const settingsLoaded = Boolean(settings);
  const lastResume = useRef(0);
  const lastMaterializeDay = useRef<string | null>(null);
  useEffect(() => {
    if (!settingsLoaded) return;
    const resume = () => {
      const nowMs = Date.now();
      if (nowMs - lastResume.current < 60_000) return;
      lastResume.current = nowMs;
      const day = todayISO(new Date());
      const materialize = lastMaterializeDay.current !== day;
      void (async () => {
        await rollover();
        // Record the day only once it actually ran. `materializeAll` declines
        // when the occurrence pool has not loaded, and marking that as done
        // would suppress every retry for the rest of the day.
        if (materialize && (await recurrenceMutations.materializeAll())) {
          lastMaterializeDay.current = day;
        }
      })();
    };
    resume();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      resume();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, today]);

  // Include every task so a global-search result (which can be any task) always
  // resolves to a row the task sheet can open.
  const taskById = useMemo(
    () => mergeTaskLists([inbox, todayTasks, weekTasks, allTasks]),
    [inbox, todayTasks, weekTasks, allTasks],
  );
  const openTask = taskId ? taskById.get(taskId) ?? null : null;

  // Today's slots, and today's list WITH what's inside them. The day query leaves
  // slot children out ("they show inside their slot"), and the Tasks screen had no
  // slot to show them inside — so a task you'd put in this morning's block was not
  // on Today at all, and the count under the segment was short by exactly that
  // many (D-178). Same assembly the desktop rail uses.
  const { data: slotRows = EMPTY_SLOT_ROWS } = useSlots(range.start, range.end);
  const todaySlots = useMemo(() => slotRows.filter((s) => s.do_date === today), [slotRows, today]);
  const todayForList = useMemo(
    () =>
      todayWithSlotChildren({
        dayRows: todayTasks,
        slotChildren: allTasks.filter((t) => t.slot_id),
        slots: todaySlots,
        today,
        resolve: (raw) => taskById.get(raw.id),
      }),
    [todayTasks, allTasks, todaySlots, today, taskById],
  );
  const slotTitle = useCallback(
    (s: Slot, kids: Task[]) => deriveSlotTitle(s, kids, vertical),
    [vertical],
  );

  // The bulk bar's acts — the same hook the desktop rail uses, so a phone bulk
  // move files the initiative and domain alongside the project (D-088) and the
  // whole set undoes in one step.
  const bulkOps = useBulkOps({
    selected: [...pickedIds].map((id) => taskById.get(id)).filter((t): t is Task => !!t),
    mutations,
    clear: clearPicked,
  });

  // The calendar tap's slot children — `allTasks` (useAllTasks) has no
  // start_time filter, so a slot's members (start_time forced null by
  // assignToSlot) are already in it; just filter by slot_id.
  const slotChildTasks = useMemo(
    () => (calendarTap?.kind === "slot" ? allTasks.filter((t) => t.slot_id === calendarTap.slot.id) : []),
    [allTasks, calendarTap],
  );

  const subCount = (s: MobileTab) =>
    s === "inbox"
      ? inbox.length
      : s === "trash"
        ? trashed.length
        : s === "week"
          ? weekTasks.filter((x) => x.status !== "done").length
          : todayForList.filter((x) => x.status !== "done").length;

  // Per-tab scroll restoration: leaving a tab remembers your place; returning
  // restores it. Only re-tapping the ACTIVE tab scrolls to top (the platform
  // idiom). Keyed by tab+sub so the three Tasks segments hold separate places.
  // The offset is recorded live on scroll — reading it at switch time could
  // only see a value already clamped to the next tab's content height.
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollOffsets = useRef<Record<string, number>>({});
  // While a restore is in flight the remounting tab's content is still growing
  // (queries resolving), so the browser clamps the scroll to 0 — that clamp
  // must neither stick nor overwrite the saved offset. Retry for a beat and
  // ignore recorded values inside the window.
  const restoringUntil = useRef(0);
  const recordScroll = () => {
    const el = scrollRef.current;
    if (!el || Date.now() < restoringUntil.current) return;
    scrollOffsets.current[`${tab}:${sub}`] = el.scrollTop;
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = scrollOffsets.current[`${tab}:${sub}`] ?? 0;
    restoringUntil.current = Date.now() + 600;
    let raf = 0;
    const attempt = () => {
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) > 1 && Date.now() < restoringUntil.current) {
        raf = requestAnimationFrame(attempt);
      } else {
        restoringUntil.current = 0;
      }
    };
    attempt();
    return () => cancelAnimationFrame(raf);
  }, [tab, sub]);
  const scrollToTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });

  // Pull down from the top of any tab to refetch. The deck tabs scroll inside
  // their own pages, so the touch's nearest scroller is consulted, not <main>.
  const { pulling, refreshing } = usePullToRefresh(
    scrollRef,
    "[data-deck-col], .mobile-scroll",
  );

  // The ✦: the door to Memory and Connect an assistant (D-205), in a bottom
  // sheet. Nuvo's offers ride the rows they change, not this sheet.
  const openNuvo = () => setNuvoOpen(true);

  // Open a strategic-vertical item in the shared detail Sheet (nonce so the same
  // id re-fires). Used by the Projects/Initiatives tabs and global search alike.
  const openDetail = (kind: DetailTarget["kind"], id: string) => {
    setDetailTarget({ kind, id, n: Date.now() });
  };
  const closeDetail = () => {
    setDetailTarget(null);
    setDetailFrame(null);
  };

  // Global-search jumps: a vertical item opens its detail Sheet over the current
  // tab; a task opens the task sheet.
  const openPlanItem = (kind: JumpKind, id: string) => {
    setSearchOpen(false);
    openDetail(kind, id);
  };
  const openTaskFromSearch = (id: string) => {
    setSearchOpen(false);
    setTaskId(id);
  };
  // A calendar hit lands on the Calendar tab, on that day. The reveal is
  // published BEFORE the tab switch so `MobileCalendar` finds it pending when it
  // mounts — the same drain the desktop pane does (lib/calendarReveal.ts).
  const openEventFromSearch = (hit: EventHit) => {
    revealOnCalendar({ dateISO: eventHitDateISO(hit), eventId: hit.id });
    setSearchOpen(false);
    setTab("calendar");
  };

  // Route a readiness "turn" to the surface that resolves it.
  const reviewFloor = (floor: Floor) => {
    if (floor === "project") setTab("projects");
    else if (floor === "domain") setTab("domains");
    else if (floor === "initiative") setTab("initiatives");
    else {
      setSub("today");
      setTab("tasks");
    }
  };


  return (
    // Pin to the layout viewport with `fixed inset-0` rather than a percentage/
    // dvh height: on iOS standalone PWAs `100dvh`/`innerHeight` can resolve to the
    // shorter *dynamic* viewport, floating the bottom nav above the screen edge
    // with a dead strip of body background beneath it. The layout viewport (what
    // fixed positioning fills) is the true full-screen box, so the nav sits flush.
    <MobileOpenTaskContext.Provider value={setTaskId}>
    <div className="atmosphere fixed inset-0 flex flex-col">
      {/* The top bar — every tab's one hero (30px), then one line of fact.
          On the Calendar the hero is the SPAN you are looking at, handed up by
          the Calendar (`onHero`, D-125) — what a calendar's title bar says on
          every phone ever made — and the fact is its read. Everywhere else it is
          the place you are, over today's date. The fact row is always mounted
          (an empty one holds its height), so changing tab or lens never moves
          the content under the bar (D-123). */}
      <PhoneTopBar
        hero={tab === "calendar" ? calHero : null}
        title={TAB_HERO[tab]}
        fact={format(now, "EEEE, MMMM d")}
        onSearch={() => setSearchOpen(true)}
        onToggleTheme={() =>
          updateSettings({
            theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
          })
        }
        onSettings={() => setSettingsOpen(true)}
      />

      <TrialBanner />

      {/* No sync strip here. Queued work drains within a beat, so a strip in
          normal flow above the content shoved the whole app down and back on
          every write — chrome the user paid for constantly to be told
          something they never had to act on. The queue now lives in
          Settings → About → Sync, and only a *refused* write interrupts, as a
          floating toast (see SyncPanel / useParkedAlert, D-095). */}

      {/* Content */}
      <main ref={scrollRef} onScroll={recordScroll} className="mobile-scroll relative min-h-0 flex-1 overflow-y-auto">
        <PullIndicator pulling={pulling} refreshing={refreshing} />
        {tab === "calendar" && <MobileRepairCard now={now} />}
        {tab === "calendar" ? (
          <MobileCalendar
            now={now}
            onTapEvent={openTap}
            onTapTask={(id) => setTaskId(id)}
            // Ticking a task from a list row is the same act as anywhere else.
            onToggleTask={(id, done) => {
              const t = taskById.get(id);
              if (!t) return;
              if (done) mutations.complete(t);
              else mutations.uncomplete(t);
            }}
            onTapEmpty={(start) =>
              setCapture({
                kind: "task",
                at: {
                  start,
                  durationMinutes: settings?.default_task_duration_minutes ?? DEFAULT_DURATION_MINUTES,
                },
              })
            }
            draft={capture?.at ?? null}
            defaultDurationMins={settings?.default_task_duration_minutes ?? DEFAULT_DURATION_MINUTES}
            // The span the top bar prints, and the day a capture files to.
            // The Calendar hands its hero up rather than drawing a row of its
            // own for it (D-125).
            onHero={setCalHero}
            // The week crown's three doors: a project opens its record sheet, a
            // piece of its work opens its task sheet (where it gets a time), and
            // the door opens the same ritual the Week segment's card does — no
            // second copy of any of them.
            onOpenProject={(id) => openDetail("project", id)}
            onPlanWeek={() => setPlanOpen(true)}
            onGetReady={() => setReadyOpen(true)}
            // ONE task grammar (D-111). A project's work in the crown is the same
            // `TaskRow` as the Tasks screen's, so it can be ticked from here — it
            // used to be a bare button with a truncated title and no checkbox.
            // The shell owns it because the shell owns the mutations and the task
            // sheet, the way `LeftRail` owns it on the desktop.
            //
            // No `meta`: inside a project's group the row's place is what you
            // opened to get here. No `swipeActions`: the calendar under this
            // crown pages horizontally, and swipe-to-defer would fight the pager.
            renderCrownTask={(t, { action, whenShown }) => (
              <TaskRow
                key={t.id}
                task={t}
                labels={labels}
                now={now}
                selected={false}
                draggable={false}
                action={action}
                whenShown={whenShown}
                onSelect={() => {}}
                onOpen={() => setTaskId(t.id)}
                onToggleDone={() => (t.status === "done" ? mutations.uncomplete(t) : mutations.complete(t))}
              />
            )}
          />
        ) : tab === "projects" ? (
          <MobileProjects onOpenItem={openDetail} />
        ) : tab === "initiatives" ? (
          <MobileInitiatives onOpenItem={openDetail} />
        ) : tab === "domains" ? (
          <MobileDomains onOpenItem={openDetail} />
        ) : (
          <div className="fab-clear">
            <TaskSubtabs
              sub={sub}
              setSub={setSub}
              count={subCount}
              showTrash={trashed.length > 0}
              filter={
                // Inert on Trash for the same reason as the desktop rail: the
                // trash is a recovery surface, and a filtered one could hide the
                // row you came back for. On a phone this opens a Sheet, never a
                // cursor-anchored popover.
                sub === "trash" ? null : (
                  <TaskFilter
                    query={filter.query}
                    onChange={filter.setQuery}
                    labels={labels}
                    vertical={vertical}
                    savedViews={filter.savedViews}
                    onSaveView={filter.saveView}
                    onDeleteView={filter.deleteView}
                    onApplyView={filter.applyView}
                  />
                )
              }
            />
            {/* The week's read, above the week's list — both are week-scoped, so
                they sit at the top of the Week segment rather than on an
                execution screen. */}
            {sub === "week" && verticalReady && (
              <div className="flex flex-col gap-3 px-4 pt-4">
                <MobileReadiness data={vertical} onPlanWeek={() => setPlanOpen(true)} onReview={reviewFloor} />
                {/* One primary card per state (plan vs review), the other a
                    quiet link — see WeekCompanions. */}
                <WeekCompanions onOpenPlan={() => setPlanOpen(true)} />
              </div>
            )}
            <MobileTaskList
              tab={sub}
              inbox={filtering ? filter.apply(inbox) : inbox}
              today={filtering ? filter.apply(todayForList) : todayForList}
              slots={todaySlots}
              slotTitle={slotTitle}
              onOpenSlot={(run, title) => {
                const start = new Date(run.slot.start_time);
                setCalendarTap({
                  kind: "slot",
                  slot: run.slot,
                  title,
                  start,
                  end: new Date(start.getTime() + run.slot.duration_minutes * 60_000),
                  childCount: run.open.length + run.doneCount,
                  doneCount: run.doneCount,
                });
              }}
              week={filtering ? filter.apply(weekTasks) : weekTasks}
              trashed={trashed}
              filterNote={
                filtering
                  ? describeQuery(filter.query, {
                      label: (id) => labels.find((l) => l.id === id)?.name,
                      domain: (id) => vertical?.domains.find((d) => d.id === id)?.name,
                    })
                  : null
              }
              labels={labels}
              vertical={vertical}
              mutations={mutations}
              now={now}
              onTapTask={(t) => setTaskId(t.id)}
              onRestored={(face) => setSub(face)}
              selection={
                sub === "trash"
                  ? undefined
                  : {
                      ids: pickedIds,
                      begin: (id) => setPickedIds((s) => new Set(s).add(id)),
                      toggle: (id) =>
                        setPickedIds((s) => {
                          const next = new Set(s);
                          next.has(id) ? next.delete(id) : next.add(id);
                          return next;
                        }),
                      toggleMany: (ids) => setPickedIds((s) => toggleGroup(s, ids)),
                    }
              }
              pending={
                sub === "inbox" ? inboxPending : sub === "week" ? weekPending || !verticalReady : todayPending
              }
            />
          </div>
        )}
      </main>

      {/* Bulk actions — the same bar the desktop rail uses, sitting directly on
          the nav so it reads as a temporary mode over the screen rather than a
          floating card. Its menus open as Sheets on a phone (BulkBar). */}
      {pickedIds.size > 0 && (
        <BulkBar count={pickedIds.size} ops={bulkOps} labels={labels} vertical={vertical} />
      )}

      {/* Bottom bar — the five navigation destinations, equal width. Capture (＋) and Nuvo
          (✦) float above the bar as the two primary *actions* (bottom-right thumb
          arc), so the row stays even and the bold accent belongs to capture. */}
      {/* Bottom bar — the five places, equal width. Capture (＋) and Nuvo (✦)
          float above its right end as the two primary *actions* (the thumb's
          arc), so the row stays even and the accent belongs to capture. They
          stand down while a bulk selection is live, for the same reason they do
          for the chat: they float over the bottom-right, which is exactly where
          the bulk bar's last actions sit. */}
      <PhoneNav
        places={NAV}
        current={tab}
        onPick={(id) => (tab === id ? scrollToTop() : setTab(id))}
        badge={(id) => (id === "tasks" ? inbox.length : 0)}
        onCapture={!nuvoOpen && pickedIds.size === 0 ? () => setCapture({ kind: "task" }) : undefined}
        onAskNuvo={!nuvoOpen && pickedIds.size === 0 ? openNuvo : undefined}
        nuvoDot={memory.hasNew}
      />

      {nuvoOpen && (
        <NuvoSheet
          memoryNew={memory.hasNew}
          onClose={() => setNuvoOpen(false)}
          onMemory={() => {
            setNuvoOpen(false);
            setMemoryOpen(true);
          }}
          onConnect={() => {
            setNuvoOpen(false);
            setSettingsSection("apps");
            setSettingsOpen(true);
          }}
        />
      )}
      {memoryOpen && (
        <Suspense fallback={null}>
          <MemoryPage memory={memory} onClose={() => setMemoryOpen(false)} />
        </Suspense>
      )}
      {memory.available && !memory.introduced && (
        <Suspense fallback={null}>
          <RhythmIntro />
        </Suspense>
      )}

      {/* Plan the week — the ritual, full-screen over the shell */}
      {planOpen && <MobilePlanWeek onClose={() => setPlanOpen(false)} onOpenProject={(id) => openDetail("project", id)} />}

      {/* Get ready — the crown's door (D-206), a bottom sheet of cards */}
      {readyOpen && (
        <MobileGetReady
          now={now}
          learned={memory}
          onClose={() => setReadyOpen(false)}
          onPlanWeek={() => setPlanOpen(true)}
          onOpenProject={(id) => openDetail("project", id)}
        />
      )}

      {/* Sheets */}
      {detailTarget && (
        <MobileDetailSheet target={detailTarget} onClose={closeDetail} onFrameChange={setDetailFrame} />
      )}
      {capture && (
        <MobileCapture
          onClose={() => setCapture(null)}
          initialKind={capture.kind}
          initialStart={capture.at?.start ?? null}
          initialDurationMinutes={capture.at?.durationMinutes ?? null}
          // The day the screen is about. On the Calendar that is the day you
          // travelled to, not today: you are looking at the 12th because the
          // 12th is what you're thinking about, and filing the thought to
          // today would be the app ignoring where you stand. A canvas tap
          // already stamped its own day onto `initialStart`.
          defaultDoDate={
            capture.at
              ? toDateISO(capture.at.start)
              : tab === "calendar"
                ? toDateISO(calHero?.date ?? now)
                : tab === "tasks" && sub === "today"
                  ? today
                  : null
          }
        />
      )}
      {openTask && (
        <MobileTaskSheet
          task={openTask}
          labels={labels}
          vertical={vertical}
          mutations={mutations}
          slotMutations={slotMutations}
          accent={taskDomainColor(vertical, openTask)}
          onClose={() => setTaskId(null)}
          onToggleWeek={weekCommit}
        />
      )}
      {calendarTap && (
        <MobileEventSheet
          tap={calendarTap}
          slotChildren={calendarTap.kind === "slot" ? slotChildTasks : undefined}
          labels={labels}
          mutations={mutations}
          onClose={() => setCalendarTap(null)}
          onEditTask={(id) => { setCalendarTap(null); setTaskId(id); }}
        />
      )}
      {searchOpen && (
        <MobileSearch
          vertical={vertical}
          tasks={allTasks}
          onOpenItem={openPlanItem}
          onOpenTask={openTaskFromSearch}
          onOpenEvent={openEventFromSearch}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          updateSettings={updateSettings}
          accounts={accounts}
          section={settingsSection}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsSection("appearance");
          }}
          // Settings → Schedule is where recurring upkeep lives on the phone
          // now (D-123). Close Settings on the way so two full-screen overlays
          // are never stacked — back then returns to the tab, not to a modal.
          onOpenUpkeep={() => {
            setSettingsOpen(false);
            setUpkeepOpen(true);
          }}
        />
      )}
      {upkeepOpen && <RecurringUpkeepPanel onClose={() => setUpkeepOpen(false)} />}

      {/* First-run welcome — the Calendars CTA opens Settings (tap through to
          Connections). */}
      <Orientation onAction={() => setSettingsOpen(true)} mobile />
    </div>
    </MobileOpenTaskContext.Provider>
  );
}

// The agent's "where am I" context. A vertical detail overrides the tab, carrying
// the item plus its parents. Nothing in the app sends a message with it since the
// chat went (D-200); kept because the walkthrough still reads the agent context.
function navFocusFor(
  tab: Tab,
  frame: Frame | null,
  d: ReturnType<typeof useVertical>["data"],
) {
  if (frame && frame.level !== "list") {
    if (frame.level === "project") {
      const p = d.projects.find((x) => x.id === frame.id);
      return { rung: "project", projectId: frame.id, initiativeId: p?.initiativeId ?? undefined, domainId: p?.domainId ?? undefined };
    }
    if (frame.level === "initiative") {
      const i = d.initiatives.find((x) => x.id === frame.id);
      return { rung: "initiative", initiativeId: frame.id, domainId: i?.domainId ?? undefined };
    }
    return { rung: "domain", domainId: frame.id };
  }
  switch (tab) {
    case "projects":
      return { rung: "project" };
    case "initiatives":
      return { rung: "initiative" };
    case "domains":
      return { rung: "domain" };
    default:
      return { rung: "day" };
  }
}

// The Today / Week / Inbox lens switch inside the Tasks screen.
function TaskSubtabs({
  sub,
  setSub,
  count,
  showTrash = false,
  filter,
}: {
  sub: MobileTab;
  setSub: (s: MobileTab) => void;
  count: (s: MobileTab) => number;
  /** The trash holds something, so its icon is reachable. */
  showTrash?: boolean;
  /** The filter control, rendered at the end of the strip. Null on Trash. */
  filter?: React.ReactNode;
}) {
  const trashOn = sub === "trash";
  const trashCount = count("trash");
  // On Trash no segment is lit — the trough still shows where the three faces
  // are, and tapping one goes back.
  const face = (trashOn ? "" : sub) as MobileTab;
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-[var(--line-1)] bg-[var(--panel)] py-2 pl-4 pr-2">
      <div className="min-w-0 flex-1">
        <TouchSegmented<MobileTab>
          full
          label="Tasks"
          value={face}
          onChange={setSub}
          options={SUBTABS.map((t) => ({
            value: t.id,
            label: (
              <>
                {t.label}
                <SegCount n={count(t.id)} />
              </>
            ),
          }))}
        />
      </div>
      {showTrash && (
        // Recovery, not a fourth peer of Today · Week · Inbox (D-136). The
        // count lives in the name, not the chrome — "Trash 52" was a retention
        // log wearing a navigation face.
        <IconButton
          label={`Trash · ${trashCount >= TRASH_LIMIT ? `${TRASH_LIMIT}+` : trashCount}`}
          aria-pressed={trashOn}
          active={trashOn}
          size="md"
          icon={<Icon name="trash" size={18} />}
          onClick={() => setSub("trash")}
          className="tap-icon shrink-0"
        />
      )}
      {filter}
    </div>
  );
}
