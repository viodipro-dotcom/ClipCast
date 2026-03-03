import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  // Electron + a fixed Vite port + shared local app data do not behave well with parallel workers.
  // Keep E2E deterministic by running serially.
  workers: 1,
  use: {
    trace: 'on-first-retry',
  },
});
