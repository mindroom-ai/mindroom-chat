import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type Route,
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
      const { left, right, top, bottom } = button.getBoundingClientRect();
      return { left, right, top, bottom };
    })
  );
  boxes.forEach(({ left, right }, index) => {
    expect(left, `button ${index} starts on the screen`).toBeGreaterThanOrEqual(-0.5);
    expect(right, `button ${index} ends on the screen`).toBeLessThanOrEqual(width + 0.5);
    // Side by side or one above the other, never over another.
    boxes.slice(0, index).forEach((other, before) => {
      const apart =
        left >= other.right - 0.5 ||
        right <= other.left + 0.5 ||
        boxes[index]!.top >= other.bottom - 0.5 ||
        boxes[index]!.bottom <= other.top + 0.5;
      expect(apart, `button ${index} clear of button ${before}`).toBe(true);
    });
  });
};

/**
 * The buttons after Back, as the screen shows them, and the title's width now and with those
 * buttons side by side (the row's look beside a short title).
 */
const endButtonsLayout = (page: Page, titleSelector: string) =>
  banner(page).evaluate((card, selector) => {
    const titleElement = card.querySelector<HTMLElement>(selector)!;
    const more = card.querySelector<HTMLElement>('button[aria-label="Thread options"]')!;
    let row = titleElement.parentElement!;
    while (getComputedStyle(row).display !== 'grid') row = row.parentElement!;
    const actions = [...row.children].find((child) => child.contains(more)) as HTMLElement;
    const buttons = [...actions.querySelectorAll<HTMLElement>('button')].filter(
      (button) => button.getBoundingClientRect().width > 0
    );
    const boxes = buttons.map((button) => {
      const { left, right, top, bottom } = button.getBoundingClientRect();
      return { left, right, top, bottom };
    });
    const titleWidth = titleElement.getBoundingClientRect().width;
    const was = actions.style.flexDirection;
    actions.style.flexDirection = 'row';
    const rowTitleWidth = titleElement.getBoundingClientRect().width;
    actions.style.flexDirection = was;
    const box = card.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const actionsBox = actions.getBoundingClientRect();
    return {
      boxes,
      titleWidth,
      rowTitleWidth,
      card: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
      row: { top: rowBox.top, bottom: rowBox.bottom },
      column: { top: actionsBox.top, bottom: actionsBox.bottom },
    };
  }, titleSelector);

/**
 * Beside a tall title the buttons after Back stack, in their order, each inside the card, and the
 * title takes the width they leave; beside a short one they stay side by side.
 */
const expectEndButtons = async (page: Page, titleSelector: string, stacked: boolean) => {
  const layout = await endButtonsLayout(page, titleSelector);
  console.log(`end buttons (${stacked ? 'stacked' : 'row'}): ${JSON.stringify(layout)}`);
  expect(layout.boxes.length).toBeGreaterThanOrEqual(2);
  layout.boxes.forEach((box, index) => {
    expect(box.left, `button ${index} inside the card`).toBeGreaterThanOrEqual(
      layout.card.left - 0.5
    );
    expect(box.right, `button ${index} inside the card`).toBeLessThanOrEqual(
      layout.card.right + 0.5
    );
    expect(box.top, `button ${index} inside the card`).toBeGreaterThanOrEqual(
      layout.card.top - 0.5
    );
    expect(box.bottom, `button ${index} inside the card`).toBeLessThanOrEqual(
      layout.card.bottom + 0.5
    );
    const before = layout.boxes[index - 1];
    if (!before) return;
    if (stacked) {
      expect(box.top, `button ${index} under the one before`).toBeGreaterThanOrEqual(
        before.bottom - 0.5
      );
      // Packed: 4 px apart, no more.
      expect(box.top - before.bottom, `gap above button ${index}`).toBeLessThanOrEqual(4.5);
    } else
      expect(box.top, `button ${index} on the line of the one before`).toBeLessThan(before.bottom);
  });
  if (stacked) {
    expect(layout.titleWidth).toBeGreaterThan(layout.rowTitleWidth + 20);
    // The packed column sits in the middle of the row, beside the middle of the title.
    const middle = (edges: { top: number; bottom: number }) => (edges.top + edges.bottom) / 2;
    expect(Math.abs(middle(layout.column) - middle(layout.row))).toBeLessThan(1);
  } else expect(layout.titleWidth).toBeCloseTo(layout.rowTitleWidth, 0);
  await expectHitAreasApart(page);
};

