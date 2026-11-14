import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// A thread without an AI summary shows the start of its first message as the banner's title,
// instead of "Thread View": one line of plain text (markdown gone, a mention as the person's name),
// cut after a whole word with an ellipsis when it is too long, kept whole when it fits, in its own
// direction. A thread with a summary still shows the summary. Checked on a phone and a desktop,
// in English and Arabic, light and dark, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. Screenshots go to the test's output directory.
const PASSWORD = 'thread-banner-root-title-password';
const RUN = Date.now().toString(36);
const COLLEAGUE_NAME = 'Sam Rivera';
const longBody = (mention: string) =>
  `**Release checklist** for ${mention}: confirm the staging database migration ran cleanly, ` +
  'rotate the API keys that expire this month, update the status page, and tell support which ' +
  'customers see the new billing screen before the Friday deploy window opens at nine.';
const LONG_TEXT = longBody(COLLEAGUE_NAME).replace(/\*\*/g, '');
const SHORT_TEXT = 'Lunch at noon?';
const ARABIC_TEXT =
  'هل يمكننا نقل اجتماع مراجعة الميزانية الفصلية إلى يوم الخميس بعد الظهر لأن فريق المالية ' +
  'مشغول بإغلاق الحسابات الشهرية هذا الأسبوع ولا يستطيع الحضور صباح الأربعاء كما هو مخطط';
const SUMMARIZED_ROOT = 'Can someone look at the flaky upload test on the Windows runners today?';
const SUMMARY = 'Flaky Windows upload test';

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});
test.describe.configure({ timeout: 240_000 });

const registerAndLogin = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`brt_${name}_${RUN}`, PASSWORD);

