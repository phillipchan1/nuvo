// The Assess overlay — a world-class coach's pass rendered as inline MARGIN
// NOTES beside the work it critiques. Non-destructive: the record stays exactly
// as written; each finding floats in the right margin, aligned to the element it
// points at (a warm highlight ties them together), with Accept (apply the patch)
// / Dismiss. Nothing changes until you Accept. The AI pass runs in the `assess`
// edge mode; this component only reads + overlays it.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { supabase } from "../../lib/supabase";

export interface AssessPatch {
  kind: "outcome" | "kr" | "title";
  outcome?: string;
  name?: string;
  baseline?: number;
  target?: number;
  unit?: string;
  title?: string;
}
export interface AssessFinding {
  anchor: string;
  severity: "high" | "medium" | "low";
  issue: string;
  suggestion?: string;
  patch?: AssessPatch;
}

const SEV_COLOR: Record<AssessFinding["severity"], string> = {
  high: "var(--signal)",
  medium: "#D97706",
  low: "var(--muted)",
};

const CARD_W = 300;
const MIN_GAP = 12;

export function AssessLayer({
  kind,
  id,
  scrollRef,
  accent,
  onAccept,
  onExit,
}: {
  kind: "project" | "initiative";
  id: string;
  scrollRef: RefObject<HTMLDivElement>;
  accent: string;
  onAccept: (f: AssessFinding) => void;
  onExit: () => void;
}) {
  const [findings, setFindings] = useState<AssessFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<number>>(new Set()); // dismissed/accepted indices
  const [tops, setTops] = useState<Record<number, { cardTop: number; markTop: number; markHeight: number; markLeft: number; found: boolean }>>({});
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Run the coach's pass once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke<{ findings?: AssessFinding[] }>("agent", {
          body: { assess: { kind, id } },
        });
        if (fnErr) throw fnErr;
        if (cancelled) return;
        setFindings(data?.findings ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Assess failed");
      }
    })();
    return () => { cancelled = true; };
  }, [kind, id]);

  const live = (findings ?? []).map((f, i) => ({ f, i })).filter(({ i }) => !gone.has(i));

  // Measure each finding's anchor within the scroll container, then lay the cards
  // out top-to-bottom without overlapping (greedy push-down using real heights).
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !findings) return;
    const measure = () => {
      const cRect = container.getBoundingClientRect();
      let topStack = 8; // objective / general / unfound notes pin to the top
      let prevBottom = -Infinity;
      const next: typeof tops = {};
      // preserve document order for stacking
      const ordered = findings.map((f, i) => ({ f, i })).filter(({ i }) => !gone.has(i));
      // sort by anchor position so cards read top-to-bottom
      const withPos = ordered.map(({ f, i }) => {
        const el = container.querySelector<HTMLElement>(`[data-assess-anchor="${cssEscape(f.anchor)}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          return { i, found: true, markTop: r.top - cRect.top + container.scrollTop, markHeight: r.height, markLeft: r.left - cRect.left };
        }
        return { i, found: false, markTop: topStack, markHeight: 0, markLeft: 0 };
      });
      withPos.sort((a, b) => a.markTop - b.markTop);
      for (const m of withPos) {
        const cardEl = cardRefs.current[m.i];
        const h = cardEl?.offsetHeight ?? 84;
        let cardTop = Math.max(m.markTop, prevBottom + MIN_GAP);
        if (!m.found) { cardTop = Math.max(topStack, prevBottom + MIN_GAP); topStack = cardTop + h + MIN_GAP; }
        prevBottom = cardTop + h;
        next[m.i] = { cardTop, markTop: m.markTop, markHeight: m.markHeight, markLeft: m.markLeft, found: m.found };
      }
      setTops(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings, gone]);

  const remove = (i: number) => setGone((s) => new Set(s).add(i));
  const accept = (i: number, f: AssessFinding) => { onAccept(f); remove(i); };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: 1 }}>
      {/* floating toolbar */}
      <div className="pointer-events-auto sticky top-2 z-20 mx-auto flex w-fit items-center gap-3 rounded-full border border-line bg-surface px-3.5 py-1.5 [box-shadow:var(--shadow-2)]">
        <span className="mono text-micro font-semibold tracking-widest" style={{ color: accent }}>✦ NUVO'S REVIEW</span>
        {findings === null && !error ? (
          <span className="flex items-center gap-1.5 text-meta text-muted">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line border-t-current" style={{ color: accent }} />
            reading…
          </span>
        ) : error ? (
          <span className="text-meta text-signal">{error}</span>
        ) : (
          <span className="text-meta text-muted">{live.length ? `${live.length} suggestion${live.length === 1 ? "" : "s"}` : "nothing to sharpen ✓"}</span>
        )}
        <button onClick={onExit} className="fast mono rounded-full px-2 py-0.5 text-meta font-medium text-white" style={{ background: accent }}>Done</button>
      </div>

      {/* highlights over the anchored elements */}
      {live.map(({ f, i }) => {
        const pos = tops[i];
        if (!pos || !pos.found) return null;
        return (
          <div
            key={`mark-${i}`}
            className="pointer-events-none absolute rounded-[6px]"
            style={{
              top: pos.markTop - 4, left: pos.markLeft - 6, height: pos.markHeight + 8, width: `calc(100% - ${CARD_W + 40}px)`,
              maxWidth: 620,
              boxShadow: `inset 0 0 0 1.5px ${SEV_COLOR[f.severity]}55`,
              background: `${SEV_COLOR[f.severity]}0d`,
            }}
          />
        );
      })}

      {/* margin note cards */}
      {live.map(({ f, i }) => {
        const pos = tops[i];
        return (
          <div
            key={`card-${i}`}
            ref={(el) => { cardRefs.current[i] = el; }}
            className="pointer-events-auto absolute rounded-[var(--radius)] border border-line bg-surface p-2.5 [box-shadow:var(--shadow-2)]"
            style={{ top: pos?.cardTop ?? 8, right: 4, width: CARD_W, opacity: pos ? 1 : 0 }}
          >
            <div className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SEV_COLOR[f.severity] }} />
              <div className="min-w-0 flex-1">
                <div className="text-caption leading-snug">{f.issue}</div>
                {f.suggestion && !f.patch && <div className="mt-1 text-label leading-snug text-muted">{f.suggestion}</div>}
                {f.patch && (
                  <div className="mt-1.5 rounded-md border border-dashed border-line px-2 py-1 text-label leading-snug" style={{ color: accent }}>
                    {patchPreview(f.patch)}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  {f.patch && (
                    <button onClick={() => accept(i, f)} className="fast rounded-md border px-2 py-0.5 text-meta font-medium" style={{ borderColor: `${accent}55`, color: accent, background: `${accent}12` }}>
                      ✓ Accept
                    </button>
                  )}
                  <button onClick={() => remove(i)} className="fast text-meta text-muted hover:text-ink">{f.patch ? "Dismiss" : "Got it"}</button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function patchPreview(p: AssessPatch): string {
  if (p.kind === "outcome" && p.outcome) return `→ ${p.outcome}`;
  if (p.kind === "title" && p.title) return `→ ${p.title}`;
  if (p.kind === "kr") {
    const parts = [p.name, p.baseline != null && p.target != null ? `${p.baseline} → ${p.target}${p.unit ? ` ${p.unit}` : ""}` : null].filter(Boolean);
    return `→ ${parts.join("  ·  ")}`;
  }
  return "";
}

// minimal CSS.escape for anchor values (uuids + kinds, so alnum/-/:)
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, "\\$&");
}
