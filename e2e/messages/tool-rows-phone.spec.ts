import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  webkit,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';

// An agent's tool calls show as one line each in its reply: icon, title, detail and an arrow
// right after the text. On a phone (390 by 844, touch), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit:
// - In Russian, the Inbox's narrow cards leave a tool line less room than its title needs. The
//   title truncates with an ellipsis and the arrow stays in view, right after it.
// Set TOOL_ROWS_SHOTS=<directory> to save each check's rows.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
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

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `trp_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

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
 * A thread where an agent ran two tools for the reader, mentioning them so that the reply also
 * shows in the Inbox, and ran a third one that the reader approved.
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

const disclosures = (page: Page) =>
  page.locator('[data-message-disclosure] > button[aria-controls]');

/** Opens a page in a language; the app reads the language once, at start. */
const openIn = async (page: Page, language: string, route: string) => {
  await page.evaluate((code) => localStorage.setItem('i18nextLng', code), language);
  await page.goto(route);
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

/** Russian Inbox: the narrow card truncates a tool line's title and keeps its arrow in view. */
const checkRussianInbox = async (page: Page, engine: string) => {
  await openIn(page, 'ru', '/inbox/notifications/');
  const rows = disclosures(page);
  await expect(rows.first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  const arrows = await Promise.all((await rows.all()).map((row) => measureArrow(row)));
  console.log(`${engine} ru inbox: ${JSON.stringify(arrows)}`);
  await shot(page, rows.first().locator('xpath=..'), `tool-row-ru-inbox-${engine}-phone`);
  for (const arrow of arrows) {
    const where = `${engine}, Russian Inbox, ${arrow.text.slice(0, 40)}`;
    expect
      .soft(arrow.roomToEnd, `the arrow stays inside the line (${where})`)
      .toBeGreaterThanOrEqual(0);
    expect.soft(arrow.painted, `the arrow is painted (${where})`).toBe(true);
    expect.soft(arrow.titleClear, `the title ends before the arrow (${where})`).toBe(true);
    if (arrow.titleTruncated) {
      expect
        .soft(arrow.titleOverflow, `a cut title ends in an ellipsis (${where})`)
        .toBe('ellipsis');
    }
    expect.soft(arrow.gapToText, `the arrow follows the text (${where})`).toBeLessThanOrEqual(20);
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
    await checkRussianInbox(page, engine);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('an agent’s tool lines on a phone (Chromium)', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('an agent’s tool lines on a phone (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
