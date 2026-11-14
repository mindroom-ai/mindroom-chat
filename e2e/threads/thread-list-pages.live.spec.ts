import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createHiddenOverviewFilterState,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

// A new device opens a room with 500 threads in the Compact view and lists all of them. The server
// lists a room's threads 30 at a time, newest activity first. The reader replied to every other
// thread, so the reader's own list (also 30) reaches into the second page of the room's list, and
// the client knows that page's newest thread before the page arrives. The thread list used to keep
// the token of such a page and stop there: 66 of 500 threads, with a count of 66, for minutes.
// Pages after the first answer late here, so the count is seen while they load: it is the plain
// number of threads listed so far, as MindRoom Chat shows it, never "N+". Set
// THREAD_PAGES_SHOTS=<directory> to save each view.
const THREADS = 500;
const PAGE = 30;
const PASSWORD = 'thread-list-pages-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.THREAD_PAGES_SHOTS;
/** Extra delay for each later /threads page, so the count can be read while pages load. */
const PAGE_DELAY_MS = 300;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.use({
  serviceWorkers: 'block',
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});
test.describe.configure({ mode: 'serial' });

const TOPICS = [
  'Draft the onboarding checklist for the new support hires',
  'Compare the two vendor quotes for the storage upgrade',
  'Plan the agenda for the quarterly planning review',
  'Collect feedback on the revised pricing page copy',
  'Summarize the incident timeline from last night’s outage',
  'Review the accessibility audit findings for the settings screens',
];
const REPLIES = [
  'I went through it this morning; two items still need an owner before Friday.',
  'Looks good to me. I left a few comments on the wording in the second section.',
  'The numbers check out, but the delivery estimate seems optimistic to me.',
  'Done. I also linked the related notes so the context is in one place.',
];

type Account = MatrixSession & { username: string };
type Seed = { reader: Account; roomId: string; roots: string[] };

const register = async (homeserver: string, name: string): Promise<Account> => {
  const username = `tlp_${name}_${RUN}`;
  await matrixFetch(homeserver, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  return { ...(await loginToMatrix(homeserver, username, PASSWORD)), username };
};

/**
 * A writer's room with an agent and 500 threads, each with one reply. The reader replied to the
 * odd threads, the agent to every fourth and the writer to the rest. The newest 100 threads get
 * their replies one at a time, oldest first, so thread 499 is the newest by activity and thread
 * 469 leads the list's second page. The reader also has 25 smaller rooms.
 */
const seed = async (): Promise<Seed> => {
  const homeserver = getHomeserver();
  const reader = await register(homeserver, 'reader');
  const writer = await register(homeserver, 'writer');
  // The thread count shows in rooms with an agent.
  const agent = await registerAgentAccount(homeserver, 'planner');
  const roomId = await createRoom(homeserver, writer.accessToken, {
    name: 'Operations planning',
    invite: [reader.userId, agent.userId],
  });
  await joinRoom(homeserver, reader.accessToken, roomId);
  await joinRoom(homeserver, agent.accessToken, roomId);
  for (let batch = 0; batch < 5; batch += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      Array.from({ length: 5 }, async (_, offset) => {
        const index = batch * 5 + offset;
        const otherRoom = await createRoom(homeserver, reader.accessToken, {
          name: `Project room ${index + 1}`,
        });
        await sendRoomMessage(homeserver, reader.accessToken, otherRoom, {
          msgtype: 'm.text',
          body: `Notes for project ${index + 1}: the next review is on Thursday.`,
        });
      })
    );
  }

  const roots: string[] = [];
  for (let batch = 0; batch < THREADS / 25; batch += 1) {
    // eslint-disable-next-line no-await-in-loop
    const sent = await Promise.all(
      Array.from({ length: 25 }, (_, offset) => {
        const index = batch * 25 + offset;
        return sendRoomMessage(homeserver, writer.accessToken, roomId, {
          msgtype: 'm.text',
          body: `${TOPICS[index % TOPICS.length]} (thread ${index})`,
        });
      })
    );
    roots.push(...sent);
  }
  const reply = (index: number) =>
    sendRoomMessage(
      homeserver,
      (index % 2 === 1 ? reader : index % 4 === 0 ? agent : writer).accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `${REPLIES[index % REPLIES.length]} (reply in thread ${index})`,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: roots[index],
          is_falling_back: true,
          'm.in_reply_to': { event_id: roots[index] },
        },
      }
    );
  const parallelReplies = THREADS - 100;
  for (let batch = 0; batch < parallelReplies / 25; batch += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(Array.from({ length: 25 }, (_, offset) => reply(batch * 25 + offset)));
  }
  for (let index = parallelReplies; index < THREADS; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await reply(index);
  }
  return { reader, roomId, roots };
};

