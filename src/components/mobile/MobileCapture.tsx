// Capture — ONE door, on every screen, for anything you just thought of.
//
// The phone used to have two ＋s. The one that floats over every screen made a
// task; a second one, parked in the Calendar's header forty pixels away, made a
// calendar event. Same glyph, same colour, different object — so the app asked
// you to classify a thought before you were allowed to type it, which is the
// exact tax capture exists to remove (D6: *I just thought of something — where
// does it go so I stop holding it?*). Worse, the event half was a **form**: a
// title box, three pickers, no parsing. P5 says free text is the front door and
// forms are the fallback, and one whole kind of object could only be made
// through the fallback.
//
// So: one input, parsed once (`parseCapture` — the same grammar the desktop
// command bar speaks), and one switch underneath for the only question the text
// can't answer for you.
//
// **Task or Event is not "where does this go" — it is "who else needs to see
// it".** A scheduled task IS a time block (P1), so `call David tomorrow 9am 30m`
// lands on the calendar either way. Event is the answer when the thing has to
// exist on your *external* calendar: when guests are invited, when a Meet link
// is needed, when the people you share a calendar with must see it. That is why
// Task is the default and why the Event branch is the one carrying guests, a
// repeat rule and a calendar picker (see `EventComposer`).
//
// Everything above the switch is shared, deliberately: the words you type, the
// chips that show what was understood. Switching kind never costs you the
// sentence.
//
// A tap on empty Day-canvas time (D-130) is this same door, already told
// when. `initialStart` is that seed — not a second composer. The Task face
// also carries a clock of its own (D-131): Pick date / Add time / duration,
// so time-blocking does not depend on knowing the parse grammar.

import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { captureTitle, parseCapture } from "../../lib/nlp";
import { fmtDuration, parseDateISO, toDateISO, todayISO, tomorrowISO, nextWeekISO } from "../../lib/dates";
import { DEFAULT_DURATION_MINUTES, type Label } from "../../lib/types";
import type { NewTaskInput } from "../../hooks/useTasks";
import { useRaiseKeyboard } from "../../hooks/useRaiseKeyboard";
import { useSettings } from "../../hooks/useSettings";
import Sheet from "./Sheet";
import EventComposer, { eventSeed, useWritableAccounts } from "./EventComposer";
import { dateAtMinutes } from "./canvasTap";
import { span } from "./dayPlan";

export type CaptureKind = "task" | "event";

/** Lengths for a capture time-block. The full sitting preset list is a
 *  grooming act; capture only needs the lengths a finger commonly means. */
const CAPTURE_DURATIONS = [15, 30, 45, 60, 90, 120] as const;

