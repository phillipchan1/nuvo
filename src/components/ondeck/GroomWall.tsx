// Projects → Groom — the Board (D-190). The same deck you time-box, sorted
// instead by how shaped each project is: a column per readiness tier — Raw ·
// Grooming · Ready, and Parked when anything rests — each with a 32px header
// (the readiness pie · the tier · its count · ＋ on Raw). Every project is one
// kit Card: its title, the three checks it has met (filled) and is missing
// (faint), and a meta row of chips.
//
// Pick a card and it opens in place into its workbench — the brief that closes
// Defined, the steps (the app's one task list: TaskListView — the real row,
// the shared keys, the one add box) that close Planned, Park and Ship. No
// modal, no one-at-a-time flow: the board *is* the groom surface. A picked
// card holds its column while you work in it (so typing a step never moves it
// out from under the caret) and settles into its new one when you let go.
//
// Reuse-first: the lanes (axes / readyTier / pace) come straight from
// readOnDeck. This file only arranges them.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
import { Icon } from "../Icon";
import { useVertical } from "../../hooks/useVertical";
import { useRecordContextMenu } from "../RecordContextMenu";
import { domainById, tasksOf, type VerticalData } from "../../lib/vertical";
import { type OnDeckLane, type ReadyTier } from "../../lib/onDeck";
import { hasRoutingSignal, proofreadOutcome, suggestDomain, type DomainSuggestion, type ProofreadResult } from "../../lib/groomAI";
import { ProjectShipAssess } from "../record/ShipAssess";
import type { Task } from "../../lib/types";
import TaskListView from "../tasks/TaskListView";
import { byManualOrder } from "../../lib/taskOrder";
import { useAllTasks } from "../../hooks/useTasks";
import { useAppNavigation } from "../../hooks/useAppNavigation";
import { Button, Card, Chip, ChipButton, Dot, EmptyState, IconButton, Readiness, type ReadinessStep } from "../kit";
import { isTypingIn } from "../../lib/a11y";

type Tier = Exclude<ReadyTier, "done">;

const COLUMNS: { tier: Tier; label: string; step: ReadinessStep | null }[] = [
  { tier: "raw", label: "Raw", step: 0 },
  { tier: "grooming", label: "Grooming", step: 2 },
  { tier: "ready", label: "Ready", step: 3 },
  { tier: "parked", label: "Parked", step: null },
];

/** One check on a card: met is a filled box, missing is a faint one. */
export function CardCheck({ met, children, title }: { met: boolean; children: React.ReactNode; title?: string }) {
  return (
    <div className="fl-check" data-missing={met ? undefined : ""} title={title}>
      <span className="fl-check-box" aria-hidden />
      <span>{children}</span>
      <span className="sr-only">{met ? " — done" : " — missing"}</span>
    </div>
  );
}

/** A board column's 32px head: the readiness pie · the name · the count · ＋. */
export function ColumnHead({
  step,
  label,
  count,
  onAdd,
  addLabel,
}: {
  step: ReadinessStep | null;
  label: string;
  count: number;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="fl-colh">
      {step == null ? <Dot color="var(--faint)" shape="round" /> : <Readiness step={step} />}
      <span>{label}</span>
      <span className="k-count">{count}</span>
      <span className="k-grow" />
      {onAdd && <IconButton size="xs" label={addLabel ?? "Add"} icon={<Icon name="plus" size={14} />} onClick={onAdd} />}
    </div>
  );
}

