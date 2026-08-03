import { useState } from "react";
import { Icon } from "../Icon";
import type { AttendeeStatus, Task } from "../../lib/types";
import type { useTaskMutations } from "../../hooks/useTasks";
import { useEventDetails, useExternalEventMutations } from "../../hooks/useCalendar";
import { conferenceName, joinUrl } from "../../../supabase/functions/_shared/conferencing.ts";
import { todayISO, tomorrowISO, nextWeekISO } from "../../lib/dates";
import Sheet from "./Sheet";

// The shape passed from MobileCalendar when the user taps an event row.
export type CalendarTap =
  | {
      kind: "event";
      id: string;
      title: string;
      start: Date;
      end: Date;
      allDay?: boolean;
      location: string | null;
      self_rsvp: AttendeeStatus | null | undefined;
    }
  | { kind: "block"; taskId: string; title: string; start: Date; end: Date; done: boolean };

type Mutations = ReturnType<typeof useTaskMutations>;

const TRIAGE_UNDO = { undo: "toast" as const };

const at = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dateFmt = (d: Date) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

export default function MobileEventSheet({
  tap,
  task,
  mutations,
  onClose,
  onAskNuvo,
  onEditTask,
}: {
  tap: CalendarTap;
  task?: Task | null;
  mutations: Mutations;
  onClose: () => void;
  onAskNuvo?: (seed: string) => void;
  onEditTask?: (taskId: string) => void;
}) {
  const { rsvpEvent } = useExternalEventMutations();
  // The phone is where a video meeting actually gets joined, so the sheet pulls
  // the raw event for its conference link the same way the desktop inspector
  // does. Null for a task block — hooks can't hide behind the branch below.
  const { data: raw } = useEventDetails(tap.kind === "event" ? tap.id : null);
  const meetLink = joinUrl(raw);
  const [rsvping, setRsvping] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);

  const handleAskNuvo = () => {
    if (!onAskNuvo) return;
    const seed =
      tap.kind === "event"
        ? `I have "${tap.title}"${!tap.allDay ? ` at ${at(tap.start)}–${at(tap.end)}` : ""}${tap.location ? ` at ${tap.location}` : ""}. Help me prepare.`
        : `I have a task block: "${tap.title}" at ${at(tap.start)}–${at(tap.end)}. Help me think about it.`;
    onAskNuvo(seed);
    onClose();
  };

  const copyDetails = () => {
    const loc = tap.kind === "event" && tap.location ? `\n${tap.location}` : "";
    const isAllDay = tap.kind === "event" && tap.allDay;
    const time = isAllDay ? dateFmt(tap.start) : `${dateFmt(tap.start)} · ${at(tap.start)}–${at(tap.end)}`;
    void navigator.clipboard.writeText(`${tap.title}\n${time}${loc}`);
    onClose();
  };

  if (tap.kind === "event") {
    const { self_rsvp } = tap;
    // Show RSVP only when the server has told us we're an attendee (non-null, non-undefined).
    const showRsvp = self_rsvp !== null && self_rsvp !== undefined;

    const rsvpOptions: { status: AttendeeStatus; label: string; glyph: string }[] = [
      { status: "accepted", label: "Accept", glyph: "✓" },
      { status: "tentative", label: "Maybe", glyph: "~" },
      { status: "declined", label: "Decline", glyph: "✗" },
    ];

    const handleRsvp = async (status: AttendeeStatus) => {
      setRsvping(true);
      try {
        await rsvpEvent({ id: tap.id, responseStatus: status });
      } finally {
        setRsvping(false);
        onClose();
      }
    };

    return (
      <Sheet onClose={onClose} title="Event">
        <div className="mobile-scroll max-h-[78vh] overflow-y-auto px-4 pb-4">
          <div className="mb-4">
            <div className="mb-1 text-head font-medium leading-snug">{tap.title}</div>
            <div className="mono text-caption text-muted">
              {tap.allDay ? dateFmt(tap.start) : `${dateFmt(tap.start)} · ${at(tap.start)}–${at(tap.end)}`}
              {tap.location && (
                <>
                  {" · "}
                  <a
                    href={`https://maps.apple.com/?q=${encodeURIComponent(tap.location)}`}
                    className="text-accent underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tap.location}
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Join — the one thing you open a meeting for on a phone, so it sits
              above RSVP and reads as the primary action. */}
          {meetLink && (
            <a
              href={meetLink}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
              className="tap fast mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-head font-semibold text-on-accent active:translate-y-px"
            >
              <Icon name="video" size={16} className="shrink-0" />
              Join {conferenceName(raw)}
            </a>
          )}

          {showRsvp && (
            <Section label="RSVP">
              <div className="flex gap-2">
                {rsvpOptions.map((o) => {
                  const active = self_rsvp === o.status;
                  const isDecline = o.status === "declined";
                  return (
                    <button
                      key={o.status}
                      disabled={rsvping}
                      onClick={() => void handleRsvp(o.status)}
                      className={`tap fast flex flex-1 flex-col items-center rounded-xl border py-3 ${
                        active
                          ? isDecline
                            ? "border-signal bg-signal/10 text-signal"
                            : "border-accent bg-accent text-on-accent"
                          : "border-line text-muted"
                      }`}
                    >
                      <span className="text-lead leading-none">{o.glyph}</span>
                      <span className="mt-1 text-meta">{o.label}</span>
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          <div className={`space-y-2 ${showRsvp ? "mt-4" : ""}`}>
            {onAskNuvo && (
              <button
                onClick={handleAskNuvo}
                className="tap fast flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-body"
              >
                <span className="text-lead" style={{ color: "var(--accent)" }}>✦</span>
                <span className="font-medium">Ask Nuvo to help prepare</span>
              </button>
            )}
            <button
              onClick={copyDetails}
              className="tap fast flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-body text-muted"
            >
              <span className="text-lead">⎘</span>
              <span>Copy details</span>
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  // Block (scheduled task)
  if (!task) return null;
  const done = task.status === "done";

  return (
    <Sheet onClose={onClose} title="Task block">
      <div className="mobile-scroll max-h-[78vh] overflow-y-auto px-4 pb-4">
        <div className="mb-1 text-head font-medium leading-snug">{tap.title}</div>
        <div className="mono mb-4 text-caption text-muted">
          {dateFmt(tap.start)} · {at(tap.start)}–{at(tap.end)}
        </div>

        <button
          onClick={() => {
            done ? mutations.uncomplete(task) : mutations.complete(task);
            onClose();
          }}
          className={`tap fast w-full rounded-xl border py-3 text-head font-semibold active:translate-y-px ${
            done ? "border-line text-muted" : "border-accent bg-accent text-on-accent"
          }`}
        >
          {done ? "↩ Reopen" : "✓ Mark done"}
        </button>

        <Section label="Reschedule">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { label: "Today", run: () => { mutations.planFor(task, todayISO(), TRIAGE_UNDO); onClose(); } },
                { label: "Tomorrow", run: () => { mutations.planFor(task, tomorrowISO(), TRIAGE_UNDO); onClose(); } },
                { label: "Next week", run: () => { mutations.planFor(task, nextWeekISO(), TRIAGE_UNDO); onClose(); } },
              ] as const
            ).map((c) => (
              <Chip key={c.label} onClick={c.run}>{c.label}</Chip>
            ))}
            <Chip onClick={() => setShowReschedule((v) => !v)} on={showReschedule}>
              Pick time…
            </Chip>
          </div>
          {showReschedule && <ReschedulePicker task={task} mutations={mutations} onDone={onClose} />}
        </Section>

        <div className="mt-4 space-y-2">
          {onEditTask && (
            <button
              onClick={() => { onClose(); onEditTask(task.id); }}
              className="tap fast flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-body"
            >
              <span className="text-lead">✎</span>
              <span className="font-medium">Edit task</span>
            </button>
          )}
          <button
            onClick={() => { mutations.unblock(task); onClose(); }}
            className="tap fast flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-body text-muted"
          >
            <span className="text-lead">↑</span>
            <span>Remove from calendar</span>
          </button>
          {onAskNuvo && (
            <button
              onClick={handleAskNuvo}
              className="tap fast flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-body"
            >
              <span className="text-lead" style={{ color: "var(--accent)" }}>✦</span>
              <span className="font-medium">Ask Nuvo</span>
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="section-label mb-1.5 !p-0">{label}</div>
      {children}
    </div>
  );
}

function Chip({ children, on, onClick }: { children: React.ReactNode; on?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tap fast rounded-full border px-3.5 py-2 text-body font-medium ${
        on ? "border-accent bg-accent text-on-accent" : "border-line text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function ReschedulePicker({ task, mutations, onDone }: { task: Task; mutations: Mutations; onDone: () => void }) {
  const [date, setDate] = useState(task.do_date ?? todayISO());
  const [time, setTime] = useState(task.start_time ? task.start_time.slice(11, 16) : "");

  const apply = () => {
    if (time) {
      const [h, m] = time.split(":").map(Number);
      const [y, mo, d] = date.split("-").map(Number);
      mutations.block(task, new Date(y, mo - 1, d, h, m), undefined, TRIAGE_UNDO);
    } else {
      mutations.planFor(task, date, TRIAGE_UNDO);
    }
    onDone();
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-head outline-none focus:border-accent"
      />
      <input
        type="time"
        value={time}
        step={900}
        onChange={(e) => setTime(e.target.value)}
        className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-head outline-none focus:border-accent"
      />
      <button
        onClick={apply}
        className="tap fast rounded-lg border border-accent bg-accent px-4 py-2 text-head font-medium text-on-accent"
      >
        Set
      </button>
    </div>
  );
}
