import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  Globe,
  Hourglass,
  Info,
  MapPin,
  Moon,
  MoreHorizontal,
  Package,
  Paperclip,
  Pencil,
  Plus,
  Repeat,
  RotateCw,
  Search,
  Settings,
  Sun,
  Tag,
  Trash2,
  User,
  UserPlus,
  Users,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { useSkin } from "../hooks/useSkin";

/* ══════════════════════════════════════════════════════════════════════════
   ICON — one name, two drawings, chosen by MATERIAL.

   Nuvo's icons were ~120 inline <svg> blocks scattered across ~40 files, each
   hand-drawn on its own grid to sit with Warm Paper. That set is deliberately
   *not* generic: the weights and the slightly loose geometry are part of the
   paper voice. The flat material is imitating the opposite thing — the neutral
   16px/1.5px outline set every workspace app wears — and the hand-drawn icons
   are the single most obvious tell that it is a costume.

   So icons became the one part of the design system that is skin-aware:

     · PAPER — the existing hand-drawn set, unchanged, still the default. Aurora,
       Terminal, Blueprint and E-Ink all keep it.
     · FLAT  — Lucide, which is the same register the flat skin is aiming at.

   This is a real cost and it is worth naming: every icon now has to exist in
   both maps, and a new one has to be drawn for paper as well as picked for
   flat. That was the accepted trade — the alternative was swapping the icon set
   globally, which would have changed Aurora, the default skin.

   The Spine's altitude glyphs are deliberately NOT here. They are the app's
   navigational identity (see AltitudeIcon in icons.tsx) rather than UI
   furniture, and they stay hand-drawn in every material.
   ══════════════════════════════════════════════════════════════════════════ */

export type IconName =
  | "arrow-right"
  | "bell"
  | "calendar"
  | "card"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "clock"
  | "close"
  | "copy"
  | "duration"
  | "eye"
  | "eye-off"
  | "globe"
  | "info"
  | "moon"
  | "more"
  | "package"
  | "paperclip"
  | "pen"
  | "pin"
  | "plus"
  | "refresh"
  | "repeat"
  | "search"
  | "settings"
  | "sun"
  | "tag"
  | "trash"
  | "user"
  | "user-plus"
  | "users"
  | "video";

/** A paper glyph: its own viewBox (they differ per icon) plus its markup. */
type PaperGlyph = { vb: string; body: ReactNode; filled?: boolean };

