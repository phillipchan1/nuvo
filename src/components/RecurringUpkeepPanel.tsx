import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { DEFAULT_DURATION_MINUTES, ruleOf, type Recurrence } from "../lib/types";
import { groupSeriesByCadence } from "../lib/recurrence";
import { todayISO, parseDateISO, toDateISO } from "../lib/dates";
import { addDays } from "date-fns";
import { useRecurrences, useRecurrenceMutations, type SeriesTemplate } from "../hooks/useRecurrence";
import { useSettings } from "../hooks/useSettings";
import { useVertical } from "../hooks/useVertical";
import { domainById, projectById } from "../lib/vertical";
import { Modal, SectionLabel } from "./ui";
import { RepeatControl } from "./RecurrencePicker";
import DurationSelect from "./DurationSelect";
import { useEscape } from "../hooks/useEscape";
import type { RecurrenceRule } from "../lib/recurrence";
import { useIsMobile } from "../hooks/useIsMobile";
import Sheet from "./mobile/Sheet";

function fmtDue(iso: string | null, today: string): string {
  if (!iso) return "—";
  if (iso === today) return "Today";
  if (iso === toDateISO(addDays(parseDateISO(today), 1))) return "Tomorrow";
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

function dueTone(iso: string | null, today: string): string | undefined {
  if (!iso) return undefined;
  if (iso <= today) return "var(--signal)";
  const soon = toDateISO(addDays(parseDateISO(today), 7));
  if (iso <= soon) return "var(--accent)";
  return undefined;
}

function UpkeepBody({ onClose }: { onClose: () => void }) {
  const today = todayISO();
  const { data: series = [] } = useRecurrences();
  const taskSeries = useMemo(() => series.filter((s) => s.kind === "task"), [series]);
  const groups = useMemo(() => groupSeriesByCadence(taskSeries, today), [taskSeries, today]);
  const { data: vertical } = useVertical();
  const mut = useRecurrenceMutations();
  const { settings } = useSettings();
  const defaultDurationMins = settings?.default_task_duration_minutes ?? DEFAULT_DURATION_MINUTES;

  const [draftTitle, setDraftTitle] = useState("");
  const [draftRule, setDraftRule] = useState<RecurrenceRule | null>(null);
  const [draftDuration, setDraftDuration] = useState(defaultDurationMins);
  const [adding, setAdding] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isMobile = useIsMobile();

  const addUpkeep = async () => {
    const title = draftTitle.trim();
    if (!title || !draftRule) return;
    setAdding(true);
    try {
      const template: SeriesTemplate = {
        title,
        duration_minutes: draftDuration,
        time_of_day_minutes: null,
      };
      await mut.createSeries({
        kind: "task",
        rule: draftRule,
        anchorISO: today,
        template,
      });
      setDraftTitle("");
      setDraftRule(null);
      setDraftDuration(defaultDurationMins);
    } finally {
      setAdding(false);
    }
  };

  const toggleSection = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  return (
    <div className="flex max-h-[min(72vh,640px)] flex-col">
      <header className="shrink-0 border-b border-line px-5 pb-4 pt-5 sm:px-6">
        <h2 className="text-display masthead text-ink">Recurring upkeep</h2>
        <p className="text-caption mt-1 text-muted">The chores that run on their own cadence.</p>
      </header>

      <div className="mobile-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4 sm:px-4">
        <div className="mt-4 space-y-2 px-1">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="New upkeep task…"
            className="w-full rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2.5 text-body outline-none placeholder:text-muted focus:border-line-strong"
          />
          <div className="flex flex-wrap items-center gap-2">
            <RepeatControl anchorISO={today} value={draftRule} onChange={setDraftRule} />
            <DurationSelect value={draftDuration} onChange={setDraftDuration} title="Duration" />
            <button
              type="button"
              disabled={!draftTitle.trim() || !draftRule || adding}
              onClick={() => void addUpkeep()}
              className="tap fast ml-auto rounded-full border border-accent bg-accent px-4 py-2 text-label font-medium text-on-accent disabled:bg-surface-2 disabled:text-muted disabled:shadow-none"
            >
              Add
            </button>
          </div>
        </div>

        {groups.length === 0 ? (
          <p className="text-caption mt-8 px-2 text-center text-muted">
            Nothing on a cadence yet — ask Nuvo (&ldquo;change HVAC filter every 6 months&rdquo;) or tap Add above.
          </p>
        ) : (
          groups.map((group) => {
            const open = isMobile ? collapsed[group.key] !== true : true;
            return (
              <div key={group.key} className="mt-2">
                <SectionLabel
                  count={group.items.length}
                  open={open}
                  onToggle={isMobile ? () => toggleSection(group.key) : undefined}
                >
                  {group.label}
                </SectionLabel>
                {open && (
                  <div className="divide-y divide-line">
                    {group.items.map(({ series: s, nextDue, rowHint }) => (
                      <UpkeepRow
                        key={s.id}
                        series={s}
                        nextDue={nextDue}
                        rowHint={rowHint}
                        today={today}
                        vertical={vertical}
                        onUpdate={(rule) => void mut.updateSeries(s, rule)}
                        onUpdateDuration={(mins) =>
                          void mut.updateSeries(s, ruleOf(s), { duration_minutes: mins })
                        }
                        onPause={() => void mut.pauseSeries(s.id)}
                        onDelete={() => void mut.deleteSeries(s)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <footer className="shrink-0 border-t border-line px-5 py-3 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="tap fast w-full rounded-[var(--radius)] py-2.5 text-label font-medium text-muted hover:text-ink sm:w-auto sm:px-4"
        >
          Done
        </button>
      </footer>
    </div>
  );
}

function UpkeepRow({
  series,
  nextDue,
  rowHint,
  today,
  vertical,
  onUpdate,
  onUpdateDuration,
  onPause,
  onDelete,
}: {
  series: Recurrence;
  nextDue: string | null;
  rowHint: string | null;
  today: string;
  vertical: ReturnType<typeof useVertical>["data"];
  onUpdate: (rule: RecurrenceRule) => void;
  onUpdateDuration: (minutes: number) => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEscape(menuOpen, () => setMenuOpen(false));
  const rule = ruleOf(series);
  const domain = domainById(vertical, series.domain_id);
  const project = projectById(vertical, series.project_id);
  const parent = project?.name ?? domain?.name ?? null;
  const tone = dueTone(nextDue, today);

  return (
    <div className="group flex min-h-[44px] items-center gap-2 px-2 py-2 sm:px-3">
      <span className="mono shrink-0 text-micro text-muted" title="Repeats">
        ↻
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-ink">{series.title}</div>
        {(rowHint || parent) && (
          <div className="truncate text-meta text-muted">
            {[rowHint, parent].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
      <span className="mono shrink-0 text-meta" style={tone ? { color: tone } : undefined}>
        {fmtDue(nextDue, today)}
      </span>
      <RepeatControl
        anchorISO={series.anchor_date}
        value={rule}
        onChange={(r) => r && onUpdate(r)}
      />
      <DurationSelect value={series.duration_minutes} onChange={onUpdateDuration} title="Duration" className="shrink-0" />
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="More actions"
          onClick={() => setMenuOpen((o) => !o)}
          className="tap fast flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-bg hover:text-ink"
        >
          ···
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setMenuOpen(false)} />
            <div className="rise elev-2 absolute right-0 top-full z-[71] mt-1 min-w-[140px] rounded-[var(--radius)] border border-line bg-surface py-1">
              <button
                type="button"
                className="fast block w-full px-3 py-2 text-left text-caption hover:bg-bg"
                onClick={() => { onPause(); setMenuOpen(false); }}
              >
                Pause
              </button>
              <button
                type="button"
                className="fast block w-full px-3 py-2 text-left text-caption text-signal hover:bg-bg"
                onClick={() => { onDelete(); setMenuOpen(false); }}
              >
                Delete series
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Schedule ⋯ → recurring upkeep catalog (desktop modal / mobile sheet). */
export default function RecurringUpkeepPanel({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Sheet tall onClose={onClose}>
        <UpkeepBody onClose={onClose} />
      </Sheet>
    );
  }
  return (
    <Modal onClose={onClose} width="max-w-md" align="center">
      <div className="moment overflow-hidden rounded-[var(--radius-lg)] border border-line bg-bg elev-3">
        <UpkeepBody onClose={onClose} />
      </div>
    </Modal>
  );
}
