import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { createPortal } from "react-dom";
import { addDays, format } from "date-fns";
import { fmtDuration, parseDateISO, toDateISO } from "../lib/dates";
import { describeRule, expandRule, type RecurrenceRule } from "../lib/recurrence";
import { anchoredTop } from "../lib/anchoredTop";
import {
  POP_W_NARROW,
  POP_W_WIDE,
  PopBody,
  PopCol,
  PopField,
  PopFooter,
  PopMetaDot,
  PopSection,
  PopStack,
} from "./PopoverParts";
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

  // The composer wears the same two widths as the detail popovers (D-101): only
  // an Event has people to put in the right column, so a task and a slot stay
  // one column rather than opening a wide card with an empty half. Declared
  // above the placement effect, which measures against it.
  const twoCol = kind === "event";
  const popW = twoCol ? POP_W_WIDE : POP_W_NARROW;

  const [pos, setPos] = useState<{ top: number; left: number }>(() => ({
    top: fixedCssPx(point.y),
    left: fixedCssPx(point.x + 12),
  }));

  useEffect(() => { inputRef.current?.focus(); }, []);

  // The drag that opened us still has a `click` queued (mouseup → click). If
  // the backdrop listens for that leftover click, the composer mounts and
  // immediately cancels — leaving FullCalendar's select-mirror stuck on the
  // grid with no card. Arm dismiss only after that gesture has finished.
  const [backdropArmed, setBackdropArmed] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setBackdropArmed(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  // Re-place whenever the card *or* the window changes size, not just on mount:
  // switching to Event widens the card and adds the guest column, which would
  // otherwise grow past the bottom edge with no way to scroll to it.
  //
  // The card is PUT somewhere once and then only nudged to stay on screen — the
  // same rule the detail popovers follow (`anchoredTop`, D-101). Re-deriving the
  // top from the current height on every placement made the card jump every time
  // it grew; growth extends it downward instead. The side it opens on is frozen
  // for the same reason: a Task→Event switch changes the width, and re-deriving
  // the side could flip the whole card across the pointer mid-edit.
  const placedRef = useRef<{ top: number; side: "right" | "left" } | null>(null);
  useLayoutEffect(() => { placedRef.current = null; }, [point]);
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
      const w = popW * z;
      const prev = placedRef.current;
      const side = prev?.side ?? (point.x + 12 + w > vw - 8 ? "left" : "right");
      const left = Math.max(8, side === "right" ? point.x + 12 : point.x - 12 - w);
      const top = anchoredTop({
        align: "top",
        anchorTop: point.y - 20,
        anchorHeight: 0,
        height: h,
        viewportHeight: vh,
        previous: prev ? { top: prev.top, anchorTop: point.y - 20 } : undefined,
      });
      placedRef.current = { top, side };
      const next = { top: fixedCssPx(top), left: fixedCssPx(left) };
      // Bail when unchanged — ResizeObserver + setState(new object) would
      // otherwise re-render every frame and can tear down the composer.
      setPos((prev2) => (prev2.top === next.top && prev2.left === next.left ? prev2 : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(card);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [point, popW]);

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

  // The masthead's one line, and the chip that repeats it in the When field —
  // the read/edit split the detail popovers use.
  const dayLabel = multiDay
    ? `${format(start, "MMM d")} – ${format(end, "MMM d")}`
    : format(start, "EEE, MMM d");
  const isAllDay = allDay || (kind === "event" && eventAllDay);
  const timeLabel = isAllDay
    ? allDay && kind !== "event"
      ? "anytime"
      : "All day"
    : `${format(start, "h:mm")}–${format(end, "h:mm a")} · ${fmtDuration(durationMins)}`;
  const whenSummary = `${dayLabel} · ${timeLabel}`;

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={backdropArmed ? onCancel : undefined} />
      <div
        ref={cardRef}
        className="moment fixed z-50 flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface"
        style={{
          top: pos.top,
          left: pos.left,
          width: popW,
          maxHeight: "calc(100vh - 16px)",
          boxShadow: "var(--shadow-3)",
        }}
      >
        {/* ── Masthead — what kind, what it's called, and when. The same three
              lines the detail popovers open with (D-101): the kind switcher is
              this card's identity, the title is its hero, and the meta line
              carries the read the fields below let you change. ── */}
        <div className="flex shrink-0 flex-col gap-2.5 px-4 pt-3.5 pb-3">
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

          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="w-full rounded-[var(--radius)] border border-line bg-surface-2 px-3.5 py-2.5 text-head font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-muted/50 focus:border-accent focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />

          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-muted">
            <span className="mono">{whenSummary}</span>
            {repeat && (
              <>
                <PopMetaDot />
                <span title="Repeats">↻ {describeRule(repeat, anchorISO)}</span>
              </>
            )}
          </div>
        </div>

        {/* Left = what it is and when · right = who it involves. A task or a
            slot has nobody to put on the right, so it stays one column. */}
        <PopBody>
          <PopCol side={twoCol ? "left" : "only"}>
            <PopStack>
              <PopField label="When">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mono rounded-full bg-bg px-2.5 py-1 text-label text-ink">
                    {timeLabel}
                  </span>
                  {/* All day rides the time row as a chip — at 384px it used to
                      be a full-width switch, the heaviest object in a card whose
                      real primary is Create. */}
                  {kind === "event" && !allDay && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={eventAllDay}
                      onClick={() => setEventAllDay(!eventAllDay)}
                      className={`fast rounded-full border px-2.5 py-1 text-label ${
                        eventAllDay
                          ? "border-accent/40 bg-accent-soft font-medium text-accent"
                          : "border-line text-muted hover:border-line-strong hover:text-ink"
                      }`}
                    >
                      All day
                    </button>
                  )}
                  <RepeatControl anchorISO={anchorISO} value={repeat} onChange={setRepeat} />
                </div>
                {startsLater && (
                  <span className="text-micro text-muted">
                    First on {format(parseDateISO(firstOccurrence!), "EEE MMM d")} — not this day
                  </span>
                )}
              </PopField>

              {/* ── Calendar account — only when multiple writable accounts ── */}
              {kind === "event" && writableAccounts.length > 1 && (
                <PopField label="Calendar">
                  <div className="flex flex-wrap gap-1.5">
                    {writableAccounts.map((a) => {
                      const meta = providerMeta(a.provider);
                      const on = calendarAccountId === a.id;
                      // Two accounts can share an email (e.g. Google + iCloud both
                      // added under the same address) — the provider badge is the
                      // only thing that still tells them apart, so always show it.
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setCalendarAccountId(a.id)}
                          className={`fast flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label font-medium transition-colors ${
                            on
                              ? "border-accent/45 bg-accent-soft text-accent"
                              : "border-line text-muted hover:border-line-strong hover:text-ink"
                          }`}
                        >
                          <span
                            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-micro font-semibold leading-none"
                            style={{ background: meta.color, color: "var(--on-accent)" }}
                          >
                            {meta.letter}
                          </span>
                          {meta.name} · {a.email}
                        </button>
                      );
                    })}
                  </div>
                </PopField>
              )}

              {/* ── Google Meet — a fact of the event (how you get in), not a
                    fact about the guests, so it files with When and Calendar.
                    Google never adds one to an event created through the API, so
                    this toggle is the only thing that puts a way to meet
                    digitally on the invite. ── */}
              {kind === "event" && !eventAllDay && (
                <PopField label="Meeting">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={addMeet}
                    onClick={() => setMeetChoice(!addMeet)}
                    className={`fast inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-label font-medium ${
                      addMeet
                        ? "border-accent/45 bg-accent-soft text-accent"
                        : "border-line text-muted hover:border-line-strong hover:text-ink"
                    }`}
                  >
                    <Icon name="video" size={11} className="shrink-0" />
                    Google Meet
                    <span className="opacity-60">{addMeet ? "on" : "off"}</span>
                  </button>
                  {addMeet && (
                    <span className="text-micro text-muted">
                      Google mints the link and puts it on the invite — no need to paste it into the notes.
                    </span>
                  )}
                </PopField>
              )}

              {/* ── Domain — Slot tab only: makes a standing "domain slot" the weekly
                    plan routes matching work into (docs/standing-slots.md) ── */}
              {kind === "slot" && domains.length > 0 && (
                <PopField label="Domain">
                  <div className="flex flex-wrap gap-1.5">
                    {domains.map((d) => {
                      const on = domainId === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setDomainId(on ? null : d.id)}
                          className={`fast inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label font-medium transition-colors ${
                            on ? "text-ink" : "border-line text-muted hover:border-line-strong hover:text-ink"
                          }`}
                          // The domain's colour is the mark, never the label: it is
                          // user-chosen, so nothing legible can be promised on top
                          // of it (D-101).
                          style={
                            on
                              ? {
                                  borderColor: `color-mix(in srgb, ${d.color} 45%, transparent)`,
                                  background: `color-mix(in srgb, ${d.color} 12%, transparent)`,
                                }
                              : undefined
                          }
                        >
                          <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                          {d.name}
                        </button>
                      );
                    })}
                  </div>
                  {domainId && (
                    <span className="text-micro text-muted">
                      {repeat
                        ? "The weekly plan routes this domain's work here."
                        : "Add a Repeat above to have the plan route this domain's work here."}
                    </span>
                  )}
                </PopField>
              )}
            </PopStack>
          </PopCol>

          {twoCol && (
            <PopCol side="right">
              {/* ── Guests — only for calendar events ── */}
              <PopSection label="Guests" className="flex-1">
                <GuestsInput value={attendees} onChange={setAttendees} />
              </PopSection>
            </PopCol>
          )}
        </PopBody>

        {/* ── Actions ── */}
        {confirmingGuests ? (
          /* Naming the recipients is the point: "3 guests" tells you a count,
             not who is about to hear from you. */
          <div className="flex shrink-0 flex-col gap-3 border-t border-line p-3.5">
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
                className="fast tap inline-flex items-center justify-center rounded-[var(--radius)] px-3 py-2 text-body font-medium text-muted hover:bg-bg"
              >
                Back
              </button>
              <button
                onClick={() => finish(false)}
                className="fast tap inline-flex items-center justify-center rounded-[var(--radius)] border border-line px-3 py-2 text-body font-medium text-ink hover:bg-bg"
                title={QUIET_HINT}
              >
                Add without emailing
              </button>
              <button
                onClick={() => finish(true)}
                className="fast tap inline-flex items-center justify-center rounded-[var(--radius)] bg-accent px-4 py-2 text-body font-semibold text-on-accent shadow-[var(--shadow-1)] transition-opacity hover:opacity-90"
              >
                Send invites
              </button>
            </div>
          </div>
        ) : (
          <PopFooter>
            <div className="min-w-0 flex-1" />
            <button
              onClick={onCancel}
              className="fast tap inline-flex items-center justify-center rounded-[var(--radius)] px-3 py-2 text-body font-medium text-muted hover:bg-bg"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canCreate}
              className="fast tap inline-flex items-center justify-center gap-1.5 rounded-[var(--radius)] bg-accent px-5 py-2 text-body font-semibold text-on-accent shadow-[var(--shadow-1)] transition-opacity hover:opacity-90 disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
            >
              {sendsInvites ? "Create & invite…" : "Create"}
              <span className="text-meta font-normal text-on-accent/65">⌘↵</span>
            </button>
          </PopFooter>
        )}
      </div>
    </>,
    document.body,
  );
}
