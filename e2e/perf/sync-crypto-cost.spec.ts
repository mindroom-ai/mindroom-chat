import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { getStoredSessionByUsername } from '../helpers/accounts';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Each /sync hands its one-time key counts to the Rust crypto machine, which then copies its
// whole account: one elliptic-curve multiplication per one-time key the device holds, on the main
// thread. A device that received to-device messages must still hold only its first keys, so a
// sync without crypto changes stays cheap. Chromium only (CDP profiler), against the slot's
// Tuwunel with fresh accounts.
const PASSWORD = 'sync-crypto-cost-spec-password';
const RUN = Date.now().toString(36);
const TO_DEVICE_SYNCS = 12;
const PLAIN_SYNCS = 10;

type ProfileNode = { id: number; callFrame: { functionName: string }; children?: number[] };
type Profile = { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] };

const register = async (name: string) => {
  const username = `scc_${name}_${RUN}`;
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

/** Milliseconds the profile spent under a function whose name matches. */
const timeUnder = (profile: Profile, pattern: RegExp): number => {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const inside = new Set<number>();
  const mark = (id: number) => {
    if (inside.has(id)) return;
    inside.add(id);
    byId.get(id)?.children?.forEach(mark);
  };
  profile.nodes
    .filter((node) => pattern.test(node.callFrame.functionName))
    .forEach((node) => mark(node.id));
  let micros = 0;
  profile.samples.forEach((id, index) => {
    if (inside.has(id)) micros += profile.timeDeltas[index] ?? 0;
  });
  return micros / 1000;
};

/** Counts the page's /sync answers and the one-time keys it uploads. */
const watchSyncs = (page: Page) => {
  let syncs = 0;
  const keysUploaded: number[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/_matrix/client/v3/sync')) syncs += 1;
  });
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/keys/upload')) return;
    const body = request.postDataJSON() as { one_time_keys?: Record<string, unknown> } | null;
    const keys = Object.keys(body?.one_time_keys ?? {}).length;
    if (keys > 0) keysUploaded.push(keys);
  });
  return { syncs: () => syncs, keysUploaded };
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a device that received to-device messages syncs without copying a grown account', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The CPU profile needs Chromium.');
  test.setTimeout(240_000);
  const reader = await register('reader');
  const writer = await register('writer');
  const roomId = await createRoom(HOMESERVER, writer.accessToken, {
    name: 'Sync Cost',
    invite: [reader.userId],
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  const watch = watchSyncs(page);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await expect(page.getByText('Sync Cost', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  const { deviceId } = await getStoredSessionByUsername(page, reader.username);
  if (!deviceId) throw new Error('The signed-in session has no device ID.');
  await expect.poll(() => watch.keysUploaded.length, { timeout: 30_000 }).toBeGreaterThan(0);

  for (let round = 0; round < TO_DEVICE_SYNCS; round += 1) {
    const before = watch.syncs();
    // eslint-disable-next-line no-await-in-loop
    await matrixFetch(HOMESERVER, `/sendToDevice/org.example.ping/scc-${RUN}-${round}`, {
      method: 'PUT',
      accessToken: writer.accessToken,
      body: JSON.stringify({ messages: { [reader.userId]: { [deviceId]: { round } } } }),
    });
    // eslint-disable-next-line no-await-in-loop
    await expect.poll(() => watch.syncs()).toBeGreaterThan(before);
  }

  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 200 });
  await session.send('Profiler.start');
  const syncsBefore = watch.syncs();
  for (let index = 0; index < PLAIN_SYNCS; index += 1) {
    const before = watch.syncs();
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Message ${index} about the deploy schedule and the review queue for this week.`,
    });
    // eslint-disable-next-line no-await-in-loop
    await expect.poll(() => watch.syncs()).toBeGreaterThan(before);
  }
  const { profile } = (await session.send('Profiler.stop')) as { profile: Profile };
  const syncs = watch.syncs() - syncsBefore;
  const cryptoMs = timeUnder(profile, /receive_sync_changes/);
  const keysMade = watch.keysUploaded.reduce((sum, keys) => sum + keys, 0);
  // eslint-disable-next-line no-console
  console.log(
    'PERF',
    JSON.stringify({
      keysMade,
      syncs,
      cryptoMs: Math.round(cryptoMs),
      unpickleMs: Math.round(timeUnder(profile, /Account.*from_pickle/)),
      cryptoMsPerSync: +(cryptoMs / syncs).toFixed(1),
    })
  );
  expect(syncs).toBeGreaterThanOrEqual(PLAIN_SYNCS);
  // Only the keys of the first sync; main made 650 here (50 per to-device sync).
  expect(keysMade).toBe(50);
  // 17.5 ms per sync before the fix, 1.4 ms after (macbook-m5); generous for loaded runners.
  expect(cryptoMs / syncs).toBeLessThan(8);
});
