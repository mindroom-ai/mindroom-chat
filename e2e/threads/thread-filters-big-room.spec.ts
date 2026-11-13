import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

// The thread filter bar in a room with 160 threads, read against what the seed knows:
// - every preset, the search and the People filter apply to the pinned threads as they do to the
//   others, and the counts follow (a pinned thread that does not match is not shown);
// - a thread's people are everyone who wrote in it, the root's sender and every reply's sender,
//   not only the root's sender and the last replier: the People list counts them, a chosen person
//   keeps every thread they wrote in, and a card shows up to three of them.
// The browser signs in after the seed, so it knows each thread from the server's thread list
// (root and newest reply) until it reads the replies.
// Chromium at 1440x900 and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, a phone
// in WebKit; classic scrollbars shown. Set THREAD_FILTER_SHOTS=<directory> for screenshots.
const SHOTS = process.env.THREAD_FILTER_SHOTS;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

test.use({
  viewport: DESKTOP,
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const THREAD_COUNT = 160;
const TOPICS = [
  'Draft the onboarding email',
  'Profile the search API under load',
  'Deploy checklist for the release',
  'Translate the help center batch',
  'Rotate the staging keys',
  'Fix the login timeout on slow networks',
  'Compare vector stores for memory',
  'Write the backup and restore guide',
];
// The topic only threads 4, 12, 20, ... carry; none of them is pinned.
const SEARCH_TOPIC = TOPICS[4]!;

type Person = 'me' | 'rowan' | 'sasha' | 'planner';
const PEOPLE: Person[] = ['me', 'rowan', 'sasha', 'planner'];
const HUMANS: Person[] = ['me', 'rowan', 'sasha'];

type ThreadPlan = {
  title: string;
  root: Person;
  replies: Person[];
  resolved: boolean;
};

/**
 * Thread i: a person asks; in an even thread the next person answers, the planner agent writes
 * twice in the middle and the same person replies last; in an odd thread the third person answers
 * first and the next person last. So the planner and the third person write only in the middle.
 * Every third thread (1, 4, 7, ...) is resolved.
 */
const planThread = (index: number): ThreadPlan => {
  const root = HUMANS[index % 3]!;
  const next = HUMANS[(index + 1) % 3]!;
  const third = HUMANS[(index + 2) % 3]!;
  return {
    title: `${TOPICS[index % TOPICS.length]} ${index}`,
    root,
    replies: index % 2 === 0 ? [next, 'planner', 'planner', next] : [third, next],
    resolved: index % 3 === 1,
  };
};
const PLANS = Array.from({ length: THREAD_COUNT }, (_unused, index) => planThread(index));
// Pinned, in this order: three unresolved threads (0 and 2 with the planner) and three that carry
// the resolved tag (4 with the planner).
const PINNED = [0, 2, 3, 1, 4, 7];

// Display names as the room shows them; `me` is the primary test account's.
const DISPLAY_NAMES: Record<Person, string> = {
  me: '',
  rowan: 'Rowan Park',
  sasha: 'Sasha Lee',
  planner: 'Planner',
};

const peopleOf = (plan: ThreadPlan): Set<Person> => new Set([plan.root, ...plan.replies]);

const REPLY_TEXT: Record<Person, (title: string) => string> = {
  me: (title) => `Thanks, I will take "${title}" from here and report back by the end of the day.`,
  rowan: (title) =>
    `I looked at ${title.toLowerCase()} this morning; the numbers match what we saw last week.`,
  sasha: (title) =>
    `Two open questions on ${title.toLowerCase()}: who owns it, and when is it due?`,
  planner: (title) =>
    `Plan for ${title.toLowerCase()}: 1. collect the inputs, 2. draft, 3. review with the team.`,
};

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

/** A plain account (no agent name) with a display name, as people in the room. */
const registerPerson = async (homeserver: string, displayName: string): Promise<MatrixSession> => {
  const body = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({
        username: `person_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        password: randomUUID(),
        auth: { type: 'm.login.dummy' },
      }),
    }
  );
  await setDisplayName(
    homeserver,
    { accessToken: body.access_token, userId: body.user_id },
    displayName
  );
  return { accessToken: body.access_token, userId: body.user_id };
};

const setDisplayName = async (homeserver: string, session: MatrixSession, displayName: string) => {
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
};

type SeededRoom = {
  roomId: string;
  userIds: Record<Person, string>;
  rootIds: string[];
};

/** The room, its members and the 160 threads, sent eight threads at a time. */
const seedRoom = async (homeserver: string, me: MatrixSession): Promise<SeededRoom> => {
  const roomId = await createPrivateRoom(homeserver, me.accessToken, {
    name: `Busy planning ${Date.now()}`,
    topic: 'One hundred and sixty threads, four people',
  });
  const rowan = await registerPerson(homeserver, 'Rowan Park');
  const sasha = await registerPerson(homeserver, 'Sasha Lee');
  const planner = await registerAgentAccount(homeserver, 'planner');
  await setDisplayName(homeserver, planner, 'Planner');
  const sessions: Record<Person, MatrixSession> = { me, rowan, sasha, planner };
  for (const member of [rowan, sasha, planner]) {
    // eslint-disable-next-line no-await-in-loop
    await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/invite`, {
      method: 'POST',
      accessToken: me.accessToken,
      body: JSON.stringify({ user_id: member.userId }),
    });
    // eslint-disable-next-line no-await-in-loop
    await joinRoom(homeserver, member.accessToken, roomId);
  }

  const rootIds: string[] = new Array<string>(THREAD_COUNT);
  const sendThread = async (index: number) => {
    const plan = PLANS[index]!;
    const rootId = await sendRoomMessage(homeserver, sessions[plan.root].accessToken, roomId, {
      msgtype: 'm.text',
      body: plan.title,
    });
    rootIds[index] = rootId;
    for (const sender of plan.replies) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, sessions[sender].accessToken, roomId, {
        msgtype: 'm.text',
        body: REPLY_TEXT[sender](plan.title),
        'm.relates_to': threadRelation(rootId),
      });
    }
    if (plan.resolved) {
      await sendStateEvent(
        homeserver,
        me.accessToken,
        roomId,
        'com.mindroom.thread.tags',
        JSON.stringify([rootId, 'resolved']),
        { set_by: me.userId, set_at: new Date().toISOString() }
      );
    }
  };
  for (let start = 0; start < THREAD_COUNT; start += 8) {
    const batch = Array.from({ length: Math.min(8, THREAD_COUNT - start) }, (_u, i) => start + i);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map(sendThread));
  }
  await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events`, {
    method: 'PUT',
    accessToken: me.accessToken,
    body: JSON.stringify({ pinned: PINNED.map((index) => rootIds[index]) }),
  });

  return {
    roomId,
    userIds: { me: me.userId, rowan: rowan.userId, sasha: sasha.userId, planner: planner.userId },
    rootIds,
  };
};

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.mouse.move(1, 1);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The indexes of the threads that pass `keep`, as root IDs. */
const rootsWhere = (room: SeededRoom, keep: (plan: ThreadPlan, index: number) => boolean) =>
  PLANS.flatMap((plan, index) => (keep(plan, index) ? [room.rootIds[index]!] : []));

const shownRootIds = (cards: Locator) =>
  cards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-thread-root-id') ?? '')
  );

const sorted = (ids: string[]) => [...ids].sort();

/** The cards shown are exactly `expected`, pinned ones included, and the count chip says so. */
const expectShown = async (page: Page, room: SeededRoom, expected: string[], label: string) => {
  const cards = page.locator('[data-compact-room-view] [data-thread-root-id]');
  const pinnedCards = page.locator('[data-pinned-threads] [data-thread-root-id]');
  const pinnedRoots = new Set(PINNED.map((index) => room.rootIds[index]!));
  await expect
    .poll(async () => sorted(await shownRootIds(cards)), { message: label, timeout: 30_000 })
    .toEqual(sorted(expected));
  expect(sorted(await shownRootIds(pinnedCards)), `${label}: pinned`).toEqual(
    sorted(expected.filter((id) => pinnedRoots.has(id)))
  );
  await expect(
    page.locator('[data-room-thread-overview] [data-thread-count]').first(),
    `${label}: count`
  ).toHaveText(String(expected.length));
};

const applyPreset = async (page: Page, preset: string) => {
  const overview = page.locator('[data-room-thread-overview]');
  await overview.locator('[data-preset-button]').click();
  await overview.locator(`[data-preset-option="${preset}"]`).click();
  await expect(overview.locator('[data-preset-dropdown]')).toHaveCount(0);
};

/** Each person's thread count in the open People list. */
const listedCounts = (panel: Locator) =>
  panel
    .locator('[data-person-option]')
    .evaluateAll((rows) =>
      Object.fromEntries(
        rows.map((row) => [
          row.getAttribute('data-person-option') ?? '',
          Number(row.querySelector('span[aria-hidden="true"]')?.textContent ?? 0),
        ])
      )
    );

/** Everything the spec checks, on a signed-in page that shows the seeded room. */
const checkFilters = async (page: Page, room: SeededRoom, engine: string) => {
  const cards = page.locator('[data-compact-room-view] [data-thread-root-id]');
  const overview = page.locator('[data-room-thread-overview]');
  await expect(cards).toHaveCount(THREAD_COUNT, { timeout: 180_000 });
  // The advanced filters, whichever mode the account's setting starts in.
  const modeSwitch = overview.locator('[data-thread-filter-mode-switch]');
  await expect(async () => {
    if ((await modeSwitch.getAttribute('aria-pressed')) !== 'true') await modeSwitch.click();
    await expect(overview.locator('[data-preset-button]')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // Presets: the pinned threads follow the same rules as the others. A pinned thread stays open
  // (THR-18), so its resolved tag does not count while it is pinned.
  const pinnedIndexes = new Set(PINNED);
  const isResolved = (plan: ThreadPlan, index: number) =>
    plan.resolved && !pinnedIndexes.has(index);
  await applyPreset(page, 'archived');
  await expectShown(page, room, rootsWhere(room, isResolved), `${engine} archived`);
  await shot(page, `${engine}-preset-archived`);
  await applyPreset(page, 'needs-attention');
  await expectShown(
    page,
    room,
    rootsWhere(room, (plan, index) => !isResolved(plan, index)),
    `${engine} needs attention`
  );
  await shot(page, `${engine}-preset-needs-attention`);
  // Nothing is scheduled or streaming: Working keeps no thread, pinned ones included.
  await applyPreset(page, 'working');
  await expectShown(page, room, [], `${engine} working`);
  await expect(page.locator('[data-pinned-threads]')).toHaveCount(0);
  await shot(page, `${engine}-preset-working`);
  await applyPreset(page, 'all');
  await expectShown(page, room, room.rootIds, `${engine} all`);

  // The search: only threads 4, 12, 20, ... carry the topic, and no pinned thread does.
  await overview.locator('[data-search-toggle]').click();
  await overview.locator('[data-search-input]').fill(SEARCH_TOPIC.split(' ').slice(0, 2).join(' '));
  await expectShown(
    page,
    room,
    rootsWhere(room, (plan) => plan.title.startsWith(SEARCH_TOPIC)),
    `${engine} search`
  );
  await overview.locator('[data-search-input]').fill('');
  await expectShown(page, room, room.rootIds, `${engine} search cleared`);

  // People: everyone who wrote in a thread counts, the root's sender and every replier.
  const peopleButton = overview.locator('[data-people-filter-button]');
  await peopleButton.click();
  const panel = overview.locator('[data-people-filter-panel]');
  const expectedCounts = Object.fromEntries(
    PEOPLE.map((person) => [
      room.userIds[person],
      PLANS.filter((plan) => peopleOf(plan).has(person)).length,
    ])
  );
  await expect
    .poll(() => listedCounts(panel), { message: `${engine} people counts`, timeout: 120_000 })
    .toEqual(expectedCounts);
  await shot(page, `${engine}-people-counts`);
  await panel.locator(`[data-person-option="${room.userIds.planner}"]`).click();
  await expectShown(
    page,
    room,
    rootsWhere(room, (plan) => peopleOf(plan).has('planner')),
    `${engine} planner`
  );
  await page.keyboard.press('Escape');
  await shot(page, `${engine}-people-planner`);

  // Clearing the choice brings every thread back.
  await peopleButton.click();
  await panel.locator(`[data-person-option="${room.userIds.planner}"]`).click();
  await page.keyboard.press('Escape');
  await expectShown(page, room, room.rootIds, `${engine} people cleared`);

  // A card shows three of its people: the newest repliers, then the root's sender. Thread 10's
  // planner and thread 11's first replier wrote only in the middle.
  for (const index of [10, 11]) {
    const plan = PLANS[index]!;
    const expected = [...new Set([...[...plan.replies].reverse(), plan.root])].slice(0, 3);
    const card = page.locator(
      `[data-compact-room-view] [data-thread-root-id="${room.rootIds[index]}"]`
    );
    // eslint-disable-next-line no-await-in-loop
    await expect
      .poll(
        () =>
          card
            .locator('[data-compact-card-metadata] > :first-child > [title]')
            .evaluateAll((avatars) => avatars.map((avatar) => avatar.getAttribute('title'))),
        { message: `${engine} avatars of thread ${index}` }
      )
      .toEqual(expected.map((person) => DISPLAY_NAMES[person]));
  }
};

const openRoom = async (page: Page, room: SeededRoom) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  await loginWithPassword(page, { homeserver, ...credentials });
  await expectLoggedInShellStable(page);
  await seedRoomOverviewState({
    page,
    roomId: room.roomId,
    userId: room.userIds.me,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
};

test.describe('thread filters in a room with 160 threads', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');
  test.describe.configure({ mode: 'serial' });

  let room: SeededRoom;
  test.beforeAll(async () => {
    test.setTimeout(600_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const me = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const profile = await matrixFetch<{ displayname?: string }>(
      homeserver,
      `/profile/${encodeURIComponent(me.userId)}/displayname`,
      { accessToken: me.accessToken }
    ).catch(() => ({ displayname: undefined }));
    DISPLAY_NAMES.me = profile.displayname || me.userId.slice(1).split(':')[0]!;
    room = await seedRoom(homeserver, me);
  });

  test('presets, search and People treat pinned threads alike and count every writer (Chromium)', async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await openRoom(page, room);
    await checkFilters(page, room, 'chromium');
  });

  test('the same on a phone (WebKit)', async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
    test.setTimeout(420_000);
    const browser: Browser = await launchWebKit();
    try {
      const context = await browser.newContext({ ...PHONE, baseURL });
      const page = await context.newPage();
      await openRoom(page, room);
      await checkFilters(page, room, 'webkit');
      await context.close();
    } finally {
      await browser.close();
    }
  });
});
