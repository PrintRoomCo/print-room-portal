import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: '../test-results',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PORTAL_E2E_BASE_URL ?? process.env.PORTAL_BASE_URL ?? 'http://localhost:3000',
    ...(process.env.PORTAL_E2E_STORAGE_STATE
      ? { storageState: process.env.PORTAL_E2E_STORAGE_STATE }
      : {}),
    headless: true,
    actionTimeout: 10_000,
    trace: 'on',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
