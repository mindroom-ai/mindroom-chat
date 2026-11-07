import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, sendRoomMessage } from '../helpers/matrix';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. Its "Show example cover"
// button under the room header covers the conversation with "Example cover of <room name>", which
// Escape closes. While the cover shows, the reader's client sends no read receipt for a message
// that arrives, no typing notice (and ends the one it sent), attaches no dropped file, and keeps
// the focus out of the conversation; closing it gives the focus back and restores all four. Set
// PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'conversation-cover-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Cover room';
const SEEDED = 'The first message of the cover room';
const DROPPED = 'cover-drop.txt';

test.use({ viewport: { width: 1280, height: 800 } });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-cover-build-'));
  const result = spawnSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: PLUGIN },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `the build with the plugin failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const shot = async (page: Page, name: string) => {
  const directory = process.env.PLUGIN_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

/** The read receipts and typing notices the page sends, as they go out. */
const recordActivity = (page: Page) => {
  const receipts: string[] = [];
  const typing: boolean[] = [];
  page.on('request', (request) => {
    const url = decodeURIComponent(request.url());
    const receipt = /\/receipt\/[^/]+\/([^/?]+)/.exec(url);
    if (receipt?.[1]) receipts.push(receipt[1]);
    if (/\/typing\//.test(url) && request.method() === 'PUT') {
      typing.push((request.postDataJSON() as { typing: boolean }).typing);
    }
  });
  return { receipts, typing };
};

/** Drags a file over `target` and drops it there, as the system's file manager would. */
const dropFile = (target: Locator) =>
  target.evaluate((element, name) => {
    const data = new DataTransfer();
    data.items.add(new File(['dropped'], name, { type: 'text/plain' }));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      element.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
      );
    }
  }, DROPPED);

/** Whether the focus is in the cover, and not in the conversation it hides. */
const focusInCover = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    return !!active?.closest('[data-conversation-cover]') && !active.closest('[inert]');
  });

test('while the example cover shows the room sends no receipt or typing notice, takes no dropped file and keeps the focus; closing it restores all four', async ({
  browser,
}) => {
  const reader = await registerDisposableUser(`cover_reader_${RUN}`, PASSWORD);
  const writer: DisposableUser = await registerDisposableUser(`cover_writer_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: SEEDED,
  });

  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect(page.getByText(SEEDED)).toBeVisible({ timeout: 60_000 });
    const activity = recordActivity(page);
    // Under the cover the composer is hidden from assistive technology, so its role is too.
    const composer = page.getByRole('textbox', { name: 'Send a message...', includeHidden: true });
    const cover = page.locator('[data-conversation-cover]');
    const opener = page.getByRole('button', { name: 'Show example cover' });

    // Typing in the composer tells the room; the cover showing ends that.
    await composer.click();
    await page.keyboard.type('draft');
    await expect.poll(() => activity.typing).toEqual([true]);
    await opener.click();
    await expect(cover).toContainText(`Example cover of ${ROOM_NAME}`);
    await expect.poll(() => activity.typing).toEqual([true, false]);
    await expect.poll(() => focusInCover(page)).toBe(true);
    await shot(page, 'conversation-cover');

    // A message that arrives under the cover gets no receipt.
    const hidden = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Arrived under the cover ${RUN}`,
    });
    await expect(page.getByText(`Arrived under the cover ${RUN}`)).toBeAttached({
      timeout: 60_000,
    });
    // Typing in the cover, and Tab through it, neither tells the room nor reaches the conversation.
    await page.getByRole('textbox', { name: 'Example cover note' }).fill('a note');
    await page.keyboard.type(' more');
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => !!document.activeElement?.closest('[inert]')),
        'the focus stays out of the hidden conversation'
      ).toBe(false);
    }
    await cover.getByRole('heading').click();
    expect(await focusInCover(page)).toBe(true);
    // A file dropped on the cover is not attached.
    await dropFile(cover);
    // A receipt goes out on the next frame after a message arrives: give it a few.
    await page.waitForTimeout(2_000);
    expect(activity.receipts).not.toContain(hidden);
    expect(activity.typing).toEqual([true, false]);
    await expect(page.getByText(DROPPED)).toHaveCount(0);
    await expect(composer).toHaveText('draft');

    // Escape closes it: the focus goes back to its button and the message under it is read.
    await page.keyboard.press('Escape');
    await expect(cover).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect.poll(() => activity.receipts).toContain(hidden);
    const seen = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Arrived in view ${RUN}`,
    });
    await expect(page.getByText(`Arrived in view ${RUN}`)).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => activity.receipts).toContain(seen);
    await composer.click();
    await page.keyboard.type(' again');
    await expect.poll(() => activity.typing).toEqual([true, false, true]);
    await dropFile(page.locator('[data-room-footer]'));
    await expect(page.getByText(DROPPED)).toBeVisible();
    await shot(page, 'conversation-cover-closed');
  } finally {
    await context.close();
    await server.close();
  }
});
