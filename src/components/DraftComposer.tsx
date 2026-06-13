import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { fmtDuration, toDateISO } from "../lib/dates";
import type { RecurrenceRule } from "../lib/recurrence";
import { RepeatControl } from "./RecurrencePicker";

export type CreateKind = "task" | "event" | "slot";

const KINDS: { value: CreateKind; label: string; hint: string }[] = [
  { value: "task", label: "Task", hint: "a time-blocked to-do" },
  { value: "event", label: "Event", hint: "a Google calendar event" },
  { value: "slot", label: "Slot", hint: "a container for many tasks" },
];

const COMPOSER_W = 280;

/** The quick-create card that appears after a click-drag on the grid. Lets you
 *  name the draft and switch its type (Task / Event / Slot) before committing. */
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
  onCreate: (kind: CreateKind, title: string, recurrence: RecurrenceRule | null) => void;
  onCancel: () => void;
}) {
  const kinds = KINDS.filter((k) => k.value !== "event" || googleAvailable);
  const [kind, setKind] = useState<CreateKind>(
    initialKind === "event" && !googleAvailable ? "task" : initialKind,
  );
  const [title, setTitle] = useState("");
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: point.y,
    left: point.x + 12,
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = card.offsetHeight;
    let left = point.x + 12;
    if (left + COMPOSER_W > vw - 8) left = point.x - 12 - COMPOSER_W;
    left = Math.max(8, left);
    const top = Math.max(8, Math.min(point.y - 20, vh - h - 8));
    setPos({ top, left });
  }, [point]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const durationMins = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));

  // Slots derive their title from contents, so an empty name is fine there.
  const canCreate = kind === "slot" || Boolean(title.trim());

  const submit = () => {
    if (!canCreate) return;
    onCreate(kind, title.trim(), repeat);
  };

  const placeholder =
    kind === "event" ? "Event title…" : kind === "slot" ? "Slot name (optional)…" : "Task title…";

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onCancel} />
      <div
        ref={cardRef}
        className="moment fixed z-50 flex flex-col gap-2.5 rounded-[var(--radius-lg)] border border-line bg-surface p-3"
        style={{ top: pos.top, left: pos.left, width: COMPOSER_W, boxShadow: "var(--shadow-3)" }}
      >
        {/* Type switcher */}
        <div className="flex gap-1 rounded-[var(--radius)] bg-bg p-0.5">
          {kinds.map((k) => (
            <button
              key={k.value}
              title={k.hint}
              onClick={() => setKind(k.value)}
              className={`fast flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium transition-colors ${
                kind === k.value
                  ? "bg-accent text-white"
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
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={placeholder}
          className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
        />

        {/* Time read-out */}
        <div className="mono flex items-center gap-1.5 text-[10.5px] text-muted">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="shrink-0 text-muted/70">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 3v3l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {format(start, "EEE h:mm a")} – {format(end, "h:mm a")}
          <span className="text-muted/60">· {fmtDuration(durationMins)}</span>
        </div>

        {/* Repeat */}
        <div className="flex">
          <RepeatControl anchorISO={toDateISO(start)} value={repeat} onChange={setRepeat} />
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="fast rounded-[var(--radius-sm)] px-2.5 py-1 text-[12px] text-muted hover:bg-bg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canCreate}
            className="fast rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
