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
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A thread on a phone (390 by 844, touch) keeps its floating banner card under the room's header.
// The card's row holds back, the whole title, the plugins' thread controls (the pull requests'
// marker), Resolve and the thread's menu; the tags and the pin button are left to that menu. The
// title wraps, and past three lines or 38% of the room area it scrolls in itself. A desktop keeps
// the tags and the pin in the card. GitHub is answered by the page. The pull requests' marker needs
// a build with the pull request plugin (MINDROOM_CLIENT_PLUGINS=<its directory>);
// PHONE_BANNER_PR_MARKER=1 then requires it. Set PHONE_BANNER_SHOTS=<directory> to save the three
// threads in light and dark, and each zoomed check.
const PASSWORD = 'phone-banner-title-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.PHONE_BANNER_SHOTS;
const WITH_MARKER = process.env.PHONE_BANNER_PR_MARKER === '1';

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

// Invented data. The long title has 122 characters.
const LONG_TITLE =
  'Fix the flaky upload retry on slow networks, show progress per file, and keep partial uploads when the app is closed early';
type Pull = { repo: string; number: number; state: 'open' | 'merged' | 'draft' };
const PULLS: Pull[] = [
  { repo: 'web-client', number: 128, state: 'open' },
  { repo: 'sync-service', number: 77, state: 'merged' },
  { repo: 'docs', number: 41, state: 'draft' },
];
const THREADS = {
  long: { title: LONG_TITLE, pulls: PULLS.slice(0, 1), tags: ['flaky', 'uploads', 'networking'] },
  short: { title: 'Rename export button', pulls: [], tags: [] },
  busy: {
    title: 'Fix the flaky upload retry on slow networks and show progress per file',
    pulls: PULLS,
    tags: ['flaky', 'uploads', 'networking', 'release-blocker'],
  },
} as const;
type ThreadName = keyof typeof THREADS;
const LAST_REPLY = 'The upload tests are running now; I will post the result here.';
// A first message of several paragraphs, which titles a thread without a summary.
const WALL_END = 'Tell me which of these you can take this week.';
const WALL = [
  'Notes from the upload review, so nothing gets lost before the release planning on Thursday.',
  'The retry starts over from the first byte after every dropped connection, which is why a train ride never finishes a large file. The server already accepts ranges, so the client only has to remember how far it got.',
  'Progress is one bar for the whole batch. People asked for a bar per file, with the batch total above, and for the bar to say when it is waiting for a connection rather than stalling silently.',
  'Closing the app throws partial uploads away. Keeping them for a day would cover the common case, and the settings page needs a line that says how much space they take.',
  'The error text names an internal code. It should say what happened and what to do next, in the same words the help page uses.',
  `Open questions: who owns the server limit, whether the mobile app shares this code, and when the old endpoint can go. ${WALL_END}`,
].join('\n\n');
const WALL_REPLY = 'I can take the retry and the progress bars.';
const REPLIES: ['reader' | 'agent', string][] = [
  [
    'agent',
    'Found it. The backoff timer restarted on every progress event, so a slow link never reached a second attempt.',
  ],
  ['reader', 'Nice. Does the progress bar count each file?'],
  ['agent', 'Not yet: one bar covers the whole batch. I can split it into one bar per file.'],
  ['agent', LAST_REPLY],
];

const inThread = (rootId: string, lastId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: lastId },
  },
});

const setName = (session: MatrixSession, name: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: name }),
  });

