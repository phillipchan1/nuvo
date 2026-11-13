import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { createPortal } from "react-dom";
import {
  describeRule,
  presetsFor,
  type RecurrenceFreq,
  type RecurrenceRule,
  rulesEqual,
  SETPOS_VALUES,
  setposOf,
  WEEKDAY_LABELS,
} from "../lib/recurrence";

/** The positional labels, short enough for a five-up segmented control. */
const SETPOS_SHORT: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", [-1]: "Last" };
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
import { parseDateISO } from "../lib/dates";
import { useEscape } from "../hooks/useEscape";
import { useIsMobile } from "../hooks/useIsMobile";
import type { RecurrenceScope } from "../lib/types";
import Sheet from "./mobile/Sheet";
import { FactRow, SHEET_SCROLL } from "./mobile/sheetKit";
import { Button, Dialog, IconButton, Input, Menu, MenuItem, MenuLabel, MenuSeparator, Segmented } from "./kit";

/** edit/move/delete offer all three scopes. `answer` (RSVP, guests, Meet)
 *  has no "following" — that would split the series to answer an invite.
 *  `rule` (the repeat picker) has no "just this" — one occurrence can't
 *  repeat differently from its own series. */
export type RecurrenceScopeMode = "edit" | "move" | "delete" | "answer" | "rule";

/**
 * The this-vs-series prompt. Every write on a repeating event uses this one
 * dialog — title, place, notes, schedule, RSVP, guests, Meet, drag, delete.
 * A recurring edit that writes THIS without asking is how an all-day flip
 * silently became a one-off exception. A kit Dialog: a Sheet on the phone.
 */
