import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

// Chip · Dot · Readiness · Avatar · AvatarStack — the small marks that carry
// identity and state. Colour arrives only through a token (a domain hue is
// passed as a CSS colour string that is itself a token or the domain's stored
// colour), never a literal written here.

export type ChipTone = "neutral" | "accent" | "signal" | "danger" | "ok";

export function Chip({
  children,
  tone = "neutral",
  dot,
  icon,
  className,
  title,
}: {
  children: ReactNode;
  tone?: ChipTone;
  /** a domain colour: draws its identity dot first */
  dot?: string;
  icon?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cx("k-chip", className)} data-tone={tone === "neutral" ? undefined : tone} title={title}>
      {dot && <Dot color={dot} />}
      {icon}
      <span>{children}</span>
    </span>
  );
}

/** A chip you can press — a property shortcut, a removable filter. */
export const ChipButton = forwardRef<HTMLButtonElement, { children: ReactNode; dot?: string; icon?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>>(
  function ChipButton({ children, dot, icon, className, ...rest }, ref) {
    return (
      <button ref={ref} type="button" className={cx("k-chip", className)} {...rest}>
        {dot && <Dot color={dot} />}
        {icon}
        <span>{children}</span>
      </button>
    );
  },
);

/** A domain's identity, as a square (default) or a round dot. */
export function Dot({ color, shape = "square", size = "md", title }: { color: string; shape?: "square" | "round"; size?: "sm" | "md"; title?: string }) {
  return (
    <span
      className="k-dot"
      data-shape={shape === "square" ? undefined : shape}
      data-size={size === "md" ? undefined : size}
      style={{ ["--h" as string]: color }}
      title={title}
      aria-hidden={title ? undefined : true}
    />
  );
}

export type ReadinessStep = 0 | 1 | 2 | 3 | "shipped";

const READINESS_LABEL: Record<string, string> = {
  "0": "Raw",
  "1": "Grooming · 1 of 3",
  "2": "Grooming · 2 of 3",
  "3": "Ready",
  shipped: "Shipped",
};

/** How shaped a project is, as a pie: dashed (raw) → 1/3 → 2/3 → full (ready). */
export function Readiness({ step, title }: { step: ReadinessStep; title?: string }) {
  const label = title ?? READINESS_LABEL[String(step)];
  return <span className="k-rdy" data-step={String(step)} role="img" aria-label={label} title={label} />;
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Avatar({ name, color, src, size = "md" }: { name: string; color?: string; src?: string; size?: "md" | "lg" }) {
  return (
    <span
      className="k-av"
      data-size={size === "md" ? undefined : size}
      style={color ? { ["--a" as string]: color } : undefined}
      title={name}
      role="img"
      aria-label={name}
    >
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 3 }: { people: readonly { name: string; color?: string; src?: string }[]; max?: number }) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <span className="k-avs">
      {shown.map((p, i) => (
        <Avatar key={`${p.name}-${i}`} {...p} />
      ))}
      {more > 0 && (
        <span className="k-av" data-more="" title={`${more} more`}>
          +{more}
        </span>
      )}
    </span>
  );
}
