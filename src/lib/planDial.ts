// How much Nuvo moves — the dial (docs/plan-the-week-v2.md §7).
//
//   ask     — nothing stages; "Re-plan the rest of the week" is there when you want it
//   suggest — repairs stage as ghosts; nothing moves without your ✓ (the default)
//   handle  — repairs to flexible blocks apply, each with an Undo.
//             **Q-14 is open**: this overturns part of N-01 and ships only on trial.
//
// TRIAL STORAGE: this device's localStorage, like the plan's memory (planMemory.ts).

import { useEffect, useState } from "react";

export type Dial = "ask" | "suggest" | "handle";
const KEY = "nuvo.planDial.v1";
const EVT = "nuvo:plan-dial";

export function readDial(): Dial {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "ask" || v === "suggest" || v === "handle") return v;
  } catch {
    /* default below */
  }
  return "suggest";
}

export function writeDial(d: Dial) {
  try {
    localStorage.setItem(KEY, d);
  } catch {
    /* the dial still changes for this session */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: d }));
}

/** The dial, kept in sync across every surface that shows it. */
export function useDial(): [Dial, (d: Dial) => void] {
  const [dial, setDial] = useState<Dial>(readDial);
  useEffect(() => {
    const on = (e: Event) => setDial((e as CustomEvent<Dial>).detail);
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return [dial, writeDial];
}

export const DIAL_NOTE: Record<Dial, string> = {
  ask: "Nothing moves until you ask.",
  suggest: "Repairs wait for ✓.",
  handle: "Repairs apply, each with Undo. Trial — Q-14 is open.",
};