/**
 * A finger at the edge of a button's hit area gets that button (More and Resolve, which have such
 * an area) or none, never the next one. The area is 44 px each way, except toward a button stacked
 * right above or below, where it ends halfway across the gap between them: there the two areas
 * meet, 1 px either side of the middle of the gap going to each.
 */
const expectHitAreasApart = async (page: Page) => {
  const hits = await banner(page).evaluate((card) => {
    const buttons = [...card.querySelectorAll<HTMLElement>('button')].filter(
      (button) => button.getBoundingClientRect().width > 0
    );
    const boxes = buttons.map((button) => button.getBoundingClientRect());
    const sameColumn = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right;
    return buttons.map((button, index) => {
      const box = boxes[index]!;
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const full = Math.max(22, box.height / 2);
      // The nearest button right above and right below, if any.
      const above = boxes
        .filter((other) => sameColumn(other, box) && other.bottom <= box.top)
        .sort((a, b) => b.bottom - a.bottom)[0];
      const below = boxes
        .filter((other) => sameColumn(other, box) && other.top >= box.bottom)
        .sort((a, b) => a.top - b.top)[0];
      const reachUp = above ? box.height / 2 + (box.top - above.bottom) / 2 : full;
      const reachDown = below ? box.height / 2 + (below.top - box.bottom) / 2 : full;
      const reachX = Math.max(18, box.width / 2) - 1;
      const points = [
        [x, y - reachUp + 1],
        [x, y + reachDown - 1],
        [x - reachX, y],
        [x + reachX, y],
      ];
      const name = button.getAttribute('aria-label') ?? button.textContent ?? '';
      return points.map(([px, py]) => {
        const hit = document.elementFromPoint(px!, py!)?.closest('button') ?? null;
        return {
          name,
          at: [Math.round(px!), Math.round(py!)],
          own: hit === button,
          other: hit && hit !== button ? hit.getAttribute('aria-label') ?? '' : null,
          areaButton: name === 'Thread options' || name === 'Resolve',
        };
      });
    });
  });
  for (const hit of hits.flat()) {
    expect(hit.other, `${hit.name} at ${hit.at.join(',')} hits ${hit.other}`).toBeNull();
    if (hit.areaButton) expect(hit.own, `${hit.name} at ${hit.at.join(',')}`).toBe(true);
  }
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
  await shot(page, `wall-${name}`);
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
  // A reply shows in full between the card and the composer. A 320 by 568 phone at 150% has
  // room for the card's three lines of title and the end of the reply: its last lines show.
  const replyBox = (await reply.boundingBox())!;
  if (viewport.height >= 600) expect(replyBox.y).toBeGreaterThanOrEqual(card.bottom);
  else expect(replyBox.y + replyBox.height).toBeGreaterThan(card.bottom + 2 * 20);
  expect(replyBox.y + replyBox.height).toBeLessThanOrEqual(foot.top);
  await expectRowOnScreen(page, viewport.width, false);
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

/**
 * Tab from Back through the banner: each stop is on a later line than the one before, or after it
 * on the same line, so the keyboard reads the row as the screen shows it, the title included.
 */
const expectTabInScreenOrder = async (page: Page, dir: 'ltr' | 'rtl') => {
  // Back is the banner's first button (by name only in English; RTL runs in Arabic).
  await banner(page)
    .locator('button')
    .first()
    .evaluate((element) => (element as HTMLElement).focus());
  // WebKit, as Safari, tabs to buttons with Option held.
  const key = page.context().browser()?.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
  const stops: { name: string; top: number; bottom: number; left: number; right: number }[] = [];
  for (let step = 0; step < 8; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element?.closest('[data-thread-context-banner]')) return undefined;
      const { top, bottom, left, right } = element.getBoundingClientRect();
      const name = element.hasAttribute('data-thread-context-summary')
        ? 'title'
        : element.getAttribute('aria-label') ?? element.textContent ?? '';
      return { name, top, bottom, left, right };
    });
    if (!stop) break;
    stops.push(stop);
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press(key);
  }
  console.log(`tab order (${dir}): ${stops.map((stop) => stop.name).join(' > ')}`);
  expect(stops.map((stop) => stop.name)).toContain('title');
  let before: (typeof stops)[number] | undefined;
  for (const next of stops) {
    if (!before) {
      before = next;
      continue;
    }
    const lowerLine = next.top >= before.bottom - 1;
    const sameLine = next.top < before.bottom && next.bottom > before.top;
    const further = dir === 'ltr' ? next.left >= before.right - 1 : next.right <= before.left + 1;
    expect(lowerLine || (sameLine && further), `${before.name} then ${next.name}`).toBe(true);
    before = next;
  }
};