// The hand-drawn set, lifted verbatim from the call sites it used to be inlined
// at — same paths, same weights, same grids. Stroke widths are tuned per grid,
// which is why the viewBox travels with the glyph instead of being normalised.
const PAPER: Record<IconName, PaperGlyph> = {
  bell: {
    vb: "0 0 12 12",
    body: (
      <>
        <path
          d="M3 8.3h6l-.85-1.15V5.3a2.15 2.15 0 0 0-4.3 0v1.85L3 8.3Z"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <path d="M5.05 9.6a1.05 1.05 0 0 0 1.9 0" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </>
    ),
  },
  calendar: {
    vb: "0 0 12 12",
    body: (
      <>
        <rect x="1" y="2" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M1 5h10" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4 1v2M8 1v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </>
    ),
  },
  check: {
    vb: "0 0 10 10",
    body: <path d="M1.5 5.5L4 8L8.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  },
  "chevron-down": {
    vb: "0 0 10 10",
    body: <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  },
  "chevron-left": {
    vb: "0 0 14 14",
    body: <path d="M9 11L5 7l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  },
  "chevron-right": {
    vb: "0 0 14 14",
    body: <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  },
  clock: {
    vb: "0 0 12 12",
    body: (
      <>
        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 3v3l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </>
    ),
  },
  close: {
    vb: "0 0 14 14",
    body: <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  },
  duration: {
    vb: "0 0 12 12",
    body: (
      <>
        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 4v2.5h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </>
    ),
  },
  more: {
    vb: "0 0 14 14",
    filled: true,
    body: (
      <>
        <circle cx="3" cy="7" r="1.25" />
        <circle cx="7" cy="7" r="1.25" />
        <circle cx="11" cy="7" r="1.25" />
      </>
    ),
  },
  plus: {
    vb: "0 0 12 12",
    body: <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />,
  },
  search: {
    vb: "0 0 14 14",
    body: (
      <>
        <circle cx="6.2" cy="6.2" r="4" stroke="currentColor" strokeWidth="1.4" />
        <path d="M9.2 9.2L12.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  settings: {
    vb: "0 0 19 19",
    body: (
      <>
        <circle cx="9.5" cy="9.5" r="2.4" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M9.5 1.6v2.2M9.5 15.2v2.2M1.6 9.5h2.2M15.2 9.5h2.2M3.9 3.9l1.6 1.6M13.5 13.5l1.6 1.6M15.1 3.9l-1.6 1.6M5.5 13.5l-1.6 1.6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </>
    ),
  },
  "arrow-right": {
    vb: "0 0 12 12",
    body: <path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />,
  },
  card: {
    vb: "0 0 16 16",
    body: (
      <>
        <rect x="1.8" y="3.8" width="12.4" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M1.8 6.6h12.4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </>
    ),
  },
  copy: {
    vb: "0 0 16 16",
    body: (
      <>
        <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.75" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M10.25 3.75a2 2 0 0 0-2-2H4.5a2.75 2.75 0 0 0-2.75 2.75V8.25a2 2 0 0 0 2 2"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </>
    ),
  },
  eye: {
    vb: "0 0 16 16",
    body: (
      <>
        <path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
      </>
    ),
  },
  "eye-off": {
    vb: "0 0 16 16",
    body: (
      <path
        d="M6.3 3.8A6 6 0 018 3.5C12.2 3.5 14.5 8 14.5 8a11 11 0 01-1.9 2.4M3.4 5.6A11 11 0 001.5 8s2.3 4.5 6.5 4.5a6 6 0 002-.35M2 2l12 12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  globe: {
    vb: "0 0 16 16",
    body: (
      <>
        <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M2.4 8h11.2M8 2.4v11.2M4.4 4.4c1.2 1.4 1.9 3.1 1.9 3.6 0 .5-.7 2.2-1.9 3.6M11.6 4.4c-1.2 1.4-1.9 3.1-1.9 3.6 0 .5.7 2.2 1.9 3.6"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </>
    ),
  },
  info: {
    vb: "0 0 16 16",
    body: (
      <>
        <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 7.2v3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="5.2" r="0.9" fill="currentColor" />
      </>
    ),
  },
  moon: {
    vb: "0 0 16 16",
    body: (
      <>
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 2.5a5.5 5.5 0 000 11z" fill="currentColor" />
      </>
    ),
  },
  package: {
    vb: "0 0 12 12",
    body: <path d="M6 1l4.5 2.5v5L6 11 1.5 8.5v-5L6 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />,
  },
  paperclip: {
    vb: "0 0 24 24",
    body: (
      <path
        d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  pen: {
    vb: "0 0 24 24",
    body: (
      <>
        <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="16" y1="8" x2="2" y2="22" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <line x1="17.5" y1="15" x2="9" y2="15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
  pin: {
    vb: "0 0 12 12",
    body: (
      <>
        <path d="M6 1C4.067 1 2.5 2.567 2.5 4.5c0 2.917 3.5 6.5 3.5 6.5s3.5-3.583 3.5-6.5C9.5 2.567 7.933 1 6 1z" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="6" cy="4.5" r="1.2" stroke="currentColor" strokeWidth="1.1" />
      </>
    ),
  },
  refresh: {
    vb: "0 0 16 16",
    body: (
      <>
        <path d="M13.25 8a5.25 5.25 0 1 1-1.6-3.78" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M13.4 2.4v2.9h-2.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  repeat: {
    vb: "0 0 14 14",
    body: (
      <>
        <path d="M3 5a4 4 0 016.9-2.7M11 9a4 4 0 01-6.9 2.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M10 1.5V4H7.5M4 12.5V10h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  // Normalised to currentColor. The one call site (Login's hero) hardcoded #fff
  // in the markup; that is the call site's business, not the glyph's, and it now
  // passes the colour in like every other coloured icon does.
  sun: {
    vb: "0 0 18 18",
    body: (
      <>
        <circle cx="9" cy="10" r="3.4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.5 13.5h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M9 3.2v1.6M14 5l-1.1 1.1M4 5l1.1 1.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  tag: {
    vb: "0 0 16 16",
    body: (
      <>
        <path d="M2.5 2.5h4.7l6.3 6.3a1 1 0 010 1.4l-3.3 3.3a1 1 0 01-1.4 0L2.5 7.2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="5.4" cy="5.4" r="0.95" fill="currentColor" />
      </>
    ),
  },
  trash: {
    vb: "0 0 14 14",
    body: <path d="M3 4h8M5.5 4V3h3v1M4 4l.5 7h5L10 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />,
  },
  user: {
    vb: "0 0 16 16",
    body: (
      <>
        <circle cx="8" cy="5.5" r="2.6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3.2 13.4c0-2.5 2.1-4.1 4.8-4.1s4.8 1.6 4.8 4.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </>
    ),
  },
  "user-plus": {
    vb: "0 0 12 12",
    body: (
      <>
        <circle cx="5" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M1 10.5c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M9 5.5v3M7.5 7H10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </>
    ),
  },
  users: {
    vb: "0 0 12 12",
    filled: true,
    body: <path d="M5.5 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm-4 3a4 4 0 1 1 7.02 2.62l1.98 1.98-.7.7-1.98-1.98A4 4 0 0 1 1.5 5z" fill="currentColor" />,
  },
  video: {
    vb: "0 0 12 12",
    body: (
      <>
        <rect x="1" y="3" width="6.5" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7.5 5.5L10.8 3.8v4.4L7.5 6.5v-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </>
    ),
  },
};

// The flat set. Lucide draws on a 24-grid at strokeWidth 2; at the 9–19px these
// render at, 2 reads chunky, so the component thins it to 1.75 by default.
const FLAT: Record<IconName, LucideIcon> = {
  "arrow-right": ArrowRight,
  bell: Bell,
  calendar: Calendar,
  card: CreditCard,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  clock: Clock,
  close: X,
  copy: Copy,
  duration: Hourglass,
  eye: Eye,
  "eye-off": EyeOff,
  globe: Globe,
  info: Info,
  moon: Moon,
  more: MoreHorizontal,
  package: Package,
  paperclip: Paperclip,
  pen: Pencil,
  pin: MapPin,
  plus: Plus,
  refresh: RotateCw,
  repeat: Repeat,
  search: Search,
  settings: Settings,
  sun: Sun,
  tag: Tag,
  trash: Trash2,
  user: User,
  "user-plus": UserPlus,
  users: Users,
  video: Video,
};

export type IconProps = {
  name: IconName;
  /** Rendered px, both axes. Call sites vary from 7 to 19 — pass what you need. */
  size?: number;
  className?: string;
  strokeWidth?: number;
  /** Must be forwarded: several call sites set the glyph's colour here — a white
   *  check on a filled accent chip, a domain hue on a seal — and every glyph
   *  draws with currentColor, so dropping it silently renders the wrong ink. */
  style?: CSSProperties;
  /** Accessible name. Icons are decorative by DEFAULT (aria-hidden), because
   *  nearly all of them sit beside a text label that already says the thing.
   *  Pass this for the few that carry meaning alone — the recurrence mark on a
   *  calendar block is the whole signal that an event repeats — and the glyph
   *  becomes an exposed <title> instead of being hidden. */
  title?: string;
};

export function Icon({ name, size = 14, className, strokeWidth, style, title }: IconProps) {
  const [skin] = useSkin();
  const label = title ? <title>{title}</title> : null;

  if (skin === "flat") {
    const Glyph = FLAT[name];
    return (
      <Glyph
        size={size}
        strokeWidth={strokeWidth ?? 1.75}
        className={className}
        style={style}
        aria-hidden={title ? undefined : true}
      >
        {label}
      </Glyph>
    );
  }

  const glyph = PAPER[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox={glyph.vb}
      fill={glyph.filled ? "currentColor" : "none"}
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
    >
      {label}
      {glyph.body}
    </svg>
  );
}
