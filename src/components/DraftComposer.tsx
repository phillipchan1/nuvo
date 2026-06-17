import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, format } from "date-fns";
import { fmtDuration, parseDateISO, toDateISO } from "../lib/dates";
import { expandRule, type RecurrenceRule } from "../lib/recurrence";
import { RepeatControl } from "./RecurrencePicker";
import { GuestsInput } from "./GuestsInput";

export type CreateKind = "task" | "event" | "slot";

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
  googleAvailable,
  onCreate,
  onCancel,
}: {
  start: Date;
  end: Date;
  point: { x: number; y: number };
  initialKind: CreateKind;
  googleAvailable: boolean;
  onCreate: (kind: CreateKind, title: string, recurrence: RecurrenceRule | null, attendees: string[]) => void;
  onCancel: () => void;
}) {
  const kinds = KINDS.filter((k) => k.value !== "event" || googleAvailable);
  const [kind, setKind] = useState<CreateKind>(
    initialKind === "event" && !googleAvailable ? "task" : initialKind,
  );
  const [title, setTitle] = useState("");
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(null);
  const [attendees, setAttendees] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: point.y,
    left: point.x + 12,
  });

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Re-clamp to the viewport whenever the card *or* the window changes size, not
  // just on mount: switching to Event adds the Guests section (and the picker can
  // expand), which would otherwise grow the fixed card past the bottom edge with
  // no way to scroll to it. A ResizeObserver pulls it back up so it always fits.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const place = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const h = card.offsetHeight;
      let left = point.x + 12;
      if (left + COMPOSER_W > vw - 8) left = point.x - 12 - COMPOSER_W;
      left = Math.max(8, left);
      const top = Math.max(8, Math.min(point.y - 20, vh - h - 8));
      setPos({ top, left });
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
        onCreate(kind, title.trim(), repeat, attendees);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onCreate, kind, title, repeat, attendees]);

  const durationMins = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));

  const anchorISO = toDateISO(start);
  const firstOccurrence =
    repeat && kind !== "event"
      ? expandRule(repeat, anchorISO, anchorISO, toDateISO(addDays(parseDateISO(anchorISO), 366)))[0]
      : null;
  const startsLater = firstOccurrence && firstOccurrence !== anchorISO;

  const canCreate = kind === "slot" || Boolean(title.trim());

  const submit = () => {
    if (!canCreate) return;
    onCreate(kind, title.trim(), repeat, attendees);
  };

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
        {/* ── Kind switcher — a roomy segmented control ── */}
        <div className="p-3.5 pb-0">
          <div className="flex gap-1 rounded-[var(--radius)] bg-bg p-1">
            {kinds.map((k) => (
              <button
                key={k.value}
                title={k.hint}
                onClick={() => setKind(k.value)}
                className={`tap fast flex flex-1 items-center justify-center rounded-[var(--radius-sm)] px-3 text-body font-semibold transition-colors ${
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

        {/* ── Title — the hero: a big, obvious field, not a hairline ── */}
        <div className="px-3.5 pt-3.5">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={placeholder}
            className="tap w-full rounded-[var(--radius)] border border-line bg-surface-2 px-4 text-head font-medium text-ink outline-none transition-colors placeholder:font-normal placeholder:text-muted/50 focus:border-accent focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </div>

        {/* ── When ── */}
        <div className="flex items-center gap-2.5 px-4 pt-3.5 text-caption">
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted/70">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 3v3l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="font-medium text-ink">{format(start, "EEE, MMM d")}</span>
          <span className="text-muted/40">·</span>
          <span className="text-muted">{format(start, "h:mm")}–{format(end, "h:mm a")}</span>
          <span className="ml-auto rounded-full bg-bg px-2 py-0.5 text-meta font-medium text-muted">
            {fmtDuration(durationMins)}
          </span>
        </div>

        {/* ── Repeat — a full-width row you can't miss ── */}
        <div className="flex flex-col gap-1.5 px-3.5 pt-3">
          <RepeatControl anchorISO={anchorISO} value={repeat} onChange={setRepeat} variant="block" />
          {startsLater && (
            <span className="pl-1 text-meta text-muted">
              First on {format(parseDateISO(firstOccurrence!), "EEE MMM d")} — not this day
            </span>
          )}
        </div>

        {/* ── Guests — only for Google calendar events ── */}
        {kind === "event" && (
          <div className="px-3.5 pt-4">
            <div className="mb-2 flex items-center gap-1.5 text-label font-semibold uppercase tracking-wider text-muted">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <circle cx="5" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M1 10.5c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M9 5.5v3M7.5 7H10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Guests
            </div>
            <GuestsInput value={attendees} onChange={setAttendees} />
          </div>
        )}

        {/* ── Actions ── */}
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-line p-3.5">
          <button
            onClick={onCancel}
            className="tap fast inline-flex items-center justify-center rounded-[var(--radius)] px-4 text-body font-medium text-muted hover:bg-bg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canCreate}
            className="tap fast inline-flex items-center justify-center gap-1.5 rounded-[var(--radius)] bg-accent px-6 text-body font-semibold text-white shadow-[var(--shadow-1)] transition-opacity hover:opacity-90 disabled:opacity-40 disabled:shadow-none"
          >
            Create
            <span className="text-meta font-normal text-white/65">⌘↵</span>
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