let seeded: Promise<Seed> | undefined;

/** Keeps a measurement with the test and prints it, so a run's output carries it. */
const report = (note: { type: string; description: string }) => {
  test.info().annotations.push(note);
  // eslint-disable-next-line no-console
  console.log(`${note.type}: ${note.description}`);
};

type ListRequest = { include: string | null; from: string | null; at: number };

/** Records the room's /threads requests, and delays every page after the first. */
const watchThreadList = async (page: Page, roomId: string) => {
  const requests: ListRequest[] = [];
  const isRoomList = (url: URL) =>
    decodeURIComponent(url.pathname).endsWith(`/rooms/${roomId}/threads`);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!isRoomList(url)) return;
    requests.push({
      include: url.searchParams.get('include'),
      from: url.searchParams.get('from'),
      at: Date.now(),
    });
  });
  await page.route(
    (url) => isRoomList(url) && url.searchParams.has('from'),
    async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, PAGE_DELAY_MS);
      });
      await route.continue();
    }
  );
  return requests;
};

/** The cards' thread root IDs; scrolls the card list to its end first. */
const listedRoots = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector('[data-compact-room-view]');
    if (view) view.scrollTop = view.scrollHeight;
    return [
      ...new Set(
        [...document.querySelectorAll('[data-compact-room-view] [data-thread-root-id]')].map(
          (card) => card.getAttribute('data-thread-root-id')
        )
      ),
    ];
  });

