import { defineConfig, devices } from "@playwright/test";

// The dev server loads .env.local (MOTHERDUCK_TOKEN), which the /progress and /explore
// tests need to reach the live demo org.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: "http://localhost:3011", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- -p 3011",
    url: "http://localhost:3011",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
