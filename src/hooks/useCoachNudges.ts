// Coach nudges — the *push* half of the coach. Pull (open the tab) covers most
// of it, but the two moments worth interrupting for happen when you're NOT
// looking: a protected block you blew past, and a commitment that just dropped
// off and freed a window. This fires a quiet OS notification for exactly those
// two, while the app is open. Opt-in (localStorage) + a granted permission gate
// it; both default off, so it can never surprise.
//
// True closed-app push needs a service worker + push server — out of scope here
// (and SWs are banned in Tauri). This is the in-session companion.

import { useEffect, useRef, useState } from "react";
import type { BusyBlock, DayRead } from "../lib/now";
import type { Task } from "../lib/types";

const KEY = "nuvo.coach.nudges";
const canNotify = () => typeof Notification !== "undefined";
const clock = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export interface CoachNudges {
  supported: boolean;
  enabled: boolean;
  toggle: () => Promise<void>;
}

export function useCoachNudges(now: Date, busy: BusyBlock[], dayRead: DayRead, blocks: Task[]): CoachNudges {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(KEY) === "1" && canNotify() && Notification.permission === "granted"; } catch { return false; }
  });

  // Only react to transitions that happen *during this session* — never replay
  // the whole already-past day on first mount.
  const mountRef = useRef(now.getTime());
  const blownRef = useRef<Set<string>>(new Set());
  const prevEventKeys = useRef<Set<string> | null>(null);

  const toggle = async () => {
    if (enabled) {
      try { localStorage.setItem(KEY, "0"); } catch { /* ignore */ }
      setEnabled(false);
      return;
    }
    if (!canNotify()) return;
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm === "granted") {
      try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
      setEnabled(true);
    }
  };

  useEffect(() => {
    if (!enabled || !canNotify() || Notification.permission !== "granted") return;

    // (a) a protected / own block whose end passed this session, still not done
    for (const t of blocks) {
      if (!t.start_time || t.status === "done") continue;
      const end = new Date(t.start_time).getTime() + (t.duration_minutes ?? 30) * 60_000;
      if (end <= now.getTime() && end > mountRef.current && !blownRef.current.has(t.id)) {
        blownRef.current.add(t.id);
        const g = dayRead.gaps[0];
        const tail = g ? ` Next open block is ${clock(g.start)}.` : "";
        try { new Notification("That block just slipped", { body: `“${t.title}” passed and isn't done.${tail}`, tag: `blown-${t.id}` }); } catch { /* ignore */ }
      }
    }

    // (b) a commitment that dropped off since the last tick, freeing real room
    const keys = new Set(busy.filter((b) => b.kind === "event").map((b) => `${b.title}@${b.start.getTime()}`));
    const prev = prevEventKeys.current;
    if (prev && [...prev].some((k) => !keys.has(k)) && dayRead.openMins >= 60) {
      try { new Notification("Something just cleared", { body: `A meeting dropped off — you've got ${Math.round(dayRead.openMins / 60 * 10) / 10}h opening up. Want to claim it?`, tag: "freed" }); } catch { /* ignore */ }
    }
    prevEventKeys.current = keys;
  }, [now, busy, dayRead, blocks, enabled]);

  return { supported: canNotify(), enabled, toggle };
}
