import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { addRoomToSpace, matrixFetch } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The command palette as one search: tabs over rooms, threads, people, messages and actions,
// local results at the first keystroke, and real server message search (`POST /search`) that
// arrives below them. The account sits in 32 rooms, 2 spaces and threads with 5 other people
// and a few hundred messages; one made-up word appears in 3 rooms, once in a thread.
// Set PALETTE_SHOTS=<directory> to also save the L22 screenshots.
const PASSWORD = 'command-palette-search-spec-password';
const SHOTS = process.env.PALETTE_SHOTS;
const SEARCH_DELAY_MS = 3_000;

type Account = { username: string; userId: string; accessToken: string; name: string };

/** Retries what the server refuses with 429, after the wait it asks for. */
const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt > 8 || !String(error).includes('Matrix API 429')) throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, 500 * (attempt + 1));
      });
    }
  }
};

const register = async (prefix: string, run: string, name: string): Promise<Account> => {
  const username = `${prefix}_${run}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname: name }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token, name };
};

const createRoom = async (
  owner: Account,
  options: { name: string; topic?: string; space?: boolean; encrypted?: boolean }
): Promise<string> => {
  const body = await withRetry(() =>
    matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: owner.accessToken,
      body: JSON.stringify({
        // Public join rules let the other people join without an invite.
        preset: 'public_chat',
        name: options.name,
        topic: options.topic,
        creation_content: options.space ? { type: 'm.space' } : undefined,
        initial_state: options.encrypted
          ? [
              {
                type: 'm.room.encryption',
                state_key: '',
                content: { algorithm: 'm.megolm.v1.aes-sha2' },
              },
            ]
          : undefined,
      }),
    })
  );
  return body.room_id;
};

const join = (account: Account, roomId: string) =>
  withRetry(() =>
    matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
      method: 'POST',
      accessToken: account.accessToken,
      body: '{}',
    })
  );

let txn = 0;
const send = async (
  account: Account,
  roomId: string,
  body: string,
  threadRootId?: string
): Promise<string> => {
  txn += 1;
  const content: Record<string, unknown> = { msgtype: 'm.text', body };
  if (threadRootId) {
    content['m.relates_to'] = {
      rel_type: 'm.thread',
      event_id: threadRootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: threadRootId },
    };
  }
  const response = await withRetry(() =>
    matrixFetch<{ event_id: string }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/palette-${Date.now()}-${txn}`,
      { method: 'PUT', accessToken: account.accessToken, body: JSON.stringify(content) }
    )
  );
  return response.event_id;
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

const ROOM_NAMES = [
  'Design Review',
  'Release Planning',
  'Ops Handbook',
  'Sunset Crew',
  'Frontend Guild',
  'Backend Sync',
  'Customer Calls',
  'Hiring Loop',
  'Data Science',
  'Mobile App',
  'Security Desk',
  'Docs Corner',
  'Marketing Launch',
  'Sales Pipeline',
  'Support Queue',
  'Infra Budget',
  'Quarterly Goals',
  'Team Lunch',
  'Book Club',
  'Coffee Chat',
  'Research Notes',
  'Partner Updates',
  'Billing Questions',
  'Onboarding Buddies',
  'Accessibility Audit',
  'Performance Week',
  'Hackathon Ideas',
  'Board Prep',
  'Analytics Board',
  'Travel Plans',
  'Legal Review',
  'Random Thoughts',
] as const;

const LINES = [
  'Can we set a date for the demo?',
  'I pushed the latest draft to the shared folder.',
  'Thanks, that clears it up for me.',
  'Let us set up a quick call after lunch.',
  'The numbers look better than last week.',
  'Who owns the follow-up on this one?',
  'I will review it tomorrow morning.',
  'Please add your notes before Thursday.',
  'Good catch, I fixed the typo.',
] as const;

// Letters only, so the server's word splitting keeps it one word.
const lettersOf = (text: string) => text.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)]!);

type Seed = Awaited<ReturnType<typeof seed>>;

