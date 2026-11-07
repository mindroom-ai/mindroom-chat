import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { sendRoomMessage } from '../helpers/matrix';

// A letter typed while the focus is outside the composer moves the focus to the composer and
// types there. A region of the page that needs its own typing keeps its keys: one marked
// `data-keeps-typing`, and one whose handler cancels the keys it takes (`preventDefault`).
// Chromium, against the disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh).
const PASSWORD = 'type-to-compose-spec-password';
const RUN = Date.now().toString(36);
const MESSAGE = 'The shed gets its second coat of paint on Saturday.';

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** Signs a new account in and opens its room, which holds one message. */
const openRoom = async (page: Page, name: string) => {
  const user = await registerDisposableUser(`type_to_compose_${name}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, user.accessToken, { name: 'Garden Shed' });
  await sendRoomMessage(HOMESERVER, user.accessToken, roomId, { msgtype: 'm.text', body: MESSAGE });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const message = page.getByText(MESSAGE, { exact: true });
  await expect(message).toBeVisible({ timeout: 30_000 });
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible();
  return { composer, message };
};

/** The composer's text, without the placeholder an empty composer shows. */
const composerText = (composer: Locator) =>
  composer.evaluate((element) =>
    Array.from(element.querySelectorAll('[data-slate-string]'), (node) => node.textContent).join('')
  );

/**
 * Adds a focusable region over the room that writes each key it gets into itself, as a terminal
 * or a game would take them: marked to keep its typing, or cancelling each key it takes.
 */
const addRegion = async (page: Page, name: string, takesKeys: 'marked' | 'cancels') => {
  await page.evaluate(
    ([label, how]) => {
      const region = document.createElement('div');
      region.tabIndex = 0;
      region.setAttribute('role', 'application');
      region.setAttribute('aria-label', label);
      if (how === 'marked') region.setAttribute('data-keeps-typing', '');
      region.style.cssText =
        'position: fixed; top: 120px; left: 480px; width: 320px; height: 80px; z-index: 1000;' +
        ' background: white; color: black; border: 2px solid black; font: 20px monospace;';
      region.addEventListener('keydown', (event) => {
        region.textContent += event.key;
        if (how === 'cancels') event.preventDefault();
      });
      document.body.append(region);
    },
    [name, takesKeys] as const
  );
  return page.getByRole('application', { name });
};

test('a region marked data-keeps-typing keeps the keys typed in it', async ({ page }, testInfo) => {
  const { composer } = await openRoom(page, 'marked');
  const terminal = await addRegion(page, 'Terminal', 'marked');
  await terminal.click();
  await page.keyboard.type('ls', { delay: 50 });
  await page.screenshot({ path: testInfo.outputPath('marked-region.png') });
  await expect(terminal).toHaveText('ls');
  await expect(terminal).toBeFocused();
  expect(await composerText(composer)).toBe('');
});

test('a key that a handler cancels stays where it was typed', async ({ page }, testInfo) => {
  const { composer } = await openRoom(page, 'cancels');
  const game = await addRegion(page, 'Game', 'cancels');
  await game.click();
  await page.keyboard.type('wasd', { delay: 50 });
  await page.screenshot({ path: testInfo.outputPath('cancelling-handler.png') });
  await expect(game).toHaveText('wasd');
  await expect(game).toBeFocused();
  expect(await composerText(composer)).toBe('');
});

test('a letter typed on the timeline starts a message in the composer', async ({
  page,
}, testInfo) => {
  const { composer, message } = await openRoom(page, 'timeline');
  await message.click();
  await page.keyboard.type('hello', { delay: 50 });
  await page.screenshot({ path: testInfo.outputPath('timeline.png') });
  await expect(composer).toBeFocused();
  await expect.poll(() => composerText(composer)).toBe('hello');
});
