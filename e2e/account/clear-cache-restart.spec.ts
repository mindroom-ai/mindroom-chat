import { writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { recordStartFailures } from '../helpers/startFailures';
import { previewBuildDir, serveBuild } from '../helpers/staticBuildServer';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Settings, Storage & offline, Clear Cache & Reload, done again and again with the service worker
// on (L7-F016): every reload must end in the same room with the account started, never on
// "Failed to start account ... WebAssembly compilation aborted", not even for a moment, and no
// download of the crypto wasm may fail, the page's or the service worker's. The reload unregisters
// the worker, so a new one installs, and its precache downloads the wasm while the page does. The
// build is served as a static deployment serves it (e2e/helpers/staticBuildServer.ts): `vite
// preview` compresses the wasm, which hides the failure. The run writes the page's console and
// the wasm downloads to `console-<browser>.txt` in its output directory. Runs in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver and the production build of scripts/e2e-slot.sh --preview.
const PASSWORD = 'clear-cache-restart-password';
const RUN = Date.now().toString(36);
const ROUNDS = 6;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** Logs the page's console and the wasm downloads; answers the wasm downloads that failed. */
const recordConsole = (page: Page, lines: string[]): string[] => {
  const started = Date.now();
  const wasmFailures: string[] = [];
  // Who downloads the crypto wasm and when: the page, or the service worker's precache.
  const context = page.context();
  const wasm = (event: string) => (request: Request) => {
    if (!request.url().endsWith('.wasm')) return;
    const from = request.serviceWorker() ? 'worker' : 'page';
    const failure = request.failure()?.errorText ?? '';
    lines.push(`${Date.now() - started} ms wasm ${event} by ${from} ${failure}`);
    if (event === 'failed') wasmFailures.push(`${from}: ${failure}`);
  };
  context.on('request', wasm('request'));
  context.on('requestfinished', wasm('finished'));
  context.on('requestfailed', wasm('failed'));
  page.on('console', (message) => {
    lines.push(`${Date.now() - started} ms ${message.type()}: ${message.text().slice(0, 400)}`);
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame())
      lines.push(`${Date.now() - started} ms navigated ${frame.url()}`);
  });
  return wasmFailures;
};

const clearCacheAgainAndAgain = async (context: BrowserContext, browserName: string) => {
  const failures = await recordStartFailures(context);
  const user = await registerDisposableUser(`ccr_${browserName}_${RUN}`, PASSWORD);
  const roomName = `Cache desk ${browserName} ${RUN}`;
  const room = await createRoom(HOMESERVER, user.accessToken, { name: roomName });
  const page = await context.newPage();
  const lines: string[] = [];
  const wasmFailures = recordConsole(page, lines);
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
    const roomPath = `/home/${encodeURIComponent(room)}`;
    await page.goto(roomPath);
    const composer = page.locator('[data-editable-name="RoomInput"]');
    await expect(composer).toBeVisible({ timeout: 30_000 });

    for (let round = 1; round <= ROUNDS; round += 1) {
      lines.push(`round ${round}`);
      // eslint-disable-next-line no-await-in-loop
      await chooseFromAccountMenu(page, 'Settings');
      // eslint-disable-next-line no-await-in-loop
      await page.getByRole('button', { name: 'Storage & offline', exact: true }).click();
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([
        page.waitForURL((url) => url.searchParams.has('clear_cache'), { timeout: 60_000 }),
        page.getByRole('button', { name: 'Clear Cache', exact: true }).click(),
      ]);
      // Back in the room the account had open, started.
      // eslint-disable-next-line no-await-in-loop
      await expect(composer.or(page.getByText(/Failed to start account/))).toBeVisible({
        timeout: 60_000,
      });
      expect(failures, `round ${round}`).toEqual([]);
      // eslint-disable-next-line no-await-in-loop
      await expect(composer).toBeVisible();
      // eslint-disable-next-line no-await-in-loop
      await expect(page.getByText(roomName, { exact: true }).first()).toBeVisible();
      // A failure right after the room showed, or a recovery reload, needs a moment to show.
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(3_000);
      expect(failures, `after round ${round}`).toEqual([]);
      expect(wasmFailures, `round ${round}`).toEqual([]);
    }
  } finally {
    writeFileSync(test.info().outputPath(`console-${browserName}.txt`), lines.join('\n'));
  }
};

const withStaticBuild = async (run: (origin: string) => Promise<void>) => {
  const directory = previewBuildDir();
  test.skip(!directory, 'Needs the production build of scripts/e2e-slot.sh --preview');
  const server = await serveBuild(directory!);
  try {
    await run(server.origin);
  } finally {
    await server.close();
  }
};

test('Clear Cache & Reload starts the account again every time (Chromium)', async ({
  browser,
  browserName,
}) => {
  test.setTimeout(420_000);
  await withStaticBuild(async (origin) => {
    const context = await browser.newContext({ baseURL: origin });
    try {
      await clearCacheAgainAndAgain(context, browserName);
    } finally {
      await context.close();
    }
  });
});

test('Clear Cache & Reload starts the account again every time (WebKit)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(420_000);
  await withStaticBuild((origin) =>
    onWebKitPage(
      { viewport: { width: 1280, height: 800 }, baseURL: origin, serviceWorkers: 'allow' },
      (page) => clearCacheAgainAndAgain(page.context(), 'webkit')
    )
  );
});
