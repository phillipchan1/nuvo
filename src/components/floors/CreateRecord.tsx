// New project / new initiative — the RECORD, before it exists.
//
// This replaces three surfaces (QuickCreate's bordered form, NewProject and
// NewInitiative's "full moment", and the "more options…" fork between them).
// They each wore their own grammar for an object that opens as a document the
// instant it's saved: a sans-semibold name in a boxed field with a flat focus
// ring, versus a Fraunces masthead on a 26px spine. The object changed typeface
// at birth, and the fork silently DISCARDED every subtask you'd typed (it only
// carried domain / initiative / name across).
//
// So creating is now the same sheet as owning: `recordFrame`'s document — the
// bar, the name and outcome, the work, the property panel — with local draft
// state instead of a row. ⌘⏎ / Create
// writes and dismisses — the work is already on the sheet, and swapping in
// the record used to leave a second modal on the history stack. Nothing about
// the fast path got slower: it is still name → ⏎ → ⌘⏎.
//
// What create adds to the frame, and why each one earns it:
//   · a footer with ONE commit. The record has no footer because esc / ✕ / the
//     scrim all close it, so a "Done" button was the loudest thing on the sheet.
//     Here the commit is the entire point of the surface, so it gets the accent.
//   · `✦ Draft the first steps` — NewProject's only unique capability, kept but
//     made OPT-IN. It used to fire on a 1500ms debounce as you typed, which is a
//     cold AI list at the front door: the human drives, Nuvo enriches.
//   · the panel carries domain, placement + readiness only. "Belongs here" and Activity
//     have nothing to say about a thing that doesn't exist yet — a silence, not
//     an empty box (D-035).

