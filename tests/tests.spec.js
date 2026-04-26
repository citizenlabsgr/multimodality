import { test, expect } from "@playwright/test";

/** Paid options built from parking JSON (synced or hand-maintained); scoring picks garage vs lot vs meters. */
function resultsIncludePaidStructuredParking(text) {
  if (!text) return false;
  return (
    text.includes("affordable surface lot") ||
    text.includes("parking garage") ||
    text.includes("metered street parking") ||
    text.includes("Garage parking") ||
    text.includes("Metered parking") ||
    text.includes("Lot parking")
  );
}

// Global setup to fail tests on console errors
const consoleErrors = new Map();

test.beforeEach(async ({ page }) => {
  const errors = [];

  // Listen for console errors
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`Console error: ${msg.text()}`);
    }
  });

  // Listen for page errors (uncaught exceptions)
  page.on("pageerror", (error) => {
    errors.push(
      `Page error: ${error.message}${error.stack ? `\n${error.stack}` : ""}`,
    );
  });

  // Store errors for this test
  consoleErrors.set(page, errors);
});

test.afterEach(async ({ page }) => {
  // Check for console errors and fail the test if any exist
  const errors = consoleErrors.get(page) || [];
  if (errors.length > 0) {
    consoleErrors.delete(page);
    throw new Error(`Console/Page errors detected:\n${errors.join("\n")}`);
  }
  consoleErrors.delete(page);
});

test.describe("URL Fragment Permutations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the page to load and initialize
    await page.waitForSelector("#preferencesSection");
  });

  test("should parse single mode", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?modes=drive");
    await page.waitForTimeout(500); // Wait for fragment parsing
    expect(await page.evaluate(() => window.state.modes)).toEqual(["drive"]);
  });

  test("should parse multiple modes", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?modes=drive,transit");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.modes)).toEqual([
      "drive",
      "transit",
    ]);
  });

  test("should parse all valid modes", async ({ page }) => {
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive,rideshare,transit,micromobility,shuttle,bike",
    );
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.modes)).toEqual([
      "drive",
      "rideshare",
      "transit",
      "micromobility",
      "shuttle",
      "bike",
    ]);
  });

  test("should ignore invalid modes", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?modes=drive,invalid,transit");
    await page.waitForTimeout(500);
    const modes = await page.evaluate(() => window.state.modes);
    expect(modes).toContain("drive");
    expect(modes).toContain("transit");
    expect(modes).not.toContain("invalid");
  });

  test("should parse time in 3-digit format (HMM)", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?time=830"); // 8:30 PM
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.time)).toBe("20:30");
    expect(await page.locator("#timeSelect")).toHaveValue("20:30");
  });

  test("should parse time in 4-digit format (HHMM)", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?time=1000"); // 10:00 PM
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.time)).toBe("22:00");
    expect(await page.locator("#timeSelect")).toHaveValue("22:00");
  });

  test("should parse time 8:30 PM (830)", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?time=830");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.time)).toBe("20:30");
  });

  test("should parse day parameter", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?day=monday");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.day)).toBe("monday");
    expect(await page.locator("#daySelect")).toHaveValue("monday");
  });

  test("should parse people parameter", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?people=3");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.people)).toBe(3);
    expect(await page.locator("#peopleCount")).toHaveText("3");
  });

  test("should parse people within valid range (1-6)", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?people=4");
    await page.waitForTimeout(500);
    const people = await page.evaluate(() => window.state.people);
    expect(people).toBeGreaterThanOrEqual(1);
    expect(people).toBeLessThanOrEqual(6);
  });

  test("should ignore people outside valid range", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?people=10");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.people)).toBe(6); // Clamped to max
  });

  test("should parse combined parameters", async ({ page }) => {
    await page.goto(
      "/#/visit/van-andel-arena?modes=bike,shuttle&day=friday&time=530&people=2",
    );
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.modes)).toEqual([
      "bike",
      "shuttle",
    ]);
    expect(await page.evaluate(() => window.state.day)).toBe("friday");
    expect(await page.evaluate(() => window.state.time)).toBe("17:30");
    expect(await page.evaluate(() => window.state.people)).toBe(2);
  });

  test("should handle empty modes parameter", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?modes=");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.modes)).toEqual([]);
  });

  test("should default to drive, rideshare, and shuttle when modes omitted", async ({
    page,
  }) => {
    await page.goto("/#/visit/van-andel-arena?day=monday&time=600");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.modes)).toEqual([
      "drive",
      "rideshare",
      "shuttle",
    ]);
  });

  test("should handle URL-encoded parameters", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?day=next%20week&time=700");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.day)).toBe("next week");
    expect(await page.evaluate(() => window.state.time)).toBe("19:00");
  });

  test("should update fragment when mode is selected", async ({ page }) => {
    // Set required fields first (destination, day, time) so mode buttons are enabled
    await page
      .locator("#destinationSelect")
      .selectOption({ value: "Van Andel Arena" });
    await page.locator("#daySelect").selectOption({ value: "monday" });
    await page.locator("#timeSelect").selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    // Drive, rideshare, and DASH are preselected; add transit and expect it in the URL
    await page.locator('[data-mode="transit"]').click();
    await page.waitForTimeout(300);

    const url = page.url();
    expect(url).toContain("#/visit/van-andel-arena");
    expect(url).toContain("transit");
    expect(url).toMatch(/modes=[^&]*transit/);
  });

  test("should update fragment when time is selected", async ({ page }) => {
    const timeSelect = page.locator("#timeSelect");
    await timeSelect.selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    const url = page.url();
    // No destination selected yet, so path is /visit with query params
    expect(url).toContain("#/visit");
    expect(url).toContain("time=500"); // 5:00 PM in URL format
  });

  test("should update fragment with multiple modes", async ({ page }) => {
    // Set required fields first (destination, day, time) so mode buttons are enabled
    await page
      .locator("#destinationSelect")
      .selectOption({ value: "Van Andel Arena" });
    await page.locator("#daySelect").selectOption({ value: "monday" });
    await page.locator("#timeSelect").selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    // Default is drive + rideshare + shuttle; turn off rideshare and shuttle, add transit → drive + transit
    await page.locator('[data-mode="rideshare"]').click();
    await page.locator('[data-mode="shuttle"]').click();
    await page.locator('[data-mode="transit"]').click();
    await page.waitForTimeout(300);

    const url = page.url();
    expect(url).toContain("#/visit/van-andel-arena");
    expect(url).toContain("modes=drive,transit");
  });

  test("should handle time conversion edge cases", async ({ page }) => {
    // Test 5:00 PM (500)
    await page.goto("/#/visit/van-andel-arena?time=500");
    await page.waitForTimeout(500);
    await expect(page.locator("#timeSelect")).toHaveValue("17:00");

    // Test 9:30 PM (930)
    await page.goto("/#/visit/van-andel-arena?time=930");
    await page.waitForTimeout(500);
    await expect(page.locator("#timeSelect")).toHaveValue("21:30");

    // Test 10:00 PM (1000)
    await page.goto("/#/visit/van-andel-arena?time=1000");
    await page.waitForTimeout(500);
    await expect(page.locator("#timeSelect")).toHaveValue("22:00");
  });
});

