import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (demo-F010): the composer underlined names, numbers and file names ("Q3",
// "Fenmark", "data/run-42.csv") with the browser's red spell-check squiggles, which MindRoom
// Chat's composer does not draw. The composer and the box that edits a sent message both keep the
// browser's spell check off, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit. Set COMPOSER_SPELLCHECK_SHOTS=<directory> to save the typed composer.
const SHOTS = process.env.COMPOSER_SPELLCHECK_SHOTS;
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const SENT = 'Fenmark sent the Q3 ringdown numbers';

test.use(DESKTOP);

const seedRoom = async () => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Spell check ${Date.now().toString(36)}`,
    topic: 'Composer spell check',
  });
  await sendRoomMessage(homeserver, session.accessToken, roomId, { msgtype: 'm.text', body: SENT });
  return { homeserver, credentials, roomId };
};

const expectSpellCheckOff = async (
  page: Page,
  { homeserver, credentials, roomId }: Awaited<ReturnType<typeof seedRoom>>,
  engine: string
) => {
  await loginWithPassword(page, { homeserver, ...credentials });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByText(SENT)).toBeVisible({ timeout: 60_000 });

  const composer = page.locator('[data-editable-name="RoomInput"]');
  await composer.click();
  await page.keyboard.type('Fenmark wants the ringdown fit from data/run-42.csv for Q3');
  if (SHOTS) {
    // The browser checks the words once typing pauses.
    await page.waitForTimeout(1_000);
    await composer.screenshot({ path: `${SHOTS}/composer-${engine}.png` });
  }
  // `spellcheck` reflects what the browser does with the box: on unless the box or a parent turns it off.
  expect(await composer.evaluate((box: HTMLElement) => box.spellcheck)).toBe(false);

  // Up in an empty composer edits one's last message.
  // Clear until empty, as thread-arrow-up-edit.spec.ts does: a key can reach the editor before the
  // selection does.
  await expect(async () => {
    await composer.fill('');
    await expect(composer.locator('[data-slate-string]')).toHaveCount(0, { timeout: 1_000 });
  }).toPass();
  await page.keyboard.press('ArrowUp');
  const editBox = page.locator('[contenteditable="true"]').filter({ hasText: SENT });
  await expect(editBox).toBeFocused();
  expect(await editBox.evaluate((box: HTMLElement) => box.spellcheck)).toBe(false);
};

test('the composer and the edit box keep the browser spell check off', async ({ page }) => {
  test.skip(!hasPrimaryCredentials(), 'Requires disposable Matrix credentials.');
  await expectSpellCheckOff(page, await seedRoom(), 'chromium');
});

test('the composer and the edit box keep the browser spell check off (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!hasPrimaryCredentials(), 'Requires disposable Matrix credentials.');
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const room = await seedRoom();
  await onWebKitPage({ ...DESKTOP, baseURL }, (page) => expectSpellCheckOff(page, room, 'webkit'));
});
