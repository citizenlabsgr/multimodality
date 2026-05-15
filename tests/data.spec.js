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
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-dataset", { state: "visible" });

    await expect(page.locator("#dataView")).toBeVisible();
    await expect(page.locator("#dataViewParkingModes")).toBeVisible();
    await expect(
      page.locator("#data-parking-dataset.data-parking-dataset-trigger"),
    ).toBeVisible();
    await expect(page.locator("#data-parking-dataset")).toContainText("All");
    await expect(page.locator("#dataViewMap")).toBeVisible();
  });

  test("should toggle mode buttons and update URL at #/data/parking", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
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
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-dataset", { state: "visible" });

    const trigger = page.locator("#data-parking-dataset");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await page
      .locator('.data-parking-dataset-option[data-dataset-value="garages"]')
      .click();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/data\/parking\?dataset=garages/);

    await trigger.click();
    await page
      .locator('.data-parking-dataset-option[data-dataset-value=""]')
      .click();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/data\/parking$/);
  });
});

test.describe("Data destinations", () => {
  async function waitForAppDataLoaded(page) {
    await page.waitForFunction(
      () =>
        typeof window.appData !== "undefined" &&
        window.appData &&
        Array.isArray(window.appData.destinations) &&
        window.appData.destinations.length > 0,
    );
  }

  test("destinations map defaults to all; Visible and Hidden filter URL and markers", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/destinations");
    await expect(page.locator("#dataViewDestinationsBar")).toBeVisible();
    await expect(page.locator("#dataViewMap")).toBeVisible();
    await expect(page).toHaveURL(/#\/data\/destinations$/);

    const {
      all: allCount,
      visible: visibleCount,
      hidden: hiddenCount,
    } = await page.evaluate(() => {
      const list = window.appData?.destinations || [];
      let v = 0;
      let h = 0;
      for (const d of list) {
        const lat = d.latitude;
        const lng = d.longitude;
        if (typeof lat !== "number" || typeof lng !== "number") continue;
        if (d.hidden === true) h += 1;
        else v += 1;
      }
      return { all: v + h, visible: v, hidden: h };
    });

    await expect(
      page.locator('.data-dest-view-btn[data-dest-view="visible"]'),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.locator('.data-dest-view-btn[data-dest-view="hidden"]'),
    ).toHaveAttribute("aria-pressed", "false");

    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll("#dataViewMap .leaflet-marker-icon")
          .length === expected,
      allCount,
      { timeout: 10_000 },
    );

    await page.locator('.data-dest-view-btn[data-dest-view="visible"]').click();
    await expect(page).toHaveURL(/#\/data\/destinations\?view=visible/);
    await expect(
      page.locator('.data-dest-view-btn[data-dest-view="visible"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll("#dataViewMap .leaflet-marker-icon")
          .length === expected,
      visibleCount,
      { timeout: 10_000 },
    );

    await page.locator('.data-dest-view-btn[data-dest-view="visible"]').click();
    await expect(page).toHaveURL(/#\/data\/destinations$/);
    await expect(
      page.locator('.data-dest-view-btn[data-dest-view="visible"]'),
    ).toHaveAttribute("aria-pressed", "false");
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll("#dataViewMap .leaflet-marker-icon")
          .length === expected,
      allCount,
      { timeout: 10_000 },
    );

    await page.locator('.data-dest-view-btn[data-dest-view="hidden"]').click();
    await expect(page).toHaveURL(/#\/data\/destinations\?view=hidden/);
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll("#dataViewMap .leaflet-marker-icon")
          .length === expected,
      hiddenCount,
      { timeout: 10_000 },
    );

    await page.locator('.data-dest-view-btn[data-dest-view="hidden"]').click();
    await expect(page).toHaveURL(/#\/data\/destinations$/);
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll("#dataViewMap .leaflet-marker-icon")
          .length === expected,
      allCount,
      { timeout: 10_000 },
    );
  });
});
