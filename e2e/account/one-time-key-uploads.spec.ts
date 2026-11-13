import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { getStoredSessionByUsername } from '../helpers/accounts';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, loginToMatrix, matrixFetch } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A device keeps 50 one-time keys on the server and uploads more only when other devices claimed
// some. Syncs that bring to-device messages or device list changes, but leave the key count as it
// was, must not make it upload: every key it makes stays in its crypto account, which the crypto
// machine reloads on each sync, so the account would grow without bound. Against the slot's
// Tuwunel, with fresh accounts.
const PASSWORD = 'one-time-key-uploads-spec-password';
const RUN = Date.now().toString(36);
const TO_DEVICE_MESSAGES = 5;

type SyncBody = {
  device_one_time_keys_count?: Record<string, number>;
  device_lists?: { changed?: string[]; left?: string[] };
  to_device?: { events?: { type: string; content: { index?: number } }[] };
};

const register = async (name: string) => {
  const username = `otk_${name}_${RUN}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

/** Follows the page's key uploads and what its syncs report. */
const watchKeys = (page: Page) => {
  const uploads: number[] = [];
  const serverCounts: number[] = [];
  const pings = new Set<number>();
  const changedUsers = new Set<string>();
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/keys/upload')) return;
    const body = request.postDataJSON() as { one_time_keys?: Record<string, unknown> } | null;
    const keys = Object.keys(body?.one_time_keys ?? {}).length;
    if (keys > 0) uploads.push(keys);
  });
  page.on('response', (response) => {
    if (!response.url().includes('/_matrix/client/v3/sync')) return;
    response.json().then(
      (body: SyncBody) => {
        const count = body.device_one_time_keys_count?.signed_curve25519;
        if (count !== undefined) serverCounts.push(count);
        body.to_device?.events?.forEach((event) => {
          if (event.type === 'org.example.ping' && event.content.index !== undefined) {
            pings.add(event.content.index);
          }
        });
        body.device_lists?.changed?.forEach((userId) => changedUsers.add(userId));
      },
      () => undefined
    );
  });
  return { uploads, serverCounts, pings, changedUsers };
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('to-device messages and device list changes make the device upload no more one-time keys @webkit', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const name = testInfo.project.name === 'webkit' ? 'wk' : 'cr';
  const reader = await register(`${name}_reader`);
  const writer = await register(`${name}_writer`);
  const roomId = await createRoom(HOMESERVER, writer.accessToken, {
    name: 'Key Counts',
    invite: [reader.userId],
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  const keys = watchKeys(page);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await expect(page.getByText('Key Counts', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const { deviceId } = await getStoredSessionByUsername(page, reader.username);
  if (!deviceId) throw new Error('The signed-in session has no device ID.');

  // Signing in fills the server with the device's first keys.
  await expect
    .poll(() => keys.serverCounts.at(-1) ?? 0, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(50);
  const uploadsAtStart = keys.uploads.length;
  const countsAtStart = keys.serverCounts.length;

  for (let index = 0; index < TO_DEVICE_MESSAGES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await matrixFetch(HOMESERVER, `/sendToDevice/org.example.ping/otk-${RUN}-${index}`, {
      method: 'PUT',
      accessToken: writer.accessToken,
      body: JSON.stringify({ messages: { [reader.userId]: { [deviceId]: { index } } } }),
    });
    // One sync per message, so each one is its own hand-over to the crypto layer.
    // eslint-disable-next-line no-await-in-loop
    await expect.poll(() => keys.pings.has(index), { timeout: 30_000 }).toBe(true);
  }
  // The writer signs in on a new device: the reader's next sync names the writer as changed.
  await loginToMatrix(HOMESERVER, writer.username, PASSWORD);
  await expect.poll(() => keys.changedUsers.has(writer.userId), { timeout: 30_000 }).toBe(true);
  // An upload starts right after the sync that caused it; give it time to show.
  await page.waitForTimeout(3_000);

  // eslint-disable-next-line no-console
  console.log(
    'OTK',
    JSON.stringify({
      project: testInfo.project.name,
      uploads: keys.uploads,
      uploadsAfterStart: keys.uploads.length - uploadsAtStart,
      serverCounts: keys.serverCounts,
    })
  );
  expect(keys.uploads.slice(uploadsAtStart)).toEqual([]);
  // Each sync reports the count the server held: still the first 50.
  expect(new Set(keys.serverCounts.slice(countsAtStart))).toEqual(new Set([50]));
});
