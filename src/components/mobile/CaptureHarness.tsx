// Standalone verify harness for mobile Capture — the Task face's When row
// (D-131): day chips, Pick date, Add time, start–end, duration. Reached at
// ?capture. Toggle between a plain ＋ open and one seeded from a Day-canvas tap.

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import MobileCapture from "./MobileCapture";
import type { NewTaskInput } from "../../hooks/useTasks";

const WRITABLE = [
  { id: "a1", provider: "google", email: "you@example.com", sync_direction: "two_way" },
];

export default function CaptureHarness() {
  const [client] = useState(() => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["calendar_accounts"], WRITABLE);
    return qc;
  });
  const today = startOfDay(new Date());
  const seeded = new Date(today);
  seeded.setHours(14, 30, 0, 0);

  const [mode, setMode] = useState<"plain" | "seeded">("plain");
  const [log, setLog] = useState<string>("—");
  const [open, setOpen] = useState(true);
  const seed = mode === "seeded" ? { start: seeded, durationMinutes: 30 } : null;

  return (
    <div className="atmosphere min-h-screen p-4">
      <h1 className="masthead mb-1 text-head">Capture — Task When (fixtures)</h1>
      <p className="mb-3 max-w-[70ch] text-caption text-muted">
        Plain open should offer Pick date… and Add time. Seeded open should land with editable
        start–end and duration chips. A timed create says Add block.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ["plain", "plain ＋"],
            ["seeded", "canvas seed 2:30pm"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setMode(id);
              setOpen(true);
            }}
            className={`rounded-full border px-3 py-1.5 text-label ${
              mode === id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"
            }`}
          >
            {label}
          </button>
        ))}
        {!open && (
          <button
            type="button"
            className="rounded-full border border-line px-3 py-1.5 text-label"
            onClick={() => setOpen(true)}
          >
            Open capture
          </button>
        )}
      </div>
      <div className="text-label text-muted" data-capture-log>
        Last create: {log}
      </div>
      <div style={{ width: 375 }} className="relative mt-2 min-h-[480px] border border-line">
        <QueryClientProvider client={client}>
          {open && (
            <MobileCapture
              key={mode}
              labels={[]}
              initialStart={seed?.start ?? null}
              initialDurationMinutes={seed?.durationMinutes ?? null}
              onCreate={async (input: NewTaskInput) => {
                const when = input.start_time
                  ? `${input.do_date} ${new Date(input.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${input.duration_minutes}m`
                  : `${input.do_date ?? "inbox"} (anytime)`;
                setLog(`${input.title} · ${when}`);
              }}
              onClose={() => setOpen(false)}
            />
          )}
        </QueryClientProvider>
      </div>
    </div>
  );
}
