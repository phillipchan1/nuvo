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
// So creating is now the same sheet as owning: `recordFrame`'s Sheet · Head ·
// Body · Sec · rail, with local draft state instead of a row. ⌘⏎ / Create
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
//   · the rail carries placement + readiness only. "Belongs here" and Activity
//     have nothing to say about a thing that doesn't exist yet — a silence, not
//     an empty box (D-035).

import { useMemo, useRef, useState } from "react";
import { endOfQuarter, format } from "date-fns";
import { useVertical } from "../../hooks/useVertical";
import { supabase } from "../../lib/supabase";
import { ASSISTANT_NAME } from "../../lib/assistant";
import { isOpenStatus } from "../../lib/vertical";
import { parseCapture } from "../../lib/nlp";
import { DEFAULT_PROJECT_DURATION_MINUTES } from "../../lib/types";
import type { Energy } from "../../lib/energy";
import { DomainPicker, FloatingMenu } from "./parts";
import DurationSelect from "../DurationSelect";
import { deckWeight } from "../../lib/pace";
import { QuarterBand, WeekBand } from "../record/PlacementBand";
import {
  Body,
  GUT,
  Head,
  IconBtn,
  ReadyTicks,
  RecordScrim,
  Sec,
  Sheet,
  useRecordKeys,
} from "../record/recordFrame";

type Kind = "project" | "initiative";

