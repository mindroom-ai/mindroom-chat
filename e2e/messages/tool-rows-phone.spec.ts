import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// An agent's tool calls show as one line each in its reply: icon, title, detail and an arrow
// right after the text. On a phone (390 by 844, touch), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit:
// - In Arabic, a tool's output, its arguments and the tool names after the title read in their
//   own direction: `8 results` and `2026 SaaS churn benchmarks`, not `results 8`, and a list of
//   tool names cut short keeps its start. English reads the same as before.
// - An approval's receipt inside an opened approval line has the tool line's arrow: after the
//   text, pointing along the text while closed and down while open.
// Set TOOL_ROWS_SHOTS=<directory> to save each check's rows.
const PASSWORD = 'tool-rows-phone-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.TOOL_ROWS_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const RESULT = '8 results';
const QUERY = '2026 SaaS churn benchmarks';
const COMMAND = 'python export_chart.py --slide 6';

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const registerAndLogin = (name: string): Promise<MatrixSession & { username: string }> =>
  registerDisposableUser(`trp_${name}_${RUN}`, PASSWORD);

const traceOf = (...calls: [string, string, string][]) => ({
  version: 2,
  events: calls.map(([tool, args, result]) => ({
    type: 'tool_call_completed',
    tool_name: tool,
    args_preview: args,
    result_preview: result,
  })),
});

/**
 * A thread where an agent ran two tools for the reader, in a reply that mentions them, and ran a
 * third one that the reader approved.
 */
const seed = async (engine: string) => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const agent = await registerAgentAccount(HOMESERVER, `research_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Board deck',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Compare our Q3 churn against SaaS benchmarks, then chart the cohorts for slide 6.',
  });
  const inThread = (lastId: string) => ({
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: lastId },
    },
  });
  const mention = `<a href="https://matrix.to/#/${reader.userId}">${reader.username}</a>`;
  const compared = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: `🔧 \`web_search\` [1]\n\n🔧 \`run_python_code\` [2]\n\n${reader.username}: Q3 monthly churn came in at 2.9%, down from 3.4% in Q2.`,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>🔧 <code>web_search</code> [1]</p><p>🔧 <code>run_python_code</code> [2]</p><p>${mention}: Q3 monthly churn came in at 2.9%, down from 3.4% in Q2.</p>`,
    'm.mentions': { user_ids: [reader.userId] },
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.tool_trace': traceOf(
      ['web_search', `query=${QUERY}`, RESULT],
      ['run_python_code', 'code=churn = cancelled / start_of_month', 'q3_churn=0.029']
    ),
    ...inThread(rootId),
  });
  const exported = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: '🔧 `run_shell_command` [1]\n\nExported slide6_cohorts.svg with 12 cohorts.',
    format: 'org.matrix.custom.html',
    formatted_body:
      '<p>🔧 <code>run_shell_command</code> [1]</p><p>Exported slide6_cohorts.svg with 12 cohorts.</p>',
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.tool_trace': traceOf([
      'run_shell_command',
      `command=${COMMAND}`,
      'wrote slide6_cohorts.svg',
    ]),
    ...inThread(compared),
  });
  const now = Date.now();
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/io.mindroom.tool_approval/approval-${RUN}-${engine}`,
    {
      method: 'PUT',
      accessToken: agent.accessToken,
      body: JSON.stringify({
        msgtype: 'io.mindroom.tool_approval',
        body: 'Approval required: run_shell_command',
        approval_id: `approval-${RUN}-${engine}`,
        tool_name: 'run_shell_command',
        agent_name: 'research',
        status: 'approved',
        approvable: true,
        approver_user_id: reader.userId,
        requester_id: reader.userId,
        approval_scope: {
          id: 'shell',
          entity_name: 'research',
          invoking_agent: 'research',
          operation: { tool_name: 'run_shell_command' },
        },
        arguments: { command: COMMAND },
        requested_at: new Date(now - 60_000).toISOString(),
        expires_at: new Date(now + 3_600_000).toISOString(),
        resolved_at: new Date(now - 30_000).toISOString(),
        resolved_by: reader.userId,
        response_event_id: exported,
        thread_id: rootId,
        ...inThread(exported),
      }),
    }
  );
  return { reader, roomId, rootId };
};

