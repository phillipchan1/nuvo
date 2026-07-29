import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVertical } from "../../hooks/useVertical";
import { useCalendarAccounts } from "../../hooks/useCalendar";
import { useAllTasks } from "../../hooks/useTasks";
import { useAgentContext } from "../../hooks/useAgentContext";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { Btn } from "../ui";

// The "Getting Started" tracker — the reward spine of onboarding. Five milestones,
// each DERIVED from real data so it never lies; every checkmark is earned. It lives
// in the Spine (the one chrome present on every elevation) as a compact entry that
// expands into a checklist popover, so it persists as the user traverses floors and
// never intrudes on any floor's content. Always dismissible.
//
// It never nags an established user: on first ever mount, if the four foundational
// milestones are already done, it retires silently. A cheap gate keeps the data
// queries from ever running once it's been retired.

const LS = {
  dismissed: "nuvo.gs.dismissed",
  completed: "nuvo.gs.completed",
  seen: "nuvo.gs.seen",
  askedNuvo: "nuvo.gs.askedNuvo",
};

function lsGet(k: string): boolean {
  try { return localStorage.getItem(k) === "1"; } catch { return false; }
}
function lsSet(k: string) {
  try { localStorage.setItem(k, "1"); } catch { /* ignore */ }
}

export default function GettingStarted({ compact = false }: { compact?: boolean }) {
  // Cheap gate — no data hooks. Once retired (dismissed/completed) the Inner never
  // mounts, so useAllTasks & friends never fetch for the ~everyone who's past this.
  const [gone, setGone] = useState(() => lsGet(LS.dismissed) || lsGet(LS.completed));
  if (gone) return null;
  return <GettingStartedInner compact={compact} onGone={() => setGone(true)} />;
}

