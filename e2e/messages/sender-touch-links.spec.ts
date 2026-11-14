import { mkdirSync } from 'node:fs';
import { expect, test, type Browser } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { DISPOSABLE_HOMESERVER as HOMESERVER } from '../helpers/disposableAccounts';

const PASSWORD = 'sender-touch-spec-password';
const SHOTS = process.env.SENDER_TOUCH_SHOTS;

// Catches a sender layer covering the first body line, and a replies layer covering reactions
// or the next message. Real coordinates and real taps must agree with each control's identity.
const checkPhone = async (browser: Browser, engine: string, baseURL?: string) => {
  const register = async (role: string) => {
    const username = `touch_${role}_${engine}_${Date.now().toString(36)}`;
    await matrixFetch(HOMESERVER, '/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password: PASSWORD,
        auth: { type: 'm.login.dummy' },
        inhibit_login: true,
      }),
    });
    const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
    await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
      method: 'PUT',
      accessToken: session.accessToken,
      body: JSON.stringify({ displayname: role === 'reader' ? 'Harbor Reader' : 'River Writer' }),
    });
    return { ...session, username };
  };
  const reader = await register('reader');
  const writer = await register('writer');
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${i + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Harbor planning',
    invite: [writer.userId],
  });
  await matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    accessToken: writer.accessToken,
    body: '{}',
  });
  let targetId = '';
  for (let i = 0; i < 5; i += 1) {
    // Alternating senders keep adjacent sender rows visible, even when messages are grouped.
    const author = i % 2 ? reader : writer;
    // eslint-disable-next-line no-await-in-loop
    targetId = await sendRoomMessage(HOMESERVER, author.accessToken, roomId, {
      msgtype: 'm.text',
      body: `example.org Route ${
        i + 1
      }: Review the route and confirm the handover before Thursday.`,
      format: 'org.matrix.custom.html',
      formatted_body: `<a href="https://example.net/plan">example.org</a> Route ${
        i + 1
      }: Review the route and confirm the handover before Thursday.`,
    });
    // eslint-disable-next-line no-await-in-loop
    await matrixFetch(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/send/m.reaction/reaction-${i}`,
      {
        method: 'PUT',
        accessToken: writer.accessToken,
        body: JSON.stringify({
          'm.relates_to': { rel_type: 'm.annotation', event_id: targetId, key: '👍' },
        }),
      }
    );
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Route ${i + 1} checked. The handover note includes the revised schedule.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: targetId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: targetId },
      },
    });
  }
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({
      page,
      roomId,
      userId: reader.userId,
      viewMode: 'threaded',
      filterState: createDefaultThreadFilterState(),
    });
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    const row = page.locator(`[data-message-id="${targetId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    const link = row.getByRole('link', { name: 'example.org', exact: true });
    await link.scrollIntoViewIfNeeded();
    const sender = row.locator(`button[data-user-id="${writer.userId}"]`).last();
    const reaction = row.getByRole('button', { name: /👍/ });
    await expect(reaction).toBeVisible();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/timeline-${engine}-${scheme}.png` });
      }
      const audit = await page.evaluate(() => {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-message-id] button, [data-message-id] a[href], [data-message-id] summary, [data-message-id] input'
          )
        ).filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight;
        });
        const describe = (el: HTMLElement) =>
          `${el.tagName} ${el.textContent?.trim().slice(0, 70)}`;
        const conflicts: string[] = [];
        let layers = 0;
        controls.forEach((control) => {
          if (Number(getComputedStyle(control).zIndex) < 1) return;
          for (const pseudo of ['::before', '::after']) {
            const css = getComputedStyle(control, pseudo);
            if (css.content !== '""' || css.position !== 'absolute') continue;
            layers += 1;
            const box = control.getBoundingClientRect();
            const left = box.left + control.clientLeft + parseFloat(css.left);
            const top = box.top + control.clientTop + parseFloat(css.top);
            const right = left + parseFloat(css.width);
            const bottom = top + parseFloat(css.height);
            controls.forEach((other) => {
              if (other === control || other.contains(control) || control.contains(other)) return;
              const neighbor = other.getBoundingClientRect();
              if (
                Math.min(right, neighbor.right) - Math.max(left, neighbor.left) > 0.5 &&
                Math.min(bottom, neighbor.bottom) - Math.max(top, neighbor.top) > 0.5
              ) {
                conflicts.push(`${describe(control)} overlaps ${describe(other)}`);
              }
            });
          }
        });
        return { checked: controls.length, layers, conflicts };
      });
      console.log(`${engine} ${scheme} raised-layer audit: ${JSON.stringify(audit)}`);
      expect(audit.checked).toBeGreaterThan(10);
      expect
        .soft(audit.conflicts, `${scheme}: raised layers avoid every neighboring control`)
        .toEqual([]);
      const hit = await link.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        );
      });
      expect.soft(hit, `${scheme}: first-line link owns its tap`).toBe(true);
      // A real tap, without force or DOM click, must open this link's confirmation.
      try {
        await link.tap({ timeout: 3_000 });
        const dialog = page.getByRole('dialog', { name: 'Open this link?' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
      } catch (error) {
        expect.soft(error, `${scheme}: first-line link receives a real phone tap`).toBeUndefined();
      }
      await reaction.tap();
      await expect(reaction).toHaveAttribute('aria-pressed', 'true');
      await reaction.tap();
      await expect(reaction).toHaveAttribute('aria-pressed', 'false');
      await sender.tap();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // The sender's own layout box must reserve 44 px, so its target cannot invade the body.
      const senderBox = await sender.boundingBox();
      expect
        .soft(senderBox?.height, 'sender reserves its 44 px touch height')
        .toBeGreaterThanOrEqual(44);
      expect
        .soft(senderBox?.width, 'sender reserves its 44 px touch width')
        .toBeGreaterThanOrEqual(44);
      const replies = row.locator('button[data-thread-root-id]');
      await expect(replies).toBeVisible();
      const repliesBox = await replies.boundingBox();
      expect
        .soft(repliesBox?.height, 'replies reserve their 44 px touch height')
        .toBeGreaterThanOrEqual(44);
    }
  } finally {
    await context.close();
  }
};

test.beforeEach(() => test.setTimeout(180_000));

test('phone links, reactions and senders keep separate targets (Chromium)', async ({
  browser,
  baseURL,
}) => {
  await checkPhone(browser, 'chromium', baseURL);
});

test('phone links, reactions and senders keep separate targets (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
  const browser = await launchWebKit();
  try {
    await checkPhone(browser, 'webkit', baseURL);
  } finally {
    await browser.close();
  }
});

const checkNeighbors = async (browser: Browser, baseURL?: string) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    for (const theme of ['', '?dark']) {
      await page.goto(`/e2e/fixtures/touch-neighbors.html${theme}`);
      const activity = page.getByRole('button', { name: 'Review details' });
      await expect(activity).toBeVisible();
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({
          path: `${SHOTS}/neighbors-${browser.browserType().name()}-${theme ? 'dark' : 'light'}.png`,
        });
      }
      const conflicts = await page.locator('main').evaluate((main) => {
        const controls = Array.from(main.querySelectorAll<HTMLElement>('button, a[href]'));
        const overlaps: string[] = [];
        controls.forEach((control) => {
          const box = control.getBoundingClientRect();
          const layer = getComputedStyle(control, '::after');
          if (layer.content !== '""' || layer.position !== 'absolute') return;
          const top = box.top + control.clientTop + parseFloat(layer.top);
          const bottom = top + parseFloat(layer.height);
          const left = box.left + control.clientLeft + parseFloat(layer.left);
          const right = left + parseFloat(layer.width);
          controls.forEach((other) => {
            if (control === other) return;
            const neighbor = other.getBoundingClientRect();
            if (
              Math.min(right, neighbor.right) - Math.max(left, neighbor.left) > 0.5 &&
              Math.min(bottom, neighbor.bottom) - Math.max(top, neighbor.top) > 0.5
            ) {
              overlaps.push(`${control.textContent} overlaps ${other.textContent}`);
            }
          });
        });
        return overlaps;
      });
      expect
        .soft(conflicts, 'activity and wrapped duration rows avoid their neighbors')
        .toEqual([]);
      await activity.tap();
      await expect(activity).toHaveAttribute('aria-expanded', 'true');
      const duration = page.getByRole('button', {
        name: '5 min, Allow for 5 minutes',
        exact: true,
      });
      await duration.last().tap();
      await expect(page.getByLabel('Picked duration')).toHaveText('300');
    }
  } finally {
    await context.close();
  }
};

test('activity and duration touch layers avoid adjacent rows (Chromium)', async ({
  browser,
  baseURL,
}) => {
  await checkNeighbors(browser, baseURL);
});

test('activity and duration touch layers avoid adjacent rows (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
  const browser = await launchWebKit();
  try {
    await checkNeighbors(browser, baseURL);
  } finally {
    await browser.close();
  }
});