/** A room with an agent, so it opens as Compact cards, and four threads the agent answered. */
const seed = async (key: string) => {
  const reader = await registerAndLogin(`reader_${key}`);
  const colleague = await registerAndLogin(`colleague_${key}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(colleague.userId)}/displayname`, {
    method: 'PUT',
    accessToken: colleague.accessToken,
    body: JSON.stringify({ displayname: COLLEAGUE_NAME }),
  });
  const agent = await registerAgentAccount(HOMESERVER, `ops_${key}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Release planning',
    invite: [colleague.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const thread = async (body: string, summary?: string) => {
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    const relation = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    };
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'On it, I will post an update here within the hour.',
      'io.mindroom.stream_status': 'completed',
      'm.relates_to': relation,
    });
    if (summary) {
      await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        msgtype: 'm.notice',
        body: summary,
        'io.mindroom.thread_summary': {
          version: 1,
          summary,
          message_count: 2,
          generated_at: new Date().toISOString(),
          model: 'test',
        },
        'm.relates_to': relation,
      });
    }
    return rootId;
  };
  return {
    reader,
    roomId,
    long: await thread(longBody(colleague.userId)),
    short: await thread(SHORT_TEXT),
    arabic: await thread(ARABIC_TEXT),
    summarized: await thread(SUMMARIZED_ROOT, SUMMARY),
  };
};

type TitleLine = {
  text: string;
  title: string | null;
  direction: string;
  oneLine: boolean;
  clipped: boolean;
  firstCharInside: boolean;
};

const titleLine = (line: Locator): Promise<TitleLine> =>
  line.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const text = element.firstChild;
    const range = document.createRange();
    let firstCharInside = false;
    if (text?.nodeType === Node.TEXT_NODE && text.textContent) {
      range.setStart(text, 0);
      range.setEnd(text, 1);
      const first = range.getBoundingClientRect();
      firstCharInside = first.left >= box.left - 1 && first.right <= box.right + 1;
    }
    const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || box.height;
    return {
      text: element.textContent ?? '',
      title: element.getAttribute('title'),
      direction: getComputedStyle(element).direction,
      oneLine: box.height <= lineHeight * 1.5,
      // A line the CSS ellipsis cuts is wider inside than its box.
      clipped: element.scrollWidth > element.clientWidth + 1,
      firstCharInside,
    };
  });

/** The shown text is the whole text, or its start up to a word's end, then an ellipsis. */
const expectWordCut = (shown: string, full: string) => {
  if (shown === full) return;
  expect(shown.endsWith('…'), `"${shown}" ends with an ellipsis`).toBe(true);
  const start = shown.slice(0, -1);
  expect(full.startsWith(start), `"${start}" starts "${full}"`).toBe(true);
  expect(full.slice(start.length), 'the cut falls at a word boundary').toMatch(/^[\p{P}]*\s/u);
  expect(start.length).toBeGreaterThan(8);
};

const check = async (
  browser: Browser,
  engine: string,
  phone: boolean,
  shot: (name: string) => string,
  baseURL?: string
) => {
  const world = await seed(`${engine[0]}${phone ? 'p' : 'd'}`);
  const context = await browser.newContext({
    ...(phone
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } }),
    baseURL,
  });
  await context.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  const page: Page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.reader.username,
    password: PASSWORD,
  });
  const device = `${engine}-${phone ? 'phone' : 'desktop'}`;
  const banner = page.locator('[data-thread-context-banner]');
  const rootTitle = banner.locator('[data-thread-context-root-title]');
  const openThread = async (rootId: string) => {
    await page.goto(
      `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(rootId)}`
    );
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[data-message-id="${rootId}"]`).first()).toBeVisible({
      timeout: 30_000,
    });
  };

  for (const scheme of ['light', 'dark'] as const) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    for (const [name, rootId, full, direction] of [
      ['long', world.long, LONG_TEXT, 'ltr'],
      ['short', world.short, SHORT_TEXT, 'ltr'],
      ['arabic', world.arabic, ARABIC_TEXT, 'rtl'],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      await openThread(rootId);
      // eslint-disable-next-line no-await-in-loop
      await banner.screenshot({ path: shot(`${device}-${scheme}-en-${name}.png`) });
      // eslint-disable-next-line no-await-in-loop
      await expect(banner.getByText('Thread View', { exact: true })).toHaveCount(0);
      // eslint-disable-next-line no-await-in-loop
      const line = await titleLine(rootTitle);
      expect(line.title, `${name}: the whole message on hover`).toBe(full);
      expect(line.direction, name).toBe(direction);
      expect(line.oneLine, `${name}: one line`).toBe(true);
      expect(line.clipped, `${name}: cut by the title, not by the line`).toBe(false);
      expect(line.firstCharInside, `${name}: its start in view`).toBe(true);
      expectWordCut(line.text, full);
      if (name === 'short') expect(line.text).toBe(SHORT_TEXT);
      else expect(line.text, `${name} is too long for one line`).not.toBe(full);
    }
  }

  // The AI summary still wins.
  await openThread(world.summarized);
  await expect(banner.locator('[data-thread-context-summary]')).toHaveText(SUMMARY);
  await expect(rootTitle).toHaveCount(0);

  // An Arabic interface: the English title keeps its own direction and is still cut at a word.
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'ar'));
  await page.emulateMedia({ colorScheme: 'light' });
  for (const [name, rootId, full, direction] of [
    ['long', world.long, LONG_TEXT, 'ltr'],
    ['arabic', world.arabic, ARABIC_TEXT, 'rtl'],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    await openThread(rootId);
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // eslint-disable-next-line no-await-in-loop
    await banner.screenshot({ path: shot(`${device}-light-ar-${name}.png`) });
    // eslint-disable-next-line no-await-in-loop
    const line = await titleLine(rootTitle);
    expect(line.direction, name).toBe(direction);
    expect(line.clipped, `${name}: cut by the title, not by the line`).toBe(false);
    expect(line.firstCharInside, `${name}: its start in view`).toBe(true);
    expectWordCut(line.text, full);
  }
  await context.close();
};

for (const phone of [true, false]) {
  const device = phone ? 'phone' : 'desktop';
  test(`the banner titles an unsummarized thread by its first message, Chromium ${device}`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    await check(browser, 'chromium', phone, (name) => testInfo.outputPath(name), baseURL);
  });

  test(`the banner titles an unsummarized thread by its first message, WebKit ${device}`, async ({
    baseURL,
  }, testInfo) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    const browser = await launchWebKit();
    try {
      await check(browser, 'webkit', phone, (name) => testInfo.outputPath(name), baseURL);
    } finally {
      await browser.close();
    }
  });
}
