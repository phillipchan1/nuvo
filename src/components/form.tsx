import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from "react";

/* ── The input design language ─────────────────────────────────────────────
   One coherent set of form primitives, all built on the `.field` surface (see
   index.css). Generous by default — 40px on desktop, 44px on a phone — so
   nothing is ever a squint-and-tap. Reach for these instead of hand-rolling
   `border border-line px-2 py-1`; that recipe is retired.

   Field      — a labelled row (title · description · control), the settings unit
   TextInput  — single-line text / url / password / email
   Select     — native select with our own chevron
   Toggle     — the on/off switch
   Checkbox   — inline check (when a switch would be too heavy)
   Stepper    — −  value  +  for bounded numbers
   Segmented  — a small pill group for 2–4 exclusive choices                */

// ── Field: label-left / control-right, stacking on a phone ─────────────────
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
  /** "row" = label-left / control-right (stacks on a phone). "stack" = label
   *  above control — the cell shape that tiles into a multi-column form grid. */
  layout?: "row" | "stack";
}) {
  if (layout === "stack") {
    return (
      <div className={`flex flex-col gap-3 ${className}`}>
        <div>
          <label htmlFor={htmlFor} className="text-body font-medium text-ink">
            {title}
          </label>
          {desc && <div className="mt-1 text-caption leading-snug text-muted">{desc}</div>}
        </div>
        <div>{children}</div>
      </div>
    );
  }
  return (
    <div
      className={`flex flex-col items-start gap-2.5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 ${className}`}
    >
      <div className="min-w-0 sm:max-w-[62%]">
        <label htmlFor={htmlFor} className="text-body font-medium text-ink">
          {title}
        </label>
        {desc && <div className="mt-1 text-caption leading-snug text-muted">{desc}</div>}
      </div>
      <div className="w-full shrink-0 sm:w-auto">{children}</div>
    </div>
  );
}

// ── A group of fields on a hairline-divided card ───────────────────────────
export function FieldGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-line ${className}`}>{children}</div>;
}

// ── TextInput ──────────────────────────────────────────────────────────────
export function TextInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`field w-full ${className}`} />;
}

// ── Select (custom chevron) ─────────────────────────────────────────────────
// `className` sizes/positions the wrapper (e.g. `w-full sm:w-28`, `shrink-0`);
// the inner <select> always fills it. Font utilities on the wrapper cascade in.
export function Select({
  className = "w-full",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative inline-block ${className}`}>
      <select {...props} className="field w-full cursor-pointer truncate pr-9">
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>
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
  // A 44px-tall hit area (per the mobile tap rule) wrapping a 28px pill — so the
  // switch reads as a switch, not a fat circle, while staying easy to tap.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`fast group inline-flex h-11 w-12 shrink-0 items-center justify-center disabled:opacity-40 ${className}`}
    >
      <span
        className={`fast relative h-7 w-12 rounded-full ${checked ? "bg-accent" : "bg-line-strong"}`}
      >
        <span
          className="fast absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm"
          style={{ left: checked ? "24px" : "4px" }}
        />
      </span>
    </button>
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
    <label className={`tap inline-flex items-center gap-2 text-body text-muted ${disabled ? "opacity-40" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--accent)]"
      />
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
  const btn =
    "fast tap flex w-10 items-center justify-center text-head leading-none text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-[var(--radius)] border border-line bg-surface">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className={btn} title={decHint}>
        −
      </button>
      <span className="mono flex min-w-14 select-none items-center justify-center border-x border-line px-1 text-center text-body tabular-nums text-ink">
        {format(value)}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className={btn} title={incHint}>
        +
      </button>
    </div>
  );
}

// ── Segmented: a small pill group for 2–4 exclusive choices ─────────────────
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-[var(--radius)] border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`fast tap rounded-[calc(var(--radius)-3px)] px-4 text-caption font-medium ${
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