test.describe("Visit page strategy cards gating", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
  });

  test("shows no strategy cards on #/visit until destination, day, time, and a mode", async ({
    page,
  }) => {
    await page.goto("/#/visit");
    await page.waitForTimeout(500);

    await expect(page.locator("#results")).toBeEmpty();
    await expect(page.locator("#results")).not.toContainText(
      "Recommended Strategy",
    );
    await expect(page.locator("#results")).not.toContainText("Ideal Strategy");
  });

  test("shows no cards when destination and modes are set but day or time is missing", async ({
    page,
  }) => {
    await page.goto("/#/visit/van-andel-arena?modes=drive");
    await page.waitForTimeout(500);

    await expect(page.locator("#results")).toBeEmpty();

    await page.goto("/#/visit/van-andel-arena?modes=drive&day=monday");
    await page.waitForTimeout(500);
    await expect(page.locator("#results")).toBeEmpty();
  });

  test("shows strategy cards when destination, day, time, and at least one mode are set", async ({
    page,
  }) => {
    await page.goto("/#/visit/van-andel-arena?day=monday&time=600");
    await page.waitForTimeout(500);

    await expect(page.locator("#results")).not.toBeEmpty();
    await expect(page.locator("#results")).toContainText(
      "Recommended Strategy",
    );
  });

  test("shows no cards when modes are explicitly empty even with destination, day, and time", async ({
    page,
  }) => {
    await page.goto("/#/visit/van-andel-arena?modes=&day=monday&time=600");
    await page.waitForTimeout(500);

    await expect(page.locator("#results")).toBeEmpty();
  });
});

test.describe("Empty recommendation pool (generic red fallback)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
  });

  test("shows generic red card when transit-only and no automated strategy matches", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/van-andel-arena?day=saturday&time=700&modes=transit&walk=0.01&pay=20",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results.locator(".border-red-200").first()).toBeVisible();
    await expect(results).toContainText("Unknown Strategy");
    await expect(results).toContainText("No options available");
    await expect(results).toContainText("Nothing in our data matches");
  });

  test("does not show generic fallback copy when a hand-crafted strategy fits", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=saturday&time=700&modes=drive&walk=1&pay=40",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results).toContainText("Ideal Strategy");
    await expect(results).not.toContainText("Nothing in our data matches");
  });
});

test.describe("Transit-only recommendations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
    await page.waitForFunction(
      () =>
        typeof window.RapidTransit?.findBestRapidRouteStopForDestination ===
        "function",
    );
  });

  test("recommends bus with Transit in steps when a stop is in walk range and budget covers round trip", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/van-andel-arena?day=saturday&time=700&modes=transit&walk=0.5&pay=10",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results.locator(".border-green-200").first()).toBeVisible();
    await expect(results).toContainText("Recommended Strategy");
    await expect(results).toContainText("The Rapid:");
    await expect(results).toContainText("Route ");

    await page.locator('button:has-text("Show steps")').first().click();
    await page.waitForTimeout(200);
    await expect(results).toContainText("Download the Transit app");
    await expect(results).toContainText("Van Andel Arena");
    const transitAppLink = results
      .locator('a[href*="transitapp.com"]')
      .filter({ hasText: "Download the Transit app" })
      .first();
    await expect(transitAppLink).toBeVisible();
  });

  test("findBestRapidRouteStop picks one non-DASH line closest to the venue", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?modes=transit&day=saturday&time=600&walk=1&pay=20",
    );
    await page.waitForFunction(() => window.state?.destination);

    const hit = await page.evaluate(() =>
      window.RapidTransit.findBestRapidRouteStopForDestination(window.state),
    );
    expect(hit).not.toBeNull();
    expect(hit.route).toBeTruthy();
    expect(hit.miles).toBeLessThan(1.5);
    const label = await page.evaluate(
      (h) => window.RapidTransit.formatRapidRouteLabel(h.route),
      hit,
    );
    expect(label).toMatch(/^Route /);
  });

  test("drive and transit together show a specific Rapid route when a stop fits walk budget", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=saturday&time=600&modes=drive,transit&pay=20",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(600);

    const text = await page.locator("#results").textContent();
    expect(text).toContain("The Rapid:");
    expect(text).toMatch(/Route \d+/);
  });
});

test.describe("Strategy card summaries (collapsed)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
  });

  test("drive recommendation summary omits prices and mile distances", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/van-andel-arena?day=saturday&time=700&modes=drive&walk=1&pay=20",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const recCard = page
      .locator("#results > div")
      .filter({ hasText: "Recommended Strategy" })
      .first();
    const summary = recCard.locator("p.text-slate-600").first();
    await expect(summary).not.toContainText("Typical cost");
    await expect(summary).not.toContainText(" mi");
    await expect(summary).not.toContainText("$");
  });

  test("micromobility Lime primary summary omits numeric mile callouts", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=friday&time=700&modes=micromobility&pay=40",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const summary = page
      .locator(".border-green-200")
      .first()
      .locator("p.text-slate-600")
      .first();
    const text = (await summary.textContent()) || "";
    expect(text).not.toMatch(/\d+\.\d+\s*mi\b/i);
    await expect(summary).toContainText("Rent a Lime scooter or bike");
  });
});

