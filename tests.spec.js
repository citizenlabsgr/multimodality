import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:8080";

test.describe("URL Fragment Permutations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for the page to load and initialize
    await page.waitForSelector("#preferencesSection");
  });

  test("should parse single mode", async ({ page }) => {
    await page.goto(`${BASE_URL}#modes=drive`);
    await page.waitForTimeout(500); // Wait for fragment parsing
    expect(await page.evaluate(() => window.state.modes)).toEqual(["drive"]);
  });

  test("should parse multiple modes", async ({ page }) => {
    await page.goto(`${BASE_URL}#modes=drive,transit`);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.modes)).toEqual([
      "drive",
      "transit",
    ]);
  });

  test("should parse all valid modes", async ({ page }) => {
    await page.goto(
      `${BASE_URL}#modes=drive,rideshare,transit,micromobility,shuttle,bike`,
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
    await page.goto(`${BASE_URL}#modes=drive,invalid,transit`);
    await page.waitForTimeout(500);
    const modes = await page.evaluate(() => window.state.modes);
    expect(modes).toContain("drive");
    expect(modes).toContain("transit");
    expect(modes).not.toContain("invalid");
  });

  test("should parse time in 3-digit format (HMM)", async ({ page }) => {
    await page.goto(`${BASE_URL}#time=830`); // 8:30 PM
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.time)).toBe("20:30");
    expect(await page.locator("#timeSelect")).toHaveValue("20:30");
  });

  test("should parse time in 4-digit format (HHMM)", async ({ page }) => {
    await page.goto(`${BASE_URL}#time=1000`); // 10:00 PM
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.time)).toBe("22:00");
    expect(await page.locator("#timeSelect")).toHaveValue("22:00");
  });

  test("should parse time 8:30 PM (830)", async ({ page }) => {
    await page.goto(`${BASE_URL}#time=830`);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.time)).toBe("20:30");
  });

  test("should parse day parameter", async ({ page }) => {
    await page.goto(`${BASE_URL}#day=tomorrow`);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.day)).toBe("tomorrow");
    expect(await page.locator("#daySelect")).toHaveValue("tomorrow");
  });

  test("should parse people parameter", async ({ page }) => {
    await page.goto(`${BASE_URL}#people=3`);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.people)).toBe(3);
    expect(await page.locator("#peopleCount")).toHaveText("3");
  });

  test("should parse people within valid range (1-6)", async ({ page }) => {
    await page.goto(`${BASE_URL}#people=4`);
    await page.waitForTimeout(500);
    const people = await page.evaluate(() => window.state.people);
    expect(people).toBeGreaterThanOrEqual(1);
    expect(people).toBeLessThanOrEqual(6);
  });

  test("should ignore people outside valid range", async ({ page }) => {
    await page.goto(`${BASE_URL}#people=10`);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.people)).toBe(6); // Clamped to max
  });

  test("should parse combined parameters", async ({ page }) => {
    await page.goto(
      `${BASE_URL}#modes=bike,shuttle&day=friday&time=1730&people=2`,
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
    await page.goto(`${BASE_URL}#modes=`);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.modes)).toEqual([]);
  });

  test("should handle URL-encoded parameters", async ({ page }) => {
    await page.goto(`${BASE_URL}#day=next%20week&time=1900`);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.day)).toBe("next week");
    expect(await page.evaluate(() => window.state.time)).toBe("19:00");
  });

  test("should update fragment when mode is selected", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForTimeout(500);

    // Set required fields first (destination is already set, need day and time)
    await page.locator("#daySelect").selectOption({ value: "today" });
    await page.locator("#timeSelect").selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    const driveButton = page.locator('[data-mode="drive"]');
    await driveButton.click();
    await page.waitForTimeout(300);

    const url = page.url();
    expect(url).toContain("#modes=drive");
  });

  test("should update fragment when time is selected", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForTimeout(500);

    const timeSelect = page.locator("#timeSelect");
    await timeSelect.selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    const url = page.url();
    expect(url).toContain("#time=500"); // 5:00 PM in URL format
  });

  test("should update fragment with multiple modes", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForTimeout(500);

    // Set required fields first (destination is already set, need day and time)
    await page.locator("#daySelect").selectOption({ value: "today" });
    await page.locator("#timeSelect").selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    await page.locator('[data-mode="drive"]').click();
    await page.locator('[data-mode="transit"]').click();
    await page.waitForTimeout(300);

    const url = page.url();
    expect(url).toContain("#modes=drive,transit");
  });

  test("should handle time conversion edge cases", async ({ page }) => {
    // Test 5:00 PM (500)
    await page.goto(`${BASE_URL}#time=500`);
    await page.waitForTimeout(500);
    await expect(page.locator("#timeSelect")).toHaveValue("17:00");

    // Test 9:30 PM (930)
    await page.goto(`${BASE_URL}#time=930`);
    await page.waitForTimeout(500);
    await expect(page.locator("#timeSelect")).toHaveValue("21:30");

    // Test 10:00 PM (1000)
    await page.goto(`${BASE_URL}#time=1000`);
    await page.waitForTimeout(500);
    await expect(page.locator("#timeSelect")).toHaveValue("22:00");
  });
});

