/**
 * Other times (docs/offer-rules.md R13, D-216) — the second answer every time
 * offer carries. Always shown beside the chip, never revealed on hover.
 *
 * Opening it asks the composer again (`alternativesFor`, the same rules a draft
 * obeys) and keeps at most two alternatives that each differ for a reason they
 * name, with what each costs (`lib/offerChoices`). All options are drawn on the
 * Schedule at once, numbered (`setOfferChoice` → Planner's overlay): the one you
 * point at solid, the rest ghosts you can click. "Pick a time yourself" lets you
 * click open time on the grid; that pick is checked like the others.
 *
 * Choosing writes through the caller's `onHold` — the same act the chip's
 * first answer takes — so nothing here has a write path of its own (P3).
 *
 * On a phone (no grid beside the rail, no hover) the options open in a
 * `PickSheet` with their reasons and costs; picking one holds it.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator } from "../kit";
import { PickSheet } from "../mobile/sheetKit";
import { useWeekComposer } from "../../hooks/useFindTime";
import { checkPick, costFor, nameAlternatives, snapPick, type Where } from "../../lib/offerChoices";
import { clearOfferChoice, setOfferChoice } from "../../lib/offerPreview";
import { whenLabel } from "../../lib/readyCards";
import { instantAt } from "../plan/destinations";
import { parseDateISO, toDateISO } from "../../lib/dates";
import type { Task } from "../../lib/types";

interface Option {
  key: string;
  at: Where;
  reason: string;
  cost: string | null;
  past: boolean;
}

/** The first answer, its named alternatives, and your own pick. */
function useOptions(task: Task, first: Where, mine: Where | null) {
  const [now] = useState(() => new Date());
  const w = useWeekComposer(now);
  const options = useMemo<Option[]>(() => {
    const days = [parseDateISO(w.today).getDay(), ...w.laterDays];
    const candidates = w.alternatives(task, first, days).map((p) => ({ dayISO: p.dayISO, startMin: p.startMin, durationMin: p.durationMin }));
    const list: Option[] = [
      { key: "first", at: first, reason: "Best fit", cost: costFor(first, w.busy), past: false },
      ...nameAlternatives(first, candidates, w.today, w.busy).map((a, i) => ({ key: `alt${i}`, ...a, past: false })),
    ];
    if (mine) {
      const c = checkPick(mine, w.busy, w.now, w.today);
      list.push({ key: "mine", at: mine, reason: "Your pick", cost: c.cost, past: c.past });
    }
    return list;
  }, [w, task, first, mine]);
  return { options, today: w.today };
}

const hintOf = (o: Option) => (o.cost ? `${o.reason} · ${o.cost}` : o.reason);

