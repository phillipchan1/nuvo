// The domain's sigil — a living, GENERATED mark, kin to the week's emblem
// (weekEmblem.ts). Same doctrine, applied to a fixture instead of a week:
//
//   1. It is a PURE function of a tiny spec derived from the domain's own
//      showing up data — no hooks, no fetching, no Math.random / Date.now
//      beyond a seeded jitter — so a domain redraws pixel-identically forever.
//   2. It is drawn ONLY from the domain color (identity) + neutral theme tokens
//      (--line / --muted), so it flips across every theme with no per-theme art.
//   3. The picture IS the data: the 13-week pulse becomes the mark's density and
//      warmth; a tended domain glows, a quiet one cools to a cold ember.
//
// The `form` is the one thing the user configures — the generative grammar the
// sigil takes (orbit · bloom · strata · thread). The data stays true; the form
// is a stable choice for that fixture. Persisted per-domain in localStorage for
// now (see domainForm / setDomainForm) so it needs no schema change; swapping to
// a `form` column later is a one-line change in useVertical.

import { showingUp, type Domain } from "./vertical";

export const SIGIL_FORMS = ["orbit", "bloom", "strata", "thread"] as const;
export type SigilForm = (typeof SIGIL_FORMS)[number];
export const DEFAULT_SIGIL_FORM: SigilForm = "orbit";

export const SIGIL_FORM_LABEL: Record<SigilForm, string> = {
  orbit: "Orbit",
  bloom: "Bloom",
  strata: "Strata",
  thread: "Thread",
};

export const SIGIL_FORM_BLURB: Record<SigilForm, string> = {
  orbit: "A lit core, the pulse as orbiting weeks — kin to the week emblem.",
  bloom: "Thirteen spokes, each week's hours its length — rhythm you can feel.",
  strata: "Weeks as sediment layers — the long arc, accreted.",
  thread: "A constellation of showing-up, linked into one line.",
};

/** ~18 numbers, all derived from the domain. The sigil is a pure function of this. */
export interface SigilSpec {
  form: SigilForm;
  /** the domain's semantic color (identity). */
  color: string;
  /** invested hours per week, oldest → now (13). */
  weeks: number[];
  /** the weekly intent — the faint target reference. */
  target: number;
  /** tended recently? a warm mark vs a cold ember. */
  lit: boolean;
  /** deterministic per-domain jitter seed (never random). */
  seed: number;
}

/** FNV-1a — the same stable seed hash the week emblem uses. */
export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Build the sigil spec from a live domain + its chosen form. Pure. */
export function domainSigilSpec(dom: Domain, form: SigilForm): SigilSpec {
  return {
    form,
    color: dom.color,
    weeks: dom.weeks.length === 13 ? dom.weeks : new Array(13).fill(0),
    target: dom.weeklyTargetHours,
    lit: showingUp(dom).lit,
    seed: seedFromString(dom.id || dom.name),
  };
}

// ── Per-domain form choice — persisted client-side (no schema change) ─────────
const LS_KEY = "nuvo:domainForms";

function readForms(): Record<string, SigilForm> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    const out: Record<string, SigilForm> = {};
    for (const [id, f] of Object.entries(parsed)) {
      if ((SIGIL_FORMS as readonly string[]).includes(f)) out[id] = f as SigilForm;
    }
    return out;
  } catch {
    return {};
  }
}

/** The form a domain wears — its stored choice, else the default. */
export function domainForm(domainId: string): SigilForm {
  return readForms()[domainId] ?? DEFAULT_SIGIL_FORM;
}

/** Persist a domain's form choice. Stable for that fixture. */
export function setDomainForm(domainId: string, form: SigilForm): void {
  try {
    const all = readForms();
    all[domainId] = form;
    if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* localStorage unavailable — form falls back to the default, no crash. */
  }
}
