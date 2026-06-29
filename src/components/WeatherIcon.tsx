// SVG weather icons keyed by WMO weather code.
// Paths derived from Lucide icon set (ISC license).
// Colors use existing design tokens:
//   sun rays  → --signal  (warm ember)
//   cloud     → --muted
//   rain/snow → --slot    (teal)

interface Props {
  wmo: number;
  size?: number;
  className?: string;
}

type IconType = "sunny" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "showers" | "snowShowers" | "thunder";

function wmoToType(wmo: number): IconType {
  if (wmo === 0) return "sunny";
  if (wmo <= 2) return "partly";
  if (wmo === 3) return "cloudy";
  if (wmo <= 48) return "fog";
  if (wmo <= 57) return "drizzle";
  if (wmo <= 67) return "rain";
  if (wmo <= 77) return "snow";
  if (wmo <= 82) return "showers";
  if (wmo <= 86) return "snowShowers";
  return "thunder";
}

const sun = "var(--signal)";
const cloud = "var(--muted)";
const precip = "var(--slot)";

// Shared cloud path (Lucide cloud-rain / cloud-snow style) — leaves room for precipitation below
const CLOUD_PATH = "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242";

export default function WeatherIcon({ wmo, size = 16, className = "" }: Props) {
  const type = wmoToType(wmo);
  const base = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    strokeWidth: "1.5",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };

  switch (type) {
    case "sunny":
      return (
        <svg {...base}>
          <circle cx="12" cy="12" r="4" stroke={sun} />
          <path
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
            stroke={sun}
          />
        </svg>
      );

    case "partly":
      // Sun top-right, cloud lower-left (Lucide cloud-sun style)
      return (
        <svg {...base}>
          <path d="M12 2v2" stroke={sun} />
          <path d="m4.93 4.93 1.41 1.41" stroke={sun} />
          <path d="M20 12h2" stroke={sun} />
          <path d="m17.07 4.93-1.41 1.41" stroke={sun} />
          <path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" stroke={sun} />
          <path d="M10.5 8.5a2.5 2.5 0 0 1 5 0" stroke={sun} />
          <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6z" stroke={cloud} />
        </svg>
      );

    case "cloudy":
      return (
        <svg {...base}>
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" stroke={cloud} />
        </svg>
      );

    case "fog":
      // Three horizontal lines (Lucide wind style)
      return (
        <svg {...base}>
          <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" stroke={cloud} />
          <path d="M9.6 4.6A2 2 0 1 1 11 8H2" stroke={cloud} />
          <path d="M12.6 19.4A2 2 0 1 0 14 16H2" stroke={cloud} />
        </svg>
      );

    case "drizzle":
      return (
        <svg {...base}>
          <path d={CLOUD_PATH} stroke={cloud} />
          <path d="M8 19v1M8 14v1M12 19v1M12 14v1M16 19v1M16 14v1" stroke={precip} />
        </svg>
      );

    case "rain":
    case "showers":
      return (
        <svg {...base}>
          <path d={CLOUD_PATH} stroke={cloud} />
          <path d="M16 14v6M8 14v6M12 16v6" stroke={precip} />
        </svg>
      );

    case "snow":
    case "snowShowers":
      return (
        <svg {...base}>
          <path d={CLOUD_PATH} stroke={cloud} />
          <path d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01" stroke={precip} strokeWidth="2.5" />
        </svg>
      );

    case "thunder":
      return (
        <svg {...base}>
          <path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973" stroke={cloud} />
          <polyline points="13 12 9 17 14 17 10 22" stroke={sun} />
        </svg>
      );
  }
}
