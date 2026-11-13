import { mkdirSync, writeFileSync } from 'node:fs';
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
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// The thread banner of a long, tagged thread with a pending scheduled task, on a phone (390 by
// 844, touch) and on a desktop (1440 by 900), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, in WebKit:
// - The title is readable beside the schedule: a title cut short has the whole line to itself,
//   whether it is an AI summary or the start of the first message.
// - A reader at the end of the thread stays there while the banner's thread menu, its tag picker
//   and Edit summary open and close, and while keyboard focus moves into the banner (Tab, or focus
//   handed back by a dialog): the thread does not move. Browsers scrolled it to bring a focused
//   banner control out from under the scroll padding that keeps rows clear of the banner, about
//   380 px in Chromium and 90 px in WebKit.
// - A tap leaves no hover surface on a tool-call line; a mouse over it still shows one.
// Set BANNER_SCROLL_SHOTS=<directory> to save the screen at each step.
const PASSWORD = 'thread-banner-phone-scroll-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.BANNER_SCROLL_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };

const SUMMARY = 'API rate limit change 415';
const ROOT_BODY =
  'Planner, the API rate limit change 415 needs a rollout plan. Can you take a look?';
const UNTITLED_ROOT = 'Quarterly invoice export for the finance team keeps timing out';
const TAGS = [
  'billing',
  'blocked',
  'api',
  'rate-limits',
  'customer',
  'follow-up',
  'q4',
  'infra',
] as const;
const REPLY_COUNT = 30;
const lastReply = `Follow-up ${REPLY_COUNT}`;

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const inThread = (rootId: string, lastId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: lastId },
  },
});

const toolReply = (body: string) => ({
  msgtype: 'm.text',
  body: `🔧 \`run_shell_command\` [1]\n\n${body}`,
  format: 'org.matrix.custom.html',
  formatted_body: `<p>🔧 <code>run_shell_command</code> [1]</p><p>${body}</p>`,
  'io.mindroom.stream_status': 'completed',
  'io.mindroom.tool_trace': {
    version: 2,
    events: [
      {
        type: 'tool_call_completed',
        tool_name: 'run_shell_command',
        args_preview: 'command=grep -c 429 /var/log/gateway/access.log',
        result_preview: '312',
      },
    ],
  },
});

/** A pending task of the agent's, due in two days, that answers in the thread. */
const schedule = (agent: MatrixSession, roomId: string, rootId: string, taskId: string) =>
  sendStateEvent(HOMESERVER, agent.accessToken, roomId, 'com.mindroom.scheduled.task', taskId, {
    status: 'pending',
    created_by: agent.userId,
    workflow: {
      schedule_type: 'once',
      thread_id: rootId,
      execute_at: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
      message: 'Check the 429 rate after the rollout.',
    },
  });

/**
 * The reader's rooms (25, as an account in use has), one of them with an agent and two threads:
 * a long one with an AI title, eight tags and a scheduled task, and a short one without a title
 * whose first message names it, scheduled too.
 */
