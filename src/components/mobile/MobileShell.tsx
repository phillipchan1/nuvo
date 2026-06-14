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
import QuickTaskSheet from "./QuickTaskSheet";
import ChatSheet from "./ChatSheet";
import MobileTaskSheet from "./MobileTaskSheet";

type Tab = "now" | MobileTab;
const TAB_KEY = "nuvo-mobile-tab";

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: "now", label: "Now", glyph: "◉" },
  { id: "today", label: "Today", glyph: "☀" },
  { id: "week", label: "Week", glyph: "▦" },
  { id: "inbox", label: "Inbox", glyph: "✉" },
];

function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY) as Tab | null;
    if (v && TABS.some((t) => t.id === v)) return v;
  } catch {
    /* ignore */
  }
  return "now";
}

export default function MobileShell() {
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* ignore */
    }
  };

  const [quickOpen, setQuickOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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

  const count = (t: Tab) =>
    t === "inbox"
      ? inbox.length
      : t === "week"
        ? weekTasks.filter((x) => x.status !== "done").length
        : t === "today"
          ? todayTasks.filter((x) => x.status !== "done").length
          : 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  return (
    <div className="atmosphere flex h-full flex-col">
      {/* Top bar */}
      <header className="pt-safe flex shrink-0 items-center gap-2 border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur">
        <span className="wordmark wordmark-grad text-[17px]">Nuvo</span>
        <span className="mono ml-0.5 text-[12px] text-muted">{format(now, "EEE MMM d")}</span>
        <div className="flex-1" />
        <button
          onClick={() => setChatOpen(true)}
          aria-label="Chat with Nuvo"
          className="fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-[15px] text-accent active:scale-95"
        >
          ✦
        </button>
        <button
          onClick={() =>
            updateSettings({
              theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark",
            })
          }
          aria-label="Toggle theme"
          className="fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-[15px] text-muted active:scale-95"
        >
          ☾
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          className="fast flex h-9 w-9 items-center justify-center rounded-full border border-line text-[15px] text-muted active:scale-95"
        >
          ⚙
        </button>
      </header>

      {/* Content */}
      <main ref={scrollRef} className="mobile-scroll relative min-h-0 flex-1 overflow-y-auto">
        {tab === "now" ? (
          <div className="px-4 py-4">
            <NowFloor onOpenDay={() => setTab("today")} />
          </div>
        ) : (
          <MobileTaskList
            tab={tab}
            inbox={inbox}
            today={todayTasks}
            week={weekTasks}
            labels={labels}
            vertical={vertical}
            mutations={mutations}
            now={now}
            onTapTask={(t) => setTaskId(t.id)}
          />
        )}
      </main>

      {/* Floating quick-capture — reachable from every tab */}
      <button
        onClick={() => setQuickOpen(true)}
        aria-label="Quick task"
        className="elev-3 fast fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-[26px] font-light text-white active:scale-95"
        style={{ bottom: "calc(72px + env(safe-area-inset-bottom, 0px))" }}
      >
        ＋
      </button>

      {/* Bottom tab bar */}
      <nav className="pb-safe flex shrink-0 items-stretch border-t border-line bg-surface">
        {TABS.map((t) => {
          const on = tab === t.id;
          const c = count(t.id);
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tap fast relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 ${
                on ? "text-accent" : "text-muted"
              }`}
            >
              <span className="text-[17px] leading-none">{t.glyph}</span>
              <span className="text-[10px] font-medium leading-none">{t.label}</span>
              {c > 0 && (
                <span
                  className="mono absolute right-[22%] top-1 rounded-full px-1 text-[8px] font-semibold leading-[14px]"
                  style={{
                    minWidth: 14,
                    height: 14,
                    background: on ? "var(--accent)" : "var(--line-strong)",
                    color: on ? "#fff" : "var(--surface)",
                  }}
                >
                  {c}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Sheets */}
      {quickOpen && (
        <QuickTaskSheet
          labels={labels}
          onCreate={mutations.create}
          onClose={() => setQuickOpen(false)}
          defaultDoDate={tab === "today" ? today : null}
        />
      )}
      {chatOpen && <ChatSheet agent={agent} mobileTab={tab} onClose={() => setChatOpen(false)} />}
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
