import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, format } from "date-fns";
import { span } from "./mobile/dayPlan";
import { fmtDuration, parseDateISO, toDateISO } from "../lib/dates";
import { describeRule, expandRule, type RecurrenceRule } from "../lib/recurrence";
import { anchoredTop } from "../lib/anchoredTop";
import { INSPECTOR_W, PopBody, PopFooter, PopGrow, PopMetaDot, PopPick, PopRow, PopSection } from "./PopoverParts";
import { Button, Chip, Dot, Segmented, Switch } from "./kit";
import { AltitudeIcon } from "./icons";
import { fixedCssPx, getUiScale } from "../hooks/useUiScale";
import { RepeatControl } from "./RecurrencePicker";
import { GuestsInput } from "./GuestsInput";
import type { CreateTarget } from "../lib/calendarWrite";
import { EventCalendarPicker, useEventCalendar } from "./calendar/EventCalendarPicker";
import {
  DEFAULT_MEET_PREFERENCE,
  type MeetPreference,
  shouldAddMeet,
} from "../../supabase/functions/_shared/conferencing.ts";
// The consent sentence is shared with the chat's invite card: two doors onto
// outbound mail, one wording, one rule (D-046).
import { QUIET_HINT, inviteConsentPrompt } from "../../supabase/functions/_shared/invites.ts";
import { DEFAULT_REMINDER_PREFS, defaultLeadsFor } from "../../supabase/functions/_shared/reminderRules.ts";
import { DraftReminderSelect, type ReminderDraft } from "./ReminderSelect";
import { useSettings } from "../hooks/useSettings";
import { isTypingIn } from "../lib/a11y";
import { markCalendarClickHandled } from "../lib/calendarDismissGuard";
import { NUDGE_MINUTES } from "./calendar/blockKeys";

export type CreateKind = "task" | "event" | "slot";

/** Everything the composer decided, handed over in one piece — the fields are
 *  mostly optional flags, and eight positional arguments (two of them adjacent
 *  booleans) is how a "don't email them" turns into a mass invite. */
