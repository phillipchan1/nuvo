import { useEffect, useRef } from "react";
import WeatherIcon from "./WeatherIcon";
import type { WeatherDay } from "../hooks/useWeather";

const WMO_LABEL: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snowfall",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Showers",
  81: "Rain showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm + hail",
  99: "Severe thunderstorm",
};

function wmoLabel(wmo: number): string {
  return WMO_LABEL[wmo] ?? "Unknown";
}

interface Anchor {
  x: number;   // center x of the column header
  y: number;   // bottom of the column header
}

interface Props {
  day: WeatherDay;
  city?: string;
  anchor: Anchor;
  onClose: () => void;
}

export default function WeatherPopover({ day, city, anchor, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Clamp left so card stays on screen (card ~160px wide)
  const cardW = 160;
  const left = Math.max(8, Math.min(anchor.x - cardW / 2, window.innerWidth - cardW - 8));

  return (
    <>
      {/* Invisible backdrop to catch outside clicks */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Card */}
      <div
        ref={cardRef}
        className="glass-card fixed z-50 flex flex-col items-center gap-2 rounded-2xl px-5 py-4"
        style={{
          top: anchor.y + 6,
          left,
          minWidth: cardW,
          boxShadow: "var(--shadow-lift)",
          animation: "rise 120ms ease-out both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Big icon */}
        <WeatherIcon wmo={day.wmo} size={36} />

        {/* Temperature — masthead Fraunces for ceremony */}
        <div className="flex items-baseline gap-1.5 leading-none">
          <span className="masthead" style={{ fontSize: "28px", color: "var(--text)" }}>
            {day.tempHigh}°
          </span>
          <span className="text-caption" style={{ color: "var(--muted)" }}>
            / {day.tempLow}°
          </span>
        </div>

        {/* Condition label */}
        <span className="text-caption" style={{ color: "var(--muted)" }}>
          {wmoLabel(day.wmo)}
        </span>

        {/* City */}
        {city && (
          <span
            className="text-micro w-full text-center border-t pt-1.5 mt-0.5"
            style={{ color: "var(--muted)", borderColor: "var(--line)" }}
          >
            {city}
          </span>
        )}
      </div>
    </>
  );
}
