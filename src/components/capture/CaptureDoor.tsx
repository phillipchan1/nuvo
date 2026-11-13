// The capture door — ONE body for "I just thought of something" (D6), wherever
// it is summoned: the phone's ＋ sheet, ⌘K in the app, ⌥Space over any app.
//
// One sentence, parsed once (`parseCapture`, the grammar every add box speaks),
// and one switch under it for the only question the words can't answer: what
// KIND of thing is this. Three answers, each a different object and a
// different reason (D-125, D-149):
//
//   Task   a to-do — dated, timed or not. A scheduled task IS a time block (P1),
//          so `call David tomorrow 9am 30m` lands on the calendar as a Task.
//   Event  it has to exist on your external calendar — guests, Meet, people who
//          share the calendar. The only face with an account behind it.
//   Slot   a block of time that will HOLD several things (glossary: Slot) —
//          always has a clock; `@domain` gives it its affinity.
//
// Switching kind never costs you the sentence, and everything the words said
// (a day, a clock, a length, `@home`, a repeat) seeds the face you switch to.
//
// This used to be three surfaces that disagreed: the phone's sheet (task +
// event), the desktop palette (task only, plus search, commands and a chat that
// a stray space bar switched you into), and the grid's draw-to-create card. The
// palette's search put the cursor on a record whenever your words resembled
// one, so Enter opened a task instead of adding yours; a failed write was
// swallowed after the window had already closed. The door does one thing, and
// it only reports "added" once the write is safely queued (D-149).
//
// The host decides only the frame (a Sheet, a Modal, the ⌥Space panel) and
// what "added" looks like there. It never builds a write.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { Icon } from "../Icon";
import { Button, Chip, Dot, Input } from "../kit";
import { PopSegmented } from "../PopoverParts";
import { format } from "date-fns";
import { captureTitle, parseCapture, resolveRoute } from "../../lib/nlp";
import { fmtDayLabel, fmtDuration, parseDateISO, toDateISO, todayISO, tomorrowISO, nextWeekISO } from "../../lib/dates";
import { DEFAULT_DURATION_MINUTES } from "../../lib/types";
import { DEFAULT_SLOT_MINUTES } from "../../lib/captureDraft";
import { describeRule } from "../../lib/recurrence";
import { useTaskCapture } from "../../hooks/useTaskCapture";
import { useSlotCapture } from "../../hooks/useSlotCapture";
import { useSettings } from "../../hooks/useSettings";
import { useOptionalVertical } from "../../hooks/useVertical";
import TaskComposer, { type TaskComposerHandle } from "../tasks/TaskComposer";
import EventComposer, { eventSeed, useWritableAccounts, type EventComposerHandle } from "../mobile/EventComposer";
import { dateAtMinutes } from "../mobile/canvasTap";
import { span } from "../mobile/dayPlan";

export type CaptureKind = "task" | "event" | "slot";

/** What the door made, said the way the host will say it back. */
export interface CaptureAdded {
  kind: CaptureKind;
  title: string;
  /** Where it went: "Inbox", "Today · 2–3pm", "Fri Sep 26 · 9–11am · repeats". */
  where: string;
}

const KINDS: { id: CaptureKind; label: string }[] = [
  { id: "task", label: "Task" },
  { id: "event", label: "Event" },
  { id: "slot", label: "Slot" },
];

/** Lengths a capture block commonly means. The full sitting preset list is a
 *  grooming act; capture only needs these. */
const CAPTURE_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

