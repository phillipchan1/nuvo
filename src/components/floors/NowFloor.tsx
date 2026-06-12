// Now — the intelligent recommendation. Reads the live vertical store, ranks
// the ready tasks for this moment, and lets you complete one so the Gain
// ripples up the spine. The daily dividend of building the whole vertical.

import { useEffect, useMemo, useState } from "react";
import { useVertical } from "../../hooks/useVertical";
import { useExternalEvents } from "../../hooks/useCalendar";
import { useScheduledTasks } from "../../hooks/useTasks";
import { endOf } from "../../lib/dates";
import { faithfulness, initiativeProgress } from "../../lib/vertical";
import { nowContext, rankNow, type NowContext } from "../../lib/now";
import { Btn } from "../ui";

export default function NowFloor({ onOpenDay }: { onOpenDay: () => void }) {
  const { data, toggleTask } = useVertical();

  // a live "now" — the floor can stay open for hours
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // the real gap: the next busy thing on the live calendar (event or block).
  // Query window is keyed to the hour so it doesn't churn every minute.
  const horizon = useMemo(() => {
    const start = new Date(now);
    start.setMinutes(0, 0, 0);
    return { start: start.toISOString(), end: new Date(start.getTime() + 18 * 3600_000).toISOString() };
  }, [now.getHours()]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: events = [] } = useExternalEvents(horizon.start, horizon.end);
  const { data: blocks = [] } = useScheduledTasks(horizon.start, horizon.end);

  const ctx = useMemo<NowContext>(() => {
    const busy = [
      ...events
        .filter((e) => e.busy && !e.all_day)
        .map((e) => ({ title: e.title, start: new Date(e.start_at), end: new Date(e.end_at) })),
      ...blocks
        .filter((t) => t.status !== "done" && t.start_time)
        .map((t) => ({
          title: t.title,
          start: new Date(t.start_time!),
          end: endOf({ start_time: t.start_time!, duration_minutes: t.duration_minutes }),
        })),
    ];
    // already inside something busy? the gap is what's left of it
    const ongoing = busy.find((b) => b.start <= now && now < b.end);
    if (ongoing) {
      const base = nowContext(now, ongoing.end);
      return {
        ...base,
        gapLabel: `in “${ongoing.title}” for ${base.gapMins}m more`,
      };
    }
    const starts = busy.map((b) => b.start).filter((d) => d > now);
    starts.sort((a, b) => a.getTime() - b.getTime());
    return nowContext(now, starts[0] ?? null);
  }, [events, blocks, now]);
  const suggestions = useMemo(() => rankNow(data, ctx), [data, ctx]);
  const [idx, setIdx] = useState(0);
  const [state, setState] = useState<"choose" | "focus" | "done">("choose");
  const top = suggestions[Math.min(idx, Math.max(0, suggestions.length - 1))];
  if (!top) return <div className="mx-auto max-w-[560px] text-[13px] text-muted">Nothing ready — inbox zero.</div>;

  return (
    <div className="mx-auto max-w-[620px]">
      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 border-b border-line pb-4">
        {data.domains.map((d) => {
          const f = faithfulness(d);
          return (
            <div key={d.id} className="flex items-center gap-2" style={{ opacity: f.lit ? 1 : 0.45 }}>
              <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
              <div className="leading-tight">
                <div className="text-[11px]">{d.name}</div>
                <div className="mono text-[9px] text-muted">{f.note}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mono mb-1 text-[10px] text-muted">{ctx.clockLabel} · {ctx.gapLabel}</div>

      {state === "choose" && (
        <>
          <div className="border p-4" style={{ borderColor: top.domain?.color, borderWidth: 1.5 }}>
            <div className="section-label mb-1.5">Right now</div>
            <div className="text-[18px] font-medium">{top.task.title}</div>
            {top.initiative && (
              <div className="mono mt-0.5 text-[11px]" style={{ color: top.domain?.color }}>
                {top.domain?.name} · {top.initiative.name}
              </div>
            )}
            <div className="mt-3 space-y-1">
              {top.reasons.map((r, i) => (
                <div key={i} className="flex items-center gap-2.5 text-[12px] text-muted">
                  <span style={{ color: top.domain?.color }}>{r.glyph}</span>
                  {r.text}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Btn kind="primary" onClick={() => setState("focus")}>▶ start · {top.task.durationMins}m</Btn>
              <Btn onClick={() => setIdx((i) => (i + 1) % suggestions.length)}>not now</Btn>
              <Btn onClick={onOpenDay}>open day planner</Btn>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            {suggestions.map((s, i) =>
              i === idx ? null : (
                <button key={s.task.id} onClick={() => setIdx(i)} className="fast block text-left text-[12px] text-muted hover:text-ink">
                  or · {s.task.title} <span className="mono text-[10px] text-line">· {s.task.durationMins}m</span>
                </button>
              ),
            )}
          </div>
        </>
      )}

      {state === "focus" && (
        <div className="border p-6 text-center" style={{ borderColor: top.domain?.color, borderWidth: 1.5 }}>
          <div className="section-label">Focusing</div>
          <div className="mt-1.5 text-[18px] font-medium">{top.task.title}</div>
          <div className="mono mt-1 text-[11px] text-muted">{top.task.durationMins}m · everything else is quiet</div>
          <div className="mt-4"><Btn kind="primary" onClick={() => { toggleTask(top.task.id); setState("done"); }}>✓ done</Btn></div>
        </div>
      )}

      {state === "done" && (
        <div className="border border-line p-5" style={{ borderColor: top.domain?.color }}>
          <div className="text-[14px] font-medium" style={{ color: top.domain?.color }}>✓ logged as a gain</div>
          <div className="mt-2 space-y-0.5 text-[12px] text-muted">
            {top.initiative && <div>{top.initiative.name} — now {initiativeProgress(data, top.initiative)}%</div>}
            {top.domain && <div>{top.domain.name} tended · faithful again today</div>}
          </div>
          <div className="mt-3">
            <Btn onClick={() => { setState("choose"); setIdx(0); }}>what's next →</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