/** The thread's menu whole on the screen, its tags' section whole in it. */
const expectMenuOnScreen = async (page: Page, menu: Locator) => {
  const box = await boxOf(menu);
  const { width, height } = page.viewportSize()!;
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(width);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(height);
  const section = menu.locator('[data-thread-menu-tags]');
  const inside = await boxOf(section);
  expect(inside.left).toBeGreaterThanOrEqual(box.left - 1);
  expect(inside.right).toBeLessThanOrEqual(box.right + 1);
  const overflow = await section.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
};

/**
 * One tap on More, in any language: the menu starts with the thread's tags, before every row, and
 * shows whole on the screen.
 */
const openMenuWithTags = async (page: Page, tags: readonly string[]) => {
  await banner(page).locator('button[aria-haspopup="menu"]').last().tap();
  const menu = page
    .locator('[role="menu"]')
    .filter({ has: page.locator('[data-thread-menu-tags]') });
  await expect(menu).toBeVisible();
  const section = menu.locator('[data-thread-menu-tags]');
  for (const tag of tags) {
    // eslint-disable-next-line no-await-in-loop
    await expect(section.getByText(tag, { exact: true })).toBeVisible();
  }
  const firstIsTags = await menu.evaluate(
    (element) =>
      element
        .querySelector('[data-thread-menu-tags], [role^="menuitem"], [data-thread-details]')
        ?.hasAttribute('data-thread-menu-tags') ?? false
  );
  expect(firstIsTags).toBe(true);
  await expectMenuOnScreen(page, menu);
  return menu;
};

const setPageZoom = (page: Page, pageZoom: number) =>
  page.evaluate((zoom) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem('settings', JSON.stringify({ ...settings, pageZoom: zoom }));
  }, pageZoom);

/**
 * At 150% Page Zoom in `dir`: the 122-character title whole, the row on screen, the wall. A 320 by
 * 568 phone has room for only part of the title's seven lines there, so its title scrolls.
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
  const name = `${viewport.width}-zoom150-${dir}`;
  await shot(page, `long-${name}`);
  await expectRowOnScreen(page, viewport.width, true);
  // Under the buttons, the title follows them from the keyboard too.
  await expectTabInScreenOrder(page, dir);
  await expectWholeTitle(page, LONG_TITLE, viewport.width, viewport.height < 600);
  // The menu holds the tags at its top, on the screen in either direction.
  const menu = await openMenuWithTags(page, THREADS.long.tags);
  await shot(page, `menu-${name}`);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
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
    // Beside the buttons, the title comes before them from the keyboard.
    await expectTabInScreenOrder(page, 'ltr');
    // Six lines beside the marker, More and Resolve side by side: they stack, the title widens.
    await expectEndButtons(page, '[data-thread-context-summary]', true);

    // More holds the pin and, at its top, the tags; Edit tags has nothing left to open.
    const menu = await openMenuWithTags(page, THREADS.long.tags);
    await expect(menu).toHaveAccessibleName('Thread options');
    await expect(menu.getByRole('menuitem', { name: 'Pin thread' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Edit tags' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

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

/** A first message of six paragraphs stacks the buttons beside it; a short title does not. */
const checkEndButtons = async (page: Page, world: World) => {
  await page.goto(threadUrl(world, world.wall));
  const rootTitle = '[data-thread-context-root-title]';
  await expect(banner(page).locator(rootTitle)).toBeVisible({ timeout: 90_000 });
  await expect(banner(page).getByRole('button', { name: 'Thread options' })).toBeVisible();
  await page.waitForTimeout(500);
  await expectRowOnScreen(page, page.viewportSize()!.width, false);
  await expectEndButtons(page, rootTitle, true);

  await openThread(page, world, 'short');
  await expectRowOnScreen(page, page.viewportSize()!.width, false);
  await expectEndButtons(page, '[data-thread-context-summary]', false);
};