function hhmmOf(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Next 15-minute tick from now — the usual "block something in" default. */
function nextTickMinutes(now = new Date()): number {
  const raw = now.getHours() * 60 + now.getMinutes() + 1;
  return Math.min(Math.ceil(raw / 15) * 15, 23 * 60 + 45);
}

/** Where a block with no clock yet should start on `iso`. */
function defaultStartOn(iso: string): Date {
  return dateAtMinutes(parseDateISO(iso), iso === todayISO() ? nextTickMinutes() : 9 * 60);
}

function whereOf(dayISO: string | null, start: Date | null, mins: number | null, repeats = false): string {
  if (!dayISO) return "Inbox";
  const parts = [fmtDayLabel(dayISO)];
  if (start) parts.push(span(start, new Date(start.getTime() + (mins ?? DEFAULT_DURATION_MINUTES) * 60_000)));
  if (repeats) parts.push("repeats");
  return parts.join(" · ");
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const MOD = IS_MAC ? "⌘" : "Ctrl+";

export interface CaptureDoorProps {
  /** `sheet` is the phone's thumb-first layout; `panel` the desktop's
   *  keyboard-first one (⌘K, ⌥Space). Same controls, same order. */
  variant: "sheet" | "panel";
  /** Leave without adding (Escape on an empty line). */
  onClose: () => void;
  /** The write is queued. The host closes, and says so its own way. */
  onAdded: (added: CaptureAdded) => void;
  /** The day the surface it was summoned from is about — the Calendar day you
   *  stood on, not always today. */
  defaultDoDate?: string | null;
  /** Which face to open on. Every door opens on Task unless it knows better:
   *  guessing the kind from the screen is the classify-before-you-type problem
   *  wearing a guess. */
  initialKind?: CaptureKind;
  /** A tap on the day canvas already chose the clock (D-130). */
  initialStart?: Date | null;
  initialDurationMinutes?: number | null;
  /** The host needs the field itself (to raise the iOS keyboard, D-115). */
  fieldRef?: MutableRefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
}

export default function CaptureDoor({
  variant,
  onClose,
  onAdded,
  defaultDoDate = null,
  initialKind = "task",
  initialStart = null,
  initialDurationMinutes = null,
  fieldRef,
  autoFocus,
}: CaptureDoorProps) {
  const panel = variant === "panel";
  const [text, setText] = useState("");
  const [kind, setKindState] = useState<CaptureKind>(initialKind);
  const [day, setDay] = useState<string | null>(initialStart ? toDateISO(initialStart) : defaultDoDate);
  const [start, setStart] = useState<Date | null>(initialStart);
  const [mins, setMins] = useState<number | null>(
    initialStart ? (initialDurationMinutes ?? DEFAULT_DURATION_MINUTES) : null,
  );
  const [slotDomain, setSlotDomain] = useState<string | null>(null);
  const [pickDateOpen, setPickDateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<TaskComposerHandle>(null);
  const eventRef = useRef<EventComposerHandle>(null);
  const localField = useRef<HTMLInputElement | null>(null);
  const field = fieldRef ?? localField;

  const { settings } = useSettings();
  const defaultMins = settings?.default_task_duration_minutes ?? DEFAULT_DURATION_MINUTES;
  const writable = useWritableAccounts();
  const canEvent = writable.length > 0;
  const vertical = useOptionalVertical();
  const domains = vertical?.data.domains ?? [];

  const parsed = useMemo(() => (text.trim() ? parseCapture(text) : null), [text]);

  // ── when ─────────────────────────────────────────────────────────────────
  // The chips, a picked date and a canvas tap are this door's context; the
  // sentence's own day and clock always win over them.
  const dayLocked = Boolean(parsed?.doDate);
  const timeLocked = Boolean(parsed?.startTime);
  const effectiveDay = parsed?.doDate ?? day;
  const slotDay = effectiveDay ?? todayISO();
  const claimedStart = parsed?.startTime ?? start;
  const claimedMins = parsed?.durationMinutes ?? mins ?? defaultMins;
  const claimedEnd = claimedStart ? new Date(claimedStart.getTime() + claimedMins * 60_000) : null;
  // A slot always has a clock — shown (and created) even before one is picked.
  const slotStart = parsed?.startTime ?? (start ? dateAtMinutes(parseDateISO(slotDay), start.getHours() * 60 + start.getMinutes()) : defaultStartOn(slotDay));
  const slotMins = parsed?.durationMinutes ?? mins ?? DEFAULT_SLOT_MINUTES;
  const slotEnd = new Date(slotStart.getTime() + slotMins * 60_000);

  const context = useMemo(
    () => ({ doDate: day, startTime: start, durationMinutes: start ? (mins ?? defaultMins) : null }),
    [day, start, mins, defaultMins],
  );
  const { capture: captureTask, env } = useTaskCapture(context);
  const { capture: captureSlot } = useSlotCapture();

  const setKind = (k: CaptureKind) => {
    if (k === "event" && !canEvent) return;
    setKindState(k);
    setError(null);
    // Keep typing where you were: the switch is a question, not a place.
    if (panel) requestAnimationFrame(() => field.current?.focus());
  };

  const pickDay = (value: string | null) => {
    setDay(value);
    setPickDateOpen(false);
    if (value == null) {
      setStart(null);
      return;
    }
    if (start) setStart(dateAtMinutes(parseDateISO(value), start.getHours() * 60 + start.getMinutes()));
  };

  /** Stamp a clock onto the day (Today if still Inbox) — the form half of
   *  time-blocking, for when the sentence didn't say when (P5 fallback). */
  const addTime = () => {
    const iso = effectiveDay ?? todayISO();
    if (!day && !parsed?.doDate) setDay(iso);
    setStart(defaultStartOn(iso));
    setMins((m) => m ?? defaultMins);
  };

  const setStartClock = (hhmm: string, iso: string, fallbackMins: number) => {
    if (!hhmm) return;
    if (!day && !parsed?.doDate) setDay(iso);
    const [h, m] = hhmm.split(":").map(Number);
    setStart(dateAtMinutes(parseDateISO(iso), h * 60 + m));
    setMins((cur) => cur ?? fallbackMins);
  };

  const setEndClock = (hhmm: string, from: Date) => {
    if (!hhmm) return;
    const [h, m] = hhmm.split(":").map(Number);
    // Same day — an end before the start still keeps a 15m block.
    setMins(Math.max(15, Math.round((dateAtMinutes(from, h * 60 + m).getTime() - from.getTime()) / 60_000)));
  };

  // ── the event face, seeded from the same parse ───────────────────────────
  const seedDayISO = parsed?.doDate ?? day ?? defaultDoDate ?? todayISO();
  const seedStartMs = parsed?.startTime?.getTime() ?? start?.getTime() ?? null;
  const seedMins = parsed?.durationMinutes ?? (start ? (mins ?? defaultMins) : null);
  const seed = useMemo(
    () => eventSeed(parseDateISO(seedDayISO), seedStartMs == null ? null : new Date(seedStartMs), seedMins),
    [seedDayISO, seedStartMs, seedMins],
  );
  const eventTitle = parsed ? captureTitle(parsed, text.trim()) : "";

  // ── the slot's home: typed `@home` wins over the chips ───────────────────
  const routedHome = parsed?.route ? resolveRoute(parsed.route, env.routeTargets) : null;

  // ── add ─────────────────────────────────────────────────────────────────
  const body = () => (composerRef.current?.value() ?? text).trim();
  const canAdd = Boolean(text.trim()) && !saving;

  const submit = async () => {
    if (kind === "event") {
      eventRef.current?.submit();
      return;
    }
    const raw = body();
    if (!raw || saving) return;
    const literal = composerRef.current?.literal();
    setError(null);
    setSaving(true);
    try {
      if (kind === "task") {
        const r = await captureTask(raw, literal);
        if (!r) throw new Error("Nothing to add — type what needs doing.");
        if (r.action.kind === "series") {
          onAdded({ kind, title: r.action.template.title, where: describeRule(r.action.rule, r.action.anchorISO) });
        } else {
          const t = r.action.input;
          const at = t.start_time ? new Date(t.start_time) : null;
          onAdded({ kind, title: t.title, where: whereOf(t.do_date ?? null, at, t.duration_minutes ?? null) });
        }
      } else {
        const when = { doDate: slotDay, start: slotStart, durationMinutes: mins, domainId: slotDomain };
        const a = await captureSlot(raw, when, literal);
        if (!a) throw new Error("A slot needs a time.");
        if (a.kind === "slot-series") {
          onAdded({ kind, title: a.template.title || "Slot", where: describeRule(a.rule, a.anchorISO) });
        } else {
          const s = a.input;
          onAdded({ kind, title: s.title || "Slot", where: whereOf(s.do_date, new Date(s.start_time), s.duration_minutes) });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't add that ${kind}`);
      setSaving(false);
    }
  };

  // Keys the door owns. The field handles its own first (suggestion menu,
  // clear-then-leave on Escape) and marks what it spent, so everything here
  // checks `defaultPrevented` before acting.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && ["1", "2", "3"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      setKind(KINDS[Number(e.key) - 1].id);
      return;
    }
    if (e.key === "Enter") {
      const target = e.target as HTMLElement;
      // The line itself, or ⌘↵ from anywhere in the door. A button's own Enter
      // (Send invites, a chip) and a guest being typed stay theirs.
      if (target === field.current || (mod && target.tagName !== "BUTTON")) {
        e.preventDefault();
        void submit();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  // A fresh door lands in the field (the panel hosts remount per summon).
  useEffect(() => {
    if (autoFocus) field.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dayChips: { label: string; value: string | null }[] = [
    ...(kind === "task" ? [{ label: "Inbox", value: null }] : []),
    { label: "Today", value: todayISO() },
    { label: "Tomorrow", value: tomorrowISO() },
    { label: "Next week", value: nextWeekISO() },
  ];
  // A day the chips don't already name — the Calendar day you stood on, or one
  // you picked — has to be selectable, or the surface lies.
  for (const iso of [defaultDoDate, day]) {
    if (iso && !dayChips.some((c) => c.value === iso)) {
      dayChips.splice(kind === "task" ? 1 : 0, 0, { label: format(parseDateISO(iso), "EEE MMM d"), value: iso });
    }
  }
  const chipOn = (value: string | null) => (kind === "slot" ? slotDay === value : day === value);

  const ctlSize = panel ? ("xs" as const) : ("sm" as const);

  /** A labelled row of the face's controls. */
  const row = (label: string, children: ReactNode) => (
    <div className="cd-row">
      <span className="cd-label">{label}</span>
      <div className="cd-ctl">{children}</div>
    </div>
  );

  /** One choice among the row's choices — a kit button that stays pressed. */
  const choice = (label: ReactNode, on: boolean, onClick: () => void, key?: string) => (
    <Button key={key} size={ctlSize} kind={on ? "secondary" : "ghost"} active={on} aria-pressed={on} onClick={onClick}>
      {label}
    </Button>
  );

  /** Start – end + lengths. Shared by the Task face (optional) and the Slot face (always). */
  const clock = (from: Date, to: Date, len: number, iso: string, fallbackMins: number, anytime: boolean) => (
    <>
      {row(
        "Time",
        <>
          <Input
            type="time"
            size="sm"
            step={900}
            value={hhmmOf(from)}
            onChange={(e) => setStartClock(e.target.value, iso, fallbackMins)}
            aria-label="Start time"
          />
          <span className="cd-dash">–</span>
          <Input
            type="time"
            size="sm"
            step={900}
            value={hhmmOf(to)}
            onChange={(e) => {
              if (!start) setStartClock(hhmmOf(from), iso, fallbackMins);
              setEndClock(e.target.value, from);
            }}
            aria-label="End time"
          />
          {anytime && (
            <Button size={ctlSize} kind="ghost" onClick={() => setStart(null)}>
              Anytime
            </Button>
          )}
        </>,
      )}
      {row(
        "Length",
        <div role="group" aria-label="Length" className="contents">
          {CAPTURE_DURATIONS.map((m) => choice(fmtDuration(m), len === m, () => setMins(m), String(m)))}
        </div>,
      )}
    </>
  );

  const whenRow = row(
    "When",
    dayLocked ? (
      <Chip tone="accent">{parsed?.doDate ? fmtDayLabel(parsed.doDate) : null}</Chip>
    ) : (
      <>
        {dayChips.map((c) => choice(c.label, chipOn(c.value), () => pickDay(c.value), c.label))}
        <Button
          size={ctlSize}
          kind="ghost"
          active={pickDateOpen}
          aria-expanded={pickDateOpen}
          icon={<Icon name="calendar" size={13} />}
          onClick={() => setPickDateOpen((v) => !v)}
        >
          Pick date…
        </Button>
        {pickDateOpen && (
          <Input
            type="date"
            size="sm"
            value={day ?? todayISO()}
            aria-label="Date"
            onChange={(e) => {
              if (e.target.value) pickDay(e.target.value);
            }}
            frameClassName="w-full"
          />
        )}
      </>
    ),
  );

  const addLabel = kind === "slot" ? "Add slot" : claimedStart ? "Add block" : "Add task";
  const kindSwitch = (
    // The one question the sentence can't answer. Three faces, equal weight —
    // not a "more options" trapdoor.
    <PopSegmented
      ariaLabel="What kind of thing is this"
      value={kind}
      onPick={setKind}
      segments={KINDS.map((k, i) => {
        const off = k.id === "event" && !canEvent;
        return {
          value: k.id,
          label: k.label,
          disabled: off,
          title: off ? "Connect a calendar in Settings to add events" : panel ? `${k.label} (${MOD}${i + 1})` : undefined,
        };
      })}
    />
  );

  return (
    <div
      className={`capture-door ${panel ? "capture-door-panel" : "capture-door-sheet"}`}
      data-kind={kind}
      data-noevent={canEvent ? undefined : ""}
      onKeyDown={onKeyDown}
    >
      {/* The front door: the app's one add box — a plain <input> so iOS
          dictation works, highlighting what it understood, its parsed tokens
          as chips under it. Enter belongs to the door (it adds whichever kind
          is showing). */}
      <TaskComposer
        ref={composerRef}
        fieldRef={field}
        variant="field"
        context={context}
        placeholder={kind === "event" ? "What’s happening?" : kind === "slot" ? "What is this time for?" : "What needs doing?"}
        aria-label="Capture a task, event or slot"
        enterKeyHint={kind === "event" ? "next" : "done"}
        enterDisabled
        onTextChange={(v) => {
          setText(v);
          if (error) setError(null);
        }}
        onCreated={(r) => {
          // A multi-line paste adds its lines itself — say so, then leave.
          if (r.action.kind === "task") onAdded({ kind: "task", title: r.action.input.title, where: whereOf(r.action.input.do_date ?? null, null, null) });
        }}
        onLeave={onClose}
        onError={setError}
      />

      {/* On the phone the switch sits under the line, where the thumb is. */}
      {!panel && kindSwitch}

      {kind !== "event" && (
        <div className="cd-body">
          {whenRow}
          {kind === "task" &&
            (timeLocked && claimedStart && claimedEnd ? (
              row(
                "Time",
                <Chip tone="accent" title={`Scheduled ${span(claimedStart, claimedEnd)}`}>
                  <span aria-label={`Scheduled ${span(claimedStart, claimedEnd)}`}>{span(claimedStart, claimedEnd)}</span>
                </Chip>,
              )
            ) : claimedStart && claimedEnd ? (
              clock(claimedStart, claimedEnd, claimedMins, effectiveDay ?? todayISO(), defaultMins, true)
            ) : (
              row(
                "Time",
                <Button size={ctlSize} kind="ghost" icon={<Icon name="clock" size={13} />} onClick={addTime}>
                  Add time
                </Button>,
              )
            ))}
          {kind === "slot" && (
            <>
              {timeLocked
                ? row(
                    "Time",
                    <Chip tone="accent">
                      <span aria-label={`Holds ${span(slotStart, slotEnd)}`}>{span(slotStart, slotEnd)}</span>
                    </Chip>,
                  )
                : clock(slotStart, slotEnd, slotMins, slotDay, DEFAULT_SLOT_MINUTES, false)}
              {domains.length > 0 &&
                row(
                  "For",
                  routedHome ? (
                    <Chip tone="accent">{routedHome.name}</Chip>
                  ) : (
                    <>
                      {[{ id: null as string | null, name: "Anything", color: null as string | null }, ...domains].map((d) =>
                        choice(
                          <>
                            {d.color && <Dot color={d.color} />}
                            {d.name}
                          </>,
                          slotDomain === d.id,
                          () => setSlotDomain(d.id),
                          d.id ?? "none",
                        ),
                      )}
                    </>
                  ),
                )}
            </>
          )}
        </div>
      )}

      {kind === "event" && (
        <div className="cd-event">
          <EventComposer
            ref={eventRef}
            title={eventTitle}
            seed={seed}
            seedRepeat={parsed?.recurrence ?? null}
            onDone={(ev) => {
              const s = new Date(ev.start_at);
              onAdded({
                kind: "event",
                title: eventTitle,
                where: ev.allDay
                  ? `${fmtDayLabel(toDateISO(s))} · all day`
                  : whereOf(toDateISO(s), s, Math.round((new Date(ev.end_at).getTime() - s.getTime()) / 60_000), ev.repeats),
              });
            }}
          />
        </div>
      )}

      {error && (
        <div role="alert" className="cd-alert">
          {error}
        </div>
      )}

      <div className="cd-foot">
        {panel && kindSwitch}
        {panel && <span className="k-grow" />}
        {kind !== "event" && (
          <Button
            kind="primary"
            size={panel ? "sm" : "md"}
            onClick={() => void submit()}
            disabled={!canAdd}
            shortcut={panel ? "↵" : undefined}
          >
            {saving ? "Adding…" : addLabel}
          </Button>
        )}
      </div>

      {/* Honest about the one face that can be dead: an event needs somewhere
          to write to, and saying so beats a control that doesn't respond (P7).
          The desktop says it in the switch's tooltip. */}
      {!panel && !canEvent && kind !== "event" && <p className="cd-note">Connect a calendar in Settings to capture events too.</p>}
    </div>
  );
}
