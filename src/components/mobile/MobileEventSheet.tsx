import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SlotDeferPanel } from "../floors/DeferPanel";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "../Icon";
import TaskRow from "../TaskRow";
import type { AttendeeStatus, ExternalEvent, Label, RecurrenceScope, Slot, Task } from "../../lib/types";
import type { useTaskMutations } from "../../hooks/useTasks";
import { useSlotMutations } from "../../hooks/useSlots";
import { useOptionalVertical } from "../../hooks/useVertical";
import { domainById, projectById } from "../../lib/vertical";
import { isExternalEventRecurring } from "../../lib/now";
import { useCalendarAccounts, useEventDetails, useEventSeriesRule, useExternalEventMutations } from "../../hooks/useCalendar";
import { conferenceName, joinUrl } from "../../../supabase/functions/_shared/conferencing.ts";
import {
  allDayInclusiveEnd,
  allDayRangeFromStart,
  defaultTimedRange,
  nextWeekISO,
  parseDateISO,
  toDateISO,
  todayISO,
  tomorrowISO,
} from "../../lib/dates";
import { CALENDAR_OFFLINE_NOTE, isWritableCalendar } from "../../lib/calendarWrite";
import { useOnline } from "../../hooks/useOnline";
import { plainTextFromHtml } from "../../lib/text";
import { DescriptionHtml } from "../../lib/descriptionHtml";
import { describeRule, eventRRule, readEventRRule, rulesEqual, type RecurrenceRule } from "../../lib/recurrence";
import { RepeatControl, RecurrenceScopeDialog, useRecurringScope } from "../RecurrencePicker";
import ReminderSelect from "../ReminderSelect";
import EventDomainControl from "../domain/EventDomainControl";
import { eventKey } from "../../lib/now";
// The sheet had its own copy of the clock format. The calendar it opens over
// spells a time one way (`span` / `at` in dayPlan), so the sheet says it that
// way too — a second definition is how the two drifted apart to begin with.
import { span } from "./dayPlan";
import Sheet from "./Sheet";
import {
  ActionRow,
  AutoText,
  Chip,
  ChipGrid,
  DestructiveRow,
  MetaDot,
  ResponseSegmented,
  RowList,
  SHEET_BODY,
  SHEET_SCROLL,
  SheetMast,
  SheetSection,
  dayWord,
  fmtDay,
  useSheetTitle,
  type ResponseOption,
} from "./sheetKit";

// The shape passed from MobileCalendar when the user taps an event row.
export type CalendarTap =
  | {
      kind: "event";
      id: string;
      providerEventId?: string;
      title: string;
      start: Date;
      end: Date;
      allDay?: boolean;
      location: string | null;
      self_rsvp: AttendeeStatus | null | undefined;
      accountId?: string;
      calendarId?: string;
    }
  // A task placed on the calendar. The shell opens the ONE Task sheet for it
  // (`MobileTaskSheet`) — this sheet never draws one; the variant stays so the
  // calendar can say what it tapped.
  | { kind: "block"; taskId: string; title: string; start: Date; end: Date; done: boolean }
  | { kind: "slot"; slot: Slot; title: string; start: Date; end: Date; childCount: number; doneCount: number };

type Mutations = ReturnType<typeof useTaskMutations>;

/** Same words and tokens as the desktop popover's "Going?" control. */
const RSVP_OPTIONS: ResponseOption<AttendeeStatus>[] = [
  { value: "accepted", label: "Yes", glyph: "✓", tone: "ok" },
  { value: "tentative", label: "Maybe", glyph: "?", tone: "warn" },
  { value: "declined", label: "No", glyph: "✕", tone: "signal" },
];

