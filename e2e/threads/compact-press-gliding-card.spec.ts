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
/** How long the press lasts after a card arrived under it: longer than the cards' glide. */
const ARRIVAL_HOLD_MS = 400;
/** How far inside the card's edge the press lands: the card glides this far in the hold. */
const FROM_EDGE = 15;

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

/** A room of `THREAD_COUNT` answered threads, open in Compact, with the pointer off the cards. */
const openRoom = async (page: Page, label: string) => {
  const reader = await registerDisposableUser(`cpg_${label}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `helper_${label}`);
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
  return { agent, roomId, rootIds };
};

/** The press landed on `rootId`'s card, and its thread is open. */
const expectOpened = async (page: Page, rootId: string) => {
  expect(
    await page.evaluate(() => (window as unknown as { pressedCards: unknown[] }).pressedCards),
    'the press landed on the card'
  ).toEqual([rootId]);
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(rootId).replace(/[$.]/g, '\\$&')));
};

test.describe('a press on a Compact card in motion', () => {
  test.beforeEach(async () => {
    test.skip(!(await disposableHomeserverIsUp()), 'needs the disposable homeserver (just hs-up)');
  });

  // Also in the `webkit` project, where the press was first seen to open nothing.
  test('opens the card it started on', { tag: '@webkit' }, async ({ page }) => {
    test.setTimeout(120_000);
    const { agent, roomId, rootIds } = await openRoom(page, 'glide');

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

    await expectOpened(page, second);
  });

  test.describe('with a card that arrives', () => {
    // A service worker's requests pass no route in WebKit: without one, /sync does.
    test.use({ serviceWorkers: 'block' });

    // The list changes while the pointer is down: its plays start under the press.
    test(
      'opens the card it started on when a card arrives during the press',
      { tag: '@webkit' },
      async ({ page, context }) => {
        test.setTimeout(120_000);
        // The answers of /sync wait at a gate while it is shut, so the new card's arrival can be
        // let in right after the pointer went down.
        let shut: Promise<void> | undefined;
        let open: () => void = () => undefined;
        const waiting: string[] = [];
        await context.route(/\/_matrix\/client\/(?:v3|r0)\/sync(?:\?|$)/, async (route) => {
          // A page that closed meanwhile has no request left to answer.
          const response = await route.fetch({ timeout: 60_000 }).catch(() => undefined);
          if (!response) return;
          if (shut) {
            waiting.push(await response.text());
            await shut;
          }
          await route.fulfill({ response }).catch(() => undefined);
        });
        const { agent, roomId, rootIds } = await openRoom(page, 'arrive');
        const first = rootIds[THREAD_COUNT - 1] ?? '';
        await expect
          .poll(() => page.locator(CARDS).first().getAttribute('data-thread-root-id'))
          .toBe(first);

        // The agent's answer in the main timeline is a new card, which leads the list.
        shut = new Promise<void>((resolve) => {
          open = resolve;
        });
        const arrival = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
          msgtype: 'm.text',
          body: 'Heads up: the exporter restarts in five minutes.',
        });
        await expect.poll(() => waiting.some((answer) => answer.includes(arrival))).toBe(true);

        // The new card pushes the first one down: a press near its upper edge is left behind by it.
        const box = await page.locator(`${CARDS}[data-thread-root-id="${first}"]`).boundingBox();
        if (!box) throw new Error('the first card has no box');
        await page.mouse.move(box.x + box.width / 2, box.y + FROM_EDGE);
        await page.mouse.down();
        open();
        shut = undefined;
        await expect(page.locator(`${CARDS}[data-thread-root-id="${arrival}"]`)).toHaveCount(1);
        await page.waitForTimeout(ARRIVAL_HOLD_MS);
        await page.mouse.up();

        await expectOpened(page, first);
      }
    );
  });
});