const seed = async () => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const word = `zorblax${lettersOf(run)}`;
  // A second word, late in a short Arabic message.
  const rtlWord = `quillmot${lettersOf(run)}`;
  const viewer = await register('palette_viewer', run, 'Robin Park');
  const people = await Promise.all(
    [
      ['palette_setareh', 'Setareh Karimi'],
      ['palette_jonas', 'Jonas Weber'],
      ['palette_priya', 'Priya Raman'],
      ['palette_mateo', 'Mateo Alvarez'],
      ['palette_hana', 'Hana Kobayashi'],
    ].map(([prefix, name]) => register(prefix!, run, name!))
  );
  const [setareh, jonas, priya, mateo] = people as [Account, Account, Account, Account, Account];

  const spaces = [
    await createRoom(viewer, { name: 'Product Hub', topic: 'Everything we ship', space: true }),
    await createRoom(viewer, { name: 'Research Lab', topic: 'Experiments', space: true }),
  ];
  const rooms: Record<string, string> = {};
  await inBatches(ROOM_NAMES, 6, async (name) => {
    rooms[name] = await createRoom(viewer, { name, topic: `${name} for the whole team` });
  });
  const encryptedRoom = await createRoom(viewer, { name: 'Private Notes', encrypted: true });
  // Half of the rooms sit in the two spaces.
  await inBatches(ROOM_NAMES.slice(0, 16), 4, (name) =>
    addRoomToSpace(
      HOMESERVER,
      viewer.accessToken,
      spaces[ROOM_NAMES.indexOf(name) % 2]!,
      rooms[name]!
    )
  );

  // The other people share the first twelve rooms, so their messages and names are there.
  const shared = ROOM_NAMES.slice(0, 12);
  await inBatches(
    shared.flatMap((name) => people.map((person) => ({ person, roomId: rooms[name]! }))),
    8,
    ({ person, roomId }) => join(person, roomId)
  );

  // Nine messages in every room, from everyone sharing it: 288 in all, plus the threads below.
  const everyone = [viewer, ...people];
  await inBatches(ROOM_NAMES, 4, async (name) => {
    const roomId = rooms[name]!;
    const speakers = shared.includes(name) ? everyone : [viewer];
    for (let n = 0; n < LINES.length; n += 1) {
      await send(speakers[n % speakers.length]!, roomId, `${LINES[n]} (${name})`);
    }
  });

  // Threads in four rooms.
  const threadRoots: Record<string, string> = {};
  for (const name of ['Design Review', 'Backend Sync', 'Mobile App', 'Ops Handbook'] as const) {
    const root = await send(viewer, rooms[name]!, `Thread about the ${name.toLowerCase()} plan`);
    threadRoots[name] = root;
    await send(jonas, rooms[name]!, 'Agreed, let us keep this in the thread.', root);
    await send(priya, rooms[name]!, 'I added the open questions here.', root);
  }

  // The made-up word: twice in a room's timeline, once as the newest reply in a thread.
  await send(jonas, rooms['Design Review']!, `The ${word} mockups are ready for review.`);
  await send(priya, rooms['Release Planning']!, `Ship the ${word} build on Friday.`);
  const threadHit = await send(
    mateo,
    rooms['Ops Handbook']!,
    `Root cause was the ${word} cache flush.`,
    threadRoots['Ops Handbook']
  );
  await send(setareh, rooms['Sunset Crew']!, 'Sunset photos are in the album.');
  await send(
    setareh,
    rooms['Sunset Crew']!,
    `بالتأكيد. ارتفع معدل الاستخدام بنسبة 12% وتم إصلاح الخطأ ${rtlWord} في الإصدار الأخير.`
  );

  return {
    viewer,
    word,
    rtlWord,
    rooms,
    encryptedRoom,
    threadHit,
    threadRoot: threadRoots['Ops Handbook']!,
    threadRoom: rooms['Ops Handbook']!,
  };
};

let seeded: Seed | undefined;

