import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
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
import { useRealtime } from "../../hooks/useRealtime";
import { useAgentContext } from "../../hooks/useAgentContext";
import { taskDomainColor } from "../../lib/vertical";
import { mergeTaskLists } from "../../lib/taskMerge";
import { isTauri } from "../../lib/platform";
import { shortcutFromUrl, type Shortcut } from "../../lib/shortcuts";
import type { Floor } from "../../lib/readiness";
import type { AgentHintContext } from "../../lib/agentHints";
import { DEFAULT_DURATION_MINUTES, type Task } from "../../lib/types";
import SettingsModal from "../SettingsModal";
import { AltitudeIcon, type AltitudeKind } from "../icons";
import { TrialBanner } from "../billing/TrialBanner";
import Orientation from "../orientation/Orientation";
import MobileTaskList, { type MobileTab } from "./MobileTaskList";
import TaskFilter from "../TaskFilter";
import BulkBar from "../BulkBar";
import { useBulkOps } from "../../hooks/useBulkOps";
import { useTaskFilter } from "../../hooks/useTaskFilter";
import { describeQuery, queryFacetCount } from "../../lib/taskFilter";
import MobileCalendar from "./MobileCalendar";
import type { CalHero } from "./CalendarChrome";
import TaskRow from "../TaskRow";
import RecurringUpkeepPanel from "../RecurringUpkeepPanel";
import MobileProjects from "./MobileProjects";
import MobileInitiatives from "./MobileInitiatives";
import MobileDomains from "./MobileDomains";
import MobileReadiness from "./MobileReadiness";
import { WeekCompanions } from "./WeekPlanCard";
import MobilePlanWeek from "./MobilePlanWeek";
import MobileSearch, { type JumpKind } from "./MobileSearch";
import { revealOnCalendar } from "../../lib/calendarReveal";
import { eventHitDateISO, type EventHit } from "../../lib/eventSearch";
import PullIndicator from "./PullIndicator";
import MobileDetailSheet from "./detail/MobileDetailSheet";
import type { DetailTarget, Frame } from "./detail/verticalDetail";
import MobileCapture, { type CaptureKind } from "./MobileCapture";
import ChatPane from "./ChatPane";
import MobileTaskSheet from "./MobileTaskSheet";
import MobileEventSheet, { type CalendarTap } from "./MobileEventSheet";

// Top-level destinations — the five surfaces you work from on the phone, the
// desktop altitudes in order: Calendar · Tasks, then the three strategic ones —
// Projects, Initiatives and the anchor they all hang off, Domains. Capture (＋)
// and Nuvo (✦) are *actions*, not places, so they float above the bar instead of
// taking a slot; Nuvo opens as an overlay over whatever screen you're on, so its
// answers carry that screen's context.
type Tab = "calendar" | "tasks" | "projects" | "initiatives" | "domains";
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

// Trash is the fourth lens, and it only exists when it holds something — a
// permanently visible fourth segment would tax a three-segment control for a
// face most days never need (P9, P10).
const TRASH_SUBTAB: { id: MobileTab; label: string } = { id: "trash", label: "Trash" };

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

/**
 * The Calendar's hero, in the top bar.
 *
 * It had a row of its own inside the Calendar's chrome — 40px on the phone's
 * most contested screen — and on the Week lens it spent them saying "This week"
 * directly above a crown strip already saying "This week". Up here it costs
 * nothing: this slot exists on every other tab to print today's date.
 *
 * Still Fraunces, because it is still the hero, and still the jump-anywhere
 * door: tapping it opens the OS date picker, which is the only way to reach a
 * date that is more than a few swipes away.
 */