test.describe("Rideshare round-trip budget", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
  });

  test("shows red unknown-strategy card when willing to pay is below typical round-trip rideshare", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/van-andel-arena?day=tuesday&time=700&modes=rideshare&pay=15",
    );
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results).toContainText("Unknown Strategy");
    await expect(results).toContainText("No options available");
    await expect(results.locator(".border-red-200").first()).toBeVisible();
  });

  test("shows recommended rideshare when willing to pay meets round-trip threshold", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/van-andel-arena?day=tuesday&time=700&modes=rideshare&pay=20",
    );
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results).toContainText("Recommended Strategy");
    await expect(results).toContainText("Rideshare");
    await expect(results).not.toContainText("Unknown Strategy");
  });
});

test.describe("Bike-only recommendations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
  });

  test("bike-only with walk=0 shows red card when no rack at the venue", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=saturday&time=700&modes=bike&walk=0",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results.locator(".border-red-200").first()).toBeVisible();
    await expect(results).toContainText("No options available");
    await expect(results).not.toContainText("Bike to the venue");
  });

  test("bike-only with walk=0.1 shows red card when no rack within that distance", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=saturday&time=700&modes=bike&walk=0.1",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results.locator(".border-red-200").first()).toBeVisible();
    await expect(results).toContainText("No options available");
    await expect(results).not.toContainText("Bike to the venue");
  });

  test("shows green recommended strategy with map link to nearest rack", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=friday&time=700&modes=bike",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results).toContainText("Recommended Strategy");
    await expect(results).toContainText("Bike to the venue");
    await expect(results.locator(".border-green-200").first()).toBeVisible();

    await page.locator('button:has-text("Show steps")').first().click();
    await page.waitForTimeout(200);
    await expect(results).toContainText("Walk to the venue");
    await expect(results.getByText(/Park at|Find bike parking/)).toBeVisible();
    const rackLink = results
      .locator('a[href*="google.com/maps"]')
      .filter({ hasText: "View in maps" })
      .first();
    await expect(rackLink).toBeVisible();
    await expect(rackLink).toHaveAttribute("href", /maps\?q=|maps\/search/);
  });

  test("van-andel bike-only shows recommended strategy with rack map link", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/van-andel-arena?day=saturday&time=700&modes=bike",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results).toContainText("Recommended Strategy");
    await expect(results).toContainText("Bike to the venue");

    await page.locator('button:has-text("Show steps")').first().click();
    await page.waitForTimeout(200);
    await expect(
      results
        .locator('a[href*="google.com/maps"]')
        .filter({ hasText: "View in maps" })
        .first(),
    ).toBeVisible();
  });

  test("keeps willing to pay slider enabled when only bike is selected", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=friday&time=700&modes=bike",
    );
    await page.waitForSelector("#preferencesSection");
    await page.waitForTimeout(400);

    const costSlider = page.locator("#costSlider");
    await expect(costSlider).toBeEnabled();
    await expect(page.locator("#costValue")).not.toHaveText("—");
  });
});

test.describe("Micromobility-only recommendations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
  });

  test("shows recommended strategy with map link to nearest Lime hub", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=friday&time=700&modes=micromobility&pay=40",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results).toContainText("Recommended Strategy");
    await expect(results).toContainText("Use Lime and walk a short distance");
    await expect(results).toContainText("Use Lime and minimize walking");
    await expect(results).not.toContainText(
      "Find and ride a Lime scooter or bike",
    );
    await expect(results.locator(".border-green-200").first()).toBeVisible();
    await expect(results.locator(".border-yellow-200").first()).toBeVisible();

    await page.locator('button:has-text("Show steps")').first().click();
    await page.waitForTimeout(200);
    await expect(results).toContainText("Open the Lime app");
    await expect(results).toContainText(
      "Go to parking at the farther end of your range",
    );
    await expect(results).toContainText("Walk the rest of the way");
    const limeAppLink = results
      .locator('a[href*="li.me"]')
      .filter({ hasText: "Get the Lime app" })
      .first();
    await expect(limeAppLink).toBeVisible();
    const hubLink = results
      .locator('a[href*="google.com/maps"]')
      .filter({ hasText: "View in maps" })
      .first();
    await expect(hubLink).toBeVisible();
    await expect(hubLink).toHaveAttribute("href", /maps\?q=|maps\/search/);
  });

  test("option=1 expands Lime hub strategy steps (Acrisure)", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=friday&time=700&modes=micromobility&pay=40&option=1",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results).toContainText("Hide steps");
    await expect(results).toContainText("Use Lime and walk a short distance");
    const firstStepsDiv = results.locator("[id^='steps-']").first();
    await expect(firstStepsDiv).not.toHaveClass(/hidden/);
    await expect(
      results
        .locator('a[href*="google.com/maps"]')
        .filter({ hasText: "View in maps" })
        .first(),
    ).toBeVisible();
    await expect(
      results
        .locator('a[href*="li.me"]')
        .filter({ hasText: "Get the Lime app" })
        .first(),
    ).toBeVisible();
  });

  test("micromobility-only with pay=0 shows red card about Lime round-trip cost", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=friday&time=700&modes=micromobility&pay=0",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const results = page.locator("#results");
    await expect(results.locator(".border-red-200").first()).toBeVisible();
    await expect(results).toContainText("No options available");
    await expect(results).toContainText("Lime charges per ride in the app");
    await expect(results).not.toContainText(
      "Use Lime and walk a short distance",
    );
  });
});

