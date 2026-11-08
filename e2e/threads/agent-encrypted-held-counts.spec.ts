import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { openSettingsFromAccountRail } from '../helpers/accounts';
import {
  composer,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  readRouterWelcome,
  routerToken,
  serverUnreadCounts,
  test,
  type AgentStack,
} from '../helpers/agentStack';
import { registerDisposableUser } from '../helpers/disposableAccounts';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P3-e2ee-F001, P3-e2ee-F002, P3-e2ee-F003, P3-lane5-F002): an encrypted room's badge
// counted only the events the device held after the reader's last read. After a sync gap (a device
// offline while 25 messages came; the sync brings the newest 20) it showed 20, live and after a
// reload, where the server counted 25. A device that signed in after an agent's reply and got its
// keys later, from the key backup, held the reply's last edits and its title notice but not its
// first message, and showed 0 once the keys came, while the server counted the finished reply and
// its title and every other device showed 1. Each device must show the server's count less the
// title notices (design decision #17).
test.describe.configure({ timeout: 480_000 });
test.use({ viewport: { width: 1440, height: 900 } });

// Set E2EE_SHOTS=<directory> to save every device's room list at each step.
const SHOTS = process.env.E2EE_SHOTS;

type Counts = Awaited<ReturnType<typeof serverUnreadCounts>>;

const total = (counts: Counts): number =>
  counts.room + Object.values(counts.threads).reduce((sum, count) => sum + count, 0);

/** The number on the room's badge; 0 for a dot or no badge. */
const badgeCount = async (page: Page, roomId: string): Promise<number> => {
  const text = await page
    .locator(`[data-room-id="${roomId}"]`)
    .first()
    .innerText()
    .catch(() => '');
  const match = /(\d+)\+?\s*$/.exec(text.trim());
  return match ? Number(match[1]) : 0;
};

const goHome = async (page: Page, roomId: string): Promise<void> => {
  await page.evaluate(() => {
    window.history.pushState(null, '', '/home/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator(`[data-room-id="${roomId}"]`).first()).toBeVisible({
    timeout: 60_000,
  });
};

/** Waits until every device shows `expected(server)` for five polls in a row. */
const expectDevices = async (
  devices: Array<[string, Page]>,
  stack: AgentStack,
  roomId: string,
  log: string[],
  step: string,
  expected: (server: number) => number
): Promise<void> => {
  let held = 0;
  await expect
    .poll(
      async () => {
        const server = total(await serverUnreadCounts(stack, roomId));
        const shown = await Promise.all(devices.map(([, page]) => badgeCount(page, roomId)));
        log.push(
          `${step}: ${devices.map(([who], i) => `${who} ${shown[i]}`).join(', ')}, server ${server}`
        );
        held = shown.every((count) => count === expected(server)) ? held + 1 : 0;
        return held >= 5;
      },
      { timeout: 120_000, intervals: [1000], message: `${step}: every device shows the count` }
    )
    .toBe(true);
  if (SHOTS) {
    await Promise.all(
      devices.map(([who, page]) => page.screenshot({ path: `${SHOTS}/held-${step}-${who}.png` }))
    );
  }
};

/** The room's newest event, which an unthreaded receipt then reads everything up to. */
const newestEventId = async (stack: AgentStack, roomId: string): Promise<string> => {
  const { chunk } = await matrixFetch<{ chunk: Array<{ event_id: string }> }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=1`,
    { accessToken: stack.tester.accessToken }
  );
  const newest = chunk[0];
  if (!newest) throw new Error('The room has no events');
  return newest.event_id;
};

/** Whether the router sent a message in the room (its join and state events aside). */
const routerSpoke = async (stack: AgentStack, roomId: string): Promise<boolean> => {
  const { chunk } = await matrixFetch<{ chunk: Array<{ sender: string; type: string }> }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50`,
    { accessToken: stack.tester.accessToken }
  );
  return chunk.some(
    (event) =>
      event.sender === stack.agents.router &&
      (event.type === 'm.room.message' || event.type === 'm.room.encrypted')
  );
};

const openSecurity = async (page: Page): Promise<void> => {
  await openSettingsFromAccountRail(page);
  await page.getByRole('button', { name: 'Privacy & security', exact: true }).click();
  await expect(page.getByText('Security', { exact: true })).toBeVisible();
};

