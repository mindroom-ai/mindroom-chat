import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';

// Privacy & security while its session list loads: the list is a card with a spinner, right after
// the section in front of it. That section is no heading and keeps its own type and edges; the
// headings keep the 15 px semibold section heading style before and after the list arrives.
// Checked in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
// Set SETTINGS_HEADING_SHOTS=<directory> to also save the loading page and a room's General page.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'settings-loading-heading-spec-password';
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.SETTINGS_HEADING_SHOTS;
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

const browserName = (page: Page) => page.context().browser()?.browserType().name() ?? 'browser';

const HEADING = { fontSize: '15px', fontWeight: '600', paddingInlineStart: '16px' };

/** A fresh account signed in on `page`; returns its access token for setting up rooms. */
const signIn = async (page: Page, room?: string) => {
  await page.setViewportSize(DESKTOP);
  const username = `loadhead_${Date.now().toString(36)}`;
  const { access_token: accessToken } = await matrixFetch<{ access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const roomId = room
    ? await createPrivateRoom(HOMESERVER, accessToken, {
        name: room,
        topic: `${room} for the team`,
      })
    : '';
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return roomId;
};

const exercise = async (page: Page) => {
  await signIn(page);

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
  await expect(dialog.getByText('Blocked Users', { exact: true })).toBeVisible();

  // The loading card is the only card straight in the page's column.
  const content = dialog.locator('[data-settings-page]');
  const loadingCards = () =>
    content.evaluate(
      (element) =>
        [...(element.firstElementChild?.children ?? [])].filter((child) =>
          child.matches('[data-sequence-card]')
        ).length
    );
  await expect.poll(loadingCards).toBe(1);
  const before = await content.evaluate((element): Look | null => {
    const card = [...(element.firstElementChild?.children ?? [])].find((child) =>
      child.matches('[data-sequence-card]')
    );
    const section = card?.previousElementSibling;
    if (!section) return null;
    const style = getComputedStyle(section);
    return {
      text: (section.textContent ?? '').trim().slice(0, 40),
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      paddingInlineStart: style.paddingInlineStart,
    };
  });
  if (SHOTS) {
    await page.mouse.move(0, 0);
    await dialog.screenshot({ path: `${SHOTS}/privacy-loading-${browserName(page)}.png` });
  }
  // The section in front of the loading card is not a heading.
  expect(before).not.toBeNull();
  expect(before?.fontSize).not.toBe(HEADING.fontSize);
  expect(before?.fontWeight).not.toBe(HEADING.fontWeight);
  expect(before?.paddingInlineStart).toBe('0px');
  // The page's headings keep the heading style.
  const heading = (name: string) => lookOf(content.getByText(name, { exact: true }).first());
  for (const name of ['Privacy', 'Blocked Users']) {
    expect((await heading(name))[0], name).toMatchObject(HEADING);
  }

  release();
  await expect.poll(loadingCards).toBe(0);
  await expect(dialog.getByText('Current', { exact: true })).toBeVisible();
  expect((await heading('Current'))[0]).toMatchObject(HEADING);
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

test("a room's General page keeps its addresses section on the page's edges", async ({ page }) => {
  test.skip(!(await homeserverIsUp()), `homeserver ${HOMESERVER} is not running`);
  // The addresses section stands right before the offline card, a card with no heading of its own.
  const roomId = await signIn(page, 'Project room 1');
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const roomHeader = page.locator('header').filter({ hasText: 'Project room 1' });
  await roomHeader.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
  const content = page.getByRole('dialog').locator('[data-settings-page]');
  await expect(content.getByText('Published Addresses', { exact: true })).toBeVisible();
  if (SHOTS) {
    await page.mouse.move(0, 0);
    await page.getByRole('dialog').screenshot({ path: `${SHOTS}/room-general-chromium.png` });
  }
  // Every section of the page's column (a box that holds a card) starts on the column's edge.
  const sections = await content.evaluate((element) =>
    [...(element.firstElementChild?.children ?? [])]
      .filter((child) => child.querySelector('[data-sequence-card]'))
      .map((child) => ({
        text: (child.textContent ?? '').trim().slice(0, 40),
        paddingInlineStart: getComputedStyle(child).paddingInlineStart,
        fontWeight: getComputedStyle(child).fontWeight,
      }))
  );
  expect(sections.length).toBeGreaterThan(2);
  for (const section of sections) {
    expect(section, section.text).toMatchObject({ paddingInlineStart: '0px' });
    expect(section.fontWeight, section.text).not.toBe(HEADING.fontWeight);
  }
  // Its headings, Addresses among them, share one look.
  for (const name of ['Profile', 'Options', 'Addresses', 'Advanced Options']) {
    const [look] = await lookOf(content.getByText(name, { exact: true }).first());
    expect(look, name).toMatchObject(HEADING);
  }
});
