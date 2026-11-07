import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, sendRoomMessage } from '../helpers/matrix';
import { expectRoomCompact } from '../helpers/roomViewSwitch';
import { onWebKitPage } from '../helpers/webkit';

// Jump to Time > Beginning opens the room's first events in the Classic view. The first press of
// Jump to Latest after that must bring the newest message to the bottom: it stayed in the history
// window, with Jump to Latest still shown and no receipts sent, until a second press (live-test
// finding P2-lane4-F012). Checked on a desktop in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, on a phone in WebKit, against the disposable homeserver of
// `just hs-up` (or a slot of scripts/e2e-slot.sh). Set JUMP_LATEST_SHOTS=<directory> for
// screenshots.
const PASSWORD = 'jump-time-then-latest-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.JUMP_LATEST_SHOTS;
const FIRST_NOTE = 'First entry in the release log';
/** More than the client loads ahead (one sync and one page of 200), as in a long room. */
const NOTES = 240;

test.use({ viewport: { width: 1440, height: 900 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const note = (index: number) =>
  `Release log ${index}: build ${
    1000 + index
  } passed the smoke tests and went to the staging ring.`;

const firstJumpReachesLatest = async (page: Page, label: string, phone: boolean) => {
  const reader = await registerDisposableUser(`jtl_reader_${label}_${RUN}`, PASSWORD);
  const colleague = await registerDisposableUser(`jtl_colleague_${label}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Release log ${label}`,
    invite: [colleague.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  const send = (body: string) =>
    sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, { msgtype: 'm.text', body });
  await send(FIRST_NOTE);
  for (let index = 0; index < NOTES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(note(index));
  }

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const newest = page.getByText(note(NOTES - 1), { exact: true });
  await expect(newest).toBeVisible({ timeout: 60_000 });

  const header = page.getByRole('banner').filter({ has: page.locator('h1') });
  await header.getByRole('button', { name: 'More Options' }).click();
  await page.getByRole('menuitem', { name: 'Jump to Time' }).click();
  const dialog = page.getByRole('dialog', { name: 'Jump to Time' });
  await dialog.getByRole('button', { name: 'Beginning' }).click();
  await dialog.getByRole('button', { name: 'Open Timeline' }).click();
  await expect(dialog).toBeHidden();
  await expectRoomCompact(page, false);
  await expect(page.getByText(FIRST_NOTE, { exact: true })).toBeInViewport({ timeout: 60_000 });
  // The reader looks at the beginning for a moment, as people do.
  await page.waitForTimeout(3_500);

  const jump = page.getByText('Jump to Latest', { exact: true });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(newest, 'the newest message after one press').toBeInViewport({ timeout: 15_000 });
  await expect(jump, 'Jump to Latest after one press').toHaveCount(0, { timeout: 10_000 });
  // The view rests at the live end: nothing hands it back to the history window.
  await page.waitForTimeout(2_000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/jump-latest-${label}.png` });
  await expect(newest).toBeInViewport();
  await expect(jump).toHaveCount(0);
  if (phone) await expect(page.getByText(FIRST_NOTE, { exact: true })).not.toBeInViewport();
};

test('the first Jump to Latest after Jump to Time reaches the newest message (Chromium)', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await firstJumpReachesLatest(page, 'chromium', false);
});

test('the first Jump to Latest after Jump to Time reaches the newest message (WebKit phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  await onWebKitPage(
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL },
    (page) => firstJumpReachesLatest(page, 'webkit', true)
  );
});
