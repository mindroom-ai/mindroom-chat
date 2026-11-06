import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch, type MatrixSession } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, onWebKitPage } from '../helpers/webkit';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';

// Message search against the real server (`POST /search`, live-test findings L1-F019 and
// L1-F020). The account sits in 26 rooms with two other people and an agent. One made-up word
// appears in 45 messages over three rooms, one of them a thread reply, so the server answers in
// several pages; the search page must reach every one of them and say how many there are. An
// agent's replies start as "Thinking..." and are then edited, as MindRoom's streaming does: the
// server indexes the first text, so a search for "Thinking" must not list a reply whose final
// text no longer says it, and previews show the final text without Markdown syntax.
// Set SEARCH_PAGES_SHOTS=<directory> to save screenshots.

const SHOTS = process.env.SEARCH_PAGES_SHOTS;
const HITS = 45;
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

const ROOM_NAMES = [
  'Night Sky Club',
  'Observatory Ops',
  'Field Notes',
  'Agent Desk',
  'Design Review',
  'Release Planning',
  'Ops Handbook',
  'Frontend Guild',
  'Backend Sync',
  'Customer Calls',
  'Hiring Loop',
  'Data Science',
  'Mobile App',
  'Security Desk',
  'Docs Corner',
  'Marketing Launch',
  'Support Queue',
  'Infra Budget',
  'Quarterly Goals',
  'Team Lunch',
  'Book Club',
  'Coffee Chat',
  'Research Notes',
  'Partner Updates',
  'Travel Plans',
  'Random Thoughts',
] as const;

const FILLER = [
  'Can we set a date for the demo next week?',
  'I pushed the latest draft to the shared folder, comments welcome.',
  'Thanks, that clears it up for me. I will update the checklist.',
] as const;

// Letters only, so the server's word splitting keeps it one word.
const lettersOf = (text: string) => text.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)]!);

const send = async (
  account: MatrixSession,
  roomId: string,
  content: Record<string, unknown>
): Promise<string> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const body = await matrixFetch<{ event_id: string }>(
        HOMESERVER,
        `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${randomUUID()}`,
        { method: 'PUT', accessToken: account.accessToken, body: JSON.stringify(content) }
      );
      return body.event_id;
    } catch (error) {
      if (attempt > 8 || !String(error).includes('Matrix API 429')) throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, 500 * (attempt + 1));
      });
    }
  }
};

const text = (body: string) => ({ msgtype: 'm.text', body });

/** An agent's reply as MindRoom streams it: a placeholder, then edits to the final text. */
const streamReply = async (
  agent: MatrixSession,
  roomId: string,
  steps: readonly { body: string; html: string }[]
): Promise<string> => {
  const replyId = await send(agent, roomId, {
    msgtype: 'm.text',
    body: 'Thinking...',
    format: 'org.matrix.custom.html',
    formatted_body: '<p>Thinking...</p>\n',
    'io.mindroom.stream_status': 'pending',
  });
  for (const [index, step] of steps.entries()) {
    const content = {
      msgtype: 'm.text',
      body: step.body,
      format: 'org.matrix.custom.html',
      formatted_body: step.html,
      'io.mindroom.stream_status': index === steps.length - 1 ? 'completed' : 'streaming',
    };
    await send(agent, roomId, {
      ...content,
      body: `* ${step.body}`,
      'm.new_content': content,
      'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
    });
  }
  return replyId;
};

/** Runs `work` over `items`, a few at a time. */
const inBatches = async <T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<unknown>
) => {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(work));
  }
};

type Seed = Awaited<ReturnType<typeof seed>>;

