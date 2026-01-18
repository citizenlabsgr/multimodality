const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  fullyParallel: true,
  workers: "100%",
  use: {
    baseURL: "http://localhost:8081",
    actionTimeout: 5000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npx --yes http-server . --port=8081",
    url: "http://localhost:8081",
  },
});
