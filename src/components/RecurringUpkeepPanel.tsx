import { useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { DEFAULT_DURATION_MINUTES, ruleOf, type Recurrence } from "../lib/types";
import { groupSeriesByCadence } from "../lib/recurrence";
import { todayISO, parseDateISO, toDateISO } from "../lib/dates";
import { addDays } from "date-fns";
import { useRecurrences, useRecurrenceMutations, type SeriesTemplate } from "../hooks/useRecurrence";
import { useSettings } from "../hooks/useSettings";
import { useVertical } from "../hooks/useVertical";
import { domainById, projectById } from "../lib/vertical";
import { DialogFoot, DialogHead, Modal, SectionLabel } from "./ui";
import { RepeatControl } from "./RecurrencePicker";
import DurationSelect from "./DurationSelect";
import type { RecurrenceRule } from "../lib/recurrence";
import { useIsMobile } from "../hooks/useIsMobile";
import Sheet from "./mobile/Sheet";
import { FloatingMenu } from "./floors/parts";
import { MenuItem } from "./record/recordFrame";
import { Icon } from "./Icon";
import { Button, EmptyState, IconButton, Input } from "./kit";

// Recurring upkeep — the chores on their own cadence. A kit dialog at a desk
// (the Schedule's ⋯), a bottom Sheet on a phone (Settings → Schedule).

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

/** Overdue is a fault (danger); today is now (signal); the coming week reads
 *  in ink; the rest stays quiet. */
function dueTone(iso: string | null, today: string): string | undefined {
  if (!iso) return undefined;
  if (iso < today) return "var(--danger)";
  if (iso === today) return "var(--signal)";
  const soon = toDateISO(addDays(parseDateISO(today), 7));
  if (iso <= soon) return "var(--ink)";
  return undefined;
}

function UpkeepBody() {
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

  const toggleSection = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  return (
    <>
      <div className="grid gap-2 pb-2">
        <Input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="New upkeep task"
          aria-label="New upkeep task"
          frameClassName="fm-field"
        />
        <div className="flex flex-wrap items-center gap-2">
          <RepeatControl anchorISO={today} value={draftRule} onChange={setDraftRule} />
          <DurationSelect value={draftDuration} onChange={setDraftDuration} title="Duration" />
          <Button
            kind="primary"
            className="tap ml-auto"
            disabled={!draftTitle.trim() || !draftRule || adding}
            onClick={() => void addUpkeep()}
          >
            Add
          </Button>
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={<Icon name="repeat" size={20} />}>Nothing on a cadence</EmptyState>
      ) : (
        groups.map((group) => {
          const open = isMobile ? collapsed[group.key] !== true : true;
          return (
            <div key={group.key}>
              <SectionLabel
                count={group.items.length}
                open={open}
                onToggle={isMobile ? () => toggleSection(group.key) : undefined}
              >
                {group.label}
              </SectionLabel>
              {open && (
                <div className="set-list">
                  {group.items.map(({ series: s, nextDue, rowHint }) => (
                    <UpkeepRow
                      key={s.id}
                      series={s}
                      nextDue={nextDue}
                      rowHint={rowHint}
                      today={today}
                      vertical={vertical}
                      onUpdate={(rule) => void mut.updateSeries(s, rule)}
                      onUpdateDuration={(mins) => void mut.updateSeries(s, ruleOf(s), { duration_minutes: mins })}
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
    </>
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
  const menuRef = useRef<HTMLButtonElement>(null);
  const rule = ruleOf(series);
  const domain = domainById(vertical, series.domain_id);
  const project = projectById(vertical, series.project_id);
  const parent = project?.name ?? domain?.name ?? null;
  const tone = dueTone(nextDue, today);

  return (
    <div className="set-list-row flex-wrap">
      <Icon name="repeat" size={13} style={{ color: "var(--faint)" }} title="Repeats" />
      <span className="set-list-main">
        <span className="set-list-title">{series.title}</span>
        {(rowHint || parent) && <span className="set-list-meta">{[rowHint, parent].filter(Boolean).join(" · ")}</span>}
      </span>
      <span className="shrink-0 text-caption tabular-nums" style={{ color: tone ?? "var(--muted)" }}>
        {fmtDue(nextDue, today)}
      </span>
      <RepeatControl anchorISO={series.anchor_date} value={rule} onChange={(r) => r && onUpdate(r)} />
      <DurationSelect value={series.duration_minutes} onChange={onUpdateDuration} title="Duration" className="shrink-0" />
      <IconButton
        ref={menuRef}
        label="More actions"
        icon={<Icon name="more" size={16} />}
        onClick={() => setMenuOpen((o) => !o)}
        className="tap"
      />
      <FloatingMenu open={menuOpen} anchorRef={menuRef} align="right" minWidth={160} onClose={() => setMenuOpen(false)}>
        <div className="doc-menu">
          <MenuItem
            onClick={() => {
              onPause();
              setMenuOpen(false);
            }}
          >
            Pause
          </MenuItem>
          <MenuItem
            danger
            onClick={() => {
              onDelete();
              setMenuOpen(false);
            }}
          >
            Delete series
          </MenuItem>
        </div>
      </FloatingMenu>
    </div>
  );
}

/** Schedule ⋯ → recurring upkeep catalog (desktop dialog / mobile sheet). */
export default function RecurringUpkeepPanel({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Sheet tall title="Recurring upkeep" onClose={onClose} contentClassName="mobile-scroll overflow-y-auto">
        <div className="px-4 pb-8">
          <UpkeepBody />
        </div>
      </Sheet>
    );
  }
  return (
    <Modal onClose={onClose} width="max-w-lg" align="center">
      <DialogHead title="Recurring upkeep" onClose={onClose} />
      <div className="dlg-body max-h-[min(64vh,600px)]">
        <UpkeepBody />
      </div>
      <DialogFoot>
        <Button kind="primary" size="md" onClick={onClose}>
          Done
        </Button>
      </DialogFoot>
    </Modal>
  );
}
