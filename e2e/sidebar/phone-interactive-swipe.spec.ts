import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Verifies 1:1 finger-following interactive touch swipes on phones across the live 2-layer
// navigation stack (zero DOM cloning, zero `<canvas>` bitmaps):
// 1. Thread <-> Room edge-swipe back (cancel + commit) and end-edge forward swipe into
//    `lastExitedThread` (cancel + commit) without double-sliding.
// 2. Thread -> Room swipe-back after creating a new thread across a soft-keyboard height change.
// 3. Direct-link / reload thread swipe-back revealing live Room focused on the thread card.
// 4. Space All threads <-> Thread 1:1 edge-swipe back with `<Activity>` scroll preservation and
//    cold-reload neutral backdrop fallback.
// 5. PhoneNavDrawer open (left-edge drag) and close (swipe left on panel).
// 6. PhoneMembersSheet close (swipe right on sheet) with cancel and commit.
//
// Set PHONE_SWIPE_SHOTS=<dir> to save mid-drag screenshots for visual inspection.
const PASSWORD = 'phone-interactive-swipe-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const SHOTS = process.env.PHONE_SWIPE_SHOTS;
const ENGINES = ['chromium', ...(WEBKIT_EXECUTABLE ? ['webkit'] : [])] as const;
const OTHER_ROOMS = ['Art Guild', 'Book Swap', 'Bike Repair', 'Seed Library'];

test.use(PHONE);

type Engine = (typeof ENGINES)[number];

type Seed = {
  username: string;
  garden: string;
  gardenRoot: string;
  harbor: string;
  spaceId?: string;
  spaceRoom?: string;
  spaceRoot?: string;
};

type Place = { path: string; room: string | null; thread: string | null };

const text = (body: string) => ({ msgtype: 'm.text', body });

const EXTRA_GARDEN_THREADS = [
  'Compost bay hinges came loose on the east bin; anyone have brass screws handy?',
  'Rain barrel diverter filter needs a quick rinse before Thursday showers.',
  'Greenhouse roof vent latch sticks above 24 degrees; oiled it for now.',
  'Raised bed cedar boards arrive Tuesday morning by the south alley.',
  'Drip line timers reset to 6:15 AM for the herb beds and strawberry troughs.',
  'Cold frame polycarbonate panel has a hairline crack on the north hinge.',
  'Tool shed padlock combo updated for spring; check the pinned note inside.',
  'Berry net hoops are stacked behind the potting bench if anyone needs two.',
  'Pollinator border bulbs are sprouting early along the sunny fence line.',
  'Garlic scapes should be ready to snip by next weekend; bring shears.',
  'Leaf mold bin is sifted and ready for top-dressing the perennial beds.',
  'Watering can spouts are back on the pegboard after the gasket swap.',
];

const EXTRA_SPACE_THREADS = [
  'Ventilation louver actuator calibrated for south bay.',
  'Potting soil pallets arrive Friday before noon.',
  'Shade cloth hooks need replacement along the west ridge.',
  'Misting manifold filter cartridge swapped after pressure drop.',
  'Seedling heat mat thermostat set to 22 degrees for peppers.',
  'Bench drainage trays flushed and leveled on aisle two.',
  'Sticky traps refreshed near the basil propagation table.',
  'Rain sensor wiring checked ahead of weekend squalls.',
  'Propagation dome clips sorted into the labeled wall bins.',
  'Heirloom tomato stakes bundled by height beside the door.',
  'Compost thermometer probe reading steady at 58 degrees.',
  'Trellis twine spools restocked on the north tool rail.',
  'Citrus pots rotated for even morning sun exposure.',
  'Drip emitter flow rates checked across the herb bench.',
];

