import { expect, test, type Page } from '@playwright/test';
import type { ComputerClipboardFixture } from './fixtures/computer-clipboard';

const CONTROL_L_KEYSYM = 0xffe3;
const V_KEYSYM = 0x76;

// Playwright maps both clipboard permissions for Chromium, only clipboard-read for WebKit,
// and none for Firefox ("Unknown permission").
const CLIPBOARD_PERMISSIONS: Record<string, string[]> = {
  chromium: ['clipboard-read', 'clipboard-write'],
  webkit: ['clipboard-read'],
};

test.use({
  permissions: async ({ browserName }, use) => use(CLIPBOARD_PERMISSIONS[browserName] ?? []),
});

const recorded = (page: Page) =>
  page.evaluate((): Omit<ComputerClipboardFixture, 'sendRemoteClipboard'> => {
    const { calls, noVncKeys, pastes } = window.__rfb;
    return { calls, noVncKeys, pastes };
  });

const sendRemoteClipboard = (page: Page, text: string) =>
  page.evaluate((value) => window.__rfb.sendRemoteClipboard(value), text);

// A native copy and paste in a textarea reach the clipboard the same way in every engine,
// unlike navigator.clipboard under Playwright.
const localText = (page: Page) => page.getByRole('textbox', { name: 'Local text' });

const copyLocally = async (page: Page, text: string) => {
  await localText(page).fill(text);
  await localText(page).selectText();
  await page.keyboard.press('ControlOrMeta+c');
};

const readLocalClipboard = async (page: Page) => {
  await localText(page).fill('');
  await page.keyboard.press('ControlOrMeta+v');
  return localText(page).inputValue();
};

const openScreen = async (page: Page, mode: 'view' | 'control') => {
  await page.goto(`/e2e/fixtures/computer-clipboard.html?mode=${mode}`);
  await expect(page.locator('canvas')).toBeVisible();
};

test('pastes the local clipboard into the computer while in control', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'WebKit fires no paste on the screen, and the readText() it uses instead gets NotAllowedError under Playwright'
  );
  await openScreen(page, 'control');
  await copyLocally(page, 'local text');

  await page.locator('canvas').click();
  await page.keyboard.press('ControlOrMeta+v');

  await expect
    .poll(async () => (await recorded(page)).calls)
    .toEqual([
      ['paste', 'local text'],
      // The left Ctrl noVNC holds, pressed again so it cannot arrive after the v.
      ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
      ['key', V_KEYSYM, 'KeyV', true],
      ['key', V_KEYSYM, 'KeyV', false],
    ]);
  const { noVncKeys, pastes } = await recorded(page);
  expect(noVncKeys).toEqual(['down ControlLeft', 'up ControlLeft']);
  expect(pastes).toEqual(['sent']);
  await expect(localText(page)).toHaveValue('local text');
});

test('copies the computer clipboard after the copy shortcut while in control', async ({ page }) => {
  await openScreen(page, 'control');
  await copyLocally(page, 'stale text');

  await page.locator('canvas').click();
  await page.keyboard.press('ControlOrMeta+c');
  // The shortcut still reaches the computer, whose app then copies.
  expect((await recorded(page)).noVncKeys).toEqual([
    'down ControlLeft',
    'down KeyC',
    'up KeyC',
    'up ControlLeft',
  ]);
  await sendRemoteClipboard(page, 'remote text');

  await expect.poll(() => readLocalClipboard(page)).toBe('remote text');
});

test('pastes only the keys for the text a computer copy wrote', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit fires no paste on the screen');
  await openScreen(page, 'control');

  await page.locator('canvas').click();
  await page.keyboard.press('ControlOrMeta+c');
  await sendRemoteClipboard(page, 'remote text');
  await expect.poll(() => readLocalClipboard(page)).toBe('remote text');

  await page.locator('canvas').click();
  await page.keyboard.press('ControlOrMeta+v');

  // The computer already holds this text, and may have copied newer text since.
  await expect.poll(async () => (await recorded(page)).pastes).toEqual(['sent']);
  expect((await recorded(page)).calls).toEqual([
    ['key', CONTROL_L_KEYSYM, 'ControlLeft', true],
    ['key', V_KEYSYM, 'KeyV', true],
    ['key', V_KEYSYM, 'KeyV', false],
  ]);
});

test('keeps the local clipboard from a computer push without a copy shortcut', async ({ page }) => {
  await openScreen(page, 'control');
  await copyLocally(page, 'local text');

  // The click gives the page a user activation, so only the bridge's gate stops a write.
  await page.locator('canvas').click();
  await sendRemoteClipboard(page, 'pushed text');

  expect(await readLocalClipboard(page)).toBe('local text');
});

test('hands focus to the canvas on Tab and on a letterbox click while in control', async ({
  page,
}) => {
  await openScreen(page, 'control');
  const canvas = page.locator('canvas');

  await page.getByRole('button', { name: 'Before' }).focus();
  await page.keyboard.press('Tab');
  await expect(canvas).toBeFocused();

  await page.getByRole('button', { name: 'Before' }).focus();
  await page.getByRole('application', { name: 'Agent computer' }).click({
    position: { x: 4, y: 4 },
  });
  await expect(canvas).toBeFocused();
});

test('Tab and Shift+Tab move past the screen while watching', async ({ page }) => {
  await openScreen(page, 'view');
  const before = page.getByRole('button', { name: 'Before' });
  const screen = page.getByRole('application', { name: 'Agent computer' });
  const after = page.getByRole('button', { name: 'After' });

  await before.focus();
  await page.keyboard.press('Tab');
  await expect(screen).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(after).toBeFocused();

  // From the canvas, which a click on the screen focuses.
  await page.locator('canvas').click();
  await page.keyboard.press('Shift+Tab');
  await expect(screen).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(before).toBeFocused();
});
