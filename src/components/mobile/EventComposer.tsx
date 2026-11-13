// The event half of capture — the fields an external calendar needs that a task
// doesn't, and the write.
//
// It used to be a sheet of its own (`MobileNewEventSheet`), reached by a ＋ that
// lived permanently in the Calendar's header. That made the phone ask a question
// before you could type: *is the thing in your head a task or an event?* Two ＋s
// on one screen, forty pixels apart, each making a different kind of object.
// Capture is one act (P5), so there is now one door — `MobileCapture` — and this
// is what it grows when the answer is "event" (D-125).
//
// So it owns no title input: the title is the capture line, parsed, and it is
// handed down. What it owns is the time (seeded from that same parse, so
// "lunch friday 12pm 1h" arrives already filled in), the repeat rule, the
// guests, Meet, which calendar (`EventCalendarPicker` — the calendar itself,
// not just the account it lives under), and the invite-consent step — none of which a
// task has, and all of which are the reason "event" is a separate answer at all.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ComponentProps, type InputHTMLAttributes } from "react";
import { Icon } from "../Icon";
import { Button, Chip, Dot, Input, Switch } from "../kit";
import { useIsMobile } from "../../hooks/useIsMobile";
import { TouchButton } from "./touch";
import { toast } from "sonner";
import { useCalendarAccounts, useExternalEventMutations } from "../../hooks/useCalendar";
import { useSettings } from "../../hooks/useSettings";
import { isWritableAccount } from "../../lib/calendarWrite";
import { EventCalendarPicker, useEventCalendar } from "../calendar/EventCalendarPicker";
import { allDayRangeFromStart, defaultTimedRange, toDateISO } from "../../lib/dates";
import { eventRRule, type RecurrenceRule } from "../../lib/recurrence";
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

/** The capture door presses Enter on the event through this. */
export interface EventComposerHandle {
  submit: () => void;
}

