import { useEffect, useState } from "react";
import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from "react";
import { Icon } from "./Icon";
import {
  Checkbox as KitCheckbox,
  IconButton,
  Input,
  Segmented as KitSegmented,
  Switch,
} from "./kit";
import { cx } from "./kit/cx";

/* ── The settings form, on the kit (D-190) ──────────────────────────────────
   These keep the API they always had — Settings, the account and app panes,
   the rituals and the groom wall call them — but every one is a kit part
   underneath, so a field here and a field anywhere else are the same field.

   PaneHeader — a pane's one hero (20px, 700)
   Field      — a 52px label-left / control-right row, hairline-separated
   TextInput  — kit Input
   TimeInput  — a clock time in a kit field, saved once you've finished
   Select     — a native select in a kit field (keeps optgroups + the phone's wheel)
   Toggle     — kit Switch, with a touch-sized hit area
   Checkbox   — kit Checkbox with its label
   Stepper    — −  value  +  for bounded numbers
   Segmented  — kit Segmented                                                 */

/** The heading at the top of a settings pane. Lives here rather than in
 *  SettingsModal so a pane split into its own file wears the same crown. */
export function PaneHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h2 className="set-title">{title}</h2>
      {sub && <p className="set-sub">{sub}</p>}
    </>
  );
}

export function Field({
  title,
  desc,
  htmlFor,
  children,
  className = "",
  layout = "row",
}: {
  title: ReactNode;
  desc?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  /** "row" = label-left / control-right (wraps under on a narrow pane).
   *  "stack" = label above control — for a control that needs the width. */
  layout?: "row" | "stack";
}) {
  const label = (
    <div className="set-row-label">
      <label htmlFor={htmlFor} className="set-row-title">
        {title}
      </label>
      {desc && <div className="set-row-desc">{desc}</div>}
    </div>
  );
  if (layout === "stack") {
    return (
      <div className={cx("set-stack", className)}>
        {label}
        <div className="min-w-0">{children}</div>
      </div>
    );
  }
  return (
    <div className={cx("set-row", className)}>
      {label}
      <div className="set-row-ctl">{children}</div>
    </div>
  );
}

// ── A group of fields — the rows carry their own hairlines ─────────────────
export function FieldGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

// ── TextInput ──────────────────────────────────────────────────────────────
/** `className` sizes the field's frame (width, margin, `mono`). */
export function TextInput({
  className = "",
  size: _size,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <Input {...props} frameClassName={cx("fm-field w-full", className)} />;
}

// ── TimeInput ──────────────────────────────────────────────────────────────
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * A clock time (minutes from midnight) that is only *saved* once you've finished
 * setting it — on blur or Enter.
 *
 * A native time field fires `change` on every segment you touch, and writing that
 * straight through made the first digit a real setting: typing "11" saved 1:00am
 * the moment the "1" landed, the re-render reset the field's typing state, and the
 * second "1" was swallowed. Working hours became 1am–5:30pm and could not be typed
 * back. The field now keeps its own draft; arrows and the phone's wheel still
 * work, they just save on the way out.
 */
export function TimeInput({
  minutes,
  onCommit,
  className = "",
  onKeyDown,
  size: _size,
  ...props
}: { minutes: number; onCommit: (minutes: number) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "onBlur"
>) {
  const saved = toHHMM(minutes);
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(false);
  // follow the saved value whenever you aren't mid-edit (another surface changed it)
  useEffect(() => {
    if (!editing) setDraft(saved);
  }, [saved, editing]);

  const commit = () => {
    setEditing(false);
    const m = /^(\d{2}):(\d{2})/.exec(draft);
    // a half-cleared field isn't a time — put the saved one back
    if (!m) return setDraft(saved);
    const next = Number(m[1]) * 60 + Number(m[2]);
    if (next !== minutes) onCommit(next);
  };

  return (
    <Input
      {...props}
      type="time"
      value={draft}
      onChange={(e) => {
        setEditing(true);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        onKeyDown?.(e);
      }}
      frameClassName={cx("fm-field fm-time w-full", className)}
    />
  );
}

// ── Select (native, in a kit field) ─────────────────────────────────────────
// `className` sizes/positions the frame (e.g. `w-full sm:w-28`, `shrink-0`);
// the inner <select> always fills it. A native select on purpose: optgroups
// (the time zone list, the calendar groups) and the phone's own wheel.
export function Select({
  className = "w-full",
  children,
  disabled,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx("k-field fm-select", className)} data-disabled={disabled || undefined}>
      <select {...props} disabled={disabled}>
        {children}
      </select>
      <Icon name="chevron-down" size={12} />
    </span>
  );
}

// ── Toggle: the on/off switch ───────────────────────────────────────────────
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  className = "",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Screen-reader / a11y name for the switch. */
  label?: string;
  className?: string;
}) {
  // The kit switch is 28×16; its hit area grows past the drawing (documents.css
  // `.fm-switch`), to 44px under a finger, so the switch never looks fat.
  return (
    <span className={cx("fm-switch", className)}>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label ?? ""} />
    </span>
  );
}

// ── Checkbox (inline, when a switch is too heavy) ───────────────────────────
export function Checkbox({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <label className="fm-check tap-h" data-disabled={disabled || undefined}>
      <KitCheckbox checked={checked} onChange={onChange} disabled={disabled} label={typeof children === "string" ? children : ""} />
      {children}
    </label>
  );
}

// ── Stepper: −  value  +  for a bounded number ──────────────────────────────
export function Stepper({
  value,
  min,
  max,
  onChange,
  format = (v) => String(v),
  decHint,
  incHint,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  decHint?: string;
  incHint?: string;
}) {
  return (
    <span className="fm-stepper">
      <IconButton
        size="xs"
        label={decHint ?? "Less"}
        icon={<span aria-hidden>−</span>}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      />
      <output aria-live="polite">{format(value)}</output>
      <IconButton
        size="xs"
        label={incHint ?? "More"}
        icon={<Icon name="plus" size={12} />}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      />
    </span>
  );
}

// ── Segmented: 2–4 exclusive choices ────────────────────────────────────────
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label = "Choose one",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label?: string;
}) {
  return <KitSegmented options={options} value={value} onChange={onChange} label={label} className="fm-seg" />;
}
