import { test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  redactEvent,
  sendMessageEdit,
  sendRoomMessage,
} from '../helpers/matrix';

// Scratch probe (not for carry): what the homeserver serves after a thread reply is redacted.
const thread = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

test('server copies of a deleted thread reply', async () => {
  test.skip(!process.env.E2E_USERNAME, 'no account');
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const { accessToken } = await loginToMatrix(homeserver, username, password);
  const stamp = `${Date.now()}`;
  const roomId = await createPrivateRoom(homeserver, accessToken, { name: `Probe ${stamp}` });
  const say = (content: Record<string, unknown>) =>
    sendRoomMessage(homeserver, accessToken, roomId, { msgtype: 'm.text', ...content });
  const results: Record<string, unknown> = {};
  for (const shape of ['two-replies', 'only-reply']) {
    const rootId = await say({ body: `probe root ${shape} ${stamp}` });
    if (shape === 'two-replies') await say({ body: `probe keep ${stamp}`, 'm.relates_to': thread(rootId) });
    const replyId = await say({ body: `probegone v1 ${stamp}`, 'm.relates_to': thread(rootId) });
    await sendMessageEdit(homeserver, accessToken, roomId, replyId, `probegone v2 ${stamp}`);
    const before = await matrixFetch<unknown>(homeserver, `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(rootId)}`, { accessToken });
    await redactEvent(homeserver, accessToken, roomId, replyId);
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    const r = encodeURIComponent(roomId);
    const reads: Record<string, unknown> = {
      event: await matrixFetch<unknown>(homeserver, `/rooms/${r}/event/${encodeURIComponent(rootId)}`, { accessToken }),
      context: await matrixFetch<unknown>(homeserver, `/rooms/${r}/context/${encodeURIComponent(rootId)}?limit=5`, { accessToken }),
      messages: await matrixFetch<unknown>(homeserver, `/rooms/${r}/messages?dir=b&limit=50`, { accessToken }),
      threads: await matrixFetch<unknown>(homeserver, `/rooms/${r}/threads`, { accessToken }),
      sync: await matrixFetch<unknown>(homeserver, `/sync?timeout=0&filter=${encodeURIComponent(JSON.stringify({ room: { rooms: [roomId], timeline: { limit: 50 } } }))}`, { accessToken }),
    };
    const hits: Record<string, string[]> = {};
    const find = (value: unknown, needle: string, path = ''): string[] => {
      if (typeof value === 'string') return value.includes(needle) ? [path] : [];
      if (!value || typeof value !== 'object') return [];
      return Object.entries(value).flatMap(([k, v]) => find(v, needle, `${path}/${k}`));
    };
    Object.entries(reads).forEach(([name, body]) => {
      hits[name] = [...find(body, `probegone v1 ${stamp}`), ...find(body, `probegone v2 ${stamp}`)];
    });
    results[shape] = { beforeHadPreview: JSON.stringify(before).includes('io.mindroom.latest_reply'), hits, rootAfter: reads.event };
  }
  // eslint-disable-next-line no-console
  console.log(`PROBE ${JSON.stringify(results)}`);
});
