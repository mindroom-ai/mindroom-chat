import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  type MatrixSession,
} from '../helpers/matrix';

// The first open of a thread the client knows only from its card (its root and newest reply,
// with the replies between them on the server) paints once: the first frame that shows replies
// already holds the ones between, with a long agent reply whole (its sidecar loaded), and no
// later frame adds a row above them, replaces the reply's preview, or shows a loading box or line.
// THREAD_FIRST_OPEN_SHOTS names a directory for the screencast frames of the open.
const PASSWORD = 'thread-first-open-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.THREAD_FIRST_OPEN_SHOTS;
const SAMPLE_MS = 4_000;
const REPLIES = 12;
const ROOM_MESSAGES_AFTER = 25;
const SIDECAR_ONLY = 'This closing paragraph is only in the sidecar.';
const KEYS = { ids: 'e2e-first-open-ids', marker: SIDECAR_ONLY, sampleMs: SAMPLE_MS };

test.use({ viewport: { width: 1440, height: 900 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

type Frame = {
  t: number;
  /** The thread's rows in the DOM, in order. */
  ids: string[];
  /** The rows at least partly in view, in order. */
  visible: string[];
  /** Whether the long reply's row shows its whole text (null while it is not mounted). */
  longWhole: boolean | null;
  /** Whether the list shows the "Loading full response" line anywhere. */
  loadingLine: boolean;
};

const send = (session: MatrixSession, roomId: string, content: Record<string, unknown>) =>
  matrixFetch<{ event_id: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/tfo-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
    { method: 'PUT', accessToken: session.accessToken, body: JSON.stringify(content) }
  ).then((response) => response.event_id);

const inThread = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

/** An agent's long reply as MindRoom sends one: a preview event and the whole content in a file. */
const sendLongReply = async (agent: MatrixSession, roomId: string, rootId: string) => {
  const lines = Array.from(
    { length: 40 },
    (_, index) =>
      `- Check ${index + 1}: the deploy of service ${
        index + 1
      } passed, see https://status.example.org/checks/${index + 1} for its log.`
  );
  const body = `Release summary\n\n${lines.join('\n')}\n\n${SIDECAR_ONLY}`;
  const full = {
    msgtype: 'm.text',
    body,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>Release summary</p><ul>${lines
      .map((line) => `<li>${line.slice(2)}</li>`)
      .join('')}</ul><p>${SIDECAR_ONLY}</p>`,
    'io.mindroom.stream_status': 'completed',
    'm.relates_to': inThread(rootId),
  };
  const sidecar = Buffer.from(JSON.stringify(full));
  const response = await fetch(
    `${HOMESERVER}/_matrix/media/v3/upload?filename=message-content.json`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${agent.accessToken}`, 'Content-Type': 'application/json' },
      body: sidecar,
    }
  );
  expect(response.ok).toBe(true);
  const { content_uri: url } = (await response.json()) as { content_uri: string };
  const preview = `${body.slice(0, 600)}\n\n[Message continues in attached file]`;
  return send(agent, roomId, {
    msgtype: 'm.file',
    body: preview,
    filename: 'message-content.json',
    info: { mimetype: 'application/json', size: sidecar.length },
    url,
    'io.mindroom.long_text': {
      version: 2,
      encoding: 'matrix_event_content_json',
      original_event_size: sidecar.length,
      preview_size: preview.length,
      is_complete_content: true,
    },
    'm.relates_to': inThread(rootId),
  });
};

/** Samples the open thread after every painted frame into `window.firstOpenFrames`. */
const installFrameSampler = (keys: typeof KEYS) => {
  const win = window as unknown as { firstOpenFrames: Frame[]; startFirstOpenFrames: () => void };
  let start = performance.now();
  let sampling = false;
  win.firstOpenFrames = [];
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]');
    let scroller = inner?.parentElement ?? null;
    while (scroller && !/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    const { longId } = JSON.parse(window.localStorage.getItem(keys.ids) ?? '{}') as {
      longId?: string;
    };
    if (scroller && inner && window.getComputedStyle(inner).visibility !== 'hidden') {
      const box = scroller.getBoundingClientRect();
      const composer = document.querySelector<HTMLElement>('[contenteditable="true"]');
      const bottom = Math.min(box.bottom, composer?.getBoundingClientRect().top ?? box.bottom);
      const rows = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')];
      const longRow = longId ? scroller.querySelector(`[data-message-id="${longId}"]`) : null;
      win.firstOpenFrames.push({
        t: Math.round(performance.now() - start),
        ids: rows.map((row) => row.dataset.messageId ?? ''),
        visible: rows
          .filter((row) => {
            const rowBox = row.getBoundingClientRect();
            return rowBox.bottom > box.top + 1 && rowBox.top < bottom - 1;
          })
          .map((row) => row.dataset.messageId ?? ''),
        longWhole: longRow ? !!longRow.textContent?.includes(keys.marker) : null,
        loadingLine: !!scroller.textContent?.includes('Loading full response'),
      });
    }
    if (sampling && performance.now() - start < keys.sampleMs) {
      requestAnimationFrame(() => channel.port2.postMessage(0));
    }
  };
  win.startFirstOpenFrames = () => {
    start = performance.now();
    sampling = true;
    win.firstOpenFrames = [];
    requestAnimationFrame(() => channel.port2.postMessage(0));
  };
};

