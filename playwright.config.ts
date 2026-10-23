import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/text-learning/`;

// e2e гоняются на собранном приложении (vite preview): Service Worker и precache работают как на Pages.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    locale: 'ru-RU',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    { name: 'webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