const EventComposer = forwardRef<EventComposerHandle, {
  /** The capture line, parsed — this composer never asks for it again. */
  title: string;
  /** Times read out of that line. Re-applied while the user hasn't touched the
   *  time controls, so editing the text keeps moving the event; the moment a
   *  field is touched by hand, the hand wins. */
  seed: EventSeed;
  /** A cadence read out of the same line ("standup every weekday 9am") —
   *  applied the same way until the repeat control is touched. */
  seedRepeat?: RecurrenceRule | null;
  /** After the write landed, with where it went ("Fri 12–1pm"). */
  onDone: (created: { start_at: string; end_at: string; allDay: boolean; repeats: boolean }) => void;
}>(function EventComposer({ title, seed, seedRepeat = null, onDone }, ref) {
  const { settings } = useSettings();
  const { createEvent } = useExternalEventMutations();
  const calendar = useEventCalendar();
  const isMobile = useIsMobile();

  const [startAt, setStartAt] = useState(seed.start_at);
  const [endAt, setEndAt] = useState(seed.end_at);
  const [allDay, setAllDay] = useState(seed.allDay);
  const [repeat, setRepeatState] = useState<RecurrenceRule | null>(seedRepeat);
  const repeatTouched = useRef(false);
  const setRepeat = (r: RecurrenceRule | null) => {
    repeatTouched.current = true;
    setRepeatState(r);
  };
  const seedRepeatKey = seedRepeat ? JSON.stringify(seedRepeat) : "";
  useEffect(() => {
    if (!repeatTouched.current) setRepeatState(seedRepeat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedRepeatKey]);
  const [attendees, setAttendees] = useState<string[]>([]);
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

  const target = calendar.target;
  const isGoogle = calendar.provider === "google";
  // Guests are a Google-only field; ones typed before switching to an Apple
  // calendar must not be "sent" to a provider that drops them.
  const guests = isGoogle ? attendees : [];
  const addMeet =
    isGoogle &&
    !allDay &&
    (meetChoice ?? shouldAddMeet(settings?.auto_add_meet ?? DEFAULT_MEET_PREFERENCE, guests.length));

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

  const canCreate = Boolean(title.trim()) && Boolean(target);
  const sendsInvites = guests.length > 0;

  const finish = async (notifyGuests: boolean) => {
    if (!canCreate || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (!target) {
        throw new Error(
          "No visible calendar to create on. Unhide a calendar you own in Settings → Calendars.",
        );
      }
      await createEvent({
        title: title.trim(),
        start_at: startAt,
        end_at: endAt,
        all_day: allDay,
        recurrence: repeat ? eventRRule(repeat, allDay) : undefined,
        attendees: guests.length ? guests : undefined,
        accountId: target.accountId,
        calendarId: target.calendarId,
        notifyGuests,
        addMeet,
      });
      if (guests.length) {
        toast.success(
          notifyGuests
            ? `Invite sent to ${guests.length === 1 ? guests[0] : `${guests.length} guests`}`
            : `Added ${guests.length === 1 ? "1 guest" : `${guests.length} guests`} — no email sent`,
        );
      }
      onDone({ start_at: startAt, end_at: endAt, allDay, repeats: Boolean(repeat) });
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

  useImperativeHandle(ref, () => ({
    // Enter on the consent step is "Send invites" — the button that has focus
    // styling and the one the step leads with.
    submit: () => (confirmingGuests ? void finish(true) : submit()),
  }));

  // The composer runs in two frames — the phone's capture Sheet and the
  // desktop's ⌘K / ⌥Space panel — so its parts are sized by the shell: the
  // kit at touch size on a phone, the kit as-is on a desk.
  const Btn = isMobile ? TouchButton : DeskButton;
  const timeField = (props: Omit<InputHTMLAttributes<HTMLInputElement>, "size">) =>
    isMobile ? (
      <input {...props} className="ph-field min-w-0 flex-1" />
    ) : (
      <Input {...props} frameClassName="min-w-0 flex-1" />
    );

  return (
    <>
      {/* When. Two rows that cannot wrap, rather than one that does: a native
          date input plus two native time inputs is well over 375px, so the old
          single `flex-wrap` row broke after the dash and left `–` dangling at
          the end of a line with the end time orphaned below it. The date owns a
          row with All day; the two times sit as a pair with the dash between
          them, which is also how they read. */}
      <div className="mt-3 flex items-center gap-2">
        {timeField({
          type: "date",
          value: toDateInput(startAt),
          onChange: (e) => setDate(e.target.value),
          "aria-label": "Date",
        })}
        <Btn aria-pressed={allDay} active={allDay} onClick={() => toggleAllDay(!allDay)} className="shrink-0">
          All day
        </Btn>
      </div>

      {!allDay && (
        <div className="mt-2 flex items-center gap-2">
          {timeField({
            type: "time",
            step: 900,
            value: toTimeInput(startAt),
            onChange: (e) => setStartTime(e.target.value),
            "aria-label": "Start time",
          })}
          <Icon name="arrow-right" size={14} className="shrink-0 text-[var(--faint)]" />
          {timeField({
            type: "time",
            step: 900,
            value: toTimeInput(endAt),
            onChange: (e) => {
              touched.current = true;
              setEndAt(applyTime(endAt, e.target.value));
            },
            "aria-label": "End time",
          })}
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
        className="tap-h fast mt-2 flex w-full items-center gap-1.5 py-1 text-left text-caption font-medium text-muted"
      >
        <Icon name="chevron-down" size={14} className={`fast ${more ? "" : "-rotate-90"}`} />
        {more ? "Fewer options" : "Repeat, guests, calendar…"}
        {!more && (repeat || guests.length > 0) && <Dot color="var(--accent)" shape="round" size="sm" />}
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

          {calendar.choosable && (
            <div className="mt-4">
              <div className="mb-1.5 text-caption font-semibold text-muted">Calendar</div>
              <EventCalendarPicker
                groups={calendar.groups}
                value={target}
                defaultTarget={calendar.defaultTarget}
                onChange={calendar.pick}
              />
            </div>
          )}

          {isGoogle && (
            <div className="mt-4">
              <div className="mb-1.5 text-caption font-semibold text-muted">Guests</div>
              <GuestsInput value={attendees} onChange={setAttendees} />
            </div>
          )}

          {isGoogle && !allDay && (
            // The row is the label, so a tap anywhere on it flips the switch —
            // the switch itself is the one control (and its accessible name).
            <label className="tap-h mt-3 flex items-center gap-3 border-y border-[var(--line-1)] py-2">
              <Icon name="video" size={16} className="shrink-0 text-muted" />
              <span className="flex-1 text-body font-medium text-ink">Google Meet</span>
              <Switch checked={Boolean(addMeet)} onChange={(v) => setMeetChoice(v)} label="Google Meet" />
            </label>
          )}
        </>
      )}

      {error && (
        <div className="mt-3 rounded-[var(--r-ctl)] bg-[var(--danger-soft)] px-3 py-2 text-caption text-[var(--danger)]">
          {error}
        </div>
      )}

      {confirmingGuests ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-[var(--line-1)] pt-3.5">
          <div>
            <div className="text-body font-medium text-ink">
              {inviteConsentPrompt({
                mode: "create",
                count: guests.length,
                addMeet: Boolean(addMeet),
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {guests.map((email) => (
                <Chip key={email}>{email}</Chip>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Btn kind="primary" full onClick={() => void finish(true)} disabled={saving}>
              {saving ? "Sending…" : "Send invites"}
            </Btn>
            <Btn full onClick={() => void finish(false)} disabled={saving} title={QUIET_HINT}>
              Add without emailing
            </Btn>
            <Btn kind="ghost" full onClick={() => setConfirmingGuests(false)} disabled={saving}>
              Back
            </Btn>
          </div>
        </div>
      ) : (
        <Btn kind="primary" full className="mt-4" onClick={submit} disabled={!canCreate || saving}>
          {saving ? "Saving…" : sendsInvites ? "Add & invite…" : "Add event"}
        </Btn>
      )}
    </>
  );
});

/** The kit Button at the desk's comfortable size — the ⌘K panel's. */
function DeskButton(props: Omit<ComponentProps<typeof Button>, "size">) {
  return <Button {...props} size="md" />;
}

export default EventComposer;
