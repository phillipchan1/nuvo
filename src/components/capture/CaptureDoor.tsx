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

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
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

  const pill = (on: boolean) =>
    `tap fast rounded-full border px-3 py-1.5 text-body font-medium ${
      on ? "border-accent bg-accent text-on-accent" : "border-line text-muted hover:border-accent hover:text-accent"
    }`;
  const lockedPill =
    "mono inline-flex rounded-full border border-accent bg-accent-soft px-3 py-1.5 text-body font-medium text-accent";
  const clockInput =
    "mono tap-h min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-2 text-body text-ink outline-none focus:border-accent";

  /** Start – end + lengths. Shared by the Task face (optional) and the Slot face (always). */
  const clock = (from: Date, to: Date, len: number, iso: string, fallbackMins: number, anytime: boolean) => (
    <div className="mt-2">
      <div className="flex items-center gap-1.5">
        <input
          type="time"
          step={900}
          value={hhmmOf(from)}
          onChange={(e) => setStartClock(e.target.value, iso, fallbackMins)}
          aria-label="Start time"
          className={clockInput}
        />
        <span className="shrink-0 text-muted">–</span>
        <input
          type="time"
          step={900}
          value={hhmmOf(to)}
          onChange={(e) => {
            if (!start) setStartClock(hhmmOf(from), iso, fallbackMins);
            setEndClock(e.target.value, from);
          }}
          aria-label="End time"
          className={clockInput}
        />
        {anytime && (
          <button
            type="button"
            onClick={() => setStart(null)}
            className="tap fast shrink-0 rounded-full border border-line px-3 py-2 text-body text-muted hover:border-accent hover:text-accent"
          >
            Anytime
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Length">
        {CAPTURE_DURATIONS.map((m) => (
          <button key={m} type="button" onClick={() => setMins(m)} aria-pressed={len === m} className={pill(len === m)}>
            {fmtDuration(m)}
          </button>
        ))}
      </div>
    </div>
  );

  const whenRow = (
    <div className="mt-3.5">
      <div className="section-label mb-1.5 !p-0">{dayLocked || timeLocked ? "From your text" : "When"}</div>
      <div className="flex flex-wrap gap-1.5">
        {dayLocked ? (
          <span className={lockedPill}>{parsed?.doDate ? fmtDayLabel(parsed.doDate) : null}</span>
        ) : (
          <>
            {dayChips.map((c) => (
              <button key={c.label} type="button" onClick={() => pickDay(c.value)} aria-pressed={chipOn(c.value)} className={pill(chipOn(c.value))}>
                {c.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPickDateOpen((v) => !v)}
              aria-expanded={pickDateOpen}
              className={`tap fast rounded-full border px-3 py-1.5 text-body font-medium ${
                pickDateOpen ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent hover:text-accent"
              }`}
            >
              Pick date…
            </button>
          </>
        )}
      </div>
      {pickDateOpen && !dayLocked && (
        <input
          type="date"
          value={day ?? todayISO()}
          aria-label="Date"
          onChange={(e) => {
            if (e.target.value) pickDay(e.target.value);
          }}
          className={`${clockInput} mt-2 w-full`}
        />
      )}
    </div>
  );

  const addButton = (label: string) => (
    <button
      type="button"
      onClick={() => void submit()}
      disabled={!canAdd}
      className="tap fast mt-4 w-full rounded-xl bg-accent py-3 text-head font-semibold text-on-accent shadow-sm active:translate-y-px disabled:border disabled:border-line disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
    >
      {saving ? "Adding…" : label}
    </button>
  );

  return (
    <div className={`capture-door ${panel ? "capture-door-panel" : ""}`} data-kind={kind} onKeyDown={onKeyDown}>
      {/* The front door: the app's one add box — a plain <input> so iOS
          dictation works, highlighting what it understood. Enter belongs to
          the door (it adds whichever kind is showing). */}
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

      {/* The one question the sentence can't answer. Three faces, equal weight —
          not a "more options" trapdoor. */}
      <div role="group" aria-label="What kind of thing is this" className="mt-3 flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
        {KINDS.map((k, i) => {
          const on = kind === k.id;
          const off = k.id === "event" && !canEvent;
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => setKind(k.id)}
              disabled={off}
              aria-pressed={on}
              title={off ? "Connect a calendar in Settings to add events" : panel ? `${k.label} (${MOD}${i + 1})` : undefined}
              className={`tap-h fast flex-1 rounded-full py-1.5 text-body font-medium ${
                on ? "bg-surface text-accent" : off ? "text-muted/40" : "text-muted hover:text-ink"
              }`}
              style={on ? { boxShadow: "var(--shadow-1)" } : undefined}
            >
              {k.label}
            </button>
          );
        })}
      </div>

      {kind === "task" && (
        <>
          {whenRow}
          {timeLocked && claimedStart && claimedEnd ? (
            <div className="mt-2">
              <span className={lockedPill} aria-label={`Scheduled ${span(claimedStart, claimedEnd)}`}>
                {span(claimedStart, claimedEnd)}
              </span>
            </div>
          ) : claimedStart && claimedEnd ? (
            clock(claimedStart, claimedEnd, claimedMins, effectiveDay ?? todayISO(), defaultMins, true)
          ) : (
            <button
              type="button"
              onClick={addTime}
              className="tap fast mt-2 rounded-full border border-line px-3 py-1.5 text-body font-medium text-muted hover:border-accent hover:text-accent"
            >
              Add time
            </button>
          )}
        </>
      )}

      {kind === "slot" && (
        <>
          {whenRow}
          {timeLocked ? (
            <div className="mt-2">
              <span className={lockedPill} aria-label={`Holds ${span(slotStart, slotEnd)}`}>
                {span(slotStart, slotEnd)}
              </span>
            </div>
          ) : (
            clock(slotStart, slotEnd, slotMins, slotDay, DEFAULT_SLOT_MINUTES, false)
          )}
          {domains.length > 0 && (
            <div className="mt-3.5">
              <div className="section-label mb-1.5 !p-0">{routedHome ? "From your text" : "For"}</div>
              {routedHome ? (
                <span className={lockedPill}>{routedHome.name}</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {[{ id: null as string | null, name: "Anything", color: null as string | null }, ...domains].map((d) => {
                    const on = slotDomain === d.id;
                    return (
                      <button
                        key={d.id ?? "none"}
                        type="button"
                        onClick={() => setSlotDomain(d.id)}
                        aria-pressed={on}
                        className={`tap fast inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body font-medium ${
                          on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent hover:text-accent"
                        }`}
                      >
                        {d.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />}
                        {d.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {parsed?.recurrence && (
            <p className="mt-2 text-caption text-muted">
              Repeats {describeRule(parsed.recurrence, parsed.recurrenceAnchor ?? slotDay).toLowerCase()} — a standing slot.
            </p>
          )}
        </>
      )}

      {kind === "event" && (
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
      )}

      {error && (
        <div role="alert" className="mt-3 rounded-md bg-signal-soft px-3 py-2 text-caption text-signal">
          {error}
        </div>
      )}

      {kind === "task" && addButton(claimedStart ? "Add block" : "Add task")}
      {kind === "slot" && addButton("Add slot")}

      {panel ? (
        <p className="mono mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-meta text-muted">
          <span>↵ add</span>
          <span>{MOD}1 · 2 · 3 kind</span>
          <span>esc close</span>
        </p>
      ) : kind === "event" ? (
        <p className="mono mt-2.5 text-center text-label text-muted">Goes on your calendar — where guests can see it</p>
      ) : kind === "slot" ? (
        <p className="mono mt-2.5 text-center text-label text-muted">Try “deep work tomorrow 9am 2h @work”</p>
      ) : (
        <p className="mono mt-2.5 text-center text-label text-muted">Try “review PR tomorrow 2pm 45m #work !high”</p>
      )}

      {/* Honest about the one face that can be dead: an event needs somewhere
          to write to, and saying so beats a control that doesn't respond (P7). */}
      {!canEvent && kind !== "event" && (
        <p className="mt-1.5 text-center text-label text-muted/70">Connect a calendar in Settings to capture events too.</p>
      )}
    </div>
  );
}