export function OtherTimes({
  task,
  first,
  onHold,
  phone = false,
  compact = false,
  noes = [],
}: {
  task: Task;
  /** where the chip's first answer lands */
  first: Where;
  /** hold the task at the chosen time — the chip's own act, at another place */
  onHold: (at: Where, from: HTMLElement | null) => void;
  phone?: boolean;
  /** Saying no, from the same menu (R8): this offer for two weeks, and — for a
   *  project's work — every time offer for that project. */
  noes?: { label: string; run: () => void }[];
  /** a clock glyph instead of the words, for a row with no room (the label is
   *  still "Other times" — its name and tooltip) */
  compact?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [mine, setMine] = useState<Where | null>(null);
  const reset = () => {
    setOpen(false);
    setPicking(false);
    setMine(null);
  };
  return (
    <>
      <Button
        ref={btn}
        kind="ghost"
        size="xs"
        data-card-control=""
        aria-label="Other times"
        title={`Other times for ${task.title}`}
        aria-haspopup={phone ? "dialog" : "menu"}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="offer-other"
      >
        {compact ? <span aria-hidden>⋯</span> : "Other times"}
      </Button>
      {phone
        ? open && <PhoneChooser task={task} first={first} onHold={onHold} noes={noes} onClose={reset} />
        : (open || picking) && (
            <DeskChooser
              task={task}
              first={first}
              anchor={btn.current}
              open={open}
              picking={picking}
              mine={mine}
              onMine={(at) => {
                setMine(at);
                setPicking(false);
                setOpen(true);
              }}
              onPicking={(v) => {
                setPicking(v);
                if (!v) setOpen(true);
              }}
              onOpen={setOpen}
              onHold={(at, el) => {
                reset();
                onHold(at, el);
              }}
              onCancel={reset}
              noes={noes}
            />
          )}
    </>
  );
}

function DeskChooser({
  task,
  first,
  anchor,
  open,
  picking,
  mine,
  onMine,
  onPicking,
  onOpen,
  onHold,
  onCancel,
  noes,
}: {
  noes: { label: string; run: () => void }[];
  task: Task;
  first: Where;
  anchor: HTMLElement | null;
  open: boolean;
  picking: boolean;
  mine: Where | null;
  onMine: (at: Where) => void;
  onPicking: (v: boolean) => void;
  onOpen: (v: boolean) => void;
  onHold: (at: Where, from: HTMLElement | null) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const { options, today } = useOptions(task, first, mine);
  const [strong, setStrong] = useState<string>(mine ? "mine" : "first");
  useEffect(() => {
    if (mine) setStrong("mine");
  }, [mine]);

  // Draw every option on the Schedule while this is open (R3 · R13).
  const live = useRef({ onMine, onPicking, onOpen });
  live.current = { onMine, onPicking, onOpen };
  useEffect(() => {
    setOfferChoice({
      id,
      options: options.map((o, i) => ({
        key: o.key,
        num: i + 1,
        label: task.title,
        start: instantAt(o.at.dayISO, o.at.startMin),
        end: instantAt(o.at.dayISO, o.at.startMin + o.at.durationMin),
      })),
      strong,
      onPick: (key) => {
        setStrong(key);
        live.current.onPicking(false);
        live.current.onOpen(true);
      },
      onPickTime: (start) => live.current.onMine(snapPick(start, first.durationMin, toDateISO(start))),
    });
  }, [id, options, strong, task.title, first.durationMin]);
  useEffect(() => () => clearOfferChoice(id), [id]);

  // The menu closes as "Pick a time yourself…" is chosen; that close must not
  // read as a cancel, so the intent is noted before the menu says it closed.
  const pickingRef = useRef(picking);
  pickingRef.current = picking;

  // Esc while picking on the grid: back to nothing chosen.
  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [picking, onCancel]);

  return (
    <>
      <Menu
        anchor={anchor}
        open={open}
        onClose={() => {
          if (pickingRef.current) onOpen(false);
          else onCancel();
        }}
        label={`Other times for ${task.title}`}
        placement="bottom-start"
      >
        <MenuLabel>Other times</MenuLabel>
        {options.map((o, i) => (
          <div key={o.key} onPointerEnter={() => setStrong(o.key)} onFocusCapture={() => setStrong(o.key)}>
            <MenuItem
              icon={<span className="offer-num" data-on={o.key === strong || undefined}>{i + 1}</span>}
              hint={hintOf(o)}
              disabled={o.past}
              onSelect={(e) => onHold(o.at, e.currentTarget)}
            >
              Schedule {whenLabel(o.at, today)}
            </MenuItem>
          </div>
        ))}
        <MenuSeparator />
        <MenuItem
          hint="Click open time on the Schedule"
          onSelect={() => {
            pickingRef.current = true;
            onPicking(true);
          }}
        >
          Pick a time yourself…
        </MenuItem>
        {noes.length > 0 && <MenuSeparator />}
        {noes.map((n) => (
          <MenuItem key={n.label} onSelect={() => n.run()}>
            {n.label}
          </MenuItem>
        ))}
      </Menu>
      {picking && (
        <span className="offer-picking" role="status">
          Click a time on the Schedule · Esc to cancel
        </span>
      )}
    </>
  );
}

function PhoneChooser({
  task,
  first,
  onHold,
  noes,
  onClose,
}: {
  task: Task;
  first: Where;
  onHold: (at: Where, from: HTMLElement | null) => void;
  noes: { label: string; run: () => void }[];
  onClose: () => void;
}) {
  const { options, today } = useOptions(task, first, null);
  return (
    <PickSheet
      title="Other times"
      rows={[
        ...options.map((o) => ({ id: o.key, name: `Schedule ${whenLabel(o.at, today)}`, sub: hintOf(o) })),
        ...noes.map((n, i) => ({ id: `no${i}`, name: n.label })),
      ]}
      value={null}
      onPick={(key) => {
        const o = options.find((x) => x.key === key);
        if (o) onHold(o.at, null);
        const n = key.startsWith("no") ? noes[Number(key.slice(2))] : null;
        if (n) n.run();
      }}
      onClose={onClose}
    />
  );
}
