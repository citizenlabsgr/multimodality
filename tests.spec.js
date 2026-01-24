import { test, expect } from "@playwright/test";

test.describe("URL Fragment Permutations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the page to load and initialize
    await page.waitForSelector("#preferencesSection");
  });

  test("should parse single mode", async ({ page }) => {
    await page.goto("/#modes=drive");
    await page.waitForTimeout(500); // Wait for fragment parsing
    expect(await page.evaluate(() => window.state.modes)).toEqual(["drive"]);
  });

  test("should parse multiple modes", async ({ page }) => {
    await page.goto("/#modes=drive,transit");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.modes)).toEqual([
      "drive",
      "transit",
    ]);
  });

  test("should parse all valid modes", async ({ page }) => {
    await page.goto(
      "/#modes=drive,rideshare,transit,micromobility,shuttle,bike",
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
    await page.goto("/#modes=drive,invalid,transit");
    await page.waitForTimeout(500);
    const modes = await page.evaluate(() => window.state.modes);
    expect(modes).toContain("drive");
    expect(modes).toContain("transit");
    expect(modes).not.toContain("invalid");
  });

  test("should parse time in 3-digit format (HMM)", async ({ page }) => {
    await page.goto("/#time=830"); // 8:30 PM
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.time)).toBe("20:30");
    expect(await page.locator("#timeSelect")).toHaveValue("20:30");
  });

  test("should parse time in 4-digit format (HHMM)", async ({ page }) => {
    await page.goto("/#time=1000"); // 10:00 PM
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.time)).toBe("22:00");
    expect(await page.locator("#timeSelect")).toHaveValue("22:00");
  });

  test("should parse time 8:30 PM (830)", async ({ page }) => {
    await page.goto("/#time=830");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.time)).toBe("20:30");
  });

  test("should parse day parameter", async ({ page }) => {
    await page.goto("/#day=monday");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.day)).toBe("monday");
    expect(await page.locator("#daySelect")).toHaveValue("monday");
  });

  test("should parse people parameter", async ({ page }) => {
    await page.goto("/#people=3");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.people)).toBe(3);
    expect(await page.locator("#peopleCount")).toHaveText("3");
  });

  test("should parse people within valid range (1-6)", async ({ page }) => {
    await page.goto("/#people=4");
    await page.waitForTimeout(500);
    const people = await page.evaluate(() => window.state.people);
    expect(people).toBeGreaterThanOrEqual(1);
    expect(people).toBeLessThanOrEqual(6);
  });

  test("should ignore people outside valid range", async ({ page }) => {
    await page.goto("/#people=10");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.people)).toBe(6); // Clamped to max
  });

  test("should parse combined parameters", async ({ page }) => {
    await page.goto("/#modes=bike,shuttle&day=friday&time=1730&people=2");
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
    await page.goto("/#modes=");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.state.modes)).toEqual([]);
  });

  test("should handle URL-encoded parameters", async ({ page }) => {
    await page.goto("/#day=next%20week&time=1900");
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
    expect(url).toContain("#modes=drive");
  });

  test("should update fragment when time is selected", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);

    const timeSelect = page.locator("#timeSelect");
    await timeSelect.selectOption({ value: "17:00" });
    await page.waitForTimeout(300);

    const url = page.url();
    expect(url).toContain("#time=500"); // 5:00 PM in URL format
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
    expect(url).toContain("#modes=drive,transit");
  });

  test("should handle time conversion edge cases", async ({ page }) => {
    // Test 5:00 PM (500)
    await page.goto("/#time=500");
    await page.waitForTimeout(500);
    await expect(page.locator("#timeSelect")).toHaveValue("17:00");

    // Test 9:30 PM (930)
    await page.goto("/#time=930");
    await page.waitForTimeout(500);
    await expect(page.locator("#timeSelect")).toHaveValue("21:30");

    // Test 10:00 PM (1000)
    await page.goto("/#time=1000");
    await page.waitForTimeout(500);
    await expect(page.locator("#timeSelect")).toHaveValue("22:00");
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
    await page.goto("/#day=monday&time=1200");
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("monday", "12:00");
    });
    expect(isEnforced).toBe(true);
  });

  test("should NOT enforce parking on weekday after 7pm", async ({ page }) => {
    // Test Tuesday at 7:30 PM - should NOT be enforced
    await page.goto("/#day=tuesday&time=1930");
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("tuesday", "19:30");
    });
    expect(isEnforced).toBe(false);
  });

  test("should NOT enforce parking on weekday before 8am", async ({ page }) => {
    // Test Wednesday at 7:30 AM - should NOT be enforced
    await page.goto("/#day=wednesday&time=0730");
    await page.waitForTimeout(500);
    const isEnforced = await page.evaluate(() => {
      return window.isParkingEnforced("wednesday", "07:30");
    });
    expect(isEnforced).toBe(false);
  });

  test("should NOT enforce parking on weekends", async ({ page }) => {
    // Test Saturday at 2:00 PM - should NOT be enforced
    await page.goto("/#day=saturday&time=1400");
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
    await page.goto("/#modes=drive&day=tuesday&time=1930&walk=0.5&pay=10");
    await page.waitForTimeout(500);

    // Check that the recommendation is for free street parking
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("free street parking");
  });

  test("should recommend free street parking when arriving on weekend with low budget", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $5 (low budget), willing to walk 0.5 miles, arriving Saturday at 2:00 PM
    await page.goto("/#modes=drive&day=saturday&time=1400&walk=0.5&pay=5");
    await page.waitForTimeout(500);

    // Check that the recommendation is for free street parking (since budget is low)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("free street parking");
  });

  test("should recommend affordable lot when budget is $8-$19", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Monday at 6:00 PM
    await page.goto("/#modes=drive&day=monday&time=1800&walk=0.5&pay=10");
    await page.waitForTimeout(500);

    // Check that the recommendation is for affordable surface lot (since user is willing to pay $8-$19)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("affordable surface lot");
  });

  test("should recommend affordable lot when arriving during enforcement hours on weekday", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Monday at 6:00 PM (still enforced)
    await page.goto("/#modes=drive&day=monday&time=1800&walk=0.5&pay=10");
    await page.waitForTimeout(500);

    // Check that the recommendation is for affordable surface lot (since willing to pay $10 >= $8)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("affordable surface lot");
  });

  test("should show no options when arriving during enforcement hours but unwilling to pay", async ({
    page,
  }) => {
    // Set up: drive mode, unwilling to pay ($0), willing to walk 0.5 miles, arriving Monday at 6:00 PM (during enforcement 8am-7pm)
    await page.goto("/#modes=drive&day=monday&time=1800&walk=0.5&pay=0");
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

  test("should recommend free street parking when arriving after 7pm on weekday and unwilling to pay", async ({
    page,
  }) => {
    // Set up: drive mode, unwilling to pay ($0), willing to walk 0.5 miles, arriving Tuesday at 7:30 PM (after enforcement ends)
    await page.goto("/#modes=drive&day=tuesday&time=1930&walk=0.5&pay=0");
    await page.waitForTimeout(500);

    // Check that the recommendation is for free street parking (parking not enforced after 7pm)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("free street parking");
  });

  test("should recommend free street parking when arriving on weekend and unwilling to pay", async ({
    page,
  }) => {
    // Set up: drive mode, unwilling to pay ($0), willing to walk 0.5 miles, arriving Saturday at 2:00 PM (weekend, not enforced)
    await page.goto("/#modes=drive&day=saturday&time=1400&walk=0.5&pay=0");
    await page.waitForTimeout(500);

    // Check that the recommendation is for free street parking (parking not enforced on weekends)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("free street parking");
  });

  test("should show summary line below title for free street parking strategy", async ({
    page,
  }) => {
    await page.goto("/#modes=drive&day=monday&time=600&walk=0.8&pay=3");
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

    // Check that the title is shown
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("Find free street parking");

    // Check that the summary/body text is shown below the title
    // The body text should contain "Spend 15 minutes in traffic"
    expect(resultsText).toContain("Spend 15 minutes in traffic");
    expect(resultsText).toContain("circling the area");
  });

  test("should recommend affordable lot when arriving after 7pm on weekday and willing to pay enough", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $10, willing to walk 0.5 miles, arriving Tuesday at 7:30 PM (after enforcement ends)
    await page.goto("/#modes=drive&day=tuesday&time=1930&walk=0.5&pay=10");
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
    await page.goto("/#modes=drive&day=saturday&time=1400&walk=0.5&pay=10");
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
    // Test: Only time is set in URL (7:00 PM = 19:00, but URL format is 700 = 7:00 PM)
    await page.goto("/#time=700");
    await page.waitForTimeout(500);

    // Check that reset button is visible (since time has been changed)
    const resetButton = page.locator("#resetButton");
    await expect(resetButton).not.toHaveClass(/hidden/);

    // Since day no longer defaults and destination is set, but day is empty,
    // the card should NOT be auto-collapsed (content visible, minimized view hidden)
    const whereWhenContent = page.locator("#whereWhenContent");
    const whereWhenMinimized = page.locator("#whereWhenMinimized");
    await expect(whereWhenContent).not.toHaveClass(/hidden/);
    await expect(whereWhenMinimized).toHaveClass(/hidden/);
    // Reset button should be visible when card is not collapsed and time is changed
    await expect(resetButton).not.toHaveClass(/hidden/);
  });

  test("should collapse card when save button is clicked", async ({ page }) => {
    // Test: Save button should collapse the card when all fields are filled
    // Start with a clean page (no fragment) so card is expanded
    await page.goto("/");
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
    await page.selectOption("#daySelect", "monday");
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
      await expect(expandButton).toBeVisible();
      await page.waitForTimeout(200);
      // Click expand button
      await expandButton.click();
      await page.waitForTimeout(300);
      // Wait for the card to be fully expanded
      await expect(whereWhenContent).toBeVisible();
      await page.waitForTimeout(200);
    }

    // Verify card is expanded and save button is enabled
    await expect(whereWhenContent).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // Wait a bit for the button to be fully rendered
    await page.waitForTimeout(200);

    // Click save button to collapse the card
    await saveButton.click({ force: true });

    // Wait for the card to collapse
    await expect(whereWhenContent).not.toBeVisible();
    await expect(whereWhenMinimized).toBeVisible();

    // Reset button should be hidden when card is collapsed
    const resetButton = page.locator("#resetButton");
    await expect(resetButton).toHaveClass(/hidden/);
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

  test("should show no options when budget is insufficient for required metered parking during enforcement", async ({
    page,
  }) => {
    // Test: Friday at 6:00 PM (18:00), parking enforced until 7pm, budget is $2
    // Required cost: 1 hour until 7pm = $4.00 (metered parking rates vary)
    // User budget: $2, which is insufficient
    // No free street parking available within 0.5 miles
    await page.goto("/#modes=drive&day=friday&time=600&pay=2&walk=0.5");
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
    await page.goto("/#modes=drive&day=friday&time=600&walk=0.2&pay=9");
    await page.waitForSelector("#results");
    await page.waitForTimeout(500);

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
    const results = page.locator("#results");
    await expect(results).toContainText("city parking garage");
    await expect(results).not.toContainText("surface lot");
    await expect(results).not.toContainText("affordable surface lot");
  });
});
