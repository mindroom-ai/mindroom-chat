import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  addRoomToSpace,
  createDefaultThreadFilterState,
  createPrivateRoom,
  createPrivateSpace,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// On a phone, forward push (`Room → Thread`, `Space All threads → Thread`) and Back button
// (`Thread → Room`, `Thread → Space All threads`) animate two live DOM layers inside a clipped
// stage with zero DOM cloning and zero `<canvas>` bitmaps (src/app/navigation/phonePageSlide.ts):
// the upper layer slides across the viewport (100%→0% / 0%→100%) with a leading-edge shadow while
// the live inert under-layer parallaxes by 30% (0%→-30% / -30%→0%) behind a 0↔0.12 dim veil and a
// double-tap input shield, leaving the fixed `PhoneTopBar` stationary. `PhoneNavDrawer` plays its
// own 280 ms transform slide on drawer open/close and room→list navigation. Nothing slides for
// reduced motion, and the browser View Transitions API is never invoked.
// Set PAGE_SLIDE_SHOTS=<directory> to save mid-slide screenshots.
const PASSWORD = 'phone-page-slide-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.PAGE_SLIDE_SHOTS;
const ENGINES = ['chromium', ...(WEBKIT_EXECUTABLE ? ['webkit'] : [])] as const;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const HELD_AT_MS = 90;
const ACTIVE_SLIDE_SELECTOR =
  '[data-swipe-thread-stage], [data-swipe-stage], [data-swipe-hold-shield], [data-swipe-dim]';

test.use(PHONE);

type Slide = {
  direction: 'forward' | 'back';
  duration?: number;
  overFromPct: number;
  overToPct: number;
  underFromPct?: number;
  underToPct?: number;
  dimFrom?: string;
  dimTo?: string;
  hasUnder: boolean;
  underInert: boolean;
  hasDim: boolean;
  hasShield: boolean;
  hasShadow: boolean;
  tapHitsShield: boolean;
  topBarTop: number;
  topBarInsideStage: boolean;
  canvasCount: number;
};

type Recorded = {
  liveSlides: Slide[];
  viewTransitions: number;
  drawerSlides: string[];
  pausedAnimations: Animation[];
};

const FORWARD: Slide = {
  direction: 'forward',
  duration: 280,
  overFromPct: 100,
  overToPct: 0,
  underFromPct: 0,
  underToPct: -30,
  dimFrom: '0',
  dimTo: '0.12',
  hasUnder: true,
  underInert: true,
  hasDim: true,
  hasShield: true,
  hasShadow: true,
  tapHitsShield: true,
  topBarTop: 0,
  topBarInsideStage: false,
  canvasCount: 0,
};

const BACK: Slide = {
  direction: 'back',
  duration: 280,
  overFromPct: 0,
  overToPct: 100,
  underFromPct: -30,
  underToPct: 0,
  dimFrom: '0.12',
  dimTo: '0',
  hasUnder: true,
  underInert: true,
  hasDim: true,
  hasShield: true,
  hasShadow: true,
  tapHitsShield: true,
  topBarTop: 0,
  topBarInsideStage: false,
  canvasCount: 0,
};

