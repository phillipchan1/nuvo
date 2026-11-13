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
import {
  Button,
  Card,
  Chip,
  ChipButton,
  Dot,
  EmptyState,
  IconButton,
  Kbd,
  Menu,
  MenuItem,
  MenuLabel,
  Row,
  SectionHeader,
  Segmented,
} from "../kit";
import { Icon } from "../Icon";
import type { MemoryApi } from "../memory/MemoryPanel";
import { FlowHead, FlowMeter } from "../rituals/FlowShell";

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
  /** Memory, when the host has it (docs/memory.md §4.5) — its sure
   *  observations join What I noticed. Omitted = the planner's own only. */
  learned?: MemoryApi | null;
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
  learned,
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
  // Memory's sure observations join the planner's own (docs/memory.md §4.5):
  // hours first (they change every number below them), then open windows,
  // habits and chores — three noticed things at most, all told.
  const mem = learned ?? null;
  const RANK = { hours: 0, window: 1, habit: 2, repeat: 3 } as const;
  const memNoticed = useMemo(
    () =>
      (mem?.items ?? [])
        .filter((i) => i.section === "new" && i.observation && i.described.confidence === "sure")
        .sort((a, b) => RANK[a.observation!.kind] - RANK[b.observation!.kind])
        .slice(0, Math.max(0, 3 - noticed.length)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mem?.items, noticed.length],
  );
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
    // what Memory noticed — written into your settings, slots or repeats only on Keep
    if (mem?.available)
      for (const it of memNoticed) {
        out.push({
          id: `memory:${it.key}`,
          glyph: "↻",
          cause: "noticed",
          label: it.described.statement,
          chip: it.described.evidence,
          why: it.described.keep,
          sub: it.described.keep,
          yesLabel: "Keep",
          noLabel: "Not true",
          pips: it.observation?.pips,
          yes: () => {
            void mem.keep(it, { quiet: true });
            return `Kept · ${it.described.title}`;
          },
          no: () => {
            mem.refuse(it, { quiet: true });
            return "Nuvo stopped looking for that";
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
  }, [d, slotById, inboxIds, dismissed, noticed, memNoticed, mem, setMemory, today, record, weekStartISO]);

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
      // a menu over the rail (a day's acts) owns its own arrows and ↵
      if (t && t.closest("[data-nested-surface]")) return;
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

  // The week's load by world — the meter in domain hues, against the open time.
  const byHue = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of placements) {
      const c = colorOf(p) ?? "var(--accent)";
      m.set(c, (m.get(c) ?? 0) + p.durationMin);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [placements, colorOf]);
  const over = tag === "over" || unplacedN > 0;
  const [dayAnchor, setDayAnchor] = useState<HTMLElement | null>(null);
  const keptRules = describeRules(memory.rules);

  return (
    <div
      ref={railRef}
      data-plan-rail
      className="titlebar-pad relative z-40 flex h-full w-[340px] shrink-0 flex-col"
      style={{ borderRight: "1px solid var(--line-1)", ["--titlebar-pad-y" as string]: "0px" }}
    >
      {/* which week · the old walk · close — the rail's own bar */}
      <div className="flex h-12 shrink-0 items-center gap-1.5 pl-3 pr-2" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
        <Segmented
          size="sm"
          label="Which week"
          value={weekStartISO}
          onChange={(iso) => iso !== weekStartISO && onWeek(iso, true)}
          options={[
            { value: weeks.thisWeek, label: weekLabel(weeks.thisWeek) },
            { value: weeks.nextWeek, label: weekLabel(weeks.nextWeek) },
          ]}
        />
        <span className="min-w-0 flex-1" />
        {/* trial escape hatch: the v1 walk, while v2 is being tried */}
        <Button
          size="xs"
          kind="ghost"
          onClick={() => navigate({ flow: "sunday-walk", flowStep: 0 }, "replace")}
          title="Open the previous full-screen walk"
        >
          Old walk
        </Button>
        <IconButton label="Close the plan" icon={<Icon name="close" size={14} />} onClick={onClose} />
      </div>

      {done ? (
        // COMMIT (D-187) — the same moment the phone ends on: the week by
        // world, landing band by band, sealed by one accent line.
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-6">
          <WeekSetMoment
            align="start"
            eyebrow="Committed"
            bands={sprintMinsByDomain(d.data).map((x) => ({ key: x.domain.id, label: x.domain.name, color: x.domain.color, mins: x.mins }))}
            facts={
              <>
                {done.things} things → {done.blocks} blocks · {done.secs >= 60 ? `${Math.floor(done.secs / 60)}m ` : ""}
                {done.secs % 60}s · {done.changes} change{done.changes === 1 ? "" : "s"} by you
              </>
            }
            action={
              <Button kind="primary" size="md" full onClick={onClose}>
                Done
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto px-4 pb-5 pt-5">
            {/* the crown — one hero, the claim in figures, the load by world */}
            <div className="grid gap-3">
              <FlowHead
                hero="Shape the week."
                fact={
                  <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span>
                      <b>{Math.round(placedMins / 60)}h</b> of <b>{Math.round(openMins / 60)}h</b> open time claimed
                    </span>
                    <Chip className={over ? "f-chip-warn" : undefined} tone={over ? undefined : "accent"}>
                      {tag}
                    </Chip>
                  </span>
                }
              />
              <FlowMeter
                total={Math.max(openMins, placedMins, 1)}
                segments={byHue.map(([color, mins]) => ({ key: color, value: mins, color }))}
                label={`${Math.round(placedMins / 60)} of ${Math.round(openMins / 60)} open hours claimed (${pct}%)`}
              />
              {slate.length > 0 && (
                <div className="flex min-w-0 flex-wrap items-center gap-2" onPointerLeave={() => setPipName(null)}>
                  {slate.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={p.on}
                      aria-label={p.name}
                      title={p.name}
                      onPointerEnter={() => setPipName(p.name)}
                      onFocus={() => setPipName(p.name)}
                      onClick={() => togglePip(p)}
                      className="f-pip"
                      style={{ ["--h" as string]: p.color }}
                    />
                  ))}
                  <span className="min-w-0 flex-1 truncate text-caption text-muted">{pipName ?? "This week's projects"}</span>
                </div>
              )}
            </div>

            {/* the days — each one's acts (Lighten · Clear the afternoon · Day off) in its menu */}
            <div className="flex gap-1">
              {workingDayISOs.map((iso) => {
                const ctx = d.dayContexts[iso];
                return (
                  <Button
                    key={iso}
                    size="xs"
                    full
                    active={dayMenu === iso}
                    aria-haspopup="menu"
                    aria-expanded={dayMenu === iso}
                    onClick={(e) => {
                      const el = e.currentTarget;
                      setDayMenu((x) => (x === iso ? null : iso));
                      setDayAnchor(el);
                    }}
                    title={ctx && ctx !== "normal" ? `${dayName(iso)} · ${ctx}` : dayName(iso)}
                    style={{ flex: 1, minWidth: 0, color: ctx === "off" ? "var(--faint)" : undefined, textDecoration: ctx === "off" ? "line-through" : undefined }}
                  >
                    {dayName(iso)}
                    {ctx === "light" ? <span style={{ color: "var(--accent-ink)" }}>◐</span> : null}
                  </Button>
                );
              })}
            </div>
            <Menu anchor={dayAnchor} open={dayMenu != null} onClose={() => setDayMenu(null)} label={dayMenu ? `${dayName(dayMenu)} — what kind of day` : "Day"}>
              {dayMenu && (
                <>
                  <MenuLabel>{dayName(dayMenu)}</MenuLabel>
                  {(
                    [
                      ["light", "Lighten"],
                      ["afternoon", "Clear afternoon"],
                      ["off", "Day off"],
                      ["normal", "Normal"],
                    ] as const
                  ).map(([a, label]) => (
                    <MenuItem
                      key={a}
                      checked={a === "afternoon" ? undefined : (d.dayContexts[dayMenu] ?? "normal") === a}
                      onSelect={() => dayAct(dayMenu, a)}
                    >
                      {label}
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>

            {placing && (
              <Card style={{ boxShadow: "0 0 0 1.5px var(--slot), var(--sh-1)" }}>
                <div className="f-title">
                  Pick a time for <span style={{ color: "var(--slot)" }}>{placing.name}</span>
                </div>
                <div className="f-fact" title={`Click one — it goes there, shortened if the gap is smaller than ${fmtMins(placing.mins)}.`}>
                  <b>{gaps.length}</b> open stretch{gaps.length === 1 ? "" : "es"} shaded on the calendar
                </div>
                <div>
                  <Button size="xs" onClick={() => setPlacing(null)}>
                    Cancel
                  </Button>
                </div>
              </Card>
            )}

            {/* the walk — one group at a time */}
            {order.length > 0 && (
              <div className="grid gap-2">
                <SectionHeader title={selP ? `Block ${order.indexOf(sel!) + 1} of ${order.length}` : "Nuvo's draft"} count={`${reviewed}/${order.length} accepted`} className="!px-0" />
                {/* one pip per block, in time order — filled once accepted; tap one to look at it */}
                <div className="flex flex-wrap gap-[3px]" role="group" aria-label="Blocks in the draft">
                  {order.map((k) => {
                    const p = byKey.get(k)!;
                    const held = d.isHeld(k);
                    const hue = colorOf(p) ?? "var(--accent)";
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setSel(k)}
                        title={`${titleOf(p)} · ${where(p)}`}
                        aria-label={`${titleOf(p)}, ${where(p)}${held ? ", accepted" : ""}`}
                        aria-current={k === sel}
                        className="f-pip"
                        data-size="sm"
                        aria-pressed={held}
                        style={{ ["--h" as string]: hue }}
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
                  <Card selected>
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="pt-[5px]">
                        <Dot color={colorOf(selP) ?? "var(--accent)"} />
                      </span>
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <div className="f-title">{titleOf(selP)}</div>
                        <div className="f-fact text-caption">
                          {where(selP)}
                          {items.length > 1 ? ` · ${items.length} tasks` : ""}
                          {held ? " · accepted" : ""}
                        </div>
                      </div>
                    </div>
                    {items.length > 1 && (
                      <ul className="grid" style={{ boxShadow: "inset 0 1px 0 var(--line-1)" }}>
                        {items.map((t) => (
                          <li key={t.id} className="flex min-h-[28px] items-center gap-2" style={{ boxShadow: "inset 0 -1px 0 var(--line-1)" }}>
                            <span className="min-w-0 flex-1 truncate text-body" title={t.title}>
                              {t.title}
                            </span>
                            <span className="f-num shrink-0 text-caption text-[var(--faint)]">{t.mins}m</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="text-caption text-muted">{selP.reason}</div>
                    {/* how long — your estimate beats the sum of the tasks; Nuvo re-places it */}
                    <div className="grid gap-1">
                      <span className="text-label font-semibold text-[var(--faint)]">How long</span>
                      <div className="flex flex-wrap gap-1" role="group" aria-label="Block length">
                        {[...new Set([15, 30, 45, 60, 90, 120, selP.durationMin])]
                          .sort((a, b) => a - b)
                          .map((m) => (
                            <Button
                              key={m}
                              size="xs"
                              kind={m === selP.durationMin ? "secondary" : "ghost"}
                              aria-pressed={m === selP.durationMin}
                              onClick={() => m !== selP.durationMin && setLength(sel!, m)}
                            >
                              {fmtMins(m)}
                            </Button>
                          ))}
                      </div>
                    </div>
                    <div className="flex gap-1.5 pt-0.5">
                      <Button kind="primary" size="md" shortcut="↵" onClick={() => accept(sel!)} style={{ flex: 1 }}>
                        {held ? "Keep · next" : "Looks good"}
                      </Button>
                      <Button size="md" shortcut="J" onClick={() => advance(sel)}>
                        Later
                      </Button>
                    </div>
                    {altList.length > 1 && (
                      <div className="grid gap-1">
                        <span className="flex items-center gap-1.5 text-label font-semibold text-[var(--faint)]">
                          Other times <Kbd keys={["←", "→"]} />
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {altList.map((a, i) => (
                            <ChipButton key={i} onClick={() => pickAlt(i)} className={i === altIx ? "f-chip-on" : undefined} aria-pressed={i === altIx}>
                              <span className="f-num text-[var(--faint)]">{i === 0 ? "·" : i}</span> {dayName(a.dayISO)} {at(instant(a.dayISO, a.startMin))}
                            </ChipButton>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-0.5" style={{ boxShadow: "inset 0 1px 0 var(--line-1)", paddingTop: 6 }}>
                      {(
                        [
                          ...(held ? ([["H", "Release", () => act.hold(sel!)]] as const) : []),
                          ["S", "Split", () => act.split(sel!)],
                          ["X", "Off this week", () => act.off(sel!)],
                        ] as const
                      ).map(([key, label, run]) => (
                        <Button key={key} size="xs" kind="ghost" shortcut={key} onClick={run} className={key === "X" ? "f-danger" : undefined}>
                          {label}
                        </Button>
                      ))}
                    </div>
                  </Card>
                );
              })()
            ) : order.length > 0 ? (
              <Card>
                {reviewed >= order.length ? (
                  <div className="flex items-center gap-2 text-body">
                    <span className="f-tick" data-done="">
                      <Icon name="check" size={10} strokeWidth={2.6} />
                    </span>
                    All {order.length} blocks accepted.
                  </div>
                ) : (
                  <>
                    <div className="text-body">
                      <b className="f-num">{order.length - reviewed}</b> block{order.length - reviewed === 1 ? "" : "s"} still to look at.
                    </div>
                    <Button kind="primary" size="md" full onClick={() => advance(null)}>
                      Review the next one
                    </Button>
                  </>
                )}
              </Card>
            ) : (
              <EmptyState>Nothing to place yet</EmptyState>
            )}

            {/* the stack */}
            <section className="f-section">
              <SectionHeader title="To settle" count={stack.length || "✓"} className="!px-0" />
              {paint && (
                <div className="flex min-h-[44px] items-center gap-1.5 rounded-[var(--r-ctl)] px-2" style={{ background: "var(--accent-wash)" }}>
                  <span className="w-[18px] shrink-0 text-center" style={{ color: "var(--accent-ink)" }} aria-hidden>
                    ▨
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body">
                    Keep {dayName(paint.dayISO)} {span(instant(paint.dayISO, paint.startMin), instant(paint.dayISO, paint.endMin))} clear
                  </span>
                  <Button size="xs" onClick={() => keepClear(false)}>
                    {dayName(paint.dayISO)}
                  </Button>
                  <Button size="xs" kind="primary" onClick={() => keepClear(true)}>
                    Every day
                  </Button>
                  <IconButton size="xs" label="Cancel" icon={<Icon name="close" size={12} />} onClick={() => setPaint(null)} />
                </div>
              )}
              {stack.length === 0 && !paint && <EmptyState>Nothing needs you</EmptyState>}
              <div className="f-rows">
                {stack.map((it) => (
                  <div
                    key={it.id}
                    className="grid gap-1.5 rounded-[var(--r-ctl)] px-1.5 py-2.5"
                    style={{ background: focus === it.id ? "var(--accent-wash)" : undefined }}
                    onPointerEnter={() => !sel && setFocus(it.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-[18px] shrink-0 text-center text-body" style={{ color: "var(--accent-ink)" }} title={it.cause}>
                        {it.glyph}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-body font-medium" title={it.label}>
                        {it.label}
                      </span>
                      {it.pips && (
                        <span className="flex shrink-0 gap-[2px]" aria-label={`${it.pips.filter(Boolean).length} of ${it.pips.length} weeks`}>
                          {it.pips.map((on, i) => (
                            <i key={i} className="block h-[5px] w-[5px] rounded-full" style={{ background: on ? "var(--ink)" : "var(--line-2)" }} />
                          ))}
                        </span>
                      )}
                    </div>
                    {it.sub && <p className="pl-6 text-caption leading-snug text-muted">{it.sub}</p>}
                    <div className="flex flex-wrap gap-1 pl-6">
                      <Button size="xs" kind="primary" onClick={() => decide(it.id, true)}>
                        {it.yesLabel}
                      </Button>
                      <Button size="xs" onClick={() => decide(it.id, false)}>
                        {it.noLabel}
                      </Button>
                      {it.extra?.map((x) => (
                        <Button key={x.label} size="xs" kind="ghost" onClick={x.run}>
                          {x.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {keptRules.length > 0 && (
              <section className="f-section">
                <SectionHeader title="Nuvo keeps" count={keptRules.length} collapsed={!showKept} onToggle={() => setShowKept((x) => !x)} className="!px-0" />
                {showKept && (
                  <div className="f-rows">
                    {keptRules.map((r) => (
                      <Row
                        key={r.id}
                        title={r.text}
                        trailing={
                          <Button size="xs" kind="ghost" onClick={() => setMemory((m) => ({ ...m, rules: r.remove(m.rules) }))}>
                            Remove
                          </Button>
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="grid gap-1.5">
              <span className="text-caption font-semibold text-muted">During the week</span>
              <Segmented
                label="How much Nuvo moves"
                value={dial}
                onChange={setDial}
                options={(["ask", "suggest", "handle"] as const).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1), title: DIAL_NOTE[v] }))}
              />
            </section>
          </div>

          <div className="f-foot">
            <div className="f-sum">
              <b>{things}</b> things · <b>{placements.length}</b> blocks
            </div>
            <Button kind="primary" size="md" shortcut={["⌘", "↵"]} onClick={() => void commit()} disabled={d.applying || placements.length === 0}>
              {d.applying ? "Committing…" : `Commit ${things} things`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
