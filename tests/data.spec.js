import { test, expect } from "@playwright/test";
import { installConsoleErrorAssertions } from "./helpers/console-errors.js";

installConsoleErrorAssertions(test);

test.describe("Data index and navigation", () => {
  async function waitForAppDataLoaded(page) {
    await page.waitForFunction(
      () =>
        typeof window.appData !== "undefined" &&
        window.appData &&
        window.appData.parking &&
        Array.isArray(window.appData.parking.garages),
    );
  }

  test("should redirect #/data to default tab and show tab bar", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data");

    await expect(page).toHaveURL(/#\/data\/destinations$/);
    await expect(page.locator("#dataView")).toBeVisible();
    await expect(page.locator("#dataViewTabs")).toBeVisible();
    await expect(page.locator("#dataViewTabs .data-view-tab")).toHaveCount(3);
    await expect(
      page.locator('#dataViewTabs .data-view-tab[aria-selected="true"]'),
    ).toContainText("Destinations");
    await expect(page.locator("#dataViewDestinationsBar")).toBeVisible();
    await expect(page.locator("#dataViewMap")).toBeVisible();
  });

  test("tab links update URL when switching sections", async ({ page }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-dataset", { state: "visible" });

    await expect(
      page.locator('#dataViewTabs .data-view-tab[aria-selected="true"]'),
    ).toContainText("Parking");

    await page.locator('#dataViewTabs a[href="#/data/destinations"]').click();
    await expect(page).toHaveURL(/#\/data\/destinations$/);
    await expect(page.locator("#dataViewDestinationsBar")).toBeVisible();
    await expect(
      page.locator('#dataViewTabs .data-view-tab[aria-selected="true"]'),
    ).toContainText("Destinations");

    await page.locator('#dataViewTabs a[href="#/data/routes"]').click();
    await expect(page).toHaveURL(/#\/data\/routes$/);
    await expect(page.locator("#dataViewRoutesModes")).toBeVisible();
    await expect(
      page.locator('#dataViewTabs .data-view-tab[aria-selected="true"]'),
    ).toContainText("Routes");
  });
});

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

  test("should open parking dataset dropdown panel when trigger is clicked", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-dataset", { state: "visible" });

    const trigger = page.locator("#data-parking-dataset");
    const panel = page.locator("#data-parking-dataset-panel");
    const garagesOption = page.locator(
      '.data-parking-dataset-option[data-dataset-value="garages"]',
    );

    await expect(panel).toHaveClass(/hidden/);
    await trigger.click();
    await expect(panel).not.toHaveClass(/hidden/);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(garagesOption).toBeVisible();

    const optionReceivesClick = await garagesOption.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const topEl = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return el === topEl || el.contains(topEl);
    });
    expect(optionReceivesClick).toBe(true);
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
      .locator('.data-parking-dataset-option[data-dataset-value="osmGarages"]')
      .click();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/data\/parking\?dataset=osmGarages/);
    await expect(trigger).toContainText("Private Parking Garages");
    const labelFits = await trigger.evaluate((el) => {
      const label = el.querySelector("span.whitespace-nowrap");
      if (!label) return false;
      const rect = label.getBoundingClientRect();
      return label.scrollWidth <= rect.width + 1;
    });
    expect(labelFits).toBe(true);

    await trigger.click();
    await page
      .locator('.data-parking-dataset-option[data-dataset-value=""]')
      .click();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/#\/data\/parking$/);
  });

  test("should filter parking markers by q= on name, address, and override note", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);

    await page.goto("/#/data/parking?dataset=osmLots&q=airgarage");
    await page.waitForSelector("#data-parking-q-filter", { state: "visible" });
    await expect(page.locator("#data-parking-q-filter")).toHaveValue(
      "airgarage",
    );

    const markerCount = await page.evaluate(() => {
      return document.querySelectorAll(
        "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
      ).length;
    });
    expect(markerCount).toBeGreaterThanOrEqual(2);

    await page.goto("/#/data/parking?dataset=osmLots&q=zzznomatchzzz");
    await page.waitForTimeout(400);
    const emptyCount = await page.evaluate(() => {
      return document.querySelectorAll(
        "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
      ).length;
    });
    expect(emptyCount).toBe(0);

    await page.goto("/#/data/parking?dataset=osmLots&q=AIRGARAGE");
    await page.waitForTimeout(400);
    const caseCount = await page.evaluate(() => {
      return document.querySelectorAll(
        "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
      ).length;
    });
    expect(caseCount).toBeGreaterThanOrEqual(2);
  });

  test("should preserve q= when toggling parking mode buttons", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking?q=airgarage");
    await page.waitForSelector(".data-parking-mode-btn[data-mode=drive]", {
      state: "visible",
    });
    await page.locator('.data-parking-mode-btn[data-mode="drive"]').click();
    await page.waitForTimeout(400);
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain("q=airgarage");
    expect(hash).toMatch(/modes=drive/);
  });

  test("should apply #/data/parking?q= across all datasets (no dataset param)", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);

    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-q-filter", { state: "visible" });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
        ).length > 50,
    );

    const unfilteredCount = await page.evaluate(() => {
      return document.querySelectorAll(
        "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
      ).length;
    });

    await page.goto("/#/data/parking?q=airgarage");
    await page.waitForSelector("#data-parking-q-filter", { state: "visible" });
    await expect(page).toHaveURL(/#\/data\/parking\?q=airgarage/);
    await expect(page.locator("#data-parking-q-filter")).toHaveValue(
      "airgarage",
    );
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
        ).length < 50,
    );

    const filteredCount = await page.evaluate(() => {
      return document.querySelectorAll(
        "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
      ).length;
    });

    expect(filteredCount).toBeGreaterThanOrEqual(2);
    expect(filteredCount).toBeLessThan(unfilteredCount);
  });

  test("should update URL when typing in parking search (debounced)", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-q-filter", { state: "visible" });

    const input = page.locator("#data-parking-q-filter");
    await input.fill("airgarage");
    await expect(page).toHaveURL(/#\/data\/parking$/);
    await page.waitForFunction(() => /q=airgarage/.test(window.location.hash));
    await expect(page).toHaveURL(/q=airgarage/);
    await expect(input).toBeFocused();
  });

  test("data parking search filter keeps focus after debounced URL update", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-q-filter", { state: "visible" });

    const input = page.locator("#data-parking-q-filter");
    await input.click();
    await input.type("gran", { delay: 25 });
    await page.waitForFunction(() => /q=gran/.test(window.location.hash), {
      timeout: 6000,
    });
    await expect(input).toHaveValue("gran");
    await expect(input).toBeFocused();
  });

  test("clear button clears parking search and preserves pin in URL", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);

    const pin = "public-garage:42.960041,-85.669489";
    await page.goto(`/#/data/parking?q=cherry&pin=${encodeURIComponent(pin)}`);
    await page.waitForSelector("#data-parking-q-filter", { state: "visible" });

    const input = page.locator("#data-parking-q-filter");
    const clearBtn = page.locator("#data-parking-q-clear");
    await expect(input).toHaveValue("cherry");
    await expect(clearBtn).toBeVisible();

    await clearBtn.click();
    await expect(input).toHaveValue("");
    await expect(clearBtn).toBeHidden();
    await expect(page).toHaveURL(
      new RegExp(
        `#/data/parking\\?pin=${pin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      ),
    );
    await expect(input).toBeFocused();
  });

  test("should cycle known-cost tri-state checkbox and update URL", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);

    await page.goto("/#/data/parking");
    await page.waitForSelector("#data-parking-known-cost-filter", {
      state: "visible",
    });

    const checkbox = page.locator("#data-parking-known-cost-filter");
    const label = page.locator(".data-parking-known-cost-filter__text");

    await expect(checkbox).toHaveAttribute("aria-checked", "false");
    await expect(label).toHaveText("Known cost");

    await checkbox.click();
    await expect(page).toHaveURL(/cost=known/);
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await expect(label).toHaveText("Known cost");

    await checkbox.click();
    await expect(page).toHaveURL(/cost=unknown/);
    await expect(checkbox).toHaveAttribute("aria-checked", "mixed");
    await expect(label).toHaveText("Known cost");

    await checkbox.click();
    await expect(page).toHaveURL(/#\/data\/parking$/);
    await expect(checkbox).toHaveAttribute("aria-checked", "false");
    await expect(label).toHaveText("Known cost");
  });

  test("should filter parking markers by cost=known vs unknown", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);

    const markerCount = () =>
      page.evaluate(
        () =>
          document.querySelectorAll(
            "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
          ).length,
      );

    await page.goto("/#/data/parking?dataset=osmGarages");
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
        ).length > 0,
    );
    const allCount = await markerCount();
    expect(allCount).toBeGreaterThan(0);

    await page.goto("/#/data/parking?dataset=osmGarages&cost=known");
    await page.waitForTimeout(300);
    const knownCount = await markerCount();
    expect(knownCount).toBeGreaterThan(0);
    expect(knownCount).toBeLessThan(allCount);

    await page.goto("/#/data/parking?dataset=osmGarages&cost=unknown");
    await page.waitForTimeout(300);
    const unknownCount = await markerCount();
    expect(unknownCount).toBeGreaterThan(0);
    expect(knownCount + unknownCount).toBe(allCount);

    await page.goto("/#/data/parking?dataset=garages");
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
        ).length > 0,
    );
    const garagesAll = await markerCount();

    await page.goto("/#/data/parking?dataset=garages&cost=known");
    await page.waitForTimeout(300);
    const garagesKnown = await markerCount();
    expect(garagesKnown).toBe(garagesAll);
  });

  test("should treat spots displayed as Free as known cost", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);

    const markerCount = () =>
      page.evaluate(
        () =>
          document.querySelectorAll(
            "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
          ).length,
      );

    await page.goto("/#/data/parking?dataset=racks");
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "#dataViewMap .leaflet-marker-pane .leaflet-marker-icon",
        ).length > 0,
    );
    const allRacks = await markerCount();
    expect(allRacks).toBeGreaterThan(0);

    await page.goto("/#/data/parking?dataset=racks&cost=known");
    await page.waitForTimeout(300);
    const knownRacks = await markerCount();
    expect(knownRacks).toBe(allRacks);

    await page.goto("/#/data/parking?dataset=racks&cost=unknown");
    await page.waitForTimeout(300);
    const unknownRacks = await markerCount();
    expect(unknownRacks).toBe(0);
  });

  test("should preserve cost= when toggling parking mode buttons", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);

    await page.goto("/#/data/parking?cost=unknown");
    await page.waitForSelector(".data-parking-mode-btn[data-mode=drive]", {
      state: "visible",
    });
    await page.locator('.data-parking-mode-btn[data-mode="drive"]').click();
    await page.waitForTimeout(400);
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain("cost=unknown");
    expect(hash).toMatch(/modes=drive/);
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

  test("Visible and Hidden can both be selected; union shows all markers", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForSelector("#parkingDestinationSelect");
    await waitForAppDataLoaded(page);
    await page.goto("/#/data/destinations");
    await expect(page.locator("#dataViewDestinationsBar")).toBeVisible();

    const allCount = await page.evaluate(() => {
      const list = window.appData?.destinations || [];
      let n = 0;
      for (const d of list) {
        if (typeof d.latitude === "number" && typeof d.longitude === "number") {
          n += 1;
        }
      }
      return n;
    });

    await page.locator('.data-dest-view-btn[data-dest-view="visible"]').click();
    await expect(page).toHaveURL(/#\/data\/destinations\?view=visible/);
    await expect(
      page.locator('.data-dest-view-btn[data-dest-view="visible"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('.data-dest-view-btn[data-dest-view="hidden"]'),
    ).toHaveAttribute("aria-pressed", "false");

    await page.locator('.data-dest-view-btn[data-dest-view="hidden"]').click();
    await expect(page).toHaveURL(/#\/data\/destinations\?view=visible,hidden/);
    await expect(
      page.locator('.data-dest-view-btn[data-dest-view="visible"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('.data-dest-view-btn[data-dest-view="hidden"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll("#dataViewMap .leaflet-marker-icon")
          .length === expected,
      allCount,
      { timeout: 10_000 },
    );
  });
});

/**
 * `#/data/*` layout snapshots: **`data-{slug}.png`** (e.g. **`data-parking.png`**) at **1000×900**.
 */
const DATA_SNAPSHOT_CASES = [
  { slug: "parking", hashPath: "data/parking", minMarkers: 50 },
  { slug: "destinations", hashPath: "data/destinations", minMarkers: 1 },
  { slug: "routes", hashPath: "data/routes", minMapLayers: 1 },
];

const DATA_SNAPSHOT_WIDTH = 1000;
const DATA_SNAPSHOT_HEIGHT = 900;

async function assertDataPageScreenshot(
  page,
  { hashPath, snapshotName, width, height, minMarkers, minMapLayers },
) {
  const dataTimeout = { timeout: 20_000 };
  await page.setViewportSize({ width, height });
  await page.goto(`/#/${hashPath}`);
  await page.waitForFunction(
    () => typeof globalThis.L !== "undefined",
    dataTimeout,
  );
  await page.waitForFunction(
    () =>
      Array.isArray(window.appData?.parking?.garages) &&
      window.appData.parking.garages.length > 0,
    dataTimeout,
  );
  await expect(page.locator("#dataView")).toBeVisible();

  if (minMarkers != null || minMapLayers != null) {
    await expect(page.locator("#dataViewMap")).toBeVisible();
    await page.waitForFunction(
      () => typeof globalThis.__dataMapForTest?.getZoom === "function",
      { timeout: 15_000 },
    );
    if (minMarkers != null) {
      await page.waitForFunction(
        (min) =>
          document.querySelectorAll("#dataViewMap .leaflet-marker-icon")
            .length >= min,
        minMarkers,
        { timeout: 15_000 },
      );
    }
    if (minMapLayers != null) {
      await page.waitForFunction(
        (min) => {
          const markers = document.querySelectorAll(
            "#dataViewMap .leaflet-marker-icon",
          ).length;
          const paths = document.querySelectorAll(
            "#dataViewMap .leaflet-overlay-pane path",
          ).length;
          return markers + paths >= min;
        },
        minMapLayers,
        { timeout: 15_000 },
      );
    }
    await page.evaluate(() => globalThis.__dataMapForTest?.invalidateSize?.());
    await new Promise((r) => setTimeout(r, 400));
  } else {
    await expect(page.locator("#dataViewTabs")).toBeVisible();
    await expect(page.locator("#dataViewMap")).toBeHidden();
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    `,
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );

  await expect(page).toHaveScreenshot(`${snapshotName}.png`, {
    fullPage: true,
    timeout: 20_000,
    maxDiffPixels: 900,
  });
}

test.describe("@snapshot Data page layout", { tag: "@snapshot" }, () => {
  test.describe.configure({ mode: "serial", timeout: 45_000 });

  for (const {
    slug,
    hashPath,
    minMarkers,
    minMapLayers,
  } of DATA_SNAPSHOT_CASES) {
    test(slug, { tag: "@snapshot" }, async ({ page }) => {
      await assertDataPageScreenshot(page, {
        hashPath,
        snapshotName: `data-${slug}`,
        width: DATA_SNAPSHOT_WIDTH,
        height: DATA_SNAPSHOT_HEIGHT,
        minMarkers,
        minMapLayers,
      });
    });
  }
});