/** How many of the Megolm sessions the helper's events in the room use the key backup lacks. */
const sessionsNotBackedUp = async (stack: AgentStack, roomId: string): Promise<number> => {
  const auth = { accessToken: stack.tester.accessToken };
  type Raw = { sender: string; content: { session_id?: string } };
  const { chunk } = await matrixFetch<{ chunk: Raw[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=200`,
    auth
  );
  const used = new Set(
    chunk.flatMap((event) =>
      event.sender === stack.agents.helper && event.content.session_id
        ? [event.content.session_id]
        : []
    )
  );
  const { version } = await matrixFetch<{ version: string }>(
    stack.homeserver,
    '/room_keys/version',
    auth
  );
  const keys = await matrixFetch<{ sessions?: Record<string, unknown> }>(
    stack.homeserver,
    `/room_keys/keys/${encodeURIComponent(roomId)}?version=${encodeURIComponent(version)}`,
    auth
  ).catch(() => ({ sessions: {} }));
  return used.size === 0 ? 1 : [...used].filter((id) => !(id in (keys.sessions ?? {}))).length;
};

test('after a sync gap every device shows the messages the server counts, also after a reload', async ({
  page: desk,
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const log: string[] = [];
  const webkit = await launchWebKit();
  try {
    await desk.goto('/home/', { timeout: 180_000 });
    const phone = await openNewSession(webkit, stack, {
      baseURL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const colleague = await registerDisposableUser(
      `colleague${Date.now().toString(36)}`,
      'secret-pass-1'
    );
    const roomId = await createEncryptedAgentRoom(stack, 'Secure gap');
    const room = encodeURIComponent(roomId);
    await matrixFetch(stack.homeserver, `/rooms/${room}/invite`, {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({ user_id: colleague.userId }),
    });
    await matrixFetch(stack.homeserver, `/join/${room}`, {
      method: 'POST',
      accessToken: colleague.accessToken,
      body: '{}',
    });
    await readRouterWelcome(stack, roomId);
    await sendRoomMessage(stack.homeserver, colleague.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Before the gap.',
    });
    await matrixFetch(
      stack.homeserver,
      `/rooms/${room}/receipt/m.read/${encodeURIComponent(await newestEventId(stack, roomId))}`,
      { method: 'POST', accessToken: stack.tester.accessToken, body: '{}' }
    );
    await goHome(desk, roomId);
    await goHome(phone, roomId);
    const devices: Array<[string, Page]> = [
      ['desk', desk],
      ['phone', phone],
    ];
    await expectDevices(devices, stack, roomId, log, 'read', () => 0);

    // Both devices go offline; 25 messages come, more than one sync brings (20 per room).
    await Promise.all(devices.map(([, page]) => page.context().setOffline(true)));
    for (let index = 1; index <= 25; index += 1) {
      await sendRoomMessage(stack.homeserver, colleague.accessToken, roomId, {
        msgtype: 'm.text',
        body: `Gap message ${index}: the release notes for the next build are ready for review.`,
      });
    }
    await expect
      .poll(async () => total(await serverUnreadCounts(stack, roomId)), {
        timeout: 30_000,
        message: 'the server counts the 25 messages',
      })
      .toBe(25);
    await Promise.all(devices.map(([, page]) => page.context().setOffline(false)));
    await expectDevices(devices, stack, roomId, log, 'after-gap', (server) => server);

    await Promise.all(devices.map(([, page]) => page.reload()));
    await goHome(desk, roomId);
    await goHome(phone, roomId);
    await expectDevices(devices, stack, roomId, log, 'reload', (server) => server);
  } finally {
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
    await webkit.close();
  }
});

test('an unread fast agent reply stays counted after a reload', async ({ page: desk, stack }) => {
  // P3-lane5-F002's clean repro: a short reply (two edits, a reaction and its removal, a title).
  const log: string[] = [];
  try {
    const roomId = await createEncryptedAgentRoom(stack, 'Fast reply');
    await readRouterWelcome(stack, roomId);
    await desk.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
    await expect(composer(desk)).toBeVisible({ timeout: 90_000 });
    await mentionHelper(desk, stack, 'a short question for the helper');
    await goHome(desk, roomId);
    await expect
      .poll(
        async () =>
          Math.max(0, ...Object.values((await serverUnreadCounts(stack, roomId)).threads)),
        { timeout: 120_000, intervals: [1000], message: 'the server counts the reply and its title' }
      )
      .toBeGreaterThanOrEqual(2);
    await expectDevices([['desk', desk]], stack, roomId, log, 'fast', (server) => server - 1);
    await desk.reload();
    await goHome(desk, roomId);
    await expectDevices([['desk', desk]], stack, roomId, log, 'fast-reload', (s) => s - 1);
  } finally {
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
  }
});

test('a new session whose keys come late from the key backup shows an unread finished reply', async ({
  browser,
  stack: shared,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const log: string[] = [];
  const webkit = await launchWebKit();
  try {
    // An account of its own: the secret storage and key backup it sets up stay on the account, so
    // the stack's test account would offer no Enable on a later run. The agents answer the
    // members of their lobby, where the router invites it.
    const owner = await registerDisposableUser(
      `latekeys${Date.now().toString(36)}`,
      'secret-pass-1'
    );
    const lobby = encodeURIComponent(shared.rooms.lobby);
    await matrixFetch(shared.homeserver, `/rooms/${lobby}/invite`, {
      method: 'POST',
      accessToken: routerToken(shared),
      body: JSON.stringify({ user_id: owner.userId }),
    });
    await matrixFetch(shared.homeserver, `/join/${lobby}`, {
      method: 'POST',
      accessToken: owner.accessToken,
      body: '{}',
    });
    const stack: AgentStack = { ...shared, tester: owner };

    // The desk sets up secret storage and the key backup, which then holds the room's keys.
    const desk = await openNewSession(browser, stack, {
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    await desk.goto('/home/', { timeout: 180_000 });
    await openSecurity(desk);
    await desk.getByRole('button', { name: 'Enable' }).click({ timeout: 30_000 });
    await desk.getByRole('button', { name: 'Continue' }).click();
    const keyText = desk.getByRole('dialog').locator('code');
    await expect(keyText).toHaveText(/^E\w{3}( \w{4}){11}$/, { timeout: 60_000 });
    const recoveryKey = (await keyText.textContent()) ?? '';
    await desk.getByRole('button', { name: 'Okay' }).click();
    await expect(desk.getByText(/Connected · Version: \S+ · Keys: \d+/)).toBeVisible({
      timeout: 60_000,
    });
    await desk.keyboard.press('Escape');

    // The desk asks the helper and goes Home before the reply comes (30 words, then a title).
    const roomId = await createEncryptedAgentRoom(stack, 'Late keys');
    await desk.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
    await expect(composer(desk)).toBeVisible({ timeout: 90_000 });
    await mentionHelper(desk, stack, '#slow what changed in the release?');
    await goHome(desk, roomId);
    // The router welcomes only an empty room, and not always one of an account outside the
    // stack's: read its welcome, if it sent one, so the counts are the test's own.
    if (await routerSpoke(stack, roomId)) await readRouterWelcome(stack, roomId);
    await expect
      .poll(
        async () =>
          Math.max(0, ...Object.values((await serverUnreadCounts(stack, roomId)).threads)),
        {
          timeout: 200_000,
          intervals: [1000],
          message: 'the server counts the finished reply and its title',
        }
      )
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => sessionsNotBackedUp(stack, roomId), {
        timeout: 90_000,
        intervals: [2000],
        message: "the key backup holds the keys of the helper's events",
      })
      .toBe(0);
    // The server counts the title notice, whose push rules it cannot read; the devices do not.
    await expectDevices([['desk', desk]], stack, roomId, log, 'desk', (server) => server - 1);
    // A reload starts from the saved sync (P3-lane5-F002: 0 after a reload).
    await desk.reload();
    await goHome(desk, roomId);
    await expectDevices([['desk', desk]], stack, roomId, log, 'desk-reload', (s) => s - 1);

    // Two new sessions, a phone (Chromium) and a desktop (WebKit), sign in without the keys.
    const sessions: Array<[string, Page]> = [
      [
        'phone',
        await openNewSession(browser, stack, {
          baseURL,
          viewport: { width: 390, height: 844 },
          hasTouch: true,
        }),
      ],
      [
        'webkit',
        await openNewSession(webkit, stack, { baseURL, viewport: { width: 1440, height: 900 } }),
      ],
    ];
    for (const [who, page] of sessions) {
      await goHome(page, roomId);
      // Without the keys a session cannot tell the title notice from a message; it shows the
      // room unread.
      await expect
        .poll(
          async () => {
            const shown = await badgeCount(page, roomId);
            log.push(`keyless ${who}: ${shown}`);
            return shown;
          },
          { timeout: 60_000, intervals: [1000], message: `${who} shows the room unread` }
        )
        .toBeGreaterThan(0);

      // The recovery key unlocks secret storage; the backup brings the room's keys.
      await openSecurity(page);
      await page.getByRole('button', { name: 'Verify Manually' }).click({ timeout: 30_000 });
      await page.locator('input[name="recoveryKeyInput"]').fill(recoveryKey);
      await page.getByRole('button', { name: 'Verify', exact: true }).last().click();
      // The other sessions stay unverified ("Unverified Devices"); this one is verified.
      await expect(
        page.getByRole('button', { name: 'Unverified Device', exact: true })
      ).toHaveCount(0, { timeout: 60_000 });
      const restore = page.getByRole('button', { name: 'Restore Backup' });
      await expect(restore).toBeEnabled({ timeout: 30_000 });
      await restore.click();
      await expect(restore).toBeEnabled({ timeout: 60_000 });
      await page.keyboard.press('Escape');
      await goHome(page, roomId);
    }
    const devices: Array<[string, Page]> = [['desk', desk], ...sessions];
    await expectDevices(devices, stack, roomId, log, 'keys', (server) => server - 1);

    await Promise.all(sessions.map(([, page]) => page.reload()));
    await Promise.all(sessions.map(([, page]) => goHome(page, roomId)));
    await expectDevices(devices, stack, roomId, log, 'keys-reload', (server) => server - 1);
  } finally {
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
    await webkit.close();
  }
});