/** The room "Design" with an agent and the three threads, each titled, tagged and linked. */
const seed = async () => {
  const reader = await registerDisposableUser(`pbt_reader_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `helper_${RUN}`);
  await Promise.all([setName(reader, 'Mara'), setName(agent, 'Helper')]);
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: reader.accessToken,
    body: JSON.stringify({ name: 'Design', preset: 'private_chat', invite: [agent.userId] }),
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const roots = {} as Record<ThreadName, string>;
  const setAt = new Date().toISOString();
  for (const name of Object.keys(THREADS) as ThreadName[]) {
    const { title, pulls, tags } = THREADS[name];
    const send = (who: 'reader' | 'agent', content: Record<string, unknown>) =>
      sendRoomMessage(HOMESERVER, (who === 'agent' ? agent : reader).accessToken, roomId, content);
    // eslint-disable-next-line no-await-in-loop
    const rootId = await send('reader', {
      msgtype: 'm.text',
      body: 'Uploads over 20 MB still fail on the train. Can you look at the retry?',
    });
    roots[name] = rootId;
    let last = rootId;
    for (const [who, body] of REPLIES) {
      // eslint-disable-next-line no-await-in-loop
      last = await send(who, { msgtype: 'm.text', body, ...inThread(rootId, last) });
    }
    // eslint-disable-next-line no-await-in-loop
    await send('agent', {
      msgtype: 'm.notice',
      body: title,
      'io.mindroom.thread_summary': {
        version: 1,
        summary: title,
        generated_at: Date.now(),
        message_count: REPLIES.length + 1,
      },
      ...inThread(rootId, last),
    });
    const state = (type: string, key: string, content: Record<string, unknown>) =>
      sendStateEvent(HOMESERVER, reader.accessToken, roomId, type, key, content);
    if (tags.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await state('com.mindroom.thread.tags', rootId, {
        tags: Object.fromEntries(
          tags.map((tag) => [tag, { set_by: reader.userId, set_at: setAt }])
        ),
      });
    }
    // The links MindRoom's pull request plugin writes; a build without its client ignores them.
    for (const [index, pull] of pulls.entries()) {
      const key = JSON.stringify([rootId, `acme/${pull.repo}#${pull.number}`]);
      // eslint-disable-next-line no-await-in-loop
      await state('com.mindroom.thread.pull_request', key, {
        url: `https://github.com/acme/${pull.repo}/pull/${pull.number}`,
        set_by: agent.userId,
        set_at: new Date(Date.now() + index).toISOString(),
      });
    }
  }
  const wall = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: WALL,
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: WALL_REPLY,
    ...inThread(wall, wall),
  });
  return { reader, roomId, roots, wall };
};
type World = Awaited<ReturnType<typeof seed>>;
// One room for the file's tests: the desktop reads a thread the phone leaves as it was.
let seeded: Promise<World> | undefined;
const seedOnce = () => {
  seeded ??= seed();
  return seeded;
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
};

/** Answers for the deployment's call service and for GitHub, so no request leaves the test. */
const stubServices = async (page: Page) => {
  await page.route(`${HOMESERVER}/.well-known/matrix/client`, (route) =>
    route.fulfill({
      headers: CORS,
      json: {
        'm.homeserver': { base_url: HOMESERVER },
        'org.matrix.msc4143.rtc_foci': [
          { type: 'livekit', livekit_service_url: 'https://livekit.invalid/sfu' },
        ],
      },
    })
  );
  await page.route('https://api.github.com/**', (route) => {
    const found = /^\/repos\/acme\/([^/]+)\/pulls\/(\d+)$/.exec(
      new URL(route.request().url()).pathname
    );
    const pull = PULLS.find(
      ({ repo, number }) => repo === found?.[1] && String(number) === found[2]
    );
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: CORS });
    if (!pull) return route.fulfill({ status: 404, headers: CORS, json: { message: 'Not Found' } });
    return route.fulfill({
      headers: CORS,
      json: {
        number: pull.number,
        title: `Pull request ${pull.number}`,
        state: 'open',
        draft: pull.state === 'draft',
        merged_at: pull.state === 'merged' ? '2026-01-05T10:00:00Z' : null,
        html_url: `https://github.com/acme/${pull.repo}/pull/${pull.number}`,
        user: { login: 'helper-bot' },
        head: { ref: 'fix/upload-retry', sha: 'a'.repeat(40) },
        base: { ref: 'main' },
      },
    });
  });
};

const header = (page: Page) => page.locator('header[role="banner"]').filter({ visible: true });
const banner = (page: Page) => page.locator('[data-thread-context-banner]');
const title = (page: Page) => banner(page).locator('[data-thread-context-summary]');

/** Signs the reader in on `page`, with the services it asks answered by the page. */
const prepare = async (page: Page, world: World) => {
  await stubServices(page);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.reader.username,
    password: PASSWORD,
  });
  // A token, so the pull requests' marker asks (the page's) GitHub for its state.
  await page.evaluate(
    (key) => localStorage.setItem(key, 'ghp_e2e'),
    `mindroom.plugin:${encodeURIComponent(world.reader.userId)}/pull-requests/githubToken`
  );
};

