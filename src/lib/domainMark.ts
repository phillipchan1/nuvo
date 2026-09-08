// One domain mark, at every size. The chosen symbol is its semantic center;
// the domain color is its identity; thirteen weeks of presence form the halo
// when there is room to draw them. There is no second configurable graphic.

import { showingUp, type Domain } from "./vertical";

export interface DomainMarkSpec {
  symbol: string;
  color: string;
  /** Invested hours per week, oldest to newest. */
  weeks: number[];
  /** Weekly intent, used as the honest scale when one exists. */
  target: number;
  lit: boolean;
  /** Stable per-domain rotation so marks do not become a mechanical stamp. */
  seed: number;
}

/** FNV-1a, deterministic across runtimes and sessions. */
export function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function domainMarkSpec(domain: Domain): DomainMarkSpec {
  return {
    symbol: domain.icon,
    color: domain.color,
    weeks: domain.weeks.length === 13 ? domain.weeks : new Array(13).fill(0),
    target: domain.weeklyTargetHours,
    lit: showingUp(domain).lit,
    seed: seedFromString(domain.id || domain.name),
  };
}
