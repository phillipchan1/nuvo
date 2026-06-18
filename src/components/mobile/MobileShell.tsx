import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { todayISO } from "../../lib/dates";
import { useSettings } from "../../hooks/useSettings";
import { useVertical } from "../../hooks/useVertical";
import {
  useInboxTasks,
  useDayTasks,
  useSprintTasks,
  useTaskMutations,
  useRolloverGuard,
} from "../../hooks/useTasks";
import { useLabels, useCalendarAccounts } from "../../hooks/useCalendar";
import { useRecurrenceMutations } from "../../hooks/useRecurrence";
import { useRealtime } from "../../hooks/useRealtime";
import { useAgentContext } from "../../hooks/useAgentContext";
import { taskDomainColor } from "../../lib/vertical";
import type { Task } from "../../lib/types";
import NowFloor from "../floors/NowFloor";
import SettingsModal from "../SettingsModal";
import MobileTaskList, { type MobileTab } from "./MobileTaskList";
import MobileCalendar from "./MobileCalendar";
import QuickTaskSheet from "./QuickTaskSheet";
import ChatPane from "./ChatPane";
import MobileTaskSheet from "./MobileTaskSheet";

// Top-level destinations: the three jobs you do on the phone. Today/Week/Inbox
// collapse into one "Tasks" screen (three lenses on one backlog) so the bar can
// give Calendar a slot and make capture + Nuvo permanent first-class actions.
// "nuvo" is the permanent chat destination — a real tab, not a modal sheet, so
// the bottom bar stays put while you talk to the assistant.
type Tab = "now" | "calendar" | "tasks" | "nuvo";
const TAB_KEY = "nuvo-mobile-tab-v2";
const SUB_KEY = "nuvo-mobile-tasksub";
const LEGACY_KEY = "nuvo-mobile-tab"; // pre-refactor: now|today|week|inbox

const NAV: { id: Tab; label: string; glyph: string }[] = [
  { id: "now", label: "Now", glyph: "◉" },
  { id: "calendar", label: "Calendar", glyph: "▦" },
  { id: "tasks", label: "Tasks", glyph: "▤" },
];

const SUBTABS: { id: MobileTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "inbox", label: "Inbox" },
];