const signIn = async (
  browser: Browser,
  baseURL: string | undefined,
  world: World,
  options: BrowserContextOptions
) => {
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  await prepare(page, world);
  return { context, page };
};

/** Saves the page where PHONE_HEADER_SHOTS says, WebKit's pages under their own name. */
const shot = async (page: Page, name: string, height?: number) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const engine = page.context().browser()?.browserType().name() === 'webkit' ? '-webkit' : '';
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({
    path: path.join(SHOTS, `${name}${engine}.png`),
    ...(height ? { clip: { x: 0, y: 0, width, height } } : {}),
  });
};

const openThread = async (page: Page, world: World, name: ThreadName) => {
  await page.goto(
    `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.roots[name])}`
  );
  await expect(title(page)).toHaveText(THREADS[name].title, { timeout: 90_000 });
  await expect(page.getByText(LAST_REPLY).first()).toBeVisible({ timeout: 60_000 });
  // The "Catching up" pill over the room comes and goes with syncs; hide it from the checks.
  await page.addStyleTag({
    content: '[data-testid="client-sync-status"] { display: none !important; }',
  });
};

const shoot = async (page: Page, world: World) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const name of Object.keys(THREADS) as ThreadName[]) {
    // eslint-disable-next-line no-await-in-loop
    await openThread(page, world, name);
    if (WITH_MARKER && THREADS[name].pulls.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await expect(banner(page).getByRole('button', { name: /pull request/i })).toBeVisible();
      // Its state's colour comes once (the page's) GitHub has answered.
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(1500);
    }
    for (const colorScheme of ['light', 'dark'] as const) {
      // eslint-disable-next-line no-await-in-loop
      await page.emulateMedia({ colorScheme });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(400);
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: path.join(SHOTS, `phone-${name}-${colorScheme}.png`) });
    }
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: null });
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

type Size = { width: number; height: number };
const SMALL: Size = { width: 320, height: 568 };

const threadUrl = (world: World, rootId: string) =>
  `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(rootId)}`;
const composer = (page: Page) => page.locator('[data-slate-editor="true"]');
const boxOf = (locator: Locator) =>
  locator.first().evaluate((element) => {
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  });
// Back, (the marker,) Resolve and More, whatever the language calls them.
const rowButtons = (page: Page) => banner(page).locator('button:visible');

/** Every button of the card's row whole on the screen, none over another. */
const expectRowOnScreen = async (page: Page, width: number, linked: boolean) => {
  const buttons = rowButtons(page);
  await expect(buttons).toHaveCount(WITH_MARKER && linked ? 4 : 3, { timeout: 30_000 });
  const boxes = await buttons.evaluateAll((list) =>
    list.map((button) => {
      const { left, right } = button.getBoundingClientRect();
      return { left, right };
    })
  );
  const inOrder = [...boxes].sort((a, b) => a.left - b.left);
  inOrder.forEach(({ left, right }, index) => {
    expect(left, `button ${index} starts on the screen`).toBeGreaterThanOrEqual(-0.5);
    expect(right, `button ${index} ends on the screen`).toBeLessThanOrEqual(width + 0.5);
    if (index > 0) expect(left).toBeGreaterThanOrEqual(inOrder[index - 1]!.right - 0.5);
  });
};

/**
 * The title shows whole: every line of it, uncut, inside the card and the screen. `bounded`: the
 * screen is too small for all its lines, so it fills its bound and scrolls to the rest.
 */