const recordSlides = (page: Page, heldAt?: number) =>
  page.addInitScript((held) => {
    const slides: Slide[] = [];
    const pausedAnimations: Animation[] = [];
    const recorded = window as unknown as Recorded;
    recorded.liveSlides = slides;
    recorded.viewTransitions = 0;
    recorded.pausedAnimations = pausedAnimations;

    const browser = Document.prototype as unknown as {
      startViewTransition?: (...args: unknown[]) => unknown;
    };
    const start = browser.startViewTransition;
    if (start) {
      browser.startViewTransition = function counted(...args) {
        recorded.viewTransitions += 1;
        return start.apply(this, args);
      };
    }

    const parsePct = (value: unknown, width: number): number => {
      const px = parseFloat(String(value ?? '0'));
      return Number.isFinite(px) && width > 0 ? Math.round((px / width) * 100) : 0;
    };

    const formatOpacity = (value: unknown): string => {
      const num = Number(value);
      return Number.isFinite(num) ? String(Number(num.toFixed(4))) : String(value ?? '');
    };

    let activeStage: Element | null = null;
    let activeSlide: Slide | null = null;
    const activeSlots = new Set<'over' | 'under' | 'dim'>();

    const getOrCreateSlide = (stage: Element, slot: 'over' | 'under' | 'dim'): Slide => {
      if (
        !activeSlide ||
        !slides.includes(activeSlide) ||
        activeStage !== stage ||
        activeSlots.has(slot)
      ) {
        activeStage = stage;
        activeSlots.clear();
        activeSlide = {
          direction: 'forward',
          overFromPct: 0,
          overToPct: 0,
          hasUnder: false,
          underInert: false,
          hasDim: false,
          hasShield: false,
          hasShadow: false,
          tapHitsShield: false,
          topBarTop: -1,
          topBarInsideStage: false,
          canvasCount: 0,
        };
        slides.push(activeSlide);
      }
      activeSlots.add(slot);
      return activeSlide;
    };

    document.addEventListener(
      'transitionrun',
      (event) => {
        const { target } = event;
        if (!(target instanceof HTMLElement)) return;
        const stage = target.closest('[data-swipe-thread-stage]');
        if (!stage) return;

        const isOver =
          target.hasAttribute('data-swipe-over-thread') && event.propertyName === 'translate';
        const isUnder =
          target.hasAttribute('data-swipe-under-thread') && event.propertyName === 'translate';
        const isDim = target.hasAttribute('data-swipe-dim') && event.propertyName === 'opacity';
        if (!isOver && !isUnder && !isDim) return;

        const animation = target
          .getAnimations()
          .find(
            (each): each is CSSTransition =>
              'transitionProperty' in each &&
              (each as CSSTransition).transitionProperty === event.propertyName
          );
        const effect = animation?.effect as KeyframeEffect | null | undefined;
        const keyframes = effect?.getKeyframes?.() ?? [];
        const first: Record<string, unknown> = keyframes[0] ?? {};
        const last: Record<string, unknown> = keyframes[keyframes.length - 1] ?? {};
        const width = stage.getBoundingClientRect().width || innerWidth;

        if (isOver) {
          const slide = getOrCreateSlide(stage, 'over');
          const overFromPct = parsePct(first.translate, width);
          const overToPct = parsePct(last.translate, width);
          const under = stage.querySelector('[data-swipe-under-thread]');
          const topBar = document.querySelector('[data-phone-top-bar]');
          const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
          const timingDuration = effect?.getTiming?.().duration;
          const duration =
            typeof timingDuration === 'number'
              ? Math.round(timingDuration)
              : Math.round(parseFloat(getComputedStyle(target).transitionDuration || '0') * 1000);
          Object.assign(slide, {
            direction: overFromPct > overToPct ? 'forward' : 'back',
            duration,
            overFromPct,
            overToPct,
            hasUnder: Boolean(under),
            underInert: Boolean(
              under && ((under as HTMLElement).inert || under.hasAttribute('inert'))
            ),
            hasDim: Boolean(stage.querySelector('[data-swipe-dim]')),
            hasShield: Boolean(stage.querySelector('[data-swipe-hold-shield]')),
            hasShadow: target.hasAttribute('data-swipe-shadow'),
            tapHitsShield: Boolean(hit?.hasAttribute('data-swipe-hold-shield')),
            topBarTop: topBar ? Math.round(topBar.getBoundingClientRect().top) : -1,
            topBarInsideStage: Boolean(stage.querySelector('[data-phone-top-bar]')),
            canvasCount: stage.querySelectorAll('canvas').length,
          });
        } else if (isUnder) {
          const slide = getOrCreateSlide(stage, 'under');
          slide.underFromPct = parsePct(first.translate, width);
          slide.underToPct = parsePct(last.translate, width);
        } else if (isDim) {
          const slide = getOrCreateSlide(stage, 'dim');
          slide.dimFrom = formatOpacity(first.opacity);
          slide.dimTo = formatOpacity(last.opacity);
        }

        if (held !== undefined && animation) {
          animation.pause();
          animation.currentTime = held;
          pausedAnimations.push(animation);
        }
      },
      true
    );

    const drawerSlides: string[] = [];
    recorded.drawerSlides = drawerSlides;
    for (const type of ['transitionrun', 'transitionend', 'transitioncancel'] as const) {
      document.addEventListener(
        type,
        (event) => {
          const { target } = event;
          if (!(target instanceof Element) || target.id !== 'phone-nav-drawer') return;
          if (event.propertyName === 'transform') drawerSlides.push(type);
        },
        true
      );
    }
  }, heldAt);

