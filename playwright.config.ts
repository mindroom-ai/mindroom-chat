import { defineConfig, devices } from '@playwright/test';

// The Vite dev server (`just dev`) listens here; see server in vite.config.js.
const baseURL = 'http://127.0.0.1:4200';

/**
 * Playwright runs the specs in e2e/ in the Chromium from `CHROMIUM_PATH` (exported by
 * `nix develop`) against the dev server, which Playwright starts when nothing listens yet.
 * An already running server is reused, so start it with `MINDROOM_E2E_PROVISIONING_URL`
 * set to its own origin, or stop it, when a spec needs the provisioning stub.
 *
 * The specs read environment variables, listed in e2e/global-setup.ts. Without
 * `E2E_USERNAME`, global-setup.ts points them at the disposable homeserver of `just hs-up`.
 */
const playwrightConfig = defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The specs share a few accounts, so run them one after the other (override with --workers).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      // The dev server answers /config.json with this origin as the provisioning service.
      MINDROOM_E2E_PROVISIONING_URL: new URL(baseURL).origin,
    },
  },
});

export { playwrightConfig };
export default playwrightConfig;
