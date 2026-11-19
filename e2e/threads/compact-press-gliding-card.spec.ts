import { expect, test } from '@playwright/test';
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

// A press on a Compact card that glides to a new place (src/app/ui/listMotion.tsx) opens that
// card's thread. A browser sends a click whose press and release hit different elements to the
// element that holds both. A card that glided on from under a held pointer took the release to
// the card beside it, the click went to the list, and the pressed thread never opened: a reader
// who went back to the list and pressed a card while it sorted itself anew pressed for nothing.
const PASSWORD = 'compact-press-gliding-password';
const RUN = Date.now().toString(36);
const THREAD_COUNT = 4;
const CARDS = '[data-compact-room-view] [data-motion-row] [data-thread-root-id]';
/** How long the press is held: a person's slow click, and less than the list lets a play last. */
const HOLD_MS = 550;
/** How far from the card's trailing edge the press lands: the card glides this far in the hold. */
const FROM_EDGE = 15;

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

test.describe('a press on a Compact card in motion', () => {
  test.beforeEach(async () => {
    test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');
  });

  // Also in the `webkit` project, where the press was first seen to open nothing.
  test('opens the card it started on', { tag: '@webkit' }, async ({ page }) => {
    test.setTimeout(120_000);
    const reader = await registerDisposableUser(`cpg_reader_${RUN}`, PASSWORD);
    const agent = await registerAgentAccount(HOMESERVER, 'helper_press');
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
        body: `Ticket ${700 + index}: the export stops at row ${100 * (index + 1)}.`,
      });
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Looking into ticket ${700 + index} now.`,
        'm.relates_to': threadRelation(rootId),
      });
      rootIds.push(rootId);
    }

    // Which card each press landed in.
    await page.addInitScript(() => {
      const pressed: (string | null)[] = [];
      (window as unknown as { pressedCards: (string | null)[] }).pressedCards = pressed;
      window.addEventListener(
        'pointerdown',
        (event) => {
          const card =
            event.target instanceof Element && event.target.closest('[data-thread-root-id]');
          pressed.push(card ? card.getAttribute('data-thread-root-id') : null);
        },
        true
      );
    });
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
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

    // A reply in the second thread from the top: its card glides up one place, past the first.
    const second = rootIds[THREAD_COUNT - 2] ?? '';
    await expect
      .poll(() => page.locator(CARDS).nth(1).getAttribute('data-thread-root-id'))
      .toBe(second);
    const card = page.locator(`${CARDS}[data-thread-root-id="${second}"]`);
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Found it: the exporter stops at the first empty cell.',
      'm.relates_to': threadRelation(second),
    });
    // The frame its glide starts in. The motion is slowed to a tenth there, so the press below
    // lands on the card at the start of its way whatever the machine's speed.
    await card.evaluate(
      (element) =>
        new Promise<void>((resolve) => {
          const row = element.closest('[data-motion-row]');
          const look = () => {
            const glides = row
              ?.getAnimations()
              .some((animation) =>
                (animation.effect as KeyframeEffect)
                  .getKeyframes()
                  .some((frame) => 'translate' in frame)
              );
            if (!glides) {
              requestAnimationFrame(look);
              return;
            }
            document.getAnimations().forEach((animation) => {
              // eslint-disable-next-line no-param-reassign
              animation.playbackRate = 0.1;
            });
            resolve();
          };
          look();
        })
    );

    // The card moves up: a press near its lower edge is left behind by it during the hold.
    const box = await card.boundingBox();
    if (!box) throw new Error('the card that glides has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - FROM_EDGE);
    await page.mouse.down();
    await page.waitForTimeout(HOLD_MS);
    await page.mouse.up();

    expect(
      await page.evaluate(() => (window as unknown as { pressedCards: unknown[] }).pressedCards),
      'the press landed on the card that glides'
    ).toEqual([second]);
    await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(second).replace(/[$.]/g, '\\$&')));
  });
});