const spliceDrawerSlides = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as Recorded).drawerSlides.splice(0));

const takeDrawerSlide = async (page: Page, step: string): Promise<string[]> => {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as Recorded).drawerSlides.some((each) => each !== 'transitionrun')
        ),
      { message: `${step}: the drawer's slide ends`, timeout: 30_000 }
    )
    .toBe(true);
  return spliceDrawerSlides(page);
};

const finishPausedSlides = (page: Page) =>
  page.evaluate(() => {
    const animations = (window as unknown as Recorded).pausedAnimations.splice(0);
    animations.forEach((animation) => {
      if (animation.playState === 'paused') animation.finish();
    });
  });

const takeSlides = async (page: Page, step: string): Promise<Slide[]> => {
  await expect(page.locator(ACTIVE_SLIDE_SELECTOR), `${step}: live slide clears`).toHaveCount(0);
  await expect(page.locator('[data-swipe-under-thread]'), `${step}: under clears`).toHaveCount(0);
  await expect(page.locator('[data-swipe-over-thread]'), `${step}: over clears`).toHaveCount(0);
  return page.evaluate(() => (window as unknown as Recorded).liveSlides.splice(0));
};

const text = (body: string) => ({ msgtype: 'm.text', body });

const seed = async (label: string, extraThreads = 0) => {
  const username = `pps_${label}_${RUN}`;
  const reader = await matrixFetch<{ access_token: string; user_id: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  const agent = await registerAgentAccount(HOMESERVER, `pps${label}`);
  const create = (name: string) =>
    createPrivateRoom(HOMESERVER, reader.access_token, {
      name,
      topic: `${name} notes`,
      invite: [agent.userId],
    });
  const say = (roomId: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, reader.access_token, roomId, content, 'phone-page-slide');

  const garden = await create('Garden Club');
  const root = await say(
    garden,
    text('Seed order for spring: tomatoes, beans and two kinds of squash. Anything else by Friday?')
  );
  await say(garden, {
    ...text('Add marigolds for the border, please; the old packets failed.'),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: root,
      is_falling_back: true,
      'm.in_reply_to': { event_id: root },
    },
  });
  await say(garden, text('Who waters the beds in the second week of July?'));

  const harbor = await create('Harbor Plans');
  await say(harbor, text('Crane schedule for the north pier next week: who still needs a slot?'));

  const spaceId = await createPrivateSpace(HOMESERVER, reader.access_token, {
    name: 'Garden Space',
    topic: 'Shared garden rooms',
  });
  const greenhouse = await create('Greenhouse');
  await addRoomToSpace(HOMESERVER, reader.access_token, spaceId, greenhouse);
  const spaceRoot = await say(
    greenhouse,
    text('Greenhouse glazing panels arrive Thursday morning at the south gate.')
  );
  await say(greenhouse, {
    ...text('I will bring extra glazing clips and tape.'),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: spaceRoot,
      is_falling_back: true,
      'm.in_reply_to': { event_id: spaceRoot },
    },
  });

  const subjects = [
    'Water the new plants',
    'Plan the harvest',
    'Mend the greenhouse',
    'Clean the tools',
  ];
  for (let start = 0; start < extraThreads; start += 8) {
    const batch: string[] = [];
    for (let i = start; i < Math.min(start + 8, extraThreads); i += 1) {
      batch.push(await say(garden, text(`${subjects[i % subjects.length]} (${i + 1})`)));
    }
    await Promise.all(
      batch.map(async (id, index) => {
        const i = start + index;
        await say(garden, {
          ...text('I added this to the garden checklist.'),
          'm.relates_to': { rel_type: 'm.thread', event_id: id },
        });
        if (i % 4 !== 0) {
          await sendStateEvent(
            HOMESERVER,
            reader.access_token,
            garden,
            'com.mindroom.thread.tags',
            JSON.stringify([id, 'resolved']),
            { set_by: reader.user_id, set_at: new Date().toISOString() }
          );
        }
      })
    );
  }
  return { username, root, userId: reader.user_id, roomId: garden, spaceId, spaceRoot };
};