// Read the active tab, migrating the legacy single-key state forward once.
function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY) as Tab | null;
    if (v && (v === "nuvo" || NAV.some((t) => t.id === v))) return v;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "now") return "now";
    if (legacy === "today" || legacy === "week" || legacy === "inbox") return "tasks";
  } catch {
    /* ignore */
  }
  return "now";
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
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };
  const setSub = (s: MobileTab) => {
    setSubState(s);
    try {
      localStorage.setItem(SUB_KEY, s);
    } catch {
      /* ignore */
    }
  };

  const [quickOpen, setQuickOpen] = useState(false);
  // The tab Nuvo was opened from, so its starter hints match where you came from.
  const [chatFrom, setChatFrom] = useState<"now" | MobileTab | undefined>(undefined);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const today = todayISO(now);
  const range = useMemo(() => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: new Date(start.getTime() + 24 * 3600_000).toISOString() };
  }, [today]); // eslint-disable-line react-hooks/exhaustive-deps

  const { settings, update: updateSettings } = useSettings();
  const { data: vertical } = useVertical();
  const { data: inbox = [] } = useInboxTasks();
  const { data: todayTasks = [] } = useDayTasks(today);
  const { data: weekTasks = [] } = useSprintTasks(vertical.sprint?.id ?? null);
  const { labels } = useLabels();
  const { data: accounts = [] } = useCalendarAccounts();
  const mutations = useTaskMutations();
  const recurrenceMutations = useRecurrenceMutations();
  const { agent, setRange } = useAgentContext();
  useEffect(() => {
    setRange(range);
  }, [range, setRange]);

  useRealtime(true);

  // Keep data fresh the way the desktop Planner does: roll overdue tasks forward
  // and materialize recurrences on load and whenever the app returns to focus.
  const rollover = useRolloverGuard(settings?.last_rollover_date);
  const settingsLoaded = Boolean(settings);
  useEffect(() => {
    if (!settingsLoaded) return;
    void (async () => {
      await rollover();
      await recurrenceMutations.materializeAll();
    })();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        await rollover();
        await recurrenceMutations.materializeAll();
      })();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded, today]);

  const taskById = useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of [...inbox, ...todayTasks, ...weekTasks]) m.set(t.id, t);
    return m;
  }, [inbox, todayTasks, weekTasks]);
  const openTask = taskId ? taskById.get(taskId) ?? null : null;

  const subCount = (s: MobileTab) =>
    s === "inbox"
      ? inbox.length
      : s === "week"
        ? weekTasks.filter((x) => x.status !== "done").length
        : todayTasks.filter((x) => x.status !== "done").length;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab, sub]);

  // Open the permanent Nuvo tab. Capture the tab we came from (for context-aware
  // starter hints) before switching, and optionally seed a first message — e.g.
  // "Ask Nuvo" from the Now view, instead of NowFloor's cramped inline rail.
  const openChat = (seed?: string) => {
    if (tab !== "nuvo") setChatFrom(tab === "now" ? "now" : tab === "tasks" ? sub : undefined);
    setTab("nuvo");
    if (seed) void agent.sendMessage(seed);
  };

  return (
    <div className="atmosphere flex h-full flex-col">
      {/* Top bar */}
      <header className="mobile-topbar pt-safe flex shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur">
        <span className="wordmark wordmark-grad text-lead">Nuvo</span>
        <span className="mono ml-0.5 text-caption text-muted">{format(now, "EEE MMM d")}</span>
        <div className="flex-1" />
        <button
          onClick={() =>
            updateSettings({
              theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
            })
          }
          aria-label="Toggle theme"
          className="fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-head text-muted active:scale-95"
        >
          ☾
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-head text-muted active:scale-95"
        >
          ⚙
        </button>
      </header>

      {/* Content. Nuvo is its own destination: it fills the space between the
          top bar and nav (both persist) rather than overlaying as a sheet. */}
      {tab === "nuvo" ? (
        <ChatPane agent={agent} mobileTab={chatFrom} />
      ) : (
      <main ref={scrollRef} className="mobile-scroll relative min-h-0 flex-1 overflow-y-auto">
        {tab === "now" ? (
          <div className="px-4 pt-4 pb-10">
            <NowFloor onOpenDay={() => { setSub("today"); setTab("tasks"); }} onAskNuvo={openChat} />
          </div>
        ) : tab === "calendar" ? (
          <MobileCalendar now={now} />
        ) : (
          <div className="pb-10">
            <TaskSubtabs sub={sub} setSub={setSub} count={subCount} />
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
            />
          </div>
        )}
      </main>
      )}

      {/* Bottom bar — Now · Calendar · ＋ capture · Tasks · Nuvo. The center
          capture and Nuvo are permanent first-class actions. */}
      <nav className="pb-safe relative flex shrink-0 items-stretch border-t border-line bg-surface">
        <NavTab tab={NAV[0]} active={tab === NAV[0].id} onClick={() => setTab(NAV[0].id)} />
        <NavTab tab={NAV[1]} active={tab === NAV[1].id} onClick={() => setTab(NAV[1].id)} />

        {/* Raised center capture — docked in a surface ring so the button reads
            as sitting on the bar, not floating over the timeline behind it. The
            ＋ glyph is self-evident, so it carries no label. */}
        <button
          onClick={() => setQuickOpen(true)}
          aria-label="Quick task"
          className="tap relative flex flex-1 flex-col items-center justify-center py-2"
        >
          <span className="absolute -top-6 rounded-full bg-surface p-[3px]">
            <span className="elev-3 fast flex h-14 w-14 items-center justify-center rounded-full bg-accent text-[28px] font-light leading-none text-white active:scale-95">
              ＋
            </span>
          </span>
          <span className="invisible text-lead leading-none">＋</span>
        </button>

        <NavTab
          tab={NAV[2]}
          active={tab === NAV[2].id}
          onClick={() => setTab(NAV[2].id)}
          badge={inbox.length}
        />

        {/* Nuvo — permanent chat destination */}
        <button
          onClick={() => openChat()}
          aria-label="Ask Nuvo"
          className={`tap fast relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 ${
            tab === "nuvo" ? "text-accent" : "text-muted"
          }`}
        >
          <span className="text-lead leading-none">✦</span>
          <span className="text-meta font-medium leading-none">Nuvo</span>
        </button>
      </nav>

      {/* Sheets */}
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
          mutations={mutations}
          accent={taskDomainColor(vertical, openTask)}
          onClose={() => setTaskId(null)}
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
    </div>
  );
}

// A bottom-bar destination tab with optional count badge.
function NavTab({
  tab,
  active,
  onClick,
  badge = 0,
}: {
  tab: { id: Tab; label: string; glyph: string };
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`tap fast relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 ${
        active ? "text-accent" : "text-muted"
      }`}
    >
      <span className="text-lead leading-none">{tab.glyph}</span>
      <span className="text-meta font-medium leading-none">{tab.label}</span>
      {badge > 0 && (
        <span
          className="mono absolute right-[24%] top-1 rounded-full px-1 text-micro font-semibold leading-[14px]"
          style={{
            minWidth: 14,
            height: 14,
            background: active ? "var(--accent)" : "var(--line-strong)",
            color: active ? "#fff" : "var(--surface)",
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
              on ? "bg-accent text-white" : "text-muted active:bg-surface-2"
            }`}
          >
            {t.label}
            {c > 0 && (
              <span
                className="mono rounded-full px-1 text-micro font-semibold leading-[14px]"
                style={{
                  minWidth: 14,
                  height: 14,
                  background: on ? "rgba(255,255,255,0.25)" : "var(--line-strong)",
                  color: on ? "#fff" : "var(--surface)",
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