test("a phone's buttons stack beside a tall title and stay in a row beside a short one", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const world = await seedOnce();
  const { context, page } = await signIn(browser, baseURL, world, PHONE);
  try {
    await checkEndButtons(page, world);
  } finally {
    await context.close();
  }
});

test("in WebKit: a phone's buttons stack beside a tall title and stay in a row beside a short one", async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to run the WebKit case.');
  test.setTimeout(300_000);
  const world = await seedOnce();
  await onWebKitPage({ ...PHONE, baseURL, userAgent: IPHONE_SAFARI }, async (page) => {
    await prepare(page, world);
    await checkEndButtons(page, world);
  });
});

// Invented, and new to the room.
const ADDED_TAG = 'needs-review';

/**
 * The tag controls at the menu's top on a touch screen: a finger a few px off a ✕ or "+ tag" still
 * gets it, and no two controls' touch areas (each control's box grown by its layer) overlap.
 */
const expectTagTargets = async (section: Locator) => {
  const found = await section.evaluate((element) => {
    const controls = Array.from(
      element.querySelectorAll<HTMLElement>('.thread-tag-pill-remove, button[aria-haspopup="menu"]')
    );
    const boxes = controls.map((control) => control.getBoundingClientRect());
    const owner = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>('button') ?? null;
    const missed: string[] = [];
    // An area grows until it is 44 px each way: 3 px out, or less where that is all it grows.
    const off = (size: number) => Math.min(3, (44 - size) / 2 - 1);
    controls.forEach((control, index) => {
      const box = boxes[index]!;
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const across = off(box.width);
      const along = off(box.height);
      const points: (readonly [number, number])[] = [];
      if (along > 0) points.push([x, box.top - along], [x, box.bottom + along]);
      if (across > 0) points.push([box.left - across, y], [box.right + across, y]);
      for (const [px, py] of points) {
        if (owner(px, py) !== control) {
          const there = document.elementFromPoint(px, py);
          const layer = getComputedStyle(control, '::after');
          const facts = [
            `box ${Math.round(box.top)}-${Math.round(box.bottom)}`,
            `hits ${there?.tagName ?? 'nothing'}.${String(there?.className ?? '')}`,
            `layer ${layer.content} ${layer.position} ${layer.top} ${layer.bottom}`,
            `control ${getComputedStyle(control).position} ${control.className}`,
          ];
          missed.push(
            `${control.getAttribute('aria-label')} at ${Math.round(px)},${Math.round(
              py
            )} (${facts.join('; ')})`
          );
        }
      }
    });
    // Each touch area: the box grown by its ::after layer's negative insets.
    const areas = controls.map((control, index) => {
      const box = boxes[index]!;
      const layer = getComputedStyle(control, '::after');
      const out = (side: 'top' | 'right' | 'bottom' | 'left') =>
        Math.max(0, -parseFloat(layer[side]) || 0);
      return {
        top: box.top - out('top'),
        bottom: box.bottom + out('bottom'),
        left: box.left - out('left'),
        right: box.right + out('right'),
      };
    });
    const overlaps: string[] = [];
    areas.forEach((a, index) => {
      areas.slice(index + 1).forEach((b, offset) => {
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const along = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (across > 0.5 && along > 0.5) {
          const name = (i: number) => controls[i]!.getAttribute('aria-label');
          overlaps.push(
            `${name(index)} and ${name(index + 1 + offset)}: ${across.toFixed(
              1
            )} by ${along.toFixed(1)}`
          );
        }
      });
    });
    return { count: controls.length, missed, overlaps };
  });
  expect(found.count).toBeGreaterThan(1);
  expect(found.missed).toEqual([]);
  expect(found.overlaps).toEqual([]);
};

