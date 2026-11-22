import { mkdirSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import {
  expect,
  test,
  type BrowserContextOptions,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Clicking an unjoined room alias mention link in a message opens the room's join preview page
// in-app instead of silently doing nothing. On a phone viewport, Back returns to the source room,
// and tapping Join from the preview enters the room and displays its timeline.
// Set UNJOINED_LINK_SHOTS=<directory> to save screenshots for visual verification.
const PASSWORD = 'unjoined-room-mention-link-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.UNJOINED_LINK_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const SOURCE_ROOM = 'Harbor desk';
const TARGET_ROOM = 'Field notes';
const TARGET_TOPIC = 'Weekly trail logs and weather readings from the ridge station.';
const TARGET_MESSAGE = 'North ridge barometer steady at 1014 hPa.';

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const saveShot = async (page: Page, testInfo: TestInfo, filename: string) => {
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: joinPath(SHOTS, filename) });
  }
  await testInfo.attach(filename, { body: await page.screenshot(), contentType: 'image/png' });
};

const seed = async (label: string) => {
  const owner = await registerDisposableUser(`url_${label}_owner_${RUN}`, PASSWORD);
  const username = `url_${label}_reader_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);

  const server = owner.userId.slice(owner.userId.indexOf(':') + 1);
  const aliasLocal = `field_notes_${label}_${RUN}`;
  const alias = `#${aliasLocal}:${server}`;

  const targetRoomId = (
    await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: owner.accessToken,
      body: JSON.stringify({
        name: TARGET_ROOM,
        topic: TARGET_TOPIC,
        preset: 'public_chat',
        room_alias_name: aliasLocal,
      }),
    })
  ).room_id;

  await sendRoomMessage(HOMESERVER, owner.accessToken, targetRoomId, {
    msgtype: 'm.text',
    body: TARGET_MESSAGE,
  });

  const sourceRoomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: SOURCE_ROOM,
  });

  await sendRoomMessage(HOMESERVER, reader.accessToken, sourceRoomId, {
    msgtype: 'm.text',
    body: `Check ${alias} for the latest ridge readings.`,
    format: 'org.matrix.custom.html',
    formatted_body: `Check <a href="https://matrix.to/#/${alias}">${alias}</a> for the latest ridge readings.`,
  });

  return { username, sourceRoomId, targetRoomId, alias };
};

const messageRow = (page: Page, text: string) =>
  page.locator('[data-message-id^="$"]').filter({ hasText: text }).last();

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(180_000);
});

test.describe('desktop', () => {
  test.use(DESKTOP);

  test('clicking an unjoined room alias link in a message opens the join preview page', async ({
    page,
  }, testInfo) => {
    const seeded = await seed('desktop');
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: seeded.username,
      password: PASSWORD,
    });

    const sourceRoomEntry = page.getByText(SOURCE_ROOM, { exact: true }).first();
    await expect(sourceRoomEntry).toBeVisible({ timeout: 60_000 });
    await sourceRoomEntry.click();
    const row = messageRow(page, 'latest ridge readings');
    await expect(row).toBeVisible({ timeout: 60_000 });

    const mentionLink = row.locator(`a[data-mention-id="${seeded.alias}"]`);
    await expect(mentionLink).toBeVisible();
    await saveShot(page, testInfo, 'source-desktop.png');

    await mentionLink.click();

    const joinButton = page.getByRole('button', { name: 'Join', exact: true });
    await expect(joinButton).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(TARGET_ROOM, { exact: true })).toBeVisible();
    await expect(page.getByText(TARGET_TOPIC, { exact: true })).toBeVisible();
    expect(page.context().pages()).toHaveLength(1);
    await saveShot(page, testInfo, 'preview-desktop.png');
  });
});

test.describe('phone', () => {
  test.use(PHONE);

  test('tapping an unjoined room alias link opens preview, Back returns to source, and Join enters the room', async ({
    page,
  }, testInfo) => {
    const seeded = await seed('phone');
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: seeded.username,
      password: PASSWORD,
    });

    const sourceRoomEntry = page.getByText(SOURCE_ROOM, { exact: true }).first();
    await expect(sourceRoomEntry).toBeVisible({ timeout: 60_000 });
    await sourceRoomEntry.tap();
    const row = messageRow(page, 'latest ridge readings');
    await expect(row).toBeVisible({ timeout: 60_000 });

    const mentionLink = row.locator(`a[data-mention-id="${seeded.alias}"]`);
    await expect(mentionLink).toBeVisible();
    await saveShot(page, testInfo, 'source-phone.png');

    await mentionLink.tap();

    const main = page.getByRole('main');
    const joinButton = main.getByRole('button', { name: 'Join', exact: true });
    const backButton = main.getByRole('button', { name: 'Back', exact: true });
    await expect(joinButton).toBeVisible({ timeout: 60_000 });
    await expect(main.getByText(TARGET_ROOM, { exact: true })).toBeVisible();
    await expect(main.getByText(TARGET_TOPIC, { exact: true })).toBeVisible();
    await expect(backButton).toBeVisible();
    await saveShot(page, testInfo, 'preview-phone.png');

    // Tapping Back returns to the source room where the link was tapped.
    await backButton.tap();
    await expect
      .poll(() => decodeURIComponent(new URL(page.url()).pathname), { timeout: 30_000 })
      .toContain(seeded.sourceRoomId);
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Tapping the link again and then Join enters the target room and renders its message.
    await mentionLink.tap();
    await expect(joinButton).toBeVisible({ timeout: 60_000 });
    await joinButton.tap();

    await expect(page.getByText(TARGET_MESSAGE, { exact: true })).toBeVisible({ timeout: 60_000 });
    expect(page.context().pages()).toHaveLength(1);
  });
});
