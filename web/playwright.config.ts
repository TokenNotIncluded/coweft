import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'tests', fullyParallel: true, workers: process.env.CI ? 2 : undefined,
  timeout: 30000, expect: { timeout: 8000 },
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.COWEFT_TEST_CHROMIUM } },
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});
