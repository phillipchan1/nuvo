import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { createPortal } from "react-dom";
import { addDays, format } from "date-fns";
import { fmtDuration, parseDateISO, toDateISO } from "../lib/dates";
import { expandRule, type RecurrenceRule } from "../lib/recurrence";
import { fixedCssPx, getUiScale } from "../hooks/useUiScale";
import { RepeatControl } from "./RecurrencePicker";
import { GuestsInput } from "./GuestsInput";
import { providerMeta } from "../lib/calendarWrite";
import type { CalendarProvider } from "../lib/types";
import {
  DEFAULT_MEET_PREFERENCE,
  type MeetPreference,
  shouldAddMeet,
} from "../../supabase/functions/_shared/conferencing.ts";
// The consent sentence is shared with the chat's invite card: two doors onto
// outbound mail, one wording, one rule (D-046).
import { QUIET_HINT, inviteConsentPrompt } from "../../supabase/functions/_shared/invites.ts";

export type CreateKind = "task" | "event" | "slot";

/** Everything the composer decided, handed over in one piece — the fields are
 *  mostly optional flags, and eight positional arguments (two of them adjacent
 *  booleans) is how a "don't email them" turns into a mass invite. */
export interface CreateDraft {
  kind: CreateKind;
  title: string;
  recurrence: RecurrenceRule | null;
  attendees: string[];
  calendarAccountId?: string;
  domainId: string | null;
  notifyGuests: boolean;
  /** Attach a Google Meet link (events only). */
  addMeet: boolean;
  /** Whole-day calendar event (events only). */
  allDay: boolean;
}

const KINDS: { value: CreateKind; label: string; hint: string }[] = [
  { value: "task", label: "Task", hint: "a time-blocked to-do" },
  { value: "event", label: "Event", hint: "a Google calendar event" },
  { value: "slot", label: "Slot", hint: "a container for many tasks" },
];

const COMPOSER_W = 384;

