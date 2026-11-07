import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { previewBuildDir, serveBuild } from '../helpers/staticBuildServer';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { putPhoneDrawerAway } from '../helpers/phoneDrawer';

// A deployment replaces one build with the next while the app is open, with the service worker on
// (the production default). The commit's preview build is the first; the spec builds the same tree
// again with another version as the second, so the two differ as two deployments do: version.json,
// the worker, index.html and the chunks that carry the version. An open page must offer the new
// version within the five-minute check, a page the first build's worker serves after the
// deployment must offer it at once, and Reload must land on the second build. Chromium on a
// desktop and WebKit on a phone, against the disposable homeserver.
const PASSWORD = 'new-version-two-builds-password';
const RUN = Date.now().toString(36);
const FIRST = previewBuildDir();

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });
test.describe.configure({ mode: 'serial' });

const versionOf = (build: string): string =>
  (JSON.parse(readFileSync(join(build, 'version.json'), 'utf8')) as { version: string }).version;

/** The entry script index.html loads, which names the build by its content hash. */
const entryOf = (build: string): string => {
  const entry = /<script type="module"[^>]*\ssrc="([^"]+)"/.exec(
    readFileSync(join(build, 'index.html'), 'utf8')
  )?.[1];
  if (!entry) throw new Error(`no entry script in ${build}/index.html`);
  return entry;
};

let second: string | undefined;

test.beforeAll(async () => {
  if (!FIRST || !(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  second = mkdtempSync(join(tmpdir(), 'mindroom-second-build-'));
  const build = spawnSync('npx', ['vite', 'build', '--outDir', second, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_BUILD_VERSION: `${versionOf(FIRST)}-next` },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (build.status !== 0) {
    throw new Error(`the second build failed:\n${(build.stderr || build.stdout).slice(-3000)}`);
  }
});

test.afterAll(() => {
  if (second) rmSync(second, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.skip(!FIRST, 'Needs the production build of scripts/e2e-slot.sh --preview');
});

const notice = (page: Page) => page.locator('[data-new-version-card]');
const announcement = (page: Page) => page.getByText('A new version of MindRoom is available.');

/** The build the page runs, by its entry script; empty while the page navigates. */
const runningEntry = (page: Page) =>
  page
    .evaluate(
      () => document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? ''
    )
    .catch(() => '');

/** The script URL of the worker that controls the page; empty while the page navigates. */
const controllerScript = (page: Page) =>
  page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '').catch(() => '');

/** The script URL of the registration's waiting worker; empty when none waits. */
const waitingScript = (page: Page) =>
  page
    .evaluate(
      async () => (await navigator.serviceWorker.getRegistration('/'))?.waiting?.scriptURL ?? ''
    )
    .catch(() => '');

const shot = async (page: Page, name: string) => {
  const directory = process.env.NEW_VERSION_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

/** Serves the first build, then `deploy()` puts the second in its place. */
const withDeployment = async (
  run: (origin: string, deploy: () => void) => Promise<void>
): Promise<void> => {
  let served = FIRST!;
  const server = await serveBuild(() => served);
  try {
    await run(server.origin, () => {
      served = second!;
    });
  } finally {
    await server.close();
  }
};

/** Signs a new account in on the first build and waits until its worker controls the page. */
const signInOnFirstBuild = async (page: Page, name: string) => {
  const user = await registerDisposableUser(`twobuilds_${name}_${RUN}`, PASSWORD);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await expect
    .poll(() => controllerScript(page), { timeout: 60_000 })
    .toContain(`version=${encodeURIComponent(versionOf(FIRST!))}`);
  expect(await runningEntry(page)).toBe(entryOf(FIRST!));
};

/** Reload from the notice lands on the second build, under its worker, and says nothing more. */
const reloadsIntoSecondBuild = async (page: Page) => {
  await notice(page).getByRole('button', { name: 'Reload', exact: true }).click();
  await expect.poll(() => runningEntry(page), { timeout: 60_000 }).toBe(entryOf(second!));
  await expect
    .poll(() => controllerScript(page), { timeout: 60_000 })
    .toContain(`version=${encodeURIComponent(versionOf(second!))}`);
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2_000);
  await expect(announcement(page)).toHaveCount(0);
  // A plain reload stays on it.
  await page.reload();
  await expect.poll(() => runningEntry(page), { timeout: 60_000 }).toBe(entryOf(second!));
};

const longOpenTab = async (page: Page, name: string, deploy: () => void) => {
  await page.clock.install();
  await signInOnFirstBuild(page, name);
  await putPhoneDrawerAway(page);
  await expect(announcement(page)).toHaveCount(0);
  deploy();
  // Nothing tells the page; only its five-minute check can.
  await page.clock.fastForward('05:05');
  await expect(announcement(page)).toBeVisible({ timeout: 30_000 });
  // The second build's worker waits for Reload: it takes over at once only from another app's
  // worker, and the first build's worker says it is this client's.
  await expect
    .poll(() => waitingScript(page), { timeout: 60_000 })
    .toContain(`version=${encodeURIComponent(versionOf(second!))}`);
  await page.waitForTimeout(2_000);
  expect(await controllerScript(page)).toContain(
    `version=${encodeURIComponent(versionOf(FIRST!))}`
  );
  await shot(page, `long-open-${name}`);
  await reloadsIntoSecondBuild(page);
};

const reloadAfterDeployment = async (page: Page, name: string, deploy: () => void) => {
  await signInOnFirstBuild(page, name);
  deploy();
  // A reload (a discarded tab coming back, an app relaunched) is answered by the first build's
  // worker with the first build.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(await runningEntry(page)).toBe(entryOf(FIRST!));
  await putPhoneDrawerAway(page);
  await expect(announcement(page)).toBeVisible({ timeout: 15_000 });
  await shot(page, `reload-${name}`);
  await reloadsIntoSecondBuild(page);
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

test('a long-open tab offers the next build within five minutes and reloads into it (Chromium)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await withDeployment(async (origin, deploy) => {
    const context = await browser.newContext({ baseURL: origin });
    try {
      await longOpenTab(await context.newPage(), 'chromium-open', deploy);
    } finally {
      await context.close();
    }
  });
});

test('a page the previous worker serves after a deployment offers the next build at once (Chromium)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await withDeployment(async (origin, deploy) => {
    const context = await browser.newContext({ baseURL: origin });
    try {
      await reloadAfterDeployment(await context.newPage(), 'chromium-reload', deploy);
    } finally {
      await context.close();
    }
  });
});

test('a page the previous worker serves after a deployment offers the next build at once (WebKit phone)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await withDeployment((origin, deploy) =>
    onWebKitPhone(origin, (page) => reloadAfterDeployment(page, 'webkit-reload', deploy))
  );
});

test('a long-open tab offers the next build within five minutes (WebKit phone)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await withDeployment((origin, deploy) =>
    onWebKitPhone(origin, (page) => longOpenTab(page, 'webkit-open', deploy))
  );
});
