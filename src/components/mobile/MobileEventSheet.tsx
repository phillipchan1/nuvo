import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import type { AttendeeStatus, RecurrenceScope, Task } from "../../lib/types";
import type { useTaskMutations } from "../../hooks/useTasks";
import { useCalendarAccounts, useEventDetails, useExternalEventMutations, useHiddenEvents } from "../../hooks/useCalendar";
import { conferenceName, joinUrl } from "../../../supabase/functions/_shared/conferencing.ts";
import {
  allDayInclusiveEnd,
  allDayRangeFromStart,
  defaultTimedRange,
  nextWeekISO,
  parseDateISO,
  todayISO,
  tomorrowISO,
} from "../../lib/dates";
import { isReadOnlyCalendarId, isWritableAccount } from "../../lib/calendarWrite";
import { plainTextFromHtml } from "../SlideOver";
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
      accountId?: string;
      calendarId?: string;
      providerEventId?: string;
      recurringEventId?: string | null;
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
  onAskNuvo?: (seed: string, say?: string) => void;
  onEditTask?: (taskId: string) => void;
}) {
  const { rsvpEvent, updateEvent, deleteEvent } = useExternalEventMutations();
  const { isHidden, hiddenKeyFor, hide, unhide } = useHiddenEvents();
  const { data: accounts = [] } = useCalendarAccounts();
  // The phone is where a video meeting actually gets joined, so the sheet pulls
  // the raw event for its conference link the same way the desktop inspector
  // does. Null for a task block — hooks can't hide behind the branch below.
  const { data: raw } = useEventDetails(tap.kind === "event" ? tap.id : null);
  const meetLink = joinUrl(raw);
  const [rsvping, setRsvping] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);

  // Editable-event state — only meaningful for tap.kind === "event", but
  // declared unconditionally since hooks can't hide behind the branch below.
  const [title, setTitle] = useState(tap.kind === "event" ? tap.title : "");
  const [location, setLocation] = useState(tap.kind === "event" ? (tap.location ?? "") : "");
  const [notes, setNotes] = useState("");
  const [startAt, setStartAt] = useState(tap.kind === "event" ? tap.start.toISOString() : "");
  const [endAt, setEndAt] = useState(tap.kind === "event" ? tap.end.toISOString() : "");
  const [allDay, setAllDay] = useState(tap.kind === "event" ? Boolean(tap.allDay) : false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hideMode, setHideMode] = useState(false);

  // Seed notes once the raw payload (with the description) arrives — same
  // plain-text flattening the desktop inspector uses for a Google HTML body.
  useEffect(() => {
    setNotes(plainTextFromHtml(raw?.description ?? ""));
  }, [raw?.description]);

  // Same write-back rule as desktop's EventPopover: a two-way Google/iCloud
  // account, and not a read-only mirror/holiday/subscription calendar.
  const account = tap.kind === "event" ? accounts.find((a) => a.id === tap.accountId) : undefined;
  const editable =
    tap.kind === "event" &&
    isWritableAccount(account) &&
    Boolean(tap.calendarId) &&
    !isReadOnlyCalendarId(tap.calendarId!);

  const handleAskNuvo = () => {
    if (!onAskNuvo) return;
    const seed =
      tap.kind === "event"
        ? `I have "${tap.title}"${!tap.allDay ? ` at ${at(tap.start)}–${at(tap.end)}` : ""}${tap.location ? ` at ${tap.location}` : ""}. Help me prepare.`
        : `I have a task block: "${tap.title}" at ${at(tap.start)}–${at(tap.end)}. Help me think about it.`;
    // The seed carries the whole block (title, time, place) so Nuvo doesn't have
    // to go looking; the transcript shows what the user actually pressed.
    onAskNuvo(seed, `Help me prepare for “${tap.title}”`);
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

    const toDateInput = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const toTimeInput = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const applyTime = (iso: string, hhmm: string) => {
      const [h, m] = hhmm.split(":").map(Number);
      const d = new Date(iso);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };

    const commitSchedule = (patch: { all_day?: boolean; start_at: string; end_at: string }) => {
      setStartAt(patch.start_at);
      setEndAt(patch.end_at);
      if (patch.all_day !== undefined) setAllDay(patch.all_day);
      updateEvent({
        id: tap.id,
        patch: { all_day: patch.all_day ?? allDay, start_at: patch.start_at, end_at: patch.end_at },
      });
    };
    // Move the event to a new day, preserving time-of-day and duration.
    const commitDate = (ymd: string) => {
      const [y, mo, d] = ymd.split("-").map(Number);
      if (!y || !mo || !d) return;
      if (allDay) {
        const startDay = parseDateISO(ymd);
        const inclusiveEnd = allDayInclusiveEnd(endAt);
        const range = allDayRangeFromStart(startDay, inclusiveEnd >= startDay ? inclusiveEnd : startDay);
        commitSchedule(range);
        return;
      }
      const ns = new Date(startAt);
      ns.setFullYear(y, mo - 1, d);
      const deltaMs = ns.getTime() - new Date(startAt).getTime();
      if (!deltaMs) return;
      commitSchedule({ start_at: ns.toISOString(), end_at: new Date(new Date(endAt).getTime() + deltaMs).toISOString() });
    };
    const toggleAllDay = (next: boolean) => {
      if (next === allDay) return;
      if (next) {
        commitSchedule({ all_day: true, ...allDayRangeFromStart(parseDateISO(toDateInput(startAt))) });
        return;
      }
      commitSchedule({ all_day: false, ...defaultTimedRange(parseDateISO(toDateInput(startAt))) });
    };

    const commitTitle = () => {
      const next = title.trim();
      if (next && next !== tap.title) updateEvent({ id: tap.id, patch: { title: next } });
    };
    const commitLocation = () => {
      const next = location.trim();
      if (next !== (tap.location ?? "")) updateEvent({ id: tap.id, patch: { location: next || null } });
    };
    const commitNotes = () => {
      const original = plainTextFromHtml(raw?.description ?? "");
      if (notes !== original) updateEvent({ id: tap.id, patch: { description: notes } });
    };
    const commitStart = () => {
      if (startAt === tap.start.toISOString()) return;
      updateEvent({ id: tap.id, patch: { start_at: startAt, all_day: false } });
    };
    const commitEnd = () => {
      if (endAt === tap.end.toISOString()) return;
      updateEvent({ id: tap.id, patch: { end_at: endAt, all_day: false } });
    };
    const handleDelete = () => {
      deleteEvent({ id: tap.id, scope: "THIS" });
      onClose();
    };

    // Hide / show — same "stays on the server, just out of the way" contract
    // as desktop's CalendarPane/SlideOver, keyed off account_id + provider_event_id
    // (or the whole recurring series) so it works for read-only calendars too.
    const hidable = tap.providerEventId
      ? { account_id: tap.accountId ?? "", provider_event_id: tap.providerEventId, title: tap.title, recurring_event_id: tap.recurringEventId }
      : null;
    const hiddenNow = hidable ? isHidden(hidable) : false;
    const canHideSeries = Boolean(tap.recurringEventId);
    const handleHide = (scope: RecurrenceScope) => {
      if (!hidable) return;
      hide(hidable, scope);
      onClose();
    };
    const handleShow = () => {
      if (!hidable) return;
      const key = hiddenKeyFor(hidable);
      if (key) unhide(key);
      onClose();
    };

    return (
      <Sheet onClose={onClose} title="Event">
        <div className="mobile-scroll max-h-[78vh] overflow-y-auto px-4 pb-4">
          {editable ? (
            <div className="mb-4 space-y-2.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitTitle}
                aria-label="Event title"
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-head font-medium outline-none focus:border-accent"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={toDateInput(startAt)}
                  onChange={(e) => commitDate(e.target.value)}
                  aria-label="Date"
                  className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
                />
                {!allDay && (
                  <>
                    <input
                      type="time"
                      step={900}
                      value={toTimeInput(startAt)}
                      onChange={(e) => setStartAt(applyTime(startAt, e.target.value))}
                      onBlur={commitStart}
                      aria-label="Start time"
                      className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
                    />
                    <span className="text-muted">–</span>
                    <input
                      type="time"
                      step={900}
                      value={toTimeInput(endAt)}
                      onChange={(e) => setEndAt(applyTime(endAt, e.target.value))}
                      onBlur={commitEnd}
                      aria-label="End time"
                      className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
                    />
                  </>
                )}
                <Chip on={allDay} onClick={() => toggleAllDay(!allDay)}>
                  All day
                </Chip>
              </div>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onBlur={commitLocation}
                placeholder="Add location"
                aria-label="Location"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-body outline-none placeholder:text-muted/60 focus:border-accent"
              />
            </div>
          ) : (
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
          )}

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

          {editable && (
            <Section label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={commitNotes}
                placeholder="Add notes"
                rows={notes ? Math.min(6, notes.split("\n").length + 1) : 2}
                className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-body outline-none placeholder:text-muted/60 focus:border-accent"
              />
            </Section>
          )}

          <div className={`space-y-2 ${showRsvp || editable ? "mt-4" : ""}`}>
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
            {hidable &&
              (hideMode ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setHideMode(false)}
                    className="tap fast flex-1 rounded-xl border border-line px-3 py-3 text-body text-muted"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleHide("THIS")}
                    className="tap fast flex-1 rounded-xl border border-line px-3 py-3 text-body"
                  >
                    This event
                  </button>
                  <button
                    onClick={() => handleHide("ALL")}
                    className="tap fast flex-1 rounded-xl border border-line px-3 py-3 text-body"
                  >
                    Whole series
                  </button>
                </div>
              ) : hiddenNow ? (
                <button
                  onClick={handleShow}
                  className="tap fast flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-body"
                >
                  <Icon name="eye" size={16} />
                  <span className="font-medium">Show on calendar</span>
                </button>
              ) : (
                <button
                  onClick={() => (canHideSeries ? setHideMode(true) : handleHide("THIS"))}
                  className="tap fast flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-body text-muted"
                >
                  <Icon name="eye-off" size={16} />
                  <span>Hide from calendar</span>
                </button>
              ))}
            {editable && (
              confirmDelete ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="tap fast flex-1 rounded-xl border border-line px-4 py-3 text-body text-muted"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    className="tap fast flex-1 rounded-xl border border-signal bg-signal/10 px-4 py-3 text-body font-medium text-signal"
                  >
                    Confirm delete
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="tap fast flex w-full items-center gap-3 rounded-xl border border-signal/30 px-4 py-3 text-body text-signal"
                >
                  <span className="text-lead">🗑</span>
                  <span className="font-medium">Delete event</span>
                </button>
              )
            )}
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