/** The quick-create card that appears after a click-drag on the grid. */
export default function DraftComposer({
  start,
  end,
  point,
  initialKind,
  allDay = false,
  googleAvailable,
  writableAccounts = [],
  domains = [],
  meetPreference = DEFAULT_MEET_PREFERENCE,
  onCreate,
  onCancel,
}: {
  start: Date;
  end: Date;
  point: { x: number; y: number };
  initialKind: CreateKind;
  allDay?: boolean;
  googleAvailable: boolean;
  writableAccounts?: Array<{ id: string; email: string; provider: CalendarProvider }>;
  /** Domains offered on the Slot tab — pick one to make a "domain slot" the
   *  weekly plan routes matching work into (docs/standing-slots.md). */
  domains?: Array<{ id: string; name: string; color: string }>;
  /** The account's standing answer for "does a new event get a Meet link"
   *  (Settings → Calendars). Decides where the toggle starts; the user's own
   *  tap always wins for this event. */
  meetPreference?: MeetPreference;
  onCreate: (draft: CreateDraft) => void;
  onCancel: () => void;
}) {
  // Whole-day drafts (anytime row or month grid) offer Task + Event, never
  // Slot — a slot needs a specific time-of-day, which a day cell doesn't have.
  // A range spanning more than one day can only be an event — tasks/slots
  // can't span days.
  const multiDay = allDay && toDateISO(end) !== toDateISO(start);
  const kinds = KINDS.filter(
    (k) =>
      (k.value !== "event" || googleAvailable) &&
      (!allDay || k.value !== "slot") &&
      (!multiDay || k.value === "event"),
  );
  const [kind, setKind] = useState<CreateKind>(() =>
    kinds.some((k) => k.value === initialKind) ? initialKind : (kinds[0]?.value ?? "task"),
  );
  // A whole-day draft starts as a true all-day event; the timed grid's
  // ⌥-event draft still starts with a specific time.
  const [eventAllDay, setEventAllDay] = useState(allDay);
  const [title, setTitle] = useState("");
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(null);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [calendarAccountId, setCalendarAccountId] = useState(() => writableAccounts[0]?.id ?? "");
  const [domainId, setDomainId] = useState<string | null>(null);
  // null = "nobody has said" → follow the account preference, which for the
  // default ("guests") means the toggle turns itself on the moment a guest is
  // added. Once tapped, the explicit choice sticks for this event.
  const [meetChoice, setMeetChoice] = useState<boolean | null>(null);
  // Creating an event with guests emails real people. That is not something a
  // button labelled "Create" should do silently, so the last step names who is
  // about to be mailed and offers to skip it.
  const [confirmingGuests, setConfirmingGuests] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState<{ top: number; left: number }>(() => ({
    top: fixedCssPx(point.y),
    left: fixedCssPx(point.x + 12),
  }));

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Re-clamp to the viewport whenever the card *or* the window changes size, not
  // just on mount: switching to Event adds the Guests section (and the picker can
  // expand), which would otherwise grow the fixed card past the bottom edge with
  // no way to scroll to it. A ResizeObserver pulls it back up so it always fits.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const place = () => {
      const z = getUiScale();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Prefer visual size — under CSS zoom, offsetHeight is pre-zoom layout px
      // while point/innerWidth are post-zoom viewport coords.
      const h = card.getBoundingClientRect().height;
      const w = COMPOSER_W * z;
      let left = point.x + 12;
      if (left + w > vw - 8) left = point.x - 12 - w;
      left = Math.max(8, left);
      const top = Math.max(8, Math.min(point.y - 20, vh - h - 8));
      const next = { top: fixedCssPx(top), left: fixedCssPx(left) };
      // Bail when unchanged — ResizeObserver + setState(new object) would
      // otherwise re-render every frame and can tear down the composer.
      setPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(card);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [point]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCancel(); return; }
      // ⌘/Ctrl+Enter creates from anywhere in the card (title, guests, picker…),
      // not only the title field. No-ops if there's nothing valid to create yet.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        if (kind !== "slot" && !title.trim()) return;
        e.preventDefault();
        // Routed through submit() so the shortcut can't skip the guest
        // confirmation the button honours.
        submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, kind, title]);

  const durationMins = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));

  const anchorISO = toDateISO(start);
  const firstOccurrence =
    repeat && kind !== "event"
      ? expandRule(repeat, anchorISO, anchorISO, toDateISO(addDays(parseDateISO(anchorISO), 366)))[0]
      : null;
  const startsLater = firstOccurrence && firstOccurrence !== anchorISO;

  const canCreate = kind === "slot" || Boolean(title.trim());

  /** An event with guests is an outbound email, so it gets a confirm step. */
  const sendsInvites = kind === "event" && attendees.length > 0;

  const addMeet = kind === "event" && !eventAllDay && (meetChoice ?? shouldAddMeet(meetPreference, attendees.length));

  const finish = (notifyGuests: boolean) => {
    onCreate({
      kind,
      title: title.trim(),
      recurrence: repeat,
      attendees,
      calendarAccountId: calendarAccountId || undefined,
      domainId: kind === "slot" ? domainId : null,
      notifyGuests,
      addMeet,
      allDay: kind === "event" && eventAllDay,
    });
  };

  const submit = () => {
    if (!canCreate) return;
    if (sendsInvites && !confirmingGuests) { setConfirmingGuests(true); return; }
    finish(true);
  };

  // Kept in a ref so the ⌘↵ listener always calls the current closure without
  // re-subscribing on every keystroke.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const placeholder =
    kind === "event" ? "Event title…" : kind === "slot" ? "Slot name (optional)…" : "Task title…";

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onCancel} />
      <div
        ref={cardRef}
        className="moment fixed z-50 flex flex-col overflow-y-auto overscroll-contain rounded-[var(--radius-lg)] border border-line bg-surface"
        style={{
          top: pos.top,
          left: pos.left,
          width: COMPOSER_W,
          maxHeight: "calc(100vh - 16px)",
          boxShadow: "var(--shadow-3)",
        }}
      >
        {/* ── Kind switcher ── */}
        <div className="p-3.5 pb-0">
          <div className="flex gap-1 rounded-[var(--radius)] bg-bg p-1">
            {kinds.map((k) => (
              <button
                key={k.value}
                title={k.hint}
                onClick={() => setKind(k.value)}
                className={`fast flex flex-1 items-center justify-center rounded-[var(--radius-sm)] px-3 py-2 text-body font-semibold transition-colors ${
                  kind === k.value
                    ? "bg-surface text-accent shadow-[var(--shadow-1)]"
                    : "text-muted hover:text-ink"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Title — hero field ── */}
        <div className="px-3.5 pt-3.5">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={placeholder}
            className="w-full rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3 text-head font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-muted/50 focus:border-accent focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </div>

        {/* ── When — tonal info row ── */}
        <div className="px-3.5 pt-3">
          <div className="flex items-center gap-2.5 rounded-[var(--radius)] bg-surface-2 px-3.5 py-2.5 text-body">
            <Icon name="clock" size={13} className="shrink-0 text-muted/70" />
            <span className="font-medium text-ink">
              {multiDay ? `${format(start, "MMM d")} – ${format(end, "MMM d")}` : format(start, "EEE, MMM d")}
            </span>
            <span className="text-muted/40">·</span>
            {allDay ? (
              <span className="text-muted">{kind === "event" ? "All day" : "anytime"}</span>
            ) : kind === "event" && eventAllDay ? (
              <span className="text-muted">All day</span>
            ) : (
              <>
                <span className="text-muted">{format(start, "h:mm")}–{format(end, "h:mm a")}</span>
                <span className="ml-auto shrink-0 rounded-full bg-bg px-2.5 py-0.5 text-caption font-medium text-muted">
                  {fmtDuration(durationMins)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* ── All day — calendar events only; a whole-day draft is already
              all-day, so there's no specific time to offer switching back to ── */}
        {kind === "event" && !allDay && (
          <div className="px-3.5 pt-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={eventAllDay}
              onClick={() => setEventAllDay(!eventAllDay)}
              className={`fast tap flex w-full items-center gap-2.5 rounded-[var(--radius)] border px-3.5 py-2.5 text-left transition-colors ${
                eventAllDay ? "border-accent/40 bg-accent-soft" : "border-line bg-surface-2 hover:border-line-strong"
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className={`shrink-0 ${eventAllDay ? "text-accent" : "text-muted/70"}`}>
                <rect x="1" y="2" width="10" height="8" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
                <path d="M1 5h10" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              <span className={`flex-1 text-body font-medium ${eventAllDay ? "text-accent" : "text-muted"}`}>
                All day
              </span>
              <span
                className={`fast relative h-5 w-9 shrink-0 rounded-full ${eventAllDay ? "bg-accent" : "bg-line-strong"}`}
              >
                <span
                  className={`fast absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[var(--shadow-1)] transition-[left] ${
                    eventAllDay ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </span>
            </button>
          </div>
        )}

        {/* ── Repeat ── */}
        <div className="flex flex-col gap-1.5 px-3.5 pt-2.5">
          <RepeatControl anchorISO={anchorISO} value={repeat} onChange={setRepeat} variant="block" />
          {startsLater && (
            <span className="pl-1 text-meta text-muted">
              First on {format(parseDateISO(firstOccurrence!), "EEE MMM d")} — not this day
            </span>
          )}
        </div>

        {/* ── Domain — Slot tab only: makes a standing "domain slot" the weekly
              plan routes matching work into (docs/standing-slots.md) ── */}
        {kind === "slot" && domains.length > 0 && (
          <div className="px-3.5 pt-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-label font-semibold uppercase tracking-wider text-muted">
              <Icon name="package" size={11} />
              Domain
            </div>
            <div className="flex flex-wrap gap-1.5">
              {domains.map((d) => {
                const on = domainId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDomainId(on ? null : d.id)}
                    className={`fast inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption font-medium transition-colors ${
                      on ? "border-transparent text-white" : "border-line bg-surface-2 text-muted hover:text-ink"
                    }`}
                    style={on ? { background: d.color } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: on ? "rgba(255,255,255,.85)" : d.color }} />
                    {d.name}
                  </button>
                );
              })}
            </div>
            {domainId && (
              <p className="mt-1.5 pl-1 text-meta text-muted">
                {repeat ? "The weekly plan routes this domain's work here." : "Add a Repeat above to have the plan route this domain's work here."}
              </p>
            )}
          </div>
        )}

        {/* ── Calendar account — only when multiple writable accounts ── */}
        {kind === "event" && writableAccounts.length > 1 && (
          <div className="px-3.5 pt-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-label font-semibold uppercase tracking-wider text-muted">
              <Icon name="calendar" size={11} />
              Calendar
            </div>
            <div className="flex flex-wrap gap-1.5">
              {writableAccounts.map((a) => {
                const meta = providerMeta(a.provider);
                // Two accounts can share an email (e.g. Google + iCloud both
                // added under the same address) — the provider badge is the
                // only thing that still tells them apart, so always show it.
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setCalendarAccountId(a.id)}
                    className={`fast flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption font-medium transition-colors ${
                      calendarAccountId === a.id
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-line bg-surface-2 text-muted hover:text-ink"
                    }`}
                  >
                    <span
                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold leading-none text-white"
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

        {/* ── Guests — only for Google calendar events ── */}
        {kind === "event" && (
          <div className="px-3.5 pt-3.5">
            <div className="mb-2 flex items-center gap-1.5 text-label font-semibold uppercase tracking-wider text-muted">
              <Icon name="user-plus" size={11} />
              Guests
            </div>
            <GuestsInput value={attendees} onChange={setAttendees} />
          </div>
        )}

        {/* ── Google Meet — Google never adds one to an event created through
              the API, so this toggle is the only thing that puts a way to meet
              digitally on the invite ── */}
        {kind === "event" && !eventAllDay && (
          <div className="px-3.5 pt-3">
            <button
              type="button"
              role="switch"
              aria-checked={addMeet}
              onClick={() => setMeetChoice(!addMeet)}
              className={`fast tap flex w-full items-center gap-2.5 rounded-[var(--radius)] border px-3.5 py-2.5 text-left transition-colors ${
                addMeet ? "border-accent/40 bg-accent-soft" : "border-line bg-surface-2 hover:border-line-strong"
              }`}
            >
              <Icon name="video" size={13} className={`shrink-0 ${addMeet ? "text-accent" : "text-muted/70"}`} />
              <span className={`flex-1 text-body font-medium ${addMeet ? "text-accent" : "text-muted"}`}>
                Google Meet
              </span>
              <span
                className={`fast relative h-5 w-9 shrink-0 rounded-full ${addMeet ? "bg-accent" : "bg-line-strong"}`}
              >
                <span
                  className={`fast absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[var(--shadow-1)] transition-[left] ${
                    addMeet ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </span>
            </button>
            {addMeet && (
              <p className="mt-1.5 pl-1 text-meta text-muted">
                Google mints the link and puts it on the invite — no need to paste it into the notes.
              </p>
            )}
          </div>
        )}

        {/* ── Actions ── */}
        {confirmingGuests ? (
          /* Naming the recipients is the point: "3 guests" tells you a count,
             not who is about to hear from you. */
          <div className="mt-3.5 flex flex-col gap-3 border-t border-line p-3.5">
            <div>
              <div className="text-body font-medium text-ink">
                {inviteConsentPrompt({ mode: "create", count: attendees.length, addMeet })}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {attendees.map((email) => (
                  <span key={email} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-meta text-muted">
                    {email}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setConfirmingGuests(false)}
                className="fast tap inline-flex items-center justify-center rounded-[var(--radius)] px-3 py-2.5 text-body font-medium text-muted hover:bg-bg"
              >
                Back
              </button>
              <button
                onClick={() => finish(false)}
                className="fast tap inline-flex items-center justify-center rounded-[var(--radius)] border border-line px-3 py-2.5 text-body font-medium text-ink hover:bg-bg"
                title={QUIET_HINT}
              >
                Add without emailing
              </button>
              <button
                onClick={() => finish(true)}
                className="fast tap inline-flex items-center justify-center rounded-[var(--radius)] bg-accent px-4 py-2.5 text-body font-semibold text-on-accent shadow-[var(--shadow-1)] transition-opacity hover:opacity-90"
              >
                Send invites
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-line p-3.5">
            <button
              onClick={onCancel}
              className="fast tap inline-flex items-center justify-center rounded-[var(--radius)] px-4 py-2.5 text-body font-medium text-muted hover:bg-bg"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canCreate}
              className="fast tap inline-flex items-center justify-center gap-1.5 rounded-[var(--radius)] bg-accent px-6 py-2.5 text-body font-semibold text-on-accent shadow-[var(--shadow-1)] transition-opacity hover:opacity-90 disabled:bg-surface-2 disabled:text-muted disabled:shadow-none disabled:shadow-none"
            >
              {sendsInvites ? "Create & invite…" : "Create"}
              <span className="text-meta font-normal text-white/65">⌘↵</span>
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