const seed = async (engine: string) => {
  const reader = await registerDisposableUser(`tbps_reader_${engine}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `planner_${engine}`);
  const roomId = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: reader.accessToken,
    body: JSON.stringify({
      name: 'Platform operations',
      preset: 'private_chat',
      invite: [agent.userId],
      // The agent writes the room's scheduled tasks, which takes state power.
      power_level_content_override: { users: { [agent.userId]: 50 } },
    }),
  }).then((created) => created.room_id);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );

  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: ROOT_BODY,
  });
  let last = rootId;
  for (let index = 1; index <= REPLY_COUNT; index += 1) {
    const fromAgent = index % 2 === 1;
    const body = fromAgent
      ? `Reply ${index}: the gateway returned 429 for 312 requests in the last hour; the new limit of 2,000 per minute holds for the batch clients.`
      : `Follow-up ${index}: thanks, please also check the edge case for clients that retry without a backoff.`;
    // eslint-disable-next-line no-await-in-loop
    last = await sendRoomMessage(
      HOMESERVER,
      fromAgent ? agent.accessToken : reader.accessToken,
      roomId,
      {
        ...(fromAgent && index % 3 === 0 ? toolReply(body) : { msgtype: 'm.text', body }),
        ...inThread(rootId, last),
      }
    );
  }
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.notice',
    body: `🗄️ ${SUMMARY}`,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: `🗄️ ${SUMMARY}`,
      generated_at: Date.now(),
      message_count: REPLY_COUNT + 1,
    },
    ...inThread(rootId, last),
  });
  const setAt = new Date().toISOString();
  await sendStateEvent(HOMESERVER, reader.accessToken, roomId, 'com.mindroom.thread.tags', rootId, {
    tags: Object.fromEntries(TAGS.map((tag) => [tag, { set_by: reader.userId, set_at: setAt }])),
  });
  await schedule(agent, roomId, rootId, `task-${RUN}-1`);

  const untitledId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: UNTITLED_ROOT,
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Reply 1: the export runs past the 30 second gateway limit; I will split it by month.',
    ...inThread(untitledId, untitledId),
  });
  await schedule(agent, roomId, untitledId, `task-${RUN}-2`);
  return { reader, roomId, rootId, untitledId };
};

type World = Awaited<ReturnType<typeof seed>>;

const banner = (page: Page) => page.locator('[data-thread-context-banner]');
const scroller = (page: Page) => page.locator('[data-thread-count]').locator('xpath=../..');

const openThread = async (page: Page, world: World, threadId: string, lastText: string) => {
  await page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(threadId)}`);
  await expect(banner(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(lastText).first()).toBeVisible({ timeout: 60_000 });
  // The "Catching up" pill over the room comes and goes with syncs; hide it from the checks.
  await page.addStyleTag({
    content: '[data-testid="client-sync-status"] { display: none !important; }',
  });
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const center = async (target: Locator) => {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to press');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** A tap on a phone, a click on a desktop, at the middle of the target, without scrolling it. */
const press = async (page: Page, target: Locator, phone: boolean) => {
  const { x, y } = await center(target);
  if (phone) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

const metrics = (page: Page) =>
  scroller(page).evaluate((element) => ({
    scrollTop: Math.round(element.scrollTop),
    gap: Math.round(element.scrollHeight - element.clientHeight - element.scrollTop),
  }));

const waitForRest = async (page: Page) => {
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const { scrollTop } = await metrics(page);
        const still = scrollTop === last;
        last = scrollTop;
        return still;
      },
      { intervals: [250] }
    )
    .toBe(true);
};

/**
 * The title and the schedule: the text shown, the whole title, their widths, and whether the
 * schedule sits on the title's line.
 */
const titleLine = (title: Locator) =>
  title.evaluate((element) => {
    const row = element.parentElement as HTMLElement;
    const scheduled = row.querySelector<HTMLElement>('[role="img"][title]');
    const titleBox = element.getBoundingClientRect();
    const scheduledBox = scheduled?.getBoundingClientRect();
    return {
      shown: element.textContent ?? '',
      whole: element.getAttribute('title') ?? '',
      width: Math.round(titleBox.width),
      textWidth: element.scrollWidth,
      rowWidth: row.clientWidth,
      scheduledShown: !!scheduledBox && scheduledBox.width > 0,
      scheduledBesideTitle: !!scheduledBox && scheduledBox.top < titleBox.bottom - 1,
    };
  });

/** A title cut short has its line to itself; the schedule goes to the next one. */
const expectReadableTitle = async (title: Locator, where: string) => {
  const line = await titleLine(title);
  console.log(`${where}: ${JSON.stringify(line)}`);
  expect.soft(line.scheduledShown, `${where}: the schedule shows`).toBe(true);
  // CSS cuts an AI title with an ellipsis; the first message's title is cut at a word.
  const cut = line.textWidth > line.width + 1 || line.shown !== line.whole;
  if (cut) {
    expect
      .soft(line.scheduledBesideTitle, `${where}: "${line.shown}" is cut beside the schedule`)
      .toBe(false);
  }
};

const checkTitles = async (page: Page, world: World, label: string) => {
  await openThread(page, world, world.rootId, lastReply);
  const summary = banner(page).locator('[data-thread-context-summary]');
  await expect(summary).toContainText(SUMMARY, { timeout: 60_000 });
  await expect(banner(page).getByRole('img', { name: /Scheduled|scheduled/ })).toBeVisible({
    timeout: 60_000,
  });
  await shot(page, `title-summary-${label}`);
  await expectReadableTitle(summary, `${label} AI title`);

  await openThread(page, world, world.untitledId, 'Reply 1: the export');
  const rootTitle = banner(page).locator('[data-thread-context-root-title]');
  await expect(rootTitle).toBeVisible({ timeout: 60_000 });
  await expect(banner(page).getByRole('img', { name: /Scheduled|scheduled/ })).toBeVisible({
    timeout: 60_000,
  });
  // The first message's title is cut at a word after a layout.
  await page.waitForTimeout(500);
  await shot(page, `title-root-${label}`);
  await expectReadableTitle(rootTitle, `${label} first-message title`);
};

/**
 * Puts the reader at the end of the thread, runs a step, and expects them to stay there: a jump
 * up leaves a gap below the view. A step that adds a row (a new title is a message in the
 * thread) follows it down.
 */
const expectHeld = async (page: Page, label: string, step: string, action: () => Promise<void>) => {
  await scroller(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await waitForRest(page);
  const before = await metrics(page);
  await action();
  await page.waitForTimeout(600);
  await waitForRest(page);
  const after = await metrics(page);
  console.log(`${label} ${step}: ${JSON.stringify({ before, after })}`);
  await shot(page, `scroll-${label}-${step}`);
  expect
    .soft(
      after.gap,
      `${label} ${step}: the reader stays at the end (scrollTop ${before.scrollTop} to ${after.scrollTop})`
    )
    .toBeLessThanOrEqual(2);
};

/**
 * Chromium before 156 (Chrome for Testing 145 on the Macs) decides whether a focused control
 * needs scrolling by its own box, not by the scroll margin that places it below the padding, so
 * keyboard focus in the banner still moves the thread there; 156 and 157 do not.
 */
const keyboardFocusHeld = (page: Page, label: string): boolean => {
  if (!label.startsWith('chromium')) return true;
  const major = Number(page.context().browser()?.version().split('.')[0] ?? 0);
  if (major >= 156) return true;
  test.info().annotations.push({
    type: 'skipped check',
    description: `${label}: keyboard focus in the banner, Chromium ${major} (needs 156)`,
  });
  return false;
};

const checkScroll = async (page: Page, world: World, label: string, phone: boolean) => {
  await openThread(page, world, world.rootId, lastReply);
  // The whole thread (the root, the replies and each title), so no Load Older fold lands mid-check.
  await expect
    .poll(
      async () =>
        Number(await page.locator('[data-thread-count]').getAttribute('data-thread-count')),
      {
        timeout: 60_000,
      }
    )
    .toBeGreaterThanOrEqual(REPLY_COUNT + 2);
  await scroller(page).evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await waitForRest(page);
  await expect.poll(async () => (await metrics(page)).gap).toBeLessThanOrEqual(2);
  expect((await metrics(page)).scrollTop, `${label}: the thread scrolls`).toBeGreaterThan(400);

  const options = banner(page).getByRole('button', { name: 'Thread options', exact: true });
  const menu = page.getByRole('menu', { name: 'Thread options' });
  // Keyboard focus in the banner: Tab from back to the next control, and focus handed back to
  // Thread options without preventScroll, as a closing dialog's focus trap does.
  if (keyboardFocusHeld(page, label)) {
    await expectHeld(page, label, 'tab-into-banner', async () => {
      await banner(page)
        .getByRole('button', { name: 'Back', exact: true })
        .evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
      // WebKit, as Safari, tabs to buttons with Option held.
      await page.keyboard.press(label.startsWith('webkit') ? 'Alt+Tab' : 'Tab');
      await expect(banner(page).locator(':focus')).toHaveCount(1);
    });
    await expectHeld(page, label, 'focus-returns-to-options', async () => {
      await options.evaluate((element) => {
        (document.activeElement as HTMLElement | null)?.blur();
        (element as HTMLElement).focus();
      });
      await expect(options).toBeFocused();
    });
  }
  await expectHeld(page, label, 'menu-open', async () => {
    await press(page, options, phone);
    await expect(menu).toBeVisible();
  });
  await expectHeld(page, label, 'menu-escape', async () => {
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  // Phones show the tags in a row of their own; desktops beside the title.
  const addTag = banner(page)
    .getByRole('button', { name: 'Add tag', exact: true })
    .filter({ visible: true });
  const filter = page.getByRole('textbox', { name: 'Filter or create tag' });
  await expectHeld(page, label, 'tag-picker-open', async () => {
    await press(page, addTag, phone);
    await expect(filter).toBeFocused();
  });
  await expectHeld(page, label, 'tag-picker-escape', async () => {
    await page.keyboard.press('Escape');
    await expect(filter).toBeHidden();
  });

  const dialog = page.getByRole('dialog', { name: 'Edit summary' });
  await expectHeld(page, label, 'edit-summary-open', async () => {
    await press(page, options, phone);
    await press(page, menu.getByRole('menuitem', { name: 'Edit summary' }), phone);
    await expect(dialog).toBeVisible();
  });
  await expectHeld(page, label, 'edit-summary-save', async () => {
    await dialog.getByRole('textbox').fill(`🗄️ ${SUMMARY}: rollout plan`);
    await press(page, dialog.getByRole('button', { name: 'Save summary', exact: true }), phone);
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(banner(page).locator('[data-thread-context-summary]')).toContainText(
      'rollout plan',
      { timeout: 20_000 }
    );
  });
};

/** A tool-call line's surface and whether a pointer is over it. */
const lineLook = (line: Locator) =>
  line.evaluate((element) => {
    const fill = getComputedStyle(element).backgroundColor;
    const channels =
      /rgba?\(([^)]+)\)/
        .exec(fill)?.[1]
        ?.split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number) ?? [];
    const opacity = channels.length >= 4 ? channels[3] : 1;
    return {
      fill,
      alpha: fill === 'transparent' || channels.length < 3 ? 0 : opacity,
      hover: element.matches(':hover'),
    };
  });

const checkToolLineTap = async (page: Page, world: World, label: string) => {
  await openThread(page, world, world.rootId, lastReply);
  const line = page.getByRole('button', { name: /Ran 1 tool call/ }).last();
  await expect(line).toBeVisible({ timeout: 60_000 });
  await line.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await waitForRest(page);
  const at = await center(line);
  // Open the line and close it again: the finger rests where the line is.
  await page.touchscreen.tap(at.x, at.y);
  await expect(line).toHaveAttribute('aria-expanded', 'true');
  await page.touchscreen.tap(at.x, at.y);
  await expect(line).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(400);
  const look = await lineLook(line);
  console.log(`${label} tool line after tap: ${JSON.stringify(look)}`);
  await shot(page, `tool-line-${label}`);
  expect
    .soft(look.alpha, `${label}: a tapped tool line rests without a surface`)
    .toBeLessThan(0.01);
};

const checkToolLineHover = async (page: Page, world: World, label: string) => {
  await openThread(page, world, world.rootId, lastReply);
  const line = page.getByRole('button', { name: /Ran 1 tool call/ }).last();
  await expect(line).toBeVisible({ timeout: 60_000 });
  await line.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await waitForRest(page);
  const at = await center(line);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(300);
  const look = await lineLook(line);
  console.log(`${label} tool line under the mouse: ${JSON.stringify(look)}`);
  expect
    .soft(look.alpha, `${label}: a mouse over a tool line shows a surface`)
    .toBeGreaterThan(0.01);
};

/**
 * A page in a new context. Chromium on macOS now and then starts a touch context without its touch
 * emulation (no touch points, a pointer that hovers); such a context is replaced, twice at most.
 */
const newPage = async (browser: Browser, options: BrowserContextOptions) => {
  const attempts = options.hasTouch ? 3 : 1;
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const context = await browser.newContext(options);
    // eslint-disable-next-line no-await-in-loop
    const page = await context.newPage();
    // eslint-disable-next-line no-await-in-loop
    if (await page.evaluate(() => matchMedia('(hover: none)').matches)) return { context, page };
    console.log(`context ${attempt} started without touch emulation; replacing it`);
    // eslint-disable-next-line no-await-in-loop
    await context.close();
  }
  const context = await browser.newContext(options);
  return { context, page: await context.newPage() };
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  const signIn = async (options: BrowserContextOptions) => {
    const { context, page } = await newPage(browser, { ...options, baseURL });
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    return { context, page };
  };
  const phone = await signIn(PHONE);
  try {
    await checkTitles(phone.page, world, `${engine}-phone`);
    await checkToolLineTap(phone.page, world, `${engine}-phone`);
    await checkScroll(phone.page, world, `${engine}-phone`, true);
  } finally {
    await phone.context.close();
  }
  const desktop = await signIn(DESKTOP);
  try {
    await checkTitles(desktop.page, world, `${engine}-desktop`);
    await checkToolLineHover(desktop.page, world, `${engine}-desktop`);
    await checkScroll(desktop.page, world, `${engine}-desktop`, false);
  } finally {
    await desktop.context.close();
  }
  if (SHOTS) writeFileSync(path.join(SHOTS, `${engine}-done.txt`), 'done\n');
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('the thread banner keeps its title readable and the thread in place (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  await run(browser, baseURL, 'chromium');
});

test('the thread banner keeps its title readable and the thread in place (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(420_000);
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