const seed = async () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const word = `quasar${lettersOf(run)}`;
  const password = `search-pages-${run}`;
  const viewer = await registerDisposableUser(`search_viewer_${run}`, password);
  const jonas = await registerDisposableUser(`search_jonas_${run}`, password);
  const priya = await registerDisposableUser(`search_priya_${run}`, password);
  const agent = await registerDisposableUser(`mindroom_helper_${run}`, password);
  const names: [MatrixSession, string][] = [
    [viewer, 'Robin Park'],
    [jonas, 'Jonas Weber'],
    [priya, 'Priya Raman'],
    [agent, 'Helper'],
  ];
  await Promise.all(
    names.map(([account, name]) =>
      matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(account.userId)}/displayname`, {
        method: 'PUT',
        accessToken: account.accessToken,
        body: JSON.stringify({ displayname: name }),
      })
    )
  );

  const rooms: Record<string, string> = {};
  await inBatches(ROOM_NAMES, 6, async (name) => {
    const body = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: viewer.accessToken,
      body: JSON.stringify({ preset: 'public_chat', name, topic: `${name} for the team` }),
    });
    rooms[name] = body.room_id;
  });
  const shared = ROOM_NAMES.slice(0, 4);
  await inBatches(
    shared.flatMap((name) => [jonas, priya, agent].map((account) => ({ account, name }))),
    6,
    ({ account, name }) => joinRoom(HOMESERVER, account.accessToken, rooms[name]!)
  );
  await inBatches(ROOM_NAMES, 6, async (name) => {
    for (const line of FILLER) await send(viewer, rooms[name]!, text(`${line} (${name})`));
  });

  // The word, oldest first: 20 in the first room, 15 in the second, 10 in the third, the last of
  // them a thread reply.
  const speakers = [viewer, jonas, priya];
  const places = [
    ...Array.from({ length: 20 }, () => rooms['Night Sky Club']!),
    ...Array.from({ length: 15 }, () => rooms['Observatory Ops']!),
    ...Array.from({ length: 9 }, () => rooms['Field Notes']!),
  ];
  for (const [index, roomId] of places.entries()) {
    await send(
      speakers[index % speakers.length]!,
      roomId,
      text(
        `Sighting ${
          index + 1
        }: the ${word} looked bright tonight over the ridge, worth another look tomorrow.`
      )
    );
  }
  const threadRoot = await send(viewer, rooms['Field Notes']!, text('Thread for the photo plan'));
  await send(jonas, rooms['Field Notes']!, {
    ...text(`Sighting ${HITS}: the ${word} again, only inside this thread.`),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: threadRoot,
      is_falling_back: true,
      'm.in_reply_to': { event_id: threadRoot },
    },
  });

  // Two agent replies that start as "Thinking...": one ends without the word, one keeps it.
  const desk = rooms['Agent Desk']!;
  await send(viewer, desk, text(`Thinking about lunch options for Friday, any ideas?`));
  const changedReply = await streamReply(agent, desk, [
    { body: 'Hello from **Helper**.', html: '<p>Hello from <strong>Helper</strong>.</p>' },
    {
      body: 'Hello from **Helper**. The plan has three steps: _scope_, build and `ship`.',
      html: '<p>Hello from <strong>Helper</strong>. The plan has three steps: <em>scope</em>, build and <code>ship</code>.</p>',
    },
  ]);
  const keptReply = await streamReply(agent, desk, [
    { body: 'I was', html: '<p>I was</p>' },
    {
      body: 'I was thinking about the **launch plan**: start with the [checklist](https://example.org/list).',
      html: '<p>I was thinking about the <strong>launch plan</strong>: start with the <a href="https://example.org/list">checklist</a>.</p>',
    },
  ]);

  return { viewer, word, rooms, changedReply, keptReply };
};

let seeded: Seed | undefined;

const isServerSearch = (url: string) => new URL(url).pathname === '/_matrix/client/v3/search';

const login = async (page: Page) => {
  if (!seeded) throw new Error('not seeded');
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.viewer.username,
    password: seeded.viewer.password,
  });
};

const shoot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const searchPath = (term: string) =>
  `/home/search/?${new URLSearchParams({ term, global: 'true' }).toString()}`;

const resultButtons = (page: Page) => page.locator('article [data-event-id]');

/**
 * Scrolls the results to their end until no new hit arrives, collecting the event of every hit
 * shown on the way (the list renders only the rows near the screen).
 */
const collectAllHits = async (page: Page, touch: boolean): Promise<Set<string>> => {
  const seen = new Set<string>();
  const collect = async () => {
    const ids = await resultButtons(page).evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('data-event-id') ?? '')
    );
    ids.forEach((id) => seen.add(id));
  };
  await expect(resultButtons(page).first()).toBeVisible({ timeout: 20_000 });
  // The page's scroll container: the nearest ancestor of the field that scrolls.
  await page.getByRole('searchbox', { name: 'Search Messages' }).evaluate((element) => {
    let node: HTMLElement | null = element.parentElement;
    while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
      node = node.parentElement;
    }
    node?.setAttribute('data-e2e-scroller', '');
  });
  const scroller = page.locator('[data-e2e-scroller]');
  let unchanged = 0;
  for (let step = 0; step < 80 && unchanged < 6; step += 1) {
    const before = seen.size;
    await collect();
    if (touch) {
      // A finger flick: the page scrolls by most of a screen.
      await scroller.evaluate((node) => node.scrollBy({ top: node.clientHeight * 0.8 }));
    } else {
      const box = (await scroller.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 700);
    }
    await page.waitForTimeout(250);
    await collect();
    unchanged = seen.size === before ? unchanged + 1 : 0;
  }
  return seen;
};

const checkPaging = async (page: Page, touch: boolean, shot: string) => {
  const { word } = seeded!;
  const pages: { results: number; count?: number; next?: string }[] = [];
  page.on('response', async (response) => {
    if (!isServerSearch(response.url()) || response.request().method() !== 'POST') return;
    const body = (await response.json().catch(() => undefined)) as
      | {
          search_categories?: {
            room_events?: { results?: unknown[]; count?: number; next_batch?: string };
          };
        }
      | undefined;
    const events = body?.search_categories?.room_events;
    pages.push({
      results: events?.results?.length ?? -1,
      count: events?.count,
      next: events?.next_batch,
    });
  });
  await login(page);
  await page.goto(searchPath(word));
  await expect(page.getByRole('searchbox', { name: 'Search Messages' })).toHaveValue(word);
  await expect(resultButtons(page).first()).toBeVisible({ timeout: 20_000 });
  await shoot(page, `${shot}-first`);
  const hits = await collectAllHits(page, touch);
  const metrics = await page
    .locator('[data-e2e-scroller]')
    .evaluate((node) => [node.scrollTop, node.clientHeight, node.scrollHeight]);
  console.log(
    `${shot}: ${hits.size} hits seen; scroller ${metrics.join('/')}; server pages ${JSON.stringify(
      pages
    )}`
  );
  await shoot(page, `${shot}-end`);
  // Every message with the word, the thread reply and the oldest one included.
  expect(hits.size).toBe(HITS);
  await expect(page.getByText(`Sighting 1: the ${word}`, { exact: false })).toBeVisible();
  // The total the server gave.
  await expect(page.getByRole('status').filter({ hasText: `${HITS} results` })).toBeVisible();
};

// Classic scrollbars, as desktop browsers show them.
test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });
test.describe.configure({ timeout: 240_000 });

test.beforeAll(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  const started = Date.now();
  seeded = await seed();
  console.log(
    `seeded ${ROOM_NAMES.length} rooms in ${Date.now() - started} ms; word ${seeded.word}`
  );
});

test.describe('L1-F019 every page of hits', () => {
  test('desktop: scrolling to the end loads every page and the total shows', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await checkPaging(page, false, 'paging-desktop');
  });

  test('phone: flicking to the end loads every page and the total shows', async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
    try {
      await checkPaging(await context.newPage(), true, 'paging-phone');
    } finally {
      await context.close();
    }
  });

  test('WebKit desktop and phone load every page', async () => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
    await onWebKitPage({ viewport: DESKTOP }, (page) => checkPaging(page, false, 'paging-webkit'));
    await onWebKitPage({ viewport: PHONE, hasTouch: true, isMobile: true }, (page) =>
      checkPaging(page, true, 'paging-webkit-phone')
    );
  });
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });
const paletteField = (page: Page) => palette(page).getByRole('combobox');
const messageOptions = (page: Page) =>
  palette(page).locator('[role="option"][data-kind="message"]');

const checkPlaceholderHits = async (page: Page, shot: string) => {
  const { changedReply, keptReply } = seeded!;
  await login(page);
  const pages: unknown[] = [];
  page.on('response', async (response) => {
    if (isServerSearch(response.url()) && response.request().method() === 'POST') {
      pages.push(await response.json().catch(() => undefined));
    }
  });

  // The palette's Messages tab.
  await pressPaletteShortcut(page);
  await expect(paletteField(page)).toBeFocused();
  for (let n = 0; n < 4; n += 1) await paletteField(page).press('Tab');
  await expect(palette(page).getByRole('tab', { selected: true })).toHaveText('Messages');
  await paletteField(page).fill('Thinking');
  await expect(palette(page).locator('[data-note="loading"]')).toHaveCount(0, { timeout: 15_000 });
  console.log(`${shot}: server pages ${pages.length}`);
  await shoot(page, `${shot}-palette`);
  const rows = messageOptions(page);
  // The human message and the reply that still says it; not the reply whose final text dropped it.
  await expect(rows).toHaveCount(2);
  await expect(palette(page).locator(`[data-item-id$="${changedReply}"]`)).toHaveCount(0);
  const kept = palette(page).locator(`[data-item-id$="${keptReply}"]`);
  await expect(kept).toContainText(
    'I was thinking about the launch plan: start with the checklist.'
  );
  await expect(kept).not.toContainText('**');
  await expect(kept).not.toContainText('](');

  // The search page lists the same two.
  await page.keyboard.press('Escape');
  await page.goto(searchPath('Thinking'));
  await expect(resultButtons(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(resultButtons(page)).toHaveCount(2);
  await expect(page.locator(`article [data-event-id="${changedReply}"]`)).toHaveCount(0);
  await expect(page.locator(`article [data-event-id="${keptReply}"]`)).toHaveCount(1);
  await expect(page.locator('article').first()).toBeVisible();
  for (const article of await page.locator('article').all()) {
    await expect(article).not.toContainText('**');
  }
  await shoot(page, `${shot}-page`);
};

test.describe('L1-F020 hits by their latest edit', () => {
  test('desktop: a reply edited away from "Thinking" is not a hit; previews are plain', async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await checkPlaceholderHits(page, 'placeholder-desktop');
  });

  test('phone: the same on a touch screen', async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
    try {
      await checkPlaceholderHits(await context.newPage(), 'placeholder-phone');
    } finally {
      await context.close();
    }
  });

  test('WebKit desktop and phone', async () => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
    await onWebKitPage({ viewport: DESKTOP }, (page) =>
      checkPlaceholderHits(page, 'placeholder-webkit')
    );
    await onWebKitPage({ viewport: PHONE, hasTouch: true, isMobile: true }, (page) =>
      checkPlaceholderHits(page, 'placeholder-webkit-phone')
    );
  });
});
