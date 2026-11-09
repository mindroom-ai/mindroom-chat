import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';

// Phones lead every full-screen page with one back button: a chevron as large as the header's
// other icons, at the screen's start edge, with a 44 px touch target, mirrored in right-to-left.
// Set PHONE_BACK_SHOTS=<directory> to also save each surface in dark and light themes.
const SHOTS = process.env.PHONE_BACK_SHOTS;

type Rect = { left: number; right: number; top: number; bottom: number };
type Measured = { button: Rect; glyph: Rect; mirrored: boolean };

const ROOM_NAME = 'Quarterly planning notes for the research and operations team';
const ROOM_TOPIC = 'Planning notes, research questions and follow-ups for this quarter';

const width = (rect: Rect) => rect.right - rect.left;
const height = (rect: Rect) => rect.bottom - rect.top;
const size = (rect: Rect) => `${width(rect).toFixed(1)}x${height(rect).toFixed(1)}`;

/** The button's box, the drawn part of its icon (the union of the shapes' boxes) and whether
 *  the icon is mirrored. */
const measure = (button: Locator): Promise<Measured> =>
  button.evaluate((element) => {
    const svg = element.querySelector('svg');
    if (!svg) throw new Error('the button has no icon');
    const shapes = [...svg.querySelectorAll('path, circle, rect, line, polyline, polygon')];
    const boxes = shapes.map((shape) => shape.getBoundingClientRect());
    const glyph = {
      left: Math.min(...boxes.map((box) => box.left)),
      right: Math.max(...boxes.map((box) => box.right)),
      top: Math.min(...boxes.map((box) => box.top)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
    const { left, right, top, bottom } = element.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(svg).transform);
    return { button: { left, right, top, bottom }, glyph, mirrored: matrix.a < 0 };
  });

const openRoute = (page: Page, url: string) =>
  page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

const shoot = async (page: Page, name: string, scheme: string) => {
  if (!SHOTS) return;
  // Let the tooltip-free header settle after the route change.
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
};

/** Expects the iOS-style chevron: a 44 px target, a glyph at least as tall as `reference`'s. */
const expectPhoneBack = (back: Measured, reference: Measured) => {
  expect.soft(width(back.button)).toBeGreaterThanOrEqual(44);
  expect.soft(height(back.button)).toBeGreaterThanOrEqual(44);
  expect.soft(height(back.glyph)).toBeGreaterThanOrEqual(height(reference.glyph) - 0.5);
};

const seedRoom = async () => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `${ROOM_NAME} ${Date.now().toString(36)}`,
    topic: ROOM_TOPIC,
  });
  const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Which follow-ups are still open from the last planning session?',
  });
  await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Two: the vendor review and the onboarding checklist.',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  return { homeserver, credentials, roomId, rootId };
};

test.describe('phone back button', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const scheme of ['dark', 'light'] as const) {
    test(`every phone page leads with the same back chevron (${scheme})`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme });
      // The local Matrix fixture has no provisioning service.
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      const { homeserver, credentials, roomId, rootId } = await seedRoom();
      await loginWithPassword(page, { homeserver, ...credentials });
      const report: string[] = [];

      // The room header: the chevron at the screen's start, as large as the members icon.
      await openRoute(page, `/home/${encodeURIComponent(roomId)}/`);
      const header = page.getByRole('banner').filter({ hasText: ROOM_NAME });
      await expect(header.getByRole('heading', { name: new RegExp(ROOM_NAME) })).toBeVisible({
        timeout: 60_000,
      });
      const roomBack = header.getByRole('button', { name: 'Back', exact: true });
      // A phone's header keeps Back, the name and the room menu; its icon is the reference.
      const members = header.getByRole('button', { name: 'More Options', exact: true });
      const room = await measure(roomBack);
      const memberIcon = await measure(members);
      for (const other of await header.getByRole('button').all()) {
        // eslint-disable-next-line no-await-in-loop
        const label = (await other.getAttribute('aria-label')) ?? 'title';
        // eslint-disable-next-line no-await-in-loop
        const box = await measure(other).catch(() => undefined);
        if (box) report.push(`room header ${label}: glyph ${size(box.glyph)}`);
      }
      report.push(
        `room header back: button ${size(room.button)} at ${room.button.left.toFixed(
          1
        )}, glyph ${size(room.glyph)} at ${room.glyph.left.toFixed(1)}`
      );
      expectPhoneBack(room, memberIcon);
      expect.soft(room.glyph.left).toBeLessThanOrEqual(20);
      // The title follows right after the chevron.
      const title = await header
        .getByRole('heading', { name: new RegExp(ROOM_NAME) })
        .evaluate((element) => element.getBoundingClientRect().left);
      report.push(`room header title starts at ${title.toFixed(1)}`);
      expect.soft(title - room.glyph.right).toBeLessThanOrEqual(24);
      await shoot(page, 'room', scheme);

      // An open thread's banner leads with the same chevron.
      await openRoute(
        page,
        `/home/${encodeURIComponent(roomId)}/?threadId=${encodeURIComponent(rootId)}`
      );
      const banner = page.locator('[data-thread-context-banner]');
      await expect(banner).toBeVisible({ timeout: 60_000 });
      const thread = await measure(banner.getByRole('button', { name: 'Back', exact: true }));
      report.push(`thread banner back: button ${size(thread.button)}, glyph ${size(thread.glyph)}`);
      expectPhoneBack(thread, memberIcon);
      await shoot(page, 'thread', scheme);

      // The pages that already used the shared button.
      for (const [name, path] of [
        ['invites', '/activity/invites/'],
        ['search', '/home/search/'],
        ['explore', '/explore/featured/'],
      ] as const) {
        // eslint-disable-next-line no-await-in-loop
        await openRoute(page, path);
        const back = page.getByRole('button', { name: 'Back', exact: true });
        // eslint-disable-next-line no-await-in-loop
        await expect(back).toBeVisible({ timeout: 30_000 });
        // eslint-disable-next-line no-await-in-loop
        const measured = await measure(back);
        report.push(
          `${name} back: button ${size(measured.button)} at ${measured.button.left.toFixed(
            1
          )}, glyph ${size(measured.glyph)} at ${measured.glyph.left.toFixed(1)}`
        );
        expectPhoneBack(measured, memberIcon);
        expect.soft(measured.glyph.left).toBeLessThanOrEqual(20);
        // eslint-disable-next-line no-await-in-loop
        await shoot(page, name, scheme);
      }

      await testInfo.attach('measurements', { body: report.join('\n'), contentType: 'text/plain' });
      // eslint-disable-next-line no-console
      console.log(`[${scheme}]\n${report.join('\n')}`);
    });
  }

  test('the chevron mirrors in right-to-left and stays at the start edge', async ({ page }) => {
    test.setTimeout(180_000);
    await page.route('**/v1/local-mindroom/connections', (route) =>
      route.fulfill({ json: { connections: [] } })
    );
    const { homeserver, credentials, roomId } = await seedRoom();
    await loginWithPassword(page, { homeserver, ...credentials });
    await openRoute(page, `/home/${encodeURIComponent(roomId)}/`);
    const header = page.getByRole('banner').filter({ hasText: ROOM_NAME });
    const back = header.getByRole('button', { name: 'Back', exact: true });
    await expect(back).toBeVisible({ timeout: 60_000 });
    expect((await measure(back)).mirrored).toBe(false);

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    const rtl = await measure(back);
    expect(rtl.mirrored).toBe(true);
    expect(390 - rtl.glyph.right).toBeLessThanOrEqual(20);
  });
});
