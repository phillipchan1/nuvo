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

import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { captureTitle, parseCapture } from "../../lib/nlp";
import { parseDateISO, todayISO, tomorrowISO, nextWeekISO } from "../../lib/dates";
import type { Label } from "../../lib/types";
import type { NewTaskInput } from "../../hooks/useTasks";
import { useRaiseKeyboard } from "../../hooks/useRaiseKeyboard";
import Sheet from "./Sheet";
import EventComposer, { eventSeed, useWritableAccounts } from "./EventComposer";

export type CaptureKind = "task" | "event";

export default function MobileCapture({
  labels,
  onCreate,
  onClose,
  defaultDoDate = null,
  initialKind = "task",
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
   *  the classify-before-you-type problem wearing a guess. The seam exists for a
   *  door that genuinely knows — a tap on empty space in a day canvas, say. */
  initialKind?: CaptureKind;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<CaptureKind>(initialKind);
  const [day, setDay] = useState<string | null>(defaultDoDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // In-app ＋ is a webview gesture so the 120ms retry raises the keyboard;
  // a lock-screen widget is not — useRaiseKeyboard still lands the caret,
  // and the native WKWebView flag (D-115) is what lets the keys come up.
  useRaiseKeyboard(inputRef);

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
      // An explicit date in the text wins; otherwise use the picked day chip.
      const doDate = p.doDate ?? day ?? undefined;
      await onCreate({
        title: captureTitle(p, body),
        notes: p.notes ?? undefined,
        do_date: doDate,
        start_time: p.startTime?.toISOString() ?? null,
        duration_minutes: p.durationMinutes,
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
  const dayChips: { label: string; value: string | null }[] = [
    { label: "Inbox", value: null },
    { label: "Today", value: todayISO() },
    { label: "Tomorrow", value: tomorrowISO() },
    { label: "Next week", value: nextWeekISO() },
  ];
  // Captured from a day you had travelled to — the chips must be able to say
  // that day, or the surface you're standing on silently isn't an option.
  if (defaultDoDate && !dayChips.some((c) => c.value === defaultDoDate)) {
    dayChips.splice(1, 0, {
      label: format(parseDateISO(defaultDoDate), "EEE MMM d"),
      value: defaultDoDate,
    });
  }

  // ── the event branch ──────────────────────────────────────────────────────
  // Seeded from the same parse: `lunch with sam friday 12pm 1h` arrives with
  // its time already filled in, and only what the text did NOT say is left to
  // pick. The seed is memoised on its own values so `EventComposer` can tell a
  // real change from a re-render.
  const seedDayISO = parsed?.doDate ?? day ?? defaultDoDate ?? todayISO();
  const seedStartMs = parsed?.startTime?.getTime() ?? null;
  const seedMins = parsed?.durationMinutes ?? null;
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
                {dayLocked ? "From your text" : "When"}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dayLocked ? (
                  <span className="rounded-full border border-accent bg-accent-soft px-3 py-1.5 text-body font-medium text-accent">
                    {parsed?.doDate}
                  </span>
                ) : (
                  dayChips.map((c) => {
                    const on = day === c.value;
                    return (
                      <button
                        key={c.label}
                        onClick={() => setDay(c.value)}
                        className={`tap fast rounded-full border px-3.5 py-2 text-body font-medium ${
                          on
                            ? "border-accent bg-accent text-on-accent"
                            : "border-line text-muted hover:border-accent hover:text-accent"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })
                )}
              </div>
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
              {saving ? "Saving…" : "Add task"}
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
