import type { CSSProperties } from "react";

// ══ The altitude family ══════════════════════════════════════════════════════
// One drawing hand for the five things Nuvo names: task · schedule · project ·
// initiative · domain. Same 20×20 field, hairline stroke, round caps, no fill
// but a single marker. They read as *span*, widening as you climb the ladder —
// one claimed unit → a day's column → a few weeks of bars → the mark being
// aimed at → the wall it all stands on.
//
// This is the only place they're drawn. Anywhere the app shows "what kind of
// thing is this" — the spine, the phone's bottom bar, the command palette, a
// mis-filed list — imports from here, so the vocabulary can never drift into
// three different sets of glyphs again. A domain's own emoji (`domain.icon`) is
// a different thing entirely: that's identity, chosen by the user.

export type AltitudeKind = "task" | "day" | "project" | "initiative" | "domain";

export function AltitudeIcon({
  kind,
  size = 19,
  className,
  style,
}: {
  kind: AltitudeKind;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    style,
    "aria-hidden": true,
  };
  switch (kind) {
    // Task — the claimed unit: one box, one tick.
    case "task":
      return (
        <svg {...p}>
          <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="3.25" />
          <path d="m6.75 10.25 2.4 2.4 4.6-5.3" />
        </svg>
      );
    // Schedule — a day: the time axis, and two blocks claimed on it.
    case "day":
      return (
        <svg {...p}>
          <path d="M4 3.5v13" />
          <rect x="7" y="4.5" width="9" height="4.5" rx="1.5" />
          <rect x="7" y="11.5" width="5.5" height="4.5" rx="1.5" />
        </svg>
      );
    // Projects — a few weeks of work, staggered: the deck read as a small gantt.
    case "project":
      return (
        <svg {...p} strokeWidth={2}>
          <path d="M4 5.5h8" />
          <path d="M8 10h8" />
          <path d="M5.5 14.5h5.5" />
        </svg>
      );
    // Initiatives — the mark: one named outcome the projects are aimed at.
    case "initiative":
      return (
        <svg {...p}>
          <circle cx="10" cy="10" r="7" />
          <circle cx="10" cy="10" r="2.6" />
        </svg>
      );
    // Domains — the wall: four panes, the literal shape of the domain wall.
    case "domain":
      return (
        <svg {...p} strokeWidth={1.4}>
          <rect x="3" y="3.25" width="6" height="6" rx="1.6" />
          <rect x="11" y="3.25" width="6" height="6" rx="1.6" />
          <rect x="3" y="11" width="6" height="6" rx="1.6" />
          <rect x="11" y="11" width="6" height="6" rx="1.6" />
        </svg>
      );
  }
}

// ── Chrome glyphs ────────────────────────────────────────────────────────────
// The spine's own utilities, drawn in the same hand so the rail reads as one set.

export function SettingsIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M3 6.5h5.5M11.5 6.5H17M3 13.5h3.5M9.5 13.5H17" />
      <circle cx="10" cy="6.5" r="1.9" />
      <circle cx="8" cy="13.5" r="1.9" />
    </svg>
  );
}

export function ChevronIcon({ dir, size = 15 }: { dir: "left" | "right"; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {dir === "left" ? <path d="M9.5 3.5 5 8l4.5 4.5" /> : <path d="M6.5 3.5 11 8l-4.5 4.5" />}
    </svg>
  );
}
