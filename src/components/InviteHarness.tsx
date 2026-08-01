// Standalone verify harness for the chat's invite card — reached at ?invite,
// mounted in main.tsx. Not part of any real surface. Precedent: MeetHarness
// (?meet), PlanWeekHarness (?planweek).
//
// The card is the last thing between the agent and someone's inbox, so it has
// to be eyeballed at phone and desktop width in every state it can reach:
// one guest, several, a stranger nobody has in their contacts, a name that
// didn't resolve, and adding people to a meeting that already exists. Driving
// those from real chat turns would mean actually mailing real people.
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import AgentMessageBubble from "./AgentMessageBubble";
import type { AgentMessage } from "../lib/agentTypes";
import type { InviteDraft } from "../../supabase/functions/_shared/invites.ts";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function at(hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const SCENARIOS: { key: string; label: string; reply: string; draft: InviteDraft }[] = [
  {
    key: "one",
    label: "One guest",
    reply: "Friday lunch it is — **12–1**, on your **Personal** calendar. Send it to Matt?",
    draft: {
      mode: "create",
      title: "Lunch with Matt",
      startAt: at(12),
      endAt: at(13),
      recipients: [
        { email: "matt.hansen@example.com", name: "Matt Hansen", sources: ["google"], known: true },
      ],
      calendarName: "Personal",
      accountEmail: "you@gmail.com",
      addMeet: false,
    },
  },
  {
    key: "three",
    label: "Three + Meet",
    reply:
      "Best read: **Friday 8/14 at lunch**. Invite's ready for Matt, Daniel and Cory — a Meet link goes out with it.",
    draft: {
      mode: "create",
      title: "Catch-up lunch",
      startAt: at(12),
      endAt: at(13, 30),
      recipients: [
        { email: "matt.hansen@example.com", name: "Matt Hansen", sources: ["google", "meeting"], known: true },
        { email: "daniel@example.com", name: "Daniel Hoang", sources: ["apple"], known: true },
        { email: "cory@example.com", name: "Cory Tran", sources: ["meeting"], known: true },
      ],
      calendarName: "Family",
      accountEmail: "you@gmail.com",
      location: "Tartine, Market St",
      addMeet: true,
    },
  },
  {
    key: "stranger",
    label: "Typed address",
    reply: "Staged for Thursday at 9. I don't have Priya in your contacts — that's the address you gave me.",
    draft: {
      mode: "create",
      title: "Intro call",
      startAt: at(9),
      endAt: at(9, 30),
      recipients: [{ email: "priya@newco.example", name: null, sources: [], known: false }],
      calendarName: "Work",
      accountEmail: "you@work.com",
      addMeet: true,
    },
  },
  {
    key: "unresolved",
    label: "A name didn't land",
    reply: "Two people answer to Matt — which one? Daniel's on it either way.",
    draft: {
      mode: "create",
      title: "Project sync",
      startAt: at(15),
      endAt: at(16),
      recipients: [{ email: "daniel@example.com", name: "Daniel Hoang", sources: ["google"], known: true }],
      calendarName: "Work",
      accountEmail: "you@work.com",
      addMeet: true,
      unresolved: [
        {
          query: "matt",
          candidates: [
            { email: "matt.hansen@example.com", displayName: "Matt Hansen", freq: 12, sources: ["google"] },
            { email: "mreyes@example.com", displayName: "Matt Reyes", freq: 3, sources: ["apple"] },
          ],
        },
      ],
    },
  },
  {
    key: "add",
    label: "Add to existing",
    reply: "**Sunday run-through** already exists at 4 — adding Cory to it.",
    draft: {
      mode: "add_guests",
      eventId: "evt-1",
      title: "Sunday run-through",
      startAt: at(16),
      endAt: at(17),
      recipients: [{ email: "cory@example.com", name: "Cory Tran", sources: ["meeting"], known: true }],
      calendarName: "Church",
      addMeet: true,
    },
  },
];

export default function InviteHarness() {
  const [key, setKey] = useState(SCENARIOS[1].key);
  const scenario = SCENARIOS.find((s) => s.key === key)!;

  const message: AgentMessage = {
    id: `harness-${scenario.key}`,
    role: "assistant",
    content: scenario.reply,
    invite: scenario.draft,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <div className="atmosphere min-h-screen p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.key}
              onClick={() => setKey(s.key)}
              className={`tap rounded-full border px-3 py-1 text-caption font-medium ${
                key === s.key ? "border-accent bg-accent/10 text-accent" : "border-line text-muted"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* The chat rail is 380px on desktop; the phone gives it the full width
            minus the shell's padding. Both are shown so a card that only works
            in one of them can't pass. */}
        <div className="flex flex-wrap items-start gap-6">
          <div className="w-[380px] max-w-full rounded-lg border border-dashed border-line p-3">
            <div className="mb-2 text-micro text-muted">desktop rail · 380px</div>
            <AgentMessageBubble message={message} />
          </div>
          <div className="w-[375px] max-w-full rounded-lg border border-dashed border-line p-3">
            <div className="mb-2 text-micro text-muted">phone · 375px</div>
            <AgentMessageBubble message={message} compact />
          </div>
        </div>
        <Toaster position="bottom-right" richColors closeButton />
      </div>
    </QueryClientProvider>
  );
}