export interface CreateDraft {
  kind: CreateKind;
  title: string;
  recurrence: RecurrenceRule | null;
  attendees: string[];
  /** The calendar the event goes on (events only). */
  calendar?: CreateTarget;
  domainId: string | null;
  notifyGuests: boolean;
  /** Attach a Google Meet link (events only). */
  addMeet: boolean;
  /** Whole-day calendar event (events only). */
  allDay: boolean;
  /** Per-item reminder override. Omit / default = follow Settings. */
  reminder?: ReminderDraft;
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
  domains = [],
  meetPreference = DEFAULT_MEET_PREFERENCE,
  onCreate,
  onCancel,
  onNudge,
}: {
  start: Date;
  end: Date;
  point: { x: number; y: number };
  initialKind: CreateKind;
  allDay?: boolean;
  googleAvailable: boolean;
  /** Domains offered on the Slot tab — pick one to make a "domain slot" the
   *  weekly plan routes matching work into (docs/standing-slots.md). */
  domains?: Array<{ id: string; name: string; color: string }>;
  /** The account's standing answer for "does a new event get a Meet link"
   *  (Settings → Calendars). Decides where the toggle starts; the user's own
   *  tap always wins for this event. */
  meetPreference?: MeetPreference;
  onCreate: (draft: CreateDraft) => void;
  onCancel: () => void;
  /** ↑ / ↓ move the drawn range a quarter hour, ⇧↑ / ⇧↓ its end (D-158) — the
   *  host owns the range (its ghost on the grid is draggable too). Absent for an
   *  all-day draft, which has no clock to nudge. */
  onNudge?: (edge: "both" | "end", minutes: number) => void;
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
  const calendar = useEventCalendar();
  const isGoogle = calendar.provider === "google";
  const [domainId, setDomainId] = useState<string | null>(null);
  // null = "nobody has said" → follow the account preference, which for the
  // default ("guests") means the toggle turns itself on the moment a guest is
  // added. Once tapped, the explicit choice sticks for this event.
  const [meetChoice, setMeetChoice] = useState<boolean | null>(null);
  // Creating an event with guests emails real people. That is not something a
  // button labelled "Create" should do silently, so the last step names who is
  // about to be mailed and offers to skip it.
  const [confirmingGuests, setConfirmingGuests] = useState(false);
  const [reminder, setReminder] = useState<ReminderDraft>({ mode: "default" });
  const { settings } = useSettings();
  const reminderPrefs = settings?.reminder_prefs ?? DEFAULT_REMINDER_PREFS;
  const reminderDefaults = defaultLeadsFor(
    {
      targetKind: kind === "event" ? "event" : kind === "slot" ? "slot" : "task",
      anchor: "start",
      allDay: kind === "event" ? eventAllDay : kind === "task" && allDay,
    },
    reminderPrefs,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // The composer wears the inspectors' one width (D-190). Declared above the
  // placement effect, which measures against it.
  const popW = INSPECTOR_W;

  const [pos, setPos] = useState<{ top: number; left: number }>(() => ({
    top: fixedCssPx(point.y),
    left: fixedCssPx(point.x + 12),
  }));

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Dismiss on a press outside — not on a full-viewport backdrop. The backdrop
  // ate the next press whole (a press on a block did nothing but close the
  // card) and covered the draft's own ghost, so the range you'd drawn could
  // never be adjusted, only redrawn (#33). Listening on mousedown, not the
  // leftover `click` of the drag that opened us, so that click can't close it.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // The second press of a double-click is the same intent as the first —
      // double-clicking the grid to make something must not throw it away.
      if (e.detail > 1) return;
      const t = e.target as Element | null;
      if (!t || cardRef.current?.contains(t)) return;
      // The ghost IS the draft: dragging or resizing it adjusts, never dismisses.
      if (t.closest(".evt-draft-preview")) return;
      // A picker the card opened floats in its own layer (Repeat, a calendar list).
      if (t.closest("[data-nested-surface]")) return;
      // A tap on empty grid that closes the card is a dismiss, not a new draft —
      // the popovers' rule (calendarDismissGuard). A drag there still draws.
      if (t.closest(".fc")) markCalendarClickHandled();
      onCancelRef.current();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
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

  const onNudgeRef = useRef(onNudge);
  onNudgeRef.current = onNudge;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCancel(); return; }
      // ↑ / ↓ nudge the range, ⇧ its end — from the title (a one-line field has
      // no use for them) or from anywhere in the card that isn't another field.
      const nudge = onNudgeRef.current;
      if (
        nudge &&
        (e.key === "ArrowUp" || e.key === "ArrowDown") &&
        !e.metaKey && !e.ctrlKey && !e.altKey &&
        (e.target === inputRef.current || !isTypingIn(e.target)) &&
        (e.target === document.body || cardRef.current?.contains(e.target as Node))
      ) {
        e.preventDefault();
        nudge(e.shiftKey ? "end" : "both", e.key === "ArrowUp" ? -NUDGE_MINUTES : NUDGE_MINUTES);
        return;
      }
      // Enter creates. ⌘/Ctrl+Enter from anywhere in the card (title, guests,
      // picker…). Plain Enter from the name, the card, or the body — choosing
      // Repeat moves focus off the name, and Enter still has to finish the slot.
      // A focused button activates itself. Another field keeps its own Enter.
      // The repeat popover is a different surface and owns Enter while it is open.
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.isComposing) {
        const target = e.target as HTMLElement | null;
        const foreign =
          target instanceof Element &&
          !!target.closest("[data-nested-surface]") &&
          !cardRef.current?.contains(target);
        if (foreign) return;
        const cmd = e.metaKey || e.ctrlKey;
        if (!cmd) {
          if (isTypingIn(target) && target !== inputRef.current) return;
          if (target instanceof Element && target.closest("button, a")) return;
          const inCard =
            target === document.body ||
            target === inputRef.current ||
            (target instanceof Node && !!cardRef.current?.contains(target));
          if (!inCard) return;
        }
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

  // Guests and Meet are Google's: Apple's CalDAV create carries neither, so on
  // an Apple calendar they are not offered and never sent.
  const guests = isGoogle ? attendees : [];

  /** An event with guests is an outbound email, so it gets a confirm step. */
  const sendsInvites = kind === "event" && guests.length > 0;

  const addMeet =
    kind === "event" && isGoogle && !eventAllDay && (meetChoice ?? shouldAddMeet(meetPreference, guests.length));

  const finish = (notifyGuests: boolean) => {
    onCreate({
      kind,
      title: title.trim(),
      recurrence: repeat,
      attendees: guests,
      calendar: kind === "event" ? (calendar.target ?? undefined) : undefined,
      domainId: kind === "slot" ? domainId : null,
      notifyGuests,
      addMeet,
      allDay: kind === "event" && eventAllDay,
      reminder,
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
    // The shared clock spelling (`span`): "11:00–1:00 PM" read as 11pm-ish —
    // dropping the first meridiem is only safe when both ends share it.
    : `${span(start, end)} · ${fmtDuration(durationMins)}`;
  const whenSummary = `${dayLabel} · ${timeLabel}`;

  return createPortal(
    <>
      <div
        ref={cardRef}
        // A floating surface: the grid's block keys and the Schedule's letters
        // stand down while it's up — ↑↓ here are the draft's.
        data-nested-surface=""
        className="insp fixed z-50"
        style={{
          top: pos.top,
          left: pos.left,
          width: popW,
          maxHeight: "calc(100vh - 16px)",
          ["--pop-origin" as string]: placedRef.current?.side === "left" ? "top right" : "top left",
        }}
      >
        {/* ── Head — what kind, what it's called, and when. The kind switch is
              this card's identity, the name is its hero, and the meta line
              carries the read the rows below let you change (D-101). ── */}
        <div className="insp-head" data-nodot="">
          {kinds.length > 1 && (
            <Segmented
              className="k-seg-full mb-1.5"
              label="Make a"
              value={kind}
              onChange={setKind}
              options={kinds.map((k) => ({ value: k.value, label: k.label, title: k.hint }))}
            />
          )}
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
              // The window listener also creates on Enter. Stop here so the
              // name field cannot submit twice.
              e.preventDefault();
              e.stopPropagation();
              submit();
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="insp-title-input"
          />
          <div className="insp-meta">
            <span>{whenSummary}</span>
            {repeat && (
              <>
                <PopMetaDot />
                <span title="Repeats">{describeRule(repeat, anchorISO)}</span>
              </>
            )}
          </div>
        </div>

        <PopBody>
          <PopRow icon="repeat" label="Repeat">
            <RepeatControl variant="value" anchorISO={anchorISO} value={repeat} onChange={setRepeat} />
            {startsLater && (
              <span className="insp-hint">First on {format(parseDateISO(firstOccurrence!), "EEE MMM d")}</span>
            )}
          </PopRow>

          {/* All day rides a row of its own — a switch you touch twice a year,
              never the heaviest object in a card whose primary is Create. */}
          {kind === "event" && !allDay && (
            <PopRow icon="clock" label="All day">
              <label className="flex flex-1 items-center justify-between gap-2">
                <span>All day</span>
                <Switch checked={eventAllDay} onChange={setEventAllDay} label="All day" />
              </label>
            </PopRow>
          )}

          <PopRow icon="bell" label="Remind" top>
            <DraftReminderSelect
              defaultLeads={reminderDefaults}
              allDay={kind === "event" ? eventAllDay : kind === "task" && allDay}
              enabled={reminderPrefs.enabled}
              value={reminder}
              onChange={setReminder}
              block
            />
          </PopRow>

          {kind === "event" && calendar.choosable && (
            <PopRow icon="calendar" label="Calendar" top>
              <EventCalendarPicker
                variant="value"
                groups={calendar.groups}
                value={calendar.target}
                defaultTarget={calendar.defaultTarget}
                onChange={calendar.pick}
              />
            </PopRow>
          )}

          {/* ── Google Meet — a fact of the event (how you get in), so it files
                with the calendar. Google never adds one to an event created
                through the API, so this is the only thing that puts a way to
                meet on the invite. ── */}
          {kind === "event" && isGoogle && !eventAllDay && (
            <PopRow icon="video" label="Google Meet">
              <label className="flex flex-1 items-center justify-between gap-2">
                <span>Google Meet</span>
                <Switch checked={addMeet} onChange={() => setMeetChoice(!addMeet)} label="Google Meet" />
              </label>
            </PopRow>
          )}

          {/* ── Domain — Slot only: a standing "domain slot" the weekly plan
                routes matching work into (docs/standing-slots.md) ── */}
          {kind === "slot" && domains.length > 0 && (
            <PopRow icon={<AltitudeIcon kind="domain" size={14} />} label="Domain">
              <PopPick
                label="Domain"
                value={domainId ?? ""}
                options={[
                  { value: "", label: "No domain" },
                  ...domains.map((d) => ({ value: d.id, label: d.name, icon: <Dot color={d.color} /> })),
                ]}
                onChange={(v) => setDomainId(v || null)}
                empty={!domainId}
                lead={domainId ? <Dot color={domains.find((d) => d.id === domainId)?.color ?? "var(--faint)"} /> : undefined}
              >
                {domains.find((d) => d.id === domainId)?.name ?? "No domain"}
              </PopPick>
              {domainId && (
                <span
                  className="insp-hint"
                  title={
                    repeat
                      ? "The weekly plan routes this domain's work here."
                      : "Add a repeat and the weekly plan routes this domain's work here."
                  }
                >
                  {repeat ? "Standing" : "One-off"}
                </span>
              )}
            </PopRow>
          )}

          {/* ── Guests — calendar events only ── */}
          {kind === "event" && (
            <PopSection label="Guests" icon="users">
              {isGoogle ? (
                <GuestsInput value={attendees} onChange={setAttendees} placeholder="Name or email" />
              ) : (
                <span className="insp-hint">Guests need a Google calendar.</span>
              )}
            </PopSection>
          )}
        </PopBody>

        {/* ── Actions ── */}
        {confirmingGuests ? (
          /* Naming the recipients is the point: "3 guests" tells you a count,
             not who is about to hear from you. */
          <div className="insp-ask">
            <p>{inviteConsentPrompt({ mode: "create", count: guests.length, addMeet })}</p>
            <div className="flex flex-wrap gap-1">
              {guests.map((email) => (
                <Chip key={email}>{email}</Chip>
              ))}
            </div>
            <div className="insp-ask-acts">
              <Button kind="ghost" onClick={() => setConfirmingGuests(false)}>
                Back
              </Button>
              <Button onClick={() => finish(false)} title={QUIET_HINT}>
                Add without emailing
              </Button>
              <Button kind="primary" onClick={() => finish(true)}>
                Send invites
              </Button>
            </div>
          </div>
        ) : (
          <PopFooter>
            <PopGrow />
            <Button kind="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button kind="primary" onClick={submit} disabled={!canCreate} shortcut={["⌘", "↵"]}>
              {sendsInvites ? "Create & invite…" : "Create"}
            </Button>
          </PopFooter>
        )}
      </div>
    </>,
    document.body,
  );
}
