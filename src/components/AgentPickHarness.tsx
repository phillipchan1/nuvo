// Standalone verify harness for what a *tapped* option looks like in the
// transcript — reached at ?chat, mounted in main.tsx. Not part of any real
// surface. Precedent: InviteHarness (?invite), MeetHarness (?meet).
//
// The thing being verified is a claim about voice, not layout: a suggestion's
// `message` is a tool argument (D-082 — it carries the address that actually
// resolves), so rendering it as the user's line writes sentences they never
// said. Here the wire text and the label are deliberately far apart, so a
// regression that renders `content` is obvious rather than subtle — the
// transcript would suddenly show the user reciting an email address.
import { useState } from "react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import AgentMessageBubble from "./AgentMessageBubble";
import AgentSuggestionChips from "./AgentSuggestionChips";
import type { AgentMessage, AgentSuggestion } from "../lib/agentTypes";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// The live turn at the foot of each transcript: tapping a chip appends the pick
// exactly the way the three real surfaces do — send(s.message, s.label).
const OPEN_SUGGESTIONS: AgentSuggestion[] = [
  { label: "Ryan Weeks", message: "Use ryancweeks@gmail.com" },
  { label: "Ryan Weeks (Church)", message: "Use ryan@frontierchurch.example" },
];

const SEED: AgentMessage[] = [
  {
    id: "u1",
    role: "user",
    content: "9am friday Stampede Meeting with ryan weeks",
    at: Date.now() - 5 * 60_000,
  },
  {
    id: "a1",
    role: "assistant",
    content:
      "I have one **Ryan Weeks** — from a meeting you both attended, so I only have the address, not a display name. Same Ryan?",
  },
  {
    id: "u2",
    role: "user",
    // The live case from D-082: the only thing that resolves is the address,
    // so the address is what gets sent — and what must NOT be shown as speech.
    content: "Use ryancweeks@gmail.com",
    display: "Ryan Weeks",
    at: Date.now() - 4 * 60_000,
  },
  {
    id: "a2",
    role: "assistant",
    content: "Booked — **Stampede Meeting**, Friday 9–9:30. Invite's staged for Ryan.",
  },
  {
    id: "u3",
    role: "user",
    // The other shape: a button seeds a whole constructed paragraph (the event
    // sheet's "Ask Nuvo to help prepare"). Nobody types this.
    content:
      'I have "Stampede Meeting" at 9:00 AM–9:30 AM at The Ranch. Help me prepare.',
    display: "Help me prepare for “Stampede Meeting”",
    at: Date.now() - 3 * 60_000,
  },
];

function Transcript({ compact, width, note }: { compact?: boolean; width: number; note: string }) {
  const [messages, setMessages] = useState<AgentMessage[]>(SEED);

  const pick = (s: AgentSuggestion) =>
    setMessages((prev) => [
      ...prev,
      { id: `pick-${prev.length}`, role: "user", content: s.message, display: s.label, at: Date.now() },
    ]);

  return (
    <div
      className="max-w-full rounded-lg border border-dashed border-line p-3"
      style={{ width }}
    >
      <div className="mb-2 text-micro text-muted">{note}</div>
      <div className="space-y-5">
        {messages.map((m) => (
          <AgentMessageBubble key={m.id} message={m} compact={compact} />
        ))}
        <AgentSuggestionChips suggestions={OPEN_SUGGESTIONS} onPick={pick} onOther={() => {}} />
      </div>
    </div>
  );
}

export default function AgentPickHarness() {
  const [dark, setDark] = useState(false);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
  };

  return (
    <QueryClientProvider client={queryClient}>
      <div className="atmosphere min-h-screen p-4">
        <button
          onClick={toggle}
          className="tap mb-3 rounded-full border border-line px-3 py-1 text-caption text-muted"
        >
          {dark ? "Light" : "Dark"}
        </button>
        {/* Both widths at once, for the same reason the domain harness does it:
            a pill that only reads at 380px can't pass. */}
        <div className="flex flex-wrap items-start gap-6">
          <Transcript width={380} note="desktop rail · 380px" />
          <Transcript width={375} compact note="phone · 375px" />
        </div>
      </div>
    </QueryClientProvider>
  );
}