const login = async (page: Page) => {
  if (!seeded) throw new Error('not seeded');
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.viewer.username,
    password: PASSWORD,
  });
};

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });
const field = (page: Page) => palette(page).getByRole('combobox');
const tab = (page: Page, name: string) =>
  palette(page).getByRole('tablist').getByRole('tab', { name, exact: true });
const options = (page: Page, kind?: string) =>
  palette(page).locator(kind ? `[role="option"][data-kind="${kind}"]` : '[role="option"]');
const highlighted = (page: Page) => palette(page).locator('[role="option"][aria-selected="true"]');

const optionIds = (page: Page) =>
  options(page).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-item-id')));

const openPalette = async (page: Page) => {
  await pressPaletteShortcut(page);
  await expect(field(page)).toBeFocused();
};

const expectSelectedTab = (page: Page, name: string) =>
  expect(palette(page).getByRole('tab', { selected: true })).toHaveText(name);

const isServerSearch = (url: string) => new URL(url).pathname === '/_matrix/client/v3/search';

const shoot = async (target: Page | Locator, name: string) => {
  if (SHOTS) await target.screenshot({ path: `${SHOTS}/L22-palette-${name}.png` });
};

// Headless Chromium hides scrollbars; desktop browsers with classic scrollbars show them, and the
// tab row and the results must still fit. The other launch options repeat playwright.config.ts.
test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  const started = Date.now();
  seeded = await seed();
  console.log(
    `seeded ${ROOM_NAMES.length + 3} rooms and ${txn} messages in ${
      Date.now() - started
    } ms; word ${seeded.word}`
  );
});

test('typing shows rooms, people and actions at once while delayed message hits arrive below', async ({
  page,
}) => {
  await login(page);
  let answered = 0;
  page.on('response', (response) => {
    if (isServerSearch(response.url())) answered += 1;
  });
  // The real server answers, 3 seconds late.
  await page.route(
    (url) => isServerSearch(url.href),
    async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, SEARCH_DELAY_MS);
      });
      await route.continue();
    }
  );

  await openPalette(page);
  await expectSelectedTab(page, 'All');
  await expect(options(page, 'room').first()).toBeVisible();

  const typed = Date.now();
  await field(page).fill('set');
  await expect(options(page, 'room').filter({ hasText: 'Sunset Crew' })).toBeVisible();
  await expect(options(page, 'user').filter({ hasText: 'Setareh Karimi' })).toBeVisible();
  await expect(options(page, 'action').filter({ hasText: 'Open Settings' })).toBeVisible();
  const localMs = Date.now() - typed;
  // Only the Messages section waits, with one quiet line.
  await expect(palette(page).locator('[data-note="loading"]')).toBeVisible();
  expect(answered).toBe(0);
  await expect(options(page, 'message')).toHaveCount(0);
  expect(localMs).toBeLessThan(SEARCH_DELAY_MS);

  await field(page).press('ArrowDown');
  await field(page).press('ArrowDown');
  const before = await optionIds(page);
  const chosen = await highlighted(page).getAttribute('data-item-id');
  expect(chosen).toBe(before[2]);
  // The palette slides 5 px up as it opens (200 ms); measure where it comes to rest.
  await palette(page).evaluate((dialog) =>
    Promise.all(dialog.parentElement!.getAnimations().map((animation) => animation.finished))
  );
  const chosenBox = await highlighted(page).boundingBox();

  await expect(options(page, 'message').first()).toBeVisible({ timeout: 15_000 });
  const messagesMs = Date.now() - typed;
  expect(messagesMs).toBeGreaterThanOrEqual(SEARCH_DELAY_MS);
  expect(answered).toBeGreaterThan(0);
  await expect(highlighted(page)).toHaveAttribute('data-item-id', chosen!);
  // Nor does it move on screen: the palette grows downward.
  expect(await highlighted(page).boundingBox()).toEqual(chosenBox);
  const after = await optionIds(page);
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after.length).toBeGreaterThan(before.length);
  // The hits and See all results come last, under the Messages heading.
  const sections = await palette(page)
    .locator('[role="group"][data-section]')
    .evaluateAll((groups) => groups.map((group) => group.getAttribute('data-section')));
  expect(sections.at(-1)).toBe('messages');
  expect(after.at(-1)).toBe('search-page');
  await shoot(page, 'all');
  console.log(`local results ${localMs} ms after typing; message hits ${messagesMs} ms`);
});

