import { test, expect } from "@playwright/test";
import { installConsoleErrorAssertions } from "./helpers/console-errors.js";

installConsoleErrorAssertions(test);

test.describe("Parking map (#/visit)", () => {
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
    await page.goto("/#/visit");
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
    await expect(page).toHaveURL(/#\/visit\/van-andel-arena/);
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
    await expect(page).toHaveURL(/#\/visit\/van-andel-arena\?location=/);
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
    await page.goto("/#/visit");
    await waitForParkingData(page);
    const pace = await page.evaluate(() => ({
      walk: window.appData?.parkingRoutePace?.walkMinutesPerMile,
      dash: window.appData?.parkingRoutePace?.dashMilesPerHour,
      dashWait: window.appData?.parkingRoutePace?.dashBoardingWaitMinutes,
    }));
    expect(pace.walk).toBe(24);
    expect(pace.dash).toBe(12);
    expect(pace.dashWait).toBe(5);
  });

  test("preserves destination and category filters in the URL across reload", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await waitForParkingData(page);

    await page.selectOption("#parkingDestinationSelect", "van-andel-arena");
    await expect(page).toHaveURL(/#\/visit\/van-andel-arena/);

    await page
      .locator('#parkingFilterBar [data-parking-category="public-garage"]')
      .click();
    await expect(page).toHaveURL(/[?&]location=/);
    await expect(page).toHaveURL(/#\/visit\/van-andel-arena/);

    await page.reload();
    await waitForParkingData(page);

    await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
      "van-andel-arena",
    );
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-garage"]'),
    ).toHaveAttribute("aria-pressed", "false");

    await page.goto(
      "/#/visit/acrisure-amphitheater?location=private-garage,public-lot&walk=0.5",
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
    await page.goto("/#/visit?location=garages,osmLots");
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
      await page.goto("/#/visit");
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue("");
      await expect(page.locator("#parkingDestChevron")).toBeVisible();
      await expect(page.locator("#parkingResetBtn")).toBeHidden();
    });

    test("shows inline reset and hides chevron after choosing a destination", async ({
      page,
    }) => {
      await page.goto("/#/visit");
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestChevron")).toBeVisible();
      await expect(page.locator("#parkingResetBtn")).toBeHidden();

      await page.selectOption("#parkingDestinationSelect", "van-andel-arena");
      await expect(page).toHaveURL(/#\/visit\/van-andel-arena/);
      await expect(page.locator("#parkingDestChevron")).toBeHidden();
      await expect(page.locator("#parkingResetBtn")).toBeVisible();
    });

    test("shows inline reset on load when hash has destination", async ({
      page,
    }) => {
      await page.goto("/#/visit/acrisure-amphitheater?walk=0.5");
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "acrisure-amphitheater",
      );
      await expect(page.locator("#parkingDestChevron")).toBeHidden();
      await expect(page.locator("#parkingResetBtn")).toBeVisible();
    });

    test("map popup Set as destination selects finish", async ({ page }) => {
      await page.goto("/#/visit");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue("");

      const opened = await page.evaluate((slug) => {
        const map = globalThis.__parkingMapForTest;
        const L = globalThis.L;
        const dest = window.appData?.destinations?.find((d) => d.slug === slug);
        if (!map || !L || !dest) return false;
        const lat = dest.latitude ?? dest.location?.latitude;
        const lng = dest.longitude ?? dest.location?.longitude;
        let marker = null;
        function visit(layer) {
          if (marker || !layer) return;
          if (
            layer instanceof L.Marker &&
            typeof layer.getLatLng === "function"
          ) {
            const ll = layer.getLatLng();
            if (
              Math.abs(ll.lat - lat) < 1e-5 &&
              Math.abs(ll.lng - lng) < 1e-5
            ) {
              marker = layer;
              return;
            }
          }
          if (typeof layer.eachLayer === "function") {
            layer.eachLayer(visit);
          }
        }
        map.eachLayer(visit);
        if (marker && typeof marker.openPopup === "function") {
          marker.openPopup();
          return true;
        }
        return false;
      }, "van-andel-arena");

      expect(opened).toBe(true);

      const popup = page.locator(".leaflet-popup").last();
      await expect(
        popup.locator("[data-parking-destination-select-btn]"),
      ).toBeVisible();
      await popup.locator("[data-parking-destination-select-btn]").click();

      await expect(page).toHaveURL(/#\/visit\/van-andel-arena/);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "van-andel-arena",
      );
      await expect(page.locator("#parkingResetBtn")).toBeVisible();
    });

    test("map popup Clear selected destination removes finish", async ({
      page,
    }) => {
      await page.goto("/#/visit/van-andel-arena?walk=0.5");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "van-andel-arena",
      );

      const opened = await page.evaluate((slug) => {
        const map = globalThis.__parkingMapForTest;
        const L = globalThis.L;
        const dest = window.appData?.destinations?.find((d) => d.slug === slug);
        if (!map || !L || !dest) return false;
        const lat = dest.latitude ?? dest.location?.latitude;
        const lng = dest.longitude ?? dest.location?.longitude;
        let marker = null;
        function visit(layer) {
          if (marker || !layer) return;
          if (
            layer instanceof L.Marker &&
            typeof layer.getLatLng === "function"
          ) {
            const ll = layer.getLatLng();
            if (
              Math.abs(ll.lat - lat) < 1e-5 &&
              Math.abs(ll.lng - lng) < 1e-5
            ) {
              marker = layer;
              return;
            }
          }
          if (typeof layer.eachLayer === "function") {
            layer.eachLayer(visit);
          }
        }
        map.eachLayer(visit);
        if (marker && typeof marker.openPopup === "function") {
          marker.openPopup();
          return true;
        }
        return false;
      }, "van-andel-arena");

      expect(opened).toBe(true);

      const popup = page.locator(".leaflet-popup").last();
      await expect(
        popup.locator("[data-parking-destination-clear-btn]"),
      ).toBeVisible();
      await popup.locator("[data-parking-destination-clear-btn]").click();

      await expect(page).not.toHaveURL(/\/visit\/van-andel-arena/);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue("");
      await expect(page.locator("#parkingDestChevron")).toBeVisible();
      await expect(page.locator("#parkingResetBtn")).toBeHidden();
    });
  });

  test.describe("Selected parking spot (park query)", () => {
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
        g.eachLayer((group) => {
          if (opened || !group?.eachLayer) return;
          group.eachLayer((sub) => {
            if (opened) return;
            if (
              sub.options?.parkingSpotPopupLayer &&
              typeof sub.getLatLng === "function" &&
              typeof sub.openPopup === "function"
            ) {
              sub.openPopup();
              opened = true;
            }
          });
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
          g.eachLayer((group) => {
            if (opened || !group?.eachLayer) return;
            group.eachLayer((sub) => {
              if (opened) return;
              if (
                sub.options?.parkingCategoryKey !== categoryKey ||
                !sub.options?.parkingSpotPopupLayer ||
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
          });
          if (!opened)
            throw new Error("no parking circleMarker at spot coords");
        },
        { categoryKey, wantLat, wantLng },
      );
    }

    test("park param hydrates and shows green pick marker", async ({
      page,
    }) => {
      await page.goto(`/#/visit?pay=50&park=${encodeURIComponent(cherrySpot)}`);
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).toHaveURL(/[?&]park=/);
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

    test("reset clears park from the URL", async ({ page }) => {
      await page.goto(
        `/#/visit/van-andel-arena?pay=50&walk=0.5&park=${encodeURIComponent(cherrySpot)}`,
      );
      await waitForParkingData(page);
      await expect(page).toHaveURL(/[?&]park=/);
      await page.locator("#parkingResetBtn").click();
      await expect(page).toHaveURL(/#\/visit$/);
      await expect(page).not.toHaveURL(/park=/);
    });

    test("parking popup Plan to park here sets park in the URL", async ({
      page,
    }) => {
      await page.goto("/#/visit?pay=50");
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
      await expect(page).toHaveURL(/[?&]park=/);
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

    test("parking popup shows selected button when park is in the URL", async ({
      page,
    }) => {
      await page.goto(`/#/visit?pay=50&park=${encodeURIComponent(cherrySpot)}`);
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).toHaveURL(/[?&]park=/);
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
        `/#/visit/van-andel-arena?pay=50&spot=${encodeURIComponent(cherrySpot)}`,
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
      await page.goto("/#/visit?venue=van-andel-arena");
      await waitForParkingData(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
        "van-andel-arena",
      );
    });

    /** OSM private lot in `data/parking/private/lots.json`. */
    const acrisurePrivateLotSpot = "private-lot~42.980445~-85.671441";

    test("setting walk slider to zero clears park and hides green pick marker", async ({
      page,
    }) => {
      await page.goto(
        `/#/visit/acrisure-amphitheater?walk=1&park=${encodeURIComponent(acrisurePrivateLotSpot)}`,
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
      await expect(page).not.toHaveURL(/park=/);

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

    test("walk=0 in URL drops stale park on load", async ({ page }) => {
      await page.goto(
        `/#/visit/acrisure-amphitheater?walk=0&park=${encodeURIComponent(acrisurePrivateLotSpot)}`,
      );
      await waitForParkingData(page);
      await expect(page).not.toHaveURL(/park=/);
      await expect(page).toHaveURL(/[?&]walk=0(?:&|$)/);
    });
  });

  test.describe("Auto-recommended parking start (chooseBest)", () => {
    /**
     * Short max walk (≤ 0.5 mi) splits multimodal-DASH vs door-to-door; `chooseBest` must stay consistent
     * with the comparator sort (same contract as generous-walk test).
     */
    test("short walk cap: chooseBest matches comparator sort order", async ({
      page,
    }) => {
      await page.goto("/#/visit/van-andel-arena?pay=50&walk=0.4");
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

    test("auto pick without park= shows muted green pin (no step number)", async ({
      page,
    }) => {
      await page.goto("/#/visit/van-andel-arena?pay=50&walk=0.4");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).not.toHaveURL(/[?&]park=/);
      const glyphs = await page.evaluate(() => {
        const decodeSrc = (src) => {
          const i = src.indexOf(",");
          if (i < 0) return "";
          try {
            return decodeURIComponent(src.slice(i + 1));
          } catch {
            return "";
          }
        };
        let numberedGreen = false;
        let mutedGreen = false;
        for (const img of document.querySelectorAll(
          "#parkingAppMap .leaflet-marker-pane img",
        )) {
          if (!img.src.startsWith("data:image/svg")) continue;
          const svg = decodeSrc(img.src);
          if (/fill="#16a34a">\d<\/text>/.test(svg)) numberedGreen = true;
          if (svg.includes("bbf7d0")) mutedGreen = true;
        }
        return { numberedGreen, mutedGreen };
      });
      expect(glyphs.numberedGreen).toBe(false);
      expect(glyphs.mutedGreen).toBe(true);
    });

    test("generous walk cap sorts by distance before price (comparator matches chooseBest)", async ({
      page,
    }) => {
      await page.goto("/#/visit/acrisure-amphitheater?walk=1.5&pay=50");
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

    test("with finite pay and short max walk, chooseBest matches comparator sort order", async ({
      page,
    }) => {
      await page.goto("/#/visit/van-andel-arena?pay=10&walk=0.5");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const r = await page.evaluate(() => {
        const markers = globalThis.__getAllParkingSpotMarkersForTest();
        const filt = globalThis.__filterParkingMarkersForRecommendationForTest;
        const noFree =
          globalThis.__filterParkingMarkersExcludeFreeWhenPaidExistsForTest;
        const cmp = globalThis.__compareParkingMarkersForRecommendationForTest;
        let pool = typeof filt === "function" ? filt(markers) : markers;
        pool = typeof noFree === "function" ? noFree(pool) : pool;
        if (!pool.length || typeof cmp !== "function") {
          return { anyKnown: false, matchesSort: false };
        }
        const sorted = [...pool].sort(cmp);
        const id = globalThis.__chooseBestParkingStartSpotIdForTest();
        return {
          anyKnown: true,
          matchesSort: sorted[0]?.spotId === id,
        };
      });

      expect(r.anyKnown).toBe(true);
      expect(r.matchesSort).toBe(true);
    });

    test("Acrisure default walk (0.5 mi) recommends farthest multimodal-DASH paid pin when eligible", async ({
      page,
    }) => {
      await page.goto("/#/visit/acrisure-amphitheater?pay=50");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const r = await page.evaluate(() => {
        function gridWalkMiles(lat1, lng1, lat2, lng2) {
          const toRad = (deg) => (deg * Math.PI) / 180;
          const midLat = (lat1 + lat2) / 2;
          const latMiPerDeg = 69.172;
          const lonMiPerDeg = latMiPerDeg * Math.cos(toRad(midLat));
          const dLatMi = Math.abs(lat2 - lat1) * latMiPerDeg;
          const dLonMi = Math.abs(lng2 - lng1) * lonMiPerDeg;
          return dLatMi + dLonMi;
        }
        const markers = globalThis.__getAllParkingSpotMarkersForTest();
        const filt = globalThis.__filterParkingMarkersForRecommendationForTest;
        const noFree =
          globalThis.__filterParkingMarkersExcludeFreeWhenPaidExistsForTest;
        const dashFn =
          globalThis.__markerUsesDashMultimodalForRecommendationForTest;
        let pool = typeof filt === "function" ? filt(markers) : markers;
        pool = typeof noFree === "function" ? noFree(pool) : pool;
        const dest = window.appData?.destinations?.find(
          (d) => d.slug === "acrisure-amphitheater",
        );
        const dLat = dest?.latitude ?? dest?.location?.latitude;
        const dLng = dest?.longitude ?? dest?.location?.longitude;
        if (
          !pool.length ||
          typeof globalThis.__chooseBestParkingStartSpotIdForTest !==
            "function" ||
          typeof dLat !== "number" ||
          typeof dLng !== "number" ||
          typeof dashFn !== "function"
        ) {
          return { ok: false, reason: "setup" };
        }
        const dashPool = pool.filter((m) => dashFn(m));
        if (dashPool.length === 0) return { ok: false, reason: "no-dash-pool" };
        let maxVenueMi = -Infinity;
        for (const m of dashPool) {
          const d = gridWalkMiles(m.lat, m.lng, dLat, dLng);
          if (Number.isFinite(d) && d > maxVenueMi) maxVenueMi = d;
        }
        const chosenId = globalThis.__chooseBestParkingStartSpotIdForTest();
        const chosenRow = pool.find((m) => m.spotId === chosenId);
        const chosenVenueMi =
          chosenRow &&
          Number.isFinite(chosenRow.lat) &&
          Number.isFinite(chosenRow.lng)
            ? gridWalkMiles(chosenRow.lat, chosenRow.lng, dLat, dLng)
            : NaN;
        const chosenUsesDash = chosenRow ? dashFn(chosenRow) : false;
        return {
          ok:
            chosenUsesDash &&
            Number.isFinite(chosenVenueMi) &&
            Number.isFinite(maxVenueMi) &&
            Math.abs(chosenVenueMi - maxVenueMi) <= 1e-6,
          chosenVenueMi,
          maxVenueMi,
        };
      });

      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.maxVenueMi).toBeGreaterThan(0);
    });

    test("Acrisure walk=1.5 without pay param recommends farthest paid pin from venue", async ({
      page,
    }) => {
      await page.goto("/#/visit/acrisure-amphitheater?walk=1.5");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const r = await page.evaluate(() => {
        function gridWalkMiles(lat1, lng1, lat2, lng2) {
          const toRad = (deg) => (deg * Math.PI) / 180;
          const midLat = (lat1 + lat2) / 2;
          const latMiPerDeg = 69.172;
          const lonMiPerDeg = latMiPerDeg * Math.cos(toRad(midLat));
          const dLatMi = Math.abs(lat2 - lat1) * latMiPerDeg;
          const dLonMi = Math.abs(lng2 - lng1) * lonMiPerDeg;
          return dLatMi + dLonMi;
        }
        const markers = globalThis.__getAllParkingSpotMarkersForTest();
        const filt = globalThis.__filterParkingMarkersForRecommendationForTest;
        const noFree =
          globalThis.__filterParkingMarkersExcludeFreeWhenPaidExistsForTest;
        let pool = typeof filt === "function" ? filt(markers) : markers;
        pool = typeof noFree === "function" ? noFree(pool) : pool;
        const dest = window.appData?.destinations?.find(
          (d) => d.slug === "acrisure-amphitheater",
        );
        const dLat = dest?.latitude ?? dest?.location?.latitude;
        const dLng = dest?.longitude ?? dest?.location?.longitude;
        if (
          !pool.length ||
          typeof globalThis.__chooseBestParkingStartSpotIdForTest !==
            "function" ||
          typeof dLat !== "number" ||
          typeof dLng !== "number"
        ) {
          return {
            ok: false,
            chosenVenueMi: null,
            maxVenueMi: null,
          };
        }
        let maxVenueMi = -Infinity;
        for (const m of pool) {
          const d = gridWalkMiles(m.lat, m.lng, dLat, dLng);
          if (Number.isFinite(d) && d > maxVenueMi) maxVenueMi = d;
        }
        const chosenId = globalThis.__chooseBestParkingStartSpotIdForTest();
        const chosenRow = pool.find((m) => m.spotId === chosenId);
        const chosenVenueMi =
          chosenRow &&
          Number.isFinite(chosenRow.lat) &&
          Number.isFinite(chosenRow.lng)
            ? gridWalkMiles(chosenRow.lat, chosenRow.lng, dLat, dLng)
            : NaN;
        return {
          ok:
            Number.isFinite(chosenVenueMi) &&
            Number.isFinite(maxVenueMi) &&
            Math.abs(chosenVenueMi - maxVenueMi) <= 1e-6,
          chosenVenueMi,
          maxVenueMi,
        };
      });

      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(r.maxVenueMi).toBeGreaterThan(0);
    });

    test("generous max walk picks farthest-from-venue paid pin among eligible (Acrisure)", async ({
      page,
    }) => {
      for (const walk of ["1", "1.5"]) {
        await page.goto(`/#/visit/acrisure-amphitheater?walk=${walk}`);
        await waitForParkingData(page);
        await waitForParkingLeafletMap(page);

        const r = await page.evaluate(() => {
          function gridWalkMiles(lat1, lng1, lat2, lng2) {
            const toRad = (deg) => (deg * Math.PI) / 180;
            const midLat = (lat1 + lat2) / 2;
            const latMiPerDeg = 69.172;
            const lonMiPerDeg = latMiPerDeg * Math.cos(toRad(midLat));
            const dLatMi = Math.abs(lat2 - lat1) * latMiPerDeg;
            const dLonMi = Math.abs(lng2 - lng1) * lonMiPerDeg;
            return dLatMi + dLonMi;
          }
          const markers = globalThis.__getAllParkingSpotMarkersForTest();
          const filt =
            globalThis.__filterParkingMarkersForRecommendationForTest;
          const noFree =
            globalThis.__filterParkingMarkersExcludeFreeWhenPaidExistsForTest;
          let pool = typeof filt === "function" ? filt(markers) : markers;
          pool = typeof noFree === "function" ? noFree(pool) : pool;
          const dest = window.appData?.destinations?.find(
            (d) => d.slug === "acrisure-amphitheater",
          );
          const dLat = dest?.latitude ?? dest?.location?.latitude;
          const dLng = dest?.longitude ?? dest?.location?.longitude;
          if (
            !pool.length ||
            typeof globalThis.__chooseBestParkingStartSpotIdForTest !==
              "function" ||
            typeof dLat !== "number" ||
            typeof dLng !== "number"
          ) {
            return {
              ok: false,
              reason: "empty or invalid destination",
              chosenVenueMi: null,
              maxVenueMi: null,
            };
          }
          let maxVenueMi = -Infinity;
          for (const m of pool) {
            const d = gridWalkMiles(m.lat, m.lng, dLat, dLng);
            if (Number.isFinite(d) && d > maxVenueMi) maxVenueMi = d;
          }
          const chosenId = globalThis.__chooseBestParkingStartSpotIdForTest();
          const chosenRow = pool.find((m) => m.spotId === chosenId);
          const chosenVenueMi =
            chosenRow &&
            Number.isFinite(chosenRow.lat) &&
            Number.isFinite(chosenRow.lng)
              ? gridWalkMiles(chosenRow.lat, chosenRow.lng, dLat, dLng)
              : NaN;
          return {
            ok:
              Number.isFinite(chosenVenueMi) &&
              Number.isFinite(maxVenueMi) &&
              Math.abs(chosenVenueMi - maxVenueMi) <= 1e-6,
            chosenVenueMi,
            maxVenueMi,
          };
        });

        expect(r.ok, `walk=${walk} ${JSON.stringify(r)}`).toBe(true);
        expect(r.maxVenueMi).toBeGreaterThan(0);
      }
    });

    test("if user is willing to pay, auto-recommendation never picks a free lot", async ({
      page,
    }) => {
      await page.goto("/#/visit/van-andel-arena?pay=50&walk=1.5");
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
      await page.goto("/#/visit?pay=25");
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
          g.eachLayer((group) => {
            if (!group?.eachLayer) return;
            group.eachLayer((m) => {
              if (
                m.options?.parkingCategoryKey === "public-garage" &&
                m.options?.parkingSpotPopupLayer &&
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
          });
          return found;
        },
        { cherryCoords },
      );
      expect(hasCherry).toBe(false);
    });

    test("shows Free only label when pay is 0", async ({ page }) => {
      await page.goto("/#/visit?pay=0");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxEveningSlider")).toHaveValue("0");
      await expect(page.locator("#parkingMaxEveningBudgetOut")).toHaveText(
        "Free only",
      );
    });

    test("unknown-price spots are hidden while pay is capped and shown at any price", async ({
      page,
    }) => {
      await page.goto("/#/visit/van-andel-arena?pay=0&walk=0.5");
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
          g.eachLayer((group) => {
            if (!group?.eachLayer) return;
            group.eachLayer((m) => {
              if (
                m.options?.parkingCategoryKey === "public-lot" &&
                m.options?.parkingSpotPopupLayer &&
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
          });
          return found;
        },
        { unknownCoords },
      );
      expect(hiddenAtFreeOnly).toBe(false);

      await page.evaluate(() => {
        window.location.hash = "#/visit/van-andel-arena?pay=5&walk=0.5";
      });
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      const hiddenAtLowCap = await page.evaluate(
        ({ unknownCoords }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((group) => {
            if (!group?.eachLayer) return;
            group.eachLayer((m) => {
              if (
                m.options?.parkingCategoryKey === "public-lot" &&
                m.options?.parkingSpotPopupLayer &&
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
          });
          return found;
        },
        { unknownCoords },
      );
      expect(hiddenAtLowCap).toBe(false);

      await page.evaluate(() => {
        window.location.hash = "#/visit/van-andel-arena?pay=50&walk=0.5";
      });
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await page.waitForFunction(
        ({ unknownCoords }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((group) => {
            if (!group?.eachLayer) return;
            group.eachLayer((m) => {
              if (
                m.options?.parkingCategoryKey === "public-lot" &&
                m.options?.parkingSpotPopupLayer &&
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
      await page.goto("/#/visit/van-andel-arena?pay=15&walk=0.5");
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
          g.eachLayer((group) => {
            if (!group?.eachLayer) return;
            group.eachLayer((m) => {
              if (
                m.options?.parkingCategoryKey === "public-lot" &&
                m.options?.parkingSpotPopupLayer &&
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
        "/#/visit/van-andel-arena?pay=10&location=private-lot&walk=0.5",
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
          g.eachLayer((group) => {
            if (!group?.eachLayer) return;
            group.eachLayer((m) => {
              if (
                m.options?.parkingCategoryKey === "private-lot" &&
                m.options?.parkingSpotPopupLayer &&
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
          });
          return found;
        },
        { unknownCoords },
      );
      expect(hiddenWhileCapped).toBe(false);

      await page.evaluate(() => {
        window.location.hash =
          "#/visit/van-andel-arena?pay=50&location=private-lot&walk=0.5";
      });
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await page.waitForFunction(
        ({ unknownCoords }) => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return false;
          let found = false;
          g.eachLayer((group) => {
            if (!group?.eachLayer) return;
            group.eachLayer((m) => {
              if (
                m.options?.parkingCategoryKey === "private-lot" &&
                m.options?.parkingSpotPopupLayer &&
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
      await page.goto("/#/visit?pay=25");
      await waitForParkingData(page);
      await page.evaluate(() => {
        const el = document.getElementById("parkingMaxEveningSlider");
        el.value = "50";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page).toHaveURL(/#\/visit(?:\?|$)/);
      await expect(page).not.toHaveURL(/[?&]pay=/);
    });
  });

  test.describe("Walk distance (walk)", () => {
    test("hydrates walk and shows mi + minute hint", async ({ page }) => {
      await page.goto("/#/visit");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("5");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "0.5 mi (~12 min)",
      );
    });

    test("hydrates maximum walk distance 1.5 mi", async ({ page }) => {
      await page.goto("/#/visit?walk=1.5");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("15");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "1.5 mi (~36 min)",
      );
    });

    test("walk=0.1 shows feet and minute hint", async ({ page }) => {
      await page.goto("/#/visit?walk=0.1");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("1");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "500 ft (~2 min)",
      );
    });

    test("walk=0.3 shows feet and minute hint", async ({ page }) => {
      await page.goto("/#/visit?walk=0.3");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("3");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "2,000 ft (~7 min)",
      );
    });

    test("walk=0.4 shows feet and minute hint", async ({ page }) => {
      await page.goto("/#/visit?walk=0.4");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("4");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "2,000 ft (~10 min)",
      );
    });

    test("walk=0 hydrates slider minimum — no distance", async ({ page }) => {
      await page.goto("/#/visit?walk=0");
      await waitForParkingData(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("0");
      await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
        "No distance",
      );
    });

    test("walk=0 with finish applies strict walk-to-DASH filter (not unlimited pins)", async ({
      page,
    }) => {
      async function countParkingCircles() {
        return page.evaluate(() => {
          const g = globalThis.__parkingSpotsLayerForTest;
          if (!g?.eachLayer) return 0;
          let n = 0;
          g.eachLayer(() => {
            n += 1;
          });
          return n;
        });
      }

      await page.goto("/#/visit/acrisure-amphitheater?walk=1.5");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("15");
      const generousWalkCount = await countParkingCircles();

      await page.locator("#parkingMaxWalkSlider").evaluate((el) => {
        el.value = "0";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });

      await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("0");
      await expect(page).toHaveURL(/[?&]walk=0(?:&|$)/);
      const walkZeroCount = await countParkingCircles();

      expect(generousWalkCount).toBeGreaterThan(0);
      expect(walkZeroCount).toBeLessThan(generousWalkCount);
    });
  });

  test.describe("Walk overlay vs DASH", () => {
    test("straight parking→venue walk fits max walk → direct overlay only", async ({
      page,
    }) => {
      await page.goto(
        "/#/visit/acrisure-amphitheater?park=public-lot~42.961773~-85.670616&walk=1",
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
      const pinGlyphs = await page.evaluate(() => {
        const decodeSrc = (src) => {
          const i = src.indexOf(",");
          if (i < 0) return "";
          try {
            return decodeURIComponent(src.slice(i + 1));
          } catch {
            return "";
          }
        };
        let greenGlyph = null;
        let redGlyph = null;
        for (const img of document.querySelectorAll(
          "#parkingAppMap .leaflet-marker-pane img",
        )) {
          if (!img.src.startsWith("data:image/svg")) continue;
          const svg = decodeSrc(img.src);
          const g = svg.match(/fill="#16a34a">(\d)<\/text>/);
          if (g) greenGlyph = g[1];
          const r = svg.match(/fill="#dc2626">(\d)<\/text>/);
          if (r) redGlyph = r[1];
        }
        return { greenGlyph, redGlyph };
      });
      expect(pinGlyphs.greenGlyph).toBe("1");
      expect(pinGlyphs.redGlyph).toBe("2");
    });

    test("trip step digits on pins only when finish and start are both in the URL", async ({
      page,
    }) => {
      /** Same lot as “straight parking→venue walk” — stays eligible under default filters. */
      const acrisureLot = "public-lot~42.961773~-85.670616";
      await page.goto("/#/visit/acrisure-amphitheater?walk=1");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      const noDigitTextInPins = await page.evaluate(() => {
        const decodeSrc = (src) => {
          const i = src.indexOf(",");
          if (i < 0) return "";
          try {
            return decodeURIComponent(src.slice(i + 1));
          } catch {
            return "";
          }
        };
        for (const img of document.querySelectorAll(
          "#parkingAppMap .leaflet-marker-pane img",
        )) {
          if (!img.src.startsWith("data:image/svg")) continue;
          const svg = decodeSrc(img.src);
          if (/fill="#(?:16a34a|dc2626|933145)">\d<\/text>/.test(svg)) {
            return false;
          }
        }
        return true;
      });
      expect(noDigitTextInPins).toBe(true);

      await page.goto(
        `/#/visit/acrisure-amphitheater?walk=1&park=${encodeURIComponent(acrisureLot)}`,
      );
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);

      await page.waitForFunction(
        () => {
          const decodeSrc = (src) => {
            const i = src.indexOf(",");
            if (i < 0) return "";
            try {
              return decodeURIComponent(src.slice(i + 1));
            } catch {
              return "";
            }
          };
          if (
            typeof globalThis.__parkingTripStepNumbersHashReadyForTest !==
              "function" ||
            !globalThis.__parkingTripStepNumbersHashReadyForTest()
          ) {
            return false;
          }
          let greenNum = false;
          let finishNum = false;
          for (const img of document.querySelectorAll("#parkingAppMap img")) {
            if (!img.src?.startsWith("data:image/svg")) continue;
            const svg = decodeSrc(img.src);
            if (/fill="#16a34a">\d<\/text>/.test(svg)) greenNum = true;
            if (/fill="#dc2626">\d<\/text>/.test(svg)) finishNum = true;
          }
          return greenNum && finishNum;
        },
        { timeout: 20000 },
      );
    });

    test("walk=0 omits walk and DASH trip overlays (free-only lot + finish)", async ({
      page,
    }) => {
      await page.goto("/#/visit/acrisure-amphitheater?pay=0&walk=0");
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
      `/#/visit/van-andel-arena?pay=50&walk=0.5&park=${encodeURIComponent(cherrySpot)}`,
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
    await page.goto("/#/visit/van-andel-arena?location=public-garage&walk=0.5");
    await waitForParkingData(page);

    await expect(page.locator("#parkingDestinationSelect")).toHaveValue(
      "van-andel-arena",
    );
    await expect(page.locator("#parkingDestChevron")).toBeHidden();
    await expect(page.locator("#parkingResetBtn")).toBeVisible();

    await page.locator("#parkingResetBtn").click();
    await expect(page).toHaveURL(/#\/visit$/, { timeout: 15_000 });
    await expect(page.locator("#parkingMaxEveningSlider")).toHaveValue("50");
    await expect(page.locator("#parkingMaxEveningBudgetOut")).toHaveText(
      "Any price",
    );
    await expect(page.locator("#parkingMaxWalkSlider")).toHaveValue("5");
    await expect(page.locator("#parkingMaxWalkBudgetOut")).toHaveText(
      "0.5 mi (~12 min)",
    );
    await expect(page.locator("#parkingDestinationSelect")).toHaveValue("");
    await expect(page.locator("#parkingDestChevron")).toBeVisible();
    await expect(page.locator("#parkingResetBtn")).toBeHidden();
    await expect(
      page.locator('#parkingFilterBar [data-parking-category="public-garage"]'),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("refits map view when a category filter changes", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?walk=0.5");
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
    await page.goto("/#/visit/van-andel-arena?walk=0.5");
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

  test.describe("Auto recommendation without park= in URL", () => {
    test("evening slider does not add park when destination is selected", async ({
      page,
    }) => {
      await page.goto("/#/visit/van-andel-arena?walk=0.5");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).not.toHaveURL(/[?&]park=/);
      await page.evaluate(() => {
        const el = document.getElementById("parkingMaxEveningSlider");
        el.value = "35";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page).not.toHaveURL(/[?&]park=/);
    });

    test("walk slider does not add park when destination is selected", async ({
      page,
    }) => {
      await page.goto("/#/visit/van-andel-arena?walk=0.5");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).not.toHaveURL(/[?&]park=/);
      await page.evaluate(() => {
        const el = document.getElementById("parkingMaxWalkSlider");
        el.value = "9";
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await expect(page).not.toHaveURL(/[?&]park=/);
    });

    test("destination select does not add park when choosing destination", async ({
      page,
    }) => {
      await page.goto("/#/visit");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page).not.toHaveURL(/[?&]park=/);
      await page.selectOption("#parkingDestinationSelect", "van-andel-arena");
      await expect(page).toHaveURL(/#\/visit\/van-andel-arena/);
      await expect(page).not.toHaveURL(/[?&]park=/);
    });

    test("does not auto-pick a parking pin until a destination is chosen", async ({
      page,
    }) => {
      await page.goto("/#/visit");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await expect(page.locator("#parkingDestinationSelect")).toHaveValue("");
      const before = await page.evaluate(() =>
        globalThis.__getParkingEffectiveStartSpotIdForTest?.(),
      );
      expect(before).toBeUndefined();

      await page.selectOption("#parkingDestinationSelect", "van-andel-arena");
      await expect(page).toHaveURL(/#\/visit\/van-andel-arena/);
      await expect(page).not.toHaveURL(/[?&]park=/);

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

    test("category filter omits park=; effective pick matches enabled categories", async ({
      page,
    }) => {
      await page.goto("/#/visit/van-andel-arena?walk=0.5");
      await waitForParkingData(page);
      await waitForParkingLeafletMap(page);
      await page
        .locator('#parkingFilterBar [data-parking-category="private-lot"]')
        .click();
      await expect(page).toHaveURL(/[?&]location=/);
      await expect(page).not.toHaveURL(/[?&]park=/);

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
    await page.goto("/#/visit");
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
      g.eachLayer((group) => {
        if (!group?.eachLayer) return;
        group.eachLayer((m) => {
          const k = m.options?.parkingCategoryKey;
          if (
            !k ||
            m.options?.parkingSpotPopupLayer ||
            typeof m.getElement !== "function"
          )
            return;
          const el = m.getElement();
          if (!el) return;
          rows.push({ k, el });
        });
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

/**
 * Path to the static app shell before the hash (pair with `use.baseURL` in playwright.config.js).
 * Example: `"/"` → `http://localhost:8080/#/visit`.
 */
const DEFAULT_APP_PAGE = "/";

/**
 * `#/visit` layout snapshots: **`{device}-{n}-{variant}.png`** (e.g. **`desktop-1-blank.png`**).
 * Hash paths are under `${DEFAULT_APP_PAGE}#/…`.
 */
const PARKING_SNAPSHOT_CASES = [
  { n: "1", variant: "blank", hashPath: "visit" },
  {
    n: "2",
    variant: "finish",
    hashPath: "visit/acrisure-amphitheater?walk=0.5",
  },
  {
    n: "3",
    variant: "start",
    hashPath:
      "visit/acrisure-amphitheater?walk=0.5&park=private-lot~42.972319~-85.682491",
  },
];

const PARKING_SNAPSHOT_VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1440, height: 900 },
];

/** Fixed layout captures for `#/visit` via Playwright snapshot compare (`snapshotPathTemplate` in playwright.config.js). */
async function assertParkingViewportScreenshot(
  page,
  { hashPath, snapshotName, width, height },
) {
  await page.setViewportSize({ width, height });
  await page.goto(`${DEFAULT_APP_PAGE}#/${hashPath}`);
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

  /** Stable pixels: infinite SVG dash animations ignore Playwright’s “disable” timing; freeze everything. */
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
    /** OSM raster tiles and subpixel compositing vary slightly between runs. */
    maxDiffPixels: 2500,
  });
}

test.describe(
  "@snapshot Parking layout viewports",
  { tag: "@snapshot" },
  () => {
    /** Avoid hammering `live-server` / data fetches — parallel runs caused flaky loads and unstable tiles. */
    test.describe.configure({ mode: "serial", timeout: 45_000 });

    for (const { n, variant, hashPath } of PARKING_SNAPSHOT_CASES) {
      test.describe(`${n}-${variant}`, () => {
        for (const {
          name: device,
          width,
          height,
        } of PARKING_SNAPSHOT_VIEWPORTS) {
          test(`${device}`, { tag: "@snapshot" }, async ({ page }) => {
            await assertParkingViewportScreenshot(page, {
              hashPath,
              snapshotName: `${device}-${n}-${variant}`,
              width,
              height,
            });
          });
        }
      });
    }
  },
);
