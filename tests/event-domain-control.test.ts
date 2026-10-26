import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("event domain control wiring", () => {
  it("uses one shared control on desktop and mobile", () => {
    const desktop = read("src/components/SlideOver.tsx");
    const mobile = read("src/components/mobile/MobileEventSheet.tsx");
    expect(desktop).toMatch(/<EventDomainControl event=\{event\}/);
    expect(mobile).toMatch(/<EventDomainControl event=\{attributionEvent\} mobile/);
  });

  it("writes a separate manual override instead of replacing AI inference", () => {
    const hook = read("src/hooks/useEventRouting.ts");
    const migration = read("supabase/migrations/00000000000082_event_domain_overrides.sql");
    expect(hook).toMatch(/manual_domain_id: domainId/);
    expect(migration).toMatch(/add column if not exists manual_domain_id uuid/);
    expect(migration).toMatch(/references public\.domains/);
  });

  it("uses a nested mobile Sheet with full tap rows", () => {
    const control = read("src/components/domain/EventDomainControl.tsx");
    const kit = read("src/components/mobile/sheetKit.tsx");
    // The phone's row opens the shared picker Sheet — never a floating menu.
    expect(control).toMatch(/<PickSheet\s+title="Counts toward"/);
    expect(control).toMatch(/eventDomainAttribution/);
    expect(kit).toMatch(/<Sheet title=\{title\}/);
    expect(kit).toMatch(/className="tap fast flex w-full/);
  });
});
