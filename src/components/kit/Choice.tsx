import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

// TaskCheck · Checkbox · Switch · Segmented · Tabs — every way of choosing.
//
// The marks are real buttons with ARIA roles, so they take focus, answer Space,
// and read correctly; the 14px mark keeps a 28px hit area (44px under touch)
// through a ::before in kit.css, so a small mark is never a small target.

/** The task's round check. Landing it plays the land stamp (D-187). */
export function TaskCheck({
  checked,
  onChange,
  label,
  size = "md",
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  size?: "md" | "lg";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx("k-check", className)}
      data-size={size === "md" ? undefined : size}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    />
  );
}

/** The square checkbox — for settings, selection and lists of options. */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean | "mixed";
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx("k-box", className)}
      onClick={(e) => {
        e.stopPropagation();
        onChange(checked !== true);
      }}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="k-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export type Choice<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  title?: string;
  /** what a Segmented in a tight PageBar says instead — the phone ladder's
   *  letters ("D", "W"). The bar decides when (styles/kit.css, `k-bar`). */
  short?: string;
};

/** ←/→ walk the options and select as they go (radio-group behaviour). */
function arrowStep<T extends string>(e: KeyboardEvent, options: readonly Choice<T>[], value: T, onChange: (v: T) => void, root: HTMLElement | null) {
  const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const i = options.findIndex((o) => o.value === value);
  const next = options[(i + dir + options.length) % options.length];
  onChange(next.value);
  const btn = root?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`);
  btn?.focus();
}

/** A small set of exclusive choices in a trough — the view switch, Task/Event/Slot. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: {
  options: readonly Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={cx("k-seg", className)}
      data-size={size === "md" ? undefined : size}
      onKeyDown={(e) => arrowStep(e, options, value, onChange, ref.current)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-value={o.value}
            title={o.title ?? (o.short && typeof o.label === "string" ? o.label : undefined)}
            aria-label={o.short && typeof o.label === "string" ? o.label : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.icon}
            {o.short ? (
              <>
                <span className="k-seg-long">{o.label}</span>
                <span className="k-seg-short" aria-hidden="true">
                  {o.short}
                </span>
              </>
            ) : (
              o.label
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Text tabs with a drawn underline — a page's views in its bar. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: readonly Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} role="tablist" aria-label={label} className={cx("k-tabs", className)} onKeyDown={(e) => arrowStep(e, tabs, value, onChange, ref.current)}>
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-value={t.value}
            title={t.title}
            onClick={() => onChange(t.value)}
          >
            {t.icon}
            {t.label}
            {t.count != null && <span className="k-count">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
