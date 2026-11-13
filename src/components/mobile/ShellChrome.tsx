// The phone shell's chrome — the top bar and the bottom bar, as parts.
//
// `MobileShell` owns the state (which place, which overlay); these own the
// drawing, so the Calendar harness (`?horizon`) can frame its lenses in the
// bar the phone actually wears rather than a mock of it.
//
//   top bar     the surface's one hero (30px) · search · theme · settings,
//               then ONE line of fact in tabular figures (styles/phone.css)
//   bottom bar  five equal places — 21px glyph, 10.5px name, ink when you are
//               there — with ＋ (52px, accent) and ✦ (44px, raised) floating
//               above its right end

import { useRef, type ReactNode } from "react";
import { Icon } from "../Icon";
import { IconButton } from "../kit";
import { AltitudeIcon, type AltitudeKind } from "../icons";
import type { CalHero } from "./CalendarChrome";

/**
 * The Calendar's hero, in the top bar.
 *
 * It had a row of its own inside the Calendar's chrome — 40px on the phone's
 * most contested screen — and on the Week lens it spent them saying "This week"
 * directly above a crown strip already saying "This week". Up here it costs
 * nothing: every tab's bar carries a hero in this slot (D-125).
 *
 * It is the surface's one hero (`text-display masthead`, 30px on a phone), and
 * still the jump-anywhere door: tapping it opens the OS date picker, which is
 * the only way to reach a date that is more than a few swipes away.
 */
function CalendarTitle({ hero }: { hero: CalHero }) {
  const jumpRef = useRef<HTMLInputElement>(null);
  const canJump = Boolean(hero.date);

  if (!canJump) return <h1 className="ph-hero text-display masthead">{hero.hero}</h1>;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const el = jumpRef.current;
          if (!el) return;
          // `showPicker` where it exists (iOS 16+, every engine we ship on);
          // focus is the honest fallback rather than a dead hero.
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
        aria-label={`${hero.hero} — jump to another date`}
        className="ph-hero-btn"
      >
        <span className="ph-hero text-display masthead">{hero.hero}</span>
      </button>
      {/* `sr-only` and opened by the button above: iOS paints a date input's own
          value at the control's intrinsic width while its picker is open, which
          used to smear "Aug 17," across the header. */}
      <input
        ref={jumpRef}
        type="date"
        value={hero.date!.toLocaleDateString("en-CA")}
        onChange={(e) => {
          const [y, m, d] = e.target.value.split("-").map(Number);
          if (y && m && d) hero.onJump(new Date(y, m - 1, d));
        }}
        aria-label="Jump to date"
        className="sr-only"
        tabIndex={-1}
      />
    </>
  );
}

/** The hero's one line of fact, its numbers in ink ("**3h** open"). A date span
 *  ("Nov 9 – 15", "2026") is identification rather than a read, so it stays one
 *  quiet colour. Always mounted — an empty line holds its height, so nothing
 *  under the bar moves when a lens has no fact (D-123). */
export function FactLine({ text, accent }: { text?: string; accent?: boolean }) {
  if (!text) {
    return (
      <div className="ph-fact" aria-hidden>
        {" "}
      </div>
    );
  }
  if (/^(\d{4}|[A-Z][a-z]+,? [A-Z]?[a-z]* ?\d)/.test(text)) return <div className="ph-fact">{text}</div>;
  const parts = text.split(/(\d[\d:.,]*(?:\s?(?:h|m|am|pm)\b)?(?:\s(?:of)\s\d+)?)/);
  return (
    <div className="ph-fact" data-accent={accent || undefined}>
      {parts.map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}
    </div>
  );
}

/** The top bar. On the Calendar pass `hero` (handed up by the Calendar); on
 *  every other place, `title` and `fact`. */
export function PhoneTopBar({
  hero,
  title,
  fact,
  onSearch,
  onToggleTheme,
  onSettings,
}: {
  hero?: CalHero | null;
  title: string;
  fact?: string;
  onSearch: () => void;
  onToggleTheme: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="mobile-topbar ph-top pt-safe">
      <div className="ph-top-row">
        {hero ? <CalendarTitle hero={hero} /> : <h1 className="ph-hero text-display masthead">{title}</h1>}
        <div className="min-w-2 flex-1" />
        <IconButton label="Search" size="md" icon={<Icon name="search" size={18} />} onClick={onSearch} className="tap-icon shrink-0" />
        <IconButton
          label="Toggle theme"
          size="md"
          icon={<Icon name="moon" size={18} />}
          onClick={onToggleTheme}
          className="tap-icon shrink-0"
        />
        <IconButton label="Settings" size="md" icon={<Icon name="settings" size={18} />} onClick={onSettings} className="tap-icon shrink-0" />
      </div>
      {hero ? <FactLine text={hero.fact} accent={hero.factAccent} /> : <FactLine text={fact} />}
    </header>
  );
}

export type Place<T extends string> = { id: T; label: string; kind: AltitudeKind };

/** The bottom bar: five equal places, and — when `onCapture` is given — the two
 *  floating acts above its right end. */
export function PhoneNav<T extends string>({
  places,
  current,
  onPick,
  badge,
  onCapture,
  onAskNuvo,
  children,
}: {
  places: readonly Place<T>[];
  current: T;
  onPick: (id: T) => void;
  /** A count on a place (the inbox, on Tasks). */
  badge?: (id: T) => number;
  /** Omit both to stand the floating acts down (the chat is open, a bulk
   *  selection owns the corner). */
  onCapture?: () => void;
  onAskNuvo?: () => void;
  children?: ReactNode;
}) {
  return (
    <nav className="ph-nav" aria-label="Places">
      {onAskNuvo && (
        // Nuvo — the floating chat launcher, beside capture: a --raised 44px
        // square. Screen-aware: its starters match wherever you are.
        <button type="button" onClick={onAskNuvo} aria-label="Ask Nuvo" data-teach="nuvo" className="ph-launch">
          <Icon name="sparkles" size={20} />
        </button>
      )}
      {onCapture && (
        // Capture — the one primary action: a 52px accent square.
        <button type="button" onClick={onCapture} aria-label="Capture" data-teach="capture" className="ph-fab">
          <Icon name="plus" size={24} strokeWidth={2} />
        </button>
      )}
      {places.map((t) => {
        const n = badge?.(t.id) ?? 0;
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            data-teach={`mtab-${t.id}`}
            aria-current={active ? "page" : undefined}
            aria-label={n > 0 ? `${t.label}, ${n} in inbox` : undefined}
            className="ph-tab"
          >
            <AltitudeIcon kind={t.kind} size={21} />
            <span>{t.label}</span>
            {n > 0 && (
              <span className="ph-badge" aria-hidden>
                {n > 99 ? "99+" : n}
              </span>
            )}
          </button>
        );
      })}
      {children}
    </nav>
  );
}