const expectWholeTitle = async (page: Page, expected: string, width: number, bounded = false) => {
  const shown = await title(page).evaluate((element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const card = element.closest('[data-thread-context-banner]')!.getBoundingClientRect();
    return {
      text: element.textContent,
      clipped: element.scrollHeight > element.clientHeight + 1,
      clippedSideways: element.scrollWidth > element.clientWidth + 1,
      shownLines: element.clientHeight / parseFloat(style.lineHeight),
      overflowY: style.overflowY,
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      lines: Math.round(box.height / parseFloat(style.lineHeight)),
      box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
      card: { top: card.top, bottom: card.bottom, left: card.left, right: card.right },
    };
  });
  expect(shown.text).toBe(expected);
  expect(shown.clippedSideways).toBe(false);
  if (bounded) {
    expect(shown.overflowY).toBe('auto');
    expect(shown.shownLines).toBeGreaterThanOrEqual(3 - 0.05);
  } else {
    expect(shown.clipped).toBe(false);
  }
  expect(shown.whiteSpace).toBe('normal');
  expect(shown.textOverflow).not.toBe('ellipsis');
  expect(shown.box.left).toBeGreaterThanOrEqual(Math.max(0, shown.card.left) - 0.5);
  expect(shown.box.right).toBeLessThanOrEqual(Math.min(width, shown.card.right) + 0.5);
  expect(shown.box.bottom).toBeLessThanOrEqual(shown.card.bottom + 0.5);
  return shown;
};

/**
 * A first message of several paragraphs titles the thread: the title scrolls in itself, a reply
 * shows between the card and the composer, and the composer takes a tap.
 */
const checkWall = async (page: Page, world: World, viewport: Size, name: string) => {
  await page.goto(threadUrl(world, world.wall));
  const rootTitle = banner(page).locator('[data-thread-context-root-title]');
  await expect(rootTitle).toBeVisible({ timeout: 90_000 });
  const reply = page.getByText(WALL_REPLY, { exact: true }).first();
  await expect(reply).toBeVisible({ timeout: 60_000 });
  await page.addStyleTag({
    content: '[data-testid="client-sync-status"] { display: none !important; }',
  });
  // The whole first message is the title: nothing of it is cut.
  const whole = (await rootTitle.textContent()) ?? '';
  expect(whole.length).toBeGreaterThan(600);
  expect(whole.endsWith(WALL_END)).toBe(true);
  // Taller than its bound, it scrolls in itself, and at least three lines of it show.
  const sizes = await rootTitle.evaluate((element) => ({
    scroll: element.scrollHeight,
    shown: element.clientHeight,
    line: parseFloat(getComputedStyle(element).lineHeight),
    overflow: getComputedStyle(element).overflowY,
  }));
  expect(sizes.overflow).toBe('auto');
  expect(sizes.scroll).toBeGreaterThan(sizes.shown + sizes.line);
  expect(sizes.shown).toBeGreaterThanOrEqual(3 * sizes.line - 1);
  const card = await boxOf(banner(page));
  const foot = await boxOf(composer(page));
  expect(card.bottom - card.top).toBeLessThan((viewport.height - card.top) * 0.6);
  // A reply shows in full between the card and the composer.
  const replyBox = (await reply.boundingBox())!;
  expect(replyBox.y).toBeGreaterThanOrEqual(card.bottom);
  expect(replyBox.y + replyBox.height).toBeLessThanOrEqual(foot.top);
  await expectRowOnScreen(page, viewport.width, false);
  await shot(page, `wall-${name}`);
  // The title's last line is reached by scrolling the title, not the page.
  await rootTitle.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  const lastLine = await rootTitle.evaluate((element) => {
    const text = element.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, text.length - 1);
    range.setEnd(text, text.length);
    const { top, bottom } = range.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    return { top, bottom, frameTop: frame.top, frameBottom: frame.bottom };
  });
  expect(lastLine.top).toBeGreaterThanOrEqual(lastLine.frameTop - 1);
  expect(lastLine.bottom).toBeLessThanOrEqual(lastLine.frameBottom + 1);
  // The composer takes a tap.
  await composer(page).tap();
  await expect(composer(page)).toBeFocused();
};

const setPageZoom = (page: Page, pageZoom: number) =>
  page.evaluate((zoom) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem('settings', JSON.stringify({ ...settings, pageZoom: zoom }));
  }, pageZoom);

/**
 * At 150% Page Zoom in `dir`: the 122-character title whole, the row on screen, the wall. A 320 by
 * 568 phone has room for only six of the title's seven lines there, so its title scrolls.
 */
