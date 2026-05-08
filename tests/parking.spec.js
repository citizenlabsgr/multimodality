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
    const markerIcons = page.locator(
      "#parkingAppMap .leaflet-marker-pane .leaflet-marker-icon",
    );
    await expect(markerIcons.first()).toBeVisible({ timeout: 5000 });
    expect(await markerIcons.count()).toBeGreaterThanOrEqual(2);

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

  test("loads parkingRoutePace from config.json into appData", async ({
    page,
  }) => {
    await page.goto("/#/parking");
    await waitForParkingData(page);
    const pace = await page.evaluate(() => ({
      walk: window.appData?.parkingRoutePace?.walkMinutesPerMile,
      dash: window.appData?.parkingRoutePace?.dashMilesPerHour,
    }));
    expect(pace.walk).toBe(20);
    expect(pace.dash).toBe(12);
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
      await page.goto(
        `/#/parking?pay=50&start=${encodeURIComponent(cherrySpot)}`,
      );
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
        `/#/parking?pay=50&finish=van-andel-arena&start=${encodeURIComponent(cherrySpot)}`,
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
      await page.goto("/#/parking?pay=50");
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
      await page.goto(
        `/#/parking?pay=50&start=${encodeURIComponent(cherrySpot)}`,
      );
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
        `/#/parking?pay=50&destination=van-andel-arena&spot=${encodeURIComponent(cherrySpot)}`,
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

    test("legacy venue= param still hydrates venue selector", async ({
      page,
    }) => {
      await page.goto("/#/parking?venue=van-andel-arena");
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "van-andel-arena",
      );
    });

    /** OSM private lot in `data/parking/private/lots.json`. */
    const acrisurePrivateLotSpot = "private-lot~42.980445~-85.671441";

    test("setting walk slider to zero clears start and hides green pick marker", async ({
      page,
    }) => {
      await page.goto(
        `/#/parking?finish=acrisure-amphitheater&walk=1&start=${encodeURIComponent(acrisurePrivateLotSpot)}`,
      );
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      await expect(page.locator("#parkingMaxWalkSlider")).not.toHaveValue("0");

      const hadGreenBefore = await page.evaluate(() => {
        const imgs = document.querySelectorAll(
          "#parkingAppMap .leaflet-marker-pane img",
        );
        return [...imgs].some((img) =>
          decodeURIComponent(img.src).includes("16a34a"),
        );
      });
      expect(hadGreenBefore).toBe(true);

      await page.locator("#parkingMaxWalkSlider").evaluate((el) => {
        el.value = "0";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });

      await expect(page).toHaveURL(/[?&]walk=0(?:&|$)/);
      await expect(page).not.toHaveURL(/start=/);

      const hasGreenAfter = await page.evaluate(() => {
        const imgs = document.querySelectorAll(
          "#parkingAppMap .leaflet-marker-pane img",
        );
        return [...imgs].some((img) =>
          decodeURIComponent(img.src).includes("16a34a"),
        );
      });
      expect(hasGreenAfter).toBe(false);
    });

    test("walk=0 in URL drops stale start on load", async ({ page }) => {
      await page.goto(
        `/#/parking?finish=acrisure-amphitheater&walk=0&start=${encodeURIComponent(acrisurePrivateLotSpot)}`,
      );
      await waitForParkingData(page);
      await expect(page).not.toHaveURL(/start=/);
      await expect(page).toHaveURL(/[?&]walk=0(?:&|$)/);
    });
  });

  test.describe("Auto-recommended parking start (chooseBest)", () => {
    /**
     * With venue selected and markers filtered by pay/walk/category gates, `chooseBest` prefers the
     * farthest straight-line distance to the venue (ignores DASH geometry in recommendation ranking).
     */
    test("recommended pin is among those tied for farthest physical distance to venue", async ({
      page,
    }) => {
      await page.goto("/#/parking?finish=van-andel-arena&pay=50&walk=0.4");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const { chosen, tiedIds, markerCount } = await page.evaluate(() => {
        const markers = globalThis.__getAllParkingSpotMarkersForTest();
        const choose = globalThis.__chooseBestParkingStartSpotIdForTest;
        const filt = globalThis.__filterParkingMarkersForRecommendationForTest;
        const noFree =
          globalThis.__filterParkingMarkersExcludeFreeWhenPaidExistsForTest;
        let pool = typeof filt === "function" ? filt(markers) : markers;
        pool = typeof noFree === "function" ? noFree(pool) : pool;
        const destSlug =
          document.getElementById("parkingDestinationSelect")?.value || "";
        const dest = window.appData?.destinations?.find(
          (d) => d.slug === destSlug,
        );
        const dLat = dest?.latitude ?? dest?.location?.latitude;
        const dLng = dest?.longitude ?? dest?.location?.longitude;
        if (typeof dLat !== "number" || typeof dLng !== "number") {
          return { chosen: choose(), tiedIds: [], markerCount: pool.length };
        }
        function haversineMiles(lat1, lng1, lat2, lng2) {
          const toRad = (deg) => (deg * Math.PI) / 180;
          const R = 3958.7613;
          const dLat = toRad(lat2 - lat1);
          const dLng = toRad(lng2 - lng1);
          const aVal =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
              Math.cos(toRad(lat2)) *
              Math.sin(dLng / 2) ** 2;
          return 2 * R * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
        }
        let max = -Infinity;
        const byId = new Map();
        for (const m of pool) {
          const d = haversineMiles(m.lat, m.lng, dLat, dLng);
          byId.set(m.spotId, d);
          if (d > max) max = d;
        }
        const EPS = 1e-9;
        const tied = pool
          .filter(
            (x) => Math.abs((byId.get(x.spotId) ?? -Infinity) - max) <= EPS,
          )
          .map((x) => x.spotId);
        return {
          chosen: choose(),
          tiedIds: tied,
          markerCount: pool.length,
        };
      });

      expect(markerCount).toBeGreaterThan(0);
      expect(tiedIds.length).toBeGreaterThan(0);
      expect(tiedIds).toContain(chosen);
    });

    test("generous walk cap sorts by distance before price (comparator matches chooseBest)", async ({
      page,
    }) => {
      await page.goto(
        "/#/parking?finish=acrisure-amphitheater&walk=1.5&pay=50",
      );
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const consistent = await page.evaluate(() => {
        const markers = globalThis.__getAllParkingSpotMarkersForTest();
        const filt = globalThis.__filterParkingMarkersForRecommendationForTest;
        const noFree =
          globalThis.__filterParkingMarkersExcludeFreeWhenPaidExistsForTest;
        const cmp = globalThis.__compareParkingMarkersForRecommendationForTest;
        const choose = globalThis.__chooseBestParkingStartSpotIdForTest;
        if (!markers.length || typeof cmp !== "function") return false;
        let pool = typeof filt === "function" ? filt(markers) : markers;
        pool = typeof noFree === "function" ? noFree(pool) : pool;
        if (!pool.length) return false;
        const sorted = [...pool].sort(cmp);
        return sorted[0]?.spotId === choose();
      });

      expect(consistent).toBe(true);
    });

    test("with finite pay, recommendation is still farthest from venue within eligible pool", async ({
      page,
    }) => {
      await page.goto("/#/parking?finish=van-andel-arena&pay=10&walk=1.5");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const r = await page.evaluate(() => {
        function haversineMiles(lat1, lng1, lat2, lng2) {
          const toRad = (deg) => (deg * Math.PI) / 180;
          const R = 3958.7613;
          const dLat = toRad(lat2 - lat1);
          const dLng = toRad(lng2 - lng1);
          const aVal =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) *
              Math.cos(toRad(lat2)) *
              Math.sin(dLng / 2) ** 2;
          return 2 * R * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
        }

        const markers = globalThis.__getAllParkingSpotMarkersForTest();
        let known = markers.filter(
          (m) =>
            m.eveningSortDollars !== Number.POSITIVE_INFINITY &&
            m.eveningSortDollars !== -1 &&
            Number.isFinite(m.eveningSortDollars),
        );
        known = known.filter(
          (m) =>
            !(
              typeof m.eveningSortDollars === "number" &&
              Number.isFinite(m.eveningSortDollars) &&
              m.eveningSortDollars === 0
            ),
        );
        const destSlug =
          document.getElementById("parkingDestinationSelect")?.value || "";
        const dest = window.appData?.destinations?.find(
          (d) => d.slug === destSlug,
        );
        const dLat = dest?.latitude ?? dest?.location?.latitude;
        const dLng = dest?.longitude ?? dest?.location?.longitude;
        if (
          typeof dLat !== "number" ||
          typeof dLng !== "number" ||
          known.length === 0
        ) {
          return {
            anyKnown: known.length > 0,
            chosenIsFarthest: false,
            chosenKnown: false,
          };
        }

        let maxDist = -Infinity;
        const byId = new Map();
        for (const m of known) {
          const d = haversineMiles(m.lat, m.lng, dLat, dLng);
          byId.set(m.spotId, d);
          if (d > maxDist) maxDist = d;
        }
        const id = globalThis.__chooseBestParkingStartSpotIdForTest();
        const chosenDist = byId.get(id);
        return {
          anyKnown: known.length > 0,
          chosenKnown: byId.has(id),
          chosenIsFarthest:
            typeof chosenDist === "number" &&
            Math.abs(chosenDist - maxDist) <= 1e-9,
        };
      });

      expect(r.anyKnown).toBe(true);
      expect(r.chosenKnown).toBe(true);
      expect(r.chosenIsFarthest).toBe(true);
    });

    test("if user is willing to pay, auto-recommendation never picks a free lot", async ({
      page,
    }) => {
      await page.goto("/#/parking?finish=van-andel-arena&pay=50&walk=1.5");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const r = await page.evaluate(() => {
        const markers = globalThis.__getAllParkingSpotMarkersForTest();
        const id = globalThis.__chooseBestParkingStartSpotIdForTest();
        const row = markers.find((m) => m.spotId === id);
        return {
          hasKnownFree: markers.some(
            (m) =>
              typeof m.eveningSortDollars === "number" &&
              Number.isFinite(m.eveningSortDollars) &&
              m.eveningSortDollars === 0,
          ),
          chosenKnownDollars:
            typeof row?.eveningSortDollars === "number" &&
            Number.isFinite(row.eveningSortDollars),
          chosenIsFree:
            typeof row?.eveningSortDollars === "number" &&
            Number.isFinite(row.eveningSortDollars) &&
            row.eveningSortDollars === 0,
        };
      });

      expect(r.chosenKnownDollars).toBe(true);
      if (r.hasKnownFree) expect(r.chosenIsFree).toBe(false);
    });
  });

  test.describe("Evening price cap (pay)", () => {
    /** Cherry Commerce Ramp — evening $51 in `data/parking/public/garages.json`. */
    const cherryCoords = "public-garage~42.960041~-85.669489";

    test("hydrates slider and label from pay in the URL", async ({ page }) => {
      await page.goto("/#/parking?pay=25");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxEveningSlider")).toHaveValue("25");
      await expect(page.locator("#parkingMaxEveningBudgetOut")).toHaveText(
        "$25",
      );
      await waitForParkingLeafletMap(page);
      const hasCherry = await page.evaluate(
        ({ cherryCoords }) => {
          const want = cherryCoords.split("~");
          const lat = Number(want[1]);
          const lng = Number(want[2]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((m) => {
            if (
              m.options?.parkingCategoryKey === "public-garage" &&
              typeof m.getLatLng === "function"
            ) {
              const ll = m.getLatLng();
              if (
                ll.lat.toFixed(6) === lat.toFixed(6) &&
                ll.lng.toFixed(6) === lng.toFixed(6)
              ) {
                found = true;
              }
            }
          });
          return found;
        },
        { cherryCoords },
      );
      expect(hasCherry).toBe(false);
    });

    test("shows Free only label when pay is 0", async ({ page }) => {
      await page.goto("/#/parking?pay=0");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxEveningSlider")).toHaveValue("0");
      await expect(page.locator("#parkingMaxEveningBudgetOut")).toHaveText(
        "Free only",
      );
    });

    test("unknown-price spots are hidden while pay is capped and shown at any price", async ({
      page,
    }) => {
      await page.goto("/#/parking?pay=0&finish=van-andel-arena");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const unknownCoords = { lat: 42.960141, lng: -85.669389 };
      await page.evaluate(
        ({ unknownCoords }) => {
          const lots = window.appData?.parking?.lots;
          if (!Array.isArray(lots)) return;
          const exists = lots.some((x) => {
            const lat = x?.location?.latitude;
            const lng = x?.location?.longitude;
            return (
              typeof lat === "number" &&
              typeof lng === "number" &&
              lat.toFixed(6) === unknownCoords.lat.toFixed(6) &&
              lng.toFixed(6) === unknownCoords.lng.toFixed(6)
            );
          });
          if (exists) return;
          lots.push({
            name: "Unknown Price Test Lot",
            location: {
              latitude: unknownCoords.lat,
              longitude: unknownCoords.lng,
            },
            pricing: {},
          });
        },
        { unknownCoords },
      );
      await page.evaluate(() => {
        document
          .getElementById("parkingMaxEveningSlider")
          ?.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const hiddenAtFreeOnly = await page.evaluate(
        ({ unknownCoords }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((m) => {
            if (
              m.options?.parkingCategoryKey === "public-lot" &&
              typeof m.getLatLng === "function"
            ) {
              const ll = m.getLatLng();
              if (
                ll.lat.toFixed(6) === unknownCoords.lat.toFixed(6) &&
                ll.lng.toFixed(6) === unknownCoords.lng.toFixed(6)
              ) {
                found = true;
              }
            }
          });
          return found;
        },
        { unknownCoords },
      );
      expect(hiddenAtFreeOnly).toBe(false);

      await page.evaluate(() => {
        window.location.hash = "#/parking?pay=5&finish=van-andel-arena";
      });
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      const hiddenAtLowCap = await page.evaluate(
        ({ unknownCoords }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((m) => {
            if (
              m.options?.parkingCategoryKey === "public-lot" &&
              typeof m.getLatLng === "function"
            ) {
              const ll = m.getLatLng();
              if (
                ll.lat.toFixed(6) === unknownCoords.lat.toFixed(6) &&
                ll.lng.toFixed(6) === unknownCoords.lng.toFixed(6)
              ) {
                found = true;
              }
            }
          });
          return found;
        },
        { unknownCoords },
      );
      expect(hiddenAtLowCap).toBe(false);

      await page.evaluate(() => {
        window.location.hash = "#/parking?pay=50&finish=van-andel-arena";
      });
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await page.waitForFunction(
        ({ unknownCoords }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((m) => {
            if (
              m.options?.parkingCategoryKey === "public-lot" &&
              typeof m.getLatLng === "function"
            ) {
              const ll = m.getLatLng();
              if (
                ll.lat.toFixed(6) === unknownCoords.lat.toFixed(6) &&
                ll.lng.toFixed(6) === unknownCoords.lng.toFixed(6)
              ) {
                found = true;
              }
            }
          });
          return found;
        },
        { unknownCoords },
        { timeout: 15000 },
      );
    });

    test("ArcGIS hourlyRate with weekends/weekday-evening prose counts as free under pay cap", async ({
      page,
    }) => {
      await page.goto("/#/parking?pay=15&finish=van-andel-arena");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const freeTierCoords = { lat: 42.960241, lng: -85.669289 };
      await page.evaluate(
        ({ freeTierCoords }) => {
          const lots = window.appData?.parking?.lots;
          if (!Array.isArray(lots)) return;
          const exists = lots.some((x) => {
            const lat = x?.location?.latitude;
            const lng = x?.location?.longitude;
            return (
              typeof lat === "number" &&
              typeof lng === "number" &&
              lat.toFixed(6) === freeTierCoords.lat.toFixed(6) &&
              lng.toFixed(6) === freeTierCoords.lng.toFixed(6)
            );
          });
          if (exists) return;
          lots.push({
            name: "Evening free tier test lot",
            location: {
              latitude: freeTierCoords.lat,
              longitude: freeTierCoords.lng,
            },
            pricing: {
              hourlyRate: "Weekends and Weekdays after 7pm",
            },
          });
        },
        { freeTierCoords },
      );
      await page.evaluate(() => {
        document
          .getElementById("parkingMaxEveningSlider")
          ?.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForFunction(
        ({ freeTierCoords }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((m) => {
            if (
              m.options?.parkingCategoryKey === "public-lot" &&
              typeof m.getLatLng === "function"
            ) {
              const ll = m.getLatLng();
              if (
                ll.lat.toFixed(6) === freeTierCoords.lat.toFixed(6) &&
                ll.lng.toFixed(6) === freeTierCoords.lng.toFixed(6)
              ) {
                found = true;
              }
            }
          });
          return found;
        },
        { freeTierCoords },
        { timeout: 15000 },
      );
    });

    test("unknown-price private OSM lots are hidden while pay is capped", async ({
      page,
    }) => {
      await page.goto(
        "/#/parking?pay=10&finish=van-andel-arena&location=private-lot",
      );
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const unknownCoords = { lat: 42.960141, lng: -85.669389 };
      await page.evaluate(
        ({ unknownCoords }) => {
          const lots = window.appData?.parking?.osmLots;
          if (!Array.isArray(lots)) return;
          const exists = lots.some((x) => {
            const lat = x?.location?.latitude;
            const lng = x?.location?.longitude;
            return (
              typeof lat === "number" &&
              typeof lng === "number" &&
              lat.toFixed(6) === unknownCoords.lat.toFixed(6) &&
              lng.toFixed(6) === unknownCoords.lng.toFixed(6)
            );
          });
          if (exists) return;
          lots.push({
            name: "Unknown Private Lot Test",
            location: {
              latitude: unknownCoords.lat,
              longitude: unknownCoords.lng,
            },
            pricing: {},
          });
        },
        { unknownCoords },
      );
      await page.evaluate(() => {
        document
          .getElementById("parkingMaxEveningSlider")
          ?.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const hiddenWhileCapped = await page.evaluate(
        ({ unknownCoords }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((m) => {
            if (
              m.options?.parkingCategoryKey === "private-lot" &&
              typeof m.getLatLng === "function"
            ) {
              const ll = m.getLatLng();
              if (
                ll.lat.toFixed(6) === unknownCoords.lat.toFixed(6) &&
                ll.lng.toFixed(6) === unknownCoords.lng.toFixed(6)
              ) {
                found = true;
              }
            }
          });
          return found;
        },
        { unknownCoords },
      );
      expect(hiddenWhileCapped).toBe(false);

      await page.evaluate(() => {
        window.location.hash =
          "#/parking?pay=50&finish=van-andel-arena&location=private-lot";
      });
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await page.waitForFunction(
        ({ unknownCoords }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((m) => {
            if (
              m.options?.parkingCategoryKey === "private-lot" &&
              typeof m.getLatLng === "function"
            ) {
              const ll = m.getLatLng();
              if (
                ll.lat.toFixed(6) === unknownCoords.lat.toFixed(6) &&
                ll.lng.toFixed(6) === unknownCoords.lng.toFixed(6)
              ) {
                found = true;
              }
            }
          });
          return found;
        },
        { unknownCoords },
        { timeout: 15000 },
      );
    });

    test("slider at max keeps pay omitted (default any price)", async ({
      page,
    }) => {
      await page.goto("/#/parking?pay=25");
      await waitForParkingData(page);
      await page.evaluate(() => {
        const el = document.getElementById("parkingMaxEveningSlider");
        el.value = "50";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page).toHaveURL(/#\/parking(?:\?|$)/);
      await expect(page).not.toHaveURL(/[?&]pay=/);
    });
  });

  test.describe("Walk distance (walk)", () => {
    test("hydrates walk and shows mi + minute hint", async ({ page }) => {
      await page.goto("/#/parking?walk=0.5");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("5");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "0.5 mi (~10 min)",
      );
    });

    test("hydrates maximum walk distance 1.5 mi", async ({ page }) => {
      await page.goto("/#/parking?walk=1.5");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("15");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "1.5 mi (~30 min)",
      );
    });

    test("walk=0.1 shows feet and minute hint", async ({ page }) => {
      await page.goto("/#/parking?walk=0.1");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("1");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "500 ft (~2 min)",
      );
    });

    test("walk=0.3 shows feet and minute hint", async ({ page }) => {
      await page.goto("/#/parking?walk=0.3");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("3");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "2,000 ft (~6 min)",
      );
    });

    test("walk=0.4 shows feet and minute hint", async ({ page }) => {
      await page.goto("/#/parking?walk=0.4");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("4");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "2,000 ft (~8 min)",
      );
    });

    test("walk=0 hydrates slider minimum — no distance", async ({ page }) => {
      await page.goto("/#/parking?walk=0");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("0");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "No distance",
      );
    });
  });

  test.describe("Walk overlay vs DASH", () => {
    test("straight parking→venue walk fits max walk → direct overlay only", async ({
      page,
    }) => {
      await page.goto(
        "/#/parking?finish=acrisure-amphitheater&start=public-lot~42.961773~-85.670616&walk=1",
      );
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "acrisure-amphitheater",
      );
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("10");
      await page.waitForFunction(
        () =>
          typeof globalThis.__parkingWalkUsesDashOverlay === "boolean" &&
          globalThis.__parkingWalkUsesDashOverlay === false,
        { timeout: 15000 },
      );
    });

    test("walk=0 omits walk and DASH trip overlays (free-only lot + finish)", async ({
      page,
    }) => {
      await page.goto("/#/parking?finish=acrisure-amphitheater&pay=0&walk=0");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "acrisure-amphitheater",
      );
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("0");
      await page.waitForFunction(
        () =>
          typeof globalThis.__parkingWalkUsesDashOverlay === "boolean" &&
          globalThis.__parkingWalkUsesDashOverlay === false,
        { timeout: 15000 },
      );
      await expect(
        page.locator(
          "#parkingAppMap .leaflet-overlay-pane path.parking-estimated-walk-line-path",
        ),
      ).toHaveCount(0);
      await expect(
        page.locator(
          "#parkingAppMap .leaflet-overlay-pane path.parking-dash-trip-segment-path",
        ),
      ).toHaveCount(0);
    });
  });

  test("fits map bounds to start and finish when both are set", async ({
    page,
  }) => {
    const cherrySpot = "public-garage~42.960041~-85.669489";
    await page.goto(
      `/#/parking?pay=50&finish=van-andel-arena&start=${encodeURIComponent(cherrySpot)}`,
    );
    await waitForParkingData(page);
    await waitForParkingLeafletMap(page);
    await page.waitForFunction(
      () => typeof globalThis.__parkingMapForTest?.getBounds === "function",
      { timeout: 15000 },
    );

    const bothInside = await page.evaluate(() => {
      const map = globalThis.__parkingMapForTest;
      const L = globalThis.L;
      const dest = window.appData?.destinations?.find(
        (d) => d.slug === "van-andel-arena",
      );
      if (!map?.getBounds || !L || !dest) return false;
      const lat = dest.latitude ?? dest.location?.latitude;
      const lng = dest.longitude ?? dest.location?.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") return false;
      const b = map.getBounds();
      const startLat = 42.960041;
      const startLng = -85.669489;
      return (
        b.contains(L.latLng(lat, lng)) &&
        b.contains(L.latLng(startLat, startLng))
      );
    });

    expect(bothInside).toBe(true);
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
    await expect(page.locator("#parkingMaxEveningSlider")).toHaveValue("50");
    await expect(page.locator("#parkingMaxEveningBudgetOut")).toHaveText(
      "Any price",
    );
    await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("5");
    await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
      "0.5 mi (~10 min)",
    );
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

  test.describe("Auto recommendation without start= in URL", () => {
    test("evening slider does not add start when finish is selected", async ({
      page,
    }) => {
      await page.goto("/#/parking?finish=van-andel-arena");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).not.toHaveURL(/[?&]start=/);
      await page.evaluate(() => {
        const el = document.getElementById("parkingMaxEveningSlider");
        el.value = "35";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page).not.toHaveURL(/[?&]start=/);
    });

    test("walk slider does not add start when finish is selected", async ({
      page,
    }) => {
      await page.goto("/#/parking?finish=van-andel-arena");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).not.toHaveURL(/[?&]start=/);
      await page.evaluate(() => {
        const el = document.getElementById("parkingMaxWalkSlider");
        el.value = "9";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page).not.toHaveURL(/[?&]start=/);
    });

    test("destination select does not add start when choosing finish", async ({
      page,
    }) => {
      await page.goto("/#/parking");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).not.toHaveURL(/[?&]start=/);
      await page.selectOption("#parkingDestinationSelect", "van-andel-arena");
      await expect(page).toHaveURL(/[?&]finish=van-andel-arena(?:&|$)/);
      await expect(page).not.toHaveURL(/[?&]start=/);
    });

    test("does not auto-pick a start pin until a destination is chosen", async ({
      page,
    }) => {
      await page.goto("/#/parking");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue("");
      const before = await page.evaluate(() =>
        globalThis.__getParkingEffectiveStartSpotIdForTest?.(),
      );
      expect(before).toBeUndefined();

      await page.selectOption("#parkingDestinationSelect", "van-andel-arena");
      await expect(page).toHaveURL(/[?&]finish=van-andel-arena(?:&|$)/);
      await expect(page).not.toHaveURL(/[?&]start=/);

      await expect
        .poll(
          async () =>
            page.evaluate(() =>
              globalThis.__getParkingEffectiveStartSpotIdForTest?.(),
            ),
          { timeout: 10000 },
        )
        .toMatch(/^(public-garage|public-lot|private-garage|private-lot)~/);
    });

    test("category filter omits start=; effective pick matches enabled categories", async ({
      page,
    }) => {
      await page.goto("/#/parking?finish=van-andel-arena");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await page
        .locator('#parkingFilterBar [data-parking-category="private-lot"]')
        .click();
      await expect(page).toHaveURL(/[?&]location=/);
      await expect(page).not.toHaveURL(/[?&]start=/);

      const { pickCategory, locationCats } = await page.evaluate(() => {
        const eff = globalThis.__getParkingEffectiveStartSpotIdForTest?.();
        const h = window.location.hash;
        const qIdx = h.indexOf("?");
        const q =
          qIdx >= 0
            ? new URLSearchParams(h.slice(qIdx + 1))
            : new URLSearchParams();
        const loc = q.get("location") || "";
        const locationCats = loc
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const cat = typeof eff === "string" ? eff.split("~")[0] : "";
        return { pickCategory: cat, locationCats };
      });
      expect(pickCategory).toMatch(
        /^(public-garage|public-lot|private-garage|private-lot)$/,
      );
      expect(locationCats).not.toContain("private-lot");
      expect(locationCats).toContain(pickCategory);
    });
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

/** Fixed layout captures for `#/parking` via Playwright snapshot compare (`snapshotPathTemplate` in playwright.config.js). */
async function assertParkingViewportScreenshot(page, name, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(
    "/#/parking?finish=acrisure-amphitheater&start=private-lot~42.972319~-85.682491",
  );
  await page.waitForFunction(() => typeof globalThis.L !== "undefined");
  await page.waitForFunction(
    () =>
      Array.isArray(window.appData?.parking?.garages) &&
      window.appData.parking.garages.length > 0,
  );
  await page.waitForFunction(
    () => typeof globalThis.__parkingMapForTest?.getZoom === "function",
    { timeout: 15_000 },
  );
  await expect(page.locator("#parkingView")).toBeVisible();
  await expect(page.locator("#parkingMapChrome")).toBeVisible();
  await page.evaluate(() => globalThis.__parkingMapForTest?.invalidateSize?.());
  await new Promise((r) => setTimeout(r, 400));

  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: "disabled",
  });
}

test.describe(
  "@snapshot Parking layout viewports",
  { tag: "@snapshot" },
  () => {
    test.describe.configure({ timeout: 30_000 });

    test("phone", { tag: "@snapshot" }, async ({ page }) => {
      await assertParkingViewportScreenshot(page, "phone", 390, 844);
    });

    test("tablet", { tag: "@snapshot" }, async ({ page }) => {
      await assertParkingViewportScreenshot(page, "tablet", 834, 1112);
    });

    test("desktop", { tag: "@snapshot" }, async ({ page }) => {
      await assertParkingViewportScreenshot(page, "desktop", 1440, 900);
    });
  },
);
