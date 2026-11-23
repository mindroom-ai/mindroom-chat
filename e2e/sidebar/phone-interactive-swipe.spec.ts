import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Interactive finger-following phone swipes at 390x844 with touch:
// 1) Thread -> Room left-edge back swipe tracks the finger continuously, reveals the cached room
//    preview underneath without premature navigation, springs back cleanly on cancel, and commits
//    once with zero stuck swipe chrome or double-slide.
// 2) Sidebar navigation drawer opens interactively from the left edge (cancel + commit) and closes
//    interactively by dragging left inside the open drawer.
// 3) Members sheet closes interactively by dragging right inside the open sheet (cancel + commit).
// Chromium uses real CDP Input.dispatchTouchEvent; WebKit (when PLAYWRIGHT_WEBKIT_EXECUTABLE is
// set) uses synthetic multi-step touch events. Set INTERACTIVE_SWIPE_SHOTS=<directory> to save
// Chromium mid-drag screenshots while the finger is held down.
const PASSWORD = 'phone-interactive-swipe-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.INTERACTIVE_SWIPE_SHOTS;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const ENGINES = ['chromium', 'webkit'] as const;
type Engine = (typeof ENGINES)[number];

const OTHER_ROOMS = [
  'Book Swap',
  'Bike Shed',
  'Compost Crew',
  'Tool Library',
  'Porch Concerts',
  'Trail Watch',
  'Seed Exchange',
  'Rain Barrels',
];

type Seed = {
  username: string;
  garden: string;
  gardenRoot: string;
  harbor: string;
};

type Place = { path: string; room: string | null; thread: string | null };

const text = (body: string) => ({ msgtype: 'm.text', body });

const seed = async (engine: Engine, label: string): Promise<Seed> => {
  const username = `iswipe_${engine[0]}_${label}_${RUN}`;
  const reader = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const token = reader.access_token;
  // An agent in the rooms so they open in Compact mode, as MindRoom rooms do.
  const agent = await registerAgentAccount(HOMESERVER, `isw${engine[0]}${label[0]}`);
  // Invented placeholder neighbors so the Members sheet has realistic entries.
  const neighbors = await Promise.all(
    ['clara', 'devon', 'priya'].map((name) =>
      matrixFetch<{ user_id: string; access_token: string }>(HOMESERVER, '/register', {
        method: 'POST',
        body: JSON.stringify({
          username: `${name}_${engine[0]}_${label}_${RUN}`,
          password: PASSWORD,
          auth: { type: 'm.login.dummy' },
        }),
      })
    )
  );
  const create = (name: string, invite?: string[]) =>
    createPrivateRoom(HOMESERVER, token, { name, topic: `${name} notes`, invite });
  const say = (roomId: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, token, roomId, content, 'phone-interactive-swipe');

  await Promise.all(OTHER_ROOMS.map((name) => create(name)));
  await createPrivateSpace(HOMESERVER, token, { name: 'Field Trips', topic: '' });

  const garden = await create('Garden Club', [
    agent.userId,
    ...neighbors.map(({ user_id }) => user_id),
  ]);
  await Promise.all(
    neighbors.map(({ access_token }) => joinRoom(HOMESERVER, access_token, garden))
  );
  const gardenRoot = await say(
    garden,
    text('Seed order for spring: tomatoes, beans and two kinds of squash. Anything else by Friday?')
  );
  await say(garden, {
    ...text('Add marigolds for the border, please; the old packets failed.'),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: gardenRoot,
      is_falling_back: true,
      'm.in_reply_to': { event_id: gardenRoot },
    },
  });
  await say(garden, {
    ...text('Count me in for sugar snap peas and two trays of basil starts.'),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: gardenRoot,
      is_falling_back: true,
      'm.in_reply_to': { event_id: gardenRoot },
    },
  });
  await say(
    garden,
    text('Saturday mulch drop starts at 9:00 by the north gate. Bring wheelbarrows if you can.')
  );

  const harbor = await create('Harbor Plans', [agent.userId]);
  await say(harbor, text('Crane schedule for the north pier next week: who still needs a slot?'));

  return { username, garden, gardenRoot, harbor };
};

