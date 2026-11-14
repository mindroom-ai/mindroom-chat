import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  joinRoom,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// An unread thread taller than the screen, opened from a link (a full page load, as from a
// notification). Agent replies carry tool calls and reasoning, whose rows change height after
// their first paint, and the newest reply mentions the reader. The thread must land at its newest
// reply and stay there, and a thread receipt may name the newest reply only while it is in view:
// the server then clears the mention. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, in WebKit on a desktop and a phone screen, against the disposable
// homeserver.
const PASSWORD = 'unread-thread-open-landing-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.THREAD_READ_RELOAD_SHOTS;
const THEME = process.env.THREAD_READ_RELOAD_THEME ?? 'light-theme';
const REPLIES = 12;
/** How far from the bottom a landed view may stay: subpixel rounding only. */
const LANDED_PX = 4;

test.use({ viewport: { width: 1440, height: 900 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TOPICS = [
  'Deploy checklist for the 65 release',
  'Customer report: the CSV export times out',
  'Database migration plan for the billing tables',
];

const toolTrace = (calls: number) => ({
  version: 2,
  events: [
    ['run_shell_command', 'command=ls -la /srv', 'total 12'],
    ['web_search', 'query=release notes', '6 results'],
    ['read_file', 'path=README.md', '120 lines'],
  ]
    .slice(0, calls)
    .map(([name, args, result]) => ({
      type: 'tool_call_completed',
      tool_name: name,
      args_preview: args,
      result_preview: result,
    })),
});

const aiRun = () => ({
  version: 1,
  run_id: `run-${Math.random().toString(36).slice(2)}`,
  session_id: `session-${Math.random().toString(36).slice(2)}`,
  status: 'completed',
  model: { config: 'default', display_name: 'Fast', id: 'fast-model', provider: 'openai' },
});

const inThread = (rootId: string, lastId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: lastId },
});

/** A thread of REPLIES replies, agent and people in turn; the newest mentions the reader. */
const seedThread = async (
  roomId: string,
  topic: string,
  [starter, colleague]: [MatrixSession, MatrixSession],
  agent: MatrixSession,
  reader: DisposableUser
): Promise<{ rootId: string; newestId: string }> => {
  const rootId = await sendRoomMessage(HOMESERVER, starter.accessToken, roomId, {
    msgtype: 'm.text',
    body: `${topic}. Can you take a look?`,
  });
  let last = rootId;
  for (let index = 0; index < REPLIES; index += 1) {
    const newest = index === REPLIES - 1;
    let content: Record<string, unknown>;
    if (newest) {
      content = {
        msgtype: 'm.text',
        body: `${reader.username}: please confirm the ${topic.toLowerCase()} today.`,
        format: 'org.matrix.custom.html',
        formatted_body: `<a href="https://matrix.to/#/${reader.userId}">${
          reader.username
        }</a>: please confirm the ${topic.toLowerCase()} today.`,
        'm.mentions': { user_ids: [reader.userId] },
      };
    } else if (index % 2 === 0) {
      const calls = index % 4 === 0 ? 1 + (index % 3) : 0;
      content = {
        msgtype: 'm.text',
        body: `Reply ${
          index + 1
        } on "${topic}": checked the logs and the open tickets, noted the next step and who owns it.`,
        'io.mindroom.stream_status': 'completed',
        'io.mindroom.ai_run': aiRun(),
        ...(calls > 0 && { 'io.mindroom.tool_trace': toolTrace(calls) }),
        ...(index % 6 === 0 && {
          'io.mindroom.reasoning': {
            text: 'Checked the previous replies first. Then compared the numbers and picked the shortest answer.',
            duration_ms: 4200,
          },
        }),
      };
    } else {
      content = {
        msgtype: 'm.text',
        body: `Follow-up ${
          index + 1
        }: thanks, please also check the edge case where the job retries twice.`,
      };
    }
    let sender = agent;
    if (newest) sender = starter;
    else if (index % 2 === 1) sender = colleague;
    // eslint-disable-next-line no-await-in-loop
    last = await sendRoomMessage(HOMESERVER, sender.accessToken, roomId, {
      ...content,
      'm.relates_to': inThread(rootId, last),
    });
  }
  return { rootId, newestId: last };
};

type ThreadView = {
  /** Scroll distance below the view. */
  gap: number;
  /** Whether the newest reply's row is mounted and its bottom is above the composer. */
  newestShown: boolean;
  /** How far the newest reply's bottom is below the composer's top, when it is mounted. */
  newestBelow: number | null;
};

type ReceiptRecord = { at: number; url: string; body: string; view: ThreadView | null };

const NEWEST_KEY = 'e2e-newest-reply-id';

/**
 * Records every receipt request with the thread view at the moment it is sent. The newest reply
 * is the one localStorage names under NEWEST_KEY.
 */
const recordReceipts = (newestKey: string) => {
  const win = window as unknown as {
    receiptRecords: ReceiptRecord[];
    readThreadView: () => ThreadView | null;
  };
  win.receiptRecords = [];
  const frames: unknown[] = [];
  Object.assign(window, { landingFrames: frames });
  const sample = () => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]');
    let scroll = inner?.parentElement ?? null;
    while (scroll && !/^(auto|scroll)$/.test(getComputedStyle(scroll).overflowY)) {
      scroll = scroll.parentElement;
    }
    if (inner && scroll && frames.length < 1200) {
      frames.push({
        t: performance.now(),
        top: scroll.scrollTop,
        height: scroll.scrollHeight,
        viewport: scroll.clientHeight,
        listHeight: inner.style.height,
        margin: inner.style.marginTop,
        bottom: inner.getBoundingClientRect().bottom,
        visibility: getComputedStyle(inner).visibility,
        rows: Array.from(inner.querySelectorAll<HTMLElement>(':scope > [data-index]')).map(
          (tile) => ({
            index: tile.dataset.index,
            top: tile.getBoundingClientRect().top,
            bottom: tile.getBoundingClientRect().bottom,
            height: tile.offsetHeight,
          })
        ),
      });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  win.readThreadView = () => {
    const inner = document.querySelector<HTMLElement>('[data-thread-count]');
    let scroller = inner?.parentElement ?? null;
    while (scroller && !/^(auto|scroll)$/.test(window.getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return null;
    const box = scroller.getBoundingClientRect();
    const composer = document.querySelector<HTMLElement>('[contenteditable="true"]');
    const visibleBottom = Math.min(box.bottom, composer?.getBoundingClientRect().top ?? box.bottom);
    const newestId = window.localStorage.getItem(newestKey) ?? '';
    const row = scroller.querySelector<HTMLElement>(`[data-message-id="${newestId}"]`);
    const rowBox = row?.getBoundingClientRect();
    return {
      gap: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      newestShown:
        !!rowBox &&
        !!inner &&
        window.getComputedStyle(inner).visibility !== 'hidden' &&
        rowBox.bottom <= visibleBottom + 2 &&
        rowBox.bottom > box.top,
      newestBelow: rowBox ? Math.round(rowBox.bottom - visibleBottom) : null,
    };
  };
  const send = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/receipt/')) {
      win.receiptRecords.push({
        at: performance.now(),
        url: decodeURIComponent(url),
        body: typeof init?.body === 'string' ? init.body : '',
        view: win.readThreadView(),
      });
    }
    return send(input, init);
  };
};

const readView = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { readThreadView: () => ThreadView | null }).readThreadView()
  );

