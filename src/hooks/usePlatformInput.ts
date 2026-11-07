// What is the user holding? Detected by INPUT CAPABILITY, never by user agent
// alone: a touchscreen laptop has a fine pointer AND touch, an iPad with a
// trackpad hovers. `useIsMobile()` decides the LAYOUT (width); this decides the
// INTERACTION (cursor vs finger, hover vs none, ⌘ vs Ctrl).

import { useEffect, useState } from "react";
import { isMac } from "../lib/platform";

export interface PlatformInput {
  /** Primary pointer is a mouse/trackpad. */
  finePointer: boolean;
  /** Primary pointer is a finger. */
  coarsePointer: boolean;
  /** The primary pointer can hover (affordances may wait for hover). */
  canHover: boolean;
  /** ANY pointer is coarse — a touchscreen laptop. Touch paths must exist. */
  anyCoarse: boolean;
  /** ⌘/⌥/⇧ glyphs vs Ctrl/Alt/Shift words. */
  mac: boolean;
}

const Q = {
  fine: "(pointer: fine)",
  coarse: "(pointer: coarse)",
  hover: "(hover: hover)",
  anyCoarse: "(any-pointer: coarse)",
} as const;

function mq(q: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(q).matches;
}

export function readPlatformInput(): PlatformInput {
  return {
    finePointer: mq(Q.fine),
    coarsePointer: mq(Q.coarse),
    canHover: mq(Q.hover),
    anyCoarse: mq(Q.anyCoarse),
    mac: isMac(),
  };
}

export function usePlatformInput(): PlatformInput {
  const [state, setState] = useState(readPlatformInput);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const lists = Object.values(Q).map((q) => window.matchMedia(q));
    const on = () => setState(readPlatformInput());
    lists.forEach((l) => l.addEventListener?.("change", on));
    return () => lists.forEach((l) => l.removeEventListener?.("change", on));
  }, []);
  return state;
}
