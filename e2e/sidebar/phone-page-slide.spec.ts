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

// On a phone, what shows deeper comes in from the right edge and leaves to it on the way back, as
// a page of a phone's own apps does (src/app/navigation/phonePageSlide.ts): a room over the list,
// a thread over its room, and back; the menu button moves between the list and the page the same
// way. The page under moves a third as far, and the top bar stays. Nothing slides between two
// pages of the same depth, or for someone who asked for reduced motion. 390 by 844 with touch.
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
  });

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

const seed = async () => {
  const username = `pps_${RUN}`;
  const reader = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  // The rooms have an agent, as MindRoom rooms do, so they open in Compact.
  const agent = await registerAgentAccount(HOMESERVER, 'ppsa');
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
const card = (page: Page, root: string) => page.locator(`[data-thread-root-id="${root}"]`).first();

test.describe('a phone slides its pages', () => {
  test.beforeEach(async () => {
    test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');
  });

  test('a room and a thread come in from the right and leave to it', async ({ page }) => {
    test.setTimeout(180_000);
    const { username, root } = await seed();
    await recordSlides(page);
    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
    // Home's own page: the list is out.
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByRole('link', { name: 'Garden Club' })).toBeVisible();
    await takeSlides(page, 'signed in');

    // The slides slowed to a tenth, for a frame of each mid-way.
    const slow = SHOTS ? await page.context().newCDPSession(page) : undefined;
    await slow?.send('Animation.enable');
    await slow?.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
    const shot = async (name: string) => {
      if (!SHOTS) return;
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}/${name}.png` });
    };

    await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
    await shot('1-room-comes-in');
    await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
    await expect(drawer(page)).toBeHidden();
    expect(await takeSlides(page, 'a room from the list'), 'a room from the list').toEqual([
      FORWARD,
    ]);

    await card(page, root).tap();
    await shot('2-thread-comes-in');
    await expect(threadColumn(page)).toBeVisible();
    expect(await takeSlides(page, 'a thread from its room'), 'a thread from its room').toEqual([
      FORWARD,
    ]);

    await threadColumn(page).getByRole('button', { name: 'Back' }).first().tap();
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

    // The menu button moves between the page and the list the same way.
    await menuButton(page).tap();
    await shot('5-list-comes-back');
    await expect(drawer(page)).toBeVisible();
    expect(await takeSlides(page, 'the menu button'), 'the list comes back').toEqual([BACK]);
    await menuButton(page).tap();
    await expect(drawer(page)).toBeHidden();
    expect(await takeSlides(page, 'the menu button again'), 'the page comes in').toEqual([FORWARD]);
  });

  test('nothing slides for someone who asked for reduced motion', async ({ page }) => {
    test.setTimeout(180_000);
    const { username, root } = await seed();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await recordSlides(page);
    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
    await drawer(page).getByRole('link', { name: 'Garden Club' }).tap();
    await expect(card(page, root)).toBeVisible({ timeout: 60_000 });
    await card(page, root).tap();
    await expect(threadColumn(page)).toBeVisible();
    await threadColumn(page).getByRole('button', { name: 'Back' }).first().tap();
    await expect(threadColumn(page)).toBeHidden();
    expect(await takeSlides(page, 'reduced motion')).toEqual([]);
  });
});
