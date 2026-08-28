// The event half of capture — the fields an external calendar needs that a task
// doesn't, and the write.
//
// It used to be a sheet of its own (`MobileNewEventSheet`), reached by a ＋ that
// lived permanently in the Calendar's header. That made the phone ask a question
// before you could type: *is the thing in your head a task or an event?* Two ＋s
// on one screen, forty pixels apart, each making a different kind of object.
// Capture is one act (P5), so there is now one door — `MobileCapture` — and this
// is what it grows when the answer is "event" (D-124).
//
// So it owns no title input: the title is the capture line, parsed, and it is
// handed down. What it owns is the time (seeded from that same parse, so
// "lunch friday 12pm 1h" arrives already filled in), the repeat rule, the
// guests, Meet, which calendar, and the invite-consent step — none of which a
// task has, and all of which are the reason "event" is a separate answer at all.

import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { toast } from "sonner";
import { useCalendarAccounts, useExternalEventMutations } from "../../hooks/useCalendar";
import { useSettings } from "../../hooks/useSettings";
import { isWritableAccount, providerMeta } from "../../lib/calendarWrite";
import { allDayRangeFromStart, defaultTimedRange, toDateISO } from "../../lib/dates";
import { toGoogleRRULE, type RecurrenceRule } from "../../lib/recurrence";
import { RepeatControl } from "../RecurrencePicker";
import { GuestsInput } from "../GuestsInput";
import {
  DEFAULT_MEET_PREFERENCE,
  shouldAddMeet,
} from "../../../supabase/functions/_shared/conferencing.ts";
import { QUIET_HINT, inviteConsentPrompt } from "../../../supabase/functions/_shared/invites.ts";

/** When an event starts and ends, as read out of the capture line. */
export interface EventSeed {
  start_at: string;
  end_at: string;
  allDay: boolean;
}

/** The seed a parsed capture implies: an explicit time if the text gave one, a
 *  9–10 on the day it named otherwise. Pure and exported so the capture sheet
 *  can decide when the seed has actually changed. */
export function eventSeed(
  day: Date,
  startTime: Date | null,
  durationMinutes: number | null,
): EventSeed {
  if (!startTime) return { ...defaultTimedRange(day), allDay: false };
  const end = new Date(startTime.getTime() + (durationMinutes ?? 60) * 60_000);
  return { start_at: startTime.toISOString(), end_at: end.toISOString(), allDay: false };
}

/** True when there is somewhere to write an event at all. */
export function useWritableAccounts() {
  const { data: accounts = [] } = useCalendarAccounts();
  return accounts.filter((a) => isWritableAccount(a));
}