import { useMemo, useRef, useState } from "react";
import { endOfQuarter, format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { isOpenStatus } from "../../lib/vertical";
import { DEFAULT_PROJECT_DURATION_MINUTES } from "../../lib/types";
import type { Energy } from "../../lib/energy";
import { DomainPicker } from "./parts";
import DurationSelect from "../DurationSelect";
import TaskComposer, { type TaskComposerHandle } from "../tasks/TaskComposer";
import type { CaptureAction } from "../../lib/captureDraft";
import { useTaskMutations, type NewTaskInput } from "../../hooks/useTasks";
import { useTaskCapture } from "../../hooks/useTaskCapture";
import { deckWeight } from "../../lib/pace";
import { QuarterBand, WeekBand } from "../record/PlacementBand";
import {
  Bar,
  Body,
  Head,
  IconBtn,
  PopProp,
  PropSlot,
  ReadyTicks,
  RecordScrim,
  Sec,
  Sheet,
  useRecordKeys,
} from "../record/recordFrame";
import { Icon } from "../Icon";
import { Button, Dot, EmptyState, IconButton, Picker } from "../kit";
import { weekName } from "../../lib/week";
import { quarterName } from "../../lib/initiativeDeck";

type Kind = "project" | "initiative";

/** A task that isn't a row yet. Same shape the record's list will show. */
interface DraftTask {
  id: number;
  title: string;
  durationMins: number;
  energy: Energy | null;
  /** Everything else the line said (a day, labels, a note…), applied when the
   *  record exists. Nuvo's drafted steps have none. */
  input?: NewTaskInput;
}

export default function CreateRecord({
  kind,
  onClose,
  onCreated,
  initialDomainId,
  initialInitiativeId,
}: {
  kind: Kind;
  onClose: () => void;
  onCreated: (id: string) => void;
  initialDomainId?: string | null;
  initialInitiativeId?: string | null;
}) {
  const { data, addProject, addInitiative, addDomain } = useVertical();
  const taskMutations = useTaskMutations();
  const { preview } = useTaskCapture();
  const domains = useMemo(() => [...data.domains].sort((a, b) => a.sort - b.sort), [data.domains]);

  const [domainId, setDomainId] = useState(initialDomainId || domains[0]?.id || "");
  const [initiativeId, setInitiativeId] = useState<string | null>(initialInitiativeId ?? null);
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState("");
  // A bet without a finish line is a wish, so a quarter is pre-filled. A project
  // starts unplaced — putting it on a sprint is a decision, not a default.
  const [span, setSpan] = useState<{ startDate: string | null; targetDate: string | null }>(() =>
    kind === "initiative"
      ? { startDate: null, targetDate: format(endOfQuarter(new Date()), "yyyy-MM-dd") }
      : { startDate: null, targetDate: null },
  );
  // Only a placement the human actually chose puts the thing in motion — the
  // pre-filled quarter above must not.
  const [placed, setPlaced] = useState(false);
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initMenu, setInitMenu] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<TaskComposerHandle>(null);
  const rowRefs = useRef(new Map<number, HTMLInputElement>());
  const [initBtn, setInitBtn] = useState<HTMLButtonElement | null>(null);
  const nextId = useRef(1);

  useRecordKeys(sheetRef, onClose);

  const domain = domains.find((d) => d.id === domainId);
  const accent = domain?.color ?? "var(--accent)";
  const noun = kind === "project" ? "project" : "initiative";
  const canCreate = Boolean(domainId && name.trim());

  const inits = useMemo(
    () => data.initiatives.filter((i) => i.domainId === domainId && isOpenStatus(i.status)),
    [data.initiatives, domainId],
  );
  const selectedInit = inits.find((i) => i.id === initiativeId) ?? null;

  const openMins = tasks.reduce((s, t) => s + (t.durationMins || 0), 0);

  // ── draft tasks ────────────────────────────────────────────────────────────
  // A line typed here is parsed the same way as anywhere else; it just waits
  // for the record to exist before it's created. A repeat has no record-less
  // draft form, so it lands as a plain task with its words intact.
  const draftOf = (action: CaptureAction, text: string): DraftTask => {
    if (action.kind === "series") {
      return { id: nextId.current++, title: text, durationMins: action.template.duration_minutes, energy: null };
    }
    return {
      id: nextId.current++,
      title: action.input.title,
      durationMins: action.input.duration_minutes ?? DEFAULT_PROJECT_DURATION_MINUTES,
      energy: null,
      input: action.input,
    };
  };
  const onDraft = (action: CaptureAction, text: string) => setTasks((ts) => [...ts, draftOf(action, text)]);

  const removeRow = (id: number) => {
    const i = tasks.findIndex((t) => t.id === id);
    setTasks((ts) => ts.filter((t) => t.id !== id));
    const prev = tasks[i - 1];
    requestAnimationFrame(() => (prev ? rowRefs.current.get(prev.id)?.focus() : composerRef.current?.focus()));
  };

  // ── the opt-in scaffold ────────────────────────────────────────────────────
  const scaffold = async () => {
    if (drafting || name.trim().length < 4) return;
    setDrafting(true);
    try {
      const { data: res, error: fnErr } = await supabase.functions.invoke("agent", {
        body: { scaffoldDraft: { name: name.trim(), outcome: outcome.trim(), initiativeId, domainId } },
      });
      if (fnErr) throw fnErr;
      const drafts = (res?.tasks ?? []) as { title: string; energy: Energy | null; durationMins: number }[];
      setTasks((ts) => [
        ...ts,
        ...drafts.map((d) => ({
          id: nextId.current++,
          title: d.title,
          durationMins: d.durationMins || DEFAULT_PROJECT_DURATION_MINUTES,
          energy: d.energy ?? null,
        })),
      ]);
    } catch {
      setError(`${ASSISTANT_NAME} couldn't draft the steps. Type them and carry on.`);
    } finally {
      setDrafting(false);
    }
  };

  // ── commit ─────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!canCreate || busy) return;
    // The composer is a draft, not a row — tapping Create (especially on a
    // phone, where Return is "dismiss keyboard") used to throw away whatever
    // was still in the field. Fold it in before the write so the task they
    // typed is the task that lands.
    const pendingText = composerRef.current?.value().trim() ?? "";
    const pendingAction = pendingText ? preview(pendingText, composerRef.current?.literal()) : null;
    const toCreate = pendingAction ? [...tasks, draftOf(pendingAction, pendingText)] : tasks;
    if (pendingAction) {
      setTasks(toCreate);
      composerRef.current?.clear();
    }
    setBusy(true);
    setError(null);
    const today = format(new Date(), "yyyy-MM-dd");
    // A placement the human chose means the same thing here as a drop on the
    // deck or a tap on the record's band: it's in motion.
    const status = placed ? ("in_progress" as const) : undefined;
    try {
      const shared = {
        name: name.trim(),
        outcome: outcome.trim(),
        startDate: span.startDate ?? today,
        targetDate: span.targetDate,
        ...(status ? { status } : {}),
      };
      const created =
        kind === "project"
          ? await addProject(domainId, initiativeId, shared)
          : await addInitiative(domainId, shared);
      // Through the one create path, filed into the record that now exists —
      // unless the line named a home of its own with @.
      const home =
        kind === "project"
          ? { project_id: created.id, initiative_id: initiativeId, domain_id: domainId }
          : { project_id: null, initiative_id: created.id, domain_id: domainId };
      toCreate.forEach((t, i) => {
        const own = t.input && (t.input.project_id || t.input.initiative_id || t.input.domain_id);
        const input: NewTaskInput = {
          ...(t.input ?? {}),
          ...(own ? {} : home),
          title: t.title,
          duration_minutes: t.durationMins,
          energy: t.energy,
          sort_order: i,
        };
        if (!input.do_date) input.status = "backlog";
        void taskMutations.create(input);
      });
      onCreated(created.id);
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't create the ${noun}.`);
      setBusy(false);
    }
  };

  // ⌘⏎ commits from anywhere on the sheet, including mid-field.
  const onSheetKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  // ── no domains yet — point the way rather than show a dead sheet ───────────
  if (domains.length === 0) {
    return (
      <RecordScrim onClose={onClose}>
        <Sheet sheetRef={sheetRef} fit label="Start with a domain" style={{ maxWidth: 420 }}>
          <Bar trail={[kind === "project" ? "New project" : "New initiative"]} actions={<IconBtn glyph="✕" label="Close" onClick={onClose} />} />
          <div className="px-6 pb-6 pt-2">
            <EmptyState
              icon={<Icon name="package" size={20} />}
              action={
                <div className="mt-2 flex items-center justify-center gap-2">
                  <Button kind="ghost" size="md" onClick={onClose}>
                    Not now
                  </Button>
                  <Button kind="primary" size="md" onClick={() => void addDomain().then(onClose)}>
                    Create a domain
                  </Button>
                </div>
              }
            >
              Start with a domain
            </EmptyState>
          </div>
        </Sheet>
      </RecordScrim>
    );
  }

  const placedAt = span.startDate ?? span.targetDate;
  const draftPlace = { id: "draft", ...span };

  return (
    <RecordScrim onClose={onClose}>
      <Sheet sheetRef={sheetRef} fit label={kind === "project" ? "New project" : "New initiative"}>
        <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onSheetKey}>
          <Bar
            trail={[
              <>
                <Dot color={accent} />
                {domain?.name ?? "No domain"}
              </>,
              kind === "project" && selectedInit ? selectedInit.name : null,
              kind === "project" ? "New project" : "New initiative",
            ]}
            actions={<IconBtn glyph="✕" label="Close" onClick={onClose} />}
          />

          <Body
            main={
              <>
                <Head
                  name={name}
                  onName={setName}
                  namePlaceholder={kind === "project" ? "Name this project" : "Name this initiative"}
                  autoFocusName
                  outcome={outcome}
                  onOutcome={setOutcome}
                  outcomePlaceholder={
                    kind === "project"
                      ? "What does done look like, in one line?"
                      : "The outcome, one inspiring line — not a task"
                  }
                />

                <Sec
                  label={kind === "project" ? "Tasks" : "First tasks"}
                  count={tasks.length ? `0/${tasks.length}${openMins ? ` · ${deckWeight(openMins)}` : ""}` : undefined}
                  onAdd={() => composerRef.current?.focus()}
                  addLabel="Add a task"
                  actions={
                    // Opt-in, and only once there's a name worth thinking about.
                    <Button
                      kind="ghost"
                      size="xs"
                      icon={<Icon name="sparkles" size={12} style={{ color: "var(--accent)" }} />}
                      onClick={() => void scaffold()}
                      disabled={drafting || name.trim().length < 4}
                      title={name.trim().length < 4 ? "Name it first" : `Have ${ASSISTANT_NAME} propose the first steps`}
                    >
                      <span className={drafting ? "doc-pulse" : undefined}>{drafting ? "Drafting…" : "Draft steps"}</span>
                    </Button>
                  }
                >
                  {/* Rows first, composer at the foot — the record's order, so the
                      list doesn't reshuffle the moment you press Create. */}
                  {tasks.map((t) => (
                    <div key={t.id} className="doc-draft">
                      {/* the check it will wear one second from now, unchecked */}
                      <span className="doc-draft-box" aria-hidden />
                      <input
                        ref={(el) => {
                          if (el) rowRefs.current.set(t.id, el);
                          else rowRefs.current.delete(t.id);
                        }}
                        value={t.title}
                        onChange={(e) =>
                          setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, title: e.target.value } : x)))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); composerRef.current?.focus(); }
                          if (e.key === "Backspace" && t.title === "") { e.preventDefault(); removeRow(t.id); }
                          if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.blur(); }
                        }}
                        placeholder="Untitled task"
                        aria-label="Task"
                        className="nuvo-inline-input"
                        style={{ caretColor: accent }}
                      />
                      <span className="shrink-0 text-caption tabular-nums text-muted">
                        <DurationSelect
                          value={t.durationMins}
                          onChange={(m) => setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, durationMins: m } : x)))}
                          className="shrink-0 rounded-[var(--r-chip)] px-1 py-0.5"
                          title="Sitting length"
                        />
                      </span>
                      <span className="doc-draft-drop">
                        <IconButton size="xs" tabIndex={-1} label="Drop this step" icon={<Icon name="close" size={12} />} onClick={() => removeRow(t.id)} />
                      </span>
                    </div>
                  ))}

                  <TaskComposer
                    ref={composerRef}
                    placeholder="Add a task…"
                    onDraft={onDraft}
                    contextLabel={name.trim() ? { name: name.trim(), color: domain?.color ?? null } : null}
                  />
                </Sec>
              </>
            }
            props={
              <>
                <PropSlot label="Domain">
                  <DomainPicker
                    domains={domains}
                    value={domainId}
                    size="lg"
                    align="right"
                    onChange={(id) => {
                      setDomainId(id);
                      setInitiativeId(null); // an initiative lives in one domain
                    }}
                  />
                </PropSlot>
                {kind === "project" && inits.length > 0 && (
                  <div className="k-prop">
                    <span className="k-prop-label">Initiative</span>
                    <button
                      ref={setInitBtn}
                      type="button"
                      className="k-prop-value"
                      data-empty={selectedInit ? undefined : ""}
                      aria-haspopup="menu"
                      aria-expanded={initMenu}
                      title="Nest this under an initiative"
                      onClick={() => setInitMenu((o) => !o)}
                    >
                      {selectedInit ? selectedInit.name : "None"}
                    </button>
                    <Picker
                      anchor={initBtn}
                      open={initMenu}
                      onClose={() => setInitMenu(false)}
                      placement="left-start"
                      label="Initiative"
                      value={initiativeId ?? "__none__"}
                      options={[{ value: "__none__", label: "No initiative" }, ...inits.map((i) => ({ value: i.id, label: i.name }))]}
                      onChange={(v) => {
                        setInitiativeId(v === "__none__" ? null : v);
                        setInitMenu(false);
                      }}
                    />
                  </div>
                )}
                <PopProp
                  label={kind === "project" ? "Week" : "Quarter"}
                  empty={!placedAt}
                  open={placeOpen}
                  onOpenChange={setPlaceOpen}
                  value={
                    <>
                      <Icon name="clock" size={14} style={{ color: "var(--muted)" }} />
                      {kind === "project"
                        ? placedAt
                          ? weekName(placedAt)
                          : "Not placed"
                        : span.targetDate
                          ? quarterName(new Date(span.targetDate + "T12:00:00"))
                          : "Not placed"}
                    </>
                  }
                >
                  {() => (
                    <div className="doc-place">
                      {kind === "project" ? (
                        <WeekBand
                          p={draftPlace}
                          onPlace={(patch) => { setSpan((s) => ({ ...s, ...patch })); setPlaced(true); }}
                          color={accent}
                        />
                      ) : (
                        <QuarterBand
                          i={draftPlace}
                          onPlace={(patch) => { setSpan((s) => ({ ...s, ...patch })); setPlaced(true); }}
                          color={accent}
                        />
                      )}
                    </div>
                  )}
                </PopProp>
                <div className="doc-props-sep" />
                <ReadyTicks
                  axes={[
                    { label: kind === "project" ? "Outcome" : "Objective", met: outcome.trim() !== "" },
                    { label: kind === "project" ? "Steps" : "First step", met: tasks.length > 0 },
                  ]}
                />
              </>
            }
          />

          {/* The one thing the record doesn't have, because here it's the point. */}
          <div className="doc-foot">
            <span className="doc-foot-note" role={error ? "alert" : undefined}>
              {error}
            </span>
            <Button kind="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              kind="primary"
              size="md"
              onClick={() => void submit()}
              disabled={!canCreate || busy}
              shortcut={["⌘", "↵"]}
            >
              {busy
                ? "Creating…"
                : tasks.length > 0
                  ? `Create with ${tasks.length} task${tasks.length === 1 ? "" : "s"}`
                  : `Create ${noun}`}
            </Button>
          </div>
        </div>
      </Sheet>
    </RecordScrim>
  );
}
