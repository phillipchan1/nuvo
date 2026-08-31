/** @vitest-environment jsdom */
/**
 * Domain filing on a loose task, and the domain's face on both shells.
 *
 * HEAD wired DomainPicker onto loose tasks in SlideOver + MobileTaskSheet.
 * A parented task's domain is inherited (resolveDomainId) — setting it on the
 * sheet would silently do nothing — so those surfaces show a read-only chain,
 * not a second writable picker. P/I RecordModal already had the live picker.
 * Domain screens (desktop floor + phone) wear IconPicker for the face.
 *
 * The pickers themselves are driven here (same cheap jsdom pattern as
 * delete-account-ui / year-marks). The surface wiring is read from source
 * (same contract as record-modal-menu / floor-create-cta) — SlideOver and
 * MobileTaskSheet are too hooked to mount without inventing a test seam.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IconPicker } from "../src/components/domain/DomainParts";
import { DomainPicker } from "../src/components/floors/parts";
import type { Domain } from "../src/lib/vertical";

const SRC = join(__dirname, "..", "src");
const rel = (p: string) => p.slice(p.indexOf("/src/") + 1);

function read(relPath: string) {
  return readFileSync(join(SRC, relPath), "utf8");
}

function sliceBetween(src: string, start: string, end: string, label: string) {
  const i = src.indexOf(start);
  expect(i, `${label} must contain ${start}`).toBeGreaterThan(-1);
  const j = src.indexOf(end, i + start.length);
  expect(j, `${label} must contain ${end} after ${start}`).toBeGreaterThan(i);
  return src.slice(i, j);
}

const WORK = { id: "d-work", name: "Work", color: "#7c6f9f", icon: "💼" } as Domain;
const HOME = { id: "d-home", name: "Home", color: "#8a6d4a", icon: "🏠" } as Domain;
const DOMAINS = [WORK, HOME];

describe("DomainPicker", () => {
  it("shows the current domain and opens a writable menu", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DomainPicker domains={DOMAINS} value={WORK.id} onChange={onChange} />);

    const trigger = screen.getByTitle("Change domain");
    expect(trigger.textContent).toContain("💼");
    expect(trigger.textContent).toContain("Work");

    await user.click(trigger);
    expect(screen.getByText("Home")).toBeTruthy();

    await user.click(screen.getByText("Home"));
    expect(onChange).toHaveBeenCalledWith(HOME.id);
  });

  it("offers a trailing no-domain row only when allowClear is on", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DomainPicker domains={DOMAINS} value={WORK.id} onChange={onChange} />,
    );

    await user.click(screen.getByTitle("Change domain"));
    expect(screen.queryByText("no domain")).toBeNull();

    rerender(
      <DomainPicker domains={DOMAINS} value={WORK.id} onChange={onChange} allowClear />,
    );
    await user.click(screen.getByTitle("Change domain"));
    expect(screen.getByText("no domain")).toBeTruthy();

    await user.click(screen.getByText("no domain"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("reads as Domain + ◇ when nothing is filed", () => {
    render(<DomainPicker domains={DOMAINS} value="" onChange={() => {}} />);
    const trigger = screen.getByTitle("Change domain");
    expect(trigger.textContent).toContain("◇");
    expect(trigger.textContent).toContain("Domain");
  });
});

describe("IconPicker", () => {
  it("lets you search and pick a curated face", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <IconPicker value="🏠" domainName="Work" domainContext={null} onPick={onPick} />,
    );

    expect(screen.getByLabelText("Search icons")).toBeTruthy();
    expect(screen.getByLabelText("Set the domain's icon to 💼")).toBeTruthy();
    expect(screen.getByLabelText("Set the domain's icon to 🏠").getAttribute("aria-pressed")).toBe("true");

    await user.click(screen.getByLabelText("Set the domain's icon to 💼"));
    expect(onPick).toHaveBeenCalledWith("💼");

    await user.type(screen.getByLabelText("Search icons"), "sleep");
    expect(screen.getByLabelText("Set the domain's icon to 😴")).toBeTruthy();
    expect(screen.queryByLabelText("Set the domain's icon to 💼")).toBeNull();

    await user.clear(screen.getByLabelText("Search icons"));
    await user.type(screen.getByLabelText("Search icons"), "zzzznotanemoji");
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("wears a 7-col grid on the phone and 8 on the desktop", () => {
    const desk = render(
      <IconPicker value="💼" domainName="Work" onPick={() => {}} />,
    );
    expect(desk.container.querySelector(".grid-cols-8")).toBeTruthy();
    expect(desk.container.querySelector(".grid-cols-7")).toBeNull();
    desk.unmount();

    const phone = render(
      <IconPicker value="💼" domainName="Work" onPick={() => {}} phone />,
    );
    expect(phone.container.querySelector(".grid-cols-7")).toBeTruthy();
    expect(phone.container.querySelector(".grid-cols-8")).toBeNull();
  });
});

describe("loose-task surfaces wire DomainPicker; parented is a read", () => {
  it("TaskPopover (SlideOver) — picker on loose, inherited chain on parented", () => {
    const src = read("components/SlideOver.tsx");
    expect(src, `${rel("components/SlideOver.tsx")} must import DomainPicker`).toMatch(
      /import\s*\{\s*DomainPicker\s*\}\s*from\s*"\.\/floors\/parts"/,
    );

    const popover = sliceBetween(
      src,
      "export function TaskPopover",
      "export function EventPopover",
      "SlideOver",
    );
    expect(popover, "loose branch must mount DomainPicker with allowClear").toMatch(
      /<DomainPicker domains=\{vertical\.domains\} value=\{domain\?\.id \?\? ""\} onChange=\{setDomain\} size="sm" allowClear/,
    );

    const parented = popover.slice(
      popover.indexOf("project || initiative"),
      popover.indexOf("<DomainPicker"),
    );
    expect(parented, "parented branch must be a span, not a picker").toMatch(
      /<span className="mono flex min-w-0 items-center gap-1 truncate text-muted"/,
    );
    expect(parented, "parented branch must not nest a DomainPicker").not.toMatch(/<DomainPicker/);
    expect(parented).toMatch(/◇ Domain/);
    expect(parented).toMatch(/initiative\.name/);
    expect(parented).toMatch(/project\.name/);
  });

  it("MobileTaskSheet — picker on loose, inherited chain on parented", () => {
    const src = read("components/mobile/MobileTaskSheet.tsx");
    expect(src, `${rel("components/mobile/MobileTaskSheet.tsx")} must import DomainPicker`).toMatch(
      /import\s*\{\s*DomainPicker\s*\}\s*from\s*"\.\.\/floors\/parts"/,
    );

    expect(src, "loose branch must mount DomainPicker with allowClear").toMatch(
      /<DomainPicker domains=\{vertical\.domains\} value=\{domain\?\.id \?\? ""\} onChange=\{setDomain\} size="lg" allowClear/,
    );

    const parented = src.slice(src.indexOf("project || initiative"), src.indexOf("<DomainPicker"));
    expect(parented, "parented branch must be a span, not a picker").toMatch(
      /<span className="mono flex min-w-0 items-center gap-1 truncate text-muted"/,
    );
    expect(parented, "parented branch must not nest a DomainPicker").not.toMatch(/<DomainPicker/);
    expect(parented).toMatch(/◇ Domain/);
    expect(parented).toMatch(/initiative\.name/);
    expect(parented).toMatch(/project\.name/);
  });

  it("P/I RecordModal still files through DomainPicker", () => {
    const modal = read("components/record/RecordModal.tsx");
    const project = sliceBetween(modal, "function ProjectRecord", "function InitiativeRecord", "RecordModal");
    const initiative = modal.slice(modal.indexOf("function InitiativeRecord"));

    expect(project, "ProjectRecord must keep a live DomainPicker").toMatch(
      /<DomainPicker[\s\S]*?onChange=\{/,
    );
    expect(initiative, "InitiativeRecord must keep a live DomainPicker").toMatch(
      /<DomainPicker[\s\S]*?onChange=\{/,
    );
  });
});

describe("domain screens wear IconPicker on both shells", () => {
  it("desktop DomainFloor mounts IconPicker", () => {
    const floor = read("components/floors/DomainFloor.tsx");
    expect(floor, `${rel("components/floors/DomainFloor.tsx")} must import IconPicker`).toMatch(
      /IconPicker/,
    );
    expect(floor, "desktop IconDot must mount IconPicker").toMatch(
      /<IconPicker[\s\S]*?onPick=\{/,
    );
  });

  it("phone domain screen mounts IconPicker with phone sizing", () => {
    const phone = read("components/mobile/detail/MobileDomainScreen.tsx");
    expect(phone, `${rel("components/mobile/detail/MobileDomainScreen.tsx")} must import IconPicker`).toMatch(
      /IconPicker/,
    );
    expect(phone, "phone IconPicker must pass phone").toMatch(
      /<IconPicker[\s\S]*?phone/,
    );
  });
});
