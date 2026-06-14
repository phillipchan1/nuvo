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
  const project = ctx.projectName?.trim();
  const initiative = ctx.initiativeName?.trim();
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
      if (ctx.projectView === "detail" && project) {
        return {
          prompt: `Working on ${project} — tasks, scope, and next steps.`,
          starters: [
            `Scaffold starter tasks for "${project}"`,
            `What's the next step on "${project}"?`,
            "Move blocked items back to backlog",
            "Summarize progress and what's left",
          ],
        };
      }
      if (ctx.projectView === "sprint") {
        return {
          prompt: "This week's sprint — what's committed and what's stuck.",
          starters: [
            "What's in this week's sprint?",
            "Which sprint projects need attention?",
            "What should I pull into the sprint?",
            "Summarize sprint progress by domain",
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
      if (ctx.initiativeView === "detail" && initiative) {
        return {
          prompt: `Inside ${initiative} — bets, projects, and momentum.`,
          starters: [
            `What projects belong under "${initiative}"?`,
            `Summarize progress on "${initiative}"`,
            "Which projects should move to the sprint?",
            "What's blocking this initiative?",
          ],
        };
      }
      return {
        prompt: "Initiatives — shape bets and see how they're trending.",
        starters: [
          "Help me shape a new initiative",
          "Which initiatives need attention?",
          "Summarize progress across initiatives",
          "What bet should I commit to this quarter?",
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

function scheduleHints(tab: RailTab): AgentHints {
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
      "What's on my schedule today?",
      "Plan my afternoon",
      "What should I prep next?",
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
