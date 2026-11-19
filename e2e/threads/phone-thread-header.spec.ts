import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
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
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A thread on a phone (390 by 844, touch) shows in the room's header, not in a banner card: the
// header's row holds back, the room's name, the plugins' thread controls (the pull requests'
// marker), Resolve, the call button and the thread's menu, and the thread's whole title wraps
// under it. The menu holds Pin, the tags and the room's menu. A desktop keeps the banner card.
// The deployment announces a call service to the page (no call is placed), and GitHub is answered
// by the page. The pull requests' marker needs a build with the pull request plugin
// (MINDROOM_CLIENT_PLUGINS=<its directory>); PHONE_HEADER_PR_MARKER=1 then requires it.
// Set PHONE_HEADER_SHOTS=<directory> to save the three threads in light and dark.
const PASSWORD = 'phone-thread-header-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.PHONE_HEADER_SHOTS;
const WITH_MARKER = process.env.PHONE_HEADER_PR_MARKER === '1';

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
  const reader = await registerDisposableUser(`pth_reader_${RUN}`, PASSWORD);
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

const signIn = async (
  browser: Browser,
  baseURL: string | undefined,
  world: World,
  options: BrowserContextOptions
) => {
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
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
  return { context, page };
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
  // A small phone held sideways: the header's row is lower there, the title still whole.
  await page.setViewportSize({ width: 667, height: 375 });
  await openThread(page, world, 'long');
  await page.screenshot({ path: path.join(SHOTS, 'phone-long-sideways.png') });
  await page.setViewportSize({ width: 390, height: 844 });
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test("a phone's thread shows in the room header: back, room, marker, Resolve, call, menu, and its whole title", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(420_000);
  const world = await seedOnce();
  const { context, page } = await signIn(browser, baseURL, world, PHONE);
  try {
    await openThread(page, world, 'long');
    // The thread's bar is the room header's rows; no card floats over the messages.
    await expect(banner(page)).toHaveCount(1);
    await expect(header(page).locator('[data-thread-phone-header]')).toBeVisible();
    await expect(page.locator('[data-thread-count] [data-thread-context-banner]')).toHaveCount(0);

    // One row: back, the room's name, (the marker,) Resolve, the call button and the menu.
    const row = banner(page).locator('> div').first();
    const back = row.getByRole('button', { name: 'Back', exact: true });
    const room = row.getByRole('heading', { level: 1 }).getByRole('button', { name: 'Design' });
    const marker = row.getByRole('button', { name: /pull request/i });
    const resolve = row.getByRole('button', { name: 'Resolve', exact: true });
    const call = row.getByRole('button', { name: 'Start a call', exact: true });
    const more = row.getByRole('button', { name: 'Thread options', exact: true });
    const inRow = [back, room, ...(WITH_MARKER ? [marker] : []), resolve, call, more];
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    for (const control of inRow) {
      // eslint-disable-next-line no-await-in-loop
      await expect(control).toBeVisible({ timeout: 30_000 });
      // eslint-disable-next-line no-await-in-loop
      boxes.push((await control.boundingBox())!);
    }
    boxes.forEach((box, index) => {
      const next = boxes[index + 1];
      // In order along the row, none over another and all inside the screen.
      if (next)
        expect(box.x + box.width, `control ${index} ends before the next`).toBeLessThanOrEqual(
          next.x + 0.5
        );
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      expect(Math.abs(box.y + box.height / 2 - (boxes[0]!.y + boxes[0]!.height / 2))).toBeLessThan(
        8
      );
    });
    if (!WITH_MARKER) {
      test.info().annotations.push({
        type: 'skipped check',
        description: "the pull requests' marker: this build has no pull request plugin",
      });
    }
    // The pin button and the tags are put away.
    await expect(banner(page).getByRole('button', { name: 'Pin thread' })).toHaveCount(0);
    await expect(banner(page).getByText('networking')).toHaveCount(0);

    // The whole title, on as many lines as it needs: nothing cut, no ellipsis, under the row.
    const shown = await title(page).evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        text: element.textContent,
        clipped:
          element.scrollHeight > element.clientHeight + 1 ||
          element.scrollWidth > element.clientWidth + 1,
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        lineClamp: style.getPropertyValue('-webkit-line-clamp'),
        lines: Math.round(box.height / parseFloat(style.lineHeight)),
        top: box.top,
        left: box.left,
        right: box.right,
      };
    });
    expect(shown.text).toBe(LONG_TITLE);
    expect(shown.clipped).toBe(false);
    expect(shown.whiteSpace).toBe('normal');
    expect(shown.textOverflow).not.toBe('ellipsis');
    expect(shown.lineClamp).toBe('none');
    expect(shown.lines).toBeGreaterThanOrEqual(3);
    expect(shown.top).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height - 8);
    // The full width of the page, bar its content inset.
    expect(shown.right - shown.left).toBeGreaterThan(340);
    // The thread's first message starts under the header, not behind it.
    const headerBox = (await header(page).boundingBox())!;
    const first = (await page.getByText('Uploads over 20 MB still fail').first().boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);

    await shoot(page, world);
    if (SHOTS) await openThread(page, world, 'long');

    // More is the thread's menu: it holds Pin, the tags and the room's menu.
    const menu = page.getByRole('menu', { name: 'Thread options' });
    await more.tap();
    await expect(menu.getByRole('menuitem', { name: 'Pin thread' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Edit tags' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Room options' }).tap();
    await expect(menu).toBeHidden();
    // The room's own menu, where the thread's was.
    await expect(page.getByRole('menuitem', { name: 'Show Members' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'Show Members' })).toBeHidden();

    // The tags, through the menu.
    await more.tap();
    await menu.getByRole('menuitem', { name: 'Edit tags' }).tap();
    const tags = page.getByRole('dialog', { name: 'Edit tags' });
    for (const tag of THREADS.long.tags) {
      // eslint-disable-next-line no-await-in-loop
      await expect(tags.getByText(tag, { exact: true })).toBeVisible();
    }
    await tags.getByRole('button', { name: 'Done', exact: true }).tap();
    await expect(tags).toBeHidden();

    // Resolve is one tap, and one tap back.
    await resolve.tap();
    const resolved = row.getByRole('button', { name: 'Resolved', exact: true });
    await expect(resolved).toBeVisible({ timeout: 20_000 });
    await resolved.tap();
    await expect(resolve).toBeVisible({ timeout: 20_000 });

    // Pinned from the menu, the thread shows its pin beside the title.
    await more.tap();
    await menu.getByRole('menuitem', { name: 'Pin thread' }).tap();
    await expect(banner(page).getByRole('img', { name: 'Pinned' })).toBeVisible({
      timeout: 20_000,
    });
    // The menu stays on its new label until the pin is saved; Escape closes it after that.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-long-pinned-light.png') });

    // The room's name leads back to the room, as the chevron does.
    await openThread(page, world, 'short');
    await room.tap();
    await expect(banner(page)).toHaveCount(0);
    await expect(header(page).getByRole('heading', { level: 1, name: 'Design' })).toBeVisible();
    await expect(header(page).getByRole('button', { name: 'More Options' })).toBeVisible();
  } finally {
    await context.close();
  }
});

