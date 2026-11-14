import { writeFileSync } from 'node:fs';
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
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A thread of 2,000 replies opens at its newest replies from the first frame that shows any
// reply: neither the root followed by the newest replies the client already holds, nor a jump to
// the bottom a moment later. Every frame is sampled after it is painted, for opens from the
// room's thread card and from a link (a full page load). Agent replies carry tool calls, lists
// and code blocks, people write short and long notes, so rows differ in height. Runs in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the
// disposable homeserver.
const PASSWORD = 'long-thread-first-paint-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.THREAD_READ_RELOAD_SHOTS;
const REPLIES = Number(process.env.LONG_THREAD_REPLIES ?? 2000);
/** How long each open is sampled. */
const SAMPLE_MS = 6_000;

test.use({ viewport: { width: 1440, height: 900 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const replyContent = (index: number, rootId: string): Record<string, unknown> => {
  const relation = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  if (index % 3 === 0) {
    return {
      msgtype: 'm.text',
      body: `Update ${index}: ran the checks.\n\n- step one done\n- step two pending\n\n\`\`\`\nstatus=${index}\n\`\`\``,
      format: 'org.matrix.custom.html',
      formatted_body: `<p>Update ${index}: ran the checks.</p><ul><li>step one done</li><li>step two pending</li></ul><pre><code>status=${index}\n</code></pre>`,
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'run_shell_command',
            args_preview: 'command=ls -la /srv',
            result_preview: 'total 12',
          },
        ],
      },
      'm.relates_to': relation,
    };
  }
  const body =
    index % 3 === 1
      ? `Message ${index}: noted, moving on to the next item.`
      : `Message ${index}: a longer note that wraps over a couple of lines so the rows have different heights in the virtualized list, as people write in a busy incident thread.`;
  return { msgtype: 'm.text', body, 'm.relates_to': relation };
};

const send = (session: MatrixSession, roomId: string, content: Record<string, unknown>) =>
  matrixFetch<{ event_id: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/ltfp-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
    { method: 'PUT', accessToken: session.accessToken, body: JSON.stringify(content) }
  ).then((response) => response.event_id);

type Frame = {
  t: number;
  /** Rows of the thread's list in the DOM, 0 while the list is hidden. */
  rows: number;
  /** Scroll distance below the view. */
  gap: number;
  /** Whether part of the root's row is in view (above the composer). */
  rootShown: boolean;
  /** Whether part of the newest reply's row is in view (above the composer). */
  newestShown: boolean;
  /** The newest reply's bottom below the visible area's bottom, or null when not mounted. */
  newestBelow: number | null;
  /** Thread rows the list holds (`data-thread-count`). */
  count: number;
  /** The last mounted row's event ID. */
  lastRow: string;
};

const NEWEST_KEY = 'e2e-long-thread-newest';
const ROOT_KEY = 'e2e-long-thread-root';

/**
 * Samples the open thread after every painted frame (a task after the frame's callbacks) into
 * `window.threadFrames`, until SAMPLE_MS after `window.startThreadFrames()` or the page load.
 */
const installFrameSampler = (keys: { newest: string; root: string; sampleMs: number }) => {
  const win = window as unknown as { threadFrames: Frame[]; startThreadFrames: () => void };
  let start = performance.now();
  win.threadFrames = [];
  const channel = new MessageChannel();
  const inView = (row: Element | null | undefined, top: number, bottom: number) => {
    const box = row?.getBoundingClientRect();
    return !!box && box.bottom > top + 1 && box.top < bottom - 1;
  };
  channel.port1.onmessage = () => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]');
    let scroller = inner?.parentElement ?? null;
    while (scroller && !/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const composer = document.querySelector<HTMLElement>('[contenteditable="true"]');
      const bottom = Math.min(box.bottom, composer?.getBoundingClientRect().top ?? box.bottom);
      const newestId = window.localStorage.getItem(keys.newest) ?? '';
      const rootId = window.localStorage.getItem(keys.root) ?? '';
      const newest = scroller.querySelector(`[data-message-id="${newestId}"]`);
      const newestBox = newest?.getBoundingClientRect();
      // A hidden list paints no rows.
      const painted = !!inner && window.getComputedStyle(inner).visibility !== 'hidden';
      win.threadFrames.push({
        t: Math.round(performance.now() - start),
        rows: painted ? scroller.querySelectorAll('[data-message-id]').length : 0,
        gap: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
        rootShown: inView(scroller.querySelector(`[data-message-id="${rootId}"]`), box.top, bottom),
        newestShown: inView(newest, box.top, bottom),
        newestBelow: newestBox ? Math.round(newestBox.bottom - bottom) : null,
        count: Number(inner?.dataset.threadCount ?? 0),
        lastRow:
          [...scroller.querySelectorAll('[data-message-id]')]
            .at(-1)
            ?.getAttribute('data-message-id') ?? '',
      });
    }
    if (performance.now() - start < keys.sampleMs) {
      requestAnimationFrame(() => channel.port2.postMessage(0));
    }
  };
  win.startThreadFrames = () => {
    start = performance.now();
    win.threadFrames = [];
    requestAnimationFrame(() => channel.port2.postMessage(0));
  };
  requestAnimationFrame(() => channel.port2.postMessage(0));
};

