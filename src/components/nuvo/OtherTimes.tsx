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
import { toast } from "sonner";
import { Button, Kbd, Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from "../kit";
import { PickSheet } from "../mobile/sheetKit";
import { useWeekComposer } from "../../hooks/useFindTime";
import { checkPick, costFor, nameAlternatives, snapPick, type Where } from "../../lib/offerChoices";
import { clearOfferChoice, setOfferChoice } from "../../lib/offerPreview";
import { whenLabel } from "../../lib/readyCards";
import { instantAt } from "../plan/destinations";
import { parseDateISO, toDateISO } from "../../lib/dates";
import { mondayOf } from "../../../supabase/functions/_shared/planningRules.ts";
import { isTypingIn } from "../../lib/a11y";
import type { Task } from "../../lib/types";
import { useAllTasks } from "../../hooks/useTasks";
import type { ReadyCard } from "../../lib/readyCards";

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
  // The week the first answer sits in — next week's, when the slate is.
  const w = useWeekComposer(now, mondayOf(first.dayISO));
  const options = useMemo<Option[]>(() => {
    const days = first.dayISO === w.today || w.weekStartISO <= w.today ? [parseDateISO(w.today).getDay(), ...w.laterDays] : w.laterDays;
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

const noop = () => {};
const hintOf = (o: Option) => (o.cost ? `${o.reason} · ${o.cost}` : o.reason);

export function OtherTimes({
  task,
  first,
  onHold,
  phone = false,
  compact = false,
  touch = false,
  verb = "Schedule",
  noes = [],
}: {
  /** the verb the first answer's act says — a repair moves, a hold schedules */
  verb?: string;
  /** under a finger: a 44px target beside a card's 44px act */
  touch?: boolean;
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
        size={touch ? "md" : compact ? "xs" : "sm"}
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
        className={touch ? "offer-other tap" : "offer-other"}
      >
        {compact ? <span aria-hidden>⋯</span> : "Other times"}
      </Button>
      {phone
        ? open && <PhoneChooser task={task} first={first} onHold={onHold} noes={noes} onClose={reset} verb={verb} />
        : (open || picking) && (
            // The menu is a portal, but React still bubbles its clicks through
            // the row it was opened from — so "Pick a time yourself…" also
            // opened the task's popover over the very grid you were to click.
            <span style={{ display: "contents" }} onClick={(e) => e.stopPropagation()} onPointerDown={stop} onMouseDown={stop} onDoubleClick={stop}>
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
              verb={verb}
            />
            </span>
          )}
    </>
  );
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

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
  verb,
}: {
  verb: string;
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
  const live = useRef({ onMine, onHold, options });
  live.current = { onMine, onHold, options };
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
      // a numbered time on the grid, clicked: that's the choice — the same act
      // as choosing it in the menu. It used to only light the option and
      // reopen the menu, and the solid one did nothing at all, so clicking the
      // time you wanted, again and again, never placed it.
      onChoose: (key) => {
        const o = live.current.options.find((x) => x.key === key);
        if (!o) return;
        if (o.past) return void toast("That time has passed");
        live.current.onHold(o.at, null);
      },
      onPickTime: (start) => live.current.onMine(snapPick(start, first.durationMin, toDateISO(start))),
    });
  }, [id, options, strong, task.title, first.durationMin]);
  useEffect(() => () => clearOfferChoice(id), [id]);

  // The menu closes as "Pick a time yourself…" is chosen; that close must not
  // read as a cancel, so the intent is noted before the menu says it closed.
  const pickingRef = useRef(picking);
  pickingRef.current = picking;

  // Where the press that may close the menu landed. On `window` in the capture
  // phase, so it is known before the menu's own (document) listener closes it.
  const downOnGrid = useRef(false);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      downOnGrid.current = Boolean((e.target as HTMLElement | null)?.closest?.("[data-calendar-pane]"));
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);

  // 1 · 2 · 3 — the numbers the menu and the grid share choose that time,
  // whether the menu is open or you're picking on the grid. Taken before the
  // Schedule's own 1–5 (its views) can read them.
  const liveHold = useRef({ options, onHold, anchor });
  liveHold.current = { options, onHold, anchor };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingIn(e.target)) return;
      const n = Number(e.key);
      const o = Number.isInteger(n) && n >= 1 ? liveHold.current.options[n - 1] : undefined;
      if (!o || o.past) return;
      e.preventDefault();
      e.stopPropagation();
      liveHold.current.onHold(o.at, liveHold.current.anchor);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

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
          else if (downOnGrid.current) {
            // A press on the Schedule while the menu is open IS a pick (a
            // ghost, or your own time) — not a click away. It used to cancel
            // the chooser, so the click that followed answered nothing.
            pickingRef.current = true;
            onPicking(true);
            onOpen(false);
          } else onCancel();
        }}
        label={`Other times for ${task.title}`}
        placement="bottom-start"
      >
        <MenuLabel>Other times</MenuLabel>
        {options.map((o, i) => (
          <div key={o.key} onPointerEnter={() => setStrong(o.key)} onFocusCapture={() => setStrong(o.key)}>
            <MenuItem
              icon={<span className="offer-num" data-on={o.key === strong || undefined}>{i + 1}</span>}
              detail={hintOf(o)}
              disabled={o.past}
              onSelect={(e) => onHold(o.at, e.currentTarget)}
            >
              {verb} {whenLabel(o.at, today)}
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
      {/* A float under the ⋯, never a line in the row (a row has no room for
          it, and it spilled). Its close is a no-op: a click on the grid IS the
          pick, and Esc is handled above. */}
      <Popover anchor={anchor} open={picking} onClose={noop} role="status" label="Picking a time" className="offer-picking">
        Click a time on the Schedule <Kbd keys="Esc" />
      </Popover>
    </>
  );
}

function PhoneChooser({
  task,
  first,
  onHold,
  noes,
  onClose,
  verb,
}: {
  verb: string;
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
        // the same 1 · 2 · 3 the desktop menu and the Schedule draw; a "no"
        // is not an option among them, so it carries no mark
        ...options.map((o, i) => ({
          id: o.key,
          name: `${verb} ${whenLabel(o.at, today)}`,
          sub: hintOf(o),
          lead: (
            <span className="offer-num" data-on={i === 0 || undefined}>
              {i + 1}
            </span>
          ),
        })),
        ...noes.map((n, i) => ({ id: `no${i}`, name: n.label, lead: <span aria-hidden /> })),
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

/** A Get ready card's Other times (R13) — every card that gives work a time
 *  carries it, on every surface that shows the card. A sitting (a slot being
 *  repaired) stands in as a task of its length: the composer only needs what
 *  it is called and how long it runs. Nothing for a card that isn't a time. */
export function CardOtherTimes(props: { card: ReadyCard; phone?: boolean; touch?: boolean }) {
  // only a card that gives work a time reads anything
  const { card } = props;
  return card.taskId && card.at && card.placeAt ? <CardOtherTimesLive {...props} /> : null;
}

function CardOtherTimesLive({ card, phone = false, touch = false }: { card: ReadyCard; phone?: boolean; touch?: boolean }) {
  const { data: tasks } = useAllTasks();
  const task = useMemo<Task | null>(() => {
    if (!card.taskId || !card.at) return null;
    return (
      tasks?.find((t) => t.id === card.taskId) ??
      ({ id: card.taskId, title: card.title, duration_minutes: card.at.durationMin, status: "planned" } as Task)
    );
  }, [tasks, card.taskId, card.title, card.at]);
  if (!task || !card.at || !card.placeAt) return null;
  return <OtherTimes task={task} first={card.at} onHold={card.placeAt} phone={phone} touch={touch} verb={card.primary.verb} />;
}
