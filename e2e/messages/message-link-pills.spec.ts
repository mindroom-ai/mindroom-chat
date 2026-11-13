import {
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch, sendRoomMessage, type MatrixSession, loginToMatrix } from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// A link to a message (a matrix.to permalink, or the app's own link) whose text is the link
// itself reads as a pill naming where it leads: "Thread in #room" for a thread the client knows,
// "Message in #room" for another message, "Message in another room" for a room the reader is not
// in. The URL stays the pill's title. A link with text of its own keeps it. A pill fits on one
// line of the message and opens the message in the same tab. In a plain room
// (messages sent through the API) and an encrypted one (sent from the browser), on a desktop
// (1280 by 800) and a phone (390 by 844, touch), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. The reader has 26 rooms.
// Set MESSAGE_LINK_SHOTS=<directory> to save a screenshot of each room.
const PASSWORD = 'message-link-pills-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.MESSAGE_LINK_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const TARGET_ROOM = 'Harbor operations';
const THREAD_ROOT = 'Crane maintenance plan for next week, details in this thread.';
const THREAD_REPLY = 'The spare parts for crane two arrive on Tuesday morning.';
const NOTICE = 'Berth four is closed for dredging until the end of the month.';

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const register = async (username: string, displayname: string): Promise<MatrixSession> => {
  const session = await registerDisposableUser(username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname }),
  });
  return session;
};

const matrixTo = (roomId: string, eventId: string) =>
  `https://matrix.to/#/${roomId}/${eventId}?via=localhost`;

type Seeded = {
  username: string;
  sourceRoomId: string;
  targetRoomId: string;
  root: string;
  notice: string;
  /** A message in a room the reader is not in. */
  elsewhere: { roomId: string; eventId: string };
};

/**
 * The reader with 24 other rooms, the target room with a thread and a plain message, the room the
 * links are posted in (encrypted or not), and a room of someone else's.
 */
const seed = async (name: string, encrypted: boolean): Promise<Seeded> => {
  const username = `mlp_${name}_${RUN}`;
  const reader = await register(username, 'Harbor Coordinator');
  const stranger = await register(`mlp_${name}_other_${RUN}`, 'Quay Planner');
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const targetRoomId = await createRoom(HOMESERVER, reader.accessToken, { name: TARGET_ROOM });
  const send = (roomId: string, content: Record<string, unknown>, session = reader) =>
    sendRoomMessage(HOMESERVER, session.accessToken, roomId, content);
  const root = await send(targetRoomId, { msgtype: 'm.text', body: THREAD_ROOT });
  await send(targetRoomId, {
    msgtype: 'm.text',
    body: THREAD_REPLY,
    'm.relates_to': { rel_type: 'm.thread', event_id: root, is_falling_back: true },
  });
  const notice = await send(targetRoomId, { msgtype: 'm.text', body: NOTICE });
  const strangerRoom = await createRoom(HOMESERVER, stranger.accessToken, { name: 'Private' });
  const strangerEvent = await send(
    strangerRoom,
    { msgtype: 'm.text', body: 'Not for the reader.' },
    stranger
  );
  const sourceRoomId = (
    await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: reader.accessToken,
      body: JSON.stringify({
        name: 'Shift notes',
        preset: 'private_chat',
        initial_state: encrypted
          ? [
              {
                type: 'm.room.encryption',
                state_key: '',
                content: { algorithm: 'm.megolm.v1.aes-sha2' },
              },
            ]
          : [],
      }),
    })
  ).room_id;
  return {
    username,
    sourceRoomId,
    targetRoomId,
    root,
    notice,
    elsewhere: { roomId: strangerRoom, eventId: strangerEvent },
  };
};

/** The posted messages: what each says around its link, the link, and what the link reads as. */
const postings = (seeded: Seeded, origin: string) =>
  [
    {
      before: 'The crane plan is here:',
      href: matrixTo(seeded.targetRoomId, seeded.root),
      reads: `Thread in #${TARGET_ROOM}`,
    },
    {
      before: 'Dredging notice:',
      // The app's own link to a message, as Copy Link makes it.
      href: `${origin}/${encodeURIComponent(seeded.targetRoomId)}/${encodeURIComponent(
        seeded.notice
      )}?via=localhost`,
      reads: `Message in #${TARGET_ROOM}`,
    },
    {
      before: 'Someone else wrote:',
      href: matrixTo(seeded.elsewhere.roomId, seeded.elsewhere.eventId),
      reads: 'Message in another room',
    },
  ] as const;

const messageRow = (page: Page, text: string) =>
  page.locator('[data-message-id^="$"]').filter({ hasText: text }).last();

/** The pill's box, the message row's box, and the text of the row a reader sees. */
const measure = (link: Locator) =>
  link.evaluate((anchor) => {
    const row = anchor.closest('[data-message-id]')!;
    const box = anchor.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(anchor).lineHeight) || 24;
    return {
      lines: anchor.getClientRects().length,
      height: box.height,
      lineHeight,
      inside: box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1,
      rowText: (row as HTMLElement).innerText,
    };
  });

