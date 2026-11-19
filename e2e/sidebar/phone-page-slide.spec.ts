import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  createPrivateRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// On a phone, a thread comes in from the right edge over its room, and a thread or a room leaves
// to it on the way back to the room or the list, as a page of a phone's own apps does
// (src/app/navigation/phonePageSlide.ts). The page under moves a third as far, and the top bar
// stays. The menu button brings the list out over the page, which stays put while the drawer
// slides in from the left on its own. Where the list goes away (a room tapped in it, the menu
// button again), the page stays put too and the drawer slides away to the left over it. Nothing
// slides between two pages of the same depth, or for someone who asked for reduced motion. The
// slide is the page's own (a still copy of the layout as it was, and the layout, moved past each
// other), never a view transition of the browser, and the copy is gone when it ends. 390 by 844
// with touch, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in
// WebKit.
// Set PAGE_SLIDE_SHOTS=<directory> to save a frame of each slide: a page slide held half-way,
// and in Chromium the drawer's with the motion slowed to a tenth.
const PASSWORD = 'phone-page-slide-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.PAGE_SLIDE_SHOTS;
const ENGINES = ['chromium', ...(WEBKIT_EXECUTABLE ? ['webkit'] : [])] as const;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
/** How far into its 280 ms a slide is held for its frame: half its way. */
const HELD_AT_MS = 60;

test.use(PHONE);

/**
 * A slide: its direction, what played on the layout (`page`) and on the copy of the layout as it
 * was, how many copies showed, and what a tap in the middle of the screen would land on.
 */
type Slide = { direction: string; plays: string[]; copies?: number; tapLandsOn?: string };
type Recorded = { pageSlides: Slide[]; viewTransitions: number; drawerSlides: string[] };

const FORWARD: Slide = {
  direction: 'forward',
  plays: ['copy phone-page-under-out', 'page phone-page-over-in'],
  copies: 1,
  tapLandsOn: 'HTML',
};
const BACK: Slide = {
  direction: 'back',
  plays: ['copy phone-page-over-out', 'page phone-page-under-in'],
  copies: 1,
  tapLandsOn: 'HTML',
};

const recordSlides = (page: Page, heldAt?: number) =>
  page.addInitScript((held) => {
    const slides: Slide[] = [];
    const recorded = window as unknown as Recorded;
    recorded.pageSlides = slides;
    recorded.viewTransitions = 0;
    // Every view transition the page asks the browser for: none.
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
    // The document has no root element yet: both listen on the document.
    new MutationObserver(() => {
      const direction = document.documentElement.getAttribute('data-page-slide');
      if (direction) slides.push({ direction, plays: [] });
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-page-slide'] });
    document.addEventListener('animationstart', (event) => {
      const slide = slides.at(-1);
      if (!slide || !event.animationName.startsWith('phone-page-')) return;
      const copy = (event.target as Element).closest('[data-page-slide-copy]');
      const play = `${copy ? 'copy' : 'page'} ${event.animationName}`;
      if (!slide.plays.includes(play)) slide.plays.push(play);
      slide.copies = document.querySelectorAll('[data-page-slide-copy]').length;
      slide.tapLandsOn = document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.tagName;
      if (held === undefined) return;
      document.getAnimations().forEach((animation) => {
        if (!(animation as CSSAnimation).animationName?.startsWith('phone-page-')) return;
        animation.pause();
        animation.currentTime = held;
      });
    });
    // What the drawer's own slide does: it starts, and plays to its end or is cut short.
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

/** What the drawer's own slide did since the last call, which forgets it. */
const spliceDrawerSlides = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { drawerSlides: string[] }).drawerSlides.splice(0));

/** The drawer's own slide since the last call, once it has ended. */
const takeDrawerSlide = async (page: Page, step: string): Promise<string[]> => {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as unknown as { drawerSlides: string[] }).drawerSlides.some(
            (each) => each !== 'transitionrun'
          )
        ),
      { message: `${step}: the drawer's slide ends`, timeout: 30_000 }
    )
    .toBe(true);
  return spliceDrawerSlides(page);
};

/** The slides since the last call, once the one that plays has ended. */
const takeSlides = async (page: Page, step: string): Promise<Slide[]> => {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-page-slide')), {
      message: `${step}: the slide ends`,
    })
    .toBe(false);
  await expect(page.locator('[data-page-slide-copy]'), `${step}: the copy is gone`).toHaveCount(0);
  const slides = await page.evaluate(() =>
    (window as unknown as { pageSlides: Slide[] }).pageSlides.splice(0)
  );
  return slides.map((slide) => ({ ...slide, plays: [...slide.plays].sort() }));
};

const text = (body: string) => ({ msgtype: 'm.text', body });

const seed = async (test: string) => {
  const username = `pps_${test}_${RUN}`;
  const reader = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  // The rooms have an agent, as MindRoom rooms do, so they open in Compact.
  const agent = await registerAgentAccount(HOMESERVER, `pps${test}`);
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
  return { username, root };
};

