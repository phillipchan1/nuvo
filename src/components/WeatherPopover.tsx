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

      {/* The kit popover, growing down from the day it belongs to. */}
      <div
        ref={cardRef}
        role="dialog"
        aria-label={`Weather — ${wmoLabel(day.wmo)}`}
        className="k-pop"
        style={{ top: anchor.y + 6, left, minWidth: cardW, padding: 0, zIndex: 50, ["--pop-origin" as string]: "top center" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="k-weather">
          <WeatherIcon wmo={day.wmo} size={32} />
          <div className="k-weather-temp">
            <b>{day.tempHigh}°</b>
            <span>/ {day.tempLow}°</span>
          </div>
          <span className="k-weather-what">{wmoLabel(day.wmo)}</span>
          {city && <span className="k-weather-city">{city}</span>}
        </div>
      </div>
    </>
  );
}
