import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';

// Privacy & security while its session list loads: the list is a card with a spinner, right after
// the section in front of it. That section is no heading and keeps its own type and edges; the
// headings keep the 15 px semibold section heading style before and after the list arrives.
// Checked in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'settings-loading-heading-spec-password';
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const DESKTOP = { width: 1280, height: 800 };

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

type Look = { text: string; fontSize: string; fontWeight: string; paddingInlineStart: string };

const lookOf = (locator: Locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element): Look => {
      const style = getComputedStyle(element);
      return {
        text: (element.textContent ?? '').trim().slice(0, 40),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        paddingInlineStart: style.paddingInlineStart,
      };
    })
  );

const HEADING = { fontSize: '15px', fontWeight: '600', paddingInlineStart: '16px' };

const exercise = async (page: Page) => {
  await page.setViewportSize(DESKTOP);
  const username = `loadhead_${Date.now().toString(36)}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });

  // Hold the session list until the loading state is measured.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_matrix\/client\/v3\/devices$/, async (route) => {
    await held;
    await route.continue();
  });

  await chooseFromAccountMenu(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'Privacy & security', exact: true })
    .click();
  await expect(dialog.getByText('Blocked users', { exact: true })).toBeVisible();

  // The loading card is the only card straight in the page's column.
  const column = page.locator('[data-settings-page] > *');
  const loadingCard = column.locator(':scope > [data-sequence-card]');
  await expect(loadingCard).toHaveCount(1);
  const before = await lookOf(column.locator(':scope > :has(+ [data-sequence-card])'));
  expect(before).toHaveLength(1);
  // The section in front of the loading card is not a heading.
  expect(before[0]?.fontSize).not.toBe(HEADING.fontSize);
  expect(before[0]?.fontWeight).not.toBe(HEADING.fontWeight);
  expect(before[0]?.paddingInlineStart).toBe('0px');
  // The page's headings keep the heading style.
  const heading = (name: string) =>
    lookOf(dialog.locator('[data-settings-page]').getByText(name, { exact: true }).first());
  for (const name of ['Privacy', 'Blocked users']) {
    expect((await heading(name))[0], name).toMatchObject(HEADING);
  }

  release();
  await expect(loadingCard).toHaveCount(0);
  await expect(dialog.getByText('Current session', { exact: true })).toBeVisible();
  expect((await heading('Current session'))[0]).toMatchObject(HEADING);
};

test('a section in front of a loading card keeps its own style', async ({ page }) => {
  test.skip(!(await homeserverIsUp()), `homeserver ${HOMESERVER} is not running`);
  await exercise(page);
});

test('a section in front of a loading card keeps its own style (WebKit)', async () => {
  test.skip(!(await homeserverIsUp()), `homeserver ${HOMESERVER} is not running`);
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    const page = await browser.newPage({ baseURL: test.info().project.use.baseURL });
    await exercise(page);
  } finally {
    await browser.close();
  }
});
