import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Blocker 11 (docs/cloudflare-cutover.md): a Cloudflare Queue has exactly
// one consumer Worker. Prod and preview sharing one would make each deploy
// steal the queue from the other.
type QueueCfg = {
  producers?: { binding: string; queue: string }[];
  consumers?: { queue: string }[];
};
type Wrangler = { queues?: QueueCfg; env?: Record<string, { queues?: QueueCfg }> };

function readWrangler(): Wrangler {
  const text = readFileSync(join(__dirname, "..", "wrangler.jsonc"), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(text) as Wrangler;
}

describe("wrangler.jsonc queues", () => {
  const cfg = readWrangler();
  const envs: [string, QueueCfg | undefined][] = [
    ["production", cfg.queues],
    ...Object.entries(cfg.env ?? {}).map(([name, e]) => [name, e.queues] as [string, QueueCfg | undefined]),
  ];

  it("every environment produces to the queue it consumes", () => {
    for (const [name, q] of envs) {
      expect(q, name).toBeDefined();
      const produced = q!.producers?.find((p) => p.binding === "CALENDAR_SYNC_QUEUE")?.queue;
      expect(produced, name).toBeTruthy();
      expect(q!.consumers?.map((c) => c.queue), name).toEqual([produced]);
    }
  });

  it("no queue has two consumers across environments", () => {
    const consumed = envs.flatMap(([, q]) => q?.consumers?.map((c) => c.queue) ?? []);
    expect(new Set(consumed).size).toBe(consumed.length);
  });

  it("production keeps the name the cutover doc creates", () => {
    expect(cfg.queues?.consumers?.[0]?.queue).toBe("nuvo-calendar-sync");
    expect(cfg.env?.preview?.queues?.consumers?.[0]?.queue).toBe("nuvo-calendar-sync-preview");
  });
});
