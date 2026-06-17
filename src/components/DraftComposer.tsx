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

const COMPOSER_W = 360;

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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

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
        {/* ── Kind switcher ── */}
        <div className="p-3 pb-2">
          <div className="flex gap-1 rounded-[var(--radius)] bg-bg p-0.5">
            {kinds.map((k) => (
              <button
                key={k.value}
                title={k.hint}
                onClick={() => setKind(k.value)}
                className={`fast flex-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-body font-medium transition-colors ${
                  kind === k.value ? "bg-accent text-white" : "text-muted hover:text-ink"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Title ── */}
        <div className="px-4 pb-3">
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={placeholder}
            className="w-full bg-transparent text-[15px] font-medium text-ink outline-none placeholder:text-muted/40"
          />
        </div>

        {/* ── Time + Repeat ── */}
        <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3">
          {/* Time */}
          <div className="mono flex items-center gap-2 text-meta text-muted">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted/60">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M6 3v3l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span>
              {format(start, "EEE, MMM d")}
              <span className="mx-1 text-muted/40">·</span>
              {format(start, "h:mm")}–{format(end, "h:mm a")}
              <span className="ml-2 text-muted/50">{fmtDuration(durationMins)}</span>
            </span>
          </div>

          {/* Repeat */}
          <div className="flex flex-col gap-1">
            <RepeatControl anchorISO={anchorISO} value={repeat} onChange={setRepeat} />
            {startsLater && (
              <span className="mono pl-0.5 text-meta text-muted">
                First on {format(parseDateISO(firstOccurrence!), "EEE MMM d")} — not this day
              </span>
            )}
          </div>
        </div>

        {/* ── Guests — only for Google calendar events ── */}
        {kind === "event" && (
          <div className="border-t border-line px-4 py-3">
            <div className="mb-2.5 flex items-center gap-1.5 text-meta font-semibold uppercase tracking-wider text-muted">
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
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            onClick={onCancel}
            className="fast rounded-[var(--radius-sm)] px-3 py-1.5 text-body text-muted hover:bg-bg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canCreate}
            className="fast rounded-[var(--radius-sm)] bg-accent px-4 py-1.5 text-body font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
