import { test, expect } from "@playwright/test";
import { installConsoleErrorAssertions } from "./helpers/console-errors.js";

installConsoleErrorAssertions(test);

test.describe("Parking map (#/parking)", () => {
  test("shows an empty Leaflet map", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => typeof globalThis.L !== "undefined");
    await page.goto("/#/parking");
    await expect(page.locator("#parkingView")).toBeVisible();
    await expect(page.locator("#appView")).toBeHidden();
    await expect(page.locator("#parkingAppMap")).toHaveClass(
      /leaflet-container/,
      {
        timeout: 15000,
      },
    );
  });
});
