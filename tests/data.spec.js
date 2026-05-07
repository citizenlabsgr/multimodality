import { test, expect } from "@playwright/test";
import { installConsoleErrorAssertions } from "./helpers/console-errors.js";

installConsoleErrorAssertions(test);

test.describe("Data routes", () => {
  async function waitForAppDataLoaded(page) {
    await page.waitForFunction(
      () =>
        typeof window.appData !== "undefined" &&
        window.appData &&
        window.appData.parking &&
        Array.isArray(window.appData.parking.garages),
    );
  }

  test("should show parking data and dataset dropdown at #/data/parking", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-dataset", { state: "visible" });

    await expect(page.locator("#dataView")).toBeVisible();
    await expect(page.locator("#dataViewParkingModes")).toBeVisible();
    await expect(
      page.locator("#data-parking-dataset.data-parking-dataset-select"),
    ).toBeVisible();
    await expect(
      page.locator("#data-parking-dataset option[value='']"),
    ).toHaveText("All");
    await expect(page.locator("#dataViewMap")).toBeVisible();
  });

  test("should toggle mode buttons and update URL at #/data/parking", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-dataset", { state: "visible" });

    await expect(page.locator("#dataViewParkingModes")).toBeVisible();
    const driveBtn = page.locator('.data-parking-mode-btn[data-mode="drive"]');
    await expect(driveBtn).toBeVisible();
    await expect(driveBtn).toContainText("Drive");

    await driveBtn.click();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/data\/parking\?modes=drive/);

    const bikeBtn = page.locator('.data-parking-mode-btn[data-mode="bike"]');
    await bikeBtn.click();
    await page.waitForTimeout(300);
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/modes=drive,bike|modes=bike,drive/);

    await driveBtn.click();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/data\/parking\?modes=bike/);
  });

  test("should change dataset dropdown and update URL at #/data/parking", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-dataset", { state: "visible" });

    const dropdown = page.locator("#data-parking-dataset");
    await expect(dropdown).toBeVisible();
    await dropdown.selectOption("garages");
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/data\/parking\?dataset=garages/);

    await dropdown.selectOption("");
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/data\/parking$/);
  });

  test("should show strategies and destination filters at #/data/strategies", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/strategies");
    await page.waitForSelector("#dataViewStrategiesFilters", {
      state: "visible",
    });

    await expect(page.locator("#dataView")).toBeVisible();
    await expect(page.locator("#dataViewStrategiesFilters")).toBeVisible();
    await expect(page.locator("#dataViewMap")).toBeVisible();
  });
});
