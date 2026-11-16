import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
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
// (src/app/navigation/phonePageSlide.ts); the menu button brings the list back the same way. The
// page under moves a third as far, and the top bar stays. Where the list goes away (a room tapped
// in it, the menu button again), the page stays put and the drawer slides away to the left over
// it. Nothing slides between two pages of the same depth, or for someone who asked for reduced
// motion. 390 by 844 with touch.
// Set PAGE_SLIDE_SHOTS=<directory> to save a frame of each slide with the motion slowed to a tenth.
const PASSWORD = 'phone-page-slide-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.PAGE_SLIDE_SHOTS;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** A slide: its direction, and what the browser played on which picture. */
type Slide = { direction: string; plays: string[] };

const FORWARD: Slide = {
  direction: 'forward',
  plays: [
    '::view-transition-new(phone-stage) phone-page-over-in',
    '::view-transition-old(phone-stage) phone-page-under-out',
  ],
};
const BACK: Slide = {
  direction: 'back',
  plays: [
    '::view-transition-new(phone-stage) phone-page-under-in',
    '::view-transition-old(phone-stage) phone-page-over-out',
  ],
};

const recordSlides = (page: Page) =>
  page.addInitScript(() => {
    const slides: Slide[] = [];
    (window as unknown as { pageSlides: Slide[] }).pageSlides = slides;
    // The document has no root element yet: both listen on the document.
    new MutationObserver(() => {
      const direction = document.documentElement.getAttribute('data-page-slide');
      if (direction) slides.push({ direction, plays: [] });
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-page-slide'] });
    document.addEventListener('animationstart', (event) => {
      if (!event.pseudoElement.startsWith('::view-transition')) return;
      slides.at(-1)?.plays.push(`${event.pseudoElement} ${event.animationName}`);
    });
    // What the drawer's own slide does: it starts, and plays to its end or is cut short.
    const drawerSlides: string[] = [];
    (window as unknown as { drawerSlides: string[] }).drawerSlides = drawerSlides;
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
  });

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
  const slides = await page.evaluate(() =>
    (window as unknown as { pageSlides: Slide[] }).pageSlides.splice(0)
  );
  return slides.map(({ direction, plays }) => ({ direction, plays: [...plays].sort() }));
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
// The thread's own Back, under the room header's, which leads to the list.
const threadBack = (page: Page) => threadColumn(page).getByRole('button', { name: 'Back' }).last();
const card = (page: Page, root: string) => page.locator(`[data-thread-root-id="${root}"]`).first();

test.describe('a phone slides its pages', () => {
  test.beforeEach(async () => {
    test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');
  });

  test('the list slides away over a room, and a thread comes in from the right', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { username, root } = await seed('slides');
    await recordSlides(page);
    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
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

    // The slides slowed to a tenth, for a frame of each mid-way.
    const slow = SHOTS ? await page.context().newCDPSession(page) : undefined;
    await slow?.send('Animation.enable');
    await slow?.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
    const shot = async (name: string) => {
      if (!SHOTS) return;
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}/${name}.png` });
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
    await shot('2-thread-comes-in');
    await expect(threadColumn(page)).toBeVisible();
    expect(await takeSlides(page, 'a thread from its room'), 'a thread from its room').toEqual([
      FORWARD,
    ]);

    await threadBack(page).tap();
    await shot('3-thread-leaves');
    await expect(threadColumn(page)).toBeHidden();
    expect(await takeSlides(page, 'back to the room'), 'back to the room').toEqual([BACK]);

    await page.getByRole('banner').getByRole('button', { name: 'Back' }).tap();
    await shot('4-room-leaves');
    await expect(drawer(page)).toBeVisible();
    expect(await takeSlides(page, 'back to the list'), 'back to the list').toEqual([BACK]);

    // Another section's list in the place of this one: as deep as before, nothing slides.
    await drawer(page).getByRole('link', { name: 'Harbor Plans' }).tap();
    await expect(drawer(page)).toBeHidden();
    await takeSlides(page, 'the other room');
    await takeDrawerSlide(page, 'the other room');

    // The menu button moves between the page and the list the same way.
    await menuButton(page).tap();
    await shot('5-list-comes-back');
    await expect(drawer(page)).toBeVisible();
    expect(await takeSlides(page, 'the menu button'), 'the list comes back').toEqual([BACK]);
    await spliceDrawerSlides(page);
    await menuButton(page).tap();
    await expect(drawer(page)).toBeHidden();
    expect(await takeSlides(page, 'the menu button again'), 'the page stays put').toEqual([]);
    expect(await takeDrawerSlide(page, 'the menu button again'), 'the drawer slides away').toEqual([
      'transitionrun',
      'transitionend',
    ]);
  });

  test('nothing slides for someone who asked for reduced motion', async ({ page }) => {
    test.setTimeout(180_000);
    const { username, root } = await seed('still');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await recordSlides(page);
    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
    await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
    await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
    await card(page, root).tap();
    await expect(threadColumn(page)).toBeVisible();
    await threadBack(page).tap();
    await expect(threadColumn(page)).toBeHidden();
    expect(await takeSlides(page, 'reduced motion')).toEqual([]);
  });
});
