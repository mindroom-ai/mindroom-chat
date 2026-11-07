import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  composer,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  serverUnreadCounts,
  test,
  type AgentStack,
} from '../helpers/agentStack';
import { registerDisposableUser } from '../helpers/disposableAccounts';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P2-lane2-F005): two devices of one account showed different counts for the same
// encrypted room (desk 4, phone 3, the server 7 with two title notices), and after the room was
// read on another device, a reload brought a count back on the desk (2, the server 0) that only
// the desk's own Mark as Read cleared. The client counted each event once as it decrypted, so the
// order the events decrypted in decided the count, messages that needed no decryption never
// counted, and what it once counted stayed. Both devices must show the server's count without the
// title notices (design decision #17), and nothing once the room is read anywhere.
test.describe.configure({ timeout: 420_000 });

// Set E2EE_SHOTS=<directory> to save both devices' room lists.
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

/** Waits until both devices show `expected(server)` for five polls in a row. */
const expectBothDevices = async (
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
      { timeout: 90_000, intervals: [1000], message: `${step}: both devices show the room's count` }
    )
    .toBe(true);
  if (SHOTS) {
    await Promise.all(
      devices.map(([who, page]) =>
        page.screenshot({ path: `${SHOTS}/two-devices-${step}-${who}.png` })
      )
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

test('two devices of one account count an encrypted room the same, and clear it when read elsewhere', async ({
  page: desk,
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const log: string[] = [];
  const webkit = await launchWebKit();
  let roomId: string | undefined;
  try {
    // Both devices exist before the room does, so both receive its keys.
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
    roomId = await createEncryptedAgentRoom(stack, 'Shared secure');
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

    // The desk asks the helper and goes Home before the reply comes (30 words, then a title).
    await desk.goto(`/home/${room}`, { timeout: 180_000 });
    await expect(composer(desk)).toBeVisible({ timeout: 90_000 });
    await mentionHelper(desk, stack, '#slow what changed in the release?');
    await goHome(desk, roomId);
    await goHome(phone, roomId);
    // The finished reply and its title notice; then the colleague writes twice, from a client
    // without encryption, in the room's main timeline.
    await expect
      .poll(async () => Object.values((await serverUnreadCounts(stack, roomId!)).threads)[0] ?? 0, {
        timeout: 200_000,
        intervals: [1000],
        message: 'the server counts the finished reply and its title',
      })
      .toBeGreaterThanOrEqual(2);
    for (const body of ['The release notes are up.', 'Ping me when you read them.']) {
      await sendRoomMessage(stack.homeserver, colleague.accessToken, roomId, {
        msgtype: 'm.text',
        body,
      });
    }

    const devices: Array<[string, Page]> = [
      ['desk', desk],
      ['phone', phone],
    ];
    // The server counts the title notice, whose push rules it cannot read; the devices do not.
    await expectBothDevices(devices, stack, roomId, log, 'settled', (server) => server - 1);

    // The room is read on another device: an unthreaded receipt on its newest event.
    await matrixFetch(
      stack.homeserver,
      `/rooms/${room}/receipt/m.read/${encodeURIComponent(await newestEventId(stack, roomId))}`,
      { method: 'POST', accessToken: stack.tester.accessToken, body: '{}' }
    );
    await expectBothDevices(devices, stack, roomId, log, 'read-elsewhere', () => 0);

    await Promise.all([desk.reload(), phone.reload()]);
    await goHome(desk, roomId);
    await goHome(phone, roomId);
    await expectBothDevices(devices, stack, roomId, log, 'reload', () => 0);
  } finally {
    writeFileSync(test.info().outputPath('counts.log'), `${log.join('\n')}\n`);
    await webkit.close();
  }
});
