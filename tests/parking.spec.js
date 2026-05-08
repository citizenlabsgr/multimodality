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
    await expect(page).toHaveURL(/[?&]finish=van-andel-arena(?:&|$)/);
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
    await expect(page).toHaveURL(/[?&]finish=van-andel-arena(?:&|$)/);

    await page
      .locator('#parkingFilterBar [data-parking-category="public-garage"]')
      .click();
    await expect(page).toHaveURL(/[?&]location=/);
    await expect(page).toHaveURL(/[?&]finish=van-andel-arena(?:&|$)/);

    await page.reload();
    await waitForParkingData(page);

    await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
      "van-andel-arena",
    );
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-garage"]'),
    ).toHaveAttribute("aria-pressed", "false");

    await page.goto(
      "/#/parking?finish=acrisure-amphitheater&location=private-garage,public-lot",
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
      await expect(page).toHaveURL(/[?&]finish=van-andel-arena(?:&|$)/);
      await expect(page.locator("#parkingDestChevron")).toBeHidden();
      await expect(page.locator("#parkingResetBtn")).toBeVisible();
    });

    test("shows inline reset on load when hash has destination", async ({
      page,
    }) => {
      await page.goto("/#/parking?finish=acrisure-amphitheater");
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "acrisure-amphitheater",
      );
      await expect(page.locator("#parkingDestChevron")).toBeHidden();
      await expect(page.locator("#parkingResetBtn")).toBeVisible();
    });
  });

  test.describe("Selected parking start (start query)", () => {
    /** Cherry Commerce Ramp in `data/parking/public/garages.json` (public garage). */
    const cherrySpot = "public-garage~42.960041~-85.669489";

    async function closeParkingMapPopups(page) {
      await page.evaluate(() => {
        const map = globalThis.__parkingMapForTest;
        if (map && typeof map.closePopup === "function") map.closePopup();
      });
    }

    async function openFirstParkingCirclePopup(page) {
      await closeParkingMapPopups(page);
      await page.evaluate(() => {
        const g = globalThis.__parkingSpotsLayerForTest;
        if (!g || !g.eachLayer) throw new Error("missing parking spots layer");
        let opened = false;
        g.eachLayer((sub) => {
          if (opened) return;
          if (
            sub.options &&
            typeof sub.getLatLng === "function" &&
            sub.options.radius === 10 &&
            typeof sub.openPopup === "function"
          ) {
            sub.openPopup();
            opened = true;
          }
        });
        if (!opened) throw new Error("no parking circleMarker found");
      });
    }

    /** Opens the parking circle for `spotId` (category + 6dp lat/lng, same as the app). */
    async function openParkingCirclePopupForSpot(page, spotId) {
      await closeParkingMapPopups(page);
      const parts = spotId.split("~");
      const categoryKey = parts[0];
      const lat = Number(parts[1]);
      const lng = Number(parts[2]);
      if (
        parts.length !== 3 ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        throw new Error(`invalid spotId for popup: ${spotId}`);
      }
      const wantLat = lat.toFixed(6);
      const wantLng = lng.toFixed(6);
      await page.evaluate(
        ({ categoryKey, wantLat, wantLng }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g || !g.eachLayer)
            throw new Error("missing parking spots layer");
          let opened = false;
          g.eachLayer((sub) => {
            if (opened) return;
            if (
              sub.options?.parkingCategoryKey !== categoryKey ||
              sub.options?.radius !== 10 ||
              typeof sub.getLatLng !== "function" ||
              typeof sub.openPopup !== "function"
            ) {
              return;
            }
            const ll = sub.getLatLng();
            if (
              ll.lat.toFixed(6) === wantLat &&
              ll.lng.toFixed(6) === wantLng
            ) {
              sub.openPopup();
              opened = true;
            }
          });
          if (!opened)
            throw new Error("no parking circleMarker at spot coords");
        },
        { categoryKey, wantLat, wantLng },
      );
    }

    test("start param hydrates and shows green pick marker", async ({
      page,
    }) => {
      await page.goto(`/#/parking?start=${encodeURIComponent(cherrySpot)}`);
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).toHaveURL(/[?&]start=/);
      const hasGreenPick = await page.evaluate(() => {
        const imgs = document.querySelectorAll(
          "#parkingAppMap .leaflet-marker-pane img",
        );
        return [...imgs].some((img) =>
          decodeURIComponent(img.src).includes("16a34a"),
        );
      });
      expect(hasGreenPick).toBe(true);
    });

    test("reset clears start from the URL", async ({ page }) => {
      await page.goto(
        `/#/parking?finish=van-andel-arena&start=${encodeURIComponent(cherrySpot)}`,
      );
      await waitForParkingData(page);
      await expect(page).toHaveURL(/[?&]start=/);
      await page.locator("#parkingResetBtn").click();
      await expect(page).toHaveURL(/#\/parking$/);
      await expect(page).not.toHaveURL(/start=/);
    });

    test("parking popup Plan to park here sets start in the URL", async ({
      page,
    }) => {
      await page.goto("/#/parking");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await openFirstParkingCirclePopup(page);
      const popup = page.locator(".leaflet-popup").last();
      const btn = popup.locator("[data-parking-start-btn]");
      await expect(btn).toBeVisible({ timeout: 5000 });
      await expect(btn).toHaveAttribute("aria-pressed", "false");
      await expect(popup.locator("[data-parking-start-btn-label]")).toHaveText(
        "Plan to park here",
      );
      await btn.click();
      await expect(page).toHaveURL(/[?&]start=/);
      const hasGreenPick = await page.evaluate(() => {
        const imgs = document.querySelectorAll(
          "#parkingAppMap .leaflet-marker-pane img",
        );
        return [...imgs].some((img) =>
          decodeURIComponent(img.src).includes("16a34a"),
        );
      });
      expect(hasGreenPick).toBe(true);

      await openFirstParkingCirclePopup(page);
      const popupAfter = page.locator(".leaflet-popup").last();
      const btnAfter = popupAfter.locator("[data-parking-start-btn]");
      await expect(btnAfter).toBeVisible({ timeout: 5000 });
      await expect(btnAfter).toHaveAttribute("aria-pressed", "true");
      await expect(
        popupAfter.locator("[data-parking-start-btn-label]"),
      ).toHaveText("Clear parking selection");
    });

    test("parking popup shows selected button when start is in the URL", async ({
      page,
    }) => {
      await page.goto(`/#/parking?start=${encodeURIComponent(cherrySpot)}`);
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).toHaveURL(/[?&]start=/);
      await page.waitForFunction(
        () => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let n = 0;
          g.eachLayer(() => {
            n += 1;
          });
          return n > 0;
        },
        { timeout: 15000 },
      );
      await openParkingCirclePopupForSpot(page, cherrySpot);
      const popup = page.locator(".leaflet-popup").last();
      const btn = popup.locator("[data-parking-start-btn]");
      await expect(btn).toBeVisible({ timeout: 10000 });
      await expect(btn).toHaveAttribute("aria-pressed", "true", {
        timeout: 10000,
      });
      await expect(popup.locator("[data-parking-start-btn-label]")).toHaveText(
        "Clear parking selection",
      );
    });

    test("legacy destination and spot params still hydrate", async ({
      page,
    }) => {
      await page.goto(
        `/#/parking?destination=van-andel-arena&spot=${encodeURIComponent(cherrySpot)}`,
      );
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "van-andel-arena",
      );
      await waitForParkingLeafletMap(page);
      const hasGreenPick = await page.evaluate(() => {
        const imgs = document.querySelectorAll(
          "#parkingAppMap .leaflet-marker-pane img",
        );
        return [...imgs].some((img) =>
          decodeURIComponent(img.src).includes("16a34a"),
        );
      });
      expect(hasGreenPick).toBe(true);
    });
  });

  test("reset clears URL and destination", async ({ page }) => {
    await page.goto("/#/parking?finish=van-andel-arena&location=public-garage");
    await waitForParkingData(page);

    await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
      "van-andel-arena",
    );
    await expect(page.locator("#parkingDestChevron")).toBeHidden();
    await expect(page.locator("#parkingResetBtn")).toBeVisible();

    await page.locator("#parkingResetBtn").click();
    await expect(page).toHaveURL(/#\/parking$/, { timeout: 15_000 });
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

  test("parking circles paint in overlap order (purple above orange)", async ({
    page,
  }) => {
    await page.goto("/#/parking");
    await waitForParkingData(page);
    await waitForParkingLeafletMap(page);

    const result = await page.evaluate(() => {
      /** Same bottom→top order as `PARKING_CATEGORY_PAINT_ORDER` in `src/parking/parking.mjs`. */
      const PAINT_ORDER_BOTTOM_TO_TOP = [
        "private-lot",
        "public-lot",
        "private-garage",
        "public-garage",
      ];
      const rank = (k) => PAINT_ORDER_BOTTOM_TO_TOP.indexOf(k);
      const g = globalThis.__parkingSpotsLayerForTest;
      if (!g) return { ok: false, error: "no parking spots layer" };

      const rows = [];
      g.eachLayer((m) => {
        const k = m.options?.parkingCategoryKey;
        if (!k || typeof m.getElement !== "function") return;
        const el = m.getElement();
        if (!el) return;
        rows.push({ k, el });
      });
      if (rows.length < 2) return { ok: false, error: "too few markers" };

      const svg = rows[0].el.ownerSVGElement;
      if (!svg) return { ok: false, error: "no svg" };
      const paintOrder = Array.from(svg.querySelectorAll("circle, path"));
      const idx = (el) => paintOrder.indexOf(el);

      const ordered = rows.filter((r) => idx(r.el) >= 0);
      if (ordered.length < 2) return { ok: false, error: "markers not in svg" };

      ordered.sort((a, b) => idx(a.el) - idx(b.el));

      for (let i = 1; i < ordered.length; i++) {
        const r0 = rank(ordered[i - 1].k);
        const r1 = rank(ordered[i].k);
        if (r0 === -1 || r1 === -1)
          return {
            ok: false,
            error: "unknown category",
            pair: [ordered[i - 1].k, ordered[i].k],
          };
        if (r1 < r0)
          return {
            ok: false,
            error: "paint order breaks PARKING_CATEGORY_PAINT_ORDER",
            pair: [ordered[i - 1].k, ordered[i].k],
          };
      }
      return { ok: true, count: ordered.length };
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});