function GroomCard({
  data,
  lane,
  selected,
  onSelect,
  onOpen,
}: {
  data: VerticalData;
  lane: OnDeckLane;
  selected: boolean;
  onSelect: () => void;
  onOpen: (id: string) => void;
}) {
  const store = useVertical();
  const { onContextMenu, menu } = useRecordContextMenu();
  const p = lane.project;
  const domain = domainById(data, p.domainId);
  // d.tasks is built pre-sorted by sort_order, so filtering preserves order.
  const existing = tasksOf(data, p.id).filter((t) => t.status !== "done");

  // The steps are real tasks, drawn by the app's one list (TaskListView).
  const { data: allTasks } = useAllTasks();
  const { openOverlay } = useAppNavigation();
  const stepRows = useMemo(() => {
    const byId = new Map((allTasks ?? []).map((t) => [t.id, t]));
    return byManualOrder(existing.map((v) => byId.get(v.id)).filter((t): t is Task => Boolean(t)));
  }, [existing, allTasks]);
  // A wall has many lists; only the card you're working in hears the keys.
  const [active, setActive] = useState(false);

  // ── defining the project: the outcome line closes the "Defined" axis ─────────
  const [outcome, setOutcome] = useState(p.outcome ?? "");
  const saveOutcome = () => {
    const v = outcome.trim();
    if (v !== (p.outcome ?? "").trim()) store.updateProject(p.id, { outcome: v });
  };

  // ── status: finish it (drops off the wall) or park it (rests, greys, sorts right)
  // Shipping asks first — same moment as the record and the deck. The card only
  // fades once you've said yes; the assessment owns the write.
  const [completing, setCompleting] = useState(false);
  const [shipping, setShipping] = useState(false);
  const parked = lane.readyTier === "parked";
  const markDone = () => setShipping(true);
  const togglePark = () => store.updateProject(p.id, { status: parked ? "in_progress" : "waiting" });

  // ── AI · auto domain suggestion (only when the area is empty + there's signal)
  const [domSug, setDomSug] = useState<DomainSuggestion | null>(null);
  const [domDismissed, setDomDismissed] = useState(false);
  const domFetched = useRef(false);
  const needsDomain = !p.domainId && hasRoutingSignal(data, p);
  useEffect(() => {
    if (!needsDomain || domDismissed || domFetched.current) return;
    domFetched.current = true;
    suggestDomain(data, p)
      .then((s) => setDomSug(s))
      .catch((e) => console.warn("[groom] domain suggest failed", e));
  }, [needsDomain, domDismissed, data, p]);
  const acceptDomain = () => {
    if (domSug) store.updateProject(p.id, { domainId: domSug.domain.id });
    setDomSug(null);
  };

  // ── AI · proofread the brief (on-demand — you press "Tighten") ───────────────
  const [proof, setProof] = useState<ProofreadResult | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const tighten = async () => {
    if (proofBusy || !outcome.trim()) return;
    setProofBusy(true);
    setProof(null);
    try {
      // proofread the CURRENT text, saving first so the model sees your latest line.
      saveOutcome();
      const r = await proofreadOutcome(data, { ...p, outcome });
      setProof(r);
    } catch (e) {
      console.warn("[groom] proofread failed", e);
    } finally {
      setProofBusy(false);
    }
  };
  const acceptTighten = () => {
    if (proof?.tightened) {
      setOutcome(proof.tightened);
      store.updateProject(p.id, { outcome: proof.tightened });
    }
    setProof(null);
  };

  // The date is a fact on the card; only a passed one wears a tone (the pace
  // read — behind, stalled — is never printed on a card).
  const due = p.targetDate ? format(new Date(p.targetDate + "T00:00:00"), "MMM d") : null;
  const overdue = lane.pace.read === "overdue";

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.key !== "Enter") return;
    e.preventDefault();
    if (selected) onOpen(p.id);
    else onSelect();
  };

  return (
    <Card
      interactive
      selected={selected}
      tabIndex={0}
      aria-label={p.name}
      data-parked={parked ? "" : undefined}
      data-leaving={completing ? "" : undefined}
      className="fl-card"
      onClick={(e) => {
        // a click from a portal (the record menu, the ship sheet) isn't a pick
        if (!selected && e.currentTarget.contains(e.target as Node)) onSelect();
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, input, textarea, [contenteditable=true], [role=textbox], .fl-work")) return;
        onOpen(p.id);
      }}
      onKeyDown={onKeyDown}
      onFocus={() => setActive(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActive(false);
      }}
      onPointerDown={() => setActive(true)}
      onContextMenu={onContextMenu("project", p.id)}
    >
      {menu}
      <div className="fl-card-top">
        <div className="fl-card-title">{p.name}</div>
        {selected && (
          <div className="fl-card-acts">
            <IconButton size="xs" label="Open the record" icon={<ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />} onClick={() => onOpen(p.id)} />
          </div>
        )}
      </div>

      <div className="fl-checks">
        <CardCheck met={lane.axes.defined}>Outcome</CardCheck>
        <CardCheck met={lane.axes.planned}>{existing.length ? `Steps · ${existing.length}` : "Steps"}</CardCheck>
        {lane.axes.fits !== null && <CardCheck met={lane.axes.fits}>Fits a week</CardCheck>}
      </div>

      <div className="fl-meta">
        {domain ? <Chip dot={domain.color}>{domain.name}</Chip> : <Chip>No domain</Chip>}
        {due && (
          <Chip tone={overdue ? "danger" : "neutral"} icon={<Icon name="calendar" size={12} />}>
            {due}
          </Chip>
        )}
      </div>

      {selected && (
        <div className="fl-work" onClick={(e) => e.stopPropagation()}>
          {/* AI · auto domain chip — surfaces only when the area is empty + there's
              signal (title + brief/steps). Proposes; the tap assigns. */}
          {domSug && !p.domainId && (
            <div className="fl-propose" data-dashed="">
              <div>
                Looks like <span className="font-semibold">{domSug.domain.name}</span>
              </div>
              <div className="fl-work-row">
                <Button kind="primary" size="xs" className="tap" onClick={acceptDomain} title={domSug.reason || "Assign this area"}>
                  File it there
                </Button>
                <Button kind="ghost" size="xs" className="tap" onClick={() => { setDomDismissed(true); setDomSug(null); }}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {/* the brief — one line that defines done; closes the Defined axis. Plain
              text so iOS dictation works; saves on blur. Tighten proofreads it. */}
          <div className="grid gap-1.5">
            <div className="k-field fl-tight" data-multiline="">
              <textarea
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                onBlur={saveOutcome}
                rows={3}
                placeholder="What does done look like?"
                aria-label="Outcome"
              />
            </div>
            {outcome.trim() && !proof && (
              <div className="fl-work-row">
                <Button
                  kind="ghost"
                  size="xs"
                  icon={<Icon name="sparkles" size={13} />}
                  onClick={() => void tighten()}
                  disabled={proofBusy}
                  title="Proofread — tighten this line"
                >
                  {proofBusy ? "Tightening…" : "Tighten"}
                </Button>
              </div>
            )}
            {proof && (
              <div className="fl-propose">
                {proof.changed ? (
                  <>
                    <div>{proof.tightened}</div>
                    <div className="fl-work-row">
                      <Button kind="primary" size="xs" className="tap" onClick={acceptTighten}>Use this</Button>
                      <Button kind="ghost" size="xs" className="tap" onClick={() => setProof(null)}>Keep mine</Button>
                    </div>
                  </>
                ) : (
                  <div className="fl-work-row">
                    <span className="text-caption">Already sharp.</span>
                    <span className="k-grow" />
                    <Button kind="ghost" size="xs" onClick={() => setProof(null)}>OK</Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The steps — the app's one task list: the real row, the shared keys
              (while this card has focus), drag to reorder, and the one add box.
              Each line lands as you press ↵, so the checks above move as you type;
              "30m" in the line sets its length. */}
          <TaskListView
            className="max-h-[46vh] overflow-y-auto"
            tasks={stepRows}
            context={{ projectId: p.id, initiativeId: p.initiativeId, domainId: p.domainId }}
            keyboard={active}
            onOpen={(t) => openOverlay("task-record", t.id)}
            flush
            composerPlaceholder={existing.length ? "Add a step…" : "What's the first move?"}
          />

          <div className="fl-work-row">
            <Button
              kind="secondary"
              size="xs"
              className="tap"
              icon={<Icon name="check" size={13} />}
              onClick={markDone}
              aria-label="Mark project complete"
              title="Finished — ship it"
            >
              Ship
            </Button>
            <Button
              kind="ghost"
              size="xs"
              className="tap"
              onClick={togglePark}
              title={parked ? "Bring it back onto the deck" : "Park it — rest it without finishing"}
            >
              {parked ? "Unpark" : "Park"}
            </Button>
          </div>
        </div>
      )}

      {/* An unfiled project with a suggestion says so on the card at rest too —
          the one proposal worth seeing before you pick it. */}
      {!selected && domSug && !p.domainId && (
        <div className="fl-meta" onClick={(e) => e.stopPropagation()}>
          <ChipButton data-tone="accent" icon={<Icon name="sparkles" size={12} />} onClick={acceptDomain} title={domSug.reason || "Assign this area"}>
            File in {domSug.domain.name}
          </ChipButton>
        </div>
      )}

      {shipping && (
        <ProjectShipAssess id={p.id} onClose={() => setShipping(false)} onShipped={() => setCompleting(true)} />
      )}
    </Card>
  );
}

export default function GroomWall({ lanes, onOpen }: { lanes: OnDeckLane[]; onOpen: (id: string) => void }) {
  const { data } = useVertical();
  const { openFloorModal } = useAppNavigation();
  // The picked card, and the column it was in when picked — it stays there
  // while you work in it, then settles where it now belongs.
  const [picked, setPicked] = useState<{ id: string; tier: Tier } | null>(null);

  const items = lanes.filter((l) => l.readyTier !== "done");
  const tierOf = (l: OnDeckLane): Tier => (picked?.id === l.project.id ? picked.tier : (l.readyTier as Tier));
  // Thinnest-first inside a column: the rawest present themselves at the top.
  const thin = (a: OnDeckLane, b: OnDeckLane) => a.readyCount - b.readyCount || a.project.name.localeCompare(b.project.name);
  const columns = COLUMNS.map((c) => ({ ...c, lanes: items.filter((l) => tierOf(l) === c.tier).sort(thin) })).filter(
    (c) => c.tier !== "parked" || c.lanes.length > 0,
  );

  // A picked project that left the board (shipped) lets go of its column.
  useEffect(() => {
    if (picked && !items.some((l) => l.project.id === picked.id)) setPicked(null);
  }, [items, picked]);

  // Esc lets go of the card (never while typing in it).
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || isTypingIn(e.target)) return;
      setPicked(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  if (items.length === 0) return <EmptyState>Nothing to groom</EmptyState>;

  return (
    <div
      className="fl-board"
      style={{ ["--fl-n" as string]: columns.length }}
      onClick={(e) => {
        // a click on the board itself (not a card, not a portal) lets go of the picked one
        const t = e.target as HTMLElement;
        if (e.currentTarget.contains(t) && !t.closest(".fl-card")) setPicked(null);
      }}
      // …and Esc is its keyboard path (the window listener catches it from anywhere else)
      onKeyDown={(e) => {
        if (e.key === "Escape" && !isTypingIn(e.target)) setPicked(null);
      }}
    >
      {columns.map((c) => (
        <section key={c.tier} className="fl-col" aria-label={c.label}>
          <ColumnHead
            step={c.step}
            label={c.label}
            count={c.lanes.length}
            onAdd={c.tier === "raw" ? () => openFloorModal("new-project") : undefined}
            addLabel="New project"
          />
          {c.lanes.length === 0 && <div className="fl-col-empty">None</div>}
          {c.lanes.map((l) => (
            <GroomCard
              key={l.project.id}
              data={data}
              lane={l}
              selected={picked?.id === l.project.id}
              onSelect={() => setPicked({ id: l.project.id, tier: l.readyTier as Tier })}
              onOpen={onOpen}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
