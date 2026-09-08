import { useId, type CSSProperties } from "react";
import type { DomainMarkSpec } from "../../lib/domainMark";
import DomainSymbol from "./DomainSymbol";

const CENTER = 100;
const QUIET = "var(--muted)";

function polar(radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [
    CENTER + radius * Math.cos(radians),
    CENTER + radius * Math.sin(radians),
  ];
}

function arcPath(radius: number, fraction: number): string {
  const clamped = Math.max(0, Math.min(0.9999, fraction));
  if (clamped <= 0) return "";
  const degrees = clamped * 360;
  const [startX, startY] = polar(radius, 0);
  const [endX, endY] = polar(radius, degrees);
  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${degrees > 180 ? 1 : 0} 1 ${endX} ${endY}`;
}

export default function DomainMark({
  spec,
  size = 100,
  className,
  style,
}: {
  spec: DomainMarkSpec;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const gradientId = `dm${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { color, weeks, target, lit, seed, symbol } = spec;
  const scale = Math.max(target, ...weeks, 1);
  const total = weeks.reduce((sum, hours) => sum + hours, 0);
  const expected = target > 0 ? target * 13 : scale * 13;
  const fullness = Math.min(1, total / Math.max(1, expected));
  const rotation = (seed % 18) - 9;
  const symbolSize = Math.max(14, Math.round(size * 0.27));

  return (
    <span
      className={`relative inline-flex items-center justify-center ${className ?? ""}`}
      style={{ width: size, height: size, color, ...style }}
      role="img"
      aria-label="Domain mark"
    >
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        className="absolute inset-0"
        aria-hidden
        style={{ overflow: "visible" }}
      >
        <defs>
          <radialGradient id={gradientId}>
            <stop offset="0%" stopColor={color} stopOpacity={lit ? 0.2 : 0.05} />
            <stop offset="68%" stopColor={color} stopOpacity={lit ? 0.08 : 0.02} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </radialGradient>
        </defs>
        <circle cx={CENTER} cy={CENTER} r={58} fill={`url(#${gradientId})`} />
        <g transform={`rotate(${rotation} ${CENTER} ${CENTER})`}>
          <circle cx={CENTER} cy={CENTER} r={48} fill="none" stroke="var(--line)" strokeWidth={1.2} opacity={0.7} />
          <circle cx={CENTER} cy={CENTER} r={72} fill="none" stroke="var(--line)" strokeWidth={1} opacity={0.45} />
          <path
            d={arcPath(48, fullness)}
            fill="none"
            stroke={lit ? color : QUIET}
            strokeWidth={3.2}
            strokeLinecap="round"
            opacity={lit ? 0.8 : 0.28}
          />
          {weeks.map((hours, index) => {
            // The newest week lands at twelve o'clock; history runs clockwise
            // back from it, so the current state always has the same place.
            const degrees = ((index + 1) * 360) / 13;
            const value = Math.min(1.2, hours / scale);
            const [x, y] = polar(72, degrees);
            const present = hours > 0.05;
            return (
              <circle
                key={index}
                data-domain-week={index}
                cx={x}
                cy={y}
                r={present ? 2.2 + value * 4.2 : 1.8}
                fill={present ? color : QUIET}
                opacity={present ? (lit ? 0.4 + value * 0.5 : 0.3) : 0.16}
              />
            );
          })}
        </g>
        <circle
          cx={CENTER}
          cy={CENTER}
          r={34}
          fill="var(--surface)"
          fillOpacity={0.72}
          stroke={lit ? color : QUIET}
          strokeWidth={1.4}
          opacity={lit ? 0.95 : 0.62}
        />
      </svg>
      <DomainSymbol
        value={symbol}
        size={symbolSize}
        className="relative z-[1]"
      />
    </span>
  );
}
