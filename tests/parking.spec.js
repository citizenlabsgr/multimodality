import { test, expect } from "@playwright/test";
import { installConsoleErrorAssertions } from "./helpers/console-errors.js";

installConsoleErrorAssertions(test);

test.describe("Parking map (#/parking)", () => {
  async function waitForParkingData(page) {
    await page.waitForFunction(() => typeof globalThis.L !== "undefined");
    await page.waitForFunction(
      () =>
        Array.isArray(window.appData?.parking?.garages) &&
        window.appData.parking.garages.length > 0,
    );
  }

  async function waitForParkingLeafletMap(page) {
    await page.waitForFunction(
      () => typeof globalThis.__parkingMapForTest?.getZoom === "function",
      { timeout: 15000 },
    );
  }

  test("shows Leaflet map with DASH routes and parking spots", async ({
    page,
  }) => {
    await page.goto("/#/parking");
    await waitForParkingData(page);
    await expect(page.locator("#parkingView")).toBeVisible();
    await expect(page.locator("#appView")).toBeHidden();
    await expect(page.locator("#parkingAppMap")).toHaveClass(
      /leaflet-container/,
      {
        timeout: 15000,
      },
    );
    await expect(
      page.locator("#parkingAppMap .leaflet-overlay-pane path").first(),
    ).toBeVisible({ timeout: 5000 });
    const pathCount = await page
      .locator("#parkingAppMap .leaflet-overlay-pane path")
      .count();
    expect(pathCount).toBeGreaterThan(15);

    await expect(page.locator("#parkingMapChrome")).toBeVisible();
    await expect(page.locator("#parkingDestinationSelect")).toBeVisible();
    await expect(
      page.locator('#parkingDestinationSelect option[value="van-andel-arena"]'),
    ).toBeAttached();

    await expect(page.locator("#parkingFilterBar button")).toHaveCount(4);
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-garage"]'),
    ).toBeVisible();

    await page.selectOption("#parkingDestinationSelect", "van-andel-arena");
    await expect(page).toHaveURL(/[?&]destination=van-andel-arena(?:&|$)/);
    await expect(
      page.locator("#parkingAppMap .leaflet-marker-pane .leaflet-marker-icon"),
    ).toBeVisible({ timeout: 5000 });

    const before = await page
      .locator("#parkingAppMap .leaflet-overlay-pane path")
      .count();
    await page
      .locator('#parkingFilterBar [data-parking-category="public-garage"]')
      .click();
    await expect(page).toHaveURL(/#\/parking\?location=/);
    await page.waitForFunction(
      (prev) =>
        document.querySelectorAll("#parkingAppMap .leaflet-overlay-pane path")
          .length < prev,
      before,
    );
  });

  test("preserves destination and category filters in the URL across reload", async ({
    page,
  }) => {
    await page.goto("/#/parking");
    await waitForParkingData(page);

    await page.selectOption("#parkingDestinationSelect", "van-andel-arena");
    await expect(page).toHaveURL(/[?&]destination=van-andel-arena(?:&|$)/);

    await page
      .locator('#parkingFilterBar [data-parking-category="public-garage"]')
      .click();
    await expect(page).toHaveURL(/[?&]location=/);
    await expect(page).toHaveURL(/[?&]destination=van-andel-arena(?:&|$)/);

    await page.reload();
    await waitForParkingData(page);

    await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
      "van-andel-arena",
    );
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-garage"]'),
    ).toHaveAttribute("aria-pressed", "false");

    await page.goto(
      "/#/parking?destination=acrisure-amphitheater&location=private-garage,public-lot",
    );
    await waitForParkingData(page);

    await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
      "acrisure-amphitheater",
    );
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-lot"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator(
        '#parkingFilterBar [data-parking-category="private-garage"]',
      ),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-garage"]'),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("parses legacy category tokens (garages, osmLots) into canonical ids", async ({
    page,
  }) => {
    await page.goto("/#/parking?location=garages,osmLots");
    await waitForParkingData(page);
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-garage"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="private-lot"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-lot"]'),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test.describe("Destination select and inline reset", () => {
    test("shows chevron affordance when empty and hides inline reset", async ({
      page,
    }) => {
      await page.goto("/#/parking");
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue("");
      await expect(page.locator("#parkingDestChevron")).toBeVisible();
      await expect(page.locator("#parkingResetBtn")).toBeHidden();
    });

    test("shows inline reset and hides chevron after choosing a destination", async ({
      page,
    }) => {
      await page.goto("/#/parking");
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestChevron")).toBeVisible();
      await expect(page.locator("#parkingResetBtn")).toBeHidden();

      await page.selectOption("#parkingDestinationSelect", "van-andel-arena");
      await expect(page).toHaveURL(/[?&]destination=van-andel-arena(?:&|$)/);
      await expect(page.locator("#parkingDestChevron")).toBeHidden();
      await expect(page.locator("#parkingResetBtn")).toBeVisible();
    });

    test("shows inline reset on load when hash has destination", async ({
      page,
    }) => {
      await page.goto("/#/parking?destination=acrisure-amphitheater");
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "acrisure-amphitheater",
      );
      await expect(page.locator("#parkingDestChevron")).toBeHidden();
      await expect(page.locator("#parkingResetBtn")).toBeVisible();
    });
  });

  test("reset clears URL and destination", async ({ page }) => {
    await page.goto(
      "/#/parking?destination=van-andel-arena&location=public-garage",
    );
    await waitForParkingData(page);

    await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
      "van-andel-arena",
    );
    await expect(page.locator("#parkingDestChevron")).toBeHidden();
    await expect(page.locator("#parkingResetBtn")).toBeVisible();

    await page.locator("#parkingResetBtn").click();
    await expect(page).toHaveURL(/#\/parking$/);
    await expect(page.locator("#parkingDestinationSelect")).toHaveValue("");
    await expect(page.locator("#parkingDestChevron")).toBeVisible();
    await expect(page.locator("#parkingResetBtn")).toBeHidden();
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-garage"]'),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("refits map view when a category filter changes", async ({ page }) => {
    await page.goto("/#/parking");
    await waitForParkingData(page);
    await waitForParkingLeafletMap(page);

    const before = await page.evaluate(() => {
      const m = globalThis.__parkingMapForTest;
      const c = m.getCenter();
      return { z: m.getZoom(), lat: c.lat, lng: c.lng };
    });

    await page
      .locator('#parkingFilterBar [data-parking-category="public-garage"]')
      .click();
    await expect(page).toHaveURL(/[?&]location=/);

    await page.waitForFunction(
      (prev) => {
        const m = globalThis.__parkingMapForTest;
        if (!m || !prev) return false;
        const z = m.getZoom();
        const c = m.getCenter();
        return (
          z !== prev.z ||
          Math.abs(c.lat - prev.lat) > 1e-5 ||
          Math.abs(c.lng - prev.lng) > 1e-5
        );
      },
      before,
      { timeout: 8000 },
    );
  });

  test("refits when private-lot filter is turned off (tighter bbox can zoom in)", async ({
    page,
  }) => {
    await page.goto("/#/parking");
    await waitForParkingData(page);
    await waitForParkingLeafletMap(page);

    const before = await page.evaluate(() => {
      const m = globalThis.__parkingMapForTest;
      const c = m.getCenter();
      return { z: m.getZoom(), lat: c.lat, lng: c.lng };
    });

    await page
      .locator('#parkingFilterBar [data-parking-category="private-lot"]')
      .click();
    await expect(page).toHaveURL(/[?&]location=/);

    await page.waitForFunction(
      (prev) => {
        const m = globalThis.__parkingMapForTest;
        if (!m || !prev) return false;
        const z = m.getZoom();
        const c = m.getCenter();
        return (
          z !== prev.z ||
          Math.abs(c.lat - prev.lat) > 1e-5 ||
          Math.abs(c.lng - prev.lng) > 1e-5
        );
      },
      before,
      { timeout: 8000 },
    );
  });
});
