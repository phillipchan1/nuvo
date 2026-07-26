import type { Plan } from "../../lib/subscription";

/** One source of truth for what we charge and what we say about it — the
 *  upgrade modal, the paywall, and the Settings billing pane all read this,
 *  so a price change is one edit and can't drift between surfaces.
 *  Keep in sync with the Stripe Prices behind STRIPE_PRICE_* (see
 *  docs/billing-setup.md). */
export interface PlanCopy {
  id: Plan;
  label: string;
  /** Headline number — what it costs per month on this plan. */
  perMonth: number;
  /** The billing reality under the headline. */
  billed: string;
  /** Only the annual plan earns a badge. */
  badge?: string;
}

const MONTHLY_PRICE = 29;
const ANNUAL_PRICE = 228;
const ANNUAL_PER_MONTH = 19;

/** $348 a year at the monthly rate vs $228 — the number that actually sells
 *  the annual plan, and the one "$228 billed yearly" hides. */
export const ANNUAL_SAVING = MONTHLY_PRICE * 12 - ANNUAL_PRICE; // 120
export const ANNUAL_SAVING_PCT = Math.round((ANNUAL_SAVING / (MONTHLY_PRICE * 12)) * 100); // 34

export const PLANS: PlanCopy[] = [
  {
    id: "annual",
    label: "Annual",
    perMonth: ANNUAL_PER_MONTH,
    billed: `$${ANNUAL_PRICE} billed yearly`,
    badge: `Save $${ANNUAL_SAVING}`,
  },
  {
    id: "monthly",
    label: "Monthly",
    perMonth: MONTHLY_PRICE,
    billed: "billed monthly",
  },
];

/** What the subscription actually buys. Concrete and true — no aspirational
 *  features. Five lines; a longer list reads as padding. */
export const INCLUDED = [
  "Every calendar in one place — Google, Outlook, iCloud",
  "Nuvo, your planning copilot",
  "Projects, initiatives, and domains",
  "Weekly planning and review rituals",
  "The Mac app and your iPhone",
];
