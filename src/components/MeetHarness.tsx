// Standalone verify harness for the grid composer's Event tab — the Google Meet
// toggle and the calendar picker — rendered over fixture accounts instead of a
// real one, so the toggle's default (follows the account preference until you
// tap it), the picker's choices (every visible writable calendar, grouped by
// account) and the layout can be eyeballed at phone and desktop width. Reached
// at ?meet, mounted in main.tsx. Not part of any real surface. Precedent:
// PlanWeekHarness (?planweek), EmblemHarness.

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DraftComposer, { type CreateDraft } from "./DraftComposer";
import { HARNESS_CALENDAR_ACCOUNTS, HARNESS_SETTINGS } from "./calendar/calendarFixtures";
import type { MeetPreference } from "../../supabase/functions/_shared/conferencing.ts";

const PREFS: MeetPreference[] = ["guests", "always", "never"];

export default function MeetHarness() {
  const [pref, setPref] = useState<MeetPreference>("guests");
  const [last, setLast] = useState<CreateDraft | null>(null);
  // Remount the composer when the preference changes — it seeds its toggle once.
  const [nonce, setNonce] = useState(0);
  const [client] = useState(() => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(["calendar_accounts"], HARNESS_CALENDAR_ACCOUNTS);
    qc.setQueryData(["settings"], HARNESS_SETTINGS);
    return qc;
  });

  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);

  return (
    <QueryClientProvider client={client}>
      <div className="atmosphere min-h-screen p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-caption text-muted">auto_add_meet:</span>
          {PREFS.map((p) => (
            <button
              key={p}
              onClick={() => { setPref(p); setNonce((n) => n + 1); }}
              className={`tap rounded-full border px-3 py-1 text-caption font-medium ${
                pref === p ? "border-accent bg-accent/10 text-accent" : "border-line text-muted"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        {last && (
          <pre className="mono max-w-full overflow-x-auto rounded-md border border-line bg-surface-2 p-3 text-meta text-muted">
            {JSON.stringify(last, null, 2)}
          </pre>
        )}
        <DraftComposer
          key={`${pref}-${nonce}`}
          start={start}
          end={end}
          point={{ x: 24, y: 120 }}
          initialKind="event"
          googleAvailable
          meetPreference={pref}
          onCreate={setLast}
          onCancel={() => setNonce((n) => n + 1)}
        />
      </div>
    </QueryClientProvider>
  );
}