/** Holds the page's state writes (a tag's save) until the returned function lets them go. */
const holdStateWrites = async (page: Page) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const matcher = (url: URL) => url.pathname.includes('/state/');
  const handler = async (route: Route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await held;
    return route.continue();
  };
  await page.route(matcher, handler);
  return async () => {
    release();
    await page.unroute(matcher, handler);
  };
};

test("a phone's thread menu starts with the tags, and a tag added there shows in it", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const world = await seedOnce();
  const { context, page } = await signIn(browser, baseURL, world, PHONE);
  try {
    await openThread(page, world, 'busy');
    const menu = await openMenuWithTags(page, THREADS.busy.tags);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      for (const colorScheme of ['light', 'dark'] as const) {
        // eslint-disable-next-line no-await-in-loop
        await page.emulateMedia({ colorScheme });
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(400);
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: path.join(SHOTS, `phone-menu-tags-${colorScheme}.png`) });
      }
      await page.emulateMedia({ colorScheme: null });
    }
    const section = menu.locator('[data-thread-menu-tags]');
    const addTag = section.getByRole('button', { name: 'Add tag' });
    const field = page.getByRole('textbox', { name: 'Filter or create tag' });
    const remove = (tag: string) => section.getByRole('button', { name: `Remove ${tag} tag` });
    await expectTagTargets(section);

    // From the keyboard: the tag goes at once while its save is held, and the next tag's ✕ takes
    // the focus and keeps it once the save is done.
    let release = await holdStateWrites(page);
    await remove('flaky').focus();
    await page.keyboard.press('Enter');
    await expect(section.getByText('flaky', { exact: true })).toHaveCount(0);
    await expect(remove('networking')).toBeFocused();
    await expect(remove('networking')).toHaveAttribute('aria-disabled', 'true');
    await release();
    await expect(remove('networking')).not.toHaveAttribute('aria-disabled', 'true', {
      timeout: 30_000,
    });
    await expect(remove('networking')).toBeFocused();

    // A tap a few px above the ✕ removes the tag; while its save is held, Escape closes the menu,
    // and the save still lands.
    release = await holdStateWrites(page);
    const glyph = (await remove('release-blocker').boundingBox())!;
    await page.touchscreen.tap(glyph.x + glyph.width / 2, glyph.y - 4);
    await expect(section.getByText('release-blocker', { exact: true })).toHaveCount(0);
    await expect(remove('networking')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await release();
    await openMenuWithTags(page, ['networking', 'uploads']);
    await expect(section.getByText('release-blocker', { exact: true })).toHaveCount(0, {
      timeout: 30_000,
    });

    // Escape in the tag picker closes the picker only.
    await addTag.tap();
    await expect(field).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(menu).toBeVisible();

    await addTag.tap();
    await expect(field).toBeFocused();
    await field.fill(ADDED_TAG);
    await field.press('Enter');
    // The new tag shows among the others, and the menu stays open on the screen.
    await expect(section.getByText(ADDED_TAG, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(menu.getByRole('menuitem', { name: 'Copy thread link' })).toBeVisible();
    await expect(section.getByRole('button', { name: `Remove ${ADDED_TAG} tag` })).toBeEnabled();
    await expectMenuOnScreen(page, menu);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  } finally {
    await context.close();
  }
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
