// @vitest-environment jsdom
/**
 * Phone search lost its field off the top of the screen. It was a screen-sized
 * (`tall`) sheet padded up from the bottom for the keyboard — which leaves no
 * body once the keys take their share, and doesn't follow iOS when it pans the
 * page to a focused field. A sheet that opts into `fitViewport` is instead laid
 * out *inside* the visual viewport. Guard both halves: the sheet follows the
 * strip, and search docks its field below its results.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sheet from "../src/components/mobile/Sheet";
import MobileSearch from "../src/components/mobile/MobileSearch";
import type { VerticalData } from "../src/lib/vertical";

type FakeVV = EventTarget & { height: number; offsetTop: number };

function installViewport(innerHeight: number): FakeVV {
  const vv = Object.assign(new EventTarget(), { height: innerHeight, offsetTop: 0 }) as FakeVV;
  Object.defineProperty(window, "innerHeight", { value: innerHeight, configurable: true });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  return vv;
}

const move = (vv: FakeVV, height: number, offsetTop = 0) =>
  act(() => {
    vv.height = height;
    vv.offsetTop = offsetTop;
    vv.dispatchEvent(new Event("resize"));
  });

const scrim = () => document.querySelector<HTMLElement>(".ph-scrim")!;
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

describe("Sheet fitViewport", () => {
  let vv: FakeVV;
  beforeEach(() => {
    vv = installViewport(844);
  });
  afterEach(() => {
    document.body.className = "";
    vi.restoreAllMocks();
  });

  it("is the whole screen while the keyboard is down", () => {
    render(<Sheet onClose={() => {}} tall fitViewport>x</Sheet>);
    expect(scrim().style.height).toBe("");
    expect(sheet().className).toContain("pb-safe");
  });

  it("shrinks the scrim to what the keyboard left, and stops padding for it", () => {
    render(<Sheet onClose={() => {}} tall fitViewport>x</Sheet>);
    move(vv, 504);
    expect(scrim().style.top).toBe("0px");
    expect(scrim().style.height).toBe("504px");
    expect(sheet().className).toContain("sheet-h-fit");
    expect(sheet().style.paddingBottom).toBe("0px");
  });

  it("follows the page when iOS pans it down to the field", () => {
    render(<Sheet onClose={() => {}} tall fitViewport>x</Sheet>);
    move(vv, 504, 120);
    expect(scrim().style.top).toBe("120px");
    expect(scrim().style.height).toBe("504px");
  });

  it("ignores a toolbar settling — that isn't a keyboard", () => {
    render(<Sheet onClose={() => {}} tall fitViewport>x</Sheet>);
    move(vv, 800);
    expect(scrim().style.height).toBe("");
  });

  it("leaves every other sheet on the old padding path", () => {
    render(<Sheet onClose={() => {}}>x</Sheet>);
    move(vv, 504);
    expect(scrim().style.height).toBe("");
    expect(sheet().style.paddingBottom).toBe("340px");
  });
});

describe("MobileSearch", () => {
  it("docks the field under its results, inside a viewport-fitted sheet", () => {
    installViewport(844);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const vertical = { domains: [], initiatives: [], projects: [], tasks: [] } as unknown as VerticalData;
    render(
      <QueryClientProvider client={client}>
        <MobileSearch vertical={vertical} tasks={[]} onOpenItem={() => {}} onOpenTask={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const input = sheet().querySelector("input")!;
    const scroller = sheet().querySelector(".overflow-y-auto")!;
    // The field comes after the scroller in the document — so it's the bottom edge.
    expect(scroller.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sheet().className).toContain("sheet-h-tall");
  });
});
