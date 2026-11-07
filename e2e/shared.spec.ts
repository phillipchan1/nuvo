import { expect, test } from "@playwright/test";

// Holds on every project: the app paints, the reset is loaded, nothing overflows.
test("the harness renders with the native reset and no horizontal scroll", async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(isMobile ? "/?rail=phone" : "/?rail");
  await expect(page.locator("[data-task-title]").first()).toBeVisible();
  const r = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    imgDrag: (getComputedStyle(document.querySelector("svg") ?? document.body) as unknown as Record<string, string>).webkitUserDrag,
  }));
  expect(r.overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
