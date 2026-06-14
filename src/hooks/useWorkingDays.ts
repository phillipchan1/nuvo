import { useEffect, useState } from "react";

const KEY = "nuvo-working-days";
export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri

const read = (): number[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as number[];
  } catch { /* ignore */ }
  return DEFAULT_WORKING_DAYS;
};

/** Which weekdays you work (0=Sun…6=Sat) — a recurring boundary, kept local to
 *  the device for now (a follow-up promotes it to the settings row). The single
 *  source of truth shared by the Sunday ritual (where you set it) and the Now
 *  view (which has to honor it — a Saturday is not a gap to fill). */
export function useWorkingDays(): [number[], (d: number[]) => void] {
  const [days, setDays] = useState<number[]>(read);
  // pick up a change made in another tab/window so Now and the ritual agree
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setDays(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const set = (d: number[]) => {
    setDays(d);
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ }
  };
  return [days, set];
}

/** Is `date` a day you actually work? (Honors your working-day boundary.) */
export const isWorkingDay = (workingDays: number[], date: Date): boolean =>
  workingDays.includes(date.getDay());