const seed = async (
  engine: Engine,
  label: string,
  options?: { extraGardenThreads?: boolean; withSpaceThreads?: boolean }
): Promise<Seed> => {
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
  if (options?.extraGardenThreads) {
    for (const body of EXTRA_GARDEN_THREADS) {
      // Sequential sends ensure every newer thread sorts above `gardenRoot` in Compact view.
      // eslint-disable-next-line no-await-in-loop
      await say(garden, text(body));
    }
  }

  const harbor = await create('Harbor Plans', [agent.userId]);
  await say(harbor, text('Crane schedule for the north pier next week: who still needs a slot?'));

  let spaceId: string | undefined;
  let spaceRoom: string | undefined;
  let spaceRoot: string | undefined;
  if (options?.withSpaceThreads) {
    spaceId = await createPrivateSpace(HOMESERVER, token, {
      name: 'Garden Space',
      topic: 'Shared garden rooms',
    });
    spaceRoom = await create('Greenhouse', [agent.userId]);
    await addRoomToSpace(HOMESERVER, token, spaceId, spaceRoom);
    spaceRoot = await say(
      spaceRoom,
      text('Greenhouse glazing panels arrive Thursday morning at the south gate.')
    );
    await say(spaceRoom, {
      ...text('Extra glazing clips are in the north locker.'),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: spaceRoot,
        is_falling_back: true,
        'm.in_reply_to': { event_id: spaceRoot },
      },
    });
    for (const body of EXTRA_SPACE_THREADS) {
      // eslint-disable-next-line no-await-in-loop
      const rootId = await say(spaceRoom, text(body));
      // eslint-disable-next-line no-await-in-loop
      await say(spaceRoom, {
        ...text('Logged on the weekly checklist.'),
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    }
  }

  return { username, garden, gardenRoot, harbor, spaceId, spaceRoom, spaceRoot };
};

const signIn = async (browser: Browser, seeded: Seed) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });
  return { context, page };
};

const drawer = (page: Page) => page.locator('#phone-nav-drawer');
const menuButton = (page: Page) => page.locator('#phone-nav-menu-button');
const roomList = (page: Page) => page.getByTestId('resizable-page-nav');
const membersSheet = (page: Page) => page.getByTestId('phone-members-sheet');
const threadColumn = (page: Page) => page.getByTestId('thread-column');

const place = (page: Page): Place => {
  const url = new URL(page.url());
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const room = parts.find((part) => part.startsWith('!')) ?? null;
  return { path: url.pathname, room, thread: url.searchParams.get('threadId') };
};

const inRoom = (room: string): Partial<Place> => ({ room, thread: null });

const expectAt = (page: Page, expected: Partial<Place>, step: string) =>
  expect.poll(() => place(page), { message: step, timeout: 20_000 }).toMatchObject(expected);

const waitAnimationFrames = (page: Page, count = 2) =>
  page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames;
        const step = () => {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    count
  );

const settled = (page: Page, selector: string) =>
  expect
    .poll(
      () =>
        page.locator(selector).evaluate((element) => {
          const animations = element.getAnimations();
          return animations.filter((animation) => animation.playState === 'running').length;
        }),
      { timeout: 10_000 }
    )
    .toBe(0);

const expectLiveSwipeSettled = async (page: Page) => {
  await expect(page.locator('[data-swipe-thread-stage]')).toHaveCount(0);
  await expect(page.locator('[data-swipe-stage]')).toHaveCount(0);
  await expect(page.locator('[data-swipe-under-thread]')).toHaveCount(0);
  await expect(page.locator('[data-swipe-over-thread]')).toHaveCount(0);
  await expect(page.locator('[data-swipe-dim]')).toHaveCount(0);
  await expect(page.locator('[data-swipe-hold-shield]')).toHaveCount(0);
  await expect(page.locator('[data-swipe-backdrop]')).toHaveCount(0);
  await expect(page.locator('[data-swiping]')).toHaveCount(0);
};

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
  await expectLiveSwipeSettled(page);
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
          ({ px, py }) => {
            const key = Symbol.for('phoneInteractiveSwipeTouchTarget');
            const target = (window as unknown as Record<symbol, EventTarget>)[key] ?? window;
            const event = new Event('touchmove', { bubbles: true, cancelable: true });
            const point = [{ identifier: 1, clientX: px, clientY: py }];
            Object.defineProperty(event, 'touches', { value: point });
            Object.defineProperty(event, 'changedTouches', { value: point });
            target.dispatchEvent(event);
          },
          { px: x, py: nextY }
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
        ({ px, py }) => {
          const key = Symbol.for('phoneInteractiveSwipeTouchTarget');
          const target = (window as unknown as Record<symbol, EventTarget>)[key] ?? window;
          const event = new Event('touchend', { bubbles: true, cancelable: true });
          const point = [{ identifier: 1, clientX: px, clientY: py }];
          Object.defineProperty(event, 'touches', { value: [] });
          Object.defineProperty(event, 'changedTouches', { value: point });
          target.dispatchEvent(event);
        },
        { px: currentX, py: currentY }
      );
    },
  };
};