const drawer = (page: Page) => page.locator('#phone-nav-drawer');
const menuButton = (page: Page) => page.locator('#phone-nav-menu-button');
const threadColumn = (page: Page) => page.getByTestId('thread-column');
// The thread's own Back, in its banner.
const threadBack = (page: Page) => threadColumn(page).getByRole('button', { name: 'Back' }).last();
const card = (page: Page, root: string) => page.locator(`[data-thread-root-id="${root}"]`).first();

/** Runs `check` on a phone's page in `engine`, signed in as `username`. */
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
        'the page asks the browser for no view transition'
      ).toBe(0);
    } finally {
      await context.close();
    }
  } finally {
    if (engine === 'webkit') await own.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');
});

for (const engine of ENGINES) {
  test(`${engine}: the list slides away over a room, and a thread comes in from the right`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { username, root } = await seed(`slides${engine}`);
    await onPhone(engine, browser, username, { heldAt: SHOTS ? HELD_AT_MS : undefined }, (page) =>
      slidesItsPages(page, root, engine)
    );
  });

  test(`${engine}: nothing slides for someone who asked for reduced motion`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { username, root } = await seed(`still${engine}`);
    await onPhone(engine, browser, username, { reducedMotion: 'reduce' }, async (page) => {
      await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
      await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
      await card(page, root).tap();
      await expect(threadColumn(page)).toBeVisible();
      await threadBack(page).tap();
      await expect(threadColumn(page)).toBeHidden();
      expect(await takeSlides(page, 'reduced motion')).toEqual([]);
    });
  });
}

const slidesItsPages = async (page: Page, root: string, engine: (typeof ENGINES)[number]) => {
  {
    // Home's own page: the list is out.
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByRole('link', { name: 'Garden Club' })).toBeVisible();
    // Nothing slid on the way in: the list was out with the first page. Nor on a fresh load.
    expect(await takeSlides(page, 'signed in'), 'signing in').toEqual([]);
    await page.reload();
    await expect(drawer(page).getByRole('link', { name: 'Garden Club' })).toBeVisible({
      timeout: 60_000,
    });
    expect(await takeSlides(page, 'loaded again'), 'a fresh load').toEqual([]);

    // A frame of each slide mid-way: a page slide is held there (`recordSlides`) until its copy
    // goes, and Chromium slows the drawer's to a tenth.
    const slow =
      SHOTS && engine === 'chromium' ? await page.context().newCDPSession(page) : undefined;
    await slow?.send('Animation.enable');
    await slow?.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
    const shot = async (name: string, pageSlide = false) => {
      if (!SHOTS || !(pageSlide || slow)) return;
      if (pageSlide) await expect(page.locator('[data-page-slide-copy]')).toHaveCount(1);
      await page.waitForTimeout(pageSlide ? 300 : 900);
      await page.screenshot({ path: `${SHOTS}/${engine}-${name}.png` });
    };

    // Whatever the drawer did on the way in is no part of what follows.
    await spliceDrawerSlides(page);
    await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
    await shot('1-list-slides-away');
    await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
    await expect(drawer(page)).toBeHidden();
    // The page stays put, and the drawer slides away over the room to its end.
    expect(await takeSlides(page, 'a room from the list'), 'a room from the list').toEqual([]);
    expect(await takeDrawerSlide(page, 'a room from the list'), 'the drawer slides away').toEqual([
      'transitionrun',
      'transitionend',
    ]);

    await card(page, root).tap();
    await shot('2-thread-comes-in', true);
    await expect(threadColumn(page)).toBeVisible();
    expect(await takeSlides(page, 'a thread from its room'), 'a thread from its room').toEqual([
      FORWARD,
    ]);

    await threadBack(page).tap();
    await shot('3-thread-leaves', true);
    await expect(threadColumn(page)).toBeHidden();
    expect(await takeSlides(page, 'back to the room'), 'back to the room').toEqual([BACK]);

    // The browser's back (Android's back button) leaves the room for the list.
    await page.goBack();
    await shot('4-room-leaves', true);
    await expect(drawer(page)).toBeVisible();
    expect(await takeSlides(page, 'back to the list'), 'back to the list').toEqual([BACK]);

    // Another section's list in the place of this one: as deep as before, nothing slides.
    await drawer(page).getByRole('link', { name: 'Harbor Plans' }).tap();
    await expect(drawer(page)).toBeHidden();
    await takeSlides(page, 'the other room');
    await takeDrawerSlide(page, 'the other room');

    // The menu button brings the list out over the page, which stays put, and puts it away.
    await spliceDrawerSlides(page);
    await menuButton(page).tap();
    await shot('5-list-comes-out');
    await expect(drawer(page)).toBeVisible();
    expect(await takeSlides(page, 'the menu button'), 'the page stays put').toEqual([]);
    expect(await takeDrawerSlide(page, 'the menu button'), 'the drawer slides in').toEqual([
      'transitionrun',
      'transitionend',
    ]);
    await menuButton(page).tap();
    await expect(drawer(page)).toBeHidden();
    expect(await takeSlides(page, 'the menu button again'), 'the page stays put').toEqual([]);
    expect(await takeDrawerSlide(page, 'the menu button again'), 'the drawer slides away').toEqual([
      'transitionrun',
      'transitionend',
    ]);
  }
};
