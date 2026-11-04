import { defineConfig, devices } from '@playwright/test';

// The Vite dev server listens here: port 4200 (see server in vite.config.js), or E2E_APP_PORT,
// which scripts/e2e-slot.sh sets so that several runs can share one machine. E2E_PORT wins over
// both: scripts/appstore-screenshots.sh picks a free port there, with its own E2E_SERVER_COMMAND
// and E2E_REUSE_EXISTING_SERVER=0, so a capture never runs against an older server.
const appPort = process.env.E2E_PORT ?? process.env.E2E_APP_PORT ?? '4200';
const baseURL = `http://127.0.0.1:${appPort}`;

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
      // Chromium runs sandboxed frames in their own process. Playwright then misses a frame that
      // such a frame creates while it loads, as an agent canvas's wrapper does with the page
      // inside it, so specs could not reach the canvas. The sandbox attributes still apply.
      args: ['--disable-features=IsolateSandboxedIframes'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env.E2E_SERVER_COMMAND ?? `npx vite --port ${appPort}`,
    url: baseURL,
    reuseExistingServer: process.env.E2E_REUSE_EXISTING_SERVER !== '0',
    timeout: 120_000,
    env: {
      // The dev server answers /config.json with this origin as the provisioning service.
      MINDROOM_E2E_PROVISIONING_URL: new URL(baseURL).origin,
    },
  },
});

export { playwrightConfig };
export default playwrightConfig;
