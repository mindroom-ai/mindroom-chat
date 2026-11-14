import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A message's hover toolbar belongs to a pointer that hovers. On a touch screen a tap on a Compact
// card opens the thread, whose root row then lies under the finger; WebKit hovers that row with
// its emulated mouse, and the toolbar opened there and stayed. A tap on another message then
// opened a second one. On a phone (390 by 844, touch) a navigating tap leaves no toolbar, a tap on
// a message shows only that message's, and a tap on blank space leaves none. Checked in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// TAP_TOOLBAR_SHOTS=<directory> to save the thread after each step.
const PASSWORD = 'thread-tap-hover-toolbar-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.TAP_TOOLBAR_SHOTS;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

test.use(PHONE);

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const REPLIES = [
  'The vendor sent the signed order form this morning, so procurement can close the ticket.',
  'Thanks!',
  'I moved the kickoff call to Thursday at 10:00 so the regional leads can join.',
] as const;

/** The message toolbars on screen, by the reaction button only they have. */
const toolbars = (page: Page) =>
  page.getByRole('button', { name: 'Add Reaction', exact: true }).filter({ visible: true });

const tapLeavesNoToolbar = async (page: Page, label: string) => {
  const reader = await registerDisposableUser(`tht_reader_${label}_${RUN}`, PASSWORD);
  const colleague = await registerDisposableUser(`tht_colleague_${label}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Vendor desk ${label}`,
    invite: [colleague.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Vendor onboarding for the new office: contract, kickoff call and access badges.',
  });
  for (const body of REPLIES) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
      msgtype: 'm.text',
      body,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const card = page.locator(`[data-thread-root-id="${rootId}"]`).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const box = await card.boundingBox();
  if (!box) throw new Error('the thread card has no box');
  // Low on the card, where the thread's root row will lie once it opens.
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 12);
  await expect(page.getByText(REPLIES[2]).first()).toBeVisible({ timeout: 30_000 });
  // Long enough for the emulated mouse that follows a tap, and for a toolbar to show.
  await page.waitForTimeout(1_500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tap-toolbar-${label}-opened.png` });
  await expect(toolbars(page), 'toolbars after the navigating tap').toHaveCount(0);

  // A tap on a message shows its toolbar, and only its own.
  const thanks = page.getByText('Thanks!', { exact: true }).first();
  const thanksBox = await thanks.boundingBox();
  if (!thanksBox) throw new Error('the reply has no box');
  await page.touchscreen.tap(thanksBox.x + 4, thanksBox.y + thanksBox.height / 2);
  await page.waitForTimeout(800);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tap-toolbar-${label}-message.png` });
  await expect(toolbars(page), 'toolbars after a tap on a message').toHaveCount(1);

  // A tap on blank space below the messages leaves none.
  await page.touchscreen.tap(195, 640);
  await page.waitForTimeout(800);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/tap-toolbar-${label}-blank.png` });
  await expect(toolbars(page), 'toolbars after a tap on blank space').toHaveCount(0);
};

test('a navigating tap leaves no message toolbar on a phone (Chromium)', async ({ page }) => {
  test.setTimeout(180_000);
  await tapLeavesNoToolbar(page, 'chromium');
});

test('a navigating tap leaves no message toolbar on a phone (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ ...PHONE, baseURL }, (page) => tapLeavesNoToolbar(page, 'webkit'));
});
