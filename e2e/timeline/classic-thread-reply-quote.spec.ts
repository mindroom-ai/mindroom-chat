import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// The Classic view shows thread replies in the room's own timeline. Each one quotes its thread's
// root above it, the root's author and the start of its text, as MindRoom Chat shows them, so a
// reader can tell which thread the reply belongs to; a click on the quote opens the thread. Set
// CLASSIC_QUOTE_SHOTS=<directory> to save each view.
const PASSWORD = 'classic-thread-reply-quote-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.CLASSIC_QUOTE_SHOTS;

const ROOT =
  'Here is the summary of the incident: the cache warmed slowly after the restart, latency ' +
  'peaked at 2.1 s for about six minutes, and no data was lost.';
const REPLY = 'I can take the flaky test, it looks like a timing issue in the fixture.';
const CHATTER = [
  'Morning all. The staging deploy finished at 08:40 and the smoke tests are green.',
  'Can someone take a look at the flaky upload test? It failed twice overnight on the same step.',
  'I moved the design review to Thursday afternoon so the new mockups are ready in time.',
  'The customer call went well. They want the export feature before the end of the quarter.',
  'Reminder: the office is closed on Friday, so plan your handovers today.',
  'Thanks, that is really helpful.',
  'I will pair on the migration script this afternoon.',
  'Does anyone know where the latest brand guidelines live? The link in the wiki is broken.',
  'Budget numbers for next quarter are in the shared sheet. Please add your line items.',
  'Quick heads up: the API rate limit for the partner integration is now 600 per minute.',
];
const OTHER_ROOMS = Array.from({ length: 24 }, (_, index) => `Project room ${index + 1}`);

type Account = MatrixSession & { username: string };
type Seed = { reader: Account; roomId: string; rootId: string; replyId: string };

const register = async (name: string, displayName: string): Promise<Account> => {
  const username = `ctrq_${name}_${RUN}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

/**
 * A people room: chatter, then a root by the writer, the reader's thread reply to it further
 * down, and more chatter below, so the reply does not sit under its root.
 */
const seed = async (engine: string): Promise<Seed> => {
  const reader = await register(`reader_${engine}`, 'Sam Lee');
  const writer = await register(`writer_${engine}`, 'Robin Park');
  const roomId = await createPrivateRoom(HOMESERVER, writer.accessToken, {
    name: 'Team Chat',
    topic: 'Day to day coordination',
    invite: [reader.userId],
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  await Promise.all(
    OTHER_ROOMS.map((name) =>
      createPrivateRoom(HOMESERVER, reader.accessToken, { name, topic: `${name} notes` })
    )
  );
  const say = (account: Account, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, account.accessToken, roomId, content);
  const text = (body: string) => ({ msgtype: 'm.text', body });
  for (const [index, body] of CHATTER.slice(0, 4).entries()) {
    // One at a time, so they keep their order.
    // eslint-disable-next-line no-await-in-loop
    await say(index % 2 === 0 ? writer : reader, text(body));
  }
  const rootId = await say(writer, text(ROOT));
  await say(writer, text(CHATTER[4]!));
  const replyId = await say(reader, {
    ...text(REPLY),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  for (const [index, body] of CHATTER.slice(5).entries()) {
    // eslint-disable-next-line no-await-in-loop
    await say(index % 2 === 0 ? writer : reader, text(body));
  }
  return { reader, roomId, rootId, replyId };
};

const check = async (
  browser: Browser,
  options: BrowserContextOptions,
  baseURL: string | undefined,
  name: string
) => {
  const { reader, roomId, rootId, replyId } = await seed(name);
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({ page, roomId, userId: reader.userId, viewMode: 'classic' });
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);

    const reply = page.locator(`[data-message-id="${replyId}"]`);
    await expect(reply).toContainText(REPLY, { timeout: 60_000 });
    await reply.scrollIntoViewIfNeeded();
    // The reply quotes its thread's root: the author and the start of the text.
    const quote = reply.locator(`button[data-event-id="${rootId}"]`);
    await expect(quote).toBeVisible();
    await expect(quote).toContainText('Robin Park');
    await expect(quote).toContainText('Here is the summary of the incident');
    // One line, inside the message column.
    const [quoteBox, replyBox] = [await quote.boundingBox(), await reply.boundingBox()];
    expect(quoteBox!.height).toBeLessThan(32);
    expect(quoteBox!.x + quoteBox!.width).toBeLessThanOrEqual(replyBox!.x + replyBox!.width + 1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });

    // The quote opens the thread.
    await quote.click();
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get('threadId')).toBe(rootId);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-thread.png` });

    // The thread's back button leads to the thread's room: it is "Back".
    const back = page.locator('[data-thread-context-banner] button').first();
    if (!options.isMobile) {
      await back.hover();
      await expect(page.getByRole('tooltip')).toBeVisible();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-back.png` });
    }
    await expect(back).toHaveAccessibleName('Back');
  } finally {
    await context.close();
  }
};

const DESKTOP: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
  colorScheme: 'light',
};
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  colorScheme: 'dark',
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeAll(() => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(180_000);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`a Classic thread reply quotes its root and opens the thread (Chromium, ${form})`, async ({
    browser,
    baseURL,
  }) => {
    await check(browser, options, baseURL, `chromium-${form}`);
  });

  test(`a Classic thread reply quotes its root and opens the thread (WebKit, ${form})`, async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
    const browser = await launchWebKit();
    try {
      await check(browser, options, baseURL, `webkit-${form}`);
    } finally {
      await browser.close();
    }
  });
}
