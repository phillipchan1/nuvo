import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { createPortal } from "react-dom";
import {
  describeRule,
  presetsFor,
  type RecurrenceFreq,
  type RecurrenceRule,
  rulesEqual,
  WEEKDAY_LABELS,
} from "../lib/recurrence";
import { parseDateISO } from "../lib/dates";
import { Btn } from "./ui";

/**
 * A delete control that fans out into series scopes when the item repeats.
 * Non-recurring → a plain signal button (onSimple). Recurring → a menu:
 * this occurrence · this & following · whole series.
 */
export function RecurrenceDeleteButton({
  recurring,
  label = "Trash",
  onSimple,
  onThis,
  onFollowing,
  onSeries,
}: {
  recurring: boolean;
  label?: string;
  onSimple: () => void;
  onThis: () => void;
  onFollowing: () => void;
  onSeries: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!recurring) return <Btn kind="signal" onClick={onSimple}>{label}</Btn>;
  const items: { label: string; fn: () => void }[] = [
    { label: "This occurrence", fn: onThis },
    { label: "This & following", fn: onFollowing },
    { label: "Whole series", fn: onSeries },
  ];
  return (
    <div className="relative">
      <Btn kind="signal" onClick={() => setOpen((o) => !o)}>{label} ▾</Btn>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-[61] mb-1 w-44 overflow-hidden rounded-md border border-line bg-surface elev-3">
            <div className="mono px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-widest text-muted">
              Delete
            </div>
            {items.map((o) => (
              <button
                key={o.label}
                onClick={() => { o.fn(); setOpen(false); }}
                className="fast block w-full px-3 py-2 text-left text-caption text-text hover:bg-bg"
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export type SlotDeleteScope = "simple" | "this" | "following" | "series";

/**
 * Deleting a slot is never just deleting the slot when it holds tasks: the user
 * has to decide their fate. This control gates the delete behind that choice —
 * keep the tasks (they fall back onto the day, un-slotted) or trash them too —
 * and folds in the recurrence scopes when the slot repeats.
 */
export function SlotDeleteButton({
  recurring,
  taskCount,
  dayLabel,
  onDelete,
}: {
  recurring: boolean;
  taskCount: number;
  dayLabel: string;
  onDelete: (scope: SlotDeleteScope, deleteTasks: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleteTasks, setDeleteTasks] = useState(false);

  // Nothing to decide — a plain, empty, non-recurring slot deletes outright.
  if (!recurring && taskCount === 0) {
    return <Btn kind="signal" onClick={() => onDelete("simple", false)}>Delete slot</Btn>;
  }

  const scopes: { scope: SlotDeleteScope; label: string }[] = recurring
    ? [
        { scope: "this", label: "This occurrence" },
        { scope: "following", label: "This & following" },
        { scope: "series", label: "Whole series" },
      ]
    : [{ scope: "simple", label: "Delete slot" }];

  return (
    <div className="relative">
      <Btn kind="signal" onClick={() => setOpen((o) => !o)}>Delete slot ▾</Btn>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-[61] mb-1 w-60 overflow-hidden rounded-md border border-line bg-surface elev-3">
            {taskCount > 0 && (
              <div className="border-b border-line px-3 py-2.5">
                <label className="flex cursor-pointer items-start gap-2 text-caption text-text">
                  <input
                    type="checkbox"
                    checked={deleteTasks}
                    onChange={(e) => setDeleteTasks(e.target.checked)}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    Also delete {taskCount} task{taskCount === 1 ? "" : "s"} inside
                    <span className="mt-0.5 block text-label text-muted">
                      {deleteTasks
                        ? "The tasks are trashed with the slot."
                        : `Kept on ${dayLabel}, just un-slotted.`}
                    </span>
                  </span>
                </label>
              </div>
            )}
            <div className="mono px-3 pt-2 pb-1 text-micro font-semibold uppercase tracking-widest text-muted">
              Delete
            </div>
            {scopes.map((s) => (
              <button
                key={s.scope}
                onClick={() => { onDelete(s.scope, taskCount > 0 && deleteTasks); setOpen(false); }}
                className="fast block w-full px-3 py-2 text-left text-caption text-text hover:bg-bg"
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A small repeat icon shared by the chip and the picker header. */
function RepeatGlyph({ className = "" }: { className?: string }) {
  return (
    <Icon name="repeat" size={11} className={className} />
  );
}

/**
 * The control the user clicks to set/edit a repeat — owns the picker's open
 * state. Shows the humanized rule when one is set, "Repeat" otherwise.
 * Default `chip` variant drops among the schedule chips in a detail popover;
 * `block` is a full-width, tall row for composers where it's a primary action.
 */
export function RepeatControl({
  anchorISO,
  value,
  onChange,
  disabled,
  variant = "chip",
}: {
  anchorISO: string;
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  disabled?: boolean;
  variant?: "chip" | "block";
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const on = Boolean(value);
  const open = (e: React.MouseEvent<HTMLButtonElement>) =>
    setAnchor(e.currentTarget.getBoundingClientRect());
  const label = value ? describeRule(value, anchorISO) : "Repeat";
  return (
    <>
      {variant === "block" ? (
        <button
          disabled={disabled}
          onClick={open}
          title={value ? describeRule(value, anchorISO) : "Set a repeat"}
          className={`fast flex w-full items-center gap-3 rounded-[var(--radius)] border px-3.5 py-3 text-body disabled:opacity-40 ${
            on
              ? "border-accent/35 bg-accent-soft text-accent"
              : "border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-bg"
          }`}
        >
          <RepeatGlyph className="shrink-0" />
          <span className={`flex-1 truncate text-left ${on ? "font-medium" : ""}`}>{label}</span>
          {!on && <span className="shrink-0 text-meta text-muted">Does not repeat</span>}
          <Icon name="chevron-right" size={14} className="shrink-0 text-muted" />
        </button>
      ) : (
        <button
          disabled={disabled}
          onClick={open}
          title={value ? describeRule(value, anchorISO) : "Set a repeat"}
          className={`fast inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label disabled:opacity-40 ${
            on
              ? "bg-accent-soft font-medium text-accent"
              : "bg-bg text-muted hover:brightness-95 dark:hover:brightness-110"
          }`}
        >
          <RepeatGlyph />
          <span className="max-w-[150px] truncate">{label}</span>
        </button>
      )}
      {anchor && (
        <RecurrencePicker
          anchorISO={anchorISO}
          current={value}
          anchor={anchor}
          onPick={(rule) => { onChange(rule); setAnchor(null); }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}

const POP_W = 288;

/** A small radio dot used by the preset rows. */
function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-2 transition-colors ${
        on ? "border-accent" : "border-line-strong"
      }`}
    >
      {on && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
    </span>
  );
}

type EndMode = "never" | "on" | "after";

/**
 * The repeat editor: contextual presets up top, an expandable custom builder
 * below. Anchored beside the control that opened it. Returns a RecurrenceRule
 * (or null for "does not repeat") via onPick.
 */
export default function RecurrencePicker({
  anchorISO,
  current,
  anchor,
  onPick,
  onClose,
}: {
  anchorISO: string;
  current: RecurrenceRule | null;
  anchor: DOMRect;
  onPick: (rule: RecurrenceRule | null) => void;
  onClose: () => void;
}) {
  const presets = useMemo(() => presetsFor(anchorISO), [anchorISO]);
  const anchorWeekday = parseDateISO(anchorISO).getDay();
  const anchorDay = parseDateISO(anchorISO).getDate();

  // Does `current` match one of the presets? If not, the custom builder opens.
  const matchedPreset = presets.some((p) => rulesEqual(p.rule, current));
  const [custom, setCustom] = useState(Boolean(current) && !matchedPreset);

  // ── custom builder state ──────────────────────────────────────────────
  const [freq, setFreq] = useState<RecurrenceFreq>(current?.freq ?? "weekly");
  const [interval, setInterval] = useState(current?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    current?.byweekday?.length ? current.byweekday : [anchorWeekday],
  );
  const [endMode, setEndMode] = useState<EndMode>(
    current?.until ? "on" : current?.count ? "after" : "never",
  );
  const [untilDate, setUntilDate] = useState(current?.until ?? "");
  const [count, setCount] = useState(current?.count ?? 10);

  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: "right" | "left" }>({
    top: anchor.bottom + 6,
    left: anchor.left,
    side: "right",
  });

  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = pop.offsetHeight;
    let left = anchor.left;
    if (left + POP_W > vw - 8) left = vw - 8 - POP_W;
    left = Math.max(8, left);
    let top = anchor.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, anchor.top - 6 - h);
    setPos({ top, left, side: "right" });
  }, [anchor]);

  const buildCustom = (): RecurrenceRule => {
    const rule: RecurrenceRule = { freq, interval: Math.max(1, interval) };
    if (freq === "weekly") rule.byweekday = weekdays.length ? [...weekdays].sort((a, b) => a - b) : [anchorWeekday];
    if (freq === "monthly") rule.bymonthday = anchorDay;
    if (endMode === "on" && untilDate) rule.until = untilDate;
    if (endMode === "after") rule.count = Math.max(1, count);
    return rule;
  };

  const toggleWeekday = (d: number) =>
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const seg = (active: boolean) =>
    `fast flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-label font-medium transition-colors ${
      active ? "bg-accent text-on-accent" : "text-muted hover:text-ink"
    }`;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        ref={popRef}
        className="moment fixed z-[61] flex flex-col rounded-[var(--radius-lg)] border border-line bg-surface"
        style={{ top: pos.top, left: pos.left, width: POP_W, boxShadow: "var(--shadow-3)" }}
      >
        <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-2">
          <Icon name="repeat" size={13} className="text-accent" />
          <span className="text-caption font-semibold text-text">Repeat</span>
        </div>

        {/* Presets */}
        <div className="flex flex-col px-1.5 pb-1">
          {presets.map((p) => {
            const on = !custom && rulesEqual(p.rule, current);
            return (
              <button
                key={p.label}
                onClick={() => onPick(p.rule)}
                className="fast flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-bg"
              >
                <Dot on={on} />
                <span className={`text-caption ${on ? "font-medium text-text" : "text-text"}`}>{p.label}</span>
              </button>
            );
          })}

          {/* Custom toggle */}
          <button
            onClick={() => setCustom((c) => !c)}
            className="fast flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left hover:bg-bg"
          >
            <Dot on={custom} />
            <span className={`text-caption ${custom ? "font-medium text-text" : "text-text"}`}>Custom…</span>
          </button>
        </div>

        {/* Custom builder */}
        {custom && (
          <div className="space-y-2.5 border-t border-line px-3.5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-label text-muted">Every</span>
              <input
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
                className="w-12 rounded-md border border-line bg-surface-2 px-1.5 py-1 text-center text-caption outline-none focus:border-accent"
              />
              <div className="flex flex-1 gap-1 rounded-[var(--radius)] bg-bg p-0.5">
                {(["daily", "weekly", "monthly"] as const).map((f) => (
                  <button key={f} onClick={() => setFreq(f)} className={seg(freq === f)}>
                    {f === "daily" ? "Day" : f === "weekly" ? "Week" : "Month"}
                  </button>
                ))}
              </div>
            </div>

            {freq === "weekly" && (
              <div className="flex justify-between gap-1">
                {WEEKDAY_LABELS.map((lbl, d) => {
                  const on = weekdays.includes(d);
                  return (
                    <button
                      key={d}
                      onClick={() => toggleWeekday(d)}
                      className={`fast grid h-7 w-7 place-items-center rounded-full text-meta font-semibold transition-colors ${
                        on ? "bg-accent text-on-accent" : "bg-bg text-muted hover:text-ink"
                      }`}
                    >
                      {lbl[0]}
                    </button>
                  );
                })}
              </div>
            )}

            {freq === "monthly" && (
              <p className="text-label text-muted">On the {anchorDay}{ordinalSuffix(anchorDay)} of the month</p>
            )}

            {/* End condition */}
            <div className="space-y-1.5 pt-0.5">
              <span className="text-label text-muted">Ends</span>
              <div className="flex gap-1 rounded-[var(--radius)] bg-bg p-0.5">
                {(["never", "on", "after"] as const).map((m) => (
                  <button key={m} onClick={() => setEndMode(m)} className={seg(endMode === m)}>
                    {m === "never" ? "Never" : m === "on" ? "On date" : "After"}
                  </button>
                ))}
              </div>
              {endMode === "on" && (
                <input
                  type="date"
                  value={untilDate}
                  min={anchorISO}
                  onChange={(e) => setUntilDate(e.target.value)}
                  className="w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-caption outline-none focus:border-accent"
                />
              )}
              {endMode === "after" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={count}
                    onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
                    className="w-14 rounded-md border border-line bg-surface-2 px-1.5 py-1 text-center text-caption outline-none focus:border-accent"
                  />
                  <span className="text-label text-muted">occurrences</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="truncate text-meta text-muted">{describeRule(buildCustom(), anchorISO)}</span>
              <button
                onClick={() => onPick(buildCustom())}
                className="fast shrink-0 rounded-[var(--radius-sm)] bg-accent px-3 py-1 text-caption font-medium text-on-accent hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