const drawer = (page: Page) => page.locator('#phone-nav-drawer');
const menuButton = (page: Page) => page.locator('#phone-nav-menu-button');
const threadColumn = (page: Page) => page.getByTestId('thread-column');
const threadBack = (page: Page) => threadColumn(page).getByRole('button', { name: 'Back' }).last();
const card = (page: Page, root: string) =>
  page
    .locator(
      `[data-thread-root-id="${root}"]:not([data-swipe-under-thread], [data-swipe-under-thread] *)`
    )
    .first();

const onPhone = async (
  engine: (typeof ENGINES)[number],
  browser: Browser,
  username: string,
  options: { reducedMotion?: 'reduce'; heldAt?: number },
  check: (page: Page) => Promise<void>
) => {
  const own = engine === 'webkit' ? await launchWebKit() : browser;
  try {
    const context = await own.newContext({ ...PHONE, reducedMotion: options.reducedMotion });
    try {
      const page = await context.newPage();
      await recordSlides(page, options.heldAt);
      await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
      await check(page);
      expect(
        await page.evaluate(() => (window as unknown as Recorded).viewTransitions),
        'no browser view transitions'
      ).toBe(0);
    } finally {
      await context.close();
    }
  } finally {
    if (engine === 'webkit') await own.close();
  }
};

test.beforeAll(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `Disposable homeserver is not reachable at ${HOMESERVER}. Run \`just hs-up\` first.`
  );
});