test('the made-up word finds its 3 messages on the server and Enter opens the thread hit', async ({
  page,
}) => {
  const { word, threadHit, threadRoot, threadRoom } = seeded!;
  await login(page);
  await openPalette(page);
  await field(page).press('Tab');
  await field(page).press('Tab');
  await field(page).press('Tab');
  await field(page).press('Tab');
  await expectSelectedTab(page, 'Messages');

  const response = page.waitForResponse((answer) => isServerSearch(answer.url()));
  await field(page).fill(word);
  const body = (await (await response).json()) as {
    search_categories: { room_events: { results: unknown[] } };
  };
  expect(body.search_categories.room_events.results).toHaveLength(3);
  await expect(options(page, 'message')).toHaveCount(3);

  const hits = options(page, 'message');
  // Newest first: the thread reply, then the two room messages.
  await expect(hits.nth(0)).toContainText('Mateo Alvarez');
  await expect(hits.nth(0)).toContainText('Ops Handbook ›');
  await expect(hits.nth(1)).toContainText('Priya Raman');
  await expect(hits.nth(1)).toContainText('Release Planning');
  await expect(hits.nth(2)).toContainText('Design Review');
  for (let n = 0; n < 3; n += 1) {
    await expect(hits.nth(n).locator('mark')).toHaveText(word);
    await expect(hits.nth(n).locator('time')).not.toHaveText('');
  }
  await expect(palette(page).locator('[data-note="encrypted"]')).toHaveText(
    "The server can't search encrypted rooms."
  );
  await shoot(page, 'messages');

  await expect(highlighted(page)).toHaveAttribute('data-item-id', /\$/);
  await expect(highlighted(page)).toContainText('cache flush');
  await field(page).press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('threadId'), { timeout: 15_000 })
    .toBe(threadRoot);
  const path = decodeURIComponent(new URL(page.url()).pathname);
  expect(path).toContain(threadRoom);
  expect(path).toContain(threadHit);
  await expect(page.getByText(`Root cause was the ${word} cache flush.`).first()).toBeVisible();
});

