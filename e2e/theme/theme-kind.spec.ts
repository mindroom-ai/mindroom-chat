import { expect, test, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// The root element says whether the applied theme is light or dark (`data-theme-kind`), from
// before the app first renders, and code that subscribes with `subscribeAppliedTheme` hears each
// theme once it is on the page. Settings switch between a fixed Light and Dark theme and the
// system's, whose preference the browser emulates. The spec loads the theme module from the dev
// server, so it shares the app's instance (scripts/e2e-suite.sh runs specs that import /src/ on
// the dev server).
const APPLIED_THEME_MODULE = '/src/app/theme/appliedTheme.ts';
const PASSWORD = 'theme-kind-spec-password';
const RUN = Date.now().toString(36);

type Heard = { kind: string; onRoot: string | null; themeClass: string | undefined };
type Recorded = { themeKindMarks?: string[]; heardThemes?: Heard[] };

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/**
 * Before any app script runs, notes in order each change of `data-theme-kind` and the app's first
 * render into #root.
 */
const recordStartup = (page: Page) =>
  page.addInitScript(() => {
    const marks: string[] = [];
    Object.assign(window, { themeKindMarks: marks });
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          marks.push('theme kind');
        } else if ((record.target as Element).id === 'root' && record.addedNodes.length > 0) {
          marks.push('first render');
          observer.disconnect();
          return;
        }
      }
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributeFilter: ['data-theme-kind'],
    });
  });

/** Subscribes in the page; each theme heard is kept with the root element as it was then. */
const subscribe = (page: Page) =>
  page.evaluate(async (path) => {
    const { subscribeAppliedTheme } = (await import(
      path
    )) as typeof import('../../src/app/theme/appliedTheme');
    const heard: Heard[] = [];
    Object.assign(window, { heardThemes: heard });
    subscribeAppliedTheme((kind) => {
      const root = document.documentElement;
      heard.push({
        kind,
        onRoot: root.getAttribute('data-theme-kind'),
        themeClass: [...root.classList].find((name) => name.endsWith('-theme')),
      });
    });
  }, APPLIED_THEME_MODULE);

const heardThemes = (page: Page) =>
  page.evaluate(() => (window as unknown as Recorded).heardThemes);

const LIGHT: Heard = { kind: 'light', onRoot: 'light', themeClass: 'light-theme' };
const DARK: Heard = { kind: 'dark', onRoot: 'dark', themeClass: 'dark-theme' };

test('the root element names the theme kind, and subscribers hear each theme once it is on the page', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await recordStartup(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  const user = await registerDisposableUser(`theme_kind_${RUN}`, PASSWORD);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });

  // The startup theme, the system's, marked the root element before the app first rendered.
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme-kind', 'dark');
  expect(await page.evaluate(() => (window as unknown as Recorded).themeKindMarks)).toEqual([
    'theme kind',
    'first render',
  ]);

  await subscribe(page);
  await chooseFromAccountMenu(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'Appearance', exact: true })
    .click();
  const systemTheme = dialog.locator('[data-setting-id="systemTheme"]').getByRole('switch');

  // System theme off: the fixed theme, Light until another is picked.
  await systemTheme.click();
  await expect(root).toHaveAttribute('data-theme-kind', 'light');
  await expect.poll(() => heardThemes(page)).toEqual([LIGHT]);

  await dialog.locator('[data-setting-id="theme"]').getByRole('button').click();
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme-kind', 'dark');
  await expect.poll(() => heardThemes(page)).toEqual([LIGHT, DARK]);

  // The system turns light while the fixed theme holds; following it again applies Light.
  await page.emulateMedia({ colorScheme: 'light' });
  await systemTheme.click();
  await expect(root).toHaveAttribute('data-theme-kind', 'light');
  await expect.poll(() => heardThemes(page)).toEqual([LIGHT, DARK, LIGHT]);

  // The system turning dark again is followed without a touch.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme-kind', 'dark');
  await expect.poll(() => heardThemes(page)).toEqual([LIGHT, DARK, LIGHT, DARK]);
});
