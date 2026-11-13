// The Assess overlay — a world-class coach's pass rendered as inline MARGIN
// NOTES beside the work it critiques. Non-destructive: the record stays exactly
// as written; each finding floats in the right margin, aligned to the element it
// points at (a warm highlight ties them together), with Accept (apply the patch)
// / Dismiss. Nothing changes until you Accept. The AI pass runs in the `assess`
// edge mode; this component only reads + overlays it.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { supabase } from "../../lib/supabase";
import { Icon } from "../Icon";
import { Button } from "../kit";

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

// Severity is a verdict, not "now": high reads as danger, medium as a caution.
const SEV_COLOR: Record<AssessFinding["severity"], string> = {
  high: "var(--danger)",
  medium: "var(--warn)",
  low: "var(--faint)",
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
  // The review speaks in the accent (Nuvo's voice), not the record's hue.
  void accent;
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
      {/* the review's bar, pinned over the page */}
      <div className="doc-assess-bar">
        <b>
          <Icon name="sparkles" size={14} />
          {"Nuvo's review"}
        </b>
        {findings === null && !error ? (
          <span className="doc-pulse">Reading…</span>
        ) : error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <span className="tabular-nums">{live.length ? `${live.length} to sharpen` : "Nothing to sharpen"}</span>
        )}
        <Button kind="primary" size="xs" onClick={onExit}>
          Done
        </Button>
      </div>

      {/* highlights over the anchored elements */}
      {live.map(({ f, i }) => {
        const pos = tops[i];
        if (!pos || !pos.found) return null;
        return (
          <div
            key={`mark-${i}`}
            className="doc-assess-mark"
            style={{
              top: pos.markTop - 4,
              left: pos.markLeft - 6,
              height: pos.markHeight + 8,
              width: `calc(100% - ${CARD_W + 52}px)`,
              maxWidth: 732,
              ["--m" as string]: SEV_COLOR[f.severity],
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
            className="k-card doc-assess-note"
            style={{ top: pos?.cardTop ?? 8, width: CARD_W, opacity: pos ? 1 : 0, ["--m" as string]: SEV_COLOR[f.severity] }}
          >
            <div className="flex items-start gap-2">
              <span className="doc-assess-sev" aria-hidden />
              <div className="grid min-w-0 flex-1 gap-1.5">
                <p>{f.issue}</p>
                {f.suggestion && !f.patch && <p className="doc-assess-sub">{f.suggestion}</p>}
                {f.patch && <div className="doc-assess-patch">{patchPreview(f.patch)}</div>}
                <div className="flex items-center gap-1.5">
                  {f.patch && (
                    <Button size="xs" kind="primary" onClick={() => accept(i, f)} icon={<Icon name="check" size={12} />}>
                      Accept
                    </Button>
                  )}
                  <Button size="xs" kind="ghost" onClick={() => remove(i)}>
                    {f.patch ? "Dismiss" : "Got it"}
                  </Button>
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
