// Moments — the top of the finish ladder (D-237, on D-209 / D-230 / D-231).
//
// The ladder's lower rungs finish IN PLACE, where you were working: a tick
// lands, a dial closes, the day's ring closes on the rail with its sparks and
// "Done at 3pm" (DayCrown; the phone's crown says the same). Those stay.
//
// Above the day, in place was too small for what it meant: a week's slate, a
// project you carried for six weeks, an initiative you carried for a quarter
// all finished at the size of a row. So the three upper rungs also get a
// STATEMENT — an ink plate over the app, louder by rung:
//
//   WEEK        a plate · "Week landed." · the week's finish ring closes
//   PROJECT     a wider plate · its ring closes and the Seal lands on it
//   INITIATIVE  the whole stage · its ring closes, the Seal, its projects' rings
//
// Every ring is the app's own (FinishRing, ProgressRing) and every motion is
// lib/celebrate's — the plate is where they play at the size the finish earned.
//
// This file owns the RULE (when a rung was reached, and that your own hand
// reached it) and the bus the plates play through. The drawing is
// components/moment/MomentLayer.tsx.
//
// Two laws, D-187's, held for the bigger act:
//   · ONLY WHAT YOU DID. `noteOwnAct` is stamped at the UI's write sites; a
//     rung plays only inside its window. An echo, the assistant, a reload: still.
//   · NO ECONOMY. A plate names what you finished and draws its pieces. No count
//     of acts, no streak, no comparison with a past you (N-04, D-203).

export type MomentPiece = {
  key: string;
  label: string;
  /** a domain hue — identity */
  color: string;
  /** landed / shipped; one that didn't is drawn as far as it got (P7) */
  done: boolean;
  /** 0..100 — how far its ring had got before this act (the ring closes from here) */
  pct: number;
};

export type Moment =
  | {
      kind: "week";
      weekLabel: string;
      /** the slate before this act — how many had landed, of how many */
      before: number;
      of: number;
      pieces: MomentPiece[];
    }
  | {
      kind: "project";
      id: string;
      name: string;
      domain: { name: string; color: string } | null;
      /** its work, done of total, and how much was done before this act (0..1) */
      done: number;
      of: number;
      from: number;
      /** "started Oct 3 · 6 weeks" — a fact about the work, never a comparison */
      fact: string | null;
    }
  | {
      kind: "initiative";
      id: string;
      name: string;
      domain: { name: string; color: string } | null;
      pieces: MomentPiece[];
      fact: string | null;
    };

export type MomentKind = Moment["kind"];

/** Low to high. One act that reaches several rungs plays only the highest. */
export const RUNG: Record<MomentKind, number> = { week: 1, project: 2, initiative: 3 };

// ── the user's own hand ──────────────────────────────────────────────────────
// TaskRow waits --d-task-complete before it writes and the optimistic patch
// lands at once; a few seconds covers that without letting an unrelated echo
// a minute later borrow the act.
const OWN_ACT_MS = 2500;
let lastOwnAct = 0;

/** Stamped by every UI write that can finish something: a task ticked, a
 *  project or initiative marked complete. Never by a sync, never by the agent. */
export function noteOwnAct(): void {
  lastOwnAct = Date.now();
}

export function ownActRecent(now = Date.now()): boolean {
  return now - lastOwnAct < OWN_ACT_MS;
}

/** Test seam. */
export function resetOwnAct(): void {
  lastOwnAct = 0;
}

// ── the rungs, as pure reads ────────────────────────────────────────────────

/** The week is landed: it had committed projects and every one has a verdict. */
export function weekLanded(landed: number, total: number): boolean {
  return total > 0 && landed >= total;
}

/** Ids that moved into `complete` between two reads. A first read (no `prev`)
 *  seeds and reports nothing, and a row new since the last read doesn't count
 *  — data arriving is not a finish. */
export function newlyComplete(
  prev: ReadonlyMap<string, string> | null,
  next: ReadonlyArray<{ id: string; status: string }>,
): string[] {
  if (!prev) return [];
  return next.filter((r) => r.status === "complete" && prev.has(r.id) && prev.get(r.id) !== "complete").map((r) => r.id);
}

// ── the bus ─────────────────────────────────────────────────────────────────
type Listener = (m: Moment) => void;
const listeners = new Set<Listener>();
let stages = 0;

export function playMoment(m: Moment): void {
  listeners.forEach((l) => l(m));
}

export function onMoment(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** A stage is mounted and will draw the upper rungs. While one is, the Seal
 *  (lib/celebrate) lands on the plate instead of under it — one stamp, not two. */
export function mountStage(): () => void {
  stages++;
  return () => {
    stages--;
  };
}

export function stageMounted(): boolean {
  return stages > 0;
}