function CalendarTitle({ hero }: { hero: CalHero }) {
  const jumpRef = useRef<HTMLInputElement>(null);
  const canJump = Boolean(hero.date);

  const inner = (
    <>
      {/* The hero is bounded by this surface's own vocabulary — "Today",
          "This week", "September 30" — so it takes the room it needs and the
          FACT is what gives way. The other way round truncated "Agenda" to
          "Age…" beside a full-width span, which is the wrong half to lose. */}
      <span className="masthead shrink-0 text-head text-ink">{hero.hero}</span>
      {hero.fact && (
        <span
          className="mono min-w-0 truncate text-label"
          style={{ color: hero.factAccent ? "var(--accent)" : "var(--muted)" }}
        >
          {hero.fact}
        </span>
      )}
    </>
  );

  if (!canJump) return <div className="flex min-w-0 items-baseline gap-1.5">{inner}</div>;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const el = jumpRef.current;
          if (!el) return;
          // `showPicker` where it exists (iOS 16+, every engine we ship on);
          // focus is the honest fallback rather than a dead hero.
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
        aria-label={`${hero.hero} — jump to another date`}
        className="tap-h fast flex min-w-0 items-baseline gap-1.5 rounded-lg px-1 text-left active:bg-surface-2"
      >
        {inner}
      </button>
      {/* `sr-only` and opened by the button above: iOS paints a date input's own
          value at the control's intrinsic width while its picker is open, which
          used to smear "Aug 17," across the header. */}
      <input
        ref={jumpRef}
        type="date"
        value={hero.date!.toLocaleDateString("en-CA")}
        onChange={(e) => {
          const [y, m, d] = e.target.value.split("-").map(Number);
          if (y && m && d) hero.onJump(new Date(y, m - 1, d));
        }}
        aria-label="Jump to date"
        className="sr-only"
        tabIndex={-1}
      />
    </>
  );
}

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
  // The Nuvo chat overlay — a floating action, reachable over any screen.
  const [chatOpen, setChatOpen] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [calendarTap, setCalendarTap] = useState<CalendarTap | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  useMobileOverlayHistory(chatOpen, () => setChatOpen(false), "chat");
  useMobileOverlayHistory(planOpen, () => setPlanOpen(false), "plan");
  useMobileOverlayHistory(Boolean(capture), () => setCapture(null), "capture");
  useMobileOverlayHistory(Boolean(taskId), () => setTaskId(null), "task");
  useMobileOverlayHistory(Boolean(calendarTap), () => setCalendarTap(null), "event");
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
      setChatOpen(false);
      setCapture({ kind: "task" });
    } else if (act === "chat") {
      setCapture(null);
      setChatOpen(true);
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
  const recurrenceMutations = useRecurrenceMutations();
  const { agent, setRange, setNavFocus } = useAgentContext();
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
          : todayTasks.filter((x) => x.status !== "done").length;

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

  // Open the Nuvo chat overlay, optionally seeding a first message — e.g. "Ask
  // Nuvo" from the Now view. The shared agent means the conversation is already
  // there; this just surfaces it over the current screen.
  // `say` is what the transcript records when the seed is a constructed sentence
  // the user never wrote — the button did the talking, so the button's words are
  // what's shown and the seed travels to Nuvo unseen (D-087).
  const openChat = (seed?: string, say?: string) => {
    setChatOpen(true);
    if (seed) void agent.sendMessage(seed, [], { display: say });
  };

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

  const liveHint = useMemo(
    () => liveHintFor(tab, sub, detailFrame, vertical),
    [tab, sub, detailFrame, vertical],
  );

  return (
    // Pin to the layout viewport with `fixed inset-0` rather than a percentage/
    // dvh height: on iOS standalone PWAs `100dvh`/`innerHeight` can resolve to the
    // shorter *dynamic* viewport, floating the bottom nav above the screen edge
    // with a dead strip of body background beneath it. The layout viewport (what
    // fixed positioning fills) is the true full-screen box, so the nav sits flush.
    <div className="atmosphere fixed inset-0 flex flex-col">
      {/* Top bar */}
      <header className="mobile-topbar pt-safe flex shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur">
        {/* The wordmark yields to the Calendar's span, and only there. Three
            things competing in one bar — name, span, read — meant the span had
            to truncate ("Age…" over a full-width "Aug 28 – Sep 10"), and a
            calendar's title bar says the date on every phone ever made. Four of
            the five tabs still wear the name; the bottom bar always says which
            screen you're on. */}
        {tab !== "calendar" && <span className="wordmark wordmark-grad text-lead">Nuvo</span>}
        {/* One date slot, two tenants. Everywhere but the Calendar it is today,
            plainly. On the Calendar it is the SPAN YOU ARE LOOKING AT — which
            is what a calendar's title bar says on every phone ever made, and
            what lets the surface below stop spending a whole row on it.

            D-123 banned a second date up here because the top bar's "today"
            didn't describe the screen the moment you paged to September. This
            is the resolution of that, not a relapse: the bar now says exactly
            what is on screen, and the calendar says it exactly once (D-125). */}
        {tab === "calendar" ? (
          calHero && <CalendarTitle hero={calHero} />
        ) : (
          <span className="mono ml-0.5 text-caption text-muted">{format(now, "EEE MMM d")}</span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="tap-icon fast flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-muted active:scale-95"
        >
          <Icon name="search" size={16} />
        </button>
        <button
          onClick={() =>
            updateSettings({
              theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
            })
          }
          aria-label="Toggle theme"
          className="tap-icon fast flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-head text-muted active:scale-95"
        >
          <Icon name="moon" size={16} />
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="tap-icon fast flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-head text-muted active:scale-95"
        >
          <Icon name="settings" size={16} />
        </button>
      </header>

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
        {tab === "calendar" ? (
          <MobileCalendar
            now={now}
            onTapEvent={setCalendarTap}
            onTapTask={(id) => setTaskId(id)}
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
              <div className="flex flex-col gap-4 px-4 pt-4">
                <MobileReadiness data={vertical} onAskNuvo={openChat} onReview={reviewFloor} />
                {/* One primary card per state (plan vs review), the other a
                    quiet link — see WeekCompanions. */}
                <WeekCompanions onOpenPlan={() => setPlanOpen(true)} />
              </div>
            )}
            <MobileTaskList
              tab={sub}
              inbox={filtering ? filter.apply(inbox) : inbox}
              today={filtering ? filter.apply(todayTasks) : todayTasks}
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
      <nav className="pb-safe relative flex shrink-0 items-stretch border-t border-line bg-surface">
        {/* Capture and Nuvo stand down while a bulk selection is live, for the
            same reason they do for the chat: they float over the bottom-right,
            which is exactly where the bulk bar's last actions sit. A ＋ covering
            "Move" is worse than a ＋ that waits. */}
        {!chatOpen && pickedIds.size === 0 && (
          <>
            {/* Nuvo — the floating chat launcher, beside capture. Screen-aware:
                its starters match wherever you are. */}
            <button
              onClick={() => openChat()}
              aria-label="Ask Nuvo"
              data-teach="nuvo"
              className="elev-2 fast absolute right-[calc(1rem_+_3.5rem_+_0.75rem)] bottom-[calc(100%_+_0.75rem_+_4px)] flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-display leading-none text-accent active:scale-95"
            >
              ✦
            </button>
            {/* Capture — the one primary action. */}
            <button
              onClick={() => setCapture({ kind: "task" })}
              aria-label="Capture"
              data-teach="capture"
              className="elev-3 fast absolute right-4 bottom-[calc(100%_+_0.75rem)] flex h-14 w-14 items-center justify-center rounded-full bg-accent text-[28px] font-light leading-none text-on-accent active:scale-95"
            >
              ＋
            </button>
          </>
        )}

        {NAV.map((t) => (
          <NavTab
            key={t.id}
            tab={t}
            active={tab === t.id}
            onClick={() => (tab === t.id ? scrollToTop() : setTab(t.id))}
            badge={t.id === "tasks" ? inbox.length : 0}
          />
        ))}
      </nav>

      {/* The Nuvo chat — a full-screen overlay over the shell (its own scroll +
          pinned composer sit better here than in a swipe-to-dismiss sheet). */}
      {chatOpen && (
        <div
          className="fixed inset-0 z-[60] flex flex-col pt-safe"
          style={{ background: "color-mix(in srgb, var(--bg) 96%, transparent)", backdropFilter: "blur(20px)" }}
        >
          <ChatPane agent={agent} hint={liveHint} onClose={() => setChatOpen(false)} />
        </div>
      )}

      {/* Plan the week — the ritual, full-screen over the shell */}
      {planOpen && <MobilePlanWeek onClose={() => setPlanOpen(false)} />}

      {/* Sheets */}
      {detailTarget && (
        <MobileDetailSheet target={detailTarget} onClose={closeDetail} onFrameChange={setDetailFrame} />
      )}
      {capture && (
        <MobileCapture
          labels={labels}
          onCreate={mutations.create}
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
          accent={taskDomainColor(vertical, openTask)}
          onClose={() => setTaskId(null)}
        />
      )}
      {calendarTap && (
        <MobileEventSheet
          tap={calendarTap}
          task={calendarTap.kind === "block" ? (taskById.get(calendarTap.taskId) ?? null) : null}
          slotChildren={calendarTap.kind === "slot" ? slotChildTasks : undefined}
          mutations={mutations}
          onClose={() => setCalendarTap(null)}
          onAskNuvo={openChat}
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
          section="appearance"
          onClose={() => setSettingsOpen(false)}
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
  );
}

// The agent's "where am I" context. A vertical detail overrides the tab, carrying
// the item plus its parents so Nuvo can act on exactly what's on screen.
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

// The chat's empty-state starters. Reuses the day-lens mobile hints for the
// execution surfaces and the richer rung starters for the strategic ones (and a
// named item when a detail is open).
function liveHintFor(
  tab: Tab,
  sub: MobileTab,
  frame: Frame | null,
  d: ReturnType<typeof useVertical>["data"],
): AgentHintContext {
  if (frame && frame.level !== "list") {
    if (frame.level === "project")
      return { rung: "project", projectName: d.projects.find((x) => x.id === frame.id)?.name };
    if (frame.level === "initiative")
      return { rung: "initiative", initiativeName: d.initiatives.find((x) => x.id === frame.id)?.name };
    return { rung: "domain", domainName: d.domains.find((x) => x.id === frame.id)?.name };
  }
  switch (tab) {
    case "calendar":
      return { rung: "day", mobileTab: "today" };
    case "projects":
      return { rung: "project" };
    case "initiatives":
      return { rung: "initiative" };
    case "domains":
      return { rung: "domain" };
    default:
      // Trash has no agent hints of its own — nothing there is work to plan, so
      // the chat's starters stay the Today ones rather than inventing a voice
      // for a face that only holds deleted rows.
      return { rung: "day", mobileTab: sub === "trash" ? "today" : sub };
  }
}

// A bottom-bar destination tab with optional count badge.
function NavTab({
  tab,
  active,
  onClick,
  badge = 0,
}: {
  tab: { id: Tab; label: string; kind: AltitudeKind };
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      data-teach={`mtab-${tab.id}`}
      aria-current={active ? "page" : undefined}
      className={`tap fast relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 ${
        active ? "text-accent" : "text-muted"
      }`}
    >
      {/* Non-colour active cue (WCAG 1.4.1) — a 2px indicator bar. */}
      {active && (
        <span aria-hidden className="absolute inset-x-[22%] top-0 h-0.5 rounded-full bg-accent" />
      )}
      <span className="flex h-7 items-center leading-none">
        <AltitudeIcon kind={tab.kind} size={22} />
      </span>
      <span className="text-meta font-medium leading-none">{tab.label}</span>
      {badge > 0 && (
        // Inactive counts sit as inked pills on a real surface — the old
        // line-strong fill left the number at ~1.5:1 in both themes.
        <span
          className="mono absolute right-[24%] top-1 rounded-full px-1 text-micro font-semibold leading-[13px]"
          style={{
            minWidth: 15,
            height: 15,
            background: active ? "var(--accent)" : "var(--surface-2)",
            color: active ? "var(--on-accent)" : "var(--ink)",
            border: active ? "1px solid var(--accent)" : "1px solid var(--line-strong)",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
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
  /** The trash holds something, so its lens is reachable. */
  showTrash?: boolean;
  /** The filter control, rendered at the end of the strip. Null on Trash. */
  filter?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur">
      {(showTrash ? [...SUBTABS, TRASH_SUBTAB] : SUBTABS).map((t) => {
        const on = sub === t.id;
        const c = count(t.id);
        return (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={`tap fast flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-body font-medium ${
              on ? "bg-accent text-on-accent" : "text-muted active:bg-surface-2"
            }`}
          >
            {t.label}
            {c > 0 && (
              // Active: an inverted pill (on-accent ground, accent numeral) —
              // the translucent white fill hid the count. Inactive: an inked
              // pill on surface-2, same as the nav badge.
              <span
                className="mono rounded-full px-1 text-micro font-semibold leading-[13px]"
                style={{
                  minWidth: 15,
                  height: 15,
                  background: on ? "var(--on-accent)" : "var(--surface-2)",
                  color: on ? "var(--accent)" : "var(--ink)",
                  border: on ? "none" : "1px solid var(--line-strong)",
                }}
              >
                {/* The trash query is capped, so its count is a floor, not a
                    total — "100+", never a false exact 100. */}
                {c}
                {t.id === "trash" && c >= TRASH_LIMIT ? "+" : ""}
              </span>
            )}
          </button>
        );
      })}
      {filter}
    </div>
  );
}
