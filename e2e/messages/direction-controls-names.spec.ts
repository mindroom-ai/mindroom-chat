import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C) change the
// order text shows in without showing themselves. A mention suggestion, the mention it inserts in
// the composer and a profile name a member as the room does: without the controls, beside the user
// ID. A mention label a message being edited already holds, and a ban's reason, show each control
// as its code point. Against the disposable homeserver of a slot, on a phone (390 by 844, touch)
// and a desktop (1280 by 800), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Set DIRECTION_NAMES_SHOTS=<directory> to save each view.
const PASSWORD = 'direction-names-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DIRECTION_NAMES_SHOTS;
const ROOM_NAME = 'Review Desk';
const FILLER_ROOMS = 24;
const HISTORY = 24;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

// matrix-js-sdk drops U+202E from a member's name; the U+202C after it stays.
const MEMBER_NAME = 'Quinn \u202erelyat\u202c';
const MEMBER_SHOWN = 'Quinn relyat';
const UNKNOWN_USER = '@ops\u202enimda:example.org';
const UNKNOWN_LABEL = '@ops\u202enimda';
const UNKNOWN_LABEL_SHOWN = '@ops<U+202E>nimda';
const BAN_REASON = 'Posted a \u202ekcilc\u202c link';
const BAN_REASON_SHOWN = 'Posted a <U+202E>kcilc<U+202C> link';

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string, displayName: string): Promise<Account> => {
  const username = `bidi_${name}_${RUN}`;
  const session = await registerDisposableUser(username, PASSWORD);
  // Set before joining, so each membership carries the name.
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
  return session;
};

type World = { reader: Account; member: Account; offender: Account; roomId: string };

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(`reader_${engine}`, 'Robin Reader');
  const member = await registerAndLogin(`member_${engine}`, MEMBER_NAME);
  const offender = await registerAndLogin(`offender_${engine}`, 'Drew Ashby');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [member.userId, offender.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await joinRoom(HOMESERVER, offender.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Review room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromMember = index % 2 === 0;
    await sendRoomMessage(HOMESERVER, (fromMember ? member : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromMember
        ? `Note ${index}: the review notes for this week are filed with the summaries.`
        : `Note ${index}: anything left to review before the weekly summary goes out?`,
    });
  }
  await sendRoomMessage(HOMESERVER, offender.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Free prizes for everyone in this room, follow the link.',
  });
  await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/ban`, {
    method: 'POST',
    accessToken: reader.accessToken,
    body: JSON.stringify({ user_id: offender.userId, reason: BAN_REASON }),
  });
  // The reader's last message, so Arrow Up edits it: a mention whose label holds controls.
  await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: `${UNKNOWN_LABEL} please check the summary.`,
    format: 'org.matrix.custom.html',
    formatted_body: `<a href="https://matrix.to/#/${encodeURIComponent(
      UNKNOWN_USER
    )}">${UNKNOWN_LABEL}</a> please check the summary.`,
  });
  return { reader, member, offender, roomId };
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The scope shows `shown` and holds no direction control. */
const expectShown = async (scope: Locator, shown: string) => {
  await expect(scope).toContainText(shown, { timeout: 30_000 });
  expect(await scope.textContent()).not.toMatch(CONTROL);
};

/** Opens the profile card of `userId` from the name on their last message. */
const openProfile = async (page: Page, userId: string) => {
  const name = page.locator(`[data-message-id] button[data-user-id="${userId}"]`).last();
  await name.scrollIntoViewIfNeeded();
  await name.click();
};

const check = async (page: Page, world: World, label: string) => {
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    world.roomId
  );
  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('please check the summary.').first()).toBeVisible({
    timeout: 30_000,
  });

  // Editing the last message: its mention keeps the label the message sent, controls shown.
  await composer.click();
  await composer.press('ArrowUp');
  const editor = page.locator('[data-editable-name="MessageEditor"]');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expectShown(editor.locator('[data-editor-inline="mention"]'), UNKNOWN_LABEL_SHOWN);
  await shot(page, `${label}-edit-chip`);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);

  // A mention suggestion and the pill it inserts name the member without the controls.
  await composer.click();
  await composer.pressSequentially('@Quinn');
  const suggestion = page.getByRole('option', { name: /Quinn/ });
  await expectShown(suggestion, MEMBER_SHOWN);
  await expect(suggestion).toContainText(world.member.userId);
  await shot(page, `${label}-suggestion`);
  await suggestion.click();
  const chip = composer.locator('[data-editor-inline="mention"]');
  await expect(chip).toHaveText(`@${MEMBER_SHOWN}`, { timeout: 15_000 });
  expect(await chip.textContent()).not.toMatch(CONTROL);
  await shot(page, `${label}-composer-chip`);

  // The member's profile names them the same way, with the user ID under the name.
  await openProfile(page, world.member.userId);
  const heading = page.getByRole('heading', { level: 2, name: MEMBER_SHOWN, exact: true });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  expect(await heading.textContent()).not.toMatch(CONTROL);
  await shot(page, `${label}-profile`);
  await page.keyboard.press('Escape');
  await expect(heading).toBeHidden();

  // The banned member's card gives the ban's reason with the controls as code points.
  await openProfile(page, world.offender.userId);
  const moderation = page.locator('[data-user-moderation]');
  await expect(moderation.getByText('Banned User', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expectShown(moderation, `Reason: ${BAN_REASON_SHOWN}`);
  await expect(moderation).toContainText('Banned by: Robin Reader');
  await moderation.scrollIntoViewIfNeeded();
  await shot(page, `${label}-ban-reason`);
  await page.keyboard.press('Escape');
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      await check(page, world, `${engine}-${viewport}`);
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE =
  'mention suggestions, composer pills and profiles name members without direction controls; ban reasons show them as code points';

test(`${TITLE} (Chromium)`, async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