const shoot = async (page: Page, testInfo: TestInfo, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/message-link-pills-${name}.png` });
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
};

const check = async (
  page: Page,
  engine: string,
  form: 'desktop' | 'phone',
  encrypted: boolean,
  testInfo: TestInfo
) => {
  const kind = encrypted ? 'encrypted' : 'plain';
  const seeded = await seed(`${engine}_${form}_${kind[0]}`, encrypted);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });
  const origin = new URL(page.url()).origin;
  const posts = postings(seeded, origin);
  const sourcePath = `/home/${encodeURIComponent(seeded.sourceRoomId)}`;
  await page.goto(sourcePath);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  if (encrypted) {
    // Sent from the browser, so this device holds the room keys.
    for (const post of posts) {
      // eslint-disable-next-line no-await-in-loop
      await composer.click();
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.insertText(`${post.before} ${post.href}`);
      if (form === 'phone') {
        // eslint-disable-next-line no-await-in-loop
        await page.getByRole('button', { name: 'Send message' }).click();
      } else {
        // eslint-disable-next-line no-await-in-loop
        await page.keyboard.press('Enter');
      }
      // eslint-disable-next-line no-await-in-loop
      await expect(messageRow(page, post.before)).toBeVisible({ timeout: 60_000 });
    }
  } else {
    const reader = await loginToMatrix(HOMESERVER, seeded.username, PASSWORD);
    for (const post of posts) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(HOMESERVER, reader.accessToken, seeded.sourceRoomId, {
        msgtype: 'm.text',
        body: `${post.before} ${post.href}`,
      });
    }
    // A link with a text of its own keeps it.
    const own = posts[1].href;
    await sendRoomMessage(HOMESERVER, reader.accessToken, seeded.sourceRoomId, {
      msgtype: 'm.text',
      body: `Read the dredging notice: ${own}`,
      format: 'org.matrix.custom.html',
      formatted_body: `Read <a href="${own}">the dredging notice</a> first.`,
    });
    await expect(messageRow(page, 'the dredging notice')).toBeVisible({ timeout: 60_000 });
    await expect(
      messageRow(page, 'the dredging notice').getByRole('link', { name: 'the dredging notice' })
    ).toHaveAttribute('href', own);
  }

  const where = `${engine}, ${form}, ${kind}`;
  for (const post of posts) {
    const row = messageRow(page, post.before);
    // eslint-disable-next-line no-await-in-loop
    await expect(row, `${post.before} (${where})`).toBeVisible({ timeout: 60_000 });
    const link = row.locator(`a[data-mention-event-id]`);
    // eslint-disable-next-line no-await-in-loop
    await expect(link, `${post.before} reads as a pill (${where})`).toHaveText(post.reads, {
      timeout: 30_000,
    });
    // eslint-disable-next-line no-await-in-loop
    await expect(link).toHaveAttribute('title', post.href);
    // eslint-disable-next-line no-await-in-loop
    const box = await measure(link);
    expect(box.rowText, `the URL is not shown (${where})`).not.toContain(post.href);
    expect(box.rowText).not.toContain('matrix.to');
    expect(box.lines, `the pill takes one line (${where})`).toBe(1);
    expect(box.inside, `the pill stays inside its message (${where})`).toBe(true);
  }
  await shoot(page, testInfo, `${engine}-${form}-${kind}`);

  // The thread link opens its room at the thread's first message, in the same tab.
  const threadLink = messageRow(page, posts[0].before).locator('a[data-mention-event-id]');
  if (form === 'phone') await threadLink.tap();
  else await threadLink.click();
  await expect
    .poll(() => decodeURIComponent(page.url()), { timeout: 30_000 })
    .toContain(seeded.root);
  expect(decodeURIComponent(page.url())).toContain(seeded.targetRoomId);
  await expect(page.locator(`[data-message-id="${seeded.root}"]`)).toBeVisible({
    timeout: 30_000,
  });
  expect(page.context().pages()).toHaveLength(1);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(form, () => {
    test.use(options);
    for (const encrypted of [false, true]) {
      const title = `links to messages read as pills naming their room (${
        encrypted ? 'encrypted' : 'plain'
      } room`;

      test(`${title}, Chromium, ${form})`, async ({ page }, testInfo) => {
        test.setTimeout(240_000);
        await check(page, 'chromium', form, encrypted, testInfo);
      });

      test(`${title}, WebKit, ${form})`, async ({ baseURL }, testInfo) => {
        test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
        test.setTimeout(240_000);
        // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
        const browser = await launchWebKit();
        try {
          const context = await browser.newContext({ ...options, baseURL });
          await check(await context.newPage(), 'webkit', form, encrypted, testInfo);
        } finally {
          await browser.close();
        }
      });
    }
  });
}