type World = Awaited<ReturnType<typeof seed>>;

const disclosures = (page: Page) =>
  page.locator('[data-message-disclosure] > button[aria-controls]');

/** Opens a page in a language; the app reads the language once, at start. */
const openIn = async (page: Page, language: string, route: string) => {
  await page.evaluate((code) => localStorage.setItem('i18nextLng', code), language);
  await page.goto(route);
};

const threadRoute = (world: World) =>
  `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`;

const tap = async (page: Page, target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to tap');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};

const shot = async (page: Page, target: Locator, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // Away from the composer, which floats over the end of the thread.
  await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) return;
  const x = Math.max(0, box.x - 12);
  const y = Math.max(0, box.y - 12);
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    clip: {
      x,
      y,
      width: Math.min(viewport.width - x, box.width + 24),
      height: Math.min(viewport.height - y, box.height + 24),
    },
  });
};

/**
 * Where a disclosure's arrow sits: its gap to the text before it, its room to the row's end, the
 * angle it turns to (drawn pointing right), whether it is painted, and how the title fits.
 */
const measureArrow = (row: Locator) =>
  row.evaluate((element) => {
    const children = [...element.children] as HTMLElement[];
    const arrow = children.at(-1);
    if (!arrow) throw new Error('a disclosure without an arrow');
    const texts = children
      .slice(0, -1)
      .filter((child) => child.getBoundingClientRect().width > 0 && child.textContent?.trim());
    const rtl = getComputedStyle(element).direction === 'rtl';
    const line = element.getBoundingClientRect();
    const box = arrow.getBoundingClientRect();
    const textEnd = rtl
      ? Math.min(...texts.map((text) => text.getBoundingClientRect().left))
      : Math.max(...texts.map((text) => text.getBoundingClientRect().right));
    const { transform } = getComputedStyle(arrow);
    const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    // The title of a tool line: the first text after the icon.
    const title = texts.find((text) => text !== children[0] && text.tagName === 'SPAN');
    return {
      text: element.textContent?.trim() ?? '',
      tag: arrow.tagName.toLowerCase(),
      glyph: arrow.innerHTML,
      rtl,
      gapToText: Math.round(rtl ? textEnd - box.right : box.left - textEnd),
      roomToEnd: Math.round(rtl ? box.left - line.left : line.right - box.right),
      angle: Math.round((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI),
      painted: !!hit && (hit === arrow || arrow.contains(hit) || element.contains(hit)),
      titleTruncated: !!title && title.scrollWidth > title.clientWidth + 1,
      titleOverflow: title ? getComputedStyle(title).textOverflow : '',
      titleClear:
        !title ||
        (rtl
          ? title.getBoundingClientRect().left >= box.right
          : title.getBoundingClientRect().right <= box.left),
    };
  });

/** Where each of some texts shows inside an element, and the element's own box. */
const placeTexts = (target: Locator, needles: string[]) =>
  target.evaluate((element, texts) => {
    const rects = texts.map((needle) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(needle) ?? -1;
        if (at >= 0) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          const { left, right } = range.getBoundingClientRect();
          return { left, right };
        }
      }
      throw new Error(`no “${needle}” in ${element.textContent ?? ''}`);
    });
    const { left, right } = element.getBoundingClientRect();
    return { rects, box: { left, right } };
  }, needles);

/** Whether `first` shows left of `second`, so that the two read left to right. */
const readsLeftToRight = async (target: Locator, first: string, second: string) => {
  const { rects } = await placeTexts(target, [first, second]);
  const [before, after] = rects;
  return !!before && !!after && before.left < after.left;
};

/** The thread in a language, with the tool line of the reply that searched the web. */
const openToolLine = async (page: Page, world: World, language: 'en' | 'ar') => {
  await openIn(page, language, threadRoute(world));
  const tools = disclosures(page).filter({ hasText: 'web_search' });
  await expect(tools).toHaveCount(1, { timeout: 60_000 });
  return tools;
};

/**
 * A tool's output, its arguments and the tool names after the title read in their own direction,
 * and the output lines up with the interface.
 */
