import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { previewBuildDir, serveBuild } from '../helpers/staticBuildServer';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A language catalog (public/locales/<code>.json) keeps its name from one build to the next, and
// a deployment may let browsers keep everything under public/ for a year: MindRoom's client chart
// sent `immutable` for it. A browser that loaded one build there kept its catalogs, and after the
// next deployment showed that build's translations, or none for a string the next build added. No
// header the deployment sends later reaches those copies; the page has to ask by another URL.
// The commit's preview build is the first build; the spec builds the tree again with another
// version and a changed German string as the second, and serves both with public/ cached that way.
const PASSWORD = 'locale-after-deployment-password';
const RUN = Date.now().toString(36);
const FIRST = previewBuildDir();
const HOME = 'Startseite';
const NEXT_HOME = 'Startseite der nächsten Version';

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });
test.describe.configure({ mode: 'serial' });

const versionOf = (build: string): string =>
  (JSON.parse(readFileSync(join(build, 'version.json'), 'utf8')) as { version: string }).version;

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
  second = mkdtempSync(join(tmpdir(), 'mindroom-locale-build-'));
  const build = spawnSync('npx', ['vite', 'build', '--outDir', second, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_BUILD_VERSION: `${versionOf(FIRST)}-locale` },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (build.status !== 0) {
    throw new Error(`the second build failed:\n${(build.stderr || build.stdout).slice(-3000)}`);
  }
  const catalogFile = join(second, 'public/locales/de.json');
  const catalog = JSON.parse(readFileSync(catalogFile, 'utf8')) as { nav: { home: string } };
  expect(catalog.nav.home).toBe(HOME);
  catalog.nav.home = NEXT_HOME;
  writeFileSync(catalogFile, JSON.stringify(catalog));
});

test.afterAll(() => {
  if (second) rmSync(second, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.skip(!FIRST, 'Needs the production build of scripts/e2e-slot.sh --preview');
});

const homeTab = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

const runningEntry = (page: Page) =>
  page
    .evaluate(() => document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? '')
    .catch(() => '');

const shot = async (page: Page, name: string) => {
  const directory = process.env.LOCALE_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

/** Serves the first build with public/ cached for a year, then `deploy()` puts the second there. */
const withDeployment = async (
  run: (origin: string, deploy: () => void) => Promise<void>
): Promise<void> => {
  let served = FIRST!;
  const server = await serveBuild(() => served, {
    immutable: (path) => path.startsWith('/assets/') || path.startsWith('/public/'),
  });
  try {
    await run(server.origin, () => {
      served = second!;
    });
  } finally {
    await server.close();
  }
};

/** Signs a new account in on the first build and switches it to German. */
const germanOnFirstBuild = async (page: Page, name: string) => {
  const user = await registerDisposableUser(`localebuild_${name}_${RUN}`, PASSWORD);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await page.evaluate(() => window.localStorage.setItem('i18nextLng', 'de'));
  await page.reload();
  await expect(homeTab(page, HOME)).toBeVisible({ timeout: 60_000 });
  expect(await runningEntry(page)).toBe(entryOf(FIRST!));
};

/**
 * Without a service worker: opening the app again after the deployment, as a relaunch or a new tab
 * does, runs the second build. Chromium answers the first build's catalog from its HTTP cache
 * without the fix; Playwright's WebKit asked the server again on reload and on navigation alike, so
 * its case checks the phone layout only.
 */
const reopenWithoutWorker = async (page: Page, name: string, deploy: () => void) => {
  await germanOnFirstBuild(page, name);
  deploy();
  await page.goto(page.url());
  await expect.poll(() => runningEntry(page), { timeout: 60_000 }).toBe(entryOf(second!));
  await expect(homeTab(page, NEXT_HOME).or(homeTab(page, HOME))).toBeVisible({ timeout: 60_000 });
  await shot(page, `${name}-after-deployment`);
  await expect(homeTab(page, NEXT_HOME)).toBeVisible();
};

const noWorker: BrowserContextOptions = { serviceWorkers: 'block' };

test('opening the app after a deployment shows the new build’s translations (Chromium, no worker)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await withDeployment(async (origin, deploy) => {
    const context = await browser.newContext({ ...noWorker, baseURL: origin });
    try {
      await reopenWithoutWorker(await context.newPage(), 'chromium-plain', deploy);
    } finally {
      await context.close();
    }
  });
});

test('the new version notice reloads into the new build’s translations (Chromium, worker)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await withDeployment(async (origin, deploy) => {
    const context = await browser.newContext({ baseURL: origin });
    try {
      const page = await context.newPage();
      await germanOnFirstBuild(page, 'chromium-worker');
      await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''), {
          timeout: 60_000,
        })
        .toContain(`version=${encodeURIComponent(versionOf(FIRST!))}`);
      deploy();
      // The first build's worker answers the reload with the first build, which offers the next.
      await page.reload();
      const notice = page.locator('[data-new-version-card]');
      await notice.getByRole('button', { name: 'Neu laden', exact: true }).click({
        timeout: 60_000,
      });
      await expect.poll(() => runningEntry(page), { timeout: 60_000 }).toBe(entryOf(second!));
      await expect(homeTab(page, NEXT_HOME).or(homeTab(page, HOME))).toBeVisible({
        timeout: 60_000,
      });
      await shot(page, 'chromium-worker-after-deployment');
      await expect(homeTab(page, NEXT_HOME)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

test('opening the app after a deployment shows the new build’s translations (WebKit phone, no worker)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await withDeployment(async (origin, deploy) => {
    const webkit = await launchWebKit();
    try {
      const context = await webkit.newContext({
        ...noWorker,
        baseURL: origin,
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      await reopenWithoutWorker(await context.newPage(), 'webkit-plain', deploy);
    } finally {
      await webkit.close();
    }
  });
});
