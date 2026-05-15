const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  fullyParallel: true,
  workers: "100%",
  retries: 2,
  updateSnapshots: process.env.CI ? "none" : "changed",
  snapshotPathTemplate: "{testDir}/snapshots/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://localhost:8080",
  },
  // CI + Leaflet + data load often need >5s end-to-end; sub-steps use their own caps where needed.
  timeout: 20_000,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "make run",
    url: "http://localhost:8080",
    reuseExistingServer: true,
  },
  reporter: process.env.CI ? "line" : "dot",
});