export default function MobileEventSheet({
  tap,
  slotChildren,
  labels = [],
  mutations,
  onClose,
  onAskNuvo,
  onEditTask,
}: {
  tap: CalendarTap;
  /** kind === "slot" only — its live child tasks, resolved by the caller. */
  slotChildren?: Task[];
  labels?: Label[];
  mutations: Mutations;
  onClose: () => void;
  onAskNuvo?: (seed: string, say?: string) => void;
  onEditTask?: (taskId: string) => void;
}) {
  const qc = useQueryClient();
  const { rsvpEvent, updateEvent, deleteEvent } = useExternalEventMutations();
  const slotMutations = useSlotMutations();
  const { data: accounts = [] } = useCalendarAccounts();
  // Same write-back rule as desktop's EventPopover: a two-way Google/iCloud
  // account, and not a read-only mirror/holiday/subscription calendar.
  const account = tap.kind === "event" ? accounts.find((a) => a.id === tap.accountId) : undefined;
  // The phone is where a video meeting actually gets joined, so the sheet pulls
  // the raw event for its conference link the same way the desktop inspector
  // does. Null for a task block — hooks can't hide behind the branch below.
  const { data: raw } = useEventDetails(tap.kind === "event" ? tap.id : null, account?.email);
  // Re-read when the calendar cache changes: turning a single event into a
  // series re-keys its row to an occurrence, and the sheet has to notice it is
  // now recurring (scope prompts, the series rule) without being reopened.
  const [cacheTick, setCacheTick] = useState(0);
  useEffect(
    () =>
      qc.getQueryCache().subscribe((e) => {
        if (e.type === "updated" && e.query.queryKey[0] === "external_events") setCacheTick((t) => t + 1);
      }),
    [qc],
  );
  const cachedEvent = useMemo(() => {
    if (tap.kind !== "event") return undefined;
    for (const [, data] of qc.getQueriesData<ExternalEvent[]>({ queryKey: ["external_events"] })) {
      const found = data?.find((e) => e.id === tap.id);
      if (found) return found;
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, tap, cacheTick]);
  const attributionEvent =
    tap.kind === "event"
      ? (cachedEvent ?? {
          account_id: tap.accountId ?? "",
          provider_event_id: tap.providerEventId ?? "",
          calendar_id: tap.calendarId ?? "",
        })
      : null;
  const recurring =
    tap.kind === "event" &&
    isExternalEventRecurring(
      {
        recurring_event_id: cachedEvent?.recurring_event_id ?? null,
        provider_event_id: cachedEvent?.provider_event_id ?? "",
      },
      {
        raw: raw as { recurrence?: string[]; recurringEventId?: string } | null,
        provider: account?.provider ?? "google",
      },
    );
  const inlineRule = readEventRRule((raw as { recurrence?: string[] } | null)?.recurrence);
  const { data: seriesRule } = useEventSeriesRule(tap.kind === "event" ? tap.id : null, recurring, account?.provider ?? null);
  // What the user just picked, shown until the series' own rule comes back —
  // otherwise the picker snaps to "Does not repeat" for the round trip and
  // reads as though the change didn't take.
  const [pickedRule, setPickedRule] = useState<RecurrenceRule | null | undefined>(undefined);
  useEffect(() => setPickedRule(undefined), [tap.kind === "event" ? tap.id : ""]);
  const repeatRule = pickedRule !== undefined ? pickedRule : (inlineRule ?? seriesRule ?? null);
  const meetLink = joinUrl(raw, tap.kind === "event" ? tap.location : null);
  const [rsvping, setRsvping] = useState(false);
  const [showAllGuests, setShowAllGuests] = useState(false);

  // Editable-event state — only meaningful for tap.kind === "event", but
  // declared unconditionally since hooks can't hide behind the branch below.
  const [title, setTitle] = useState(tap.kind === "event" ? tap.title : "");
  const [location, setLocation] = useState(tap.kind === "event" ? (tap.location ?? "") : "");
  const [notes, setNotes] = useState("");
  const [startAt, setStartAt] = useState(tap.kind === "event" ? tap.start.toISOString() : "");
  const [endAt, setEndAt] = useState(tap.kind === "event" ? tap.end.toISOString() : "");
  const [allDay, setAllDay] = useState(tap.kind === "event" ? Boolean(tap.allDay) : false);
  const { pending: editScope, commit: commitScoped, confirm: confirmScope, cancel: cancelScope, dismiss: dismissScope } =
    useRecurringScope(recurring);

  // What was last SENT, per field. The old checks compared against `tap` — a
  // snapshot taken when the sheet opened — so renaming "A" to "B" and then back
  // to "A" read as "unchanged" and the second write was silently dropped: the
  // field said A, Google still said B.
  const sent = useRef({
    title: tap.kind === "event" ? tap.title : "",
    location: tap.kind === "event" ? (tap.location ?? "") : "",
    notes: "",
  });

  useEffect(() => {
    dismissScope();
  }, [tap.kind === "event" ? tap.id : "", dismissScope]);

  // Seed notes once the raw payload (with the description) arrives — same
  // plain-text flattening the desktop inspector uses for a Google HTML body.
  useEffect(() => {
    const plain = plainTextFromHtml(raw?.description ?? "");
    sent.current.notes = plain;
    setNotes(plain);
  }, [raw?.description]);

  // Offline is a real reason an event can't be edited, so it belongs in the
  // same predicate as "read-only feed" rather than surfacing later as a failed
  // save. `external_events` is not in SYNC_TABLES and deliberately never will
  // be — Google and Apple own these rows, so a queued local edit is a promise
  // Nuvo can't keep (see the note in lib/calendarWrite.ts). Going inert and
  // saying why beats accepting the typing and losing it.
  const online = useOnline();
  const writableEvent = tap.kind === "event" && isWritableCalendar(account, tap.calendarId);
  const editable = writableEvent && online;
  const offlineOnly = writableEvent && !online;

  // Leaving the sheet commits what's typed. iOS never blurs a field when ✕ or
  // the scrim is tapped (a button doesn't take focus in Safari), so an edit that
  // hadn't been tabbed out of was lost. A repeating event can't be written
  // without its this-or-all question, so closing waits for that answer instead
  // of dropping the edit or asking after the sheet is gone.
  const flushRef = useRef<() => boolean>(() => false);
  const closeAfterScope = useRef(false);
  const close = () => {
    if (flushRef.current()) {
      closeAfterScope.current = true;
      return;
    }
    onClose();
  };
  useEffect(() => {
    if (!editScope && closeAfterScope.current) {
      closeAfterScope.current = false;
      onClose();
    }
  }, [editScope, onClose]);

  const { title: sheetTitle, onContentScroll } = useSheetTitle(
    tap.kind === "slot" ? "Block" : "Event",
    tap.kind === "event" ? title : "",
  );

  const handleAskNuvo = () => {
    if (!onAskNuvo) return;
    const seed =
      tap.kind === "event"
        ? `I have "${tap.title}"${!tap.allDay ? ` at ${span(tap.start, tap.end)}` : ""}${tap.location ? ` at ${tap.location}` : ""}. Help me prepare.`
        : tap.kind === "slot"
          ? `I have a block "${tap.title}" at ${span(tap.start, tap.end)} holding ${tap.childCount} task${tap.childCount === 1 ? "" : "s"}. Help me think about it.`
          : `I have a task block: "${tap.title}" at ${span(tap.start, tap.end)}. Help me think about it.`;
    // The seed carries the whole block (title, time, place) so Nuvo doesn't have
    // to go looking; the transcript shows what the user actually pressed.
    onAskNuvo(seed, `Help me prepare for “${tap.title}”`);
    onClose();
  };

  const copyDetails = () => {
    const loc = tap.kind === "event" && tap.location ? `\n${tap.location}` : "";
    const isAllDay = tap.kind === "event" && tap.allDay;
    const time = isAllDay ? fmtDay(tap.start) : `${fmtDay(tap.start)} · ${span(tap.start, tap.end)}`;
    void navigator.clipboard.writeText(`${tap.title}\n${time}${loc}`);
    // It closed in silence before — nothing said the copy had happened.
    toast.success("Copied");
    onClose();
  };

  if (tap.kind === "event") {
    const { self_rsvp } = tap;
    // Show RSVP only when the server has told us we're an attendee (non-null, non-undefined).
    const showRsvp = self_rsvp !== null && self_rsvp !== undefined;

    const handleRsvp = (status: AttendeeStatus) => {
      commitScoped(async (scope) => {
        setRsvping(true);
        try {
          await rsvpEvent({ id: tap.id, responseStatus: status, scope });
        } finally {
          setRsvping(false);
          onClose();
        }
      }, undefined, "answer");
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

    const writeSchedule = (
      patch: { all_day?: boolean; start_at: string; end_at: string },
      scope: RecurrenceScope = "THIS",
    ) => {
      updateEvent({
        id: tap.id,
        patch: { all_day: patch.all_day ?? allDay, start_at: patch.start_at, end_at: patch.end_at },
        scope,
      });
    };
    const commitSchedule = (
      patch: { all_day?: boolean; start_at: string; end_at: string },
      revert: { startAt: string; endAt: string; allDay: boolean } = { startAt, endAt, allDay },
    ) => {
      setStartAt(patch.start_at);
      setEndAt(patch.end_at);
      if (patch.all_day !== undefined) setAllDay(patch.all_day);
      commitScoped(
        (scope) => writeSchedule(patch, scope),
        () => {
          setStartAt(revert.startAt);
          setEndAt(revert.endAt);
          setAllDay(revert.allDay);
        },
      );
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

    const applyRepeat = (rule: RecurrenceRule | null) => {
      if (rulesEqual(repeatRule, rule)) return;
      if (!rule && !recurring) return;
      const recurrence = rule ? eventRRule(rule, allDay) : null;
      if (!recurring) {
        setPickedRule(rule);
        updateEvent({ id: tap.id, patch: { recurrence } }, { onError: () => setPickedRule(undefined) });
        return;
      }
      // A series asks: from this occurrence on, or the whole thing?
      commitScoped(
        (scope) => {
          setPickedRule(rule);
          updateEvent({ id: tap.id, patch: { recurrence }, scope }, { onError: () => setPickedRule(undefined) });
        },
        () => {},
        "rule",
      );
    };

    // Each commit says whether it queued a write — `close` needs to know, so a
    // repeating event can finish its this-or-all question before the sheet goes.
    const commitTitle = (): boolean => {
      const next = title.trim();
      // An emptied title isn't a rename: put the old one back, don't blank an event.
      if (!next) {
        setTitle(sent.current.title);
        return false;
      }
      if (next === sent.current.title) return false;
      const prev = sent.current.title;
      commitScoped(
        (scope) => {
          sent.current.title = next;
          updateEvent({ id: tap.id, patch: { title: next }, scope });
        },
        () => setTitle(prev),
      );
      return true;
    };
    const commitLocation = (): boolean => {
      const next = location.trim();
      if (next === sent.current.location) return false;
      const prev = sent.current.location;
      commitScoped(
        (scope) => {
          sent.current.location = next;
          updateEvent({ id: tap.id, patch: { location: next || null }, scope });
        },
        () => setLocation(prev),
      );
      return true;
    };
    const commitNotes = (): boolean => {
      if (notes === sent.current.notes) return false;
      const prev = sent.current.notes;
      commitScoped(
        (scope) => {
          sent.current.notes = notes;
          updateEvent({ id: tap.id, patch: { description: notes }, scope });
        },
        () => setNotes(prev),
      );
      return true;
    };
    flushRef.current = () => {
      if (!editable) return false;
      const queued = [commitTitle(), commitLocation(), commitNotes()].some(Boolean);
      return recurring && queued;
    };
    const handleDelete = () => {
      if (recurring) {
        commitScoped((scope) => {
          deleteEvent({ id: tap.id, scope });
          onClose();
        }, () => {}, "delete");
        return;
      }
      deleteEvent({ id: tap.id, scope: "THIS" });
      onClose();
    };

    // The ONE muted line under the name — what the read needs before any control
    // does: when it is, and whether it repeats (said even on a read-only event;
    // a fact the card knows must never go unsaid because you can't edit it).
    const startD = new Date(startAt);
    const endD = new Date(endAt);
    const shownDay = editable ? startD : tap.start;
    const shownAllDay = editable ? allDay : Boolean(tap.allDay);
    const whenLine = shownAllDay ? dayWord(shownDay) : `${dayWord(shownDay)} · ${span(editable ? startD : tap.start, editable ? endD : tap.end)}`;
    const repeatLine = repeatRule ? describeRule(repeatRule, toDateISO(shownDay)) : recurring ? "Repeats" : null;

    const guests = raw?.attendees ?? [];
    const GUESTS_FOLD = 4;
    const shownGuests = showAllGuests ? guests : guests.slice(0, GUESTS_FOLD);
    const guestCount = (s: AttendeeStatus) => guests.filter((a) => a.responseStatus === s).length;
    const guestSummary = guests.length
      ? [
          `${guests.length}`,
          guestCount("accepted") ? `${guestCount("accepted")} yes` : null,
          guestCount("tentative") ? `${guestCount("tentative")} maybe` : null,
          guestCount("declined") ? `${guestCount("declined")} no` : null,
          guestCount("needsAction") ? `${guestCount("needsAction")} awaiting` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

    const showDomain = attributionEvent && !tap.allDay && cachedEvent?.busy &&
      cachedEvent.self_rsvp !== "declined" &&
      cachedEvent.self_rsvp !== "needsAction";
    const hasRows = editable || showDomain || Boolean(cachedEvent);
    const mapsHref = (loc: string) => `https://maps.apple.com/?q=${encodeURIComponent(loc)}`;

    return (
      <>
      <Sheet onClose={close} title={sheetTitle} onContentScroll={onContentScroll} contentClassName={SHEET_SCROLL}>
        <div className={SHEET_BODY}>
          <SheetMast
            meta={
              <>
                <span>{whenLine}</span>
                {repeatLine && (
                  <>
                    <MetaDot />
                    <span className="inline-flex items-center gap-1">
                      <Icon name="repeat" size={11} />
                      {repeatLine}
                    </span>
                  </>
                )}
              </>
            }
          >
            {editable ? (
              <AutoText
                value={title}
                onChange={setTitle}
                onBlur={commitTitle}
                label="Event title"
                single
                className="bg-transparent text-lead font-semibold leading-snug tracking-tight text-ink"
              />
            ) : (
              <div className="text-lead font-semibold leading-snug tracking-tight text-ink">{tap.title}</div>
            )}
          </SheetMast>

          {/* The one constraint Nuvo can't engineer away, said out loud rather
              than discovered after typing. Only on an event that WOULD be
              editable — a read-only feed has its own reason and shouldn't be
              given two. */}
          {offlineOnly && (
            <p className="mt-3 flex items-start gap-2 text-caption text-muted">
              <Icon name="info" size={14} className="mt-0.5 shrink-0" />
              {CALENDAR_OFFLINE_NOTE}
            </p>
          )}
          {/* …and the read-only feed gets its reason too: an event you can't
              touch should say why, not just look inert. Held back until the
              accounts have loaded so it never flashes on an editable event. */}
          {!writableEvent && accounts.length > 0 && (
            <p className="mt-3 flex items-start gap-2 text-caption text-muted">
              <Icon name="info" size={14} className="mt-0.5 shrink-0" />
              This calendar is read-only, so the event can’t be edited here.
            </p>
          )}

          {/* The strip — the reason you opened it, at most two acts. Join is the
              one thing you open a meeting for on a phone, so it leads; "Going?"
              is the answer to the question the invite asks. */}
          {(meetLink || showRsvp) && (
            <div className="mt-4 space-y-3">
              {meetLink && (
                <a
                  href={meetLink}
                  target="_blank"
                  rel="noreferrer"
                  onClick={onClose}
                  className="tap fast flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-head font-semibold text-on-accent active:translate-y-px"
                >
                  <Icon name="video" size={16} className="shrink-0" />
                  Join {conferenceName(raw, tap.location)}
                </a>
              )}
              {showRsvp && (
                <div className="flex items-center gap-3">
                  <span className="section-label shrink-0 !p-0">Going?</span>
                  <div className="min-w-0 flex-1">
                    <ResponseSegmented
                      options={RSVP_OPTIONS}
                      value={self_rsvp === "needsAction" ? null : self_rsvp}
                      onPick={(v) => void handleRsvp(v)}
                      disabled={rsvping}
                      ariaLabel="Your response"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* WHEN · WHERE — the facts you can change, on one field surface. */}
          {editable ? (
            <div className="mt-5 space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <input
                  type="date"
                  value={toDateInput(startAt)}
                  onChange={(e) => commitDate(e.target.value)}
                  aria-label="Date"
                  className="field mono w-full min-w-0"
                />
                <Chip on={allDay} onClick={() => toggleAllDay(!allDay)}>
                  All day
                </Chip>
              </div>
              {!allDay && (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <input
                    type="time"
                    step={900}
                    value={toTimeInput(startAt)}
                    onChange={(e) => {
                      const next = applyTime(startAt, e.target.value);
                      if (next !== startAt) commitSchedule({ start_at: next, end_at: endAt, all_day: false });
                    }}
                    aria-label="Start time"
                    className="field mono w-full min-w-0"
                  />
                  <Icon name="arrow-right" size={14} className="text-muted" />
                  <input
                    type="time"
                    step={900}
                    value={toTimeInput(endAt)}
                    onChange={(e) => {
                      const next = applyTime(endAt, e.target.value);
                      if (next !== endAt) commitSchedule({ start_at: startAt, end_at: next, all_day: false });
                    }}
                    aria-label="End time"
                    className="field mono w-full min-w-0"
                  />
                </div>
              )}
              <div className="relative">
                <Icon name="pin" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  onBlur={commitLocation}
                  placeholder="Add location"
                  aria-label="Location"
                  enterKeyHint="done"
                  className="field w-full"
                  // Inline, not utilities: `.field`'s own padding is unlayered CSS
                  // and outranks any padding class. Right pad clears the Maps arrow.
                  style={{ paddingLeft: 40, paddingRight: location.trim() ? 44 : undefined }}
                />
                {location.trim() && (
                  // Its own 44px cell, positioned here rather than by `.tap-icon`:
                  // that class sets `position: relative` unlayered, which beats
                  // the `absolute` utility and dropped this link into the flow.
                  <a
                    href={mapsHref(location.trim())}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open in Maps"
                    className="fast absolute right-0 top-0 flex h-full w-11 items-center justify-center rounded-r-[var(--radius)] text-muted active:bg-accent-soft"
                  >
                    <Icon name="arrow-right" size={14} className="-rotate-45" />
                  </a>
                )}
              </div>
            </div>
          ) : (
            tap.location && (
              <div className="mt-5">
                <ActionRowLink href={mapsHref(tap.location)} label={tap.location} />
              </div>
            )
          )}

          {hasRows && (
            <SheetSection>
              <RowList>
                {editable && <RepeatControl anchorISO={toDateISO(startD)} value={repeatRule} onChange={applyRepeat} variant="row" emptyLabel={recurring ? "Repeats" : undefined} />}
                {showDomain && attributionEvent && <EventDomainControl event={attributionEvent} mobile />}
                {/* Remind. Shown whether or not the event is writable — a reminder is
                    Nuvo's own, so a read-only subscription calendar can still carry
                    one. The control is a native <select>, which is iOS's own wheel:
                    no cursor-anchored popover. */}
                {cachedEvent && (
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-5 shrink-0 items-center justify-center text-muted">
                      <Icon name="bell" size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <ReminderSelect block chevron target={{ targetKind: "event", eventKey: eventKey(cachedEvent) }} />
                    </div>
                  </div>
                )}
              </RowList>
            </SheetSection>
          )}

          {guests.length > 0 || raw?.organizer ? (
            <SheetSection label="Guests" aside={guestSummary}>
              <div className="divide-y divide-line border-y border-line">
                {raw?.organizer && (
                  <GuestRow
                    name={raw.organizer.displayName ?? raw.organizer.email}
                    status={null}
                    note="organizer"
                  />
                )}
                {shownGuests
                  .filter((a) => !a.organizer)
                  .map((a) => (
                    <GuestRow
                      key={a.email}
                      name={a.displayName ?? a.email}
                      status={a.responseStatus}
                      note={a.optional ? "optional" : undefined}
                    />
                  ))}
              </div>
              {guests.length > GUESTS_FOLD && !showAllGuests && (
                <button
                  type="button"
                  onClick={() => setShowAllGuests(true)}
                  className="tap fast mt-1 text-caption font-medium text-muted active:text-ink"
                >
                  Show {guests.length - GUESTS_FOLD} more
                </button>
              )}
            </SheetSection>
          ) : null}

          {editable ? (
            <SheetSection label="Notes">
              <AutoText
                value={notes}
                onChange={setNotes}
                onBlur={commitNotes}
                label="Notes"
                placeholder="Add notes"
                minRows={3}
                className="field leading-relaxed"
              />
            </SheetSection>
          ) : (
            raw?.description && (
              <SheetSection label="Notes">
                <DescriptionHtml html={raw.description} className="whitespace-pre-wrap text-body" />
              </SheetSection>
            )
          )}

          <SheetSection>
            <RowList>
              {onAskNuvo && <ActionRow glyph="✦" label="Ask Nuvo to help prepare" onClick={handleAskNuvo} />}
              <ActionRow quiet icon="copy" label="Copy details" onClick={copyDetails} />
            </RowList>
          </SheetSection>

          {/* Destructive, and alone: text at rest, red only once it asks. */}
          {editable && (
            <div className="mt-6">
              <DestructiveRow label="Delete event" confirmLabel="Delete event" confirm={!recurring} onConfirm={handleDelete} />
            </div>
          )}
        </div>
      </Sheet>
      {editScope && (
        <RecurrenceScopeDialog
          mode={editScope.mode}
          onConfirm={confirmScope}
          onCancel={cancelScope}
        />
      )}
      </>
    );
  }

  // Standing slot — a timed container holding zero or more tasks (see
  // assignToSlot, useTasks.ts). The desktop equivalent is CalendarPane's
  // SlotPopover; this is the phone's read + the everyday actions (rename,
  // reschedule the whole block, complete/open a child, delete).
  if (tap.kind === "slot") {
    return (
      <MobileSlotSheet
        tap={tap}
        childTasks={slotChildren ?? []}
        labels={labels}
        mutations={mutations}
        slotMutations={slotMutations}
        onClose={onClose}
        onAskNuvo={onAskNuvo ? handleAskNuvo : undefined}
        onEditTask={onEditTask}
      />
    );
  }

  // A task block opens the Task sheet — see `openTap` in MobileShell (D-162).
  return null;
}

/** A tappable line that leaves the app: the place, in Maps. */
function ActionRowLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="border-y border-line">
      <ActionRow icon="pin" label={<span className="text-accent">{label}</span>} href={href} />
    </div>
  );
}

/** A verdict mark, not a label — `--ok` / `--warn` / `--signal` carry the answer
 *  and the word beside it says it, so colour is never the only channel. */
function GuestRow({ name, status, note }: { name: string; status: AttendeeStatus | null; note?: string }) {
  const tone =
    status === "accepted" ? "var(--ok)" : status === "tentative" ? "var(--warn)" : status === "declined" ? "var(--signal)" : "var(--line-strong)";
  const word = status === "accepted" ? "Yes" : status === "tentative" ? "Maybe" : status === "declined" ? "No" : status === "needsAction" ? "Awaiting" : null;
  return (
    <div className="flex min-h-[44px] items-center gap-3 py-1.5">
      <span className="flex w-5 shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full" style={{ background: tone }} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-body text-ink">
        {name}
        {note && <span className="ml-1.5 text-meta text-muted">{note}</span>}
      </span>
      {word && <span className="shrink-0 text-meta text-muted">{word}</span>}
    </div>
  );
}

function SlotReschedulePicker({
  slot,
  slotMutations,
  onDone,
}: {
  slot: Slot;
  slotMutations: ReturnType<typeof useSlotMutations>;
  onDone: () => void;
}) {
  const [date, setDate] = useState(slot.do_date);
  const [time, setTime] = useState(slot.start_time.slice(11, 16));

  const apply = () => {
    const [h, m] = time.split(":").map(Number);
    const [y, mo, d] = date.split("-").map(Number);
    const start = new Date(y, mo - 1, d, h, m);
    slotMutations.updateSlot({ id: slot.id, patch: { do_date: date, start_time: start.toISOString() } });
    onDone();
  };

  // Set above the pickers for the same reason as the task sheet's: the iOS wheel
  // covers the lower half of a bottom sheet.
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={apply}
        className="tap fast col-span-2 rounded-xl border border-accent bg-accent text-head font-semibold text-on-accent active:translate-y-px"
      >
        Set time
      </button>
      <input
        type="date"
        value={date}
        aria-label="Date"
        onChange={(e) => setDate(e.target.value)}
        className="field mono w-full min-w-0"
      />
      <input
        type="time"
        value={time}
        step={900}
        aria-label="Time"
        onChange={(e) => setTime(e.target.value)}
        className="field mono w-full min-w-0"
      />
    </div>
  );
}

// A standing slot — a timed container holding zero or more tasks (see
// assignToSlot, useTasks.ts: a task placed in a slot loses its own
// start_time and rides the slot's). Desktop's equivalent is CalendarPane's
// SlotPopover; this is the phone's read + everyday actions — rename,
// reschedule the whole block, complete/open a child, delete the container.
function MobileSlotSheet({
  tap,
  childTasks,
  labels,
  mutations,
  slotMutations,
  onClose,
  onAskNuvo,
  onEditTask,
}: {
  tap: Extract<CalendarTap, { kind: "slot" }>;
  childTasks: Task[];
  labels: Label[];
  mutations: Mutations;
  slotMutations: ReturnType<typeof useSlotMutations>;
  onClose: () => void;
  onAskNuvo?: () => void;
  onEditTask?: (taskId: string) => void;
}) {
  const { slot } = tap;
  const store = useOptionalVertical();
  // What the sheet SHOWS as the name: the block's own title, else the name the
  // calendar drew it under (its project's). The field used to hold only the
  // block's own title — empty for most — and painted the calendar's name as a
  // placeholder, so the hero looked like a disabled, ghosted input.
  const shownName = (slot.title ?? "").trim() || tap.title;
  const [titleInput, setTitleInput] = useState(shownName);
  const sentTitle = useRef(shownName);
  const [showReschedule, setShowReschedule] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [now] = useState(() => new Date());

  const project = store ? projectById(store.data, slot.project_id) : null;
  const domain = store && project ? domainById(store.data, project.domainId) : null;

  const children = childTasks
    .filter((t) => t.status !== "trashed")
    // completed tasks sink to the bottom, same as the desktop popover.
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
  const doneCount = children.filter((c) => c.status === "done").length;

  const commitTitle = () => {
    const next = titleInput.trim();
    // Blank isn't a rename; and showing the calendar's name and leaving it alone
    // must not write it back as if the user had typed it (it would pin a
    // project-derived name that should keep following the project).
    if (!next) {
      setTitleInput(sentTitle.current);
      return;
    }
    if (next === sentTitle.current) return;
    sentTitle.current = next;
    slotMutations.updateSlot({ id: slot.id, patch: { title: next } });
  };
  const closeFlushing = () => {
    commitTitle();
    onClose();
  };

  // Keeps the time-of-day, moves the calendar day — do_date AND start_time
  // both carry the slot's day (useSlots.ts ranges on start_time; updateSlot's
  // do_date patch only drags the CHILDREN's day along for the ride).
  const moveTo = (dateISO: string) => {
    const [y, mo, d] = dateISO.split("-").map(Number);
    const next = new Date(slot.start_time);
    next.setFullYear(y, mo - 1, d);
    slotMutations.updateSlot({ id: slot.id, patch: { do_date: dateISO, start_time: next.toISOString() } });
    // `tap` is a snapshot, so the sheet would go on saying the OLD day beside a
    // block that has visibly moved. Like the task sheet's plan chips: act, close.
    onClose();
  };

  const handleDelete = () => {
    // on delete set null (tasks.slot_id) — children survive as plain planned
    // tasks, same as the desktop delete flow.
    slotMutations.removeSlot(slot);
    onClose();
  };

  const { title: sheetTitle, onContentScroll } = useSheetTitle("Block", titleInput);

  return (
    <Sheet onClose={closeFlushing} title={sheetTitle} onContentScroll={onContentScroll} contentClassName={SHEET_SCROLL}>
      <div className={SHEET_BODY}>
        <SheetMast
          color={domain?.color}
          // The project is the block's place — said above the name only when the
          // name is something else (a block called after its project would just
          // print the same words twice, one above the other).
          crumb={
            project && project.name.trim().toLowerCase() !== titleInput.trim().toLowerCase() ? (
              <span className="truncate" style={{ color: domain?.color }}>
                {project.name}
              </span>
            ) : undefined
          }
          meta={
            <span>
              {dayWord(tap.start)} · {span(tap.start, tap.end)}
            </span>
          }
        >
          <AutoText
            value={titleInput}
            onChange={setTitleInput}
            onBlur={commitTitle}
            label="Block title"
            single
            className="bg-transparent text-lead font-semibold leading-snug tracking-tight text-ink"
          />
        </SheetMast>

        <SheetSection label="Tasks" aside={children.length ? `${doneCount}/${children.length} done` : undefined}>
          {children.length === 0 ? (
            <p className="text-body text-muted">Nothing in this block yet.</p>
          ) : (
            // The same TaskRow as every other list (D-111) — this used to draw a
            // reduced one (a ○ glyph and a title), so a slot's work couldn't show
            // its length, its project or its state the way it does anywhere else.
            <div className="-mx-1">
              {children.map((c) => (
                <TaskRow
                  key={c.id}
                  task={c}
                  labels={labels}
                  now={now}
                  selected={false}
                  draggable={false}
                  whenShown
                  onSelect={() => {}}
                  onOpen={() => {
                    onClose();
                    onEditTask?.(c.id);
                  }}
                  onToggleDone={() => (c.status === "done" ? mutations.uncomplete(c) : mutations.complete(c))}
                />
              ))}
            </div>
          )}
        </SheetSection>

        <SheetSection label="Reschedule">
          <ChipGrid cols={3}>
            <Chip onClick={() => moveTo(todayISO())}>Today</Chip>
            <Chip onClick={() => moveTo(tomorrowISO())}>Tomorrow</Chip>
            <Chip onClick={() => moveTo(nextWeekISO())}>Next week</Chip>
            <Chip span={3} onClick={() => setShowReschedule((v) => !v)} on={showReschedule}>
              Pick time…
            </Chip>
          </ChipGrid>
          {showReschedule && <SlotReschedulePicker slot={slot} slotMutations={slotMutations} onDone={onClose} />}
        </SheetSection>

        <SheetSection>
          <RowList>
            {onAskNuvo && <ActionRow glyph="✦" label="Ask Nuvo" onClick={onAskNuvo} />}
            {/* Project time's own way out — the same panel the Schedule's block
                and the Week's Plan row open. Delete only removes the block. */}
            {slot.project_id &&
              (deferring ? (
                <div className="py-2">
                  <SlotDeferPanel slot={slot} onDone={onClose} />
                </div>
              ) : (
                <ActionRow icon="arrow-right" label="Can’t get to this…" onClick={() => setDeferring(true)} />
              ))}
          </RowList>
        </SheetSection>

        <div className="mt-6">
          <DestructiveRow
            label={children.length > 0 ? "Delete block (keeps its tasks)" : "Delete block"}
            confirmLabel="Delete block"
            onConfirm={handleDelete}
          />
        </div>
      </div>
    </Sheet>
  );
}
