import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { todayISO } from "../../lib/dates";
import { useMobileOverlayHistory } from "../../hooks/useMobileOverlayHistory";
import { useOnline } from "../../hooks/useOnline";
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
} from "../../hooks/useTasks";
import { useLabels, useCalendarAccounts } from "../../hooks/useCalendar";
import { useRecurrenceMutations } from "../../hooks/useRecurrence";
import { useRealtime } from "../../hooks/useRealtime";
import { useAgentContext } from "../../hooks/useAgentContext";
import { taskDomainColor } from "../../lib/vertical";
import type { Floor } from "../../lib/readiness";
import type { AgentHintContext } from "../../lib/agentHints";
import type { Task } from "../../lib/types";
import SettingsModal from "../SettingsModal";
import { AltitudeIcon, type AltitudeKind } from "../icons";
import { TrialBanner } from "../billing/TrialBanner";
import Orientation from "../orientation/Orientation";
import MobileTaskList, { type MobileTab } from "./MobileTaskList";
import MobileCalendar from "./MobileCalendar";
import RecurringUpkeepPanel from "../RecurringUpkeepPanel";
import MobileProjects from "./MobileProjects";
import MobileInitiatives from "./MobileInitiatives";
import MobileReadiness from "./MobileReadiness";
import { WeekCompanions } from "./WeekPlanCard";
import MobilePlanWeek from "./MobilePlanWeek";
import MobileSearch, { type JumpKind } from "./MobileSearch";
import PullIndicator from "./PullIndicator";
import MobileDetailSheet from "./detail/MobileDetailSheet";
import type { DetailTarget, Frame } from "./detail/verticalDetail";
import QuickTaskSheet from "./QuickTaskSheet";
import ChatPane from "./ChatPane";
import MobileTaskSheet from "./MobileTaskSheet";
import MobileEventSheet, { type CalendarTap } from "./MobileEventSheet";

