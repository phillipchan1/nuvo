import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { differenceInCalendarDays, format } from "date-fns";
import { useOptionalVertical } from "../../hooks/useVertical";
import { useWeekCrown } from "../../hooks/useWeekCrown";
import { stampOn } from "../../lib/celebrate";
import { parseDateISO } from "../../lib/dates";
import { motionOff } from "../../lib/motion";
import {
  RUNG,
  mountStage,
  newlyComplete,
  onMoment,
  ownActRecent,
  playMoment,
  weekLanded,
  type Moment,
  type MomentPiece,
} from "../../lib/moments";
import { domainById, projectsOf, type VerticalData } from "../../lib/vertical";
import type { FinishTier } from "../../lib/celebrate";
import { FinishRing, Stop } from "../kit/Readings";
import { ProgressRing } from "../progress/ProgressRing";

// The top of the finish ladder (D-237; the rule is lib/moments.ts).
//
// The lower rungs finish in place — a tick, a dial, the day's ring on the rail.
// Above the day, the finish also gets a STATEMENT: an ink plate over the app,
// the thing you finished set at 800 weight and ending on the ember full stop,
// with its ring closing at the size the finish earned. Nothing here is a new
// mark or a new motion: the ring is the kit's FinishRing playing its own close
// (lib/celebrate `closeRing` — the swell, the outlines, the sparks, the
// haptic), the full stop is the kit's `Stop` dropping, the stamp is the Seal,
// and a project in a list wears its crown ProgressRing, closing.
//
//   WEEK        a plate        · the week's ring closes · "Week landed."
//   PROJECT     a wider plate  · its ring closes, the Seal lands on it
//   INITIATIVE  the whole stage· its ring closes (the quarter's tier), the Seal,
//                                each of its projects' rings in turn
//
// It never asks for anything. Any key, any tap, or time lets it go — and the
// key still reaches the app. No count of acts, no streak (N-04, D-203).

/** When the ring shuts, after the plate has arrived and said its name. */
const SHUT_MS: Record<Moment["kind"], number> = { week: 650, project: 600, initiative: 900 };
/** How long each rung holds once it has finished landing. */
const HOLD_MS: Record<Moment["kind"], number> = { week: 2400, project: 3000, initiative: 4800 };
const TIER: Record<Moment["kind"], FinishTier> = { week: "week", project: "week", initiative: "quarter" };
/** the beat between pieces — mirrored as --mo-stagger in moment.css */
const STAGGER_MS = 90;
const LEAVE_MS = 260;

function sequenceMs(m: Moment): number {
  const n = m.kind === "project" ? 0 : m.pieces.length;
  return Math.max(SHUT_MS[m.kind] + 1100, 400 + n * STAGGER_MS + 900);
}

// ── the stage: draws whatever the bus plays ─────────────────────────────────

