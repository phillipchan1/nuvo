import { expect, test, type Page } from "@playwright/test";

// Desktop: the real LeftRail over fixtures (?rail). Writes are stubbed.
const row = (page: Page, title: string) => page.locator(`[data-task-title="${title}"]`).first();
const MOD = process.platform === "darwin" ? "Meta" : "Control";

test.beforeEach(async ({ page }) => {
  await page.goto("/?rail");
  await expect(row(page, "Write the brief")).toBeVisible();
});

test.describe("multi-select", () => {
  test("click, ⌘-click toggles, ⇧-click ranges", async ({ page }) => {
    await row(page, "Write the brief").click();
    await row(page, "Send invoice").click({ modifiers: [MOD] });
    await expect(page.getByText(/2 selected/)).toBeVisible();
    // ⌘-click again takes it back out
    await row(page, "Send invoice").click({ modifiers: [MOD] });
    await expect(page.getByText(/2 selected/)).toHaveCount(0);
    // ⇧-click from the anchor: a range of three
    await row(page, "Write the brief").click();
    await row(page, "Send invoice").click({ modifiers: ["Shift"] });
    await expect(page.getByText(/3 selected/)).toBeVisible();
  });

  test("keyboard: ⌘A selects all, ⇧↓ extends, Esc clears", async ({ page }) => {
    await row(page, "Write the brief").click({ modifiers: [MOD] });
    await page.keyboard.press("Shift+ArrowDown");
    await expect(page.getByText(/2 selected/)).toBeVisible();
    await page.keyboard.press(`${MOD}+a`);
    await expect(page.getByText(/\d+ selected/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(/\d+ selected/)).toHaveCount(0);
  });
});

test.describe("context menu", () => {
  test("right-click opens the app menu, not the browser's; Esc dismisses", async ({ page }) => {
    await row(page, "Review notes").click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByText("Trash")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("the browser menu is suppressed on chrome but kept in fields", async ({ page }) => {
    const prevented = await page.evaluate(() => {
      const fire = (el: Element) => !el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const label = document.querySelector(".section-label")!;
      const input = document.createElement("input");
      document.body.appendChild(input);
      const r = { chrome: fire(label), field: fire(input) };
      input.remove();
      return r;
    });
    expect(prevented).toEqual({ chrome: true, field: false });
  });
});

test.describe("chrome is not a web page", () => {
  test("arrow cursor and no text selection on controls", async ({ page }) => {
    const s = await page.evaluate(() => {
      const b = document.querySelector("button")!;
      const r = document.querySelector("[data-task-title]")!;
      return {
        button: getComputedStyle(b).cursor,
        buttonSelect: getComputedStyle(b).userSelect,
        row: getComputedStyle(r).cursor,
        rowSelect: getComputedStyle(r).userSelect,
      };
    });
    expect(s.button).toBe("default");
    expect(s.buttonSelect).toBe("none");
    expect(s.row).not.toBe("pointer");
    expect(s.rowSelect).toBe("none");
  });

  test("double-clicking a control never highlights text", async ({ page }) => {
    await page.locator("button").filter({ hasText: /\S/ }).first().dblclick();
    const selected = await page.evaluate(() => String(window.getSelection() ?? ""));
    expect(selected).toBe("");
  });

  test("tooltips wait ~500ms, then show styled", async ({ page }) => {
    const titled = page.locator("[title]").first();
    await expect(titled).toBeAttached();
    await titled.hover();
    await page.waitForTimeout(150);
    await expect(page.locator(".native-tooltip.is-visible")).toHaveCount(0);
    await expect(page.locator(".native-tooltip.is-visible")).toHaveCount(1, { timeout: 1500 });
  });
});