/** Saves what Chromium paints from now until `stop` is called, one JPEG per frame. */
const recordScreencast = async (page: Page, dir: string) => {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const started = Date.now();
  let index = 0;
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    index += 1;
    const name = `${String(index).padStart(3, '0')}-${Date.now() - started}ms.jpg`;
    writeFileSync(`${dir}/${name}`, Buffer.from(data, 'base64'));
    void cdp.send('Page.screencastFrameAck', { sessionId });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast');
    await cdp.detach();
  };
};

test('a thread opened for the first time paints its replies once, its long reply whole', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const reader = await registerDisposableUser(`tfo_reader_${RUN}`, PASSWORD);
  const colleague = await registerDisposableUser(`tfo_colleague_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'helper');
  const roomName = `Release room ${RUN}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [colleague.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await send(reader, roomId, {
    msgtype: 'm.text',
    body: 'Release checklist for this week. Post every step here.',
  });
  for (let index = 1; index <= REPLIES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(index % 2 ? colleague : agent, roomId, {
      msgtype: 'm.text',
      body: `Step ${index}: done.`,
      'm.relates_to': inThread(rootId),
    });
  }
  const longId = await sendLongReply(agent, roomId, rootId);
  const newestId = await send(agent, roomId, {
    msgtype: 'm.text',
    body: 'Secret for the deploy: sent.',
    'm.relates_to': inThread(rootId),
  });
  // Later room messages push the thread out of the client's first sync, so it knows the thread
  // only from its card: the root and its newest reply.
  for (let index = 1; index <= ROOM_MESSAGES_AFTER; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(colleague, roomId, { msgtype: 'm.text', body: `Room note ${index}` });
  }

  await page.addInitScript(installFrameSampler, KEYS);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
    key: KEYS.ids,
    value: JSON.stringify({ longId }),
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.getByRole('link', { name: roomName }).first().click();
  const card = page.locator(`[data-thread-root-id="${rootId}"]`);
  await expect(card).toBeVisible({ timeout: 60_000 });

  const stopScreencast = SHOTS ? await recordScreencast(page, `${SHOTS}/first-open`) : undefined;
  await page.evaluate(() =>
    (window as unknown as { startFirstOpenFrames: () => void }).startFirstOpenFrames()
  );
  await card.click();
  await expect(page.locator(`[data-message-id="${newestId}"]`)).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(SAMPLE_MS);
  await stopScreencast?.();
  const frames = await page.evaluate(
    () => (window as unknown as { firstOpenFrames: Frame[] }).firstOpenFrames
  );
  writeFileSync(test.info().outputPath('frames.json'), JSON.stringify(frames));

  const painted = frames.findIndex((frame) => frame.ids.some((id) => id !== rootId));
  expect(painted, 'a frame shows replies').toBeGreaterThanOrEqual(0);
  const first = frames[painted]!;
  test
    .info()
    .annotations.push({ type: 'first paint', description: `${first.t} ms after the click` });
  expect(first.ids, 'the first painted frame holds the long reply').toContain(longId);
  expect(first.longWhole, 'the first painted frame shows the long reply whole').toBe(true);
  const later = frames.slice(painted + 1);
  // A row the first frame did not have, in view before one it had, came in above it. A row the
  // list mounts beside its view once the thread shows is not in view: the reader sees none of it.
  const insertedAbove = later.filter((frame) =>
    frame.ids.some(
      (id, index) =>
        !first.ids.includes(id) &&
        frame.visible.includes(id) &&
        frame.ids.slice(index + 1).some((next) => first.ids.includes(next))
    )
  );
  expect(insertedAbove, 'frames with a row inserted above the first paint').toEqual([]);
  expect(
    later.filter((frame) => frame.visible.join() !== first.visible.join()),
    'frames whose rows in view differ from the first paint'
  ).toEqual([]);
  expect(
    frames.filter((frame) => frame.loadingLine),
    'frames with a loading line'
  ).toEqual([]);
});
