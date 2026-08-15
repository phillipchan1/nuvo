import { useState } from "react";
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
import Sheet from "./Sheet";

/** New-event creation on the phone — the mobile counterpart to the desktop
 *  grid's DraftComposer "Event" tab. Same fields (repeat, guests, Meet,
 *  calendar), same mutation, laid out as a sheet instead of an anchored card,
 *  because a phone has no drag-to-pick-a-time gesture to build a draft from. */
export default function MobileNewEventSheet({
  initialDate,
  onClose,
}: {
  initialDate: Date;
  onClose: () => void;
}) {
  const { data: accounts = [] } = useCalendarAccounts();
  const { settings } = useSettings();
  const { createEvent } = useExternalEventMutations();

  const writableAccounts = accounts.filter((a) => isWritableAccount(a));

  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const initialRange = defaultTimedRange(initialDate);
  const [startAt, setStartAt] = useState(initialRange.start_at);
  const [endAt, setEndAt] = useState(initialRange.end_at);
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(null);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [accountId, setAccountId] = useState(() => writableAccounts[0]?.id ?? "");
  const [meetChoice, setMeetChoice] = useState<boolean | null>(null);
  const [confirmingGuests, setConfirmingGuests] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = writableAccounts.find((a) => a.id === accountId) ?? writableAccounts[0];
  const isGoogle = account?.provider === "google";
  const addMeet = isGoogle && !allDay && (meetChoice ?? shouldAddMeet(settings?.auto_add_meet ?? DEFAULT_MEET_PREFERENCE, attendees.length));

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
    const deltaMs = new Date(applyDate(startAt, ymd)).getTime() - new Date(startAt).getTime();
    setStartAt((s) => applyDate(s, ymd));
    setEndAt((e) => new Date(new Date(e).getTime() + deltaMs).toISOString());
  };
  const setStartTime = (hhmm: string) => {
    const nextStart = applyTime(startAt, hhmm);
    setStartAt(nextStart);
    if (new Date(endAt) <= new Date(nextStart)) {
      setEndAt(new Date(new Date(nextStart).getTime() + 30 * 60_000).toISOString());
    }
  };
  const toggleAllDay = (next: boolean) => {
    setAllDay(next);
    const range = next ? allDayRangeFromStart(new Date(startAt)) : defaultTimedRange(new Date(startAt));
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
      onClose();
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

  if (!writableAccounts.length) {
    return (
      <Sheet onClose={onClose} title="New event">
        <div className="px-4 pb-4 text-body text-muted">
          No writable calendar is connected — connect a Google or Apple calendar in Settings → Calendars
          to add events from Nuvo.
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} title="New event">
      <div className="px-4 pb-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Event title…"
          aria-label="Event title"
          autoFocus
          className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-head font-medium text-ink outline-none placeholder:font-normal placeholder:text-muted/50 focus:border-accent"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={toDateInput(startAt)}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date"
            className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
          />
          {!allDay && (
            <>
              <input
                type="time"
                step={900}
                value={toTimeInput(startAt)}
                onChange={(e) => setStartTime(e.target.value)}
                aria-label="Start time"
                className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
              />
              <span className="text-muted">–</span>
              <input
                type="time"
                step={900}
                value={toTimeInput(endAt)}
                onChange={(e) => setEndAt(applyTime(endAt, e.target.value))}
                aria-label="End time"
                className="mono rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
              />
            </>
          )}
          <button
            type="button"
            onClick={() => toggleAllDay(!allDay)}
            className={`tap fast rounded-full border px-3 py-2 text-label font-medium ${
              allDay ? "border-accent bg-accent text-on-accent" : "border-line text-muted"
            }`}
          >
            All day
          </button>
        </div>

        <div className="mt-3">
          <RepeatControl anchorISO={toDateISO(new Date(startAt))} value={repeat} onChange={setRepeat} variant="block" />
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
                      accountId === a.id ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface-2 text-muted"
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
            <Icon name="video" size={13} className={`shrink-0 ${addMeet ? "text-accent" : "text-muted/70"}`} />
            <span className={`flex-1 text-body font-medium ${addMeet ? "text-accent" : "text-muted"}`}>Google Meet</span>
            <span className={`relative h-5 w-9 shrink-0 rounded-full ${addMeet ? "bg-accent" : "bg-line-strong"}`}>
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[var(--shadow-1)] transition-[left] ${
                  addMeet ? "left-[18px]" : "left-0.5"
                }`}
              />
            </span>
          </button>
        )}

        {error && <div className="mt-3 rounded-md bg-signal-soft px-3 py-2 text-caption text-signal">{error}</div>}

        {confirmingGuests ? (
          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3.5">
            <div>
              <div className="text-body font-medium text-ink">
                {inviteConsentPrompt({ mode: "create", count: attendees.length, addMeet: Boolean(addMeet) })}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {attendees.map((email) => (
                  <span key={email} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-meta text-muted">
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
            className="tap fast mt-4 w-full rounded-xl py-3 text-head font-semibold shadow-sm active:translate-y-px disabled:shadow-none bg-accent text-on-accent disabled:border disabled:border-line disabled:bg-surface-2 disabled:text-muted"
          >
            {saving ? "Saving…" : sendsInvites ? "Create & invite…" : "Create event"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
