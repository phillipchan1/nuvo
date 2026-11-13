import { useState } from "react";
import { Icon } from "../Icon";
import { IconButton } from "./Button";

// MiniMonth — the date popover's grid (D-190). Today is in --signal (now),
// the chosen day is an accent fill (intent). Arrow keys walk days; PageUp /
// PageDown walk months. Dates are local calendar days, compared by Y-M-D.

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Pure: the 6×7 grid of days shown for the month containing `month`. */
export function monthGrid(month: Date, weekStartsOn: 0 | 1): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function MiniMonth({
  value,
  onChange,
  weekStartsOn = 0,
  today = new Date(),
}: {
  value: Date | null;
  onChange: (d: Date) => void;
  weekStartsOn?: 0 | 1;
  today?: Date;
}) {
  const [month, setMonth] = useState(() => {
    const base = value ?? today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const days = monthGrid(month, weekStartsOn);
  const dow = [...DOW.slice(weekStartsOn), ...DOW.slice(0, weekStartsOn)];
  const step = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const title = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div
      className="k-month"
      onKeyDown={(e) => {
        if (e.key === "PageDown") {
          e.preventDefault();
          step(1);
        } else if (e.key === "PageUp") {
          e.preventDefault();
          step(-1);
        }
      }}
    >
      <div className="k-month-head">
        <span>{title}</span>
        <IconButton size="xs" label="Previous month" icon={<Icon name="chevron-left" size={12} />} onClick={() => step(-1)} />
        <IconButton size="xs" label="Next month" icon={<Icon name="chevron-right" size={12} />} onClick={() => step(1)} />
      </div>
      <div className="k-month-grid" role="grid" aria-label={title}>
        {dow.map((d, i) => (
          <span key={`${d}-${i}`} className="k-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {days.map((d) => {
          const on = !!value && ymd(d) === ymd(value);
          return (
            <button
              key={ymd(d)}
              type="button"
              aria-pressed={on}
              aria-label={d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              data-out={d.getMonth() !== month.getMonth() || undefined}
              data-today={ymd(d) === ymd(today) || undefined}
              onClick={() => onChange(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
