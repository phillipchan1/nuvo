// The four energy buckets the Trail groups by, in render order.
// Mirrors the Phase 1 brief: Deep / Decide / Delegate / Quick.

export type Energy = "deep" | "decide" | "delegate" | "quick";

export const ENERGY_ORDER: Energy[] = ["deep", "decide", "delegate", "quick"];

export const ENERGY_META: Record<Energy, { label: string; icon: string; blurb: string }> = {
  deep: { label: "Deep", icon: "◆", blurb: "focus, no interruptions" },
  decide: { label: "Decide", icon: "▲", blurb: "judgment calls" },
  delegate: { label: "Delegate", icon: "⇢", blurb: "hand off / follow up" },
  quick: { label: "Quick", icon: "•", blurb: "low-friction wins" },
};

// Map a LifeOS domain string to its CSS edge variable.
export function domainVar(domain: string | undefined): string {
  const key = (domain ?? "").toLowerCase().replace(/\s+/g, "");
  const map: Record<string, string> = {
    personal: "var(--domain-personal)",
    sce: "var(--domain-sce)",
    frontier: "var(--domain-frontier)",
    trading: "var(--domain-trading)",
    family: "var(--domain-family)",
    melu: "var(--domain-melu)",
    aiops: "var(--domain-aiops)",
  };
  return map[key] ?? "var(--domain-default)";
}