const checkThreadList = async (page: Page, name: string, engine: 'chromium' | 'webkit') => {
  seeded ??= seed();
  const { reader, roomId, roots } = await seeded;
  const requests = await watchThreadList(page, roomId);
  await loginWithPassword(page, {
    homeserver: getHomeserver(),
    username: reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createHiddenOverviewFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);

  // Read the count until it shows the whole room, keeping every value it showed on the way.
  const chip = page.locator('[data-thread-count="true"]');
  const seen: string[] = [];
  let partialShot = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    // eslint-disable-next-line no-await-in-loop
    const text = ((await chip.textContent({ timeout: 1_000 }).catch(() => null)) ?? '').trim();
    if (text && seen.at(-1) !== text) seen.push(text);
    if (text === String(THREADS)) break;
    if (SHOTS && !partialShot && text && text !== String(THREADS)) {
      partialShot = true;
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: `${SHOTS}/${name}-loading.png` });
    }
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(100);
  }
  const listedAfterMs = Date.now() - startedAt;
  report({ type: 'count values', description: seen.join(' -> ') });

  // Every thread is listed, promptly.
  expect(seen.at(-1), `count values: ${seen.join(' -> ')}`).toBe(String(THREADS));
  // The room opens in Compact with resolved threads hidden (none is resolved here), so the
  // summary names the total too.
  await expect(
    page.getByText(`Showing ${THREADS} of ${THREADS} threads`, { exact: true })
  ).toHaveCount(1);
  // Every count shown on the way is a plain number, as MindRoom Chat shows it.
  expect(seen.filter((text) => !/^\d+$/.test(text))).toEqual([]);

  // A card for every thread, the oldest ones included.
  await expect.poll(async () => (await listedRoots(page)).sort()).toEqual([...roots].sort());
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-end.png` });

  // Each page of the room's list once, the reader's list once, and nothing more after a while.
  await page.waitForTimeout(5_000);
  const pages = Array.from({ length: Math.ceil(THREADS / PAGE) }, (_, index) => index);
  const roomPages = requests.filter(({ include }) => include === 'all');
  expect(roomPages).toHaveLength(pages.length);
  expect(new Set(roomPages.map(({ from }) => from)).size).toBe(pages.length);
  expect(requests.filter(({ include }) => include === 'participated')).toHaveLength(1);

  const heap =
    engine === 'chromium'
      ? await page.evaluate(
          () =>
            (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
              ?.usedJSHeapSize ?? 0
        )
      : 0;
  report({
    type: 'thread list',
    description: `${name}: ${THREADS} threads in ${listedAfterMs} ms, ${
      requests.length
    } /threads requests${heap ? `, JS heap ${Math.round(heap / 2 ** 20)} MiB` : ''}`,
  });
};

type QuestionsSeed = { reader: Account; roomId: string; questions: string[]; threads: string[] };

/**
 * A room whose oldest top-level messages have no replies: 39 questions, then 40 threads with 50
 * replies each, then one more question. The history before the 39 questions is longer than the
 * pages the Compact view loads by itself.
 */
const seedQuestions = async (): Promise<QuestionsSeed> => {
  const homeserver = getHomeserver();
  const reader = await register(homeserver, 'qreader');
  const writer = await register(homeserver, 'qwriter');
  const agent = await registerAgentAccount(homeserver, 'helper');
  const roomId = await createRoom(homeserver, writer.accessToken, {
    name: 'Support questions',
    invite: [reader.userId, agent.userId],
  });
  await joinRoom(homeserver, reader.accessToken, roomId);
  await joinRoom(homeserver, agent.accessToken, roomId);
  const send = (account: Account | MatrixSession, content: Record<string, unknown>) =>
    sendRoomMessage(homeserver, account.accessToken, roomId, content);
  const question = (index: number) =>
    send(writer, {
      msgtype: 'm.text',
      body: `Question ${index}: how do I move a scheduled report to another workspace?`,
    });

  const questions: string[] = [];
  for (let index = 0; index < 39; index += 1) {
    // One at a time, so they are the room's oldest messages in order.
    // eslint-disable-next-line no-await-in-loop
    questions.push(await question(index));
  }
  const threads = await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      send(writer, {
        msgtype: 'm.text',
        body: `${TOPICS[index % TOPICS.length]} (discussion ${index})`,
      })
    )
  );
  for (let reply = 0; reply < 50; reply += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      threads.map((root, index) =>
        send(reply % 2 === 0 ? agent : writer, {
          msgtype: 'm.text',
          body: `${REPLIES[(index + reply) % REPLIES.length]} (step ${reply})`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: root,
            is_falling_back: true,
            'm.in_reply_to': { event_id: root },
          },
        })
      )
    );
  }
  questions.push(await question(39));
  return { reader, roomId, questions, threads };
};

let seededQuestions: Promise<QuestionsSeed> | undefined;

/** Scrolls the cards up a little and back to their end, as a reader reaching the end does. */
const scrollToCardsEnd = (page: Page) =>
  page.evaluate(async () => {
    const view = document.querySelector<HTMLElement>('[data-compact-room-view]');
    if (!view) return;
    view.scrollTop = Math.max(0, view.scrollTop - 80);
    await new Promise((resolve) => {
      requestAnimationFrame(resolve);
    });
    view.scrollTop = view.scrollHeight;
  });

const checkOlderQuestions = async (page: Page, name: string) => {
  seededQuestions ??= seedQuestions();
  const { reader, roomId, questions, threads } = await seededQuestions;
  const historyPages: number[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (decodeURIComponent(url.pathname).endsWith(`/rooms/${roomId}/messages`)) {
      historyPages.push(Date.now());
    }
  });
  await loginWithPassword(page, {
    homeserver: getHomeserver(),
    username: reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createHiddenOverviewFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);

  const chip = page.locator('[data-thread-count="true"]');
  const total = questions.length + threads.length;
  // The threads and the newest question have cards; older history is not loaded, and the count
  // is the plain number of cards.
  await expect(page.locator(`[data-thread-root-id="${questions.at(-1)}"]`)).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => (await listedRoots(page)).length, { timeout: 30_000 })
    .toBe(threads.length + 1);
  await page.waitForTimeout(3_000);
  expect((await listedRoots(page)).length).toBe(threads.length + 1);
  await expect(chip).toHaveText(`${threads.length + 1}`);
  const pagesBefore = historyPages.length;
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-questions-before.png` });

  // Reaching the end of the cards loads older history until the oldest question has its card.
  await expect
    .poll(
      async () => {
        await scrollToCardsEnd(page);
        return (await chip.textContent())?.trim();
      },
      { timeout: 60_000, intervals: [500] }
    )
    .toBe(String(total));
  expect((await listedRoots(page)).sort()).toEqual([...questions, ...threads].sort());
  await expect(page.locator(`[data-thread-root-id="${questions[0]}"]`)).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-questions-after.png` });
  report({
    type: 'older history',
    description: `${name}: ${pagesBefore} history pages before the end, ${historyPages.length} after`,
  });
};

/** The threads the Threads list counts in its groups, from each group's heading (`Recent · 12`). */
const groupedThreads = (list: Locator) =>
  list.locator('section').evaluateAll((sections) =>
    sections.reduce((sum, section) => {
      const heading = section.querySelector('h3, button')?.textContent ?? '';
      return sum + Number(/·\s*(\d+)$/.exec(heading.trim())?.[1] ?? 0);
    }, 0)
  );

/** The Threads list, on All, lists and counts every thread of every room. */
const checkThreadsPage = async (page: Page, name: string) => {
  seeded ??= seed();
  const { reader, roomId } = await seeded;
  const requests = await watchThreadList(page, roomId);
  await loginWithPassword(page, {
    homeserver: getHomeserver(),
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto('/threads/');
  const list = page.getByRole('navigation', { name: 'Threads' });
  await list.getByRole('radio', { name: 'All' }).click();
  await expect(list.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');

  const seen: number[] = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45_000) {
    // eslint-disable-next-line no-await-in-loop
    const count = await groupedThreads(list);
    if (seen.at(-1) !== count) seen.push(count);
    if (count === THREADS) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(100);
  }
  report({ type: 'threads page count values', description: seen.join(' -> ') });
  expect(seen.at(-1), `count values: ${seen.join(' -> ')}`).toBe(THREADS);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-threads-page.png` });

  await page.waitForTimeout(5_000);
  const roomPages = requests.filter(({ include }) => include === 'all');
  expect(roomPages).toHaveLength(Math.ceil(THREADS / PAGE));
  expect(new Set(roomPages.map(({ from }) => from)).size).toBe(roomPages.length);
  report({
    type: 'threads page',
    description: `${name}: ${THREADS} threads in ${Date.now() - startedAt - 5_000} ms, ${
      requests.length
    } /threads requests for the big room`,
  });
};

