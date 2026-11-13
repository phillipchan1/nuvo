// Plan the week, v2 — the rail half of the overlay (docs/plan-the-week-v2.md §4).
//
// The draft is drawn on the real Schedule (CalendarPane's `plan` prop); this rail
// replaces LeftRail while you plan and holds only what needs a decision. The law:
// decide, don't read — one row, one decision, a glyph for the cause, the reason
// in one line, and two buttons that SAY what they do (a bare ✓/✕ asked a question
// it never stated). The grid explains the rest. Everything that decides WHAT the week is stays in useWeekDraft — this
// file only lays it out and maps keys to its acts.

import WeekSetMoment from "./WeekSetMoment";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useWeekDraft, placementKey } from "../../hooks/useWeekDraft";
import type { Placement } from "../../lib/compose";
import { parseDateISO, planningWeekStartISO, toDateISO } from "../../lib/dates";
import { domainById, projectById, sprintMinsByDomain } from "../../lib/vertical";
import { resolveDomainId } from "../../lib/batch";
import { at, span } from "../mobile/dayPlan";
import { revealOnCalendar } from "../../lib/calendarReveal";
import { fmtMins } from "../../lib/now";
import type { PlanOverlay } from "./planOverlay";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import {
  describeRules,
  forget,
  loadMemory,
  proposals,
  saveMemory,
  type PlanMemory,
  type PlanSignal,
} from "../../lib/planMemory";
import { DIAL_NOTE, useDial } from "../../lib/planDial";
import type { DayContext } from "../../lib/compose";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const instant = (dayISO: string, min: number) => {
  const d = parseDateISO(dayISO);
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return d;
};
const dayName = (iso: string) => DAY[parseDateISO(iso).getDay()];
const where = (p: { dayISO: string; startMin: number; durationMin: number }) =>
  `${dayName(p.dayISO)} ${span(instant(p.dayISO, p.startMin), instant(p.dayISO, p.startMin + p.durationMin))}`;

/** "Nov 9–13" — the week a tab plans, by its dates (on a Saturday "This week" was next week). */
const weekLabel = (iso: string) => {
  const a = parseDateISO(iso);
  const b = new Date(a.getTime() + 4 * 86_400_000);
  const m = (d: Date) => d.toLocaleString("en-US", { month: "short" });
  return a.getMonth() === b.getMonth() ? `${m(a)} ${a.getDate()}–${b.getDate()}` : `${m(a)} ${a.getDate()} – ${m(b)} ${b.getDate()}`;
};
/** The composer's refusal, in words a person says. */
const plainReason = (r: string) =>
  r
    .replace(/^needs (\S+) unbroken — longest gap left is (\S+) \((\S+) open in total\)$/, "it needs $1 in one go, and the longest free stretch is $2")
    .replace(/^nothing left after its earlier part \((.+)\)$/, "its earlier part ends $1 and nothing is free after that");
/** The longest free stretch a refusal names, in minutes (null when it names none). */
const gapMins = (r: string): number | null => {
  const m = r.match(/longest gap left is (\d+(?:\.\d+)?)(h|m)/);
  return m ? Math.round(Number(m[1]) * (m[2] === "h" ? 60 : 1)) : null;
};

type StackItem = {
  id: string;
  glyph: string;
  cause: string;
  label: string;
  chip: string;
  why: string;
  /** what ✓ does, said on the button — never a bare tick */
  yesLabel: string;
  /** what ✕ does */
  noLabel: string;
  /** shown under the label without a click: the reason this needs you */
  sub?: string;
  /** a third act, when there is one (Pick a time · Shorten to fit) */
  extra?: { label: string; run: () => void }[];
  yes: () => string;
  /** "not now" for this row — default just dismisses it for this plan */
  no?: () => string;
  pips?: boolean[];
};

type RailProps = {
  onOverlay: (o: PlanOverlay | null) => void;
  onClose: () => void;
  railRef?: React.MutableRefObject<HTMLDivElement | null>;
};

/**
 * Which week. The kernel's answer is the default (planningWeekStartISO —
 * Saturday plans next week); you can name the other one. And a week whose open
 * time is already spent (a Friday evening) hands over to the next by itself once,
 * because "the rest of this week" is then nothing to plan.
 */
export default function PlanRail(props: RailProps) {
  const thisWeek = planningWeekStartISO();
  const nextWeek = toDateISO(new Date(parseDateISO(thisWeek).getTime() + 7 * 86_400_000));
  const [week, setWeek] = useState(thisWeek);
  const chose = useRef(false);
  // what the planner remembers — read once, written on every correction
  const [memory, setMemoryState] = useState<PlanMemory>(loadMemory);
  const setMemory = useCallback((f: (m: PlanMemory) => PlanMemory) => {
    setMemoryState((prev) => {
      const next = f(prev);
      saveMemory(next);
      return next;
    });
  }, []);
  return (
    <PlanRailWeek
      key={week}
      {...props}
      memory={memory}
      setMemory={setMemory}
      weekStartISO={week}
      weeks={{ thisWeek, nextWeek }}
      onWeek={(w, byHand) => {
        if (!byHand && chose.current) return;
        if (byHand) chose.current = true;
        setWeek(w);
      }}
    />
  );
}

