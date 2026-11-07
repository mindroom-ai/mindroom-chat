import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { previewBuildDir, serveBuild } from '../helpers/staticBuildServer';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// The production origin switches from the legacy MindRoom Chat app to this client, and may switch
// back. Both apps are served from one origin by one static server whose files flip from one build
// to the other while a signed-in tab stays open, with the service worker on.
//
// Forward: the legacy page notices the deployment and installs this client's worker, which takes
// the page at once, so the first normal reload starts this client, still signed in.
// Rollback: this client's page offers the "new version" (the legacy build), and Reload lands on the
// legacy app once instead of reloading into this client again.
//
// The legacy app is a black box: its published build, the `/app` directory of the image
// `ghcr.io/mindroom-ai/mindroom-chat:commit-204136b`, named by E2E_LEGACY_BUILD:
//   id=$(docker create ghcr.io/mindroom-ai/mindroom-chat:commit-204136b)
//   docker cp -L "$id:/app" <dir> && docker rm "$id"
// The spec serves a copy whose config.json names the disposable homeserver. Chromium on a desktop
// and WebKit on a phone; the commit's preview build (`scripts/e2e-slot.sh --preview`) is this
// client.
const LEGACY_SOURCE = process.env.E2E_LEGACY_BUILD;
const CURRENT = previewBuildDir();
const PASSWORD = 'legacy-app-switch-password';
const RUN = Date.now().toString(36);

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

let legacy: string | undefined;

test.beforeAll(() => {
  if (!LEGACY_SOURCE || !existsSync(join(LEGACY_SOURCE, 'index.html'))) return;
  legacy = mkdtempSync(join(tmpdir(), 'mindroom-legacy-build-'));
  cpSync(LEGACY_SOURCE, legacy, { recursive: true, dereference: true });
  const configPath = join(legacy, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(
    configPath,
    JSON.stringify({ ...config, homeserverList: [HOMESERVER], defaultHomeserver: 0 })
  );
});

test.afterAll(() => {
  if (legacy) rmSync(legacy, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.skip(!CURRENT, 'Needs the production build of scripts/e2e-slot.sh --preview');
  test.skip(!legacy, 'Set E2E_LEGACY_BUILD to the legacy app build');
});

/** The entry script index.html loads, which names the build by its content hash. */
const entryOf = (build: string): string => {
  const entry = /<script type="module"[^>]*\ssrc="([^"]+)"/.exec(
    readFileSync(join(build, 'index.html'), 'utf8')
  )?.[1];
  if (!entry) throw new Error(`no entry script in ${build}/index.html`);
  return entry;
};

const versionOf = (build: string): string =>
  (JSON.parse(readFileSync(join(build, 'version.json'), 'utf8')) as { version: string }).version;

/** The build the page runs, by its entry script; empty while the page navigates. */
const runningEntry = (page: Page) =>
  page
    .evaluate(() => document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? '')
    .catch(() => '');

/** The script URL of the worker that controls the page; empty while the page navigates. */
const controllerScript = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '').catch(() => '');

/** Script URLs of the registration's waiting and active workers. */
const stagedScripts = (page: Page) =>
  page
    .evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      return [registration?.waiting?.scriptURL ?? '', registration?.active?.scriptURL ?? ''];
    })
    .catch(() => ['', '']);

