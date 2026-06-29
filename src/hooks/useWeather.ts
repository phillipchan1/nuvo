import { useQuery } from "@tanstack/react-query";

export interface WeatherDay {
  date: string; // YYYY-MM-DD
  wmo: number;
  tempHigh: number;
  tempLow: number;
}

export interface WeatherResult {
  days: WeatherDay[];
  city?: string;
}

const GEO_KEY = "nuvo.geo";
const GEO_TTL = 86_400_000; // 24h

interface GeoCache {
  lat: number;
  lon: number;
  city?: string;
  ts: number;
}

async function getLocation(): Promise<GeoCache> {
  // 1 — fresh cache
  try {
    const s = localStorage.getItem(GEO_KEY);
    if (s) {
      const c: GeoCache = JSON.parse(s);
      if (Date.now() - c.ts < GEO_TTL) return c;
    }
  } catch { /* ignore */ }

  // 2 — browser geolocation (may be denied, especially in Tauri)
  const fromBrowser = await new Promise<{ lat: number; lon: number } | null>((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lon: coords.longitude }),
      () => resolve(null),
      { maximumAge: GEO_TTL, timeout: 5000 },
    );
  });

  if (fromBrowser) {
    let city: string | undefined;
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${fromBrowser.lat}&lon=${fromBrowser.lon}&format=json`,
        { headers: { "Accept-Language": "en" } },
      );
      const j = await r.json();
      city = j.address?.city || j.address?.town || j.address?.village || j.address?.county;
    } catch { /* city optional */ }
    const result: GeoCache = { ...fromBrowser, city, ts: Date.now() };
    try { localStorage.setItem(GEO_KEY, JSON.stringify(result)); } catch { /* ignore */ }
    return result;
  }

  // 3 — IP fallback (works in Tauri and when location is denied)
  const r = await fetch("https://ipapi.co/json/");
  if (!r.ok) throw new Error("no-location");
  const j = await r.json();
  const result: GeoCache = {
    lat: j.latitude as number,
    lon: j.longitude as number,
    city: j.city as string | undefined,
    ts: Date.now(),
  };
  try { localStorage.setItem(GEO_KEY, JSON.stringify(result)); } catch { /* ignore */ }
  return result;
}

function localeUsesFahrenheit() {
  return /^en-US/i.test(navigator.language);
}

async function fetchForecast(): Promise<WeatherResult> {
  const { lat, lon, city } = await getLocation();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fahrenheit = localeUsesFahrenheit();
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: "weathercode,temperature_2m_max,temperature_2m_min",
    timezone: tz,
    forecast_days: "8",
  });
  if (fahrenheit) params.set("temperature_unit", "fahrenheit");

  const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!r.ok) throw new Error("weather-fetch-failed");
  const j = await r.json();

  const days: WeatherDay[] = (j.daily.time as string[]).map((date: string, i: number) => ({
    date,
    wmo: j.daily.weathercode[i] as number,
    tempHigh: Math.round(j.daily.temperature_2m_max[i] as number),
    tempLow: Math.round(j.daily.temperature_2m_min[i] as number),
  }));

  return { days, city };
}

export function useWeather(enabled = true) {
  return useQuery<WeatherResult>({
    queryKey: ["weather"],
    queryFn: fetchForecast,
    enabled,
    staleTime: 3_600_000, // 1h
    gcTime: 7_200_000,
    retry: 1,
  });
}

/** Build a YYYY-MM-DD → WeatherDay map for O(1) lookup. */
export function indexWeather(days: WeatherDay[] | undefined): Map<string, WeatherDay> {
  const m = new Map<string, WeatherDay>();
  days?.forEach((d) => m.set(d.date, d));
  return m;
}
