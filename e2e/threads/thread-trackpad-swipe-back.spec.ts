import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';

// On a Mac, a two-finger swipe to the right over an open thread goes back to its room: the
// thread's own history entry is the one the browser steps back over. Chrome starts that swipe only
// when the horizontal scroll reaches the page itself and the page leaves it to the browser: a
// scroll container with `overscroll-behavior-x` other than `auto` under the pointer keeps the
// scroll to itself, and the page's own value (the body's, here) other than `auto` turns the swipe
// off. Playwright cannot make the trackpad gesture that starts the browser's swipe, so the spec
// checks both conditions at every point of a desktop window, then steps back as the swipe does.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'thread-trackpad-swipe-back-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const text = (body: string) => ({ msgtype: 'm.text', body });

/** Elements under a grid of points whose overscroll-behavior-x keeps a horizontal swipe. */
const swipeBlockers = (page: Page) =>
  page.evaluate(() => {
    const blockers = new Map<string, string>();
    for (let x = 10; x < window.innerWidth; x += 40) {
      for (let y = 10; y < window.innerHeight; y += 40) {
        for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
          const value = getComputedStyle(el).overscrollBehaviorX;
          if (value === 'auto') continue;
          const name = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} (${value})`;
          if (!blockers.has(name)) blockers.set(name, `at ${x},${y}`);
        }
      }
    }
    return [...blockers].map(([name, point]) => `${name} ${point}`);
  });

const place = (page: Page) => {
  const url = new URL(page.url());
  const room = url.pathname
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .find((segment) => segment.startsWith('!'));
  return { room: room ?? null, thread: url.searchParams.get('threadId') };
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('a trackpad swipe over an open thread is left to the browser, which goes back to the room', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const username = `swipe_${RUN}`;
  const reader = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  // The room has an agent, as MindRoom rooms do, so it opens in Compact with its thread cards.
  const agent = await registerAgentAccount(HOMESERVER, `swp${RUN.slice(-5)}`);
  const room = await createPrivateRoom(HOMESERVER, reader.access_token, {
    name: 'Garden Club',
    topic: 'Garden Club notes',
    invite: [agent.userId],
  });
  const say = (content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, reader.access_token, room, content, 'thread-trackpad-swipe-back');
  const root = await say(text('Seed order for spring: tomatoes, beans and two kinds of squash.'));
  // Enough replies that the thread's timeline scrolls, as a long thread's does.
  for (let reply = 1; reply <= 20; reply += 1) {
    await say({
      ...text(`Reply ${reply}: marigolds for the border, the old packets failed, and more seed.`),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: root,
        is_falling_back: true,
        'm.in_reply_to': { event_id: root },
      },
    });
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  try {
    // The slot has no provisioning service.
    await page.route('**/v1/local-mindroom/connections', (route) =>
      route.fulfill({ json: { connections: [] } })
    );
    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
    await page.goto('/home/');
    await page.getByTestId('resizable-page-nav').getByRole('link', { name: 'Garden Club' }).click();
    await expect.poll(() => place(page)).toEqual({ room, thread: null });
    await page.locator(`button[data-thread-root-id="${root}"]`).first().click();
    await expect.poll(() => place(page)).toEqual({ room, thread: root });
    await expect(page.getByText('Reply 20:')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('thread.png') });

    expect(
      await page.evaluate(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches),
      'the window is a desktop one, with a trackpad or mouse'
    ).toBe(true);
    expect(await swipeBlockers(page), 'nothing under the pointer keeps the swipe').toEqual([]);
    expect(
      await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY),
      'the page still does not bounce up and down'
    ).toBe('none');

    // The browser's swipe steps back one history entry: the thread's, to its room.
    await page.goBack();
    await expect.poll(() => place(page)).toEqual({ room, thread: null });
  } finally {
    await context.close();
  }
});
