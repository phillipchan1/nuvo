import type { CSSProperties } from "react";
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
  Funnel,
  Globe,
  Hourglass,
  Info,
  List,
  Mail,
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
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════════
   ICON — one name, one drawing (D-189).

   Every UI icon is a Lucide glyph: the neutral 16px outline set the precise,
   workspace register runs on. The hand-drawn Warm Paper set (and the
   material switch that chose between the two) was retired with the materials.

   The Spine's altitude glyphs are deliberately NOT here. They are the app's
   navigational identity (see AltitudeIcon in icons.tsx) rather than UI
   furniture, and they stay hand-drawn.
   ══════════════════════════════════════════════════════════════════════════ */

export type IconName =
  | "agenda"
  | "arrow-right"
  | "bell"
  | "calendar"
  | "card"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "filter"
  | "chevron-right"
  | "clock"
  | "close"
  | "copy"
  | "duration"
  | "eye"
  | "eye-off"
  | "globe"
  | "info"
  | "mail"
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
  | "sparkles"
  | "sun"
  | "tag"
  | "trash"
  | "user"
  | "user-plus"
  | "users"
  | "video";

// Lucide draws on a 24-grid at strokeWidth 2; at the 9–19px these
// render at, 2 reads chunky, so the component thins it to 1.75 by default.
const GLYPHS: Record<IconName, LucideIcon> = {
  agenda: List,
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
  filter: Funnel,
  duration: Hourglass,
  eye: Eye,
  "eye-off": EyeOff,
  globe: Globe,
  info: Info,
  mail: Mail,
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
  sparkles: Sparkles,
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
  const Glyph = GLYPHS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth ?? 1.75}
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
    </Glyph>
  );
}
