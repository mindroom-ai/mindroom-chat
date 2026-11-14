import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

/**
 * A reader who scrolls away right after the room view went to its newest row stays where they
 * scrolled. The view goes to the newest row when a message arrives while the reader is at the
 * bottom; a second message arrives a second after the reader scrolled up. Every frame from the
 * reader's scroll until well after that message must keep them away from the bottom. A room of 60
 * messages among the account's 25 other rooms, in the Classic and Threads views, on a desktop
 * (1280 by 800, mouse wheel) and a phone (390 by 844, a finger), in Chromium and, when the runner
 * names it, WebKit, with classic scrollbars. SCROLL_AWAY_SHOTS=<directory> saves the view at the
 * end of each case.
 */

const PASSWORD = 'scroll-away-after-pin-password';
const SHOTS = process.env.SCROLL_AWAY_SHOTS;
const homeserver = getHomeserver();
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
const ROOM_NAME = 'Release coordination';

type Account = { userId: string; accessToken: string; username: string };

const register = async (prefix: string): Promise<Account> => {
  const username = `${prefix}${randomUUID().slice(0, 8)}`;
  const account = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { userId: account.user_id, accessToken: account.access_token, username };
};

const body = (index: number) =>
  `Status update ${index}: the staging deploy for build ${
    1200 + index
  } finished, the smoke tests passed, and the release notes draft is ready for review.`;

type World = { reader: Account; colleague: Account; roomId: string };

const seed = async (): Promise<World> => {
  const [reader, colleague] = await Promise.all([register('awayreader'), register('awaypeer')]);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createPrivateRoom(homeserver, reader.accessToken, {
        name: `Project ${index + 1}`,
        topic: 'Another room of the account',
      })
    )
  );
  const roomId = await createPrivateRoom(homeserver, colleague.accessToken, {
    name: ROOM_NAME,
    topic: 'Deploys and reviews',
    invite: [reader.userId],
  });
  await joinRoom(homeserver, reader.accessToken, roomId);
  for (let index = 1; index <= 60; index += 1) {
    const sender = index % 3 === 0 ? reader : colleague;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, sender.accessToken, roomId, {
      msgtype: 'm.text',
      body: body(index),
    });
  }
  return { reader, colleague, roomId };
};

/**
 * The scroll area around the room's rows, found in one evaluation: a row a locator found can leave
 * the list (its virtual window moves on as messages arrive) before a second round trip reaches it,
 * and a row out of the page has no scroll area.
 */
const scrollArea = (page: Page) =>
  page.evaluateHandle(() => {
    let node = document.querySelector('[data-message-id]')?.parentElement ?? null;
    while (node && !['auto', 'scroll'].includes(getComputedStyle(node).overflowY))
      node = node.parentElement;
    if (!node) throw new Error('The view has no scroll area');
    return node;
  });

const distanceBelow = (page: Page) =>
  scrollArea(page).then((area) =>
    area.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)
  );

/**
 * Scrolls the timeline up as a reader does: the mouse wheel, or a finger on a phone (WebKit's
 * phone has no wheel: the finger's touch, then the scroll it makes).
 */
const scrollUp = async (page: Page, phone: boolean) => {
  const area = await scrollArea(page);
  const box = await area.boundingBox();
  if (!box) throw new Error('The view is not laid out');
  if (!phone) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < 6; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -150);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(40);
    }
    return;
  }
  await area.evaluate(async (node) => {
    node.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    for (let step = 0; step < 6; step += 1) {
      node.scrollBy(0, -150);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    node.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
  });
};

type WatchWindow = Window & {
  awayWatch?: { stop: () => string[] };
  immediateAway?: { top: number; below: number };
};

/**
 * Hand the position to the reader in the same task as the next latest-row pin. Ordinary
 * Playwright round trips can miss the virtualizer's reconciliation window entirely. Only the
 * browser scroll boundary is wrapped: the app, virtual list, layout and homeserver remain real.
 */