test.describe("Option fragment (strategy steps expanded)", () => {
  // Use params that show strategy cards with steps
  const resultsParams = "modes=drive&day=monday&time=600&walk=0.5&pay=10";

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
  });

  test("should parse option=1 and expand first strategy steps", async ({
    page,
  }) => {
    await page.goto(`/#/visit/van-andel-arena?${resultsParams}&option=1`);
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    // First strategy card should show "Hide steps" (steps expanded)
    await expect(page.locator("#results")).toContainText("Hide steps");
    // Steps content should be visible (e.g. step title from drive+transit or drive recommendation)
    const results = page.locator("#results");
    const stepsDiv = results.locator("[id^='steps-']").first();
    await expect(stepsDiv).not.toHaveClass(/hidden/);
  });

  test("should parse option=1,2 and expand both strategy steps", async ({
    page,
  }) => {
    await page.goto(`/#/visit/van-andel-arena?${resultsParams}&option=1,2`);
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    // Both strategy cards should show "Hide steps"
    const hideStepsButtons = page.locator('button:has-text("Hide steps")');
    await expect(hideStepsButtons).toHaveCount(2);
  });

  test("should use literal comma in option param (not %2C)", async ({
    page,
  }) => {
    await page.goto(`/#/visit/van-andel-arena?${resultsParams}`);
    await page.waitForSelector("#results");
    await page.waitForTimeout(300);

    // Expand first strategy steps by clicking "Show steps"
    await page.locator('button:has-text("Show steps")').first().click();
    await page.waitForTimeout(300);

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toContain("option=1");
    expect(hash).not.toContain("%2C");
  });

  test("should update fragment with option=1,2 when expanding both strategies", async ({
    page,
  }) => {
    await page.goto(`/#/visit/van-andel-arena?${resultsParams}`);
    await page.waitForSelector("#results");
    await page.waitForTimeout(300);

    // Expand first strategy
    await page.locator('button:has-text("Show steps")').first().click();
    await page.waitForTimeout(200);
    // Expand second strategy (if present)
    const showStepsButtons = page.locator('button:has-text("Show steps")');
    if ((await showStepsButtons.count()) > 0) {
      await showStepsButtons.first().click();
      await page.waitForTimeout(200);
    }

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toMatch(/option=1(,2)?/);
    expect(hash).not.toContain("%2C");
  });

  test("should ignore invalid option values", async ({ page }) => {
    await page.goto(`/#/visit/van-andel-arena?${resultsParams}&option=1,foo,2`);
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    // Valid options 1 and 2 should be applied (foo ignored)
    const hideStepsButtons = page.locator('button:has-text("Hide steps")');
    await expect(hideStepsButtons).toHaveCount(2);
  });

  test("should restore expanded state when navigating with option in URL", async ({
    page,
  }) => {
    await page.goto(`/#/visit/van-andel-arena?${resultsParams}&option=1`);
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    // Steps should be visible (not hidden)
    const results = page.locator("#results");
    const firstStepsDiv = results.locator("[id^='steps-']").first();
    await expect(firstStepsDiv).toBeVisible();
  });
});

test.describe("Option fragment with hand-crafted recommendations", () => {
  // Acrisure on-site garage hand-crafted total cost $30; need drive, pay >= 30, walk >= 0.05
  const handCraftedParams = "modes=drive&day=monday&time=600&walk=0.5&pay=30";

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
  });

  test("option=1 should expand first card (hand-crafted when it fits)", async ({
    page,
  }) => {
    await page.goto(
      `/#/visit/acrisure-amphitheater?${handCraftedParams}&option=1`,
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    // First card is hand-crafted; should show "Hide steps" and steps visible
    await expect(page.locator("#results")).toContainText("Ideal Strategy");
    await expect(page.locator("#results")).toContainText(
      "Park in on-site garage",
    );
    const firstHideSteps = page
      .locator('button:has-text("Hide steps")')
      .first();
    await expect(firstHideSteps).toBeVisible();
    const firstStepsDiv = page
      .locator("#results")
      .locator("[id^='steps-']")
      .first();
    await expect(firstStepsDiv).not.toHaveClass(/hidden/);
    // Hand-crafted steps show mode labels
    await expect(page.locator("#results")).toContainText("Drive to parking");
    await expect(page.locator("#results")).toContainText("Walk to destination");
  });

  test("option=2 should expand second card (first strategy)", async ({
    page,
  }) => {
    await page.goto(
      `/#/visit/acrisure-amphitheater?${handCraftedParams}&option=2`,
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    // Second card is first strategy; should have one "Hide steps" for that card
    const hideStepsButtons = page.locator('button:has-text("Hide steps")');
    await expect(hideStepsButtons).toHaveCount(1);
    // First strategy card content (e.g. Recommended Strategy or drive recommendation)
    await expect(page.locator("#results")).toContainText(
      "Recommended Strategy",
    );
  });

  test("option=1,2 should expand both first (hand-crafted) and second (strategy) cards", async ({
    page,
  }) => {
    await page.goto(
      `/#/visit/acrisure-amphitheater?${handCraftedParams}&option=1,2`,
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    const hideStepsButtons = page.locator('button:has-text("Hide steps")');
    await expect(hideStepsButtons).toHaveCount(2);
    await expect(page.locator("#results")).toContainText("Ideal Strategy");
    await expect(page.locator("#results")).toContainText(
      "Park in on-site garage",
    );
  });

  test("hand-crafted rideshare requires willing to pay at least 2× step cost (both ways)", async ({
    page,
  }) => {
    // Acrisure has "Rideshare to the venue" with cost $20 (one way) = $40 both ways
    const baseParams = "modes=rideshare,drive&day=monday&time=600&walk=0.5";

    // With pay=39, effective cost $40 exceeds budget — rideshare blue card must not show
    await page.goto(`/#/visit/acrisure-amphitheater?${baseParams}&pay=39`);
    await page.waitForSelector("#results");
    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (!state || state.costDollars !== 39) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });
    await expect(page.locator("#results")).not.toContainText(
      "Rideshare to the venue",
    );

    // With pay=40, effective cost $40 fits budget — rideshare blue card must show (fresh load so init applies fragment)
    await page.goto(`/#/visit/acrisure-amphitheater?${baseParams}&pay=40`);
    await page.waitForSelector("#results");
    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (!state || state.costDollars !== 40) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });
    await expect(page.locator("#results")).toContainText("Ideal Strategy");
    await expect(page.locator("#results")).toContainText(
      "Rideshare to the venue",
    );
  });
});