/** A task that isn't a row yet. Same shape the record's list will show. */
interface DraftTask {
  id: number;
  title: string;
  durationMins: number;
  energy: Energy | null;
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
  const { data, addProject, addInitiative, addTasks, addDomain } = useVertical();
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
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initMenu, setInitMenu] = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<number, HTMLInputElement>());
  const initBtnRef = useRef<HTMLButtonElement>(null);
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
  const push = (line: string) => {
    const parsed = parseCapture(line);
    return {
      id: nextId.current++,
      title: parsed.title || line,
      durationMins: parsed.durationMinutes ?? DEFAULT_PROJECT_DURATION_MINUTES,
      energy: null as Energy | null,
    };
  };

  const commitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setTasks((ts) => [...ts, push(text)]);
    setDraft("");
    composerRef.current?.focus();
  };

  // Paste a whole list → one task per non-empty line, exactly like the record's.
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const lines = e.clipboardData
      .getData("text")
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-*•\d.)\]]+\s*/, "").trim())
      .filter(Boolean);
    if (lines.length < 2) return; // let the browser handle a plain single-line paste
    e.preventDefault();
    setTasks((ts) => [...ts, ...lines.map(push)]);
    setDraft("");
  };

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
    const pending = draft.trim();
    const toCreate = pending ? [...tasks, push(pending)] : tasks;
    if (pending) {
      setTasks(toCreate);
      setDraft("");
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
      if (toCreate.length) {
        await addTasks(
          kind === "project"
            ? { projectId: created.id, initiativeId, domainId }
            : { initiativeId: created.id, domainId },
          toCreate.map((t) => ({ title: t.title, energy: t.energy, durationMins: t.durationMins })),
        );
      }
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
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          className="moment elev-3 relative flex w-full max-w-[460px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-bg p-7 text-center"
        >
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-line text-lead text-muted">◇</div>
          <h2 className="text-display masthead leading-tight">Start with a domain</h2>
          <p className="mx-auto mt-1.5 max-w-[320px] text-body leading-relaxed text-muted">
            {kind === "project" ? "Projects" : "Initiatives"} live inside a life domain. Create your
            first domain, then the work has somewhere to land.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button onClick={onClose} className="fast rounded-[var(--radius-sm)] border border-line px-3 py-1.5 text-caption font-medium text-ink hover:border-line-strong hover:bg-surface-2">
              Not now
            </button>
            <button
              onClick={() => void addDomain().then(onClose)}
              className="fast rounded-[var(--radius-sm)] px-3.5 py-1.5 text-caption font-medium text-white [box-shadow:var(--shadow-1)] hover:brightness-110"
              style={{ background: "var(--accent)" }}
            >
              Create a domain →
            </button>
          </div>
        </div>
      </RecordScrim>
    );
  }

  return (
    <RecordScrim onClose={onClose}>
      <Sheet variant={kind === "project" ? "marked" : "bounded"} spine={accent} wide={false} sheetRef={sheetRef}>
        <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onSheetKey}>
          <Head
            crumbs={
              <>
                <DomainPicker
                  domains={domains}
                  value={domainId}
                  size="lg"
                  onChange={(id) => {
                    setDomainId(id);
                    setInitiativeId(null); // an initiative lives in one domain
                  }}
                />
                {kind === "project" && inits.length > 0 && (
                  <>
                    <span className="text-meta text-muted">›</span>
                    <button
                      ref={initBtnRef}
                      onClick={() => setInitMenu((o) => !o)}
                      className="fast text-meta text-muted hover:text-ink"
                      title="Nest this under an initiative"
                    >
                      {selectedInit ? selectedInit.name : "no initiative"} <span className="opacity-40">▾</span>
                    </button>
                    <FloatingMenu open={initMenu} anchorRef={initBtnRef} minWidth={190} onClose={() => setInitMenu(false)}>
                      <button
                        onClick={() => { setInitiativeId(null); setInitMenu(false); }}
                        className="fast block w-full px-2.5 py-1 text-left text-label text-muted hover:bg-accent-soft"
                      >
                        no initiative
                        {!initiativeId && <span className="ml-2 text-micro opacity-60">✓</span>}
                      </button>
                      {inits.map((i) => (
                        <button
                          key={i.id}
                          onClick={() => { setInitiativeId(i.id); setInitMenu(false); }}
                          className="fast block w-full truncate px-2.5 py-1 text-left text-label hover:bg-accent-soft"
                          style={i.id === initiativeId ? { color: accent } : undefined}
                        >
                          {i.name}
                          {i.id === initiativeId && <span className="ml-2 text-micro opacity-60">✓</span>}
                        </button>
                      ))}
                    </FloatingMenu>
                  </>
                )}
              </>
            }
            acts={<IconBtn glyph="✕" label="Close" onClick={onClose} />}
            name={name}
            onName={setName}
            namePlaceholder={kind === "project" ? "Name this project…" : "Name this initiative…"}
            autoFocusName
            outcome={outcome}
            onOutcome={setOutcome}
            outcomePlaceholder={
              kind === "project"
                ? "What does done look like, in one line?"
                : "The outcome, one inspiring line — not a task"
            }
          />

          <Body
            main={
              <Sec
                label={kind === "project" ? "Tasks" : "First tasks"}
                spine={accent}
                fill={0}
                meter={tasks.length ? `0/${tasks.length}${openMins ? ` · ${deckWeight(openMins)}` : ""}` : null}
              >
                {/* Rows first, composer at the foot — the record's order, so the
                    list doesn't reshuffle the moment you press Create. */}
                {tasks.map((t) => (
                  <div
                    key={t.id}
                    className="group fast -mx-2 flex items-center rounded-[var(--radius-sm)] border-b border-line px-2 last:border-b-0 hover:bg-accent-soft/40"
                    style={{ minHeight: 36 }}
                  >
                    {/* the box it will wear one second from now, unchecked */}
                    <span className={`flex shrink-0 items-center ${GUT}`}>
                      <span
                        aria-hidden
                        className="flex h-[15px] w-[15px] shrink-0 rounded-[4px] border"
                        style={{ borderColor: "var(--line-strong)" }}
                      />
                    </span>
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
                      className="nuvo-inline-input min-w-0 flex-1 bg-transparent text-body shadow-none outline-none placeholder:text-muted"
                      style={{ caretColor: accent }}
                    />
                    <span className="mono shrink-0 pl-3 text-meta text-muted">
                      <DurationSelect
                        value={t.durationMins}
                        onChange={(m) => setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, durationMins: m } : x)))}
                        className="shrink-0 rounded px-1 py-0.5 hover:bg-surface-2"
                        title="Sitting length"
                      />
                    </span>
                    <button
                      onClick={() => removeRow(t.id)}
                      tabIndex={-1}
                      className="fast shrink-0 rounded-full px-1.5 py-0.5 text-caption text-muted opacity-0 hover:text-signal group-hover:opacity-100"
                      title="Drop this step"
                      aria-label="Drop this step"
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <div className="flex items-center" style={{ minHeight: 36 }}>
                  <span className={`flex shrink-0 items-center text-body ${GUT}`} style={{ color: accent }}>＋</span>
                  <input
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); commitDraft(); }
                      if (e.key === "Escape") { e.stopPropagation(); setDraft(""); e.currentTarget.blur(); }
                    }}
                    onPaste={onPaste}
                    placeholder="Add a task…"
                    className="nuvo-inline-input min-w-0 flex-1 bg-transparent text-body shadow-none outline-none placeholder:text-muted"
                    style={{ caretColor: accent }}
                  />
                </div>

                {/* Opt-in, and only once there's a name worth thinking about. */}
                <div className="mt-2">
                  <button
                    onClick={() => void scaffold()}
                    disabled={drafting || name.trim().length < 4}
                    className="fast inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-line px-2.5 py-1 text-meta text-muted hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      name.trim().length < 4
                        ? "Name it first — then Nuvo has something to work with"
                        : `Have ${ASSISTANT_NAME} propose the first steps`
                    }
                  >
                    <span className={drafting ? "shimmer" : ""} style={{ color: accent }}>✦</span>
                    {drafting ? `${ASSISTANT_NAME} is drafting…` : "Draft the first steps"}
                  </button>
                </div>

                {error && <div className="mt-3 text-caption text-signal">{error}</div>}
              </Sec>
            }
            rail={
              <>
                {kind === "project" ? (
                  <WeekBand
                    p={{ id: "draft", ...span }}
                    onPlace={(patch) => { setSpan((s) => ({ ...s, ...patch })); setPlaced(true); }}
                    color={accent}
                  />
                ) : (
                  <QuarterBand
                    i={{ id: "draft", ...span }}
                    onPlace={(patch) => { setSpan((s) => ({ ...s, ...patch })); setPlaced(true); }}
                    color={accent}
                  />
                )}
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
          <div className="flex shrink-0 items-center gap-3 border-t border-line px-6 py-3">
            <div className="mono hidden items-center gap-2.5 text-micro text-muted sm:flex">
              <span><kbd className="keycap">⏎</kbd> task</span>
              <span><kbd className="keycap">⌘⏎</kbd> create</span>
            </div>
            <div className="flex-1" />
            <button
              onClick={() => void submit()}
              disabled={!canCreate || busy}
              className="fast rounded-[var(--radius-sm)] px-3.5 py-1.5 text-caption font-medium text-white transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
              // the commit lifts on the domain's own hue — it never wears a ring
              style={{ background: accent, boxShadow: canCreate ? `0 6px 16px -6px ${accent}` : "none" }}
            >
              {busy
                ? "Creating…"
                : tasks.length > 0
                  ? `Create + ${tasks.length} task${tasks.length === 1 ? "" : "s"} →`
                  : `Create ${noun} →`}
            </button>
          </div>
        </div>
      </Sheet>
    </RecordScrim>
  );
}
