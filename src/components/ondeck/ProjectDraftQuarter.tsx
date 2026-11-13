/**
 * Draft the projects, on the desktop (D-196). The initiative's quarter opens
 * over the deck into its weeks: your own projects as bars, Nuvo's drafted ones
 * as ghost bars, and a rail that walks them one at a time — the grammar of Plan
 * the week's walk (D-183), one clock speed slower.
 *
 *   ↵ hold · ⌫ drop · ⇥ or 1–3 another version · ←/→ move a week · [ ] length
 *   J/K walk · ⇧↵ hold all · esc put the rest away · drag a bar or its edge
 *
 * A zoom on the initiative deck, not a page (P10): it covers the deck's pane and
 * Back to quarters takes it away. State and writes are `useProjectDraft`.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { armDragCancel } from "../../lib/dragCancel";
import { isTypingIn, pressable } from "../../lib/a11y";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { packRows, spanLabel, type ProjectSpan } from "../../lib/projectDraft";
import type { Initiative } from "../../lib/vertical";
import { Icon } from "../Icon";
import { Button, ChipButton, IconButton, Input, Kbd } from "../kit";
import { PROJECT_STEERS, useProjectDraft, type GhostProject } from "./useProjectDraft";

const ROW_PX = 60;

export default function ProjectDraftQuarter({
  initiative,
  quarterLabel,
  weeks,
  color,
  from,
  onClose,
}: {
  initiative: Initiative;
  quarterLabel: string;
  /** the quarter's Mondays still ahead (ISO) — the grid */
  weeks: string[];
  /** the initiative's domain hue — identity on the bars you hold */
  color: string;
  /** where the press came from: the zoom opens out of the card */
  from: DOMRect | null;
  onClose: () => void;
}) {
  const draft = useProjectDraft(initiative, weeks);
  const N = weeks.length;
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const steerRef = useRef<HTMLInputElement>(null);
  /** a bar following the pointer: its live span, before the drop writes it */
  const [dragging, setDragging] = useState<{ key: string; span: ProjectSpan } | null>(null);

  // The zoom: out of the card you pressed, once, on your press (P9 / D-187).
  useLayoutEffect(() => {
    const el = rootRef.current;
    // the keys are the draft's now — take focus off the card's ✦ under it
    el?.focus({ preventScroll: true });
    if (!el || !from || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const ox = from.left + from.width / 2 - r.left;
    const oy = from.top + from.height / 2 - r.top;
    el.animate(
      [
        { opacity: 0, transform: "scale(0.96)", transformOrigin: `${ox}px ${oy}px` },
        { opacity: 1, transform: "scale(1)", transformOrigin: `${ox}px ${oy}px` },
      ],
      { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focus = draft.ghosts.find((g) => g.key === draft.cursor) ?? null;
  const review = draft.phase === "review";

  // ── keys — the walk's, registered once while the quarter is open ──
  const live = useRef({ draft, focus, review, onClose });
  live.current = { draft, focus, review, onClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { draft: d, focus: f, review: rv, onClose: close } = live.current;
      if (isTypingIn(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // a tab stop of its own (a bar, a button) answers its own Enter/Space
      if ((e.key === "Enter" || e.key === " ") && !e.shiftKey && (e.target as HTMLElement)?.closest?.("button, [role=button]")) return;
      const eat = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "Escape") {
        eat();
        if (d.remaining && (rv || d.phase === "streaming" || d.phase === "reading")) d.discard();
        else close();
        return;
      }
      if (!rv) return;
      if (e.key === "Enter" && e.shiftKey) return eat(), d.holdAll();
      const order = d.ghosts;
      if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!order.length) return;
        eat();
        const i = order.findIndex((g) => g.key === d.cursor);
        const n = order[(i + (e.key === "j" || e.key === "ArrowDown" ? 1 : -1) + order.length) % order.length];
        d.setCursor(n.key);
        return;
      }
      if (!f) return;
      if (e.key === "Enter") return eat(), d.hold(f.key);
      if (e.key === "Backspace" || e.key === "Delete") return eat(), d.drop(f.key);
      if (e.key === "Tab") return eat(), d.version(f.key);
      if (/^[1-3]$/.test(e.key)) return eat(), d.version(f.key, Number(e.key) - 1);
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") return eat(), d.shift(f.key, e.key === "ArrowLeft" ? -1 : 1);
      if (e.key === "[" || e.key === "]") return eat(), d.stretch(f.key, e.key === "[" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ── drag: a bar moves by whole weeks; an edge changes its length ──
  const onBarDown = (e: React.PointerEvent, g: GhostProject) => {
    if (e.button !== 0 || !review) return;
    const body = bodyRef.current;
    if (!body) return;
    e.preventDefault();
    draft.setCursor(g.key);
    const colW = body.getBoundingClientRect().width / N;
    const edge = (e.target as HTMLElement).closest("[data-edge]")?.getAttribute("data-edge");
    const x0 = e.clientX;
    const s0 = g.span;
    let cur = s0;
    let moved = false;
    const spanAt = (x: number): ProjectSpan => {
      const d = Math.round((x - x0) / colW);
      if (edge === "start") {
        const start = Math.min(s0.start + s0.weeks - 1, Math.max(0, s0.start + d));
        return { start, weeks: s0.start + s0.weeks - start };
      }
      if (edge === "end") return { start: s0.start, weeks: Math.max(1, Math.min(N - s0.start, s0.weeks + d)) };
      return { start: Math.max(0, Math.min(N - s0.weeks, s0.start + d)), weeks: s0.weeks };
    };
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 4) moved = true;
      if (!moved) return;
      cur = spanAt(ev.clientX);
      setDragging({ key: g.key, span: cur });
    };
    const end = () => {
      dispose();
      cancelDrag();
      if (moved) draft.setSpan(g.key, cur);
      setDragging(null);
    };
    const cancelDrag = armDragCancel(() => {
      dispose();
      setDragging(null);
    });
    const dispose = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const spanOf = (g: GhostProject) => (dragging?.key === g.key ? dragging.span : g.span);
  const rows = packRows([
    ...draft.own.map((o) => ({ id: o.id, start: o.start, weeks: o.weeks })),
    ...draft.ghosts.map((g) => ({ id: g.key, ...spanOf(g) })),
  ]);
  const place = (span: ProjectSpan, id: string) => ({
    left: `calc(${(span.start / N) * 100}% + 3px)`,
    width: `calc(${(span.weeks / N) * 100}% - 6px)`,
    top: 12 + (rows.get(id) ?? 0) * ROW_PX,
  });
  const height = 24 + (Math.max(0, ...rows.values()) + 1) * ROW_PX;

  const head = (iso: string) => {
    const d = new Date(iso + "T12:00:00");
    return { day: d.getDate(), month: d.toLocaleDateString(undefined, { month: "short" }) };
  };

  return (
    <div ref={rootRef} tabIndex={-1} className="pdq" style={{ ["--n" as string]: N, ["--h" as string]: color }} role="region" aria-label={`Draft the projects for ${initiative.name}`}>
      <div className="pdq-grid">
        <div className="pdq-head">
          {weeks.map((w) => {
            const h = head(w);
            return (
              <div key={w}>
                <b className="mono">{h.day}</b>
                <span>{h.month}</span>
              </div>
            );
          })}
        </div>
        <div className="pdq-load" title="Projects under this initiative running each week">
          {draft.load.map((n, i) => (
            <div key={weeks[i]} className="mono">
              {n || ""}
            </div>
          ))}
        </div>
        <div className="pdq-body" ref={bodyRef}>
          <div className="pdq-cols" aria-hidden>
            {weeks.map((w) => (
              <span key={w} />
            ))}
          </div>
          <div className="pdq-bars" style={{ height }}>
            {draft.own.map((o) => (
              <div key={o.id} className="pdq-bar" data-own="" style={place(o, o.id)} title={o.outcome || o.name}>
                <span className="pdq-bar-name">{o.name}</span>
                <span className="pdq-bar-meta">{o.shipped ? "shipped" : o.outcome || "yours"}</span>
              </div>
            ))}
            {draft.ghosts.map((g) => {
              const on = g.key === draft.cursor;
              return (
                <div
                  key={g.key}
                  className="pdq-bar"
                  data-ghost=""
                  data-on={on ? "" : undefined}
                  data-quiet={draft.cursor && !on ? "" : undefined}
                  data-lifted={dragging?.key === g.key ? "" : undefined}
                  style={place(spanOf(g), g.key)}
                  onPointerDown={(e) => onBarDown(e, g)}
                  onClick={() => draft.setCursor(g.key)}
                  {...pressable(() => draft.setCursor(g.key), { label: g.name })}
                >
                  <span data-edge="start" className="pdq-edge" data-side="start" aria-hidden />
                  <span data-edge="end" className="pdq-edge" data-side="end" aria-hidden />
                  <span className="pdq-bar-name">{g.name}</span>
                  <span className="pdq-bar-meta">{g.outcome}</span>
                  {g.versions.length > 1 && (
                    <span className="pdq-bar-ver mono">
                      {g.v + 1}/{g.versions.length}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="pdq-walk" aria-label="The draft">
        <div className="pdq-walk-top">
          <div className="min-w-0">
            <div className="text-caption text-muted">{quarterLabel}</div>
            <div className="truncate text-body font-semibold">{initiative.name}</div>
          </div>
          <Button size="xs" kind="ghost" onClick={onClose}>
            Back to quarters
          </Button>
        </div>
        {draft.ghosts.length > 0 && (
          <div className="pdq-pips" role="tablist" aria-label="Drafted projects">
            {draft.ghosts.map((g) => (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={g.key === draft.cursor}
                aria-label={g.name}
                className="pdq-pip"
                data-on={g.key === draft.cursor ? "" : undefined}
                onClick={() => draft.setCursor(g.key)}
              />
            ))}
          </div>
        )}

        <div className="pdq-walk-body">
          {draft.phase === "reading" ? (
            <p className="text-caption text-muted">{ASSISTANT_NAME} is reading the outcome and the projects you already have…</p>
          ) : draft.phase === "streaming" ? (
            <p className="text-caption text-muted">Drafting…</p>
          ) : focus ? (
            <Focus key={focus.key} g={focus} weeks={weeks} draft={draft} />
          ) : (
            <p className="text-caption text-muted">
              {draft.message ??
                (draft.held
                  ? `Held ${draft.held} project${draft.held === 1 ? "" : "s"}. Each is on the project deck in its weeks, with no steps yet — Draft the path fills one in when it's about to land.`
                  : "Nothing drafted is left.")}
            </p>
          )}
          {review && draft.message && focus && <p className="text-caption text-muted">{draft.message}</p>}
        </div>

        <div className="pdq-walk-foot">
          {draft.phase === "reading" && <div className="path-draft-reading" role="progressbar" aria-label="Drafting" />}
          {review && draft.remaining > 0 && (
            <>
              <Input
                ref={steerRef}
                size="sm"
                placeholder="Steer what you haven't held…"
                aria-label="Steer the draft"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.currentTarget.value.trim()) {
                    e.preventDefault();
                    void draft.steer(e.currentTarget.value);
                    e.currentTarget.value = "";
                  } else if (e.key === "Escape") e.currentTarget.blur();
                }}
              />
              <div className="path-draft-chips">
                {PROJECT_STEERS.map((s) => (
                  <ChipButton key={s} onClick={() => void draft.steer(s)}>
                    {s}
                  </ChipButton>
                ))}
              </div>
            </>
          )}
          <div className="flex justify-end gap-1.5">
            {review && draft.remaining > 0 ? (
              <>
                <Button size="xs" kind="ghost" onClick={draft.discard} shortcut="esc">
                  Discard rest
                </Button>
                <Button size="xs" kind="primary" onClick={draft.holdAll} shortcut="⇧↵">
                  Hold all
                </Button>
              </>
            ) : draft.phase === "done" ? (
              <Button size="xs" kind="primary" onClick={onClose}>
                Done
              </Button>
            ) : (
              <Button size="xs" kind="ghost" onClick={draft.discard} shortcut="esc">
                Stop
              </Button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** The bar the keys are on: what it is, why, where, and every act on it. */
function Focus({ g, weeks, draft }: { g: GhostProject; weeks: string[]; draft: ReturnType<typeof useProjectDraft> }) {
  return (
    <>
      <Input
        size="md"
        defaultValue={g.name}
        aria-label="Project name"
        className="pdq-name"
        onBlur={(e) => draft.rename(g.key, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") {
            e.preventDefault();
            if (e.key === "Enter") draft.rename(g.key, e.currentTarget.value);
            e.currentTarget.blur();
          }
        }}
      />
      <dl className="pdq-facts">
        <dt>Done when</dt>
        <dd>{g.outcome || "—"}</dd>
        <dt>Runs</dt>
        <dd className="mono">{spanLabel(weeks, g.span)}</dd>
        {g.why && (
          <>
            <dt>Why</dt>
            <dd>{g.why}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" kind="primary" onClick={() => draft.hold(g.key)} shortcut="↵">
          Hold
        </Button>
        <Button size="xs" onClick={() => draft.drop(g.key)} shortcut="⌫">
          Drop
        </Button>
      </div>
      <div className="pdq-nudge">
        <span className="text-caption text-muted">Move</span>
        <IconButton size="xs" label="A week earlier" shortcut="←" icon={<Icon name="chevron-left" size={13} />} onClick={() => draft.shift(g.key, -1)} />
        <IconButton size="xs" label="A week later" shortcut="→" icon={<Icon name="chevron-right" size={13} />} onClick={() => draft.shift(g.key, 1)} />
        <Button size="xs" kind="ghost" shortcut="[" onClick={() => draft.stretch(g.key, -1)}>
          Shorter
        </Button>
        <Button size="xs" kind="ghost" shortcut="]" onClick={() => draft.stretch(g.key, 1)}>
          Longer
        </Button>
      </div>
      {g.versions.length > 1 && (
        <div className="grid gap-1.5">
          <span className="text-caption font-semibold text-muted">Versions</span>
          {g.versions.map((v, i) => (
            <button key={`${v.name}-${i}`} type="button" className="pdq-version" data-on={i === g.v ? "" : undefined} onClick={() => draft.version(g.key, i)}>
              <span className="pdq-version-name">
                {v.name}
                <Kbd keys={String(i + 1)} />
              </span>
              <span className="pdq-version-out">{v.outcome}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