for (const engine of ENGINES) {
  test(`${engine}: slides live 2-layer pages on Room ↔ Thread, Space All threads ↔ Thread, and PhoneNavDrawer`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { username, root, spaceId, spaceRoot } = await seed(engine);
    await onPhone(
      engine,
      browser,
      username,
      { heldAt: SHOTS ? HELD_AT_MS : undefined },
      async (page) => {
        // Home's own page: drawer is open, nothing slid on entry or reload.
        await expect(drawer(page)).toBeVisible();
        await expect(drawer(page).getByRole('link', { name: 'Garden Club' })).toBeVisible();
        expect(await takeSlides(page, 'signed in'), 'signing in').toEqual([]);
        await page.reload();
        await expect(drawer(page).getByRole('link', { name: 'Garden Club' })).toBeVisible({
          timeout: 60_000,
        });
        expect(await takeSlides(page, 'loaded again'), 'a fresh load').toEqual([]);

        const shot = async (name: string, liveSlide = false) => {
          if (!SHOTS) return;
          if (liveSlide) {
            await expect(page.locator('[data-swipe-thread-stage]')).toHaveCount(1);
            await page.waitForTimeout(100);
            await page.screenshot({ path: `${SHOTS}/${engine}-${name}.png` });
            await finishPausedSlides(page);
          } else {
            await page.waitForTimeout(150);
            await page.screenshot({ path: `${SHOTS}/${engine}-${name}.png` });
          }
        };

        // Opening a room from the drawer slides the drawer away over the stationary room.
        await spliceDrawerSlides(page);
        await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
        await shot('1-list-slides-away');
        await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
        await expect(drawer(page)).toBeHidden();
        expect(await takeSlides(page, 'a room from the list'), 'a room from the list').toEqual([]);
        expect(
          await takeDrawerSlide(page, 'a room from the list'),
          'the drawer slides away'
        ).toEqual(['transitionrun', 'transitionend']);

        // Room → Thread: live 2-layer forward push over inert Room with dim veil, shield, fixed top bar.
        await card(page, root).tap();
        await shot('2-room-to-thread', true);
        await expect(threadColumn(page)).toBeVisible();
        expect(await takeSlides(page, 'a thread from its room'), 'Room → Thread').toEqual([
          FORWARD,
        ]);

        // Thread → Room via Back button: live 2-layer back slide with shield and zero clones/canvases.
        await threadBack(page).tap();
        await shot('3-thread-to-room', true);
        await expect(threadColumn(page)).toBeHidden();
        expect(await takeSlides(page, 'back to the room'), 'Thread → Room').toEqual([BACK]);

        // Browser back (Room → Home list): drawer plays its own 280 ms slide-in, no page slide.
        await spliceDrawerSlides(page);
        await page.goBack();
        await shot('4-room-to-list');
        await expect(drawer(page)).toBeVisible();
        expect(await takeSlides(page, 'back to the list'), 'Room → Home list').toEqual([]);
        expect(await takeDrawerSlide(page, 'back to the list'), 'the drawer slides in').toEqual([
          'transitionrun',
          'transitionend',
        ]);

        // Pick another room, then toggle drawer via menu button.
        await spliceDrawerSlides(page);
        await drawer(page).getByRole('link', { name: 'Harbor Plans' }).tap();
        await expect(drawer(page)).toBeHidden();
        await takeSlides(page, 'the other room');
        await takeDrawerSlide(page, 'the other room');

        await spliceDrawerSlides(page);
        await menuButton(page).tap();
        await shot('5-drawer-open');
        await expect(drawer(page)).toBeVisible();
        expect(await takeSlides(page, 'menu open'), 'the page stays put').toEqual([]);
        expect(await takeDrawerSlide(page, 'menu open'), 'the drawer slides in').toEqual([
          'transitionrun',
          'transitionend',
        ]);
        await menuButton(page).tap();
        await expect(drawer(page)).toBeHidden();
        expect(await takeSlides(page, 'menu close'), 'the page stays put').toEqual([]);
        expect(await takeDrawerSlide(page, 'menu close'), 'the drawer slides away').toEqual([
          'transitionrun',
          'transitionend',
        ]);

        // Space All threads → Thread → Back: single Space-owned forward slide (no double-animate)
        // and live back slide back to Space All threads.
        await page.goto(`/${encodeURIComponent(spaceId)}/threads`);
        await expect(page.locator(`[data-space-threads-page="${spaceId}"]`)).toBeVisible({
          timeout: 60_000,
        });
        await expect(card(page, spaceRoot)).toBeVisible({ timeout: 60_000 });
        await takeSlides(page, 'arrived at Space All threads');

        await card(page, spaceRoot).tap();
        await shot('6-space-threads-to-thread', true);
        await expect(threadColumn(page)).toBeVisible();
        expect(
          await takeSlides(page, 'Space All threads → Thread'),
          'Space All threads → Thread (single Space-owned slide)'
        ).toEqual([FORWARD]);

        await threadBack(page).tap();
        await shot('7-thread-to-space-threads', true);
        await expect(page).toHaveURL(/\/threads\/?$/);
        await expect(page.locator(`[data-space-threads-page="${spaceId}"]`)).toBeVisible();
        expect(
          await takeSlides(page, 'Thread → Space All threads'),
          'Thread → Space All threads'
        ).toEqual([BACK]);
      }
    );
  });

  test(`${engine}: nothing slides for someone who asked for reduced motion`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { username, root, spaceId, spaceRoot } = await seed(`still${engine}`);
    await onPhone(engine, browser, username, { reducedMotion: 'reduce' }, async (page) => {
      await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
      await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
      await card(page, root).tap();
      await expect(threadColumn(page)).toBeVisible();
      await threadBack(page).tap();
      await expect(threadColumn(page)).toBeHidden();

      await page.goto(`/${encodeURIComponent(spaceId)}/threads`);
      await expect(card(page, spaceRoot)).toBeVisible({ timeout: 60_000 });
      await card(page, spaceRoot).tap();
      await expect(threadColumn(page)).toBeVisible();
      await threadBack(page).tap();
      await expect(page).toHaveURL(/\/threads\/?$/);

      expect(await takeSlides(page, 'reduced motion')).toEqual([]);
    });
  });

  test(`${engine}: scrolled Compact room preserves viewport positions across live forward and back slides`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const { username, userId, roomId } = await seed(`compact${engine}`, 32);
    await onPhone(engine, browser, username, {}, async (page) => {
      await seedRoomOverviewState({
        page,
        userId,
        roomId,
        viewMode: 'compact',
        filterState: { ...createDefaultThreadFilterState(), sortBy: 'natural' },
      });
      await page.evaluate((id) => {
        localStorage.setItem(`compactRoomSections:${id}`, JSON.stringify({ on: true, folded: [] }));
      }, userId);
      await page.goto(`/home/${encodeURIComponent(roomId)}/`);
      const view = page.locator('[data-phone-stage] > [data-phone-page] [data-compact-room-view]');
      await expect(view).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(() => view.evaluate((el) => el.scrollHeight > el.clientHeight * 2), {
          timeout: 60_000,
        })
        .toBe(true);

      await view.evaluate((el) => {
        el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * 0.55);
      });
      await expect
        .poll(() =>
          view.evaluate((scroller) =>
            scroller
              .getAnimations({ subtree: true })
              .some((animation) =>
                (animation.effect as KeyframeEffect | null)?.target?.hasAttribute('data-motion-row')
              )
          )
        )
        .toBe(false);

      const initial = await view.evaluate((scroller) => {
        const { top, bottom, left, right } = scroller.getBoundingClientRect();
        const visible = Array.from(scroller.querySelectorAll<HTMLElement>('[data-thread-root-id]'))
          .map((row) => ({
            id: row.dataset.threadRootId ?? '',
            rect: row.getBoundingClientRect(),
          }))
          .filter(
            ({ id, rect }) =>
              id && rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right
          )
          .map(({ id, rect }) => ({ id, y: rect.top - top, height: rect.height }));
        return { scrollTop: scroller.scrollTop, height: bottom - top, visible };
      });
      expect(initial.scrollTop).toBeGreaterThan(initial.height);
      expect(initial.visible.length).toBeGreaterThan(2);

      const tappable = initial.visible.filter(
        ({ y, height }) => y >= 80 && y + height <= initial.height - 80
      );
      const opened = tappable[Math.floor(tappable.length / 2)]!;
      await takeSlides(page, 'before tapping scrolled card');

      await card(page, opened.id).tap();
      await expect(threadColumn(page)).toBeVisible();
      expect(await takeSlides(page, 'scrolled Room → Thread')).toEqual([FORWARD]);

      await threadBack(page).tap();
      await expect(threadColumn(page)).toBeHidden();
      expect(await takeSlides(page, 'scrolled Thread → Room')).toEqual([BACK]);

      const anchors = initial.visible.filter(
        ({ y, height }) => y >= 0 && y + height <= initial.height
      );
      await expect
        .poll(() =>
          view.evaluate((scroller, rows) => {
            const top = scroller.getBoundingClientRect().top;
            return rows.every(({ id, y }) => {
              const row = scroller.querySelector(`[data-thread-root-id="${CSS.escape(id)}"]`);
              return row && Math.abs(row.getBoundingClientRect().top - top - y) <= 2;
            });
          }, anchors)
        )
        .toBe(true);
    });
  });
}