export function MomentStage() {
  const [moment, setMoment] = useState<Moment | null>(null);
  const [play, setPlay] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const shownAt = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => mountStage(), []);

  useEffect(
    () =>
      onMoment((m) => {
        // a plate still leaving must not take the new one with it
        if (timer.current) {
          window.clearTimeout(timer.current);
          timer.current = null;
        }
        setMoment((cur) => (cur && RUNG[cur.kind] > RUNG[m.kind] ? cur : m));
        setPlay((n) => n + 1);
        setLeaving(false);
        shownAt.current = Date.now();
      }),
    [],
  );

  const letGo = () => {
    if (!moment || leaving) return;
    if (motionOff()) {
      setMoment(null);
      return;
    }
    setLeaving(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setMoment(null);
      setLeaving(false);
    }, LEAVE_MS);
  };

  // time lets it go
  useEffect(() => {
    if (!moment) return;
    const t = window.setTimeout(letGo, sequenceMs(moment) + HOLD_MS[moment.kind]);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment, play]);

  // any key lets it go — and is NOT swallowed: typing into the app just works
  useEffect(() => {
    if (!moment) return;
    const onKey = () => {
      // the keystroke that finished the thing (↵ on a ship) must not also dismiss it
      if (Date.now() - shownAt.current > 300) letGo();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment, leaving]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!moment || typeof document === "undefined") return null;
  return createPortal(
    <div
      className={`mo-scrim mo-${moment.kind} ${leaving ? "is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      onPointerDown={() => {
        if (Date.now() - shownAt.current > 300) letGo();
      }}
      data-tauri-drag-region="false"
    >
      <Plate key={play} m={moment} />
    </div>,
    document.body,
  );
}

// ── one plate ───────────────────────────────────────────────────────────────

/** The plate's beats, as state the kit's parts watch: the ring shuts (its own
 *  close plays), the Seal lands on it, the full stop drops. */
function useBeats(kind: Moment["kind"]) {
  const still = motionOff();
  const [shut, setShut] = useState(still);
  const [stop, setStop] = useState(still);
  const ring = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (still) return;
    const at = SHUT_MS[kind];
    const ts = [
      window.setTimeout(() => setShut(true), at),
      window.setTimeout(() => setStop(true), at + 560),
    ];
    if (kind !== "week") ts.push(window.setTimeout(() => stampOn(ring.current, true), at + 380));
    return () => ts.forEach((t) => window.clearTimeout(t));
  }, [kind, still]);
  return { shut, stop, ring };
}

function Hero({ children, stop }: { children: ReactNode; stop: boolean }) {
  return (
    <h2 className="mo-hero">
      {children}
      <Stop on={stop} />
    </h2>
  );
}

function Pieces({ pieces, size }: { pieces: MomentPiece[]; size: number }) {
  return (
    <ul className="mo-pieces">
      {pieces.map((p, i) => (
        <li key={p.key} className="mo-piece" style={{ "--i": i } as CSSProperties} data-done={p.done || undefined}>
          {p.done ? (
            <ProgressRing closing pct={p.pct} color={p.color} filled size={size} />
          ) : (
            <ProgressRing pct={p.pct} color={p.color} filled={false} size={size} />
          )}
          <span>{p.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Plate({ m }: { m: Moment }) {
  const { shut, stop, ring } = useBeats(m.kind);
  const n = m.kind === "project" ? 0 : m.pieces.length;
  const style = { "--n": n } as CSSProperties;
  const tier = TIER[m.kind];

  if (m.kind === "week") {
    return (
      <div className="mo-plate" data-theme="dark" style={style}>
        <div className="mo-head">
          <span ref={ring} className="mo-ring">
            <FinishRing outer={null} inner={(shut ? m.of : m.before) / m.of} n={shut ? m.of : m.before} of={m.of} closed={shut} tier={tier} size={112} />
          </span>
          <div className="mo-say">
            <p className="mo-kicker">{m.weekLabel}</p>
            <Hero stop={stop}>Week landed</Hero>
          </div>
        </div>
        <Pieces pieces={m.pieces} size={18} />
      </div>
    );
  }

  if (m.kind === "project") {
    const of = Math.max(1, m.of);
    const before = Math.min(of - 1, Math.round(m.from * of));
    return (
      <div className="mo-plate" data-theme="dark" style={style}>
        <span ref={ring} className="mo-ring">
          <FinishRing outer={null} inner={(shut ? of : before) / of} n={shut ? of : before} of={of} closed={shut} tier={tier} size={120} />
        </span>
        {m.domain && (
          <p className="mo-kicker">
            <span className="mo-dot" style={{ background: m.domain.color }} />
            {m.domain.name}
          </p>
        )}
        <Hero stop={stop}>{m.name}</Hero>
        <p className="mo-fact">Shipped{m.fact ? ` · ${m.fact}` : ""}</p>
      </div>
    );
  }

  const of = Math.max(1, m.pieces.length);
  const landed = m.pieces.filter((p) => p.done).length;
  return (
    <div className="mo-plate" data-theme="dark" style={style}>
      <div className="mo-head">
        <span ref={ring} className="mo-ring">
          <FinishRing outer={null} inner={landed / of} n={landed} of={of} closed={shut} tier={tier} size={152} />
        </span>
        <div className="mo-say">
          <p className="mo-kicker">
            {m.domain && <span className="mo-dot" style={{ background: m.domain.color }} />}
            Initiative{m.domain ? ` · ${m.domain.name}` : ""}
          </p>
          <Hero stop={stop}>{m.name}</Hero>
        </div>
      </div>
      {m.pieces.length > 0 && <Pieces pieces={m.pieces} size={22} />}
      <p className="mo-fact">Shipped{m.fact ? ` · ${m.fact}` : ""}</p>
    </div>
  );
}

// ── the watch: decides when a rung was reached by your own hand ─────────────

function sinceFact(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const start = iso.length <= 10 ? parseDateISO(iso) : new Date(iso);
  if (Number.isNaN(start.getTime())) return null;
  const days = differenceInCalendarDays(now, start);
  if (days < 1) return null;
  const span = days < 14 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.round(days / 7)} weeks`;
  return `started ${format(start, "MMM d")} · ${span}`;
}

/** Each project's work as [done, total]. */
function projectWork(data: VerticalData): Map<string, [number, number]> {
  const tally = new Map<string, [number, number]>();
  for (const t of data.tasks) {
    if (!t.projectId) continue;
    const c = tally.get(t.projectId) ?? [0, 0];
    c[1]++;
    if (t.status === "done") c[0]++;
    tally.set(t.projectId, c);
  }
  return tally;
}

function domainOf(data: VerticalData, id: string | null) {
  const d = domainById(data, id);
  return d ? { name: d.name, color: d.color } : null;
}

export function MomentWatch() {
  const store = useOptionalVertical();
  const data = store?.data ?? null;
  const crown = useWeekCrown();

  // A project SHIPS when you ship it — its stored status. Its effective status
  // also turns complete the moment its last task is ticked (buildVertical),
  // and that is "ready to ship", not shipped: watching it would play twice.
  const shipped = useRef<Map<string, string> | null>(null);
  const initiatives = useRef<Map<string, string> | null>(null);
  const work = useRef<Map<string, [number, number]>>(new Map());
  const week = useRef<{ iso: string; landed: number; total: number; pcts: Map<string, number> } | null>(null);

  useEffect(() => {
    if (!data) return;
    const own = ownActRecent();
    const now = new Date();
    const found: Moment[] = [];
    const workNow = projectWork(data);
    const before = (id: string) => {
      const [d, n] = work.current.get(id) ?? [0, 0];
      return n ? d / n : 0;
    };

    for (const id of newlyComplete(shipped.current, data.projects.map((p) => ({ id: p.id, status: p.storedStatus })))) {
      const p = data.projects.find((x) => x.id === id);
      if (!p) continue;
      const [done, of] = workNow.get(id) ?? [0, 0];
      found.push({
        kind: "project",
        id,
        name: p.name,
        domain: domainOf(data, p.domainId),
        done,
        of,
        from: before(id),
        fact: sinceFact(p.startDate ?? p.createdAt, now),
      });
    }
    for (const id of newlyComplete(initiatives.current, data.initiatives)) {
      const i = data.initiatives.find((x) => x.id === id);
      if (!i) continue;
      found.push({
        kind: "initiative",
        id,
        name: i.name,
        domain: domainOf(data, i.domainId),
        pieces: projectsOf(data, id).map((p) => {
          const wasShipped = shipped.current?.get(p.id) === "complete";
          return {
            key: p.id,
            label: p.name,
            color: domainById(data, p.domainId)?.color ?? "var(--accent)",
            done: p.status === "complete",
            pct: Math.round((wasShipped ? 1 : before(p.id)) * 100),
          };
        }),
        fact: sinceFact(i.startDate ?? i.createdAt, now),
      });
    }

    if (crown) {
      const prev = week.current;
      // a new week (Saturday rolls the planning week) re-seeds; it doesn't play
      if (prev && prev.iso === crown.weekISO && !weekLanded(prev.landed, prev.total) && weekLanded(crown.landed, crown.total)) {
        found.push({
          kind: "week",
          weekLabel: crown.weekLabel,
          before: Math.min(prev.landed, crown.total - 1),
          of: crown.total,
          pieces: crown.rows.map((r) => ({
            key: r.projectId,
            label: r.title,
            color: r.color,
            done: r.state === "landed" || r.state === "shipped",
            pct: prev.pcts.get(r.projectId) ?? r.pct,
          })),
        });
      }
      week.current = {
        iso: crown.weekISO,
        landed: crown.landed,
        total: crown.total,
        pcts: new Map(crown.rows.map((r) => [r.projectId, r.state === "landed" || r.state === "shipped" ? 100 : r.pct])),
      };
    }

    shipped.current = new Map(data.projects.map((p) => [p.id, p.storedStatus]));
    initiatives.current = new Map(data.initiatives.map((i) => [i.id, i.status]));
    work.current = workNow;

    if (!own || found.length === 0) return;
    playMoment(found.reduce((a, b) => (RUNG[b.kind] > RUNG[a.kind] ? b : a)));
  }, [data, crown]);

  return null;
}

/** Mounted once, inside the vertical store, on both shells. */
export default function MomentLayer() {
  return (
    <>
      <MomentWatch />
      <MomentStage />
    </>
  );
}
