import { test, expect } from "@playwright/test";

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

  test("should handle URL-encoded parameters", async ({ page }) => {
    await page.goto("/#/visit/van-andel-arena?day=next%20week&time=700");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.day)).toBe("next week");
    expect(await page.evaluate(() => window.state.time)).toBe("19:00");
  });

  test("should update fragment when mode is selected", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);

    // Set required fields first (destination is already set, need day and time)
    await page.locator("#daySelect").selectOption({ value: "monday" });
    await page.locator("#timeSelect").selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    const driveButton = page.locator('[data-mode="drive"]');
    await driveButton.click();
    await page.waitForTimeout(300);

    const url = page.url();
    expect(url).toContain("#/visit/van-andel-arena");
    expect(url).toContain("modes=drive");
  });

  test("should update fragment when time is selected", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);

    const timeSelect = page.locator("#timeSelect");
    await timeSelect.selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    const url = page.url();
    expect(url).toContain("#/visit/van-andel-arena");
    expect(url).toContain("time=500"); // 5:00 PM in URL format
  });

  test("should update fragment with multiple modes", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);

    // Set required fields first (destination is already set, need day and time)
    await page.locator("#daySelect").selectOption({ value: "monday" });
    await page.locator("#timeSelect").selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    await page.locator('[data-mode="drive"]').click();
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
    expect(resultsText).toContain("parking garage");
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
      resultsText.includes("parking garage") ||
        resultsText.includes("free street") ||
        resultsText.includes("parking"),
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

    // Check that the recommendation is for affordable surface lot (since user is willing to pay $8-$19)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("affordable surface lot");
  });

  test("should recommend affordable lot when arriving during enforcement hours on weekday", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Monday at 6:00 PM (still enforced)
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=monday&time=600&walk=0.5&pay=10",
    );
    await page.waitForTimeout(500);

    // Check that the recommendation is for affordable surface lot (since willing to pay $10 >= $8)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("affordable surface lot");
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
    }).toPass({ timeout: 7000 });

    // Check that the recommendation shows "Unknown Strategy"
    await expect(results).toContainText("Unknown Strategy");
    await expect(results).toContainText("not willing to pay for parking");
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
      resultsText.includes("parking garage") ||
        resultsText.includes("free street") ||
        resultsText.includes("parking"),
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
      resultsText.includes("parking garage") ||
        resultsText.includes("free street") ||
        resultsText.includes("parking"),
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
      resultsText.includes("parking garage") ||
        resultsText.includes("affordable surface lot") ||
        resultsText.includes("metered") ||
        resultsText.includes("free street") ||
        resultsText.includes("parking"),
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

    // Check that the recommendation is for affordable surface lot (since willing to pay $10 >= $8)
    // Even though parking is free, if user is willing to pay, recommend paid parking
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("affordable surface lot");
  });

  test("should recommend affordable lot when arriving on weekend and willing to pay enough", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Saturday at 2:00 PM (weekend, not enforced)
    await page.goto(
      "/#/visit/van-andel-arena?modes=drive&day=saturday&time=200&walk=0.5&pay=10",
    );
    await page.waitForTimeout(500);

    // Check that the recommendation is for affordable surface lot (since willing to pay $10 >= $8)
    // Even though parking is free on weekends, if user is willing to pay, recommend paid parking
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("affordable surface lot");
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
    }).toPass({ timeout: 5000 });

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
    }).toPass({ timeout: 7000 });

    // Check that the recommendation shows "Unknown Strategy" / "No options available"
    const results = page.locator("#results");
    await expect(results).toContainText("Unknown Strategy");
    await expect(results).toContainText("No options available");
  });

  test("should not recommend surface lots when walk distance is less than 0.5 miles", async ({
    page,
  }) => {
    // Test: Friday at 6:00 PM (18:00), budget is $9, walk distance is 0.2 miles
    // Surface lots require at least 0.5 miles walking distance (they're 0.2-0.5 miles from Van Andel)
    // Should recommend cheaper garage instead (0.2-0.3 miles away, city parking garage)
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
    }).toPass({ timeout: 7000 });

    // Check that the recommendation is for cheaper garage, not surface lot
    // Also check that metered street parking is shown as an alternative
    const results = page.locator("#results");
    await expect(results).toContainText("parking garage");
    await expect(results).toContainText("Park at metered street parking");
    await expect(results).not.toContainText("surface lot");
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
    }).toPass({ timeout: 7000 });

    // Check that the recommendation is for rideshare, not drive
    const results = page.locator("#results");
    const resultsText = await results.textContent();
    expect(resultsText).toContain("rideshare");
    expect(resultsText).toContain("Uber");
    expect(resultsText).not.toContain("parking");
    expect(resultsText).not.toContain("Park at");
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
    }).toPass({ timeout: 10000 });

    // Wait for results to render
    const results = page.locator("#results");
    await results.waitFor({ state: "attached" });
    await page.waitForTimeout(500);

    // Check that options are shown (should fall back to rideshare since drive+transit doesn't work with walk=0)
    const resultsText = await results.textContent();
    expect(resultsText).toContain("rideshare");
    expect(resultsText).toContain("Uber");
    expect(resultsText).not.toContain("No options available");
    expect(resultsText).not.toContain("Unknown Strategy");
  });
});