const checkOutputDirection = async (
  page: Page,
  world: World,
  engine: string,
  language: 'en' | 'ar'
) => {
  const where = `${engine}, ${language}`;
  const tools = await openToolLine(page, world, language);
  // A detail cut short keeps its start: the first tool's name shows whole.
  const names = await placeTexts(tools.getByText(/^web_search, /), ['web_search']);
  await tap(page, tools);
  await expect(tools).toHaveAttribute('aria-expanded', 'true');
  const panel = tools.locator('xpath=..');
  const result = panel.getByRole('button', { name: RESULT, exact: true });
  await expect(result).toBeVisible();
  const output = await placeTexts(result, ['8', 'results']);
  const outputReads = await readsLeftToRight(result, '8', 'results');
  const queryReads = await readsLeftToRight(
    panel.getByText(QUERY, { exact: true }),
    '2026',
    'SaaS'
  );
  console.log(`${where}: ${JSON.stringify({ names, output, outputReads, queryReads })}`);
  await shot(page, panel, `tool-row-open-${language}-${engine}-phone`);
  expect.soft(outputReads, `“${RESULT}” reads left to right (${where})`).toBe(true);
  expect.soft(queryReads, `“${QUERY}” reads left to right (${where})`).toBe(true);
  // WebKit gives text cut off by the ellipsis an empty box, so the name must also have width.
  const [name] = names.rects;
  expect
    .soft(
      !!name &&
        name.right - name.left > 1 &&
        name.left >= names.box.left - 1 &&
        name.right <= names.box.right + 1,
      `the tool names keep their start (${where})`
    )
    .toBe(true);
  // The output lines up with the interface's start: the right in Arabic.
  const lefts = output.rects.map((rect) => rect.left);
  const rights = output.rects.map((rect) => rect.right);
  const fromStart =
    language === 'ar'
      ? output.box.right - Math.max(...rights)
      : Math.min(...lefts) - output.box.left;
  expect
    .soft(fromStart, `the output starts at the interface's start (${where})`)
    .toBeLessThanOrEqual(2);
};

/** The approval line's receipt has the tool line's arrow, closed and open. */
const checkReceiptArrow = async (
  page: Page,
  world: World,
  engine: string,
  language: 'en' | 'ar'
) => {
  const where = `${engine}, ${language}`;
  const toolArrow = await measureArrow(await openToolLine(page, world, language));
  const approvals = disclosures(page).filter({
    hasText: language === 'ar' ? 'وافقت' : 'You approved',
  });
  await expect(approvals).toHaveCount(1);
  await tap(page, approvals);
  const receipt = approvals.locator('xpath=..').locator('details > summary');
  await expect(receipt).toBeVisible();
  const closed = await measureArrow(receipt);
  await tap(page, receipt);
  await expect(receipt.locator('xpath=..')).toHaveAttribute('open', '');
  await page.waitForTimeout(300);
  const open = await measureArrow(receipt);
  console.log(`${where} receipt: ${JSON.stringify({ toolArrow, closed, open })}`);
  await shot(page, approvals.locator('xpath=..'), `approval-row-open-${language}-${engine}-phone`);
  expect
    .soft(closed.glyph, `the receipt has the tool line's arrow (${where})`)
    .toBe(toolArrow.glyph);
  expect
    .soft(Math.abs(closed.angle), `the closed receipt's arrow points along the text (${where})`)
    .toBe(language === 'ar' ? 180 : 0);
  expect.soft(open.angle, `the open receipt's arrow points down (${where})`).toBe(90);
  for (const [state, arrow] of [
    ['closed', closed],
    ['open', open],
  ] as const) {
    expect
      .soft(arrow.gapToText, `the ${state} receipt's arrow follows its text (${where})`)
      .toBeGreaterThanOrEqual(0);
    expect
      .soft(arrow.gapToText, `the ${state} receipt's arrow follows its text (${where})`)
      .toBeLessThanOrEqual(14);
  }
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  const context = await browser.newContext({ ...PHONE, baseURL });
  try {
    const page = await context.newPage();
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await checkOutputDirection(page, world, engine, 'en');
    await checkOutputDirection(page, world, engine, 'ar');
    await checkReceiptArrow(page, world, engine, 'en');
    await checkReceiptArrow(page, world, engine, 'ar');
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('an agent’s tool lines on a phone (Chromium)', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('an agent’s tool lines on a phone (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