const interruptNextPin = async (page: Page, phone: boolean) => {
  const area = await scrollArea(page);
  await area.evaluate((node, isPhone) => {
    const nativeScrollTo = node.scrollTo.bind(node);
    node.scrollTo = ((...args: Parameters<HTMLElement['scrollTo']>) => {
      nativeScrollTo(...args);
      node.scrollTo = nativeScrollTo;
      queueMicrotask(() => {
        node.dispatchEvent(
          isPhone
            ? new TouchEvent('touchstart', { bubbles: true })
            : new WheelEvent('wheel', { deltaY: -600, bubbles: true })
        );
        nativeScrollTo({ top: node.scrollTop - 600, behavior: 'instant' });
        // Let every scroll observer see the reader's position before the next animation frame.
        node.dispatchEvent(new Event('scroll'));
        (window as WatchWindow).immediateAway = {
          top: node.scrollTop,
          below: node.scrollHeight - node.clientHeight - node.scrollTop,
        };
        const minBelow = node.scrollHeight - node.clientHeight - node.scrollTop - 150;
        const pulled: string[] = [];
        let running = true;
        const start = performance.now();
        const tick = () => {
          if (!running) return;
          const below = node.scrollHeight - node.clientHeight - node.scrollTop;
          if (below < minBelow)
            pulled.push(
              `${Math.round(performance.now() - start)} ms: ${Math.round(
                below
              )} px above the bottom`
            );
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        (window as WatchWindow).awayWatch = {
          stop: () => {
            running = false;
            return pulled;
          },
        };
      });
    }) as HTMLElement['scrollTo'];
  }, phone);
};

const check = async (page: Page, world: World, viewMode: 'classic' | 'threaded', label: string) => {
  const phone = label.includes('phone');
  await loginWithPassword(page, {
    homeserver,
    username: world.reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode,
  });
  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
  await expect(page.getByText('Status update 60:').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Jump to Latest', exact: true })).toBeHidden({
    timeout: 20_000,
  });
  await page.waitForTimeout(1_500);

  // A message arrives while the reader is at the bottom: the view goes to it.
  await interruptNextPin(page, phone);
  const first = `Heads-up for ${label}: the release branch is cut, please hold merges for an hour.`;
  await sendRoomMessage(homeserver, world.colleague.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: first,
  });
  await expect
    .poll(() => page.evaluate(() => (window as WatchWindow).immediateAway?.below ?? 0))
    .toBeGreaterThan(300);
  // A second later another message arrives below them; they stay where they are.
  await page.waitForTimeout(1_000);
  await sendRoomMessage(homeserver, world.colleague.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: `Follow-up for ${label}: the smoke tests on the release branch passed as well.`,
  });
  await page.waitForTimeout(3_000);
  const pulled = await page.evaluate(() => (window as WatchWindow).awayWatch?.stop() ?? []);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}.png` });
  }
  expect(pulled, `frames that pulled the reader back toward the bottom (${label})`).toEqual([]);
  await expect(page.getByRole('button', { name: 'Jump to Latest', exact: true })).toBeVisible();

  // A fresh explicit jump can follow again; cancelling the old one must not disable later pins.
  await page.getByRole('button', { name: 'Jump to Latest', exact: true }).click();
  await expect.poll(() => distanceBelow(page)).toBeLessThan(32);
  const final = `Release checklist for ${label}: all checks complete.`;
  await sendRoomMessage(homeserver, world.colleague.accessToken, world.roomId, {
    msgtype: 'm.text',
    body: final,
  });
  await expect(page.getByText(final).first()).toBeVisible();
  await expect.poll(() => distanceBelow(page)).toBeLessThan(32);
  await scrollUp(page, phone);
  await expect.poll(() => distanceBelow(page)).toBeGreaterThan(300);
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

test.describe('scrolling away right after the view went to the newest row', () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    let reachable = false;
    try {
      reachable = (await fetch(`${homeserver}/_matrix/client/versions`)).ok;
    } catch {
      reachable = false;
    }
    test.skip(!reachable, `No homeserver at ${homeserver}`);
  });

  (['chromium', 'webkit'] as const).forEach((engine) => {
    (
      [
        ['desktop', DESKTOP],
        ['phone', PHONE],
      ] as const
    ).forEach(([form, options]) => {
      (['classic', 'threaded'] as const).forEach((viewMode) => {
        const label = `${viewMode}-${engine}-${form}`;
        test(`${viewMode} view, ${engine}, ${form}`, async ({ browser, baseURL }) => {
          test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
          test.setTimeout(150_000);
          const world = await seed();
          const host = engine === 'webkit' ? await launchWebKit() : undefined;
          const context = await (host ?? browser).newContext({ ...options, baseURL });
          try {
            await check(await context.newPage(), world, viewMode, label);
          } finally {
            await context.close();
            await host?.close();
          }
        });
      });
    });
  });
});
