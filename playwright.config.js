const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  fullyParallel: true,
  workers: "100%",
  retries: 2,
  snapshotPathTemplate: "{testDir}/snapshots/parking/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.012,
      threshold: 0.15,
    },
  },
  use: {
    baseURL: "http://localhost:8080",
  },
  timeout: 5000, // this is a static prototype so everything should be fast
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
  reporter: "dot",
});