test('left, right, Tab and Shift+Tab switch tabs without breaking text editing', async ({
  page,
}) => {
  await login(page);
  await openPalette(page);
  const input = field(page);

  // Empty field: the arrows switch.
  await input.press('ArrowRight');
  await expectSelectedTab(page, 'Rooms');
  await input.press('ArrowRight');
  await expectSelectedTab(page, 'Threads');
  await input.press('ArrowLeft');
  await expectSelectedTab(page, 'Rooms');
  await input.press('ArrowLeft');
  await expectSelectedTab(page, 'All');

  // Typing: left in the middle of the text moves the caret and keeps the tab.
  await input.fill('planning');
  await input.press('ArrowLeft');
  await input.press('ArrowLeft');
  await expectSelectedTab(page, 'All');
  expect(await input.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(6);
  // Right in the middle moves the caret too; at the end it switches.
  await input.press('ArrowRight');
  await expectSelectedTab(page, 'All');
  await input.press('ArrowRight');
  await expectSelectedTab(page, 'All');
  await input.press('ArrowRight');
  await expectSelectedTab(page, 'Rooms');
  await expect(input).toHaveValue('planning');

  // After the down arrow both arrows switch, wherever the caret is.
  await input.press('Home');
  await input.press('ArrowRight');
  await input.press('ArrowDown');
  await input.press('ArrowLeft');
  await expectSelectedTab(page, 'All');
  await input.press('ArrowRight');
  await expectSelectedTab(page, 'Rooms');
  expect(await input.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(1);

  // Tab and Shift+Tab always switch, and focus stays in the field.
  await input.press('Tab');
  await expectSelectedTab(page, 'Threads');
  await input.press('Tab');
  await expectSelectedTab(page, 'People');
  // Back past All wraps around to Actions.
  for (let n = 0; n < 4; n += 1) await input.press('Shift+Tab');
  await expectSelectedTab(page, 'Actions');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('planning');

  // Escape closes; the next opening starts on All with an empty field.
  await input.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  await openPalette(page);
  await expectSelectedTab(page, 'All');
  await expect(field(page)).toHaveValue('');
});

test('the sidebar Find anything field opens the palette on All, and See all results the page', async ({
  page,
}) => {
  const { word } = seeded!;
  await login(page);
  const findAnything = page.getByRole('button', { name: 'Find anything', exact: true });
  await expect(findAnything).toContainText(/(Ctrl \+ K|⌘ K)$/);
  await findAnything.click();
  await expect(field(page)).toBeFocused();
  await expectSelectedTab(page, 'All');
  await expect(findAnything).toHaveAttribute('aria-expanded', 'true');

  // All finds the messages too, and leads to the search page with its filters.
  await field(page).fill(word);
  await expect(options(page, 'message')).toHaveCount(3);
  await options(page, 'search-page').click();
  await expect(palette(page)).toHaveCount(0);
  await expect(page).toHaveURL(
    new RegExp(`/home/search/\\?${new URLSearchParams({ term: word, global: 'true' })}$`)
  );
  await expect(page.getByRole('searchbox', { name: 'Search Messages' })).toHaveValue(word);
  await expect(page.getByText(`Root cause was the ${word} cache flush.`)).toBeVisible();
  await expect(page.getByText(`Ship the ${word} build on Friday.`)).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true });

  test('the tab row scrolls sideways, and a tapped result opens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await openPalette(page);
    const tablist = palette(page).getByRole('tablist');
    const overflow = await tablist.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeGreaterThan(0);
    await field(page).press('Shift+Tab');
    await expectSelectedTab(page, 'Actions');
    await expect.poll(() => tablist.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(tab(page, 'Actions')).toBeInViewport({ ratio: 1 });
    // Tabs are not clipped by the row's own scrollbar.
    const row = (await tablist.boundingBox())!;
    const actions = (await tab(page, 'Actions').boundingBox())!;
    expect(actions.y + actions.height).toBeLessThanOrEqual(row.y + row.height);

    await field(page).press('Tab');
    await expectSelectedTab(page, 'All');
    await field(page).fill('Release Planning');
    const target = options(page, 'room').filter({ hasText: 'Release Planning' });
    await expect(target).toBeVisible();
    await shoot(page, 'phone');
    await target.tap();
    await expect(palette(page)).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(encodeURIComponent(seeded!.rooms['Release Planning']!))
    );
  });
});

test.describe('on a phone, in right-to-left text', () => {
  test.use({ hasTouch: true });

  test('a late match in a short message shows in its snippet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await openPalette(page);
    await field(page).fill(seeded!.rtlWord);
    const hit = options(page, 'message').first();
    await expect(hit).toBeVisible({ timeout: 30_000 });
    const match = hit.locator('mark').first();
    await expect(match).toHaveText(seeded!.rtlWord);
    // The snippet's line clips what does not fit; the match lies inside it.
    const inView = await match.evaluate((element) => {
      const line = element.parentElement!.getBoundingClientRect();
      const own = element.getBoundingClientRect();
      return own.left >= line.left - 1 && own.right <= line.right + 1;
    });
    await shoot(page, 'phone-rtl-snippet');
    expect(inView, 'the match shows inside the snippet line').toBe(true);
  });
});

test('the palette in the dark theme', async ({ page }) => {
  test.skip(!SHOTS, 'Screenshots only');
  await login(page);
  await openPalette(page);
  await field(page).press('Shift+Tab');
  await field(page).fill('theme');
  await field(page).press('Enter');
  await openPalette(page);
  await field(page).fill('set');
  await expect(options(page, 'message').first()).toBeVisible({ timeout: 15_000 });
  await shoot(page, 'dark');
});