test.beforeAll(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `Disposable homeserver is not reachable at ${HOMESERVER}. Run \`just hs-up\` first.`
  );
});

for (const engine of ENGINES) {
  test(`${engine}: thread back swipe and end-edge forward swipe track finger 1:1, cancel cleanly, and commit without double-sliding`, async ({
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

        await page.locator(`button[data-thread-root-id="${gardenRoot}"]`).first().tap();
        await expectAt(page, { room: garden, thread: gardenRoot }, 'the thread opens');
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Add marigolds for the border')).toBeVisible({
          timeout: 20_000,
        });
        await expectLiveSwipeSettled(page);
        await waitAnimationFrames(page, 2);

        // 1. Back swipe cancel: drag from left edge to ~45% of viewport width without lifting.
        const cancelDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await cancelDrag.moveTo(180, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          const stage = page.locator('[data-swipe-thread-stage]');
          await expect(stage).toHaveCount(1);
          expect(await stage.locator('canvas').count(), 'zero canvas bitmaps in live stage').toBe(
            0
          );

          const over = page.locator('[data-swipe-over-thread]');
          await expect(over).toHaveAttribute('data-swipe-shadow');
          const midOver = await over.evaluate((element) => ({
            x: element.getBoundingClientRect().x,
            inlineTranslate: element.style.translate,
          }));
          expect(midOver.x, 'thread column tracks finger horizontally').toBeGreaterThan(100);
          expect(midOver.inlineTranslate, 'inline translate is positive px').toMatch(
            /^[1-9]\d*(?:\.\d+)?px\b/
          );

          const under = page.locator('[data-swipe-under-thread]');
          await expect(under, 'live room is visible behind the dragged thread').toBeVisible();
          await expect(under).toContainText('Garden Club');
          await expect(under).toContainText('Seed order for spring');
          expect(
            await under.evaluate((element) => element.style.translate),
            'live room parallaxes from negative x'
          ).toMatch(/^-/);
          await expect(page.locator('[data-swipe-dim]')).toBeVisible();
          await expect(page.locator('[data-swipe-backdrop]')).toHaveCount(0);
          expect(
            await page
              .locator('[data-phone-top-bar]')
              .evaluate((bar) => Math.round(bar.getBoundingClientRect().top)),
            'PhoneTopBar stays fixed at top during swipe'
          ).toBe(0);
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
        await expectLiveSwipeSettled(page);
        const afterCancelX = await threadColumn(page).evaluate(
          (element) => element.getBoundingClientRect().x
        );
        expect(Math.abs(afterCancelX), 'thread springs back to x ≈ 0').toBeLessThan(2);
        expect(place(page), 'URL still on thread after cancel').toMatchObject({
          room: garden,
          thread: gardenRoot,
        });

        // Count over-layer WAAPI animation starts to prove commit settles in 1 animation (no double-slide).
        const installOverAnimationCounter = () =>
          page.evaluate(() => {
            const win = window as unknown as {
              __overAnimCount?: number;
              __origAnimate?: typeof Element.prototype.animate;
            };
            win.__overAnimCount = 0;
            if (!win.__origAnimate) {
              win.__origAnimate = Element.prototype.animate;
              Element.prototype.animate = function countedAnimate(keyframes, options) {
                if (this.hasAttribute('data-swipe-over-thread')) {
                  win.__overAnimCount = (win.__overAnimCount ?? 0) + 1;
                }
                return win.__origAnimate!.call(this, keyframes, options);
              };
            }
          });
        const readOverAnimationCount = () =>
          page.evaluate(
            () => (window as unknown as { __overAnimCount?: number }).__overAnimCount ?? 0
          );

        // 2. Back swipe commit: drag past 35% of viewport width and release.
        await installOverAnimationCounter();
        const commitDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await commitDrag.moveTo(240, { steps: 12, stepMs: 16 });
        } finally {
          await commitDrag.release();
        }

        await expectAt(page, inRoom(garden), 'committed back swipe returns to Garden Club');
        await expectLiveSwipeSettled(page);

        // No double-slide: exactly 1 settle animation on over-layer, stays in Garden Club with drawer closed.
        await page.waitForTimeout(400);
        expect(
          await readOverAnimationCount(),
          'back swipe commit triggers only its single settle animation (no double-slide)'
        ).toBe(1);
        expect(place(page), 'stays in Garden Club without double-sliding').toMatchObject(
          inRoom(garden)
        );
        await expectDrawer(page, false, 'drawer remains closed after exiting thread');

        // 3. End-edge forward swipe cancel into `lastExitedThread`: no focus steal and no read receipt.
        const receiptRequests: string[] = [];
        const onRequest = (req: { url: () => string; method: () => string }) => {
          if (req.method() === 'POST' && /\/(receipt|read_markers)\b/.test(req.url())) {
            receiptRequests.push(req.url());
          }
        };
        page.on('request', onRequest);
        try {
          const forwardCancel = await startTouchDrag(page, engine, 384, 420);
          try {
            await forwardCancel.moveTo(200, { steps: 10, stepMs: 16 });
            await waitAnimationFrames(page, 2);

            await expect(page.locator('[data-swipe-thread-stage]')).toHaveCount(1);
            const over = page.locator('[data-swipe-over-thread]');
            await expect(over, 'passively mounted thread tracks right-edge drag').toBeVisible();
            await expect(over).toHaveAttribute('data-swipe-shadow');
            const overX = await over.evaluate((element) => element.getBoundingClientRect().x);
            expect(overX, 'thread column slides in from right edge').toBeGreaterThan(100);
            expect(overX, 'thread column moved inward past 280px').toBeLessThan(280);
            await expect(page.locator('[data-swipe-under-thread]')).toBeVisible();
            await expect(page.locator('[data-swipe-dim]')).toBeVisible();
            expect(place(page), 'URL stays on room mid-forward-drag').toMatchObject(inRoom(garden));
            expect(
              await page.evaluate(() =>
                Boolean(document.activeElement?.closest('[data-testid="thread-column"]'))
              ),
              'passive forward peek does not steal focus into the thread column'
            ).toBe(false);

            await saveShot(page, testInfo, engine, 'thread-forward-mid-drag');

            await forwardCancel.moveTo(340, { steps: 8, stepMs: 16 });
            await forwardCancel.hold(150);
          } finally {
            await forwardCancel.release();
          }

          await expectLiveSwipeSettled(page);
          await expect(threadColumn(page)).toHaveCount(0);
          expect(place(page), 'URL remains on room after cancelled forward swipe').toMatchObject(
            inRoom(garden)
          );
          expect(
            await page.evaluate(() =>
              Boolean(document.activeElement?.closest('[data-testid="thread-column"]'))
            ),
            'focus remains outside thread column after cancelled forward swipe'
          ).toBe(false);
          expect(
            receiptRequests,
            'cancelled forward swipe sends no read receipts or read markers'
          ).toEqual([]);
        } finally {
          page.off('request', onRequest);
        }

        // 4. End-edge forward swipe commit back into `lastExitedThread` with no double-slide.
        await installOverAnimationCounter();
        const forwardCommit = await startTouchDrag(page, engine, 384, 420);
        try {
          await forwardCommit.moveTo(120, { steps: 12, stepMs: 16 });
        } finally {
          await forwardCommit.release();
        }

        await expectAt(
          page,
          { room: garden, thread: gardenRoot },
          'committed forward swipe reopens lastExitedThread'
        );
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Add marigolds for the border')).toBeVisible({
          timeout: 20_000,
        });
        await expectLiveSwipeSettled(page);
        await page.waitForTimeout(400);
        expect(
          await readOverAnimationCount(),
          'forward swipe commit triggers only its single settle animation (no double-slide)'
        ).toBe(1);
      } finally {
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });

  test(`${engine}: back swipe from a newly created thread reveals live room across keyboard height change`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(240_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const seeded = await seed(engine, 'newthread');
      const { garden, gardenRoot } = seeded;
      const { context, page } = await signIn(own, seeded);
      try {
        await openFromList(page, 'Garden Club', garden);
        await expect(
          page.locator(`button[data-thread-root-id="${gardenRoot}"]`).first()
        ).toBeVisible();

        const composer = page.locator('[data-editable-name="RoomInput"]');
        await expect(composer).toBeVisible();
        await composer.tap();
        await expect(composer).toBeFocused();
        const newThreadText = 'Fresh thread from phone composer: soil delivery?';
        await page.keyboard.type(newThreadText);

        const stageHeight = () =>
          page
            .locator('[data-phone-stage]')
            .evaluate((element) => Math.round(element.getBoundingClientRect().height));

        // Let focusin's 80ms keyboard-viewport settle timer finish before shrinking --app-height.
        await page.waitForTimeout(120);
        await page.evaluate(() => {
          document.documentElement.style.setProperty('--app-height', '500px');
        });
        await waitAnimationFrames(page, 2);
        expect(await stageHeight(), 'stage shrinks to simulated soft keyboard height').toBe(500);

        await page.getByRole('button', { name: 'Send message', exact: true }).tap();

        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(newThreadText, { exact: true }).first()).toBeVisible();
        await expect
          .poll(() => place(page).thread, {
            message: 'new thread URL confirms to a $... event ID',
            timeout: 20_000,
          })
          .toMatch(/^\$/);
        expect(place(page).room, 'new thread opens inside Garden Club').toBe(garden);

        await page.evaluate(() => {
          document.documentElement.style.removeProperty('--app-height');
        });
        await expectLiveSwipeSettled(page);
        await waitAnimationFrames(page, 2);
        expect(await stageHeight(), 'stage returns to full phone height').toBe(844);

        const drag = await startTouchDrag(page, engine, 6, 420);
        try {
          await drag.moveTo(180, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          const liveUnder = page.locator('[data-swipe-under-thread]');
          await expect(
            liveUnder,
            'live room is visible behind the newly created thread'
          ).toBeVisible();
          await expect(liveUnder, 'live room shows the existing room thread card').toContainText(
            'Seed order for spring'
          );
          await expect(
            page.locator('[data-swipe-backdrop]'),
            'no blank backdrop fallback for same-room thread'
          ).toHaveCount(0);

          await saveShot(page, testInfo, engine, 'new-thread-back-mid-drag');

          await drag.moveTo(240, { steps: 6, stepMs: 16 });
        } finally {
          await drag.release();
        }

        await expectAt(page, inRoom(garden), 'committed back swipe returns to Garden Club');
        await expectLiveSwipeSettled(page);
        await expectDrawer(page, false, 'drawer remains closed after exiting new thread');
      } finally {
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });

  test(`${engine}: live room peek reveals Garden Club when swiping back from a directly opened thread`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(240_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const seeded = await seed(engine, 'fallback', { extraGardenThreads: true });
      const { garden, gardenRoot } = seeded;
      const { context, page } = await signIn(own, seeded);
      try {
        // Navigate directly to the thread without visiting the room first (simulates cold reload,
        // notification, or direct link).
        await page.goto(
          `/home/${encodeURIComponent(garden)}/?threadId=${encodeURIComponent(gardenRoot)}`
        );
        await expectAt(page, { room: garden, thread: gardenRoot }, 'directly entering the thread');
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Add marigolds for the border')).toBeVisible({
          timeout: 20_000,
        });
        await expectLiveSwipeSettled(page);
        await waitAnimationFrames(page, 2);

        // 1. Drag from left edge mid-way -> verify live room underneath, no backdrop -> cancel.
        const cancelDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await cancelDrag.moveTo(180, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          await expect(
            page.locator('[data-swipe-backdrop]'),
            'no blank backdrop fallback when live room peek is available'
          ).toHaveCount(0);

          const liveUnder = page.locator('[data-swipe-under-thread]');
          await expect(
            liveUnder,
            'live room area is revealed underneath the sliding thread column'
          ).toBeVisible();
          await expect(liveUnder).toContainText('Garden Club');
          await expect(liveUnder).toContainText('Seed order for spring');
          await expect(page.locator('[data-swipe-dim]')).toBeVisible();

          const overX = await page
            .locator('[data-swipe-over-thread]')
            .evaluate((element) => element.getBoundingClientRect().x);
          expect(overX, 'thread column tracks finger horizontally').toBeGreaterThan(100);
          expect(place(page), 'URL stays on the thread mid-drag').toMatchObject({
            room: garden,
            thread: gardenRoot,
          });

          await saveShot(page, testInfo, engine, 'live-room-fallback-mid-drag');

          await cancelDrag.moveTo(60, { steps: 8, stepMs: 16 });
          await cancelDrag.hold(150);
        } finally {
          await cancelDrag.release();
        }

        // Cancelled drag returns cleanly to the thread with the room re-collapsed.
        await expectLiveSwipeSettled(page);
        await expect(page.locator('[data-room-header="true"]')).toHaveCount(1);
        expect(place(page), 'URL still on thread after cancel').toMatchObject({
          room: garden,
          thread: gardenRoot,
        });

        // 2. Drag past threshold and release to commit back into Garden Club.
        const commitDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await commitDrag.moveTo(240, { steps: 12, stepMs: 16 });
        } finally {
          await commitDrag.release();
        }

        await expectAt(page, inRoom(garden), 'committed swipe back returns to Garden Club');
        await expectLiveSwipeSettled(page);

        await expect(
          page.getByRole('banner').getByRole('heading', { name: 'Garden Club', exact: true })
        ).toBeVisible();
        const focusedCard = page.locator(`button[data-thread-root-id="${gardenRoot}"]`).first();
        await expect(
          focusedCard,
          'focused older thread card is visible in viewport'
        ).toBeInViewport();
        await expect
          .poll(
            () =>
              page.locator('[data-compact-room-view="true"]').evaluate((view) => ({
                overflows: view.scrollHeight > view.clientHeight,
                scrolled: view.scrollTop > 0,
              })),
            { message: 'compact list is scrolled to bring the older thread card into view' }
          )
          .toEqual({ overflows: true, scrolled: true });
        await expectDrawer(page, false, 'drawer remains closed after live-peek exit');
        expect(
          new URL(page.url()).searchParams.get('focusEvent'),
          'direct-exit lands on focused room URL'
        ).toBe('1');

        // 3. Re-open the thread from that focused room URL, reload to clear scroll memory, then
        // swipe back: live peek still focuses the offscreen older card.
        await focusedCard.tap();
        await expectAt(
          page,
          { room: garden, thread: gardenRoot },
          're-entering thread from focused room entry'
        );
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Add marigolds for the border')).toBeVisible({
          timeout: 20_000,
        });
        await expectLiveSwipeSettled(page);

        await page.reload();
        await expectAt(
          page,
          { room: garden, thread: gardenRoot },
          'thread reloads with focused room history entry behind it'
        );
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Add marigolds for the border')).toBeVisible({
          timeout: 20_000,
        });
        await expectLiveSwipeSettled(page);
        await waitAnimationFrames(page, 2);

        const reloadDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await reloadDrag.moveTo(240, { steps: 12, stepMs: 16 });
          await expect(
            page.locator('[data-swipe-under-thread]'),
            'live room peek reveals focused room entry after reload'
          ).toBeVisible();
        } finally {
          await reloadDrag.release();
        }

        await expectAt(
          page,
          inRoom(garden),
          'committed swipe back after reload returns to focused Garden Club entry'
        );
        await expectLiveSwipeSettled(page);
        expect(
          new URL(page.url()).searchParams.get('focusEvent'),
          'returns to focused room URL after reload'
        ).toBe('1');
        await expect(
          focusedCard,
          'focused older thread card stays in viewport after reload and swipe back'
        ).toBeInViewport();
        await expect
          .poll(
            () =>
              page.locator('[data-compact-room-view="true"]').evaluate((view) => ({
                overflows: view.scrollHeight > view.clientHeight,
                scrolled: view.scrollTop > 0,
              })),
            { message: 'compact list stays scrolled to the focused older card after reload' }
          )
          .toEqual({ overflows: true, scrolled: true });
        await expectDrawer(page, false, 'drawer remains closed after reloaded live-peek exit');
      } finally {
        await context.close();
      }
    } finally {
      if (engine === 'webkit') await own.close();
    }
  });

  test(`${engine}: Space All threads ↔ Thread supports 1:1 edge-swipe back with scroll preservation and cold-reload fallback`, async ({
    browser,
  }, testInfo) => {
    test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
    test.setTimeout(240_000);
    const own = engine === 'webkit' ? await launchWebKit() : browser;
    try {
      const seeded = await seed(engine, 'spacethreads', { withSpaceThreads: true });
      const spaceId = seeded.spaceId!;
      const { context, page } = await signIn(own, seeded);
      try {
        await page.goto(`/${encodeURIComponent(spaceId)}/threads`);
        const spaceThreadsPage = page.locator(`[data-space-threads-page="${spaceId}"]`);
        const spaceList = page.locator('[data-space-threads-list="true"]');
        await expect(spaceThreadsPage).toBeVisible({ timeout: 30_000 });
        await expect(spaceList).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(() => spaceList.evaluate((el) => el.scrollHeight > el.clientHeight + 200), {
            timeout: 30_000,
          })
          .toBe(true);

        // Scroll Space All threads to a non-zero offset and tap a card already centered in view.
        await spaceList.evaluate((el) => {
          el.scrollTop = 220;
        });
        await waitAnimationFrames(page, 2);

        const picked = await spaceList.evaluate((scroller) => {
          const { top, bottom } = scroller.getBoundingClientRect();
          const buttons = Array.from(
            scroller.querySelectorAll<HTMLButtonElement>('button[data-thread-root-id]')
          );
          for (const button of buttons) {
            const rect = button.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            if (
              rect.top >= top + 80 &&
              rect.bottom <= bottom - 80 &&
              button.contains(document.elementFromPoint(x, y))
            ) {
              return {
                rootId: button.dataset.threadRootId ?? '',
                x,
                y,
                scrollTop: scroller.scrollTop,
              };
            }
          }
          return null;
        });
        expect(picked, 'found a centered visible Space thread card').not.toBeNull();
        expect(picked!.scrollTop, 'Space All threads is scrolled before opening').toBeGreaterThan(
          100
        );

        await page.touchscreen.tap(picked!.x, picked!.y);
        await expect(page).toHaveURL(/threadId=/, { timeout: 20_000 });
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 20_000 });
        await expectLiveSwipeSettled(page);
        await waitAnimationFrames(page, 2);

        // 1. 1:1 cancel swipe back over live parked Space All threads preserving scrollTop.
        const cancelDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await cancelDrag.moveTo(180, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          const stage = page.locator(
            `[data-space-section-stage="${spaceId}"][data-swipe-thread-stage]`
          );
          await expect(stage).toHaveCount(1);
          expect(await stage.locator('canvas').count(), 'zero canvas bitmaps in Space stage').toBe(
            0
          );
          await expect(page.locator('[data-swipe-backdrop]')).toHaveCount(0);

          const under = page.locator('[data-space-threads-layer][data-swipe-under-thread]');
          await expect(under, 'live Space All threads revealed underneath').toBeVisible();
          const peekScrollTop = await spaceList.evaluate((el) => el.scrollTop);
          expect(
            Math.abs(peekScrollTop - picked!.scrollTop),
            `Space All threads scrollTop preserved while peeking (${peekScrollTop} vs ${picked!.scrollTop})`
          ).toBeLessThanOrEqual(2);

          const over = page.locator('[data-space-outlet-layer][data-swipe-over-thread]');
          await expect(over).toHaveAttribute('data-swipe-shadow');
          const overX = await over.evaluate((el) => el.getBoundingClientRect().x);
          expect(overX, 'Space thread outlet tracks finger horizontally').toBeGreaterThan(100);
          await expect(page.locator('[data-swipe-dim]')).toBeVisible();

          await saveShot(page, testInfo, engine, 'space-threads-back-mid-drag');

          await cancelDrag.moveTo(60, { steps: 8, stepMs: 16 });
          await cancelDrag.hold(150);
        } finally {
          await cancelDrag.release();
        }

        await expectLiveSwipeSettled(page);
        await expect(page).toHaveURL(/threadId=/);

        // 2. 1:1 commit swipe back to Space All threads with exact scrollTop preserved.
        const commitDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await commitDrag.moveTo(240, { steps: 12, stepMs: 16 });
        } finally {
          await commitDrag.release();
        }

        await expect(page).toHaveURL(/\/threads\/?$/, { timeout: 20_000 });
        await expect(spaceThreadsPage).toBeVisible({ timeout: 20_000 });
        await expectLiveSwipeSettled(page);
        const restoredScrollTop = await spaceList.evaluate((el) => el.scrollTop);
        expect(
          Math.abs(restoredScrollTop - picked!.scrollTop),
          `Space All threads scrollTop preserved after commit (${restoredScrollTop} vs ${picked!.scrollTop})`
        ).toBeLessThanOrEqual(2);

        // 3. Cold reload inside the Space thread falls back to neutral backdrop without eagerly
        // mounting SpaceThreadsPage on touchstart, then commits back cleanly.
        await page.locator(`button[data-thread-root-id="${picked!.rootId}"]`).first().tap();
        await expect(page).toHaveURL(/threadId=/, { timeout: 20_000 });
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 20_000 });
        await expectLiveSwipeSettled(page);

        await page.reload();
        await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
        await expectLiveSwipeSettled(page);
        await expect(
          page.locator('[data-space-threads-layer]'),
          'SpaceThreadsPage is not eagerly mounted on cold reload inside a thread'
        ).toHaveCount(0);
        await waitAnimationFrames(page, 2);

        const coldDrag = await startTouchDrag(page, engine, 6, 420);
        try {
          await coldDrag.moveTo(180, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          await expect(
            page.locator('[data-swipe-stage="back"]'),
            'cold reload uses lightweight fallback stage'
          ).toHaveCount(1);
          await expect(
            page.locator('[data-swipe-backdrop]'),
            'neutral themed backdrop shown on cold reload'
          ).toBeVisible();
          await expect(page.locator('[data-swipe-under-thread]')).toHaveCount(0);
          await expect(page.locator('[data-swipe-over-thread]')).toHaveAttribute(
            'data-swipe-shadow'
          );
          await expect(page.locator('[data-swipe-dim]')).toBeVisible();

          await coldDrag.moveTo(240, { steps: 6, stepMs: 16 });
        } finally {
          await coldDrag.release();
        }

        await expect(page).toHaveURL(/\/threads\/?$/, { timeout: 20_000 });
        await expect(spaceThreadsPage).toBeVisible({ timeout: 20_000 });
        await expectLiveSwipeSettled(page);
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

        // 1. Drag from left edge mid-way -> verify live tracking -> drag back to cancel.
        const cancelOpen = await startTouchDrag(page, engine, 6, 420);
        try {
          await cancelOpen.moveTo(160, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

          await expect(drawer(page), 'drawer has data-swiping while dragging').toHaveAttribute(
            'data-swiping'
          );
          const midLeft = await drawer(page).evaluate(
            (element) => element.getBoundingClientRect().left
          );
          expect(midLeft, 'drawer is partially open mid-drag').toBeGreaterThan(-260);
          expect(midLeft, 'drawer is not yet fully open mid-drag').toBeLessThan(-20);

          await saveShot(page, testInfo, engine, 'drawer-open-mid-drag');

          await cancelOpen.moveTo(30, { steps: 8, stepMs: 16 });
          await cancelOpen.hold(150);
        } finally {
          await cancelOpen.release();
        }

        await expectDrawer(page, false, 'cancelled open drag keeps drawer closed');

        // 2. Drag from left edge past threshold to commit open.
        const commitOpen = await startTouchDrag(page, engine, 6, 420);
        try {
          await commitOpen.moveTo(260, { steps: 12, stepMs: 16 });
        } finally {
          await commitOpen.release();
        }

        await expectDrawer(page, true, 'committed edge drag opens drawer');
        await expect(roomList(page).getByRole('link', { name: 'Garden Club' })).toBeVisible();

        // 3. Drag left on the open drawer panel to track close and commit closed.
        const closeDrag = await startTouchDrag(page, engine, 240, 420);
        try {
          await closeDrag.moveTo(100, { steps: 10, stepMs: 16 });
          await waitAnimationFrames(page, 2);

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
