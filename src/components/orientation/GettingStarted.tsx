import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { useVertical } from "../../hooks/useVertical";
import { useCalendarAccounts } from "../../hooks/useCalendar";
import { useAllTasks } from "../../hooks/useTasks";
import { useAgentContext } from "../../hooks/useAgentContext";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { Button, IconButton, Popover, Row } from "../kit";
import { FlowMeter } from "../rituals/FlowShell";

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
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
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
      {/* Spine entry — the frame's own row (`sb-item`), with a progress ring for
          its icon. Railed, the ring stands alone and the count rides the
          tooltip. */}
      <button
        ref={setAnchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Getting started — ${doneCount} of ${steps.length}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="sb-item"
      >
        <span className="sb-icon">
          <Ring done={doneCount} total={steps.length} />
        </span>
        {!compact && (
          <>
            <span className="sb-label">Getting started</span>
            <span className="sb-trail" style={{ color: "var(--accent-ink)" }}>
              {doneCount}/{steps.length}
            </span>
          </>
        )}
      </button>

      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="right-start" label="Getting started" flush className="w-[300px]">
        <div className="flex items-center gap-2 py-2.5 pl-3.5 pr-2" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
          <span className="f-title min-w-0 flex-1">Getting started</span>
          {!celebrate && (
            <span className="f-num text-caption text-[var(--faint)]">
              {doneCount} of {steps.length}
            </span>
          )}
          <IconButton size="xs" label="Dismiss for good" icon={<Icon name="close" size={12} />} onClick={dismiss} />
        </div>

        {celebrate ? (
          <div className="grid justify-items-center gap-2 px-4 py-5 text-center">
            <span className="f-tick" data-done="" style={{ width: 24, height: 24 }}>
              <Icon name="check" size={14} strokeWidth={2.6} />
            </span>
            <div className="f-hero-sm">You're all set.</div>
            <p className="text-caption text-muted">Nuvo's yours now — go make the week land.</p>
            <Button kind="primary" size="md" onClick={finish} className="mt-1">
              Done
            </Button>
          </div>
        ) : (
          <div className="grid gap-2 p-1.5">
            <div className="px-2 pt-1">
              <FlowMeter size="sm" total={steps.length} segments={[{ key: "done", value: doneCount, color: "var(--landed, var(--accent))" }]} label={`${doneCount} of ${steps.length} done`} />
            </div>
            <ul className="grid">
              {steps.map((s) => (
                <li key={s.id}>
                  <Row
                    done={s.done}
                    onActivate={s.done ? undefined : () => runStep(s.go)}
                    leading={
                      <span className="f-tick" data-done={s.done || undefined} aria-hidden>
                        {s.done && <Icon name="check" size={10} strokeWidth={2.6} />}
                      </span>
                    }
                    title={s.label}
                    trailing={s.done ? undefined : <Icon name="arrow-right" size={12} style={{ color: "var(--faint)" }} />}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Popover>
    </>
  );
}

// A small circular progress ring — the Spine entry's "icon", filling as steps complete.
function Ring({ done, total }: { done: number; total: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--line-2)" strokeWidth="1.6" />
      <circle
        cx="8" cy="8" r={r} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
      />
    </svg>
  );
}