const place = (page: Page): Place => {
  const url = new URL(page.url());
  const room = url.pathname
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .find((segment) => segment.startsWith('!'));
  return { path: url.pathname, room: room ?? null, thread: url.searchParams.get('threadId') };
};

const inRoom = (room: string): Partial<Place> => ({ room, thread: null });

const expectAt = (page: Page, expected: Partial<Place>, step: string) =>
  expect.poll(() => place(page), { message: step, timeout: 20_000 }).toMatchObject(expected);

const roomList = (page: Page) => page.getByTestId('resizable-page-nav');
const drawer = (page: Page) => page.locator('#phone-nav-drawer');
const menuButton = (page: Page) => page.locator('#phone-nav-menu-button');
const membersSheet = (page: Page) => page.getByTestId('phone-members-sheet');
const topPhonePage = (page: Page) => page.locator('[data-phone-stage] > [data-phone-page]');

const waitAnimationFrames = (page: Page, count = 2) =>
  page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let left = frames;
        const step = () => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count
  );

const settled = (page: Page, selector: string) =>
  expect
    .poll(() =>
      page.evaluate((css) => document.querySelector(css)?.getAnimations().length ?? 0, selector)
    )
    .toBe(0);

const expectDrawer = async (page: Page, open: boolean, step: string) => {
  if (open) {
    await expect(drawer(page), step).toHaveAttribute('data-open');
  } else {
    await expect(drawer(page), step).not.toHaveAttribute('data-open');
  }
  await expect(drawer(page), step).not.toHaveAttribute('data-swiping');
  await expect(menuButton(page), step).toHaveAttribute('aria-expanded', String(open));
  await settled(page, '#phone-nav-drawer');
};

