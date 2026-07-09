import type { Rung } from "../components/AppShell";
import type { ProjectView, DetailView } from "../components/FloorPane";
import type { RailTab } from "../components/LeftRail";

export interface AgentHintContext {
  rung: Rung;
  projectView?: ProjectView;
  initiativeView?: DetailView;
  tab?: RailTab;
  mobileTab?: "now" | "today" | "week" | "inbox";
  projectName?: string | null;
  initiativeName?: string | null;
  domainName?: string | null;
}

export interface AgentHints {
  prompt: string;
  starters: string[];
}

export function agentHints(ctx: AgentHintContext): AgentHints {
  const domain = ctx.domainName?.trim();

  if (ctx.mobileTab) {
    return mobileHints(ctx.mobileTab);
  }

  switch (ctx.rung) {
    case "now":
      return {
        prompt: "Running today — prep, reschedule, or lighten the load.",
        starters: [
          "What should I prep for my next meeting?",
          "Where are my open blocks later today?",
          "Move my non-urgent afternoon to tomorrow",
          "I'm wiped — lighten today's plan",
        ],
      };

    case "day":
      return scheduleHints(ctx.tab ?? "today");

    case "project":
      if (ctx.projectView === "groom") {
        return {
          prompt: "Grooming the deck — sharpen what each project is and how it gets done.",
          starters: [
            "Which projects are rawest and need shaping?",
            "Suggest an area for my unassigned projects",
            "What's missing before these are ready to schedule?",
            "Tighten the outcomes on my grooming projects",
          ],
        };
      }
      return {
        prompt: "Your project portfolio — create, edit, and see what's in flight.",
        starters: [
          "Help me set up a new project",
          "Which projects are missing start or target dates?",
          "Summarize what's in flight across domains",
          "What's stalled and needs a decision?",
        ],
      };

    case "initiative":
      return {
        prompt: "Initiatives — shape them and see how they're trending.",
        starters: [
          "Help me shape a new initiative",
          "Which initiatives need attention?",
          "Summarize progress across initiatives",
          "What initiative should I commit to this quarter?",
        ],
      };

    case "domain":
      return {
        prompt: domain
          ? `Domains — balance across your life. Viewing ${domain}.`
          : "Domains — balance and faithfulness across your life.",
        starters: [
          "Which domain have I neglected lately?",
          "Summarize my domain balance this week",
          "What should I tend in each domain?",
          "Where am I over-committed?",
        ],
      };

    default:
      return scheduleHints("today");
  }
}

// Accepts "week" too: the desktop rail dropped its Week tab (the Spread board
// replaced it), but the mobile Tasks screen still has a Week segment.
function scheduleHints(tab: RailTab | "week"): AgentHints {
  if (tab === "inbox") {
    return {
      prompt: "Inbox — capture, clarify, and file what landed.",
      starters: [
        "What's in my inbox?",
        "Help me triage my inbox",
        "Turn the top inbox item into a task",
        "What should I defer to backlog?",
      ],
    };
  }
  if (tab === "week") {
    return {
      prompt: "This week — what's committed and what still needs a slot.",
      starters: [
        "What's in my week pool?",
        "Help me plan the rest of this week",
        "What should I schedule first?",
        "Move low-priority items out of the week",
      ],
    };
  }
  return {
    prompt: "Your schedule — today, blocks, and what's next.",
    starters: [
      "Help me plan this week",
      "What's on my schedule today?",
      "Plan my afternoon",
      "Move my non-urgent tasks to tomorrow",
    ],
  };
}

function mobileHints(tab: AgentHintContext["mobileTab"]): AgentHints {
  switch (tab) {
    case "now":
      return agentHints({ rung: "now" });
    case "inbox":
      return scheduleHints("inbox");
    case "week":
      return scheduleHints("week");
    case "today":
    default:
      return scheduleHints("today");
  }
}