const readFrames = (page: Page) =>
  page.evaluate(() => (window as unknown as { threadFrames: Frame[] }).threadFrames);

/**
 * Every sampled frame that shows a reply of the thread shows its newest reply, at least in part:
 * the frame after older history first arrives can show it a row lower for one frame (the list's
 * height follows its rows one render later), which is not the jump this spec is about.
 */
const expectNoFrameAwayFromNewest = (frames: Frame[], label: string) => {
  const withReplies = frames.filter((frame) => frame.rows > 1);
  expect(withReplies.length, `${label}: frames with replies`).toBeGreaterThan(0);
  const away = withReplies.filter((frame) => !frame.newestShown);
  expect(away, `${label}: frames that show replies without the newest one`).toEqual([]);
};

const longThreadOpensAtItsNewestReplies = async (page: Page, browserName: string) => {
  const reader = await registerDisposableUser(`ltfp_reader_${browserName}_${RUN}`, PASSWORD);
  const colleague = await registerDisposableUser(`ltfp_colleague_${browserName}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'planner');
  const roomName = `Archive thread ${browserName} ${RUN}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [colleague.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await send(reader, roomId, {
    msgtype: 'm.text',
    body: 'Incident log for the storage migration. Post every update here.',
  });
  let newestId = '';
  for (let index = 1; index <= REPLIES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    newestId = await send(index % 3 === 0 ? agent : colleague, roomId, replyContent(index, rootId));
  }

  await page.addInitScript(installFrameSampler, {
    newest: NEWEST_KEY,
    root: ROOT_KEY,
    sampleMs: SAMPLE_MS,
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.evaluate(
    (entries) => entries.forEach(({ key, id }) => window.localStorage.setItem(key, id)),
    [
      { key: NEWEST_KEY, id: newestId },
      { key: ROOT_KEY, id: rootId },
    ]
  );
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });

  // From the room's thread card.
  await page.getByRole('link', { name: roomName }).first().click();
  const card = page.locator(`[data-thread-root-id="${rootId}"]`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() =>
    (window as unknown as { startThreadFrames: () => void }).startThreadFrames()
  );
  await card.click();
  await expect(page.locator(`[data-message-id="${newestId}"]`)).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(SAMPLE_MS);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/long-thread-card-${browserName}.png` });
  const fromCard = await readFrames(page);
  writeFileSync(
    test.info().outputPath(`frames-card-${browserName}.json`),
    JSON.stringify(fromCard)
  );

  // From a link: the app starts with the thread open.
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.locator(`[data-message-id="${newestId}"]`)).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(SAMPLE_MS);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/long-thread-link-${browserName}.png` });
  const fromLink = await readFrames(page);
  writeFileSync(
    test.info().outputPath(`frames-link-${browserName}.json`),
    JSON.stringify(fromLink)
  );

  expectNoFrameAwayFromNewest(fromCard, 'opened from its card');
  expectNoFrameAwayFromNewest(fromLink, 'opened from a link');
};

test('a long thread opens at its newest replies from its first painted reply (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(600_000);
  await longThreadOpensAtItsNewestReplies(page, browserName);
});

test('a long thread opens at its newest replies from its first painted reply (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(600_000);
  await onWebKitPage({ viewport: { width: 1440, height: 900 }, baseURL }, (page) =>
    longThreadOpensAtItsNewestReplies(page, 'webkit')
  );
});