const inContext = async (
  browser: Browser,
  options: BrowserContextOptions,
  run: (page: Page) => Promise<void>
) => {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
};

test.beforeAll(() => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

test('a new device lists all 500 threads of a room (Chromium, desktop)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(360_000);
  await inContext(browser, { ...DESKTOP, baseURL, colorScheme: 'light' }, (page) =>
    checkThreadList(page, 'chromium-desktop', 'chromium')
  );
});

test('a new device lists all 500 threads of a room (Chromium, phone)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(360_000);
  await inContext(browser, { ...PHONE, baseURL, colorScheme: 'dark' }, (page) =>
    checkThreadList(page, 'chromium-phone', 'chromium')
  );
});

for (const [form, options] of [
  ['phone', { ...PHONE, colorScheme: 'light' }],
  ['desktop', { ...DESKTOP, colorScheme: 'dark' }],
] as const) {
  test(`a new device lists all 500 threads of a room (WebKit, ${form})`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(360_000);
    const browser = await launchWebKit();
    try {
      await inContext(browser, { ...options, baseURL }, (page) =>
        checkThreadList(page, `webkit-${form}`, 'webkit')
      );
    } finally {
      await browser.close();
    }
  });
}

test('older questions without replies get cards at the end of the list (Chromium, desktop)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(360_000);
  await inContext(browser, { ...DESKTOP, baseURL, colorScheme: 'light' }, (page) =>
    checkOlderQuestions(page, 'chromium-desktop')
  );
});

test('older questions without replies get cards at the end of the list (WebKit, phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(360_000);
  const browser = await launchWebKit();
  try {
    await inContext(browser, { ...PHONE, baseURL, colorScheme: 'light' }, (page) =>
      checkOlderQuestions(page, 'webkit-phone')
    );
  } finally {
    await browser.close();
  }
});

test('the Threads list lists and counts all 500 threads (Chromium, desktop)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(360_000);
  await inContext(browser, { ...DESKTOP, baseURL, colorScheme: 'light' }, (page) =>
    checkThreadsPage(page, 'chromium-desktop')
  );
});

test('the Threads list lists and counts all 500 threads (WebKit, phone)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(360_000);
  const browser = await launchWebKit();
  try {
    await inContext(browser, { ...PHONE, baseURL, colorScheme: 'dark' }, (page) =>
      checkThreadsPage(page, 'webkit-phone')
    );
  } finally {
    await browser.close();
  }
});