test.describe("Parking Enforcement Logic", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
  });

  test("should enforce parking on weekday during enforcement hours (8am-7pm)", async ({
    page,
  }) => {
    // Test Monday at 12:00 PM (noon) - should be enforced
    await page.goto("/#/visit/van-andel-arena?day=monday&time=1200");
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("monday", "12:00");
    });
    expect(isEnforced).toBe(true);
  });

  test("should NOT enforce parking on weekday after 7pm", async ({ page }) => {
    // Test Tuesday at 7:30 PM - should NOT be enforced
    await page.goto("/#/visit/van-andel-arena?day=tuesday&time=730");
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("tuesday", "19:30");
    });
    expect(isEnforced).toBe(false);
  });

  test("should NOT enforce parking on weekday before 8am", async ({ page }) => {
    // Test Wednesday at 7:30 AM - should NOT be enforced
    await page.goto("/#/visit/van-andel-arena?day=wednesday&time=0730");
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("wednesday", "07:30");
    });
    expect(isEnforced).toBe(false);
  });

  test("should NOT enforce parking on weekends", async ({ page }) => {
    // Test Saturday at 2:00 PM - should NOT be enforced
    await page.goto("/#/visit/van-andel-arena?day=saturday&time=200");
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("saturday", "14:00");
    });
    expect(isEnforced).toBe(false);
  });

  test("should recommend paid parking when arriving after 7pm on weekday and willing to pay enough", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Tuesday at 7:30 PM
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=tuesday&time=730&walk=0.5&pay=10",
    );
    await page.waitForTimeout(500);

    // Check that the recommendation is for paid parking (garage or lot) since user is willing to pay $10
    const resultsText = await page.locator("#results").textContent();
    expect(resultsIncludePaidStructuredParking(resultsText)).toBe(true);
  });

  test("should recommend paid parking when arriving on weekend with low budget", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $5 (low budget), willing to walk 0.5 miles, arriving Saturday at 6:00 PM
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=saturday&time=600&walk=0.5&pay=5",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(1000); // Give extra time for state initialization and rendering

    // App prefers free street when parking not enforced (weekend) and budget is low; may show paid options
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).not.toContain("No options available");
    expect(
      resultsIncludePaidStructuredParking(resultsText) ||
        resultsText.includes("free street") ||
        resultsText.includes("Free street parking"),
    ).toBe(true);
  });

  test("should recommend affordable lot when budget is $8-$19", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Monday at 6:00 PM
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=monday&time=600&walk=0.5&pay=10",
    );
    await page.waitForTimeout(500);

    const resultsText = await page.locator("#results").textContent();
    expect(resultsIncludePaidStructuredParking(resultsText)).toBe(true);
  });

  test("should recommend affordable lot when arriving during enforcement hours on weekday", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Monday at 6:00 PM (still enforced)
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=monday&time=600&walk=0.5&pay=10",
    );
    await page.waitForTimeout(500);

    const resultsText = await page.locator("#results").textContent();
    expect(resultsIncludePaidStructuredParking(resultsText)).toBe(true);
  });

  test("should show no options when arriving during enforcement hours but unwilling to pay", async ({
    page,
  }) => {
    // Set up: drive mode, unwilling to pay ($0), willing to walk 0.5 miles, arriving Monday at 6:00 PM (during enforcement 8am-7pm)
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=monday&time=600&walk=0.5&pay=0",
    );
    // Wait for results to render
    const results = page.locator("#results");
    await results.waitFor();

    // Wait for state to be initialized correctly (with retry)
    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (
        !state ||
        state.costDollars !== 0 ||
        state.day !== "monday" ||
        state.time !== "18:00"
      ) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });

    // Check that the recommendation shows "Unknown Strategy"
    await expect(results).toContainText("Unknown Strategy");
    await expect(results).toContainText("not willing to pay for parking");
  });

  test("should show no options when unwilling to pay during enforcement even with long walk distance", async ({
    page,
  }) => {
    // Regression: walk > 0.5 must not suppress drive noCost while meters are enforced (no free-street card then).
    await page.goto(
      "/#/visit/van-andel-arena?day=friday&time=600&modes=drive&walk=1.5&pay=0",
    );
    const results = page.locator("#results");
    await results.waitFor();

    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (
        !state ||
        state.costDollars !== 0 ||
        state.day !== "friday" ||
        state.time !== "18:00" ||
        state.walkMiles !== 1.5 ||
        !state.modes.includes("drive")
      ) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });

    await expect(results).toContainText("Unknown Strategy");
    await expect(results).toContainText("not willing to pay for parking");
  });

  test("Friday 6pm with pay $5 should not treat teaser garage rates as in-budget; alternate includes metered street", async ({
    page,
  }) => {
    // Regression: city data mixes a low hourly "rate" with high event prices; $5 must not match $2–$50+ garages.
    await page.goto(
      "/#/visit/van-andel-arena?day=friday&time=600&modes=drive,rideshare,shuttle&pay=5",
    );
    const results = page.locator("#results");
    await results.waitFor();

    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (
        !state ||
        state.costDollars !== 5 ||
        state.day !== "friday" ||
        state.time !== "18:00"
      ) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });

    const resultsText = await results.textContent();
    expect(resultsText).not.toMatch(/\$2[–-]\$5[0-9]/);
    expect(resultsText).toContain("Alternate Strategy");
    expect(resultsText.toLowerCase()).toContain("metered");
  });

  test("Saturday evening Acrisure with drive+shuttle still shows a garage or lot within walk and budget", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/acrisure-amphitheater?day=saturday&time=700&modes=drive,shuttle&walk=0.5&pay=25",
    );
    const results = page.locator("#results");
    await results.waitFor();
    await page.waitForTimeout(500);

    const resultsText = await results.textContent();
    expect(resultsText).toContain("Park & DASH");
    expect(
      resultsText.includes("Garage parking") ||
        resultsText.includes("Lot parking"),
    ).toBe(true);
  });

  test("Friday 6pm with pay $15 and drive+shuttle should recommend a parking garage", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/van-andel-arena?day=friday&time=600&modes=drive,rideshare,shuttle&pay=15",
    );
    const results = page.locator("#results");
    await results.waitFor();

    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (
        !state ||
        state.costDollars !== 15 ||
        state.day !== "friday" ||
        state.time !== "18:00"
      ) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });

    const resultsText = await results.textContent();
    expect(resultsText).toContain("Recommended Strategy");
    expect(resultsIncludePaidStructuredParking(resultsText)).toBe(true);
  });

  test("should recommend paid parking when arriving after 7pm on weekday and unwilling to pay", async ({
    page,
  }) => {
    // Set up: drive mode, unwilling to pay ($0), willing to walk 0.5 miles, arriving Tuesday at 7:30 PM (after enforcement ends)
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=tuesday&time=730&walk=0.5&pay=0",
    );
    // Wait for results to be rendered
    await page.waitForSelector("#results");
    await page.waitForTimeout(1000); // Give extra time for state initialization and rendering

    // App prefers free street when parking not enforced (after 7pm); may show paid options
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).not.toContain("No options available");
    expect(
      resultsIncludePaidStructuredParking(resultsText) ||
        resultsText.includes("free street") ||
        resultsText.includes("Free street parking"),
    ).toBe(true);
  });

  test("should recommend paid parking when arriving on weekend and unwilling to pay", async ({
    page,
  }) => {
    // Set up: drive mode, unwilling to pay ($0), willing to walk 0.5 miles, arriving Saturday at 2:00 PM (weekend, not enforced)
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=saturday&time=200&walk=0.5&pay=0",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(1000); // Give extra time for state initialization and rendering

    // App prefers free street when parking not enforced (weekend); may show paid options
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).not.toContain("No options available");
    expect(
      resultsIncludePaidStructuredParking(resultsText) ||
        resultsText.includes("free street") ||
        resultsText.includes("Free street parking"),
    ).toBe(true);
  });

  test("should show paid parking options when arriving on weekday evening with low budget", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=monday&time=600&walk=0.8&pay=3",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(1000); // Give extra time for state initialization and rendering

    // App may show metered parking, free street, garage, or surface lot depending on scoring
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).not.toContain("No options available");
    expect(
      resultsIncludePaidStructuredParking(resultsText) ||
        resultsText.toLowerCase().includes("metered") ||
        resultsText.includes("free street") ||
        resultsText.includes("Free street parking"),
    ).toBe(true);
  });

  test("should recommend affordable lot when arriving after 7pm on weekday and willing to pay enough", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Tuesday at 7:30 PM (after enforcement ends)
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=tuesday&time=730&walk=0.5&pay=10",
    );
    await page.waitForTimeout(500);

    // Even though parking is free, if user is willing to pay, recommend paid structured parking
    const resultsText = await page.locator("#results").textContent();
    expect(resultsIncludePaidStructuredParking(resultsText)).toBe(true);
  });

  test("should recommend affordable lot when arriving on weekend and willing to pay enough", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Saturday at 2:00 PM (weekend, not enforced)
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=saturday&time=200&walk=0.5&pay=10",
    );
    await page.waitForTimeout(500);

    // Even though parking is free on weekends, if user is willing to pay, recommend paid structured parking
    const resultsText = await page.locator("#results").textContent();
    expect(resultsIncludePaidStructuredParking(resultsText)).toBe(true);
  });

  test("should use isParkingEnforced function correctly", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);

    // Test the function directly using the exposed function
    const testCases = await page.evaluate(() => {
      return [
        { day: "monday", time: "12:00", expected: true }, // Weekday during enforcement
        { day: "tuesday", time: "19:30", expected: false }, // Weekday after 7pm
        { day: "wednesday", time: "07:30", expected: false }, // Weekday before 8am
        { day: "thursday", time: "19:00", expected: false }, // Weekday exactly at 7pm
        { day: "friday", time: "08:00", expected: true }, // Weekday exactly at 8am
        { day: "saturday", time: "14:00", expected: false }, // Weekend
        { day: "sunday", time: "20:00", expected: false }, // Weekend
      ].map((tc) => ({
        ...tc,
        actual: window.isParkingEnforced(tc.day, tc.time),
      }));
    });

    testCases.forEach(({ day, time, expected, actual }) => {
      expect(actual).toBe(
        expected,
        `Parking enforcement for ${day} at ${time} should be ${expected}`,
      );
    });
  });

  test("should show clear button when only time is set", async ({ page }) => {
    // Load page first, then set hash so hashchange handler runs (init may run before hash is available)
    await page.goto("/");
    await page.waitForSelector("#whereWhenContent", { state: "attached" });
    await page.waitForTimeout(300);

    // Set only time in URL (7:00 PM = 19:00; URL format 700 = 7:00 PM)
    await page.evaluate(() => {
      window.location.hash = "#/visit/van-andel-arena?time=700";
    });
    await page.waitForTimeout(300);

    // Wait for state to have time set from hashchange
    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (!state || state.time !== "19:00") {
        throw new Error(`State.time not set: ${state?.time}`);
      }
    }).toPass({ timeout: 2500 });

    // Card should be expanded (content visible, minimized view hidden)
    const whereWhenContent = page.locator("#whereWhenContent");
    const whereWhenMinimized = page.locator("#whereWhenMinimized");
    await expect(whereWhenContent).not.toHaveClass(/hidden/);
    await expect(whereWhenMinimized).toHaveClass(/hidden/);

    // Reset button should be visible when card is not collapsed and time is changed
    const resetButton = page.locator("#resetButton");
    await expect(resetButton).not.toHaveClass(/hidden/, { timeout: 5000 });
  });

  test("should show clear button when time is selected via UI", async ({
    page,
  }) => {
    // Start with a clean page (no fragment)
    await page.goto("/");
    await page.waitForSelector("#whereWhenContent", { state: "attached" });
    await page.waitForTimeout(300);

    const resetButton = page.locator("#resetButton");

    // Initially, reset button should be hidden (nothing changed)
    await expect(resetButton).toHaveClass(/hidden/);

    // Select time via the dropdown
    await page.selectOption("#timeSelect", "18:00");
    await page.waitForTimeout(300);

    // Reset button should now be visible (time has been changed)
    await expect(resetButton).not.toHaveClass(/hidden/);
  });

  test("should clear day and time when clear location button is clicked", async ({
    page,
  }) => {
    // Start with a clean page
    await page.goto("/");
    await page.waitForSelector("#whereWhenContent", { state: "attached" });
    await page.waitForTimeout(300);

    // Set day and time via UI (so reset button will be visible)
    await page.selectOption("#daySelect", "monday");
    await page.waitForTimeout(200);
    await page.selectOption("#timeSelect", "18:00");
    await page.waitForTimeout(300);

    // Verify day and time are set
    expect(await page.evaluate(() => window.state.day)).toBe("monday");
    expect(await page.evaluate(() => window.state.time)).toBe("18:00");
    await expect(page.locator("#daySelect")).toHaveValue("monday");
    await expect(page.locator("#timeSelect")).toHaveValue("18:00");

    // Expand the card if it's collapsed (reset button is hidden when card is collapsed)
    const whereWhenContent = page.locator("#whereWhenContent");
    const expandButton = page.locator("#whereWhenExpand");

    const isExpanded = await whereWhenContent.isVisible().catch(() => false);
    if (!isExpanded) {
      // Wait for expand button to be available
      await expect(expandButton).toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(200);

      // Click expand button and wait for DOM update
      await Promise.all([
        page.waitForFunction(
          () => {
            const content = document.getElementById("whereWhenContent");
            return content && !content.classList.contains("hidden");
          },
          { timeout: 3000 },
        ),
        expandButton.click(),
      ]);

      // Verify it's now expanded
      await expect(whereWhenContent).toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(200);
    }

    // Verify reset button is visible (should be visible after UI changes and card is expanded)
    const resetButton = page.locator("#resetButton");
    await expect(resetButton).not.toHaveClass(/hidden/);

    // Click the reset button
    await resetButton.click();
    await page.waitForTimeout(500);

    // Verify day and time are cleared
    expect(await page.evaluate(() => window.state.day)).toBe("");
    expect(await page.evaluate(() => window.state.time)).toBe("");
    await expect(page.locator("#daySelect")).toHaveValue("");
    await expect(page.locator("#timeSelect")).toHaveValue("");
  });

  test("should show no options when budget is insufficient for required metered parking during enforcement", async ({
    page,
  }) => {
    // Test: Friday at 6:00 PM (18:00), parking enforced until 7pm, budget is $2
    // Required cost: 1 hour until 7pm = $4.00 (metered parking rates vary)
    // User budget: $2, which is insufficient
    // No free street parking available within 0.5 miles
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=friday&time=600&pay=2&walk=0.5",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    // Wait for state to be initialized correctly
    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (
        !state ||
        state.costDollars !== 2 ||
        state.day !== "friday" ||
        state.time !== "18:00"
      ) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });

    // Check that the recommendation shows "Unknown Strategy" / "No options available"
    const results = page.locator("#results");
    await expect(results).toContainText("Unknown Strategy");
    await expect(results).toContainText("No options available");
  });

  test("should not recommend surface lots when walk distance is less than 0.5 miles", async ({
    page,
  }) => {
    // Test: Friday at 6:00 PM (18:00), budget is $9, walk distance is 0.2 miles
    // Surface lots require at least 0.5 miles walking willingness; with a short walk budget, garages/meters win
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=friday&time=600&walk=0.2&pay=9",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(1000); // Give extra time for state initialization and rendering

    // Wait for state to be initialized correctly
    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (
        !state ||
        state.costDollars !== 9 ||
        state.day !== "friday" ||
        state.time !== "18:00" ||
        state.walkMiles !== 0.2
      ) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });

    const results = page.locator("#results");
    const resultsText = await results.textContent();
    // Garages use event-tier pricing; short walk + mid budget may rank metered ahead of ramps
    expect(
      resultsText.includes("Garage parking") ||
        resultsText.includes("parking garage") ||
        resultsText.includes("Metered parking") ||
        resultsText.includes("metered street parking"),
    ).toBe(true);
    await expect(results).not.toContainText("Lot parking");
    await expect(results).not.toContainText("affordable surface lot");
  });

  test("should recommend rideshare when both rideshare and drive are selected", async ({
    page,
  }) => {
    // Test: Wednesday at 6:00 PM (18:00), both rideshare and drive selected, walk=0, pay=20
    // Should recommend rideshare (prioritized over drive-only)
    await page.goto(
      "/#/visit/van-andel-arena?day=wednesday&time=600&modes=rideshare,drive&walk=0&pay=20",
    );
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    // Wait for state to be initialized correctly
    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (
        !state ||
        state.costDollars !== 20 ||
        state.day !== "wednesday" ||
        state.time !== "18:00" ||
        !state.modes.includes("rideshare") ||
        !state.modes.includes("drive")
      ) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });

    // Primary recommendation should be rideshare, not a drive-parking card
    const results = page.locator("#results");
    const resultsText = await results.textContent();
    expect(resultsText.toLowerCase()).toContain("rideshare");
    expect(resultsText).toContain("Uber");
    const primaryCard = results
      .locator("> div")
      .filter({ hasText: "Recommended Strategy" })
      .first();
    await expect(primaryCard.locator("h3")).toContainText(/Rideshare/i);
  });

  test("should show options when drive+transit combination doesn't work but other modes are available", async ({
    page,
  }) => {
    // Test: Wednesday at 6:00 PM (18:00), drive+transit+rideshare selected, walk=0, pay=25
    // Drive+transit requires walk > 0, so should fall back to rideshare
    await page.goto(
      "/#/visit/van-andel-arena?day=wednesday&time=600&modes=drive,rideshare,transit&walk=0&pay=25",
    );
    await page.waitForSelector("#preferencesSection");
    await page.waitForTimeout(1500);

    // Wait for state to be initialized correctly with URL parameters
    await expect(async () => {
      const state = await page.evaluate(() => window.state);
      if (
        !state ||
        state.day !== "wednesday" ||
        state.time !== "18:00" ||
        !state.modes.includes("drive") ||
        !state.modes.includes("rideshare") ||
        !state.modes.includes("transit")
      ) {
        throw new Error(`State not initialized: ${JSON.stringify(state)}`);
      }
    }).toPass({ timeout: 2500 });

    // Wait for results to render
    const results = page.locator("#results");
    await results.waitFor({ state: "attached" });
    await page.waitForTimeout(500);

    // Check that options are shown (should fall back to rideshare since drive+transit doesn't work with walk=0)
    const resultsText = await results.textContent();
    expect(resultsText.toLowerCase()).toContain("rideshare");
    expect(resultsText).toContain("Uber");
    expect(resultsText).not.toContain("No options available");
    expect(resultsText).not.toContain("Unknown Strategy");
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

test.describe("Modes explain modal", () => {
  test("opens from Explain modes button, shows mode maps, closes with Escape", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
    await page.getByRole("button", { name: "Explain modes" }).click();
    await page.waitForTimeout(800);

    await expect(page.locator("#modesExplainModal")).toBeVisible();
    await expect(page.locator("#modesExplainModalSections")).toBeVisible();
    await expect(
      page.locator("#modesExplainModalSections h3").first(),
    ).toBeVisible();

    await expect(page.locator("#modes-modal-map-drive")).toBeVisible();
    await expect(page.locator("#modes-modal-map-rideshare")).toBeVisible();
    await expect(page.locator("#modes-modal-map-shuttle")).toBeVisible();
    await expect(page.locator("#modes-modal-map-transit")).toBeVisible();
    await expect(
      page.locator("#modesExplainModalSections .leaflet-container"),
    ).toHaveCount(6);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await expect(page.locator("#modesExplainModal")).toBeHidden();
  });
});

test.describe("Modes route", () => {
  test("should show mode explainers and maps at #/modes", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
    await page.goto("/#/modes");
    await page.waitForTimeout(600);

    await expect(page.locator("#modesView")).toBeVisible();
    await expect(page.locator("#appView")).toBeHidden();
    await expect(page.locator("#modesPageSections")).toBeVisible();
    await expect(page.locator("#modes-page-map-drive")).toBeVisible();
    await expect(page.locator("#modes-page-map-shuttle")).toBeVisible();
    await expect(page.locator("#modes-page-map-transit")).toBeVisible();
    await expect(page.locator("#modes-page-map-rideshare")).toBeVisible();
    await expect(page.locator("#modesView .leaflet-container")).toHaveCount(6);

    const headings = await page
      .locator("#modesPageSections h3")
      .allTextContents();
    const dashIdx = headings.findIndex((t) => t.includes("DASH"));
    const rapidIdx = headings.findIndex((t) => t.includes("Rapid"));
    expect(dashIdx).toBeGreaterThan(-1);
    expect(rapidIdx).toBeGreaterThan(-1);
    expect(dashIdx).toBeLessThan(rapidIdx);

    await page.locator("#modesPageBackLink").click();
    await page.waitForTimeout(200);
    await expect(page.locator("#appView")).toBeVisible();
    await expect(page.locator("#modesView")).toBeHidden();
  });
});