const saveShot = async (page: Page, testInfo: TestInfo, engine: Engine, name: string) => {
  await page.screenshot({ path: testInfo.outputPath(`${engine}-${name}.png`) });
  if (SHOTS && engine === 'chromium') {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
};

const openFromList = async (page: Page, name: string, room: string) => {
  await roomList(page).getByRole('link', { name }).tap();
  await expectAt(page, inRoom(room), `${name} opens from the list`);
  await expect(page.getByRole('banner').getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-page-slide');
  await settled(page, '[data-phone-stage] > [data-phone-page]');
};

type TouchDrag = {
  moveTo: (
    targetX: number,
    options?: { steps?: number; stepMs?: number; y?: number }
  ) => Promise<void>;
  hold: (ms: number) => Promise<void>;
  release: () => Promise<void>;
};

const startTouchDrag = async (
  page: Page,
  engine: Engine,
  startX: number,
  startY = 420
): Promise<TouchDrag> => {
  let currentX = startX;
  let currentY = startY;
  let released = false;

  if (engine === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const dispatch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: x === undefined || y === undefined ? [] : [{ x, y, id: 1 }],
      });

    await dispatch('touchStart', startX, startY);

    return {
      async moveTo(targetX, { steps = 10, stepMs = 16, y = currentY } = {}) {
        const fromX = currentX;
        const fromY = currentY;
        for (let step = 1; step <= steps; step += 1) {
          const ratio = step / steps;
          const x = fromX + (targetX - fromX) * ratio;
          const nextY = fromY + (y - fromY) * ratio;
          // eslint-disable-next-line no-await-in-loop
          await dispatch('touchMove', x, nextY);
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(stepMs);
        }
        currentX = targetX;
        currentY = y;
      },
      async hold(ms) {
        await page.waitForTimeout(ms);
      },
      async release() {
        if (released) return;
        released = true;
        try {
          await dispatch('touchEnd');
        } finally {
          await cdp.detach();
        }
      },
    };
  }

  await page.evaluate(
    ({ x, y }) => {
      const key = Symbol.for('phoneInteractiveSwipeTouchTarget');
      const target = document.elementFromPoint(x, y) ?? window;
      (window as unknown as Record<symbol, EventTarget>)[key] = target;
      const event = new Event('touchstart', { bubbles: true, cancelable: true });
      const point = [{ identifier: 1, clientX: x, clientY: y }];
      Object.defineProperty(event, 'touches', { value: point });
      Object.defineProperty(event, 'changedTouches', { value: point });
      target.dispatchEvent(event);
    },
    { x: startX, y: startY }
  );

  return {
    async moveTo(targetX, { steps = 10, stepMs = 16, y = currentY } = {}) {
      const fromX = currentX;
      const fromY = currentY;
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        const x = fromX + (targetX - fromX) * ratio;
        const nextY = fromY + (y - fromY) * ratio;
        // eslint-disable-next-line no-await-in-loop
        await page.evaluate(
          ({ moveX, moveY }) => {
            const key = Symbol.for('phoneInteractiveSwipeTouchTarget');
            const target = (window as unknown as Record<symbol, EventTarget>)[key] ?? window;
            const event = new Event('touchmove', { bubbles: true, cancelable: true });
            const point = [{ identifier: 1, clientX: moveX, clientY: moveY }];
            Object.defineProperty(event, 'touches', { value: point });
            Object.defineProperty(event, 'changedTouches', { value: point });
            target.dispatchEvent(event);
          },
          { moveX: x, moveY: nextY }
        );
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(stepMs);
      }
      currentX = targetX;
      currentY = y;
    },
    async hold(ms) {
      await page.waitForTimeout(ms);
    },
    async release() {
      if (released) return;
      released = true;
      await page.evaluate(
        ({ endX, endY }) => {
          const key = Symbol.for('phoneInteractiveSwipeTouchTarget');
          const store = window as unknown as Record<symbol, EventTarget | undefined>;
          const target = store[key] ?? window;
          const event = new Event('touchend', { bubbles: true, cancelable: true });
          const point = [{ identifier: 1, clientX: endX, clientY: endY }];
          Object.defineProperty(event, 'touches', { value: [] });
          Object.defineProperty(event, 'changedTouches', { value: point });
          target.dispatchEvent(event);
          delete store[key];
        },
        { endX: currentX, endY: currentY }
      );
    },
  };
};

