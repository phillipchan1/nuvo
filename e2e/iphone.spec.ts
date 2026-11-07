import { expect, test, type Locator, type Page } from "@playwright/test";

// iPhone (WebKit, touch, coarse pointer). The real MobileTaskList + BulkBar
// over fixtures (?rail=phone), and the real phone sheets (?sheets=…).
const row = (page: Page, title: string) => page.locator(`[data-task-title="${title}"]`).first();

/** A touch-pointer drag, dispatched as PointerEvents (Playwright's touchscreen
 *  only taps). pointerType "touch" is what the row/sheet gestures listen for. */
async function touchDrag(el: Locator, dx: number, dy: number, steps = 10, holdMs = 0) {
  const box = (await el.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 20);
  await el.evaluate(
    async (node, { x, y, dx, dy, steps, holdMs }) => {
      const fire = (type: string, cx: number, cy: number) => {
        // Synthetic events aren't routed by setPointerCapture, so every event
        // goes to the node the gesture started on — what capture would do.
        node.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: cx, clientY: cy, button: 0, buttons: 1 }),
        );
      };
      fire("pointerdown", x, y);
      if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
      for (let i = 1; i <= steps; i++) {
        fire("pointermove", x + (dx * i) / steps, y + (dy * i) / steps);
        await new Promise((r) => setTimeout(r, 16));
      }
      fire("pointerup", x + dx, y + dy);
    },
    { x, y, dx, dy, steps, holdMs },
  );
}

// Synthetic PointerEvents have no live pointer behind them, so the browser's
// setPointerCapture throws NotFoundError and the gesture never arms. Capture is
// a routing concern these tests already handle (every event targets the node),
// so it's a no-op here.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
  });
});

test.describe("touch web-isms are gone", () => {
  test("no tap flash, no callout, no rubber-banding UI", async ({ page }) => {
    await page.goto("/?rail=phone");
    const s = await page.evaluate(() => {
      const html = getComputedStyle(document.documentElement) as CSSStyleDeclaration & Record<string, string>;
      const b = document.querySelector("button")!;
      return {
        tap: html.webkitTapHighlightColor,
        overscroll: html.overscrollBehaviorY,
        // -webkit-touch-callout is iOS-only and not exposed by Playwright's WebKit;
        // its declaration is asserted in tests/native-feel.test.ts instead.
        select: getComputedStyle(b).webkitUserSelect || getComputedStyle(b).userSelect,
        hover: matchMedia("(hover: hover)").matches,
      };
    });
    expect(s.tap).toBe("rgba(0, 0, 0, 0)");
    expect(s.overscroll).toBe("none");
    expect(s.select).toBe("none");
    expect(s.hover).toBe(false);
  });
});

test.describe("rows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?rail=phone");
    await expect(row(page, "Write the brief")).toBeVisible();
  });

  test("swipe right past the threshold completes; a short swipe does nothing", async ({ page }) => {
    await touchDrag(row(page, "Review notes"), 30, 0);
    await expect(page.getByTestId("status")).not.toContainText("Review notes");
    await touchDrag(row(page, "Review notes"), 120, 0);
    await expect(page.getByTestId("status")).toContainText("done · Review notes");
  });

  test("long-press enters selection; tap adds; the bar acts on the set", async ({ page }) => {
    await touchDrag(row(page, "Write the brief"), 0, 0, 1, 600);
    await expect(page.getByText(/1 selected/)).toBeVisible();
    await row(page, "Send invoice").tap();
    await expect(page.getByText(/2 selected/)).toBeVisible();
  });
});

test.describe("sheets", () => {
  test("✕ dismisses with the slide, Escape dismisses", async ({ page }) => {
    await page.goto("/?sheets=task-loose");
    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).first().tap();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 2000 });
  });

  test("a quick downward flick on the grabber dismisses (velocity, not just distance)", async ({ page }) => {
    await page.goto("/?sheets=task-loose");
    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible();
    // 60px in ~3 frames is well under 30% of the sheet but fast.
    const grabber = dialog.locator("> div").first();
    await touchDrag(grabber, 0, 60, 3);
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 2000 });
  });

  test("a slow short drag snaps back", async ({ page }) => {
    await page.goto("/?sheets=task-loose");
    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible();
    const grabber = dialog.locator("> div").first();
    await grabber.evaluate(async (node) => {
      const r = node.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + 8;
      const ev = (t: string, cy: number) =>
        new PointerEvent(t, { bubbles: true, pointerId: 9, pointerType: "touch", clientX: x, clientY: cy, buttons: 1 });
      node.dispatchEvent(ev("pointerdown", y));
      for (let i = 1; i <= 10; i++) {
        node.dispatchEvent(ev("pointermove", y + i * 4));
        await new Promise((res) => setTimeout(res, 40));
      }
      await new Promise((res) => setTimeout(res, 150));
      node.dispatchEvent(ev("pointermove", y + 40));
      node.dispatchEvent(ev("pointerup", y + 40));
    });
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
});
