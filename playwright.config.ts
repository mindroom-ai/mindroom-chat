import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { pluginDirectories } from './scripts/e2e-plugin-pages.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// The Vite dev server listens here: port 4200 (see server in vite.config.js), or E2E_APP_PORT,
// which scripts/e2e-slot.sh sets so that several runs can share one machine. E2E_PORT wins over
// both: scripts/appstore-screenshots.sh picks a free port there, with its own E2E_SERVER_COMMAND
// and E2E_REUSE_EXISTING_SERVER=0, so a capture never runs against an older server.
const appPort = process.env.E2E_PORT ?? process.env.E2E_APP_PORT ?? '4200';
const baseURL = `http://127.0.0.1:${appPort}`;

// Desktop Chrome's user agent says Windows, and so do the client hints Playwright derives from
// it. On a Mac host, though, Playwright's `ControlOrMeta` presses ⌘ and Chromium edits text with
// ⌘. So there the page says macOS, as Chrome on a Mac does, and the app (which reads the client
// hints first, src/app/lib/user-agent.ts) and Slate (the user agent) act as they do for Mac users.
const desktopChrome = devices['Desktop Chrome'];
const chromeOnHost =
  process.platform === 'darwin'
    ? {
        ...desktopChrome,
        userAgent: desktopChrome.userAgent.replace(
          /\([^)]*\)/,
          '(Macintosh; Intel Mac OS X 10_15_7)'
        ),
      }
    : desktopChrome;

// Most WebKit checks launch Playwright's WebKit themselves from a Chromium test, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names it. The few tests that must run as WebKit (a persistent WebKit
// profile, its networking process) carry the `@webkit` tag and run in this project, which exists
// only when that variable is set, so a run without it, as on Linux, has the Chromium project only.
// Select it alone with `--project=webkit`.
const webkitExecutable = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const webkitProject = webkitExecutable
  ? [
      {
        name: 'webkit',
        grep: /@webkit/,
        use: {
          ...devices['Desktop Safari'],
          launchOptions: { executablePath: webkitExecutable },
        },
      },
    ]
  : [];

// A plugin directory of E2E_PLUGIN_DIRS (scripts/e2e-plugin-pages.mjs) with specs of its own in its
// e2e/ runs them in a project named after the directory, in Chromium, as the app's own specs run:
// `--project=<directory name>` picks them (docs/development.md "A client plugin in its own repository").
const pluginProjects = pluginDirectories(process.env.E2E_PLUGIN_DIRS, ROOT).flatMap((dir) => {
  const testDir = path.join(dir, 'e2e');
  const hasSpecs =
    existsSync(testDir) &&
    readdirSync(testDir, { recursive: true }).some((file) => String(file).endsWith('.spec.ts'));
  return hasSpecs
    ? [{ name: path.basename(dir), testDir, testMatch: '**/*.spec.ts', use: { ...chromeOnHost } }]
    : [];
});

/**
 * Playwright runs the specs in e2e/ in the Chromium from `CHROMIUM_PATH` (exported by
 * `nix develop`) against the dev server, which Playwright starts when nothing listens yet.
 * An already running server is reused, so start it with `MINDROOM_E2E_PROVISIONING_URL`
 * set to its own origin, or stop it, when a spec needs the provisioning stub. The same variable
 * makes the dev server's `/config.json` switch the recovery password start prompt off, so a
 * reused server started without it opens that prompt over every fresh account.
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
  projects: [{ name: 'chromium', use: { ...chromeOnHost } }, ...webkitProject, ...pluginProjects],
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
