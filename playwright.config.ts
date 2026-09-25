import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve('.cache/ms-playwright');
const port = 3107;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'chromium', testMatch: '**/*.spec.ts', testIgnore: '**/baseline.spec.ts' },
    { name: 'baseline', testMatch: '**/baseline.spec.ts', timeout: 120_000 },
  ],
  webServer: {
    command: `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MAPIO_E2E: '1', NEXT_PUBLIC_WARSIM_DIAGNOSTICS: '1', NEXT_TELEMETRY_DISABLED: '1' },
  },
});
