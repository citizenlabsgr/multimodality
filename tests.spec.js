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

  test("should recommend premium ramp when arriving on weekend with higher budget", async ({
    page,
  }) => {
    // Set up: drive mode, willing to pay $20, willing to walk 0.5 miles, arriving Saturday at 6:00 PM
    await page.goto(
      `${BASE_URL}#modes=drive&day=saturday&time=600&walk=0.5&pay=20`,
    );
    await page.waitForTimeout(500);

    // Check that the recommendation is for premium ramp (since user is willing to pay $20+)
    const resultsText = await page.locator("#results").textContent();
    expect(resultsText).toContain("premium ramp");
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
});