function PlanRailWeek({
  onOverlay,
  onClose,
  railRef,
  weekStartISO,
  weeks,
  onWeek,
  memory,
  setMemory,
}: RailProps & {
  memory: PlanMemory;
  setMemory: (f: (m: PlanMemory) => PlanMemory) => void;
  weekStartISO: string;
  weeks: { thisWeek: string; nextWeek: string };
  onWeek: (w: string, byHand: boolean) => void;
}) {
  // Deterministic runs by kind of action — the AI theming is not run on arrival
  // here: "the groupings weren't good" is where trust broke (ⓟ, 2026-11-06).
  const d = useWeekDraft({ autoTheme: false, weekStartISO, rules: memory.rules });
  const [dial, setDial] = useDial();
  const record = useCallback(
    (sig: PlanSignal) => setMemory((m) => ({ ...m, signals: [...m.signals, { ...sig, at: new Date().toISOString() }] })),
    [setMemory],
  );
  /** A paint waiting for "this day or every weekday?" */
  const [paint, setPaint] = useState<{ dayISO: string; startMin: number; endMin: number } | null>(null);
  const [dayMenu, setDayMenu] = useState<string | null>(null);
  const [showKept, setShowKept] = useState(false);
  const { navigate } = useAppNavigation();
  const { data, placements, slotById } = d;

  const [sel, setSel] = useState<string | null>(null);
  /** The selected block's fits, frozen at selection: [where it was, ...others]. */
  const [altList, setAltList] = useState<Placement[]>([]);
  const [altIx, setAltIx] = useState(0);
  /** bumped when the selected block is re-placed by its length — re-reads its fits */
  const [altNonce, setAltNonce] = useState(0);
  /** a block with no time yet that you're placing by hand: its open gaps are shown */
  const [placing, setPlacing] = useState<{ id: string; name: string; mins: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [, setExpand] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState(0);
  const [done, setDone] = useState<{ things: number; blocks: number; secs: number; changes: number } | null>(null);
  const t0 = useRef(Date.now());

  // land on the week being planned
  useEffect(() => {
    revealOnCalendar({ dateISO: d.fromGate, scrollToTime: "07:30:00" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.fromGate]);

  const byKey = useMemo(() => new Map(placements.map((p) => [placementKey(p), p])), [placements]);
  const titleOf = useCallback((p: Placement) => slotById.get(p.task.id)?.name ?? p.task.title, [slotById]);
  const countOf = (p: Placement) => {
    const b = slotById.get(p.task.id);
    return b && !b.projectId && b.taskIds.length > 1 ? b.taskIds.length : 0;
  };
  /** What a group holds — the tasks themselves, so "Admin batch" says what it is. */
  const itemsOf = useCallback(
    (p: Placement): { id: string; title: string; mins: number }[] => {
      const b = slotById.get(p.task.id);
      if (!b) return [];
      return b.taskIds.map((id) => {
        const t = d.taskById.get(id);
        return { id, title: t?.title ?? "Untitled", mins: t?.duration_minutes ?? 30 };
      });
    },
    [slotById, d.taskById],
  );
  const colorOf = useCallback(
    (p: Placement): string | null => {
      const b = slotById.get(p.task.id);
      if (b?.color) return b.color;
      const proj = projectById(data, p.task.project_id ?? null);
      const dom = domainById(data, proj?.domainId ?? resolveDomainId(data, p.task));
      return dom?.color ?? null;
    },
    [slotById, data],
  );

  // freeze the alternatives when a block is selected
  useEffect(() => {
    if (!sel) {
      setAltList([]);
      return;
    }
    const p = byKey.get(sel);
    if (!p) {
      setSel(null);
      return;
    }
    setAltList([p, ...d.alternativesFor(sel)]);
    setAltIx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, altNonce]);

  const select = useCallback((key: string | null) => {
    setSel((cur) => (cur === key ? null : key));
    setFocus(null);
    setPlacing(null);
  }, []);

  const moveTo = useCallback(
    (key: string, dayISO: string, startMin: number) => {
      const from = byKey.get(key);
      d.remember();
      d.moveLocally(key, dayISO, startMin);
      setChanges((n) => n + 1);
      if (from)
        record({
          kind: "moved",
          week: weekStartISO,
          dayISO: from.dayISO,
          fromMin: from.startMin,
          toDayISO: dayISO,
          toMin: startMin,
          durationMin: from.durationMin,
          isRun: !slotById.get(from.task.id)?.projectId,
        });
    },
    [d, byKey, record, weekStartISO, slotById],
  );

  const pickAlt = useCallback(
    (ix: number) => {
      if (!sel || !altList.length) return;
      const n = altList.length;
      const i = ((ix % n) + n) % n;
      const a = altList[i];
      setAltIx(i);
      if (i === 0) {
        d.remember();
        d.unpinPlacement(sel);
        return;
      }
      moveTo(sel, a.dayISO, a.startMin);
    },
    [sel, altList, d, moveTo],
  );

  const shiftDay = useCallback(
    (delta: number) => {
      const p = sel ? byKey.get(sel) : null;
      if (!sel || !p) return;
      const target = toDateISO(new Date(parseDateISO(p.dayISO).getTime() + delta * 86_400_000));
      const fits = d.alternativesFor(sel, 14).filter((a) => a.dayISO === target);
      fits.sort((a, b) => Math.abs(a.startMin - p.startMin) - Math.abs(b.startMin - p.startMin));
      if (!fits.length) {
        toast(`No room on ${dayName(target)}`);
        return;
      }
      moveTo(sel, target, fits[0].startMin);
      setAltList([]);
    },
    [sel, byKey, d, moveTo],
  );

  // ── the stack: only what needs a yes or no ──────────────────────────────
  const inboxIds = useMemo(
    () => d.loosePool.filter((t) => t.status === "inbox" && !d.kept.has(t.id)).map((t) => t.id),
    [d.loosePool, d.kept],
  );
  const today = toDateISO(new Date());
  const noticed = useMemo(() => proposals(memory, weekStartISO, today), [memory, weekStartISO, today]);
  const stack = useMemo<StackItem[]>(() => {
    const out: StackItem[] = [];
    // what Nuvo noticed — at most three, each kept or forgotten
    for (const pr of noticed) {
      out.push({
        id: `noticed:${pr.id}`,
        glyph: "↻",
        cause: "noticed",
        label: pr.label,
        chip: pr.chip,
        why: pr.why,
        sub: pr.why,
        yesLabel: "Keep",
        noLabel: "Forget",
        pips: pr.pips,
        yes: () => {
          setMemory((m) => ({ ...m, rules: pr.apply(m.rules) }));
          return `Kept · ${pr.label}`;
        },
        no: () => {
          setMemory((m) => forget(m, pr.id, today));
          return "Forgotten for 8 weeks";
        },
      });
    }
    for (const u of d.result.unplaced) {
      const b = slotById.get(u.task.id);
      // splitting only helps when the refusal was about one long stretch, and a half fits
      const gap = gapMins(u.reason);
      const canSplit = (b?.taskIds.length ?? 0) >= 2 && gap != null && (b?.durationMins ?? 0) / 2 <= gap;
      out.push({
        id: `unplaced:${u.task.id}`,
        glyph: "⊘",
        cause: "didn't fit",
        label: b?.name ?? u.task.title,
        chip: "no time yet",
        why: u.reason,
        sub: `No time found — ${plainReason(u.reason)}`,
        extra: [
          { label: "Pick a time", run: () => {
            setSel(null);
            setFocus(null);
            setPlacing({ id: u.task.id, name: b?.name ?? u.task.title, mins: u.task.duration_minutes ?? b?.durationMins ?? 30 });
          } },
          ...(gap != null && gap >= 30
            ? [{ label: `Shorten to ${fmtMins(Math.floor(gap / 15) * 15)}`, run: () => {
                d.remember();
                d.setBlockLength(u.task.id, Math.floor(gap / 15) * 15);
                setChanges((n) => n + 1);
                toast(`Shortened to ${fmtMins(Math.floor(gap / 15) * 15)} — placing it`);
              } }]
            : []),
        ],
        yesLabel: canSplit ? "Split to fit" : "Skip this week",
        noLabel: canSplit ? "Skip this week" : "Leave it",
        yes: () => {
          d.remember();
          if (canSplit) {
            const r = d.splitBlock(u.task.id);
            record({ kind: "split", week: weekStartISO, durationMin: r.durationMin, isRun: r.isRun });
            return "Split in two — placing the halves";
          }
          d.dropBlock(u.task.id);
          return "Off this week";
        },
        no: canSplit
          ? () => {
              d.remember();
              d.dropBlock(u.task.id);
              return "Off this week";
            }
          : undefined,
      });
    }
    if (inboxIds.length) {
      out.push({
        id: "inbox",
        glyph: "⇣",
        cause: "new",
        label: `${inboxIds.length} inbox capture${inboxIds.length === 1 ? "" : "s"}`,
        chip: "not in the week",
        why: "Captures that aren't in the week yet. Each joins the run its verb matches (calls, replies, errands, writing) or its domain's.",
        sub: "Not in the week yet. Add them and each joins a run (calls, replies, errands, writing).",
        yesLabel: "Add to the week",
        noLabel: "Leave in inbox",
        yes: () => {
          d.remember();
          d.setKept((prev) => new Set([...prev, ...inboxIds]));
          return `${inboxIds.length} captures into runs`;
        },
      });
    }
    return out.filter((s) => !dismissed.has(s.id));
  }, [d, slotById, inboxIds, dismissed, noticed, setMemory, today, record, weekStartISO]);

  const decide = useCallback(
    (id: string, yes: boolean) => {
      const it = stack.find((s) => s.id === id);
      if (!it) return;
      const i = stack.indexOf(it);
      if (yes) {
        toast(`✓ ${it.yes()}`);
        setChanges((n) => n + 1);
      } else {
        setDismissed((prev) => new Set([...prev, id]));
        toast(`✕ ${it.no ? it.no() : "Not now"}`);
      }
      const rest = stack.filter((s) => s.id !== id);
      setFocus(rest.length ? rest[Math.min(i, rest.length - 1)].id : null);
      setExpand(null);
    },
    [stack],
  );

  // ── the slate: one pip per project the week is carrying ─────────────────
  const slate = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of d.suggestions) {
      const pid = s.task.projectId;
      if (!pid) continue;
      m.set(pid, [...(m.get(pid) ?? []), s.task.id]);
    }
    return [...m.entries()].map(([pid, ids]) => {
      const proj = projectById(data, pid);
      return {
        id: pid,
        name: proj?.name ?? "Project",
        color: domainById(data, proj?.domainId ?? null)?.color ?? "var(--accent)",
        ids,
        on: ids.some((id) => d.kept.has(id)),
      };
    });
  }, [d.suggestions, d.kept, data]);
  const [pipName, setPipName] = useState<string | null>(null);
  const togglePip = (p: (typeof slate)[number]) => {
    d.remember();
    d.setKept((prev) => {
      const next = new Set(prev);
      for (const id of p.ids) (p.on ? next.delete(id) : next.add(id));
      return next;
    });
    setChanges((n) => n + 1);
    setSel(null);
    toast(p.on ? `${p.name} off the week` : `${p.name} back on`);
  };

  // ── verdict ────────────────────────────────────────────────────────────
  const placedMins = placements.reduce((s, p) => s + p.durationMin, 0);
  // the composer's free time is what's left AFTER blocks you placed or froze
  // (they ride in as immovable time), so add them back for "how much was open"
  const pinnedMins = placedMins - d.result.placements.reduce((s, p) => s + p.durationMin, 0);
  const openMins = d.result.days.reduce((s, x) => s + x.freeMins, 0) + pinnedMins;
  const pct = openMins ? Math.round((placedMins / openMins) * 100) : 0;
  const unplacedN = d.result.unplaced.length;
  const tag = unplacedN ? `${unplacedN} without a time` : pct <= 75 ? "fits" : pct <= 90 ? "tight" : "over";
  const daysKnown = d.result.days.length > 0 || d.data.tasks.length > 0;
  useEffect(() => {
    if (weekStartISO === weeks.thisWeek && daysKnown && openMins < 60) onWeek(weeks.nextWeek, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMins, daysKnown]);
  const things = placements.reduce((n, p) => n + (slotById.get(p.task.id)?.taskIds.length ?? 1), 0);

  const commit = useCallback(async () => {
    if (d.applying || done) return;
    try {
      await d.commit();
      setDone({ things, blocks: placements.length, secs: Math.round((Date.now() - t0.current) / 1000), changes });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't commit the week");
    }
  }, [d, done, things, placements.length, changes]);

  // ── the walk: one group at a time, in the order the week runs ──────────
  // A whole week of proposals at once over a full calendar was unreadable (ⓟ,
  // 2026-11-09): you couldn't tell what a group held or where it landed. So the
  // plan walks its blocks one by one — the current one lifts, the calendar
  // scrolls to it, the rail lists what's inside — and you accept it (it's held
  // from then on), drag it, or take one of its other times.
  const order = useMemo(
    () => [...placements].sort((a, b) => a.dayISO.localeCompare(b.dayISO) || a.startMin - b.startMin).map(placementKey),
    [placements],
  );
  const reviewed = order.filter((k) => d.isHeld(k)).length;
  /** The next block that still needs a look, after `from` in time (wrapping). */
  const nextOpen = useCallback(
    (from: string | null): string | null => {
      const open = order.filter((k) => k !== from && !d.isHeld(k));
      if (!open.length) return null;
      const i = from ? order.indexOf(from) : -1;
      return open.find((k) => order.indexOf(k) > i) ?? open[0];
    },
    [order, d],
  );
  const advance = useCallback((from: string | null) => setSel(nextOpen(from)), [nextOpen]);
  const accept = useCallback(
    (key: string) => {
      if (!d.isHeld(key)) {
        d.remember();
        d.holdPlacement(key);
      }
      advance(key);
    },
    [d, advance],
  );
  // open on the first group, once the draft has one
  const walkStarted = useRef(false);
  useEffect(() => {
    if (walkStarted.current || done || !order.length) return;
    walkStarted.current = true;
    setSel(nextOpen(null));
  }, [order, done, nextOpen]);
  // take the calendar to the group under review
  const selDay = sel ? byKey.get(sel)?.dayISO : undefined;
  const selStart = sel ? byKey.get(sel)?.startMin : undefined;
  useEffect(() => {
    if (!selDay || selStart == null) return;
    const m = Math.max(0, selStart - 60);
    revealOnCalendar({ dateISO: selDay, scrollToTime: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00` });
    // when the walk moves on, or a new length sent it somewhere else — not every reflow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, altNonce]);

  // ── open time: every gap the selected (or being-placed) block could go into ─
  // "Show me all the slots available so I can put it in" (ⓟ, 2026-11-09). Drawn
  // on the grid in the claimable colour; a click puts the block there, cut to fit
  // when the gap is shorter.
  const needMins = placing ? placing.mins : sel ? byKey.get(sel)?.durationMin ?? null : null;
  const gaps = useMemo(() => {
    if (needMins == null || done) return [];
    const min = Math.min(30, needMins);
    return d.openGaps().filter((g) => g.endMin - g.startMin >= min);
    // re-read when the draft or the target changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needMins, sel, placing, placements, d.clearRegions, done]);
  const pickGap = useCallback(
    (i: number) => {
      const g = gaps[i];
      if (!g) return;
      const len = g.endMin - g.startMin;
      if (placing) {
        const mins = Math.min(len, placing.mins);
        d.remember();
        d.placeInGap(placing.id, g.dayISO, g.startMin, mins);
        setChanges((n) => n + 1);
        record({ kind: "moved", week: weekStartISO, dayISO: g.dayISO, fromMin: g.startMin, toDayISO: g.dayISO, toMin: g.startMin, durationMin: mins, isRun: !slotById.get(placing.id)?.projectId });
        toast(mins < placing.mins ? `Placed · shortened to ${fmtMins(mins)} to fit` : `Placed ${dayName(g.dayISO)} ${at(instant(g.dayISO, g.startMin))}`);
        setDismissed((prev) => new Set([...prev, `unplaced:${placing.id}`]));
        setSel(placing.id);
        setPlacing(null);
        return;
      }
      if (!sel) return;
      const p = byKey.get(sel);
      if (!p) return;
      // Nuvo's own pick inside this gap, if it has one — else the gap's start
      const alt = altList.slice(1).find((a) => a.dayISO === g.dayISO && a.startMin >= g.startMin && a.startMin + a.durationMin <= g.endMin);
      if (alt) return moveTo(sel, alt.dayISO, alt.startMin);
      if (len >= p.durationMin) return moveTo(sel, g.dayISO, g.startMin);
      const mins = Math.floor(len / 15) * 15;
      d.remember();
      d.placeInGap(sel, g.dayISO, g.startMin, mins);
      setChanges((n) => n + 1);
      setAltNonce((n) => n + 1);
      toast(`Shortened to ${fmtMins(mins)} to fit`);
    },
    [gaps, placing, sel, byKey, altList, d, moveTo, record, weekStartISO, slotById],
  );
  const setLength = useCallback(
    (key: string, mins: number) => {
      d.remember();
      d.setBlockLength(key, mins);
      setChanges((n) => n + 1);
      setAltNonce((n) => n + 1);
      toast(`${fmtMins(mins)} — Nuvo found it a place`);
    },
    [d],
  );

  // ── the overlay the Schedule draws ──────────────────────────────────────
  // It must change only when what it DRAWS changes. The overlay is handed up to
  // Planner as state, so an overlay rebuilt on every render re-renders Planner,
  // which re-renders this rail, which rebuilds it — a loop that kept the
  // Schedule reconciling the draft for as long as you planned (the acts below
  // close over `d`, a new object every render). So the acts go through a ref,
  // and "held" is read as a key string, not a function identity.
  const acts = useRef({ select, moveTo, pickAlt, pickGap, d });
  acts.current = { select, moveTo, pickAlt, pickGap, d };
  const heldSig = placements.map(placementKey).filter((k) => d.isHeld(k)).join("|");
  const overlay = useMemo<PlanOverlay | null>(() => {
    if (done) return null;
    const held = new Set(heldSig ? heldSig.split("|") : []);
    return {
      blocks: placements.map((p) => {
        const key = placementKey(p);
        return {
          key,
          title: titleOf(p),
          start: instant(p.dayISO, p.startMin).toISOString(),
          end: instant(p.dayISO, p.startMin + p.durationMin).toISOString(),
          color: colorOf(p),
          held: held.has(key),
          selected: key === sel,
          quiet: Boolean(sel) && key !== sel,
          count: countOf(p),
          items: itemsOf(p).map((t) => t.title),
        };
      }),
      ghosts: gaps.map((g, i) => {
        const len = g.endMin - g.startMin;
        const pick = altList.slice(1).findIndex((a) => a.dayISO === g.dayISO && a.startMin >= g.startMin && a.startMin + a.durationMin <= g.endMin);
        const short = needMins != null && len < needMins;
        return {
          id: `gap:${i}`,
          kind: "gap" as const,
          start: instant(g.dayISO, g.startMin).toISOString(),
          end: instant(g.dayISO, g.endMin).toISOString(),
          label: `${pick >= 0 ? `${pick + 1} · ` : ""}${fmtMins(len)} open${short ? " · fits shorter" : ""}`,
        };
      }),
      onSelect: (key) => acts.current.select(key),
      onMove: (key, start) => {
        acts.current.moveTo(key, toDateISO(start), start.getHours() * 60 + start.getMinutes());
        setSel(key);
      },
      onPickGhost: (id) => (id.startsWith("gap:") ? acts.current.pickGap(Number(id.slice(4))) : acts.current.pickAlt(Number(id))),
      onResize: (key, start, mins) => {
        const dr = acts.current.d;
        dr.remember();
        dr.placeInGap(key, toDateISO(start), start.getHours() * 60 + start.getMinutes(), mins);
        setChanges((n) => n + 1);
        setSel(key);
        setAltNonce((n) => n + 1);
      },
      dimCalendar: true,
      clears: d.clearRegions.map((c, i) => ({
        id: String(i),
        start: instant(c.dayISO, c.startMin).toISOString(),
        end: instant(c.dayISO, c.endMin).toISOString(),
        label: c.label,
      })),
      onPaint: (start, end) => {
        if (toDateISO(start) !== toDateISO(end) && end.getHours() + end.getMinutes() > 0) return;
        setSel(null);
        setPaint({
          dayISO: toDateISO(start),
          startMin: start.getHours() * 60 + start.getMinutes(),
          endMin: toDateISO(start) === toDateISO(end) ? end.getHours() * 60 + end.getMinutes() : 24 * 60,
        });
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, placements, sel, altList, titleOf, colorOf, itemsOf, gaps, needMins, heldSig, d.clearRegions]);
  useEffect(() => {
    onOverlay(overlay);
  }, [overlay, onOverlay]);
  useEffect(() => () => onOverlay(null), [onOverlay]);

  // ── block acts: hold · off · split — each a remembered correction ───────
  const act = useMemo(
    () => ({
      hold: (key: string) => {
        d.remember();
        if (d.isHeld(key)) {
          d.unpinPlacement(key);
          toast("Released");
        } else {
          d.holdPlacement(key);
          record({ kind: "held", week: weekStartISO });
          toast("Held · Nuvo won't move it");
        }
      },
      off: (key: string) => {
        const p = byKey.get(key);
        if (!p) return;
        d.remember();
        d.dropBlock(p.task.id);
        setChanges((n) => n + 1);
        record({ kind: "removed", week: weekStartISO, isRun: !slotById.get(p.task.id)?.projectId });
        toast("Off this week");
        setSel(null);
      },
      split: (key: string) => {
        d.remember();
        const r = d.splitBlock(key);
        if (!r.ok) {
          toast("One task — nothing to split");
          return;
        }
        setChanges((n) => n + 1);
        record({ kind: "split", week: weekStartISO, durationMin: r.durationMin, isRun: r.isRun });
        toast("Split in two");
        setSel(null);
      },
    }),
    [d, byKey, slotById, record, weekStartISO],
  );

  // ── keep clear: a drag across empty time, then "this day or every weekday?" ─
  const workingDayISOs = useMemo(
    () => d.planDays.filter((iso) => d.workingDays.includes(parseDateISO(iso).getDay())),
    [d.planDays, d.workingDays],
  );
  const keepClear = (every: boolean) => {
    if (!paint) return;
    d.remember();
    const days = every ? workingDayISOs : [paint.dayISO];
    d.addClear(days, paint.startMin, paint.endMin);
    record({
      kind: "cleared",
      week: weekStartISO,
      weekdays: days.map((iso) => parseDateISO(iso).getDay()),
      startMin: paint.startMin,
      endMin: paint.endMin,
    });
    setChanges((n) => n + 1);
    toast(every ? "Kept clear every working day" : "Kept clear");
    setPaint(null);
  };
  /** Lighten · Clear the afternoon · Day off · Normal — draft-only until commit. */
  const dayAct = (dayISO: string, a: "light" | "afternoon" | "off" | "normal") => {
    d.remember();
    if (a === "afternoon") d.addClear([dayISO], 13 * 60, Math.max(13 * 60 + 15, d.workEnd), "Afternoon cleared");
    else d.setDayContext(dayISO, a as DayContext);
    setChanges((n) => n + 1);
    setDayMenu(null);
    toast(a === "light" ? `${dayName(dayISO)} lightened` : a === "off" ? `${dayName(dayISO)} off` : a === "normal" ? `${dayName(dayISO)} back to normal` : `${dayName(dayISO)} afternoon cleared`);
  };

  // ── keys ───────────────────────────────────────────────────────────────
  const keyState = useRef({ sel, focus, stack, order, altIx });
  keyState.current = { sel, focus, stack, order, altIx };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.closest("input, textarea, [contenteditable=true]") || t.isContentEditable)) return;
      const k = e.key;
      const mod = e.metaKey || e.ctrlKey;
      const s = keyState.current;
      const eat = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod && k.toLowerCase() === "z") {
        eat();
        if (d.undo()) {
          setChanges((n) => Math.max(0, n - 1));
          setAltList([]);
          toast("Undone");
        }
        return;
      }
      if (mod && k === "Enter") {
        eat();
        void commit();
        return;
      }
      if (mod || e.altKey) return;
      if (k === "Escape") {
        setPlacing(null);
        if (s.sel || s.focus) {
          eat();
          setSel(null);
          setFocus(null);
          setExpand(null);
        }
        return;
      }
      if (k === "j" || k === "k") {
        if (!s.order.length) return;
        eat();
        const i = s.sel ? s.order.indexOf(s.sel) : -1;
        const n = k === "j" ? (i + 1) % s.order.length : i <= 0 ? s.order.length - 1 : i - 1;
        setSel(s.order[n]);
        setFocus(null);
        return;
      }
      if (k === "Tab" && s.stack.length) {
        eat();
        setSel(null);
        const ids = s.stack.map((x) => x.id);
        const i = s.focus ? ids.indexOf(s.focus) : -1;
        setFocus(ids[(i + (e.shiftKey ? ids.length - 1 : 1) + ids.length) % ids.length]);
        setExpand(null);
        return;
      }
      if (!s.sel && s.focus) {
        if (k === "y" || k === "Enter") return eat(), decide(s.focus, true);
        if (k === "n" || k === "Backspace") return eat(), decide(s.focus, false);
        if (k === "?") return eat(), setExpand((x) => (x ? null : s.focus));
      }
      if (!s.sel) return;
      if (k === "Enter" || k === "y") return eat(), accept(s.sel);
      if (k === "ArrowRight") return eat(), pickAlt(s.altIx + 1);
      if (k === "ArrowLeft") return eat(), pickAlt(s.altIx - 1);
      if (/^[1-5]$/.test(k)) return eat(), pickAlt(Number(k));
      if (k === "ArrowUp") return eat(), shiftDay(-1);
      if (k === "ArrowDown") return eat(), shiftDay(1);
      if (k === "h") return eat(), act.hold(s.sel);
      if (k === "x") return eat(), act.off(s.sel);
      if (k === "s") return eat(), act.split(s.sel);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, commit, decide, pickAlt, shiftDay, byKey, act, accept]);

  const selP = sel ? byKey.get(sel) : null;

  return (
    <div
      ref={railRef}
      data-plan-rail
      className="relative z-40 flex h-full w-[340px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-line px-4 pb-4 titlebar-pad"
    >
      <div className="flex items-baseline justify-between pt-3">
        <span className="flex items-center gap-1">
          {([[weekLabel(weeks.thisWeek), weeks.thisWeek], [weekLabel(weeks.nextWeek), weeks.nextWeek]] as const).map(([label, iso]) => (
            <button
              key={iso}
              onClick={() => iso !== weekStartISO && onWeek(iso, true)}
              className="rounded-full px-2 py-0.5 text-caption"
              style={{
                background: iso === weekStartISO ? "var(--accent-soft)" : undefined,
                color: iso === weekStartISO ? "var(--accent)" : "var(--muted)",
              }}
              aria-pressed={iso === weekStartISO}
            >
              {label}
            </button>
          ))}
        </span>
        <span className="flex items-center gap-3">
          {/* trial escape hatch: the v1 walk, while v2 is being tried */}
          <button
            className="text-caption text-muted hover:text-text"
            onClick={() => navigate({ flow: "sunday-walk", flowStep: 0 }, "replace")}
            title="Open the previous full-screen walk"
          >
            Old walk
          </button>
          <button className="text-caption text-muted hover:text-text" onClick={onClose} aria-label="Close the plan">
            Close
          </button>
        </span>
      </div>

      {done ? (
        // COMMIT (D-187) — the same moment the phone ends on: the week by
        // world, landing band by band, sealed by one accent line.
        <WeekSetMoment
          align="start"
          eyebrow="Committed"
          bands={sprintMinsByDomain(d.data).map((x) => ({ key: x.domain.id, label: x.domain.name, color: x.domain.color, mins: x.mins }))}
          facts={
            <>
              {done.things} things → {done.blocks} blocks ·{" "}
              {done.secs >= 60 ? `${Math.floor(done.secs / 60)}m ` : ""}
              {done.secs % 60}s · {done.changes} change{done.changes === 1 ? "" : "s"} by you
            </>
          }
          action={
            <button className="h-11 w-full rounded-[10px] bg-accent font-semibold text-on-accent" onClick={onClose}>
              Done
            </button>
          }
        />
      ) : (
        <>
          {/* verdict + slate */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="masthead text-[28px] leading-none">{Math.round(placedMins / 60)}h</span>
              <span className="text-caption text-muted">/ {Math.round(openMins / 60)}h open</span>
              <span
                className="rounded-full px-2 text-micro"
                style={{
                  background: tag === "over" || unplacedN ? "color-mix(in srgb, var(--signal) 14%, transparent)" : "var(--accent-soft)",
                  color: tag === "over" || unplacedN ? "var(--signal)" : "var(--accent)",
                }}
              >
                {tag}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            {slate.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1" onMouseLeave={() => setPipName(null)}>
                {slate.map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={p.on}
                    aria-label={p.name}
                    title={p.name}
                    onMouseEnter={() => setPipName(p.name)}
                    onClick={() => togglePip(p)}
                    className="h-4 w-4 rounded-full"
                    style={{ border: `2px solid ${p.color}`, background: p.on ? p.color : "transparent" }}
                  />
                ))}
                <span className="truncate text-caption text-muted">{pipName ?? "this week's projects"}</span>
              </div>
            )}
          </div>

          {/* the days — tap one for its acts (Lighten · Clear the afternoon · Day off) */}
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1">
              {workingDayISOs.map((iso) => {
                const ctx = d.dayContexts[iso];
                return (
                  <button
                    key={iso}
                    onClick={() => setDayMenu((x) => (x === iso ? null : iso))}
                    aria-expanded={dayMenu === iso}
                    className="flex-1 rounded-[8px] border py-1 text-caption"
                    style={{
                      borderColor: dayMenu === iso ? "var(--accent)" : "var(--line)",
                      color: ctx === "off" ? "var(--muted)" : undefined,
                      textDecoration: ctx === "off" ? "line-through" : undefined,
                    }}
                    title={ctx && ctx !== "normal" ? `${dayName(iso)} · ${ctx}` : dayName(iso)}
                  >
                    {dayName(iso)}
                    {ctx === "light" ? <span className="text-accent"> ◐</span> : null}
                  </button>
                );
              })}
            </div>
            {dayMenu && (
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["light", "Lighten"],
                    ["afternoon", "Clear afternoon"],
                    ["off", "Day off"],
                    ["normal", "Normal"],
                  ] as const
                ).map(([a, label]) => (
                  <button key={a} onClick={() => dayAct(dayMenu, a)} className="rounded-full border border-line-strong px-2.5 py-0.5 text-caption">
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {placing && (
            <div className="flex flex-col gap-2 rounded-[12px] border p-3" style={{ borderColor: "var(--slot)" }}>
              <div className="text-body">
                Pick a time for <b>{placing.name}</b>
              </div>
              <p className="text-caption text-muted">
                Every open stretch is shaded on the calendar ({gaps.length}). Click one — it goes there, shortened if the gap is smaller than {fmtMins(placing.mins)}.
              </p>
              <button onClick={() => setPlacing(null)} className="h-8 self-start rounded-[8px] border border-line-strong px-3 text-caption">
                Cancel
              </button>
            </div>
          )}
          {/* the walk — one group at a time */}
          {order.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="section-label flex justify-between">
                <span>{selP ? `Block ${order.indexOf(sel!) + 1} of ${order.length}` : "Nuvo's draft"}</span>
                <span className="mono">
                  {reviewed}/{order.length} accepted
                </span>
              </div>
              {/* one pip per block, in time order — filled once accepted; tap one to look at it */}
              <div className="flex flex-wrap gap-[3px]" role="group" aria-label="Blocks in the draft">
                {order.map((k) => {
                  const p = byKey.get(k)!;
                  const held = d.isHeld(k);
                  const hue = colorOf(p) ?? "var(--accent)";
                  return (
                    <button
                      key={k}
                      onClick={() => setSel(k)}
                      title={`${titleOf(p)} · ${where(p)}`}
                      aria-label={`${titleOf(p)}, ${where(p)}${held ? ", accepted" : ""}`}
                      aria-current={k === sel}
                      className="h-[10px] w-[10px] rounded-full"
                      style={{
                        background: held ? hue : "transparent",
                        border: `1.5px solid ${hue}`,
                        outline: k === sel ? "1.5px solid var(--text)" : undefined,
                        outlineOffset: 1.5,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {selP ? (
            (() => {
              const items = itemsOf(selP);
              const held = d.isHeld(sel!);
              return (
                <div className="glass-card flex flex-col gap-2 rounded-[12px] border border-line p-3">
                  <div className="masthead text-display leading-tight">{titleOf(selP)}</div>
                  <div className="text-caption text-muted">
                    {where(selP)}
                    {items.length > 1 ? ` · ${items.length} tasks` : ""}
                    {held ? " · accepted" : ""}
                  </div>
                  {items.length > 1 && (
                    <ul className="flex flex-col border-t border-line">
                      {items.map((t) => (
                        <li key={t.id} className="flex items-baseline gap-2 border-b border-line py-1.5">
                          <span className="min-w-0 flex-1 truncate text-body" title={t.title}>
                            {t.title}
                          </span>
                          <span className="mono shrink-0 text-micro text-muted">{t.mins}m</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="text-caption text-muted">{selP.reason}</div>
                  {/* how long — your estimate beats the sum of the tasks; Nuvo re-places it */}
                  <div className="flex flex-col gap-1">
                    <span className="text-micro text-muted">How long</span>
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Block length">
                      {[...new Set([15, 30, 45, 60, 90, 120, selP.durationMin])].sort((a, b) => a - b).map((m) => (
                        <button
                          key={m}
                          aria-pressed={m === selP.durationMin}
                          onClick={() => m !== selP.durationMin && setLength(sel!, m)}
                          className="mono rounded-full border px-2 py-0.5 text-micro"
                          style={{
                            borderColor: m === selP.durationMin ? "var(--accent)" : "var(--line-strong)",
                            color: m === selP.durationMin ? "var(--accent)" : undefined,
                            background: m === selP.durationMin ? "var(--accent-soft)" : undefined,
                          }}
                        >
                          {fmtMins(m)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    <button
                      onClick={() => accept(sel!)}
                      className="h-9 flex-1 rounded-[9px] bg-accent px-3 text-caption font-semibold text-on-accent"
                    >
                      {held ? "Keep · next" : "Looks good"} <span className="opacity-75">↵</span>
                    </button>
                    <button onClick={() => advance(sel)} className="h-9 rounded-[9px] border border-line-strong px-3 text-caption">
                      Later <kbd className="mono text-micro text-muted">J</kbd>
                    </button>
                  </div>
                  {altList.length > 1 && (
                    <div className="flex flex-col gap-1 pt-1">
                      <span className="text-micro text-muted">Nuvo's other picks (numbered in the open time)</span>
                      <div className="flex flex-wrap gap-1.5">
                        {altList.map((a, i) => (
                          <button
                            key={i}
                            onClick={() => pickAlt(i)}
                            className="rounded-full border px-2.5 py-0.5 text-caption"
                            style={{
                              borderColor: i === altIx ? "var(--accent)" : "var(--line-strong)",
                              color: i === altIx ? "var(--accent)" : undefined,
                            }}
                          >
                            <span className="mono mr-1 text-micro text-muted">{i === 0 ? "·" : i}</span>
                            {dayName(a.dayISO)} {at(instant(a.dayISO, a.startMin))}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ...(held ? ([["H", "Release", () => act.hold(sel!)]] as const) : []),
                        ["S", "Split", () => act.split(sel!)],
                        ["X", "Off this week", () => act.off(sel!)],
                      ] as const
                    ).map(([key, label, run]) => (
                      <button key={key} className="rounded-full border border-line px-2.5 py-0.5 text-caption text-muted" onClick={run}>
                        {label} <kbd className="mono text-micro">{key}</kbd>
                      </button>
                    ))}
                  </div>
                  <p className="text-micro text-muted">
                    Click any shaded open time to put it there — it shortens to fit. Or drag it, or pull its edge to change the length.
                  </p>
                </div>
              );
            })()
          ) : order.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
              {reviewed >= order.length ? (
                <p className="text-body">All {order.length} blocks accepted. Settle anything below, then Commit.</p>
              ) : (
                <>
                  <p className="text-body">
                    {order.length - reviewed} block{order.length - reviewed === 1 ? "" : "s"} still to look at.
                  </p>
                  <button onClick={() => advance(null)} className="h-9 rounded-[9px] bg-accent px-3 text-caption font-semibold text-on-accent">
                    Review the next one
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className="text-caption text-muted">Nothing to place this week yet.</p>
          )}

          {/* the stack */}
          <div className="flex flex-col">
            <div className="section-label flex justify-between">
              <span>To settle</span>
              <span className="mono">{stack.length || "✓"}</span>
            </div>
            {paint && (
              <div className="-mx-1.5 flex min-h-[44px] items-center gap-1.5 rounded-[8px] border-b border-line px-1.5" style={{ background: "var(--accent-soft)" }}>
                <span className="w-[18px] shrink-0 text-center text-accent">▨</span>
                <span className="min-w-0 flex-1 truncate text-body">
                  Keep {dayName(paint.dayISO)} {span(instant(paint.dayISO, paint.startMin), instant(paint.dayISO, paint.endMin))} clear
                </span>
                <button onClick={() => keepClear(false)} className="rounded-full border border-line-strong px-2 text-micro">
                  {dayName(paint.dayISO)}
                </button>
                <button onClick={() => keepClear(true)} className="rounded-full bg-accent px-2 text-micro text-on-accent">
                  Every day
                </button>
                <button aria-label="Cancel" onClick={() => setPaint(null)} className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[8px] border border-line-strong">
                  ✕
                </button>
              </div>
            )}
            {stack.length === 0 && !paint && <p className="py-1 text-caption text-muted">Nothing needs you.</p>}
            {stack.map((it) => (
              <div
                key={it.id}
                className="-mx-1.5 flex flex-col gap-1.5 rounded-[8px] border-b border-line px-1.5 py-2"
                style={{ background: focus === it.id ? "var(--accent-soft)" : undefined }}
                onMouseEnter={() => !sel && setFocus(it.id)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-[18px] shrink-0 text-center text-accent" title={it.cause}>
                    {it.glyph}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body" title={it.label}>
                    {it.label}
                  </span>
                  {it.pips && (
                    <span className="flex shrink-0 gap-[2px]" aria-label={`${it.pips.filter(Boolean).length} of ${it.pips.length} weeks`}>
                      {it.pips.map((on, i) => (
                        <i key={i} className="block h-[5px] w-[5px] rounded-full" style={{ background: on ? "var(--text)" : "var(--line-strong)" }} />
                      ))}
                    </span>
                  )}
                </div>
                {it.sub && <p className="pl-[24px] text-caption text-muted">{it.sub}</p>}
                <div className="flex gap-1.5 pl-[24px]">
                  <button onClick={() => decide(it.id, true)} className="h-[30px] rounded-[8px] bg-accent px-3 text-caption font-semibold text-on-accent">
                    {it.yesLabel}
                  </button>
                  <button onClick={() => decide(it.id, false)} className="h-[30px] rounded-[8px] border border-line-strong px-3 text-caption">
                    {it.noLabel}
                  </button>
                </div>
                {it.extra && it.extra.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pl-[24px]">
                    {it.extra.map((x) => (
                      <button key={x.label} onClick={x.run} className="h-[30px] rounded-[8px] border border-line-strong px-3 text-caption">
                        {x.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
            {(() => {
              const kept = describeRules(memory.rules);
              if (!kept.length) return null;
              return (
                <div className="flex flex-col">
                  <button className="section-label flex justify-between text-left" onClick={() => setShowKept((x) => !x)} aria-expanded={showKept}>
                    <span>Nuvo keeps</span>
                    <span className="mono">{kept.length}</span>
                  </button>
                  {showKept &&
                    kept.map((r) => (
                      <div key={r.id} className="flex items-center justify-between border-b border-line py-1 text-caption">
                        <span>{r.text}</span>
                        <button
                          className="text-micro text-muted hover:text-text"
                          onClick={() => setMemory((m) => ({ ...m, rules: r.remove(m.rules) }))}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                </div>
              );
            })()}
            <div className="flex flex-col gap-1">
              <span className="section-label">During the week</span>
              <div className="flex gap-0.5 rounded-[9px] border border-line p-0.5" role="group" aria-label="How much Nuvo moves">
                {(["ask", "suggest", "handle"] as const).map((v) => (
                  <button
                    key={v}
                    aria-pressed={dial === v}
                    onClick={() => setDial(v)}
                    className="flex-1 rounded-[7px] py-1 text-caption capitalize"
                    style={{ background: dial === v ? "var(--accent-soft)" : undefined, color: dial === v ? "var(--accent)" : "var(--muted)" }}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <span className="text-micro text-muted">{DIAL_NOTE[dial]}</span>
            </div>
            <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-micro text-muted">
              <span>↻ noticed</span>
              <span>⊘ no room</span>
              <span>⇣ new</span>
              <span>↵ accept · J/K block · ←→ fits · ↑↓ day · H hold · S split · X off · ⌘Z undo · drag empty time to keep it clear</span>
            </div>
            <button
              className="h-11 rounded-[10px] bg-accent font-semibold text-on-accent disabled:opacity-60"
              onClick={() => void commit()}
              disabled={d.applying || placements.length === 0}
            >
              {d.applying ? "Committing…" : `Commit ${things} things`} <span className="opacity-75">⌘↵</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
