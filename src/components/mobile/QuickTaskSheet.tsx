import { useMemo, useRef, useState } from "react";
import { captureTitle, parseCapture } from "../../lib/nlp";
import { todayISO, tomorrowISO, nextWeekISO } from "../../lib/dates";
import type { Label } from "../../lib/types";
import type { NewTaskInput } from "../../hooks/useTasks";
import { useRaiseKeyboard } from "../../hooks/useRaiseKeyboard";
import Sheet from "./Sheet";

// Quick-capture, reachable from every tab. The same natural-language parser the
// desktop command bar uses ("call David tomorrow 9am 30m #work !high"), plus
// one-tap day chips so a thumb can file a task without typing dates.
export default function QuickTaskSheet({
  labels,
  onCreate,
  onClose,
  defaultDoDate = null,
}: {
  labels: Label[];
  onCreate: (input: NewTaskInput) => Promise<unknown>;
  onClose: () => void;
  /** When opened from Calendar or Today, pre-file there unless the text says otherwise. */
  defaultDoDate?: string | null;
}) {
  const [text, setText] = useState("");
  const [day, setDay] = useState<string | null>(defaultDoDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // In-app ＋ is a webview gesture so the 120ms retry raises the keyboard;
  // a lock-screen widget is not — useRaiseKeyboard still lands the caret,
  // and the native WKWebView flag (D-115) is what lets the keys come up.
  useRaiseKeyboard(inputRef);

  const parsed = useMemo(() => (text.trim() ? parseCapture(text) : null), [text]);

  const chipColor = (kind: string) =>
    kind === "label" ? "var(--accent)" : kind === "priority" ? "var(--signal)" : "var(--muted)";

  const submit = async () => {
    const body = text.trim();
    if (!body || saving) return;
    setError(null);
    setSaving(true);
    try {
      const p = parseCapture(body);
      const labelIds = p.labels
        .map((n) => labels.find((l) => l.name.toLowerCase() === n.toLowerCase())?.id)
        .filter((id): id is string => Boolean(id));
      // An explicit date in the text wins; otherwise use the picked day chip.
      const doDate = p.doDate ?? day ?? undefined;
      await onCreate({
        title: captureTitle(p, body),
        notes: p.notes ?? undefined,
        do_date: doDate,
        start_time: p.startTime?.toISOString() ?? null,
        duration_minutes: p.durationMinutes,
        priority: p.priority,
        labelIds,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save task");
      setSaving(false);
    }
  };

  const dayChips: { label: string; value: string | null }[] = [
    { label: "Inbox", value: null },
    { label: "Today", value: todayISO() },
    { label: "Tomorrow", value: tomorrowISO() },
    { label: "Next week", value: nextWeekISO() },
  ];
  // A date parsed from the text overrides the chips — reflect that in the UI.
  const dayLocked = Boolean(parsed?.doDate);

  return (
    <Sheet onClose={onClose} title="Quick task">
      <div className="px-4 pb-4">
        <div className="fast flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
          <span className="text-head text-accent">＋</span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            enterKeyHint="done"
            placeholder="What needs doing?"
            aria-label="New task"
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/70"
          />
        </div>

        {parsed && parsed.chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {parsed.chips.map((c, i) => (
              <span
                key={i}
                className="mono rounded-md border px-1.5 py-0.5 text-label"
                style={{ borderColor: chipColor(c.kind), color: chipColor(c.kind) }}
              >
                {c.text}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3.5">
          <div className="section-label mb-1.5 !p-0">{dayLocked ? "From your text" : "When"}</div>
          <div className="flex flex-wrap gap-1.5">
            {dayLocked ? (
              <span className="rounded-full border border-accent bg-accent-soft px-3 py-1.5 text-body font-medium text-accent">
                {parsed?.doDate}
              </span>
            ) : (
              dayChips.map((c) => {
                const on = day === c.value;
                return (
                  <button
                    key={c.label}
                    onClick={() => setDay(c.value)}
                    className={`tap fast rounded-full border px-3.5 py-2 text-body font-medium ${
                      on
                        ? "border-accent bg-accent text-on-accent"
                        : "border-line text-muted hover:border-accent hover:text-accent"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-md bg-signal-soft px-3 py-2 text-caption text-signal">{error}</div>
        )}

        <button
          onClick={() => void submit()}
          disabled={!text.trim() || saving}
          className="tap fast mt-4 w-full rounded-xl py-3 text-head font-semibold shadow-sm active:translate-y-px disabled:shadow-none bg-accent text-on-accent disabled:border disabled:border-line disabled:bg-surface-2 disabled:text-muted"
        >
          {saving ? "Saving…" : "Add task"}
        </button>

        <p className="mono mt-2.5 text-center text-label text-muted">
          Try “review PR tomorrow 2pm 45m #work !high”
        </p>
      </div>
    </Sheet>
  );
}
