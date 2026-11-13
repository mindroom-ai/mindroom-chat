import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import { expectRoomCompact, toggleRoomView } from '../helpers/roomViewSwitch';

// A room shows only its own threads. The room view stays mounted from one room to the next, and
// the render that showed the next room still held the timeline of the room left: the Compact
// view's history backfill of the next room put that room's cached history into the timeline of
// the room left, whose thread list then showed the other room's threads until a reload.
// Set THREADS_STAY_SHOTS=<directory> for screenshots.
const PASSWORD = 'threads-stay-in-their-room-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.THREADS_STAY_SHOTS;
const ALPHA_THREADS = 120;

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.setTimeout(300_000);
});

/** A navigation inside the app, as a link in the sidebar or Activity makes: no reload. */
const navigateInApp = (page: Page, path: string) =>
  page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
  }, path);

const roomPath = (roomId: string) => `/home/${encodeURIComponent(roomId)}/`;

/** Sends `bodies` ten at a time and answers their event IDs in order. */
const sendMany = async (accessToken: string, roomId: string, bodies: string[]) => {
  const ids: string[] = [];
  for (let index = 0; index < bodies.length; index += 10) {
    // eslint-disable-next-line no-await-in-loop
    const sent = await Promise.all(
      bodies
        .slice(index, index + 10)
        .map((body) =>
          sendRoomMessage(HOMESERVER, accessToken, roomId, { msgtype: 'm.text', body })
        )
    );
    ids.push(...sent);
  }
  return ids;
};

const threadReply = (rootId: string, body: string) => ({
  msgtype: 'm.text',
  body,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

/** The text of the rows and cards on screen. */
const shownText = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-message-id], [data-scroll-anchor]')]
      .map((row) => row.textContent ?? '')
      .join('\n')
  );

test('a room lists none of the threads of the room opened after it', async ({ page }) => {
  const suffix = `${RUN}${test.info().repeatEachIndex}`;
  const reader = await registerDisposableUser(`stay_${suffix}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `stay_${suffix}`);
  // Alpha: an agent's room (Compact) with more threads than its first sync shows.
  const alphaId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Alpha room',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, alphaId);
  const alphaRoots = await sendMany(
    reader.accessToken,
    alphaId,
    Array.from({ length: ALPHA_THREADS }, (_, index) => `Alpha topic ${index + 1}`)
  );
  for (let index = 0; index < alphaRoots.length; index += 10) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      alphaRoots
        .slice(index, index + 10)
        .map((rootId, offset) =>
          sendRoomMessage(
            HOMESERVER,
            agent.accessToken,
            alphaId,
            threadReply(rootId, `Reply to Alpha topic ${index + offset + 1}`)
          )
        )
    );
  }
  // Beta: newer, with a thread and more messages than its first sync shows.
  const betaId = await createRoom(HOMESERVER, reader.accessToken, { name: 'Beta room' });
  const [betaRoot] = await sendMany(reader.accessToken, betaId, ['Beta topic one']);
  await sendRoomMessage(
    HOMESERVER,
    reader.accessToken,
    betaId,
    threadReply(betaRoot!, 'Reply to Beta topic one')
  );
  const tall = (index: number) =>
    Array.from({ length: 12 }, (_, line) => `Beta line ${index}.${line}`).join('\n');
  await sendMany(
    reader.accessToken,
    betaId,
    Array.from({ length: 40 }, (_, index) => tall(index))
  );

  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  // Beta opens in the Classic view, which loads no older history until the reader scrolls up.
  await page.evaluate((roomId) => {
    window.localStorage.setItem(`roomViewMode:${roomId}`, JSON.stringify('classic'));
  }, betaId);
  await navigateInApp(page, roomPath(alphaId));
  await expect(page.getByText(`Alpha topic ${ALPHA_THREADS}`).first()).toBeVisible({
    timeout: 60_000,
  });
  // The Compact view pages back through Alpha, and the event cache keeps what it loads.
  await page.waitForTimeout(10_000);
  // After a reload Alpha holds only what its first sync brought; the cache holds the rest.
  await page.reload();
  await navigateInApp(page, roomPath(betaId));
  await expect(page.getByText('Beta line 39.0').first()).toBeVisible({ timeout: 60_000 });
  await navigateInApp(page, roomPath(alphaId));
  await expect(page.getByText(`Alpha topic ${ALPHA_THREADS}`).first()).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(3_000);

  await navigateInApp(page, roomPath(betaId));
  await expect(page.getByText('Beta line 39.0').first()).toBeVisible({ timeout: 60_000 });
  await toggleRoomView(page);
  await expectRoomCompact(page, true);
  await expect(page.getByText('Beta topic one').first()).toBeVisible({ timeout: 30_000 });
  // Give a late page time to land before reading the list.
  await page.waitForTimeout(3_000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/beta-list.png` });
  expect(await shownText(page), 'Beta lists no thread of Alpha').not.toContain('Alpha topic');
});