test.describe("Parking Enforcement Logic", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector("#preferencesSection");
  });

  test("should enforce parking on weekday during enforcement hours (8am-7pm)", async ({
    page,
  }) => {
    // Test Monday at 12:00 PM (noon) - should be enforced
    await page.goto(`${BASE_URL}#day=monday&time=1200`);
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("monday", "12:00");
    });
    expect(isEnforced).toBe(true);
  });

  test("should NOT enforce parking on weekday after 7pm", async ({ page }) => {
    // Test Tuesday at 7:30 PM - should NOT be enforced
    await page.goto(`${BASE_URL}#day=tuesday&time=1930`);
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("tuesday", "19:30");
    });
    expect(isEnforced).toBe(false);
  });

  test("should NOT enforce parking on weekday before 8am", async ({ page }) => {
    // Test Wednesday at 7:30 AM - should NOT be enforced
    await page.goto(`${BASE_URL}#day=wednesday&time=0730`);
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("wednesday", "07:30");
    });
    expect(isEnforced).toBe(false);
  });

  test("should NOT enforce parking on weekends", async ({ page }) => {
    // Test Saturday at 2:00 PM - should NOT be enforced
    await page.goto(`${BASE_URL}#day=saturday&time=1400`);
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("saturday", "14:00");
    });
    expect(isEnforced).toBe(false);
  });

  test("should recommend free street parking when arriving after 7pm on weekday", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Tuesday at 7:30 PM
    await page.goto(
      `${BASE_URL}#modes=drive&day=tuesday&time=1930&walk=0.5&pay=10`,
    );
    await page.waitForTimeout(500);

    // Check that the recommendation is for free street parking
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("free street parking");
  });

  test("should recommend free street parking when arriving on weekend with low budget", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $5 (low budget), willing to walk 0.5 miles, arriving Saturday at 2:00 PM
    await page.goto(
      `${BASE_URL}#modes=drive&day=saturday&time=1400&walk=0.5&pay=5`,
    );
    await page.waitForTimeout(500);

    // Check that the recommendation is for free street parking (since budget is low)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("free street parking");
  });

  test("should recommend affordable lot when budget is $8-$19", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Monday at 6:00 PM
    await page.goto(
      `${BASE_URL}#modes=drive&day=monday&time=1800&walk=0.5&pay=10`,
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
      `${BASE_URL}#modes=drive&day=monday&time=1800&walk=0.5&pay=10`,
    );
    await page.waitForTimeout(500);

    // Check that the recommendation is for affordable surface lot (since willing to pay $10 >= $8)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("affordable surface lot");
  });

  test("should use isParkingEnforced function correctly", async ({ page }) => {
    await page.goto(BASE_URL);
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

  test("should show no options when parking is enforced and cost is $0", async ({
    page,
  }) => {
    // Test: Thursday at 6:00 PM (18:00), willing to pay $0, willing to walk
    // Parking is still enforced at 6pm, so no free parking available
    await page.goto(
      `${BASE_URL}#modes=drive&day=thursday&time=600&walk=0.5&pay=0`,
    );
    await page.waitForTimeout(500);

    // Check that the recommendation shows "No options available"
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("No options available");
    expect(resultsText).toContain("Parking meters are enforced until 7 PM");
  });

  test("should not show clear button when only time is set", async ({
    page,
  }) => {
    // Test: Only time is set in URL (7:00 AM = 07:00)
    await page.goto(`${BASE_URL}#time=700`);
    await page.waitForTimeout(500);

    // Check that reset button is hidden (since day hasn't been changed)
    const resetButton = page.locator("#resetButton");
    await expect(resetButton).toHaveClass(/hidden/);

    // Since day defaults to "today" and destination is set, all three fields are filled
    // So the card should be auto-collapsed (minimized view visible, content hidden)
    const whereWhenContent = page.locator("#whereWhenContent");
    const whereWhenMinimized = page.locator("#whereWhenMinimized");
    await expect(whereWhenContent).toHaveClass(/hidden/);
    await expect(whereWhenMinimized).not.toHaveClass(/hidden/);
    // Reset button should be hidden when card is collapsed
    await expect(resetButton).toHaveClass(/hidden/);
  });

  test("should collapse location card when all three inputs have values on page refresh", async ({
    page,
  }) => {
    // Test: All three inputs (destination, day, time) have values
    // Destination is always set, day defaults to "today", so we just need to set time
    await page.goto(`${BASE_URL}#time=700`);
    await page.waitForTimeout(500);

    // Check that the card is collapsed (minimized view is visible, content is hidden)
    const whereWhenContent = page.locator("#whereWhenContent");
    const whereWhenMinimized = page.locator("#whereWhenMinimized");
    const resetButton = page.locator("#resetButton");

    await expect(whereWhenContent).toHaveClass(/hidden/);
    await expect(whereWhenMinimized).not.toHaveClass(/hidden/);
    // Reset button should be hidden when card is collapsed
    await expect(resetButton).toHaveClass(/hidden/);

    // Also test with explicit day and time
    await page.goto(`${BASE_URL}#day=monday&time=800`);
    await page.waitForTimeout(500);

    await expect(whereWhenContent).toHaveClass(/hidden/);
    await expect(whereWhenMinimized).not.toHaveClass(/hidden/);
    // Reset button should be hidden when card is collapsed, even when day is changed
    await expect(resetButton).toHaveClass(/hidden/);
  });

  test("should collapse card when save button is clicked", async ({ page }) => {
    // Test: Save button should collapse the card when all fields are filled
    // Start with a clean page (no fragment) so card is expanded
    await page.goto(BASE_URL);
    await page.waitForSelector("#whereWhenContent", { state: "attached" });
    await page.waitForTimeout(300);

    const whereWhenContent = page.locator("#whereWhenContent");
    const whereWhenMinimized = page.locator("#whereWhenMinimized");
    const saveButton = page.locator("#saveButton");
    const expandButton = page.locator("#whereWhenExpand");

    // Expand the card if it's collapsed (by clicking edit if needed)
    const isExpanded = await whereWhenContent.isVisible();
    if (!isExpanded) {
      await expandButton.click();
      await page.waitForTimeout(300);
      // Verify it's now expanded
      await expect(whereWhenContent).toBeVisible();
    }

    // Verify card is expanded initially
    await expect(whereWhenContent).toBeVisible();
    await expect(whereWhenMinimized).not.toBeVisible();

    // Verify save button is disabled initially (time not set)
    await expect(saveButton).toBeDisabled();

    // Select day first (don't select time yet to avoid auto-collapse)
    await page.selectOption("#daySelect", "tomorrow");
    await page.waitForTimeout(200);

    // Verify save button is still disabled (time not set yet)
    await expect(saveButton).toBeDisabled();

    // Now select time - this will enable the save button
    // We'll expand the card again if it auto-collapses
    await page.selectOption("#timeSelect", "18:00");
    await page.waitForTimeout(500);

    // The card auto-collapses when all fields are filled, so expand it again to test the save button
    const isStillExpanded = await whereWhenContent.isVisible();
    if (!isStillExpanded) {
      // Wait for expand button to be available
      await expect(expandButton).toBeVisible({ timeout: 2000 });
      await page.waitForTimeout(200);
      // Click expand button
      await expandButton.click();
      await page.waitForTimeout(300);
      // Wait for the card to be fully expanded
      await expect(whereWhenContent).toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(200);
    }

    // Verify card is expanded and save button is enabled
    await expect(whereWhenContent).toBeVisible();
    await expect(saveButton).toBeEnabled({ timeout: 2000 });

    // Wait a bit for the button to be fully rendered
    await page.waitForTimeout(200);

    // Click save button to collapse the card
    await saveButton.click({ force: true });

    // Wait for the card to collapse
    await expect(whereWhenContent).not.toBeVisible({ timeout: 2000 });
    await expect(whereWhenMinimized).toBeVisible({ timeout: 2000 });

    // Reset button should be hidden when card is collapsed
    const resetButton = page.locator("#resetButton");
    await expect(resetButton).toHaveClass(/hidden/);
  });
});