test.describe("Park & DASH data-driven copy", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#preferencesSection");
    await page.waitForFunction(
      () =>
        Array.isArray(window.appData?.parking?.lots) &&
        window.appData.parking.lots.length > 0 &&
        Array.isArray(window.appData?.busRoutes?.dash_routes) &&
        window.appData.busRoutes.dash_routes.length > 0 &&
        typeof window.ParkDashLot?.pickParkDashExampleLot === "function",
    );
  });

  test("lotListingIncludesDash requires a non-empty DASH line in scraped availability", async ({
    page,
  }) => {
    expect(
      await page.evaluate(() =>
        window.ParkDashLot.lotListingIncludesDash({
          availability: "80 spaces; DASH: Circulator",
        }),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        window.ParkDashLot.lotListingIncludesDash({ availability: "DASH: " }),
      ),
    ).toBe(false);
    expect(
      await page.evaluate(() =>
        window.ParkDashLot.lotListingIncludesDash({
          availability: "42 spaces; DASH: ",
        }),
      ),
    ).toBe(false);
  });

  test("pickParkDashExampleLot chooses lowest posted tier among DASH lots, tie-broken by walk to a DASH stop", async ({
    page,
  }) => {
    const pick = await page.evaluate(() => {
      const { pickParkDashExampleLot } = window.ParkDashLot;
      return pickParkDashExampleLot(
        window.appData.parking.lots,
        window.appData.busRoutes.dash_routes,
      );
    });
    expect(pick).not.toBeNull();
    expect(pick.lot.name).toBe("Area 8 Lot");
    expect(pick.costMin).toBe(6);
    expect(pick.walkMilesToDash).toBeLessThan(0.08);
    expect(String(pick.nearestStop.name || "").length).toBeGreaterThan(0);
  });

  test("processed Park & DASH recommendation fills lot + stop copy from parking and DASH data", async ({
    page,
  }) => {
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive,shuttle&day=friday&time=600&walk=1&pay=12",
    );
    await page.waitForSelector("#preferencesSection");
    await page.waitForFunction(() => window.state?.destination);

    const proc = await page.evaluate(() =>
      window.ParkDashLot.getProcessedDriveShuttleRecommendation(),
    );
    expect(proc).not.toBeNull();
    expect(proc.steps?.length).toBe(4);
    expect(proc.steps[0].description).toContain("Area 8 Lot");
    expect(proc.steps[0].description).toContain("325 Winter Ave NW");
    expect(proc.steps[0].link || "").toMatch(/google\.com\/maps|maps\.google/i);
    expect(proc.steps[3].link || "").toMatch(/google\.com\/maps|maps\.google/i);
    expect(proc.steps[3].description.length).toBeGreaterThan(20);
  });
});