export default function EventComposer({
  title,
  seed,
  onDone,
}: {
  /** The capture line, parsed — this composer never asks for it again. */
  title: string;
  /** Times read out of that line. Re-applied while the user hasn't touched the
   *  time controls, so editing the text keeps moving the event; the moment a
   *  field is touched by hand, the hand wins. */
  seed: EventSeed;
  onDone: () => void;
}) {
  const { settings } = useSettings();
  const { createEvent } = useExternalEventMutations();
  const writableAccounts = useWritableAccounts();

  const [startAt, setStartAt] = useState(seed.start_at);
  const [endAt, setEndAt] = useState(seed.end_at);
  const [allDay, setAllDay] = useState(seed.allDay);
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(null);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [accountId, setAccountId] = useState(() => writableAccounts[0]?.id ?? "");
  const [meetChoice, setMeetChoice] = useState<boolean | null>(null);
  const [confirmingGuests, setConfirmingGuests] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  // The text drives the time until a thumb does.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    setStartAt(seed.start_at);
    setEndAt(seed.end_at);
    setAllDay(seed.allDay);
  }, [seed.start_at, seed.end_at, seed.allDay]);

  const account = writableAccounts.find((a) => a.id === accountId) ?? writableAccounts[0];
  const isGoogle = account?.provider === "google";
  const addMeet =
    isGoogle &&
    !allDay &&
    (meetChoice ?? shouldAddMeet(settings?.auto_add_meet ?? DEFAULT_MEET_PREFERENCE, attendees.length));

  const toDateInput = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const toTimeInput = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const applyDate = (iso: string, ymd: string) => {
    const [y, mo, d] = ymd.split("-").map(Number);
    const next = new Date(iso);
    next.setFullYear(y, mo - 1, d);
    return next.toISOString();
  };
  const applyTime = (iso: string, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const next = new Date(iso);
    next.setHours(h, m, 0, 0);
    return next.toISOString();
  };

  const setDate = (ymd: string) => {
    touched.current = true;
    const deltaMs = new Date(applyDate(startAt, ymd)).getTime() - new Date(startAt).getTime();
    setStartAt((s) => applyDate(s, ymd));
    setEndAt((e) => new Date(new Date(e).getTime() + deltaMs).toISOString());
  };
  const setStartTime = (hhmm: string) => {
    touched.current = true;
    const nextStart = applyTime(startAt, hhmm);
    setStartAt(nextStart);
    if (new Date(endAt) <= new Date(nextStart)) {
      setEndAt(new Date(new Date(nextStart).getTime() + 30 * 60_000).toISOString());
    }
  };
  const toggleAllDay = (next: boolean) => {
    touched.current = true;
    setAllDay(next);
    const range = next
      ? allDayRangeFromStart(new Date(startAt))
      : defaultTimedRange(new Date(startAt));
    setStartAt(range.start_at);
    setEndAt(range.end_at);
  };

  const canCreate = Boolean(title.trim()) && Boolean(account);
  const sendsInvites = attendees.length > 0;

  const finish = async (notifyGuests: boolean) => {
    if (!canCreate || !account || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createEvent({
        title: title.trim(),
        start_at: startAt,
        end_at: endAt,
        all_day: allDay,
        recurrence: repeat ? toGoogleRRULE(repeat) : undefined,
        attendees: attendees.length ? attendees : undefined,
        accountId: account.id,
        notifyGuests,
        addMeet,
      });
      if (attendees.length) {
        toast.success(
          notifyGuests
            ? `Invite sent to ${attendees.length === 1 ? attendees[0] : `${attendees.length} guests`}`
            : `Added ${attendees.length === 1 ? "1 guest" : `${attendees.length} guests`} — no email sent`,
        );
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create event");
      setSaving(false);
    }
  };

  const submit = () => {
    if (!canCreate) return;
    if (sendsInvites && !confirmingGuests) {
      setConfirmingGuests(true);
      return;
    }
    void finish(true);
  };

  return (
    <>
      {/* When. Two rows that cannot wrap, rather than one that does: a native
          date input plus two native time inputs is well over 375px, so the old
          single `flex-wrap` row broke after the dash and left `–` dangling at
          the end of a line with the end time orphaned below it. The date owns a
          row with the All-day switch; the two times sit as a pair with the dash
          between them, which is also how they read. */}
      <div className="mt-3 flex items-center gap-1.5">
        <input
          type="date"
          value={toDateInput(startAt)}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
          className="mono tap-h min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => toggleAllDay(!allDay)}
          aria-pressed={allDay}
          className={`tap fast shrink-0 rounded-full border px-3.5 py-2 text-label font-medium ${
            allDay ? "border-accent bg-accent text-on-accent" : "border-line text-muted"
          }`}
        >
          All day
        </button>
      </div>

      {!allDay && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="time"
            step={900}
            value={toTimeInput(startAt)}
            onChange={(e) => setStartTime(e.target.value)}
            aria-label="Start time"
            className="mono tap-h min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
          />
          <span className="shrink-0 text-muted">–</span>
          <input
            type="time"
            step={900}
            value={toTimeInput(endAt)}
            onChange={(e) => {
              touched.current = true;
              setEndAt(applyTime(endAt, e.target.value));
            }}
            aria-label="End time"
            className="mono tap-h min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
          />
        </div>
      )}

      {/* Everything else is folded away. Repeat, guests, Meet and which calendar
          are real, but they are not what a capture is for: the common event is
          a time and a name, and four more controls between the thought and the
          Add button is the form the front door exists to avoid (P5). */}
      <button
        type="button"
        onClick={() => setMore((v) => !v)}
        aria-expanded={more}
        className="tap-h fast mt-2.5 flex w-full items-center gap-1.5 rounded-lg py-1 text-left text-caption font-medium text-muted active:bg-surface-2"
      >
        <Icon
          name="chevron-down"
          size={13}
          className={`fast ${more ? "" : "-rotate-90"}`}
        />
        {more ? "Fewer options" : "Repeat, guests, calendar…"}
        {!more && (repeat || attendees.length > 0) && (
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
        )}
      </button>

      {more && (
        <>
          <div className="mt-2">
            <RepeatControl
              anchorISO={toDateISO(new Date(startAt))}
              value={repeat}
              onChange={setRepeat}
              variant="block"
            />
          </div>

          {writableAccounts.length > 1 && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-label font-semibold uppercase tracking-wider text-muted">
                <Icon name="calendar" size={11} />
                Calendar
              </div>
              <div className="flex flex-wrap gap-1.5">
                {writableAccounts.map((a) => {
                  const meta = providerMeta(a.provider);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAccountId(a.id)}
                      className={`fast tap flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-caption font-medium ${
                        accountId === a.id
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-line bg-surface-2 text-muted"
                      }`}
                    >
                      <span
                        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-micro font-semibold leading-none text-white"
                        style={{ background: meta.color }}
                      >
                        {meta.letter}
                      </span>
                      {meta.name} · {a.email}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {isGoogle && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-label font-semibold uppercase tracking-wider text-muted">
                <Icon name="user-plus" size={11} />
                Guests
              </div>
              <GuestsInput value={attendees} onChange={setAttendees} />
            </div>
          )}

          {isGoogle && !allDay && (
            <button
              type="button"
              role="switch"
              aria-checked={addMeet}
              onClick={() => setMeetChoice(!addMeet)}
              className={`fast tap mt-3 flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left ${
                addMeet ? "border-accent/40 bg-accent-soft" : "border-line bg-surface-2"
              }`}
            >
              <Icon
                name="video"
                size={13}
                className={`shrink-0 ${addMeet ? "text-accent" : "text-muted/70"}`}
              />
              <span className={`flex-1 text-body font-medium ${addMeet ? "text-accent" : "text-muted"}`}>
                Google Meet
              </span>
              <span
                className={`relative h-5 w-9 shrink-0 rounded-full ${addMeet ? "bg-accent" : "bg-line-strong"}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[var(--shadow-1)] transition-[left] ${
                    addMeet ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </span>
            </button>
          )}
        </>
      )}

      {error && (
        <div className="mt-3 rounded-md bg-signal-soft px-3 py-2 text-caption text-signal">{error}</div>
      )}

      {confirmingGuests ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3.5">
          <div>
            <div className="text-body font-medium text-ink">
              {inviteConsentPrompt({
                mode: "create",
                count: attendees.length,
                addMeet: Boolean(addMeet),
              })}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {attendees.map((email) => (
                <span
                  key={email}
                  className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-meta text-muted"
                >
                  {email}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => void finish(true)}
              disabled={saving}
              className="tap fast w-full rounded-xl bg-accent py-3 text-head font-semibold text-on-accent disabled:opacity-60"
            >
              {saving ? "Sending…" : "Send invites"}
            </button>
            <button
              onClick={() => void finish(false)}
              disabled={saving}
              title={QUIET_HINT}
              className="tap fast w-full rounded-xl border border-line py-3 text-head font-medium text-ink disabled:opacity-60"
            >
              Add without emailing
            </button>
            <button
              onClick={() => setConfirmingGuests(false)}
              disabled={saving}
              className="tap fast w-full py-2 text-body font-medium text-muted"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={submit}
          disabled={!canCreate || saving}
          className="tap fast mt-4 w-full rounded-xl bg-accent py-3 text-head font-semibold text-on-accent shadow-sm active:translate-y-px disabled:border disabled:border-line disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
        >
          {saving ? "Saving…" : sendsInvites ? "Add & invite…" : "Add event"}
        </button>
      )}
    </>
  );
}