function GettingStartedInner({ compact, onGone }: { compact: boolean; onGone: () => void }) {
  const { data, ready } = useVertical();
  const { data: accounts = [], isLoading: accountsLoading } = useCalendarAccounts();
  const { data: allTasks = [], isLoading: tasksLoading } = useAllTasks();
  const { agent } = useAgentContext();
  const { goRung, openOverlay, setSettingsSection, toggleAgent } = useAppNavigation();

  const [askedNuvo, setAskedNuvo] = useState(() => lsGet(LS.askedNuvo));
  const [open, setOpen] = useState(false);
  const wasIncomplete = useRef(false);

  // Latch "asked Nuvo" the first time a user message appears in the agent thread.
  useEffect(() => {
    if (askedNuvo) return;
    if (agent.messages?.some((m) => m.role === "user")) {
      lsSet(LS.askedNuvo);
      setAskedNuvo(true);
    }
  }, [agent.messages, askedNuvo]);

  const loaded = ready && !accountsLoading && !tasksLoading;

  const steps = [
    {
      id: "calendar",
      label: "Connect a calendar",
      done: accounts.length > 0,
      go: () => { setSettingsSection("connections"); openOverlay("settings"); },
    },
    { id: "domain", label: "Name a domain", done: data.domains.length > 0, go: () => goRung("domain") },
    { id: "project", label: "Add a project", done: data.projects.length > 0, go: () => goRung("project") },
    {
      id: "timeblock",
      label: "Block time on your schedule",
      done: allTasks.some((t) => t.start_time != null && t.do_date != null),
      go: () => goRung("day"),
    },
    { id: "nuvo", label: "Ask Nuvo something", done: askedNuvo, go: () => toggleAgent() },
  ];

  const foundationalDone = steps.slice(0, 4).every((s) => s.done);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  if (!allDone) wasIncomplete.current = true;
  const celebrate = allDone && wasIncomplete.current;

  // Retire silently for an established user (foundation already done on first sight),
  // and remember once we've genuinely shown it to a new user.
  useEffect(() => {
    if (!loaded) return;
    if (!lsGet(LS.seen) && foundationalDone) { lsSet(LS.completed); onGone(); return; }
    lsSet(LS.seen);
  }, [loaded, foundationalDone, onGone]);

  // The reward is worth surfacing on its own — pop it open when the last box ticks.
  useEffect(() => {
    if (celebrate) setOpen(true);
  }, [celebrate]);

  // Close the popover on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!loaded) return null;
  if (foundationalDone && !lsGet(LS.seen)) return null; // about to retire (effect above)

  const dismiss = () => { lsSet(LS.dismissed); onGone(); };
  const finish = () => { lsSet(LS.completed); onGone(); };
  const runStep = (go: () => void) => { setOpen(false); go(); };

  return (
    <>
      {/* Spine entry — matches the Settings/Shortcuts rows, with a progress ring.
          Railed, the ring is already an icon: it stands alone and the count moves
          into the tooltip. */}
      <div className={compact ? "flex justify-center py-0.5" : undefined}>
        <button
          onClick={() => setOpen((o) => !o)}
          title={`Getting started — ${doneCount} of ${steps.length}`}
          className={`fast flex items-center rounded-lg border border-transparent text-muted hover:text-ink ${
            compact ? "h-11 w-11 justify-center" : "w-full gap-2.5 px-2.5 py-2 text-left"
          }`}
          style={open ? { color: "var(--ink)" } : undefined}
        >
          <Ring done={doneCount} total={steps.length} />
          {!compact && (
            <>
              <span className="flex-1 text-caption leading-none">Getting started</span>
              <span className="mono text-micro leading-none" style={{ color: "var(--accent)" }}>{doneCount}/{steps.length}</span>
            </>
          )}
        </button>
      </div>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[55]" onMouseDown={() => setOpen(false)} />
            <div
              className="moment glass elev-3 fixed z-[56] w-[300px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-line p-3.5"
              style={{ left: "calc(var(--spine-width, 188px) + 8px)", bottom: 12 }}
              role="dialog"
              aria-label="Getting started"
            >
              <div className="flex items-center gap-2">
                <span className="section-label flex-1">Getting started</span>
                {!celebrate && <span className="mono text-micro text-muted">{doneCount} of {steps.length}</span>}
                <button onClick={dismiss} className="tap fast text-muted hover:text-ink" aria-label="Dismiss for good">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {!celebrate && (
                <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                  <span className="fast block h-full rounded-full" style={{ width: `${(doneCount / steps.length) * 100}%`, background: "var(--accent)" }} />
                </div>
              )}

              {celebrate ? (
                <div className="flex flex-col items-center gap-2 py-3 text-center">
                  <span className="text-lead" style={{ color: "var(--accent)" }}>✦</span>
                  <div className="serif text-body text-ink">You're all set.</div>
                  <p className="text-caption text-muted">Nuvo's yours now — go make the week land.</p>
                  <Btn kind="primary" onClick={finish} className="mt-1">Done</Btn>
                </div>
              ) : (
                <ul className="mt-2.5 flex flex-col gap-0.5">
                  {steps.map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={s.done ? undefined : () => runStep(s.go)}
                        disabled={s.done}
                        className={`tap fast group flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left ${s.done ? "cursor-default" : "hover:bg-surface-2"}`}
                      >
                        <Tick done={s.done} />
                        <span className={`flex-1 text-caption ${s.done ? "text-muted line-through decoration-line" : "text-ink"}`}>{s.label}</span>
                        {!s.done && <span className="text-caption text-muted opacity-0 transition-opacity group-hover:opacity-100">→</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

// A small circular progress ring — the Spine entry's "icon", filling as steps complete.
function Ring({ done, total }: { done: number; total: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" className="shrink-0 -rotate-90">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="1.6" />
      <circle
        cx="8" cy="8" r={r} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
      />
    </svg>
  );
}

function Tick({ done }: { done: boolean }) {
  if (done) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--accent)" }}>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.5L5 9l4.5-5.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return <span className="h-4 w-4 shrink-0 rounded-full border border-line-strong" />;
}
