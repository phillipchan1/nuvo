// Duration chip — invisible <select> over a mono label. Same grammar as the
// task record; presets live in lib/types so every surface stamps the same set.

import { fmtDuration } from "../lib/dates";
import { DURATION_PRESETS } from "../lib/types";

function optionsFor(value: number): number[] {
  if ((DURATION_PRESETS as readonly number[]).includes(value)) return [...DURATION_PRESETS];
  // Keep odd legacy values (e.g. the old 20m default) selectable until changed.
  return [...DURATION_PRESETS, value].sort((a, b) => a - b);
}

export default function DurationSelect({
  value,
  onChange,
  className = "",
  title = "Duration",
}: {
  value: number;
  onChange: (mins: number) => void;
  className?: string;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={`relative inline-flex cursor-pointer items-center ${className}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="mono text-micro text-muted">{fmtDuration(value)}</span>
      <select
        value={value}
        aria-label={title}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      >
        {optionsFor(value).map((m) => (
          <option key={m} value={m}>
            {fmtDuration(m)}
          </option>
        ))}
      </select>
    </label>
  );
}