const threadUrl = (world: World, rootId: string) =>
  `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(rootId)}`;
const composer = (page: Page) => page.locator('[data-slate-editor="true"]');
const box = async (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    });

for (const [name, viewport] of [
  ['a 320 px phone', { width: 320, height: 568 }],
  ['a small phone held sideways', { width: 667, height: 375 }],
] as const) {
  test(`a first message of several paragraphs as the title leaves the conversation its room on ${name}`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(300_000);
    const world = await seedOnce();
    const { context, page } = await signIn(browser, baseURL, world, { ...PHONE, viewport });
    try {
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
      // It is taller than the header lets it be, so it scrolls in its own block.
      const block = rootTitle.locator('xpath=..');
      const sizes = await block.evaluate((element) => ({
        scroll: element.scrollHeight,
        shown: element.clientHeight,
        overflow: getComputedStyle(element).overflowY,
      }));
      expect(sizes.overflow).toBe('auto');
      expect(sizes.scroll).toBeGreaterThan(sizes.shown + 40);
      // At least three lines of it show, and the header leaves most of the room area alone.
      expect(sizes.shown).toBeGreaterThanOrEqual(60);
      const head = await box(page, '[data-thread-context-banner]');
      const foot = await box(page, '[data-slate-editor="true"]');
      expect(head.bottom - head.top).toBeLessThan((viewport.height - head.top) * 0.6);
      // A reply shows in full between the header and the composer.
      const replyBox = (await reply.boundingBox())!;
      expect(replyBox.y).toBeGreaterThanOrEqual(head.bottom);
      expect(replyBox.y + replyBox.height).toBeLessThanOrEqual(foot.top);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `phone-wall-${viewport.width}.png`) });
      }
      // The title's last line is reached by scrolling the title, not the page.
      await block.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      const lastLine = await rootTitle.evaluate((element) => {
        const text = element.firstChild as Text;
        const range = document.createRange();
        range.setStart(text, text.length - 1);
        range.setEnd(text, text.length);
        const { top, bottom } = range.getBoundingClientRect();
        const frame = element.parentElement!.getBoundingClientRect();
        return { top, bottom, frameTop: frame.top, frameBottom: frame.bottom };
      });
      expect(lastLine.top).toBeGreaterThanOrEqual(lastLine.frameTop - 1);
      expect(lastLine.bottom).toBeLessThanOrEqual(lastLine.frameBottom + 1);
      expect(lastLine.bottom).toBeLessThanOrEqual(foot.top);
      // The composer takes a tap.
      await composer(page).tap();
      await expect(composer(page)).toBeFocused();
    } finally {
      await context.close();
    }
  });
}