const signIn = async (browser: Browser, { username }: Seed) => {
  const context = await browser.newContext(PHONE);
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.goto('/home/');
  await expect(roomList(page).getByRole('link', { name: 'Harbor Plans' })).toBeVisible({
    timeout: 60_000,
  });
  return { context, page };
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

for (const engine of ENGINES) {
  test(`${engine}: thread back swipe tracks finger, cancels cleanly, and commits once`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(240_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const seeded = await seed(engine, 'thread');
      const { garden, gardenRoot } = seeded;
      const { context, page } = await signIn(own, seeded);
      try {
        await openFromList(page, 'Garden Club', garden);
        const threadCard = page.locator(`button[data-thread-root-id="${gardenRoot}"]`).first();
        await expect(threadCard).toBeVisible();
        await threadCard.tap();

        await expectAt(page, { room: garden, thread: gardenRoot }, 'entering the thread');
        await expect(page.getByText('Add marigolds for the border')).toBeVisible();
        await expect(page.locator('html')).not.toHaveAttribute('data-page-slide');
        await settled(page, '[data-phone-stage] > [data-phone-page]');
        await waitAnimationFrames(page, 2);

        // Drag from left edge to ~45% of viewport width without lifting.
        const cancelDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await cancelDrag.moveTo(180, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          const midState = await topPhonePage(page).evaluate((element) => ({
            x: element.getBoundingClientRect().x,
            inlineTranslate: element.style.translate,
          }));
          expect(midState.x, 'thread page tracks finger horizontally').toBeGreaterThan(100);
          expect(midState.inlineTranslate, 'inline translate is positive px').toMatch(
            /^[1-9]\d*(?:\.\d+)?px\b/
          );
          await expect(
            page.locator('[data-swipe-preview="under"]'),
            'cached room preview is visible behind the dragged thread'
          ).toBeVisible();
          expect(place(page), 'URL stays on the thread mid-drag').toMatchObject({
            room: garden,
            thread: gardenRoot,
          });

          await saveShot(page, testInfo, engine, 'thread-back-mid-drag');

          // Drag back near the left edge, hold past the 100ms velocity window, and release.
          await cancelDrag.moveTo(60, { steps: 8, stepMs: 16 });
          await cancelDrag.hold(150);
        } finally {
          await cancelDrag.release();
        }

        // Cancelled drag springs back cleanly and stays in the thread.
        await expect(page.locator('[data-swipe-preview]')).toHaveCount(0);
        await expect(page.locator('[data-swiping]')).toHaveCount(0);
        await expect
          .poll(() =>
            topPhonePage(page).evaluate((element) => ({
              x: Math.abs(element.getBoundingClientRect().x),
              inlineTranslate: element.style.translate,
            }))
          )
          .toEqual({ x: expect.any(Number), inlineTranslate: '' });
        const afterCancelX = await topPhonePage(page).evaluate(
          (element) => element.getBoundingClientRect().x
        );
        expect(Math.abs(afterCancelX), 'thread springs back to x ≈ 0').toBeLessThan(2);
        expect(place(page), 'URL still on thread after cancel').toMatchObject({
          room: garden,
          thread: gardenRoot,
        });

        // Commit swipe past 35% of the viewport width.
        const commitDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await commitDrag.moveTo(240, { steps: 12, stepMs: 16 });
        } finally {
          await commitDrag.release();
        }

        await expectAt(page, inRoom(garden), 'committed back swipe returns to Garden Club');
        await expect(page.locator('[data-swipe-preview]')).toHaveCount(0);
        await expect(page.locator('[data-swipe-hold-shield]')).toHaveCount(0);
        await expect(page.locator('[data-swiping]')).toHaveCount(0);

        // No double-slide: stays in Garden Club with the drawer closed.
        await page.waitForTimeout(500);
        expect(place(page), 'stays in Garden Club without double-sliding').toMatchObject(
          inRoom(garden)
        );
        await expectDrawer(page, false, 'drawer remains closed after exiting thread');
      } finally {
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });

  test(`${engine}: sidebar drawer tracks finger interactively on open and close`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(240_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const seeded = await seed(engine, 'drawer');
      const { garden } = seeded;
      const { context, page } = await signIn(own, seeded);
      try {
        await openFromList(page, 'Garden Club', garden);
        await expectDrawer(page, false, 'drawer starts closed in Garden Club');

        // 1. Open drag mid-way -> hold -> verify tracking -> cancel back.
        const cancelOpen = await startTouchDrag(page, engine, 6, 420);
        try {
          await cancelOpen.moveTo(160, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          await expect(drawer(page), 'drawer has data-swiping mid-open').toHaveAttribute(
            'data-swiping'
          );
          await expect(drawer(page), 'data-open stays absent mid-open').not.toHaveAttribute(
            'data-open'
          );
          await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');

          const midOpenRight = await drawer(page).evaluate(
            (element) => element.getBoundingClientRect().right
          );
          expect(midOpenRight, 'drawer right edge is partially on screen').toBeGreaterThan(100);
          expect(midOpenRight, 'drawer right edge is not fully open yet').toBeLessThan(320);

          await saveShot(page, testInfo, engine, 'drawer-open-mid-drag');

          await cancelOpen.moveTo(40, { steps: 8, stepMs: 16 });
          await cancelOpen.hold(150);
        } finally {
          await cancelOpen.release();
        }

        await expectDrawer(page, false, 'cancelled open drag springs drawer back closed');

        // 2. Commit open drag.
        const commitOpen = await startTouchDrag(page, engine, 6, 420);
        try {
          await commitOpen.moveTo(230, { steps: 12, stepMs: 16 });
        } finally {
          await commitOpen.release();
        }

        await expectDrawer(page, true, 'committed open drag opens drawer');

        // 3. Close drag inside the open drawer -> hold -> verify tracking -> continue to commit.
        const closeDrag = await startTouchDrag(page, engine, 260, 420);
        try {
          await closeDrag.moveTo(110, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          await expect(drawer(page), 'drawer has data-swiping mid-close').toHaveAttribute(
            'data-swiping'
          );
          await expect(drawer(page), 'data-open stays present mid-close').toHaveAttribute(
            'data-open'
          );

          const midCloseLeft = await drawer(page).evaluate(
            (element) => element.getBoundingClientRect().left
          );
          expect(midCloseLeft, 'drawer is partially pushed off left edge').toBeLessThan(-80);

          await saveShot(page, testInfo, engine, 'drawer-close-mid-drag');

          await closeDrag.moveTo(40, { steps: 6, stepMs: 16 });
        } finally {
          await closeDrag.release();
        }

        await expectDrawer(page, false, 'committed close drag closes drawer');
      } finally {
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });

  test(`${engine}: members sheet tracks finger interactively on close, cancel, and commit`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(240_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const seeded = await seed(engine, 'members');
      const { garden } = seeded;
      const { context, page } = await signIn(own, seeded);
      try {
        await openFromList(page, 'Garden Club', garden);

        await page
          .getByRole('banner')
          .getByRole('button', { name: 'Show Members', exact: true })
          .tap();
        await expect(membersSheet(page), 'members sheet opens').toHaveAttribute('data-open');
        await settled(page, '[data-testid="phone-members-sheet"]');
        await waitAnimationFrames(page, 2);

        const openLeft = await membersSheet(page).evaluate(
          (element) => element.getBoundingClientRect().left
        );

        // 1. Drag right mid-way -> hold -> verify tracking -> drag back to cancel.
        const cancelDrag = await startTouchDrag(page, engine, 120, 420);
        try {
          await cancelDrag.moveTo(260, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          await expect(membersSheet(page), 'sheet has data-swiping mid-drag').toHaveAttribute(
            'data-swiping'
          );
          await expect(membersSheet(page), 'data-open stays present mid-drag').toHaveAttribute(
            'data-open'
          );

          const midLeft = await membersSheet(page).evaluate(
            (element) => element.getBoundingClientRect().left
          );
          expect(midLeft - openLeft, 'members sheet moved right by > 80px').toBeGreaterThan(80);

          await saveShot(page, testInfo, engine, 'members-close-mid-drag');

          await cancelDrag.moveTo(160, { steps: 8, stepMs: 16 });
          await cancelDrag.hold(150);
        } finally {
          await cancelDrag.release();
        }

        await expect(membersSheet(page), 'sheet stays open after cancel').toHaveAttribute(
          'data-open'
        );
        await expect(membersSheet(page)).not.toHaveAttribute('data-swiping');
        await settled(page, '[data-testid="phone-members-sheet"]');
        const afterCancelLeft = await membersSheet(page).evaluate(
          (element) => element.getBoundingClientRect().left
        );
        expect(Math.abs(afterCancelLeft - openLeft), 'sheet springs back open').toBeLessThan(2);

        // 2. Drag right past threshold and release to commit close.
        const commitDrag = await startTouchDrag(page, engine, 120, 420);
        try {
          await commitDrag.moveTo(320, { steps: 12, stepMs: 16 });
        } finally {
          await commitDrag.release();
        }

        await expect(membersSheet(page), 'committed drag removes members sheet').toHaveCount(0);
      } finally {
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });
}
