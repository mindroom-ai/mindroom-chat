import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { sendRoomMessage } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A letter typed while the focus is outside the composer moves the focus to the composer and
// types there, and a paste (Cmd+V or Ctrl+V) pastes there: in the room, and in an open thread
// that fills the page, into the thread's composer. A region of the page that needs its own typing
// keeps its keys: one marked `data-keeps-typing`, and one whose handler cancels the keys it takes
// (`preventDefault`). Chromium, and the pastes in WebKit too when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names it, against the disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh).
const PASSWORD = 'type-to-compose-spec-password';
const RUN = Date.now().toString(36);
const MESSAGE = 'The shed gets its second coat of paint on Saturday.';

const VIEWPORT = { width: 1280, height: 800 };
const PASTED = 'Bring the green brushes too.';

test.use({ viewport: VIEWPORT });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/**
 * Signs a new account in and opens its room, which holds one message, or that message's thread,
 * which fills the page as threads do until a person shows one beside the room.
 */
const openRoom = async (page: Page, name: string, where: 'room' | 'thread' = 'room') => {
  const user = await registerDisposableUser(`type_to_compose_${name}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, user.accessToken, { name: 'Garden Shed' });
  const rootId = await sendRoomMessage(HOMESERVER, user.accessToken, roomId, {
    msgtype: 'm.text',
    body: MESSAGE,
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  const thread = where === 'thread' ? `?threadId=${encodeURIComponent(rootId)}` : '';
  await page.goto(`/home/${encodeURIComponent(roomId)}${thread}`);
  const footer = page.locator(`[data-room-footer="true"][data-footer-of="${where}"]`);
  const composer = footer.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 30_000 });
  const message = page.getByText(MESSAGE, { exact: true }).last();
  await expect(message).toBeVisible();
  return { composer, message };
};

/**
 * Puts `text` on the clipboard with a native copy from a field of its own, which reaches the
 * clipboard the same way in every engine, then takes the field away.
 */
const copyText = async (page: Page, text: string) => {
  await page.evaluate(() => {
    const field = document.createElement('textarea');
    field.setAttribute('aria-label', 'Clipboard source');
    field.style.cssText = 'position: fixed; top: 120px; left: 480px; z-index: 1000;';
    document.body.append(field);
  });
  const field = page.getByRole('textbox', { name: 'Clipboard source' });
  await field.fill(text);
  await field.selectText();
  await page.keyboard.press('ControlOrMeta+c');
  await field.evaluate((element) => element.remove());
};

/** Copies a text, clicks the message (nothing editable focused) and pastes with Cmd+V or Ctrl+V. */
const pastesIntoComposer = async (page: Page, name: string, where: 'room' | 'thread') => {
  const { composer, message } = await openRoom(page, name, where);
  await copyText(page, PASTED);
  await message.click();
  await expect(composer).not.toBeFocused();
  await page.keyboard.press('ControlOrMeta+v');
  await page.screenshot({ path: test.info().outputPath(`paste-${name}.png`) });
  await expect(composer).toBeFocused();
  await expect(composer).toHaveText(PASTED);
};

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
  await expect(composer.locator('[data-slate-string]')).toHaveCount(0);
});

test('a key that a handler cancels stays where it was typed', async ({ page }, testInfo) => {
  const { composer } = await openRoom(page, 'cancels');
  const game = await addRegion(page, 'Game', 'cancels');
  await game.click();
  await page.keyboard.type('wasd', { delay: 50 });
  await page.screenshot({ path: testInfo.outputPath('cancelling-handler.png') });
  await expect(game).toHaveText('wasd');
  await expect(game).toBeFocused();
  await expect(composer.locator('[data-slate-string]')).toHaveCount(0);
});

test('a letter typed on the timeline starts a message in the composer', async ({
  page,
}, testInfo) => {
  const { composer, message } = await openRoom(page, 'timeline');
  await message.click();
  await page.keyboard.type('hello', { delay: 50 });
  await page.screenshot({ path: testInfo.outputPath('timeline.png') });
  await expect(composer).toBeFocused();
  await expect(composer).toHaveText('hello');
});

test('a paste on the timeline goes into the composer', async ({ page }) => {
  await pastesIntoComposer(page, 'paste_room', 'room');
});

test("a paste in an open thread goes into the thread's composer", async ({ page }) => {
  await pastesIntoComposer(page, 'paste_thread', 'thread');
});

test('a pasted image is staged in the composer as a file', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { composer, message } = await openRoom(page, 'paste_image');
  // A 1x1 PNG, as a screenshot copied to the clipboard would be.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('No PNG');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  });
  await message.click();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(composer).toBeFocused();
  // The composer stages the file (its card names it) and puts no text in the draft.
  await expect(page.locator('[title="image.png"]')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: test.info().outputPath('paste-image.png') });
  await expect(composer.locator('[data-slate-string]')).toHaveCount(0);
});

for (const where of ['room', 'thread'] as const) {
  test(`a paste goes into the composer in the ${where} (WebKit)`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(180_000);
    await onWebKitPage({ viewport: VIEWPORT, baseURL }, (page) =>
      pastesIntoComposer(page, `webkit_paste_${where}`, where)
    );
  });
}
