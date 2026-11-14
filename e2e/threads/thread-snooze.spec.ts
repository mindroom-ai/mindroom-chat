import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  getStateEvent,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';

// Snoozing a thread: a snoozed thread leaves Compact and comes back when its time passes, by the
// page's clock and without a reload; the thread menu snoozes until tomorrow 09:00, which writes the
// `snoozed` tag with that `until`; the banner's Unsnooze clears the tag; and on a phone the picker
// is a bottom sheet whose presets work.
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const TAGS_EVENT = 'com.mindroom.thread.tags';

test.use({ viewport: DESKTOP });

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

const snoozeKey = (rootId: string) => JSON.stringify([rootId, 'snoozed']);

/** A room with an agent (snoozing is for agent rooms) and one thread per topic, roots in order. */
const seedRoom = async (
  homeserver: string,
  me: MatrixSession,
  name: string,
  topics: string[]
): Promise<{ roomId: string; roots: string[] }> => {
  const roomId = await createPrivateRoom(homeserver, me.accessToken, {
    name,
    topic: 'Threads to snooze',
  });
  const agent = await registerAgentAccount(homeserver, 'helper');
  await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/invite`, {
    method: 'POST',
    accessToken: me.accessToken,
    body: JSON.stringify({ user_id: agent.userId }),
  });
  await joinRoom(homeserver, agent.accessToken, roomId);
  const roots: string[] = [];
  for (const topic of topics) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(homeserver, me.accessToken, roomId, {
      msgtype: 'm.text',
      body: topic,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Looking into it: ${topic.toLowerCase()}.`,
      'm.relates_to': threadRelation(rootId),
    });
    roots.push(rootId);
  }
  return { roomId, roots };
};

const cardOf = (page: Page, rootId: string) =>
  page.locator(`[data-compact-room-view] [data-thread-root-id="${rootId}"]`);

/** The `until` of the thread's snooze as the homeserver has it, or undefined without one. */
const snoozedUntil = async (
  homeserver: string,
  me: MatrixSession,
  roomId: string,
  rootId: string
): Promise<string | undefined> => {
  const content = await getStateEvent(
    homeserver,
    me.accessToken,
    roomId,
    TAGS_EVENT,
    snoozeKey(rootId)
  );
  const until = (content?.data as { until?: unknown } | undefined)?.until;
  return typeof until === 'string' ? until : undefined;
};

/** Whether `until` is 09:00 tomorrow on the page's own calendar. */
const isTomorrowNineOnPage = (page: Page, until: string) =>
  page.evaluate((value) => {
    const at = new Date(value);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return (
      at.getFullYear() === tomorrow.getFullYear() &&
      at.getMonth() === tomorrow.getMonth() &&
      at.getDate() === tomorrow.getDate() &&
      at.getHours() === 9 &&
      at.getMinutes() === 0
    );
  }, until);