const checkZoomed = async (page: Page, world: World, viewport: Size, dir: 'ltr' | 'rtl') => {
  await setPageZoom(page, 150);
  if (dir === 'rtl') await page.evaluate(() => localStorage.setItem('i18nextLng', 'ar'));
  await openThread(page, world, 'long');
  await expect(page.locator('html')).toHaveAttribute('dir', dir);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize))
    .toBe('24px');
  if (WITH_MARKER) {
    await expect(banner(page).locator('.mrpr-thread-button')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
  }
  await expectRowOnScreen(page, viewport.width, true);
  await expectWholeTitle(page, LONG_TITLE, viewport.width, viewport.height < 600);
  const name = `${viewport.width}-zoom150-${dir}`;
  await shot(page, `long-${name}`);
  await checkWall(page, world, viewport, name);
};

test("a phone's banner card keeps back, the whole title, the marker, Resolve and More", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  const world = await seedOnce();
  const { context, page } = await signIn(browser, baseURL, world, PHONE);
  try {
    await openThread(page, world, 'long');
    // A card of its own under the room's header, not in it.
    await expect(banner(page)).toHaveCount(1);
    await expect(header(page).locator('[data-thread-context-banner]')).toHaveCount(0);
    const back = banner(page).getByRole('button', { name: 'Back', exact: true });
    const resolve = banner(page).getByRole('button', { name: 'Resolve', exact: true });
    const more = banner(page).getByRole('button', { name: 'Thread options', exact: true });
    for (const control of [back, resolve, more]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(control).toBeVisible({ timeout: 30_000 });
    }
    if (WITH_MARKER) {
      await expect(banner(page).getByRole('button', { name: /pull request/i })).toBeVisible();
    } else {
      test.info().annotations.push({
        type: 'skipped check',
        description: "the pull requests' marker: this build has no pull request plugin",
      });
    }
    await expectRowOnScreen(page, PHONE.viewport!.width, true);
    // The pin button and the tags are left to More.
    await expect(banner(page).getByRole('button', { name: 'Pin thread' })).toHaveCount(0);
    await expect(banner(page).getByText('networking')).toHaveCount(0);
    await expect(banner(page).getByRole('button', { name: /^\+ ?tag/i })).toHaveCount(0);

    // The whole title, on as many lines as it needs, nothing cut.
    const shown = await expectWholeTitle(page, LONG_TITLE, PHONE.viewport!.width);
    expect(shown.lines).toBeGreaterThanOrEqual(2);

    const menu = page.getByRole('menu', { name: 'Thread options' });
    await more.tap();
    await expect(menu.getByRole('menuitem', { name: 'Pin thread' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Edit tags' }).tap();
    // The tag editor of the menu holds the thread's tags.
    await expect(
      page.getByRole('dialog', { name: 'Edit tags' }).getByText('networking')
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await shoot(page, world);
  } finally {
    await context.close();
  }
});

for (const viewport of [PHONE.viewport!, SMALL]) {
  for (const dir of ['ltr', 'rtl'] as const) {
    test(`at 150% Page Zoom on a ${viewport.width} px phone, ${dir}, the title shows whole and the row stays on screen`, async ({
      browser,
      baseURL,
    }) => {
      test.setTimeout(420_000);
      const world = await seedOnce();
      const { context, page } = await signIn(browser, baseURL, world, { ...PHONE, viewport });
      try {
        await checkZoomed(page, world, viewport, dir);
      } finally {
        await context.close();
      }
    });
  }
}

// WebKit is the engine of these phones. Skipped without PLAYWRIGHT_WEBKIT_EXECUTABLE.
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1';
test('in WebKit: at 150% Page Zoom on a 320 px phone the title shows whole and the row stays on screen', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to run the WebKit case.');
  test.setTimeout(420_000);
  const world = await seedOnce();
  await onWebKitPage(
    { ...PHONE, viewport: SMALL, baseURL, userAgent: IPHONE_SAFARI },
    async (page) => {
      await prepare(page, world);
      await checkZoomed(page, world, SMALL, 'ltr');
    }
  );
});

test('a desktop keeps the tags and the pin in the banner card', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const world = await seedOnce();
  const { context, page } = await signIn(browser, baseURL, world, DESKTOP);
  try {
    await openThread(page, world, 'busy');
    await expect(banner(page).getByRole('button', { name: 'Pin thread' })).toBeVisible();
    await expect(banner(page).getByText('networking').first()).toBeVisible();
    // The title keeps its one line there.
    await expect(title(page)).toHaveCSS('white-space', 'nowrap');
  } finally {
    await context.close();
  }
});
