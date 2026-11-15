import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  joinRoom,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { expectRoomCompact } from '../helpers/roomViewSwitch';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// The Compact cards show what a change does to them (src/app/ui/listMotion.tsx): a card whose
// thread got a reply glides to the top, a new thread's card fades in there, and a card that left
// (a thread resolved while the filter hides resolved ones) fades where it stood while the cards
// under it close the gap. Each card moves by the element inside the one the scroll position is
// measured on, so that one stays at rest. Set LIST_MOTION_SHOTS=<dir> to save a frame of each
// change with the motion slowed to a tenth.
const PASSWORD = 'compact-list-motion-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.LIST_MOTION_SHOTS;
const THREAD_COUNT = 8;
const TOPICS = [
  'The export to CSV drops the last column',
  'Password reset emails arrive twice',
  'The calendar sync skips late events',
  'The chart legend is unreadable in the dark theme',
];

type Play = { card: string; left: boolean; anchor: boolean; properties: string[] };

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

const CARDS = '[data-compact-room-view] [data-motion-row] [data-thread-root-id]';

/** The root IDs of the cards, top to bottom. */
const cardOrder = (page: Page) =>
  page
    .locator(CARDS)
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-thread-root-id') ?? ''));

/** Keeps what every Web Animation on a card played on, and with which properties. */
const recordPlays = (page: Page) =>
  page.addInitScript(() => {
    const plays: Play[] = [];
    (window as unknown as { listMotionPlays: Play[] }).listMotionPlays = plays;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function record(keyframes, options) {
      const card = this.querySelector('[data-thread-root-id]')?.getAttribute('data-thread-root-id');
      const first = Array.isArray(keyframes) ? keyframes[0] : keyframes;
      if (card) {
        plays.push({
          card,
          left: this.hasAttribute('inert'),
          anchor: this.hasAttribute('data-scroll-anchor'),
          properties: Object.keys(first ?? {}),
        });
      }
      return animate.call(this, keyframes, options);
    };
  });

/** The plays since the last call. */
const takePlays = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { listMotionPlays: Play[] }).listMotionPlays.splice(0)
  );

const playsOf = (plays: Play[], card: string, property: string) =>
  plays.filter((play) => play.card === card && play.properties.includes(property));
/** A card's glides: plays of its place alone, where a card that fades in also changes opacity. */
const glidesOf = (plays: Play[], card: string) =>
  plays.filter((play) => play.card === card && play.properties.join() === 'translate');

// High enough to show every card: only cards in view play.
test.use({ viewport: { width: 1280, height: 1100 } });

test.describe('the Compact cards in motion', () => {
  test.beforeEach(async () => {
    test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');
  });

  test('a card glides to the top, a new one fades in, one that left fades out', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const reader = await registerDisposableUser(`clm_reader_${RUN}`, PASSWORD);
    const agent = await registerAgentAccount(HOMESERVER, 'helper_motion');
    const roomId = await createRoom(HOMESERVER, reader.accessToken, {
      name: 'Support queue',
      invite: [agent.userId],
    });
    await joinRoom(HOMESERVER, agent.accessToken, roomId);
    const rootIds: string[] = [];
    for (let index = 0; index < THREAD_COUNT; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Ticket ${500 + index}: ${TOPICS[index % TOPICS.length] ?? ''}.`,
      });
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Looking into ticket ${500 + index} now.`,
        'm.relates_to': threadRelation(rootId),
      });
      rootIds.push(rootId);
    }

    await recordPlays(page);
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    // Resolved threads leave the list.
    await seedRoomOverviewState({
      page,
      roomId,
      userId: reader.userId,
      viewMode: 'compact',
      filterState: { ...createDefaultThreadFilterState(), resolved: 'exclude' },
    });
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    await expectRoomCompact(page, true, 60_000);
    await expect(page.locator(CARDS)).toHaveCount(THREAD_COUNT, { timeout: 60_000 });
    // The pointer away from the cards, which it would hold in their order.
    await page.mouse.move(5, 5);
    const slow = SHOTS ? await page.context().newCDPSession(page) : undefined;
    await slow?.send('Animation.enable');
    await slow?.send('Animation.setPlaybackRate', { playbackRate: 0.1 });
    const shot = async (name: string) => {
      if (!SHOTS) return;
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/${name}.png` });
    };
    await takePlays(page);

    // 1. A reply in the oldest thread: its card, the last one, glides to the top.
    const oldest = rootIds[0] ?? '';
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Found it: the exporter does not quote commas.',
      'm.relates_to': threadRelation(oldest),
    });
    await expect.poll(async () => (await cardOrder(page))[0], { timeout: 30_000 }).toBe(oldest);
    await shot('1-reply-moves-up');
    const moved = await takePlays(page);
    expect(glidesOf(moved, oldest), 'the card that moved up').toHaveLength(1);
    expect(playsOf(moved, oldest, 'zIndex'), 'it passes over the others').toHaveLength(1);
    expect(glidesOf(moved, rootIds[1] ?? ''), 'a card it passed').toHaveLength(1);
    expect(moved.filter((play) => play.anchor), 'plays on a measured element').toEqual([]);

    // 2. The agent starts a thread: its card fades in at the top.
    const fresh = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Update: the deploy of build 1302 finished.',
    });
    await expect.poll(async () => (await cardOrder(page))[0], { timeout: 30_000 }).toBe(fresh);
    await shot('2-new-card-enters');
    const entered = await takePlays(page);
    expect(playsOf(entered, fresh, 'opacity'), 'the new card').not.toHaveLength(0);
    expect(glidesOf(entered, oldest), 'the card under it').toHaveLength(1);

    // 3. A resolved thread leaves: its card fades where it stood, then is gone.
    const resolved = (await cardOrder(page))[2] ?? '';
    const shell = page.locator(`[data-scroll-anchor="${resolved}"]`);
    await shell.hover();
    await shell.locator('[data-compact-thread-resolve="true"]').click();
    await expect(page.locator(CARDS)).toHaveCount(THREAD_COUNT, { timeout: 30_000 });
    await shot('3-resolved-card-leaves');
    const left = await takePlays(page);
    expect(
      left.filter((play) => play.card === resolved && play.left),
      'the card that left'
    ).not.toHaveLength(0);
    await slow?.send('Animation.setPlaybackRate', { playbackRate: 1 });
    await expect(page.locator('[data-compact-room-view] [inert]')).toHaveCount(0);
    expect(await cardOrder(page)).not.toContain(resolved);
  });
});