const unreadThreadOpensAtItsNewestReply = async (page: Page, browserName: string) => {
  const reader = await registerDisposableUser(`utol_reader_${browserName}_${RUN}`, PASSWORD);
  const people: [DisposableUser, DisposableUser] = [
    await registerDisposableUser(`utol_dana_${browserName}_${RUN}`, PASSWORD),
    await registerDisposableUser(`utol_omar_${browserName}_${RUN}`, PASSWORD),
  ];
  const agent = await registerAgentAccount(HOMESERVER, 'writer');
  const roomName = `Engineering ops ${browserName} ${RUN}`;
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    invite: [...people.map((person) => person.userId), agent.userId],
  });
  for (let index = 0; index < 24; index += 1) {
    // Exercise the real sidebar alongside the thread, with 25 rooms in the account.
    // eslint-disable-next-line no-await-in-loop
    await createRoom(HOMESERVER, reader.accessToken, { name: `Workspace ${index + 1}` });
  }
  for (const member of [...people, agent]) {
    // eslint-disable-next-line no-await-in-loop
    await joinRoom(HOMESERVER, member.accessToken, roomId);
  }
  const threads: Array<{ rootId: string; newestId: string }> = [];
  for (const topic of TOPICS) {
    // eslint-disable-next-line no-await-in-loop
    threads.push(await seedThread(roomId, topic, people, agent, reader));
  }

  await page.addInitScript(recordReceipts, NEWEST_KEY);
  await page.addInitScript((themeId) => {
    localStorage.setItem('settings', JSON.stringify({ useSystemTheme: false, themeId }));
  }, THEME);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await expect(page.getByRole('link', { name: roomName }).first()).toBeVisible({
    timeout: 60_000,
  });

  for (const [index, { rootId, newestId }] of threads.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(({ key, id }) => window.localStorage.setItem(key, id), {
      key: NEWEST_KEY,
      id: newestId,
    });
    // From a link: the app starts with the thread open.
    // eslint-disable-next-line no-await-in-loop
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator(`[data-message-id="${newestId}"]`)).toBeAttached({
      timeout: 60_000,
    });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(5_000);
    // eslint-disable-next-line no-await-in-loop
    const view = await readView(page);
    // Keep the opening geometry even when the assertion below fails.
    // eslint-disable-next-line no-await-in-loop
    await test.info().attach(`landing-${browserName}-${index + 1}.json`, {
      body: JSON.stringify(await page.evaluate(() => Reflect.get(window, 'landingFrames'))),
      contentType: 'application/json',
    });
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      writeFileSync(
        `${SHOTS}/landing-${browserName}-${index + 1}.json`,
        // eslint-disable-next-line no-await-in-loop
        JSON.stringify(await page.evaluate(() => Reflect.get(window, 'landingFrames')))
      );
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({
        path: `${SHOTS}/unread-thread-open-${browserName}-${index + 1}.png`,
      });
    }
    expect(view, `thread ${index + 1}: newest reply shown`).toMatchObject({ newestShown: true });
    expect(view?.gap, `thread ${index + 1}: distance below the view`).toBeLessThanOrEqual(
      LANDED_PX
    );
    // eslint-disable-next-line no-await-in-loop
    const receipts = await page.evaluate(
      () => (window as unknown as { receiptRecords: ReceiptRecord[] }).receiptRecords
    );
    if (SHOTS) {
      writeFileSync(`${SHOTS}/receipts-${browserName}-${index + 1}.json`, JSON.stringify(receipts));
    }
    const newestReceipts = receipts.filter((receipt) => receipt.url.includes(`/${newestId}`));
    expect(newestReceipts.length, `thread ${index + 1}: a receipt for the newest reply`).toBe(1);
    newestReceipts.forEach((receipt) =>
      expect(
        receipt.view,
        `thread ${index + 1}: receipt sent in view ${JSON.stringify(receipt)}`
      ).toMatchObject({
        newestShown: true,
      })
    );
  }
};

test('an unread thread opened from a link lands at its newest reply (Chromium)', async ({
  page,
  browserName,
}) => {
  test.setTimeout(300_000);
  await unreadThreadOpensAtItsNewestReply(page, browserName);
});

test('an unread thread opened from a link lands at its newest reply (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  await onWebKitPage({ viewport: { width: 1440, height: 900 }, baseURL }, (page) =>
    unreadThreadOpensAtItsNewestReply(page, 'webkit')
  );
});

test('an unread thread opened from a link lands at its newest reply (phone, WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  await onWebKitPage(
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL },
    (page) => unreadThreadOpensAtItsNewestReply(page, 'phone')
  );
});

test('an unread thread opened from a link lands at its newest reply (phone, Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    baseURL,
  });
  try {
    await unreadThreadOpensAtItsNewestReply(await context.newPage(), 'chromium-phone');
  } finally {
    await context.close();
  }
});