// Top-level destinations — the four surfaces you work from on the phone, mirror-
// ing the desktop altitudes: Calendar · Tasks, then the two strategic altitudes
// that On Deck makes first-class — Projects and Initiatives. Capture (＋) and
// Nuvo (✦) are *actions*, not places, so they float above the bar instead of
// taking a slot; Nuvo opens as an overlay over whatever screen you're on, so its
// answers carry that screen's context.
type Tab = "calendar" | "tasks" | "projects" | "initiatives";
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

  const [quickOpen, setQuickOpen] = useState(false);
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
  useMobileOverlayHistory(quickOpen, () => setQuickOpen(false), "quick");
  useMobileOverlayHistory(Boolean(taskId), () => setTaskId(null), "task");
  useMobileOverlayHistory(Boolean(calendarTap), () => setCalendarTap(null), "event");
  useMobileOverlayHistory(settingsOpen, () => setSettingsOpen(false), "settings");
  useMobileOverlayHistory(upkeepOpen, () => setUpkeepOpen(false), "upkeep");
  useMobileOverlayHistory(searchOpen, () => setSearchOpen(false), "search");

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Manifest shortcuts (long-press the installed app's icon): land directly in
  // capture or on Today. Consumed once, then stripped from the URL.
  const shortcutDone = useRef(false);
  useEffect(() => {
    if (shortcutDone.current) return;
    shortcutDone.current = true;
    const url = new URL(window.location.href);
    const shortcut = url.searchParams.get("shortcut");
    if (!shortcut) return;
    url.searchParams.delete("shortcut");
    window.history.replaceState(history.state, "", url);
    if (shortcut === "capture") setQuickOpen(true);
    else if (shortcut === "today") {
      setTabState("tasks");
      setSubState("today");
    }
  }, []);

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
      lastMaterializeDay.current = day;
      void (async () => {
        await rollover();
        if (materialize) await recurrenceMutations.materializeAll();
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
  const taskById = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of [...inbox, ...todayTasks, ...weekTasks, ...allTasks]) m.set(t.id, t);
    return m;
  }, [inbox, todayTasks, weekTasks, allTasks]);
  const openTask = taskId ? taskById.get(taskId) ?? null : null;

  const subCount = (s: MobileTab) =>
    s === "inbox"
      ? inbox.length
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
  const openChat = (seed?: string) => {
    setChatOpen(true);
    if (seed) void agent.sendMessage(seed);
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

  // Route a readiness "turn" to the surface that resolves it.
  const reviewFloor = (floor: Floor) => {
    if (floor === "project") setTab("projects");
    else if (floor === "initiative" || floor === "domain") setTab("initiatives");
    else {
      setSub("today");
      setTab("tasks");
    }
  };

  const liveHint = useMemo(
    () => liveHintFor(tab, sub, detailFrame, vertical),
    [tab, sub, detailFrame, vertical],
  );

  const online = useOnline();

  return (
    // Pin to the layout viewport with `fixed inset-0` rather than a percentage/
    // dvh height: on iOS standalone PWAs `100dvh`/`innerHeight` can resolve to the
    // shorter *dynamic* viewport, floating the bottom nav above the screen edge
    // with a dead strip of body background beneath it. The layout viewport (what
    // fixed positioning fills) is the true full-screen box, so the nav sits flush.
    <div className="atmosphere fixed inset-0 flex flex-col">
      {/* Top bar */}
      <header className="mobile-topbar pt-safe flex shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur">
        <span className="wordmark wordmark-grad text-lead">Nuvo</span>
        <span className="mono ml-0.5 text-caption text-muted">{format(now, "EEE MMM d")}</span>
        <div className="flex-1" />
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="tap-icon fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted active:scale-95"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.4-3.4" />
          </svg>
        </button>
        <button
          onClick={() =>
            updateSettings({
              theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
            })
          }
          aria-label="Toggle theme"
          className="tap-icon fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-head text-muted active:scale-95"
        >
          ☾
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="tap-icon fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-head text-muted active:scale-95"
        >
          ⚙
        </button>
      </header>

      <TrialBanner />

      {/* Offline — say it once, quietly, instead of raining error toasts.
          TanStack refetches on reconnect, so the strip clearing IS the resync. */}
      {!online && (
        <div
          role="status"
          className="shrink-0 border-b border-line bg-surface-2 px-4 py-1.5 text-center text-caption text-muted"
        >
          You're offline — showing your last synced day.
        </div>
      )}

      {/* Content */}
      <main ref={scrollRef} onScroll={recordScroll} className="mobile-scroll relative min-h-0 flex-1 overflow-y-auto">
        <PullIndicator pulling={pulling} refreshing={refreshing} />
        {tab === "calendar" ? (
          <MobileCalendar now={now} onTapEvent={setCalendarTap} onOpenUpkeep={() => setUpkeepOpen(true)} />
        ) : tab === "projects" ? (
          <MobileProjects onOpenItem={openDetail} />
        ) : tab === "initiatives" ? (
          <MobileInitiatives onOpenItem={openDetail} />
        ) : (
          <div className="fab-clear">
            <TaskSubtabs sub={sub} setSub={setSub} count={subCount} />
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
              inbox={inbox}
              today={todayTasks}
              week={weekTasks}
              labels={labels}
              vertical={vertical}
              mutations={mutations}
              now={now}
              onTapTask={(t) => setTaskId(t.id)}
              pending={
                sub === "inbox" ? inboxPending : sub === "week" ? weekPending || !verticalReady : todayPending
              }
            />
          </div>
        )}
      </main>

      {/* Bottom bar — five equal navigation destinations. Capture (＋) and Nuvo
          (✦) float above the bar as the two primary *actions* (bottom-right thumb
          arc), so the row stays even and the bold accent belongs to capture. */}
      <nav className="pb-safe relative flex shrink-0 items-stretch border-t border-line bg-surface">
        {!chatOpen && (
          <>
            {/* Nuvo — the floating chat launcher, beside capture. Screen-aware:
                its starters match wherever you are. */}
            <button
              onClick={() => openChat()}
              aria-label="Ask Nuvo"
              data-teach="nuvo"
              className="elev-2 fast absolute right-[calc(1rem_+_3.5rem_+_0.75rem)] bottom-[calc(100%_+_0.75rem_+_4px)] flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-[22px] leading-none text-accent active:scale-95"
            >
              ✦
            </button>
            {/* Capture — the one primary action. */}
            <button
              onClick={() => setQuickOpen(true)}
              aria-label="Quick task"
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
      {quickOpen && (
        <QuickTaskSheet
          labels={labels}
          onCreate={mutations.create}
          onClose={() => setQuickOpen(false)}
          defaultDoDate={tab === "tasks" && sub === "today" ? today : null}
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
    default:
      return { rung: "day", mobileTab: sub };
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
}: {
  sub: MobileTab;
  setSub: (s: MobileTab) => void;
  count: (s: MobileTab) => number;
}) {
  return (
    <div className="sticky top-0 z-10 flex gap-1 border-b border-line bg-surface/90 px-3 py-2 backdrop-blur">
      {SUBTABS.map((t) => {
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
                {c}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