export function RecurrenceScopeDialog({
  onConfirm,
  onCancel,
  mode = "edit",
}: {
  onConfirm: (scope: RecurrenceScope) => void;
  onCancel: () => void;
  /** Drag/resize talks about shifting; delete talks about removing. */
  mode?: RecurrenceScopeMode;
}) {
  const [scope, setScope] = useState<RecurrenceScope>(mode === "rule" ? "FOLLOWING" : "THIS");
  const all: { value: RecurrenceScope; label: string; sub: string }[] = [
    {
      value: "THIS",
      label: "Just this event",
      sub: mode === "delete" ? "Only this occurrence is removed" : "Only this occurrence changes",
    },
    {
      value: "FOLLOWING",
      label: "This and following events",
      sub:
        mode === "delete"
          ? "This one and every later one are removed"
          : mode === "rule"
            ? "The new repeat starts here; earlier ones stay"
            : "Earlier occurrences stay as they were",
    },
    {
      value: "ALL",
      label: "All events in series",
      sub:
        mode === "move"
          ? "Every occurrence shifts by the same amount"
          : mode === "delete"
            ? "Every occurrence in the series is removed"
            : "Every occurrence in the series changes",
    },
  ];
  const options = all.filter(
    (o) => !(mode === "answer" && o.value === "FOLLOWING") && !(mode === "rule" && o.value === "THIS"),
  );

  return (
    <Dialog
      onClose={onCancel}
      width={380}
      align="center"
      title={
        mode === "delete"
          ? "Delete this event or the whole series?"
          : mode === "rule"
            ? "Change the repeat from here, or for the whole series?"
            : "Edit this event or the whole series?"
      }
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button kind={mode === "delete" ? "danger-solid" : "primary"} onClick={() => onConfirm(scope)}>
            {mode === "delete" ? "Delete" : "Done"}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Which events" className="k-choices">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={scope === opt.value}
            onClick={() => setScope(opt.value)}
            className="k-choice"
          >
            <span className="k-choice-mark" aria-hidden />
            <span className="k-choice-text">
              <b>{opt.label}</b>
              <small>{opt.sub}</small>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * Gate a write behind the this-vs-series dialog when the event repeats.
 * Non-recurring runs immediately as THIS. Cancel runs `revert` so local
 * inspector state doesn't keep a change that never went to the provider.
 */
export function useRecurringScope(recurring: boolean) {
  const [pending, setPending] = useState<null | {
    run: (scope: RecurrenceScope) => void | Promise<void>;
    revert: () => void;
    mode: RecurrenceScopeMode;
  }>(null);

  const commit = useCallback(
    (
      run: (scope: RecurrenceScope) => void | Promise<void>,
      revert: () => void = () => {},
      mode: RecurrenceScopeMode = "edit",
    ) => {
      if (!recurring) {
        void Promise.resolve(run("THIS"));
        return;
      }
      setPending({ run, revert, mode });
    },
    [recurring],
  );

  const confirm = useCallback((scope: RecurrenceScope) => {
    if (!pending) return;
    const { run } = pending;
    setPending(null);
    void Promise.resolve(run(scope));
  }, [pending]);

  const cancel = useCallback(() => {
    pending?.revert();
    setPending(null);
  }, [pending]);

  const dismiss = useCallback(() => setPending(null), []);

  return { pending, commit, confirm, cancel, dismiss };
}

/** The delete act in a card's footer: a quiet glyph that reddens under the
 *  pointer — or, outside a footer, a danger button. */
function DeleteTrigger({
  quiet,
  label,
  open,
  setRef,
  onClick,
}: {
  quiet?: boolean;
  label: string;
  open?: boolean;
  setRef?: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  return quiet ? (
    <IconButton
      ref={setRef}
      size="xs"
      label={label}
      icon={<Icon name="trash" size={14} />}
      onClick={onClick}
      aria-haspopup={setRef ? "menu" : undefined}
      aria-expanded={setRef ? Boolean(open) : undefined}
      data-quiet-danger=""
    />
  ) : (
    <Button
      ref={setRef}
      kind="danger"
      icon={<Icon name="trash" size={14} />}
      onClick={onClick}
      aria-haspopup={setRef ? "menu" : undefined}
      aria-expanded={setRef ? Boolean(open) : undefined}
    >
      {label}
    </Button>
  );
}

/**
 * A delete control that fans out into series scopes when the item repeats.
 * Non-recurring → one act (onSimple). Recurring → a menu: this occurrence ·
 * this & following · whole series.
 */
export function RecurrenceDeleteButton({
  recurring,
  label = "Trash",
  quiet,
  onSimple,
  onThis,
  onFollowing,
  onSeries,
}: {
  recurring: boolean;
  label?: string;
  /** Footer voice: a glyph that only reddens under the pointer / while its
   *  menu is open. A permanently-red button in a detail card's footer
   *  outshouts the act the card is actually for. */
  quiet?: boolean;
  onSimple: () => void;
  onThis: () => void;
  onFollowing: () => void;
  onSeries: () => void;
}) {
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  if (!recurring) return <DeleteTrigger quiet={quiet} label={label} onClick={onSimple} />;
  return (
    <>
      <DeleteTrigger quiet={quiet} label={`${label}…`} open={open} setRef={setBtn} onClick={() => setOpen((o) => !o)} />
      <Menu anchor={btn} open={open} onClose={() => setOpen(false)} placement="top-end" label={label}>
        <MenuLabel>{label}</MenuLabel>
        <MenuItem danger onSelect={onThis}>This occurrence</MenuItem>
        <MenuItem danger onSelect={onFollowing}>This & following</MenuItem>
        <MenuItem danger onSelect={onSeries}>Whole series</MenuItem>
      </Menu>
    </>
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
  quiet,
  onDelete,
}: {
  recurring: boolean;
  taskCount: number;
  dayLabel: string;
  /** Footer voice — see RecurrenceDeleteButton. */
  quiet?: boolean;
  onDelete: (scope: SlotDeleteScope, deleteTasks: boolean) => void;
}) {
  const [btn, setBtn] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [deleteTasks, setDeleteTasks] = useState(false);

  // Nothing to decide — a plain, empty, non-recurring slot deletes outright.
  if (!recurring && taskCount === 0) {
    return <DeleteTrigger quiet={quiet} label="Delete slot" onClick={() => onDelete("simple", false)} />;
  }

  const scopes: { scope: SlotDeleteScope; label: string }[] = recurring
    ? [
        { scope: "this", label: "This occurrence" },
        { scope: "following", label: "This & following" },
        { scope: "series", label: "Whole series" },
      ]
    : [{ scope: "simple", label: "Delete slot" }];

  return (
    <>
      <DeleteTrigger quiet={quiet} label="Delete slot…" open={open} setRef={setBtn} onClick={() => setOpen((o) => !o)} />
      <Menu anchor={btn} open={open} onClose={() => setOpen(false)} placement="top-end" label="Delete slot">
        {taskCount > 0 && (
          <>
            <MenuItem checked={deleteTasks} keepOpen onSelect={() => setDeleteTasks((v) => !v)}>
              Also delete {taskCount} task{taskCount === 1 ? "" : "s"} inside
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuLabel>{taskCount > 0 && !deleteTasks ? `Tasks stay on ${dayLabel}` : "Delete"}</MenuLabel>
        {scopes.map((s) => (
          <MenuItem key={s.scope} danger onSelect={() => onDelete(s.scope, taskCount > 0 && deleteTasks)}>
            {s.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/**
 * The control the user clicks to set/edit a repeat — owns the picker's open
 * state. Shows the humanized rule when one is set, "Repeat" otherwise.
 *
 *   value  a value in an inspector row (the row's glyph says "repeat")
 *   chip   a small button among other controls
 *   block  a full-width row for composers where it's a primary action
 *   row    the phone sheets' hairline settings row (label · value · ›)
 */
export function RepeatControl({
  anchorISO,
  value,
  onChange,
  disabled,
  variant = "chip",
  emptyLabel,
}: {
  anchorISO: string;
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  disabled?: boolean;
  variant?: "chip" | "block" | "row" | "value";
  /** What the `row` says when there is no rule to describe. An event flagged as
   *  repeating whose rule hasn't arrived yet is NOT "Does not repeat". */
  emptyLabel?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const on = Boolean(value);
  const open = (e: React.MouseEvent<HTMLButtonElement>) =>
    setAnchor(e.currentTarget.getBoundingClientRect());
  const rule = value ? describeRule(value, anchorISO) : null;
  const label = rule ?? "Repeat";
  return (
    <>
      {variant === "row" ? (
        <FactRow
          icon="repeat"
          label="Repeat"
          value={rule ?? (emptyLabel ?? "Does not repeat")}
          valueColor={on ? "var(--accent)" : null}
          onClick={open}
        />
      ) : variant === "value" ? (
        <button
          type="button"
          disabled={disabled}
          onClick={open}
          // The name is "Repeat" (what the row is); the rule rides after it.
          aria-label={rule ? `Repeat: ${rule}` : "Repeat"}
          title={rule ?? "Set a repeat"}
          aria-haspopup="dialog"
          className="insp-v"
          data-empty={on ? undefined : ""}
        >
          <span>{rule ?? (emptyLabel ?? "Doesn't repeat")}</span>
        </button>
      ) : variant === "block" ? (
        <button
          type="button"
          disabled={disabled}
          onClick={open}
          title={rule ?? "Set a repeat"}
          className="k-field k-select tap-h w-full"
          data-on={on || undefined}
        >
          <span className="k-select-val">
            <Icon name="repeat" size={14} />
            {rule ?? "Does not repeat"}
          </span>
          <Icon name="chevron-right" size={12} />
        </button>
      ) : (
        <Button
          size="xs"
          disabled={disabled}
          onClick={open}
          title={rule ?? "Set a repeat"}
          active={on}
          icon={<Icon name="repeat" size={12} />}
        >
          <span className="max-w-[150px] truncate">{label}</span>
        </Button>
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

const POP_W = 296;

type EndMode = "never" | "on" | "after";

/**
 * The repeat editor's draft: the presets, the custom builder's fields, and the
 * rule they build. Both faces of the picker wear it — the desktop popover and
 * the phone's bottom sheet — so "what is a custom repeat" is defined once and
 * the two can only differ in how they LOOK.
 */
function useRepeatDraft(anchorISO: string, current: RecurrenceRule | null) {
  const presets = useMemo(() => presetsFor(anchorISO), [anchorISO]);
  const anchorWeekday = parseDateISO(anchorISO).getDay();
  const anchorMonth = parseDateISO(anchorISO).getMonth() + 1;
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
  // Monthly / yearly answer "which day" one of two ways, never both: by date
  // ("the 14th") or by position ("the 3rd Tuesday"). One control, two states —
  // see the recurrence kernel's `bysetpos`.
  const [dayRule, setDayRule] = useState<"date" | "position">(current?.bysetpos ? "position" : "date");
  const [setpos, setSetpos] = useState<number>(current?.bysetpos ?? setposOf(anchorISO));

  const buildCustom = (): RecurrenceRule => {
    const rule: RecurrenceRule = { freq, interval: Math.max(1, interval) };
    if (freq === "weekly") rule.byweekday = weekdays.length ? [...weekdays].sort((a, b) => a - b) : [anchorWeekday];
    if (freq === "monthly" || freq === "yearly") {
      if (dayRule === "position") {
        rule.bysetpos = setpos;
        rule.byweekday = [anchorWeekday];
      } else {
        rule.bymonthday = anchorDay;
      }
      if (freq === "yearly") rule.bymonth = anchorMonth;
    }
    if (endMode === "on" && untilDate) rule.until = untilDate;
    if (endMode === "after") rule.count = Math.max(1, count);
    return rule;
  };

  const toggleWeekday = (d: number) =>
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  return {
    presets, anchorWeekday, anchorMonth, anchorDay,
    custom, setCustom,
    freq, setFreq, interval, setInterval, weekdays,
    endMode, setEndMode, untilDate, setUntilDate, count, setCount,
    dayRule, setDayRule, setpos, setSetpos,
    buildCustom, toggleWeekday,
  };
}

/** Enter in a custom-builder field applies the rule. A button keeps its own
 *  Enter (a preset, Done). Stopped so the composer underneath does not also
 *  create, with the rule from before this edit. */
function onCustomFieldEnter(e: React.KeyboardEvent, custom: boolean, apply: () => void) {
  if (e.key !== "Enter" || e.shiftKey || e.altKey || e.nativeEvent.isComposing || !custom) return;
  const target = e.target as HTMLElement | null;
  if (!target || target.tagName !== "INPUT") return;
  e.preventDefault();
  e.stopPropagation();
  apply();
}

type RepeatPickerProps = {
  anchorISO: string;
  current: RecurrenceRule | null;
  anchor: DOMRect;
  onPick: (rule: RecurrenceRule | null) => void;
  onClose: () => void;
};

/**
 * The repeat editor. On a desktop it is a popover anchored beside the control
 * that opened it; on a phone it is a bottom sheet — a small floating card with
 * a custom builder wider than itself is exactly the cursor-anchored popover the
 * phone's golden rule bans. Returns a RecurrenceRule (or null for "does not
 * repeat") via onPick.
 */
export default function RecurrencePicker(props: RepeatPickerProps) {
  const mobile = useIsMobile();
  return mobile ? <RepeatSheet {...props} /> : <RecurrencePopover {...props} />;
}

const FREQS = [
  { value: "daily" as const, label: "Day" },
  { value: "weekly" as const, label: "Week" },
  { value: "monthly" as const, label: "Month" },
  { value: "yearly" as const, label: "Year" },
];
const ENDS = [
  { value: "never" as const, label: "Never" },
  { value: "on" as const, label: "On date" },
  { value: "after" as const, label: "After" },
];

/**
 * The desktop face: a Picker of contextual presets (checked), then a custom
 * builder that opens in place below them, anchored beside the control that
 * opened it.
 */
function RecurrencePopover({ anchorISO, current, anchor, onPick, onClose }: RepeatPickerProps) {
  const {
    presets, anchorWeekday, anchorMonth, anchorDay,
    custom, setCustom,
    freq, setFreq, interval, setInterval, weekdays,
    endMode, setEndMode, untilDate, setUntilDate, count, setCount,
    dayRule, setDayRule, setpos, setSetpos,
    buildCustom, toggleWeekday,
  } = useRepeatDraft(anchorISO, current);

  const popRef = useRef<HTMLDivElement>(null);
  // The popover is only mounted while open, so it is always active here.
  useEscape(true, onClose);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string }>({
    top: anchor.bottom + 6,
    left: anchor.left,
    origin: "top left",
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
    let origin = "top left";
    if (top + h > vh - 8) {
      top = Math.max(8, anchor.top - 6 - h);
      origin = "bottom left";
    }
    setPos({ top, left, origin });
  }, [anchor]);

  // `data-nested-surface`: a floating layer of its own — a press in it (or on
  // its scrim) belongs to it, not to the card it was opened from, which closes
  // on any press outside itself (DraftComposer, D-158; the inspectors).
  return createPortal(
    <>
      <div data-nested-surface="" className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        ref={popRef}
        data-nested-surface=""
        data-repeat-picker=""
        className="k-pop"
        style={{ top: pos.top, left: pos.left, width: POP_W, zIndex: 61, ["--pop-origin" as string]: pos.origin }}
        onKeyDown={(e) => onCustomFieldEnter(e, custom, () => onPick(buildCustom()))}
      >
        {/* Presets — one of them, checked. */}
        {presets.map((p) => {
          const on = !custom && rulesEqual(p.rule, current);
          return (
            <button key={p.label} type="button" onClick={() => onPick(p.rule)} className="k-mi" aria-pressed={on}>
              <span className="k-mi-label">{p.label}</span>
              {on && <Icon name="check" size={14} className="k-mi-check" />}
            </button>
          );
        })}
        <div className="k-msep" role="separator" />
        <button type="button" onClick={() => setCustom((c) => !c)} className="k-mi" aria-expanded={custom}>
          <span className="k-mi-label">Custom…</span>
          {custom && <Icon name="check" size={14} className="k-mi-check" />}
        </button>

        {/* Custom builder — opens in place. */}
        {custom && (
          <div className="rp-build">
            <div className="rp-line">
              <span className="rp-label">Every</span>
              <Input
                type="number"
                size="sm"
                min={1}
                value={interval}
                onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
                aria-label="Repeat every"
                frameClassName="rp-num"
              />
              <Segmented size="sm" className="k-seg-full" label="Unit" options={FREQS} value={freq} onChange={(f) => setFreq(f)} />
            </div>

            {freq === "weekly" && (
              <div className="rp-days" role="group" aria-label="Repeat on">
                {WEEKDAY_LABELS.map((lbl, d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={weekdays.includes(d)}
                    aria-label={new Date(2023, 0, 1 + d).toLocaleDateString([], { weekday: "long" })}
                    onClick={() => toggleWeekday(d)}
                  >
                    {lbl[0]}
                  </button>
                ))}
              </div>
            )}

            {/* The control that used to be a sentence. "On the 14th" was
                stated, never chosen — so "the last Friday of the month", the
                shape most standing commitments take, could not be said at all. */}
            {(freq === "monthly" || freq === "yearly") && (
              <>
                <Segmented
                  size="sm"
                  className="k-seg-full"
                  label="Which day"
                  value={dayRule}
                  onChange={(v) => setDayRule(v)}
                  options={[
                    {
                      value: "date" as const,
                      label: freq === "yearly" ? `${MONTH_SHORT[anchorMonth - 1]} ${anchorDay}` : `On the ${anchorDay}${ordinalSuffix(anchorDay)}`,
                    },
                    { value: "position" as const, label: `The ${SETPOS_SHORT[setpos] ?? setpos} ${WEEKDAY_LABELS[anchorWeekday]}` },
                  ]}
                />
                {dayRule === "position" && (
                  <Segmented
                    size="sm"
                    className="k-seg-full"
                    label="Which one"
                    value={String(setpos)}
                    onChange={(v) => setSetpos(Number(v))}
                    options={SETPOS_VALUES.map((p) => ({ value: String(p), label: SETPOS_SHORT[p] }))}
                  />
                )}
              </>
            )}

            <div className="rp-line">
              <span className="rp-label">Ends</span>
              <Segmented size="sm" className="k-seg-full" label="Ends" options={ENDS} value={endMode} onChange={(m) => setEndMode(m)} />
            </div>
            {endMode === "on" && (
              <Input
                type="date"
                size="sm"
                value={untilDate}
                min={anchorISO}
                onChange={(e) => setUntilDate(e.target.value)}
                aria-label="Ends on"
              />
            )}
            {endMode === "after" && (
              <div className="rp-line">
                <Input
                  type="number"
                  size="sm"
                  min={1}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
                  aria-label="Number of occurrences"
                  frameClassName="rp-num"
                />
                <span className="rp-label">times</span>
              </div>
            )}

            <div className="rp-foot">
              <span className="rp-read">{describeRule(buildCustom(), anchorISO)}</span>
              <Button size="xs" kind="primary" onClick={() => onPick(buildCustom())}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

/**
 * The phone face: the same presets and the same custom builder, as a bottom
 * sheet. Rows are 48px, the Day/Week/Month/Year control is a full-width four-up
 * of 40px targets, and the weekday strip is seven 40px circles.
 */
function RepeatSheet({ anchorISO, current, onPick, onClose }: RepeatPickerProps) {
  const {
    presets, anchorWeekday, anchorMonth, anchorDay,
    custom, setCustom,
    freq, setFreq, interval, setInterval, weekdays,
    endMode, setEndMode, untilDate, setUntilDate, count, setCount,
    dayRule, setDayRule, setpos, setSetpos,
    buildCustom, toggleWeekday,
  } = useRepeatDraft(anchorISO, current);

  return (
    <Sheet title="Repeat" onClose={onClose} contentClassName={SHEET_SCROLL}>
      <div className="rp-sheet px-4 pb-6" onKeyDown={(e) => onCustomFieldEnter(e, custom, () => onPick(buildCustom()))}>
        <div className="rp-rows">
          {presets.map((p) => {
            const on = !custom && rulesEqual(p.rule, current);
            return (
              <button key={p.label} type="button" onClick={() => onPick(p.rule)} className="rp-row" aria-pressed={on}>
                <span>{p.label}</span>
                {on && <Icon name="check" size={16} />}
              </button>
            );
          })}
          <button type="button" onClick={() => setCustom((c) => !c)} className="rp-row" aria-expanded={custom}>
            <span>Custom…</span>
            {custom && <Icon name="check" size={16} />}
          </button>
        </div>

        {custom && (
          <div className="rp-build">
            <div className="rp-line">
              <span className="rp-label">Every</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={interval}
                onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))}
                aria-label="Repeat every"
                frameClassName="rp-num"
              />
            </div>
            <Segmented className="k-seg-full" label="Unit" options={FREQS} value={freq} onChange={(f) => setFreq(f as RecurrenceFreq)} />

            {freq === "weekly" && (
              <div className="rp-days" role="group" aria-label="Repeat on">
                {WEEKDAY_LABELS.map((lbl, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={weekdays.includes(i)}
                    // "Wed" read aloud is a fragment; the circle shows one letter.
                    aria-label={new Date(2023, 0, 1 + i).toLocaleDateString([], { weekday: "long" })}
                    onClick={() => toggleWeekday(i)}
                  >
                    {lbl[0]}
                  </button>
                ))}
              </div>
            )}

            {(freq === "monthly" || freq === "yearly") && (
              <>
                <Segmented
                  className="k-seg-full"
                  label="Which day"
                  value={dayRule}
                  onChange={(v) => setDayRule(v)}
                  options={[
                    {
                      value: "date" as const,
                      label: freq === "yearly" ? `${MONTH_SHORT[anchorMonth - 1]} ${anchorDay}` : `On the ${anchorDay}${ordinalSuffix(anchorDay)}`,
                    },
                    { value: "position" as const, label: `The ${SETPOS_SHORT[setpos] ?? setpos} ${WEEKDAY_LABELS[anchorWeekday]}` },
                  ]}
                />
                {dayRule === "position" && (
                  <Segmented
                    className="k-seg-full"
                    label="Which one"
                    value={String(setpos)}
                    onChange={(v) => setSetpos(Number(v))}
                    options={SETPOS_VALUES.map((p) => ({ value: String(p), label: SETPOS_SHORT[p] }))}
                  />
                )}
              </>
            )}

            <span className="rp-label">Ends</span>
            <Segmented className="k-seg-full" label="Ends" options={ENDS} value={endMode} onChange={(m) => setEndMode(m)} />
            {endMode === "on" && (
              <Input type="date" value={untilDate} min={anchorISO} onChange={(e) => setUntilDate(e.target.value)} aria-label="Ends on" />
            )}
            {endMode === "after" && (
              <div className="rp-line">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
                  aria-label="Number of occurrences"
                  frameClassName="rp-num"
                />
                <span className="rp-label">times</span>
              </div>
            )}

            <p className="rp-read">{describeRule(buildCustom(), anchorISO)}</p>
            <Button kind="primary" size="md" full onClick={() => onPick(buildCustom())}>
              Done
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