test.describe('thread snooze', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');

  test('a snoozed thread leaves Compact and returns when its time passes, without a reload', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const me = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const { roomId, roots } = await seedRoom(homeserver, me, 'Snooze by the clock', [
      'Check the backups after the migration',
      'Draft the quarterly report',
    ]);
    const [snoozedRoot = '', listedRoot = ''] = roots;
    await page.clock.install();
    await loginWithPassword(page, { homeserver, ...credentials });
    // A minute ahead of now, set just before the room opens, so a slow sign-in cannot use it up.
    await sendStateEvent(homeserver, me.accessToken, roomId, TAGS_EVENT, snoozeKey(snoozedRoot), {
      set_by: me.userId,
      set_at: new Date().toISOString(),
      data: { until: new Date(Date.now() + 60_000).toISOString() },
    });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect(cardOf(page, listedRoot)).toBeVisible({ timeout: 120_000 });
    await expect(cardOf(page, snoozedRoot)).toHaveCount(0);

    await page.clock.fastForward('02:00');
    await expect(cardOf(page, snoozedRoot)).toBeVisible();
    await expect(cardOf(page, listedRoot)).toBeVisible();
  });

  test('the thread menu snoozes until tomorrow 09:00 and the banner unsnoozes', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const me = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const { roomId, roots } = await seedRoom(homeserver, me, 'Snooze from the menu', [
      'Renew the TLS certificates',
      'Plan the offsite agenda',
    ]);
    const [snoozedRoot = '', listedRoot = ''] = roots;
    await loginWithPassword(page, { homeserver, ...credentials });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    const card = cardOf(page, snoozedRoot);
    await expect(card).toBeVisible({ timeout: 120_000 });

    await card.click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Thread options' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Snooze', exact: true }).click();
    const picker = page.getByRole('menu', { name: 'Snooze until' });
    await expect(picker).toBeVisible();
    await picker.getByRole('menuitemradio', { name: /^Tomorrow 09:00/ }).click();
    await expect(picker).toHaveCount(0);

    await expect
      .poll(() => snoozedUntil(homeserver, me, roomId, snoozedRoot), { timeout: 30_000 })
      .toEqual(expect.any(String));
    const until = (await snoozedUntil(homeserver, me, roomId, snoozedRoot)) ?? '';
    expect(await isTomorrowNineOnPage(page, until), `until ${until}`).toBe(true);
    await expect(card).toHaveCount(0);
    await expect(cardOf(page, listedRoot)).toBeVisible();

    // The thread's banner says until when, and its Unsnooze clears the tag.
    await page.goto(
      `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(snoozedRoot)}`
    );
    const banner = page.locator('[data-thread-context-banner]');
    await expect(banner.locator('[data-thread-snoozed]')).toContainText('Snoozed until', {
      timeout: 90_000,
    });
    await banner.getByRole('button', { name: 'Unsnooze', exact: true }).click();
    await expect
      .poll(
        () => getStateEvent(homeserver, me.accessToken, roomId, TAGS_EVENT, snoozeKey(snoozedRoot)),
        { timeout: 30_000 }
      )
      .toEqual({});
    await expect(banner.locator('[data-thread-snoozed]')).toHaveCount(0);
    await banner.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(card).toBeVisible({ timeout: 30_000 });
  });

  test('on a phone the picker is a bottom sheet and a preset snoozes', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const me = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const { roomId, roots } = await seedRoom(homeserver, me, 'Snooze on a phone', [
      'Order the new laptops',
      'Book the venue',
    ]);
    const [snoozedRoot = '', listedRoot = ''] = roots;
    const context = await browser.newContext({ ...PHONE, baseURL });
    try {
      const page = await context.newPage();
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.goto(`/home/${encodeURIComponent(roomId)}`);
      const card = cardOf(page, snoozedRoot);
      await expect(card).toBeVisible({ timeout: 120_000 });
      await card.locator('..').getByRole('button', { name: 'Thread options', exact: true }).tap();
      await page.getByRole('menuitem', { name: 'Snooze', exact: true }).tap();

      // A sheet along the screen's bottom edge, not the desktop menu.
      const sheet = page.getByRole('dialog', { name: 'Snooze until' });
      await expect(sheet).toBeVisible();
      await expect(page.getByRole('menu', { name: 'Snooze until' })).toHaveCount(0);
      // Its slide-up ends first.
      await expect
        .poll(async () => {
          const box = await sheet.boundingBox();
          return box ? Math.round(box.y + box.height) : 0;
        })
        .toBeGreaterThanOrEqual(PHONE.viewport.height - 2);
      const box = await sheet.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(PHONE.viewport.width - 2);

      const before = Date.now();
      await sheet.getByRole('button', { name: /^In 1 hour/ }).tap();
      await expect(sheet).toHaveCount(0);
      await expect
        .poll(() => snoozedUntil(homeserver, me, roomId, snoozedRoot), { timeout: 30_000 })
        .toEqual(expect.any(String));
      const untilTs = Date.parse((await snoozedUntil(homeserver, me, roomId, snoozedRoot)) ?? '');
      const HOUR = 60 * 60_000;
      expect(untilTs).toBeGreaterThanOrEqual(before + HOUR - 1000);
      expect(untilTs).toBeLessThanOrEqual(Date.now() + HOUR + 1000);
      await expect(card).toHaveCount(0);
      await expect(cardOf(page, listedRoot)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
