import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
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
/** A picture of one pixel. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test.use(PHONE);

/**
 * A slide: its direction, what played on the layout (`page`) and on the copy of the layout as it
 * was, how many copies showed, what a tap in the middle of the screen would land on, and where
 * the layout was when its slide started, in hundredths of the screen's width: at the slide's
 * start, where it is held until the page that slides in has been drawn.
 */
type Slide = {
  direction: string;
  plays: string[];
  copies?: number;
  tapLandsOn?: string;
  startsAt?: number;
};
type Recorded = { pageSlides: Slide[]; viewTransitions: number; drawerSlides: string[] };

const FORWARD: Slide = {
  direction: 'forward',
  plays: ['copy phone-page-under-out', 'page phone-page-over-in'],
  copies: 1,
  tapLandsOn: 'the layout',
  startsAt: 100,
};
const BACK: Slide = {
  direction: 'back',
  plays: ['copy phone-page-over-out', 'page phone-page-under-in'],
  copies: 1,
  tapLandsOn: 'the layout',
  startsAt: -30,
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
      // On the layout itself, not on a part of it: on the shield the layout lays over its parts.
      const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      slide.tapLandsOn = hit?.hasAttribute('data-phone-stage') ? 'the layout' : hit?.tagName;
      if (!copy && slide.startsAt === undefined) {
        const moved = parseFloat(getComputedStyle(event.target as Element).translate);
        slide.startsAt = Math.round((moved / innerWidth) * 100);
      }
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

const seed = async (test: string, extraThreads = 0) => {
  const username = `pps_${test}_${RUN}`;
  const reader = await matrixFetch<{ access_token: string; user_id: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
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
  const subjects = [
    'Water the new plants',
    'Plan the harvest',
    'Mend the greenhouse',
    'Clean the tools',
  ];
  // Send roots in order so their timestamps are stable, with at most eight replies in flight.
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
  return { username, root, userId: reader.user_id, roomId: garden };
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

  test(`${engine}: a slide leaves the page's own fields as they are`, async ({ browser }) => {
    test.setTimeout(180_000);
    const { username, root } = await seed(`fields${engine}`);
    // Held: the copy stays in the page until the slide gives up on its end.
    await onPhone(engine, browser, username, { heldAt: HELD_AT_MS }, async (page) => {
      await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
      await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
      // Fields as a card in the page has them: radio buttons outside a form, and a typed secret.
      await page.locator('[data-phone-stage] > [data-phone-page]').evaluate((phonePage) => {
        phonePage.insertAdjacentHTML(
          'beforeend',
          '<div data-pps-fields style="position: absolute; pointer-events: none">' +
            '<input type="radio" name="pps-keep" value="once">' +
            '<input type="radio" name="pps-keep" value="day">' +
            '<input type="text" name="pps-secret"></div>'
        );
        const [, day, secret] = Array.from(phonePage.querySelectorAll('[data-pps-fields] input'));
        (day as HTMLInputElement).checked = true;
        (secret as HTMLInputElement).value = 'typed-secret';
      });
      const fields = () =>
        page.evaluate(() => {
          const values = (within: Element | null) =>
            Array.from(within?.querySelectorAll('input') ?? [], (field) =>
              field.type === 'radio' ? field.checked : field.value
            );
          const live = '[data-phone-stage] > [data-phone-page] > [data-pps-fields]';
          const still = document.querySelector('[data-page-slide-copy] [data-pps-fields]');
          return {
            page: values(document.querySelector(live)),
            copy: values(still),
            named: still?.querySelectorAll('[name]').length,
          };
        });

      await card(page, root).tap();
      await expect(page.locator('[data-page-slide-copy]')).toHaveCount(1);
      // The copy looks as the page did but for what was typed, and is no part of its radio group.
      expect(await fields(), 'while the copy shows').toEqual({
        page: [false, true, 'typed-secret'],
        copy: [false, true, ''],
        named: 0,
      });
      await expect(threadColumn(page)).toBeVisible();
      await takeSlides(page, 'a thread from its room');
      expect((await fields()).page, 'after the slide').toEqual([false, true, 'typed-secret']);
    });
  });

  test(`${engine}: the copy a slide shows asks the network for nothing`, async ({ browser }) => {
    test.setTimeout(180_000);
    const { username, root } = await seed(`media${engine}`);
    // Held: the copy stays in the page until the slide gives up on its end.
    await onPhone(engine, browser, username, { heldAt: HELD_AT_MS }, async (page) => {
      // Pictures the browser may not keep: every showing of one from the network is a request.
      const requests: string[] = [];
      await page.route('**/pps-media/*', (route) => {
        const { pathname } = new URL(route.request().url());
        requests.push(pathname);
        if (pathname.endsWith('/missing.png')) return route.fulfill({ status: 404 });
        return route.fulfill({
          contentType: 'image/png',
          headers: { 'Cache-Control': 'no-store' },
          body: PIXEL,
        });
      });
      await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
      await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
      // In the page: a picture from the network, a `picture` whose source picks another, one the
      // page holds in memory, as the app's avatars and message pictures are, one whose address
      // the page has let go of since (the app does with avatars it has not shown for a while),
      // and one that failed to load.
      await page.locator('[data-phone-stage] > [data-phone-page]').evaluate(async (phonePage) => {
        const memory = async () =>
          URL.createObjectURL(await (await fetch('/pps-media/held.png')).blob());
        const [held, gone] = [await memory(), await memory()];
        phonePage.insertAdjacentHTML(
          'beforeend',
          '<div data-pps-media style="position: absolute; pointer-events: none">' +
            '<img src="/pps-media/network.png">' +
            '<picture><source srcset="/pps-media/source.png"><img src="/pps-media/fallback.png">' +
            `</picture><img src="${held}"><img src="${gone}"><img src="/pps-media/missing.png">` +
            '</div>'
        );
        const pictures = Array.from(phonePage.querySelectorAll('[data-pps-media] img'));
        await Promise.allSettled(pictures.map((picture) => (picture as HTMLImageElement).decode()));
        URL.revokeObjectURL(gone);
      });
      const before = [...requests].sort();
      expect(before, 'the page loads each picture once').toEqual(
        ['held', 'held', 'missing', 'network', 'source'].map((name) => `/pps-media/${name}.png`)
      );

      await card(page, root).tap();
      await expect(page.locator('[data-page-slide-copy]')).toHaveCount(1);
      const copied = await page
        .locator('[data-page-slide-copy] [data-pps-media]')
        .evaluate((media) =>
          Array.from(media.querySelectorAll('img, canvas'), (picture) => {
            if (!(picture instanceof HTMLCanvasElement)) {
              return picture.hasAttribute('src') ? 'a picture to load' : 'a blank box';
            }
            const [red = 0, , , alpha = 0] = picture
              .getContext('2d')!
              .getImageData(0, 0, 1, 1).data;
            return red > 200 && alpha > 0 ? 'drawn' : 'an empty canvas';
          })
        );
      // Each picture the page shows is drawn in the copy at once, with nothing to load or decode,
      // the one whose address is gone too; the one that failed is a blank box.
      expect
        .soft(copied, 'the pictures of the copy')
        .toEqual(['drawn', 'drawn', 'drawn', 'drawn', 'a blank box']);
      expect
        .soft(
          await page.locator('[data-page-slide-copy] :is([srcset], source[src])').count(),
          'the copy names no source to pick from'
        )
        .toBe(0);
      await expect(threadColumn(page)).toBeVisible();
      await takeSlides(page, 'a thread from its room');
      // Time for a request that started with the copy to reach the network.
      await page.waitForTimeout(1_000);
      expect([...requests].sort(), 'the slide asked the network for no picture').toEqual(before);
    });
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

test('webkit: a still copy keeps its layout when the viewport grows or text shrinks', async ({
  browser,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'needs Playwright WebKit');
  const { username, root } = await seed('clip');
  await onPhone('webkit', browser, username, { heldAt: HELD_AT_MS }, async (page) => {
    await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
    await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
    const stage = page.locator('[data-phone-stage]');
    const siblingY = await stage.evaluate((stage) => {
      // The browser has no iOS keyboard. Cap the stage and its copy with one adjustable box.
      document.head.insertAdjacentHTML(
        'beforeend',
        `<style data-slide-test-style>
        [data-phone-stage], [data-page-slide-copy] {
          height: var(--slide-test-height) !important;
          max-height: var(--slide-test-height) !important;
          flex: none !important;
        }
      </style>`
      );
      document.documentElement.style.setProperty('--slide-test-height', '450px');
      const phonePage = stage.querySelector('[data-phone-page]')!;
      phonePage.insertAdjacentHTML(
        'beforeend',
        '<div data-probe-scroll style="position:absolute;top:0;left:0;height:140px;width:110px;overflow:auto;overflow-anchor:none;pointer-events:none">' +
          '<div data-page-slide-clip><div style="height:400px">Offscreen clip</div></div>' +
          '<div data-probe-sibling style="height:350px">Visible sibling</div></div>' +
          '<div data-probe-grow data-page-slide-clip style="position:absolute;top:0;bottom:0;left:120px;width:120px;overflow:auto;pointer-events:none">' +
          '<div data-page-slide-row style="height:3rem"><span>Garden task</span></div>'.repeat(65) +
          '</div>'
      );
      const scroller = phonePage.querySelector<HTMLElement>('[data-probe-scroll]')!;
      scroller.scrollTop = 430;
      return (
        scroller.querySelector('[data-probe-sibling]')!.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top
      );
    });
    try {
      await card(page, root).tap();
      const still = page.locator('[data-page-slide-copy]');
      await expect(still).toHaveCount(1);
      const layout = await still.evaluate(async (copy) => {
        const stage = copy.parentElement!;
        const scroller = copy.querySelector('[data-probe-scroll]')!;
        const sibling = scroller.querySelector('[data-probe-sibling]')!;
        const rows = Array.from(copy.querySelectorAll('[data-probe-grow] [data-page-slide-row]'));
        const read = () => {
          const { top, bottom } = stage.getBoundingClientRect();
          const visible = rows.filter((row) => {
            const box = row.getBoundingClientRect();
            return box.top < bottom && box.bottom > top;
          });
          return {
            visible: visible.length,
            empty: visible.filter((row) => !row.firstChild).length,
          };
        };
        const y = sibling.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        const before = read();
        const frame = () =>
          new Promise<void>((done) => {
            requestAnimationFrame(() => requestAnimationFrame(() => done()));
          });
        document.documentElement.style.setProperty('--slide-test-height', '844px');
        await frame();
        const grown = read();
        document.documentElement.style.fontSize = '80%';
        await frame();
        return { y, before, grown, zoomed: read(), playing: copy.isConnected };
      });
      expect(layout.y).toBeCloseTo(siblingY, 0);
      expect(layout.grown.visible).toBeGreaterThan(layout.before.visible);
      expect(layout.zoomed.visible).toBeGreaterThan(layout.grown.visible);
      expect([layout.before.empty, layout.grown.empty, layout.zoomed.empty]).toEqual([0, 0, 0]);
      expect(layout.playing).toBe(true);
    } finally {
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('font-size');
        document.documentElement.style.removeProperty('--slide-test-height');
        document.querySelector('[data-slide-test-style]')?.remove();
      });
    }
  });
});

test('webkit: a scrolled Compact room copies what shows, not every card', async ({ browser }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'needs Playwright WebKit');
  test.setTimeout(240_000);
  const threadCount = process.env.PAGE_SLIDE_THREADS === '730' ? 730 : 250;
  const { username, userId, roomId } = await seed('long', threadCount);
  await onPhone('webkit', browser, username, { heldAt: HELD_AT_MS }, async (page) => {
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
    await page.reload();
    await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
    await expect(drawer(page)).toBeHidden();
    const view = '[data-compact-room-view]';
    const cards = '[data-thread-root-id]';
    const before = page.locator(`[data-phone-stage] > [data-phone-page] ${view}`);
    // The original example includes a root with no replies, which older history may omit.
    await expect
      .poll(() => before.locator(cards).count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(threadCount);
    await expect(before).not.toHaveAttribute('data-cards-pending', 'true');
    const scroll = () =>
      before.evaluate((view) => {
        view.scrollTop = view.scrollHeight * 0.6;
      });
    await scroll();
    const settleCards = () =>
      expect
        .poll(() =>
          before.evaluate((scroller) =>
            scroller
              .getAnimations({ subtree: true })
              .some((animation) =>
                (animation.effect as KeyframeEffect | null)?.target?.hasAttribute('data-motion-row')
              )
          )
        )
        .toBe(false);
    await settleCards();
    const finishSlide = async () => {
      await page.evaluate(() => {
        document.getAnimations().forEach((animation) => {
          if ((animation as CSSAnimation).animationName?.startsWith('phone-page-'))
            animation.finish();
        });
      });
      await takeSlides(page, 'the held slide');
    };
    const point = await before.evaluate((scroller) => {
      const { x, y, width, height } = scroller.getBoundingClientRect();
      const middle = x + width / 2;
      const target = [0, 20, -20]
        .map((offset) => y + height / 2 + offset)
        .find((at) => document.elementFromPoint(middle, at)?.closest('[data-thread-root-id]'));
      if (target === undefined) throw new Error('No card at the middle of the scroller');
      return { x: middle, y: target };
    });
    await page.evaluate(() => {
      let tap: number | undefined;
      document.addEventListener(
        'click',
        () => {
          tap = performance.now();
        },
        { capture: true, once: true }
      );
      document.addEventListener(
        'animationstart',
        (event) => {
          const timing = window as unknown as { firstFrameMs?: number };
          if (event.animationName === 'phone-page-under-out' && tap !== undefined)
            timing.firstFrameMs ??= performance.now() - tap;
        },
        true
      );
    });
    await page.touchscreen.tap(point.x, point.y);
    const frameMs = await page
      .waitForFunction(
        () => (window as unknown as { firstFrameMs?: number }).firstFrameMs!,
        undefined,
        { timeout: 30_000 }
      )
      .then((time) => time.jsonValue());
    await expect(threadColumn(page)).toBeVisible();
    await finishSlide();
    await threadBack(page).tap();
    await expect(threadColumn(page)).toBeHidden();
    await finishSlide();
    await expect(before).not.toHaveAttribute('data-cards-pending', 'true');
    await scroll();
    await settleCards();
    const initial = await before.evaluate((scroller, shooting) => {
      const read = (scroller: Element) => {
        const { top, bottom, left, right } = scroller.getBoundingClientRect();
        const visible = Array.from(scroller.querySelectorAll<HTMLElement>('[data-thread-root-id]'))
          .map((row) => ({
            id: row.dataset.threadRootId,
            title: row.querySelector('[title]')?.getAttribute('title'),
            rect: row.getBoundingClientRect(),
          }))
          .filter(
            ({ rect }) =>
              rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right
          )
          .map(({ id, title, rect }) => ({
            id,
            title,
            y: rect.top - top,
            x: rect.left - left,
            width: rect.width,
            height: rect.height,
          }));
        return {
          nodes: scroller
            .closest('[data-page-slide-copy], [data-phone-stage]')!
            .querySelectorAll('*').length,
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          visible,
          height: bottom - top,
        };
      };

      type Layout = ReturnType<typeof read>;
      let live: Layout | undefined;
      document.addEventListener(
        'click',
        () => {
          live = read(scroller);
        },
        { capture: true, once: true }
      );
      document.addEventListener('animationstart', (event) => {
        if (event.animationName === 'phone-page-over-out') {
          const still = document.querySelector('[data-page-slide-copy]');
          (window as unknown as { backNodes?: number }).backNodes =
            still?.querySelectorAll('*').length;
        }
        if (event.animationName !== 'phone-page-under-out' || !live) return;
        const copy = document.querySelector('[data-page-slide-copy] [data-compact-room-view]');
        const capture = window as unknown as {
          snapshot?: { layout: Layout; live: Layout };
        };
        if (copy && !capture.snapshot) capture.snapshot = { layout: read(copy), live };
      });
      if (shooting) {
        // Keep the held copy around long enough for a screenshot even on a slow renderer.
        const clock: Window = window;
        const later = clock.setTimeout.bind(clock);
        clock.setTimeout = (handler, delay, ...args: unknown[]) =>
          later(
            handler,
            delay === 2_000 && !!document.documentElement.dataset.pageSlide ? 120_000 : delay,
            ...args
          );
      }
      return read(scroller);
    }, !!SHOTS);
    expect(initial.nodes).toBeGreaterThan(6_000);
    expect(initial.scrollTop).toBeGreaterThan(10_000);
    expect(initial.visible.length).toBeGreaterThan(2);
    expect(initial.visible.every(({ title }) => !!title)).toBe(true);

    // A partial row or one behind the glass bars belongs in the copy, but is not a tap target.
    const tappable = initial.visible.filter(
      ({ y, height }) => y >= 80 && y + height <= initial.height - 80
    );
    const opened = tappable[Math.floor(tappable.length / 2)]!;
    const viewBox = (await before.boundingBox())!;
    await page.touchscreen.tap(
      viewBox.x + opened.x + opened.width / 2,
      viewBox.y + opened.y + opened.height / 2
    );
    const { layout: snapshot, live } = await page
      .waitForFunction(
        () => {
          type Capture = { layout: typeof initial; live: typeof initial };
          return (window as unknown as { snapshot?: Capture }).snapshot!;
        },
        undefined,
        { timeout: 30_000 }
      )
      .then((capture) => capture.jsonValue());
    console.log('Compact slide:', { frameMs, liveNodes: live.nodes, copyNodes: snapshot.nodes });
    if (SHOTS) {
      await page
        .locator('[data-page-slide-copy] > *')
        .evaluateAll((parts) => parts.map((part) => getComputedStyle(part).translate));
      await page.screenshot({ path: `${SHOTS}/webkit-large-compact-slide.png` });
    }
    await expect(threadColumn(page)).toBeVisible();
    expect(snapshot.scrollTop).toBeCloseTo(live.scrollTop, 0);
    expect(snapshot.scrollHeight).toBe(live.scrollHeight);
    expect(snapshot.visible.map(({ id, title }) => ({ id, title }))).toEqual(
      live.visible.map(({ id, title }) => ({ id, title }))
    );
    snapshot.visible.forEach((row, index) => {
      for (const axis of ['x', 'y', 'width', 'height'] as const) {
        expect(row[axis]).toBeCloseTo(live.visible[index]![axis], 0);
      }
    });
    expect(snapshot.nodes).toBeLessThan(2_400);

    await finishSlide();
    await threadBack(page).tap();
    const backNodes = await page
      .waitForFunction(() => (window as unknown as { backNodes?: number }).backNodes!, undefined, {
        timeout: 10_000,
      })
      .then((count) => count.jsonValue());
    expect(backNodes).toBeLessThan(2_000);
    await expect(threadColumn(page)).toBeHidden();
    console.log('Compact back slide:', { copyNodes: backNodes });
  });
});

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
      // WebKit draws a slide held while it played where it is held only once its style is read.
      if (pageSlide) {
        await page
          .locator('[data-page-slide-copy] > *')
          .evaluateAll((parts) => parts.map((part) => getComputedStyle(part).translate));
      }
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