function hhmmOf(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Next 15-minute tick from now — the usual "block something in" default. */
function nextSlotMinutes(now = new Date()): number {
  const raw = now.getHours() * 60 + now.getMinutes() + 1;
  const snapped = Math.ceil(raw / 15) * 15;
  return Math.min(snapped, 23 * 60 + 45);
}

export default function MobileCapture({
  labels,
  onCreate,
  onClose,
  defaultDoDate = null,
  initialKind = "task",
  initialStart = null,
  initialDurationMinutes = null,
}: {
  labels: Label[];
  onCreate: (input: NewTaskInput) => Promise<unknown>;
  onClose: () => void;
  /** The day the screen you captured from is about — Today on the Today list,
   *  and on the Calendar the day you are actually looking at, not today. */
  defaultDoDate?: string | null;
  /** Which face to open on. Every door today opens on `task`, deliberately: a
   *  scheduled task is already a time block (P1), so Task is the answer far more
   *  often, and picking the kind FOR you by which screen you were on would be
   *  the classify-before-you-type problem wearing a guess. A tap on empty
   *  space knows WHEN, not whether anyone else needs to see it — still Task. */
  initialKind?: CaptureKind;
  /** A tap on the day canvas already chose the clock. The sentence can still
   *  override it; this is the seed when the text is silent. */
  initialStart?: Date | null;
  initialDurationMinutes?: number | null;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<CaptureKind>(initialKind);
  const [day, setDay] = useState<string | null>(
    initialStart ? toDateISO(initialStart) : defaultDoDate,
  );
  const [start, setStart] = useState<Date | null>(initialStart);
  const [mins, setMins] = useState<number | null>(
    initialStart ? (initialDurationMinutes ?? DEFAULT_DURATION_MINUTES) : null,
  );
  const [pickDateOpen, setPickDateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // In-app ＋ is a webview gesture so the 120ms retry raises the keyboard;
  // a lock-screen widget is not — useRaiseKeyboard still lands the caret,
  // and the native WKWebView flag (D-115) is what lets the keys come up.
  useRaiseKeyboard(inputRef);

  const { settings } = useSettings();
  const defaultMins = settings?.default_task_duration_minutes ?? DEFAULT_DURATION_MINUTES;
  const writable = useWritableAccounts();
  const canEvent = writable.length > 0;

  const parsed = useMemo(() => (text.trim() ? parseCapture(text) : null), [text]);

  const chipColor = (kindOfChip: string) =>
    kindOfChip === "label"
      ? "var(--accent)"
      : kindOfChip === "priority"
        ? "var(--signal)"
        : "var(--muted)";

  // ── the task branch ───────────────────────────────────────────────────────
  const submitTask = async () => {
    const body = text.trim();
    if (!body || saving) return;
    setError(null);
    setSaving(true);
    try {
      const p = parseCapture(body);
      const labelIds = p.labels
        .map((n) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id)
        .filter((id): id is string => Boolean(id));
      // An explicit date/time in the text wins; otherwise the day chip and
      // the canvas tap (when there was one).
      const doDate = p.doDate ?? day ?? undefined;
      const startAt = p.startTime ?? start;
      await onCreate({
        title: captureTitle(p, body),
        notes: p.notes ?? undefined,
        do_date: doDate,
        start_time: startAt?.toISOString() ?? null,
        duration_minutes: p.durationMinutes ?? (startAt ? (mins ?? defaultMins) : undefined),
        priority: p.priority,
        labelIds,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save task");
      setSaving(false);
    }
  };

  // A date parsed from the text overrides the chips — reflect that in the UI.
  const dayLocked = Boolean(parsed?.doDate);
  const timeLocked = Boolean(parsed?.startTime);
  const effectiveDay = parsed?.doDate ?? day;
  const dayChips: { label: string; value: string | null }[] = [
    { label: "Inbox", value: null },
    { label: "Today", value: todayISO() },
    { label: "Tomorrow", value: tomorrowISO() },
    { label: "Next week", value: nextWeekISO() },
  ];
  // A day the chips don't already name — the Calendar day you stood on, or
  // one you picked — has to be selectable, or the surface lies.
  for (const iso of [defaultDoDate, day]) {
    if (iso && !dayChips.some((c) => c.value === iso)) {
      dayChips.splice(1, 0, {
        label: format(parseDateISO(iso), "EEE MMM d"),
        value: iso,
      });
    }
  }

  // ── the event branch ──────────────────────────────────────────────────────
  // Seeded from the same parse: `lunch with sam friday 12pm 1h` arrives with
  // its time already filled in, and only what the text did NOT say is left to
  // pick. The seed is memoised on its own values so `EventComposer` can tell a
  // real change from a re-render.
  const seedDayISO = parsed?.doDate ?? day ?? defaultDoDate ?? todayISO();
  const seedStartMs = parsed?.startTime?.getTime() ?? start?.getTime() ?? null;
  const seedMins = parsed?.durationMinutes ?? (start ? (mins ?? defaultMins) : null);

  const claimedStart = parsed?.startTime ?? start;
  const claimedMins = parsed?.durationMinutes ?? mins ?? defaultMins;
  const claimedEnd = claimedStart
    ? new Date(claimedStart.getTime() + claimedMins * 60_000)
    : null;

  const pickDay = (value: string | null) => {
    setDay(value);
    setPickDateOpen(false);
    if (value == null) {
      setStart(null);
      return;
    }
    if (start) {
      const clock = start.getHours() * 60 + start.getMinutes();
      setStart(dateAtMinutes(parseDateISO(value), clock));
    }
  };

  /** Stamp a clock onto the day (Today if still Inbox) — the form half of
   *  time-blocking when the sentence didn't say when (P5 fallback). */
  const addTime = () => {
    const iso = effectiveDay ?? todayISO();
    if (!day && !parsed?.doDate) setDay(iso);
    const minutes = iso === todayISO() ? nextSlotMinutes() : 9 * 60;
    setStart(dateAtMinutes(parseDateISO(iso), minutes));
    setMins((m) => m ?? defaultMins);
  };

  const setStartClock = (hhmm: string) => {
    const iso = effectiveDay ?? todayISO();
    if (!day && !parsed?.doDate) setDay(iso);
    const [h, m] = hhmm.split(":").map(Number);
    setStart(dateAtMinutes(parseDateISO(iso), h * 60 + m));
    setMins((cur) => cur ?? defaultMins);
  };

  const setEndClock = (hhmm: string) => {
    if (!claimedStart) return;
    const [h, m] = hhmm.split(":").map(Number);
    const end = dateAtMinutes(claimedStart, h * 60 + m);
    // Same clock day — if they picked an end before the start, keep a 15m block.
    let delta = Math.round((end.getTime() - claimedStart.getTime()) / 60_000);
    if (delta < 15) delta = 15;
    setMins(delta);
  };
  const seed = useMemo(
    () =>
      eventSeed(
        parseDateISO(seedDayISO),
        seedStartMs == null ? null : new Date(seedStartMs),
        seedMins,
      ),
    [seedDayISO, seedStartMs, seedMins],
  );

  const eventTitle = parsed ? captureTitle(parsed, text.trim()) : "";

  const KIND: { id: CaptureKind; label: string }[] = [
    { id: "task", label: "Task" },
    { id: "event", label: "Event" },
  ];

  return (
    <Sheet onClose={onClose} title="Capture">
      <div className="px-4 pb-4">
        {/* The front door. A plain text <input> so iOS dictation works, and the
            one field either kind is born from. */}
        <div className="fast flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
          <span className="text-head text-accent">＋</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && kind === "task") {
                e.preventDefault();
                void submitTask();
              }
            }}
            enterKeyHint={kind === "task" ? "done" : "next"}
            placeholder="What needs doing?"
            aria-label="Capture a task or event"
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/70"
          />
        </div>

        {parsed && parsed.chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {parsed.chips.map((c, i) => (
              <span
                key={i}
                className="mono rounded-md border px-1.5 py-0.5 text-label"
                style={{ borderColor: chipColor(c.kind), color: chipColor(c.kind) }}
              >
                {c.text}
              </span>
            ))}
          </div>
        )}

        {/* The one question the sentence can't answer. Two faces, equal weight —
            not a "more options" trapdoor, because an event is not an advanced
            task. */}
        <div
          role="group"
          aria-label="What kind of thing is this"
          className="mt-3 flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5"
        >
          {KIND.map((k) => {
            const on = kind === k.id;
            const off = k.id === "event" && !canEvent;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => !off && setKind(k.id)}
                disabled={off}
                aria-pressed={on}
                className={`tap-h fast flex-1 rounded-full py-1.5 text-body font-medium ${
                  on ? "bg-surface text-accent" : off ? "text-muted/40" : "text-muted"
                }`}
                style={on ? { boxShadow: "var(--shadow-1)" } : undefined}
              >
                {k.label}
              </button>
            );
          })}
        </div>

        {kind === "task" ? (
          <>
            <div className="mt-3.5">
              <div className="section-label mb-1.5 !p-0">
                {dayLocked || timeLocked ? "From your text" : "When"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dayLocked ? (
                  <span className="rounded-full border border-accent bg-accent-soft px-3 py-1.5 text-body font-medium text-accent">
                    {parsed?.doDate}
                  </span>
                ) : (
                  <>
                    {dayChips.map((c) => {
                      const on = day === c.value;
                      return (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => pickDay(c.value)}
                          className={`tap fast rounded-full border px-3.5 py-2 text-body font-medium ${
                            on
                              ? "border-accent bg-accent text-on-accent"
                              : "border-line text-muted hover:border-accent hover:text-accent"
                          }`}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setPickDateOpen((v) => !v)}
                      aria-expanded={pickDateOpen}
                      className={`tap fast rounded-full border px-3.5 py-2 text-body font-medium ${
                        pickDateOpen
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-line text-muted hover:border-accent hover:text-accent"
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
                  className="mono tap-h mt-2 w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
                />
              )}

              {/* Time-block controls. Free text can still say "2pm 45m"; this is
                  the form fallback so a tap or the ＋ can land a block without
                  knowing the grammar (P5). Same native date/time inputs the
                  Event face and the task sheet use — one clock vocabulary. */}
              {timeLocked && claimedStart && claimedEnd ? (
                <div className="mt-2">
                  <span
                    className="mono inline-flex rounded-full border border-accent bg-accent-soft px-3 py-1.5 text-body font-medium text-accent"
                    aria-label={`Scheduled ${span(claimedStart, claimedEnd)}`}
                  >
                    {span(claimedStart, claimedEnd)}
                  </span>
                </div>
              ) : claimedStart && claimedEnd ? (
                <div className="mt-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      step={900}
                      value={hhmmOf(claimedStart)}
                      onChange={(e) => setStartClock(e.target.value)}
                      aria-label="Start time"
                      className="mono tap-h min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
                    />
                    <span className="shrink-0 text-muted">–</span>
                    <input
                      type="time"
                      step={900}
                      value={hhmmOf(claimedEnd)}
                      onChange={(e) => setEndClock(e.target.value)}
                      aria-label="End time"
                      className="mono tap-h min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-2 text-body outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => setStart(null)}
                      className="tap fast shrink-0 rounded-full border border-line px-3 py-2 text-body text-muted"
                    >
                      Anytime
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {CAPTURE_DURATIONS.map((m) => {
                      const on = claimedMins === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMins(m)}
                          className={`tap fast rounded-full border px-3 py-1.5 text-body font-medium ${
                            on
                              ? "border-accent bg-accent text-on-accent"
                              : "border-line text-muted"
                          }`}
                        >
                          {fmtDuration(m)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={addTime}
                  className="tap fast mt-2 rounded-full border border-line px-3.5 py-2 text-body font-medium text-muted hover:border-accent hover:text-accent"
                >
                  Add time
                </button>
              )}
            </div>

            {error && (
              <div className="mt-3 rounded-md bg-signal-soft px-3 py-2 text-caption text-signal">
                {error}
              </div>
            )}

            <button
              onClick={() => void submitTask()}
              disabled={!text.trim() || saving}
              className="tap fast mt-4 w-full rounded-xl bg-accent py-3 text-head font-semibold text-on-accent shadow-sm active:translate-y-px disabled:border disabled:border-line disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
            >
              {saving ? "Saving…" : claimedStart ? "Add block" : "Add task"}
            </button>

            <p className="mono mt-2.5 text-center text-label text-muted">
              Try “review PR tomorrow 2pm 45m #work !high”
            </p>
          </>
        ) : (
          <>
            <EventComposer title={eventTitle} seed={seed} onDone={onClose} />
            <p className="mono mt-2.5 text-center text-label text-muted">
              Goes on your calendar — where guests can see it
            </p>
          </>
        )}

        {/* Honest about the one case where the switch has a dead face: an event
            needs somewhere to write to, and saying so beats a control that
            simply doesn't respond (P7). */}
        {!canEvent && kind === "task" && (
          <p className="mt-1.5 text-center text-label text-muted/70">
            Connect a calendar in Settings to capture events too.
          </p>
        )}
      </div>
    </Sheet>
  );
}