for (const dir of ['ltr', 'rtl'] as const) {
  test(`the row keeps every button on screen on a 320 px phone at 150% zoom, ${dir}`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(300_000);
    const world = await seedOnce();
    // 320 px at 150% Page Zoom lays out as 213 CSS px.
    const viewport = { width: 213, height: 379 };
    const { context, page } = await signIn(browser, baseURL, world, { ...PHONE, viewport });
    try {
      if (dir === 'rtl') await page.evaluate(() => localStorage.setItem('i18nextLng', 'ar'));
      await openThread(page, world, 'busy');
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      // Back, (the marker,) Resolve, the call button and More, whatever the language calls them;
      // the room's name gives its width away first.
      const buttons = banner(page).locator('> div').first().locator('button:visible:not(h1 *)');
      await expect(buttons).toHaveCount(WITH_MARKER ? 5 : 4, { timeout: 30_000 });
      if (WITH_MARKER) await page.waitForTimeout(1500);
      const boxes = await buttons.evaluateAll((list) =>
        list
          .map((button) => {
            const { left, right } = button.getBoundingClientRect();
            return { left, right };
          })
          .sort((a, b) => a.left - b.left)
      );
      // Each whole on the screen, More (the last in the row) too, and none over another.
      boxes.forEach(({ left, right }, index) => {
        expect(left).toBeGreaterThanOrEqual(-0.5);
        expect(right).toBeLessThanOrEqual(viewport.width + 0.5);
        expect(right - left).toBeGreaterThanOrEqual(32);
        if (index > 0) expect(left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
      });
      const more = await buttons.last().boundingBox();
      expect(more!.x).toBeGreaterThanOrEqual(0);
      expect(more!.x + more!.width).toBeLessThanOrEqual(viewport.width + 0.5);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `phone-busy-zoom150-${dir}.png`) });
      }
    } finally {
      await context.close();
    }
  });
}

test('More and the room name take a finger: 44 px for More, the whole cell for the name', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const world = await seedOnce();
  const { context, page } = await signIn(browser, baseURL, world, PHONE);
  try {
    await openThread(page, world, 'short');
    const hits = await banner(page).evaluate((element) => {
      const hit = (target: Element, x: number, y: number) =>
        target.contains(document.elementFromPoint(x, y));
      const more = element.querySelector('button[aria-haspopup="menu"]')!;
      const { left, top, width, height } = more.getBoundingClientRect();
      const [cx, cy] = [left + width / 2, top + height / 2];
      const cell = element.querySelector('h1')!;
      const name = cell.querySelector('button')!;
      const cellBox = cell.getBoundingClientRect();
      const cellY = cellBox.top + cellBox.height / 2;
      return {
        more: [-21, 21].flatMap((d) => [hit(more, cx + d, cy), hit(more, cx, cy + d)]),
        // Far from the short name's text, and 21 px above and below its line.
        name: [-21, 0, 21].map((d) => hit(name, cellBox.right - 6, cellY + d)),
        cellWidth: cellBox.width,
      };
    });
    expect(hits.cellWidth).toBeGreaterThan(120);
    expect(hits.more).toEqual([true, true, true, true]);
    expect(hits.name).toEqual([true, true, true]);
  } finally {
    await context.close();
  }
});

test("a small phone's keyboard leaves the thread's bar, with its way back and an open rename", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const world = await seedOnce();
  const sideways = { width: 667, height: 375 };
  const { context, page } = await signIn(browser, baseURL, world, { ...PHONE, viewport: sideways });
  try {
    await openThread(page, world, 'long');
    await title(page).dblclick();
    const field = banner(page).getByRole('textbox', { name: 'Summary' });
    await expect(field).toBeFocused();
    // The keyboard takes the lower half: the room area is under 240 px.
    await page.setViewportSize({ width: 667, height: 280 });
    await expect(field).toBeInViewport();
    await expect(field).toBeFocused();
    await expect(banner(page).getByRole('button', { name: 'Back', exact: true })).toBeInViewport();
    await expect(composer(page)).toBeInViewport();
    const head = await box(page, '[data-thread-context-banner]');
    const foot = await box(page, '[data-slate-editor="true"]');
    // One row and the field: the bar ends well above the composer.
    expect(head.bottom).toBeLessThanOrEqual(foot.top - 24);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'phone-keyboard-rename.png') });
    await page.keyboard.press('Escape');
    await expect(title(page)).toHaveText(LONG_TITLE);
  } finally {
    await context.close();
  }
});

test('a desktop keeps the thread banner as a card under the room header', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const world = await seedOnce();
  const { context, page } = await signIn(browser, baseURL, world, DESKTOP);
  try {
    await openThread(page, world, 'busy');
    await expect(banner(page)).toHaveCount(1);
    await expect(page.locator('[data-thread-phone-header]')).toHaveCount(0);
    await expect(header(page).locator('[data-thread-context-banner]')).toHaveCount(0);
    // Its controls are the card's own: the pin button and the tags show.
    await expect(banner(page).getByRole('button', { name: 'Pin thread' })).toBeVisible();
    await expect(banner(page).getByText('networking').first()).toBeVisible();
    await expect(header(page).getByRole('button', { name: 'More Options' })).toBeVisible();
  } finally {
    await context.close();
  }
});