const shot = async (page: Page, name: string) => {
  const directory = process.env.LEGACY_SWITCH_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

/** Serves `first`; `flip()` puts the other build in its place. */
const withSwitch = async (
  first: string,
  then: string,
  run: (origin: string, flip: () => void) => Promise<void>
): Promise<void> => {
  let served = first;
  const server = await serveBuild(() => served);
  try {
    await run(server.origin, () => {
      served = then;
    });
  } finally {
    await server.close();
  }
};

/** The legacy app's account button, which its signed-in shell shows. */
const legacyAccountButton = (page: Page, user: DisposableUser) =>
  page.getByRole('button', { name: `Open settings for ${user.username}`, exact: true });

/** Signs in through the legacy app's own login page, as a person would. */
const signInOnLegacy = async (page: Page, user: DisposableUser) => {
  await page.goto('/');
  await page.locator('input[name="usernameInput"]').fill(user.username);
  await page.locator('input[name="passwordInput"]').fill(user.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(legacyAccountButton(page, user)).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => controllerScript(page), { timeout: 60_000 }).not.toBe('');
  expect(await runningEntry(page)).toBe(entryOf(legacy!));
};

const forwardSwitch = async (page: Page, name: string, flip: () => void) => {
  const user = await registerDisposableUser(`legacyfwd_${name}_${RUN}`, PASSWORD);
  await signInOnLegacy(page, user);
  await shot(page, `forward-${name}-1-legacy`);
  flip();
  // The legacy page checks for a deployment when it is shown again, and stages the worker the
  // server now has.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const version = encodeURIComponent(versionOf(CURRENT!));
  await expect
    .poll(
      async () => (await stagedScripts(page)).some((url) => url.includes(`version=${version}`)),
      {
        timeout: 60_000,
      }
    )
    .toBe(true);
  // Give the new worker the moment it needs to take the page; without the takeover it never does.
  await page
    .waitForFunction(
      (v) => navigator.serviceWorker.controller?.scriptURL.includes(`version=${v}`),
      version,
      { timeout: 15_000 }
    )
    .catch(() => undefined);
  await page.reload();
  await expect.poll(() => runningEntry(page), { timeout: 60_000 }).not.toBe('');
  expect(await runningEntry(page), 'the first normal reload starts this client').toBe(
    entryOf(CURRENT!)
  );
  await waitForLoggedInShell(page);
  await shot(page, `forward-${name}-2-after-reload`);
  // It stays, and says nothing about another version.
  await page.reload();
  await expect.poll(() => runningEntry(page), { timeout: 60_000 }).toBe(entryOf(CURRENT!));
  await waitForLoggedInShell(page);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2_000);
  await expect(page.getByText('A new version of MindRoom is available.')).toHaveCount(0);
};

const rollback = async (page: Page, name: string, flip: () => void) => {
  const user = await registerDisposableUser(`legacyback_${name}_${RUN}`, PASSWORD);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await expect
    .poll(() => controllerScript(page), { timeout: 60_000 })
    .toContain(`version=${encodeURIComponent(versionOf(CURRENT!))}`);
  flip();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const notice = page.locator('[data-new-version-card]');
  await expect(page.getByText('A new version of MindRoom is available.')).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, `rollback-${name}-1-notice`);
  await notice.getByRole('button', { name: 'Reload', exact: true }).click();
  // Reload lands on the legacy app, not on this client with the same notice again.
  await expect
    .poll(() => runningEntry(page), { timeout: 60_000, intervals: [1_000] })
    .toBe(entryOf(legacy!));
  // Still signed in, in the legacy app.
  await expect(legacyAccountButton(page, user)).toBeVisible({ timeout: 60_000 });
  await shot(page, `rollback-${name}-2-legacy`);
  // The legacy app keeps the page through a normal reload, under its own worker.
  await page.reload();
  await expect.poll(() => runningEntry(page), { timeout: 60_000 }).toBe(entryOf(legacy!));
  await expect(legacyAccountButton(page, user)).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => controllerScript(page), { timeout: 60_000 }).not.toBe('');
};

const onWebKitPhone = async (origin: string, check: (page: Page) => Promise<void>) => {
  const webkit: Browser = await launchWebKit();
  try {
    const context = await webkit.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      serviceWorkers: 'allow',
    });
    await check(await context.newPage());
  } finally {
    await webkit.close();
  }
};

test('an open legacy tab starts this client on its first normal reload (Chromium)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await withSwitch(legacy!, CURRENT!, async (origin, flip) => {
    const context = await browser.newContext({ baseURL: origin });
    try {
      await forwardSwitch(await context.newPage(), 'chromium', flip);
    } finally {
      await context.close();
    }
  });
});

test('an open legacy tab starts this client on its first normal reload (WebKit phone)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await withSwitch(legacy!, CURRENT!, (origin, flip) =>
    onWebKitPhone(origin, (page) => forwardSwitch(page, 'webkit', flip))
  );
});

test('Reload after a rollback lands on the legacy app once (Chromium)', async ({ browser }) => {
  test.setTimeout(240_000);
  await withSwitch(CURRENT!, legacy!, async (origin, flip) => {
    const context = await browser.newContext({ baseURL: origin });
    try {
      await rollback(await context.newPage(), 'chromium', flip);
    } finally {
      await context.close();
    }
  });
});

test('Reload after a rollback lands on the legacy app once (WebKit phone)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await withSwitch(CURRENT!, legacy!, (origin, flip) =>
    onWebKitPhone(origin, (page) => rollback(page, 'webkit', flip))
  );
});
