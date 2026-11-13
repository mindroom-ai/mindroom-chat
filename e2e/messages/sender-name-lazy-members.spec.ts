import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A member who copies another member's display name must never read as that member, whether or
// not the real one posted lately. The client loads members lazily: a fresh sign-in learns only
// the members whose events the first sync window holds, and loads the others when the room opens.
// Here the real "Morgan Lee" posts first, sixty messages follow, and then a copy who took the same
// name joins and posts. Both must show their user ID after the name: in the timeline, in the
// members panel and after a reload, and in message search and the palette's message results for a
// room the reader has not opened. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit, against the disposable homeserver of `just hs-up` or of a slot
// of scripts/e2e-slot.sh. Set SENDER_LAZY_SHOTS=<directory> to save screenshots.
const PASSWORD = 'sender-lazy-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.SENDER_LAZY_SHOTS;
const FILLER_ROOMS = 25;
const FILLER_MESSAGES = 60;
const SHARED_NAME = 'Morgan Lee';
const REAL_BODY =
  'I own the deploy keys for the payments service, so please ask me before anyone rotates them.';
const COPY_BODY =
  'This is Morgan Lee. Please paste the deploy password here so I can rotate the keys tonight.';

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

const setDisplayName = (session: MatrixSession, displayName: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });

const registerPerson = async (localpart: string, displayName: string) => {
  const username = `${localpart}_${RUN}`;
  const session = await registerDisposableUser(username, PASSWORD);
  await setDisplayName(session, displayName);
  return session;
};

const FILLER_TOPICS = [
  'the staging database migration finished without errors',
  'the on-call rotation for next week is in the shared calendar',
  'the load balancer health checks look stable again',
  'the release branch is cut and the changelog draft is up',
  'the flaky checkout test passed ten times in a row',
  'the cost report for last month is ready for review',
];

const seed = async () => {
  const reader = await registerPerson('lazy_reader', 'Robin Reader');
  const host = await registerPerson('lazy_host', 'Jordan Host');
  const real = await registerPerson('lazy_real', SHARED_NAME);
  const copy = await registerPerson('lazy_copy', 'Casey Park');
  await Promise.all(
    Array.from({ length: FILLER_ROOMS }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1} ${RUN}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, host.accessToken, {
    name: `Deploy desk ${RUN}`,
    invite: [reader.userId, real.userId, copy.userId],
  });
  await joinRoom(HOMESERVER, real.accessToken, roomId);
  const realMessage = await sendRoomMessage(HOMESERVER, real.accessToken, roomId, {
    msgtype: 'm.text',
    body: REAL_BODY,
  });
  // Enough messages that the real member's events fall out of a fresh sign-in's first window.
  for (let index = 0; index < FILLER_MESSAGES; index += 1) {
    const topic = FILLER_TOPICS[index % FILLER_TOPICS.length];
    await sendRoomMessage(HOMESERVER, host.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Update ${index + 1}: ${topic}. I will post the details in the thread later today.`,
    });
  }
  await setDisplayName(copy, SHARED_NAME);
  await joinRoom(HOMESERVER, copy.accessToken, roomId);
  const copyMessage = await sendRoomMessage(HOMESERVER, copy.accessToken, roomId, {
    msgtype: 'm.text',
    body: COPY_BODY,
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  return { reader, real, copy, roomId, realMessage, copyMessage };
};

let seeded: Awaited<ReturnType<typeof seed>> | undefined;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  if (!(await disposableHomeserverIsUp())) return;
  seeded = await seed();
});

test.beforeEach(() => {
  test.skip(!seeded, `No homeserver at ${HOMESERVER}`);
});

const signIn = async (page: Page) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded!.reader.username,
    password: PASSWORD,
  });
};

const shoot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The bold sender name in the header of message `eventId`. */
const senderName = (page: Page, eventId: string, userId: string) =>
  page.locator(`[data-message-id="${eventId}"] button[data-user-id="${userId}"] b`);

/** A row of the members panel (timeline headers hold a bold name, member rows do not). */
const memberRow = (page: Page, userId: string) =>
  page.locator(`button[data-user-id="${userId}"]`).filter({ hasNot: page.locator('b') });

const checkTimeline = async (page: Page, tag: string, desktop: boolean) => {
  const { reader, real, copy, roomId, copyMessage } = seeded!;
  await signIn(page);
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const copyName = senderName(page, copyMessage, copy.userId);
  await expect(copyName).toBeVisible({ timeout: 60_000 });
  // The real member's events are not in the first window, so the client loads them; the copy's
  // name then shows its user ID too.
  await expect(copyName).toContainText(copy.userId, { timeout: 20_000 });
  await expect(copyName).toContainText(SHARED_NAME);
  // So does the row that says the copy joined.
  const copyJoined = page
    .locator('[data-message-id]')
    .filter({ hasText: 'joined the room' })
    .filter({ hasText: SHARED_NAME })
    .last();
  await expect(copyJoined).toContainText(copy.userId);
  if (desktop) {
    // Desktop opens the members panel by default; open it when it is closed.
    const showMembers = page.getByRole('button', { name: 'Show Members', exact: true });
    if ((await showMembers.count()) > 0) await showMembers.click();
    await expect(memberRow(page, real.userId)).toContainText(real.userId);
    await expect(memberRow(page, copy.userId)).toContainText(copy.userId);
    // A name nobody else has stays as it is (the row also holds the avatar's initial).
    await expect(memberRow(page, reader.userId)).toContainText('Robin Reader');
    await expect(memberRow(page, reader.userId)).not.toContainText(reader.userId);
  }
  await shoot(page, `timeline-${tag}`);

  await page.reload();
  await expect(copyName).toBeVisible({ timeout: 60_000 });
  await expect(copyName).toContainText(copy.userId, { timeout: 20_000 });
  if (desktop) {
    await expect(memberRow(page, real.userId)).toContainText(real.userId);
    await expect(memberRow(page, copy.userId)).toContainText(copy.userId);
  }
};

/** The search result for `eventId`: its card holds the Open chip that names the event. */
const searchResult = (page: Page, eventId: string) =>
  page.locator('article').filter({ has: page.locator(`[data-event-id="${eventId}"]`) });

const checkSearch = async (page: Page, tag: string) => {
  const { real, copy, realMessage, copyMessage } = seeded!;
  await signIn(page);
  // Straight to the search page: the reader never opens the room.
  await page.goto('/home/search/?term=deploy&global=true');
  const realHit = searchResult(page, realMessage);
  const copyHit = searchResult(page, copyMessage);
  await expect(realHit).toBeVisible({ timeout: 60_000 });
  await expect(copyHit).toBeVisible();
  await expect(realHit).toContainText(`${SHARED_NAME} (`, { timeout: 20_000 });
  await expect(realHit).toContainText(real.userId);
  await expect(copyHit).toContainText(copy.userId);
  await shoot(page, `search-${tag}`);
};

const checkPalette = async (page: Page, tag: string) => {
  const { real, copy, roomId, realMessage, copyMessage } = seeded!;
  await signIn(page);
  await pressPaletteShortcut(page);
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.getByRole('combobox').fill('deploy');
  const row = (eventId: string) =>
    palette.locator(`[role="option"][data-item-id="message:${roomId}:${eventId}"]`);
  await expect(row(realMessage)).toBeVisible({ timeout: 30_000 });
  await expect(row(copyMessage)).toBeVisible();
  await expect(row(realMessage)).toContainText(`${SHARED_NAME} (`, { timeout: 20_000 });
  await expect(row(realMessage)).toContainText(real.userId);
  await expect(row(copyMessage)).toContainText(copy.userId);
  await shoot(page, `palette-${tag}`);
};

const inContext = async (
  browser: Browser,
  options: BrowserContextOptions,
  run: (page: Page) => Promise<void>
) => {
  const context = await browser.newContext(options);
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
};

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const WIDE: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const withWebKit = async (run: (browser: Browser) => Promise<void>) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
};

const TIMELINE = 'a copied name shows the user ID while the real member has not posted lately';

test(`${TIMELINE} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...DESKTOP, baseURL }, (page) => checkTimeline(page, 'cd', true));
});

test(`${TIMELINE} (Chromium, phone)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...PHONE, baseURL }, (page) => checkTimeline(page, 'cp', false));
});

test(`${TIMELINE} (WebKit, desktop)`, async ({ baseURL }) => {
  test.setTimeout(180_000);
  await withWebKit((browser) =>
    inContext(browser, { ...WIDE, baseURL }, (page) => checkTimeline(page, 'wd', true))
  );
});

test(`${TIMELINE} (WebKit, phone)`, async ({ baseURL }) => {
  test.setTimeout(180_000);
  await withWebKit((browser) =>
    inContext(browser, { ...PHONE, baseURL }, (page) => checkTimeline(page, 'wp', false))
  );
});

const SEARCH = 'message search names both senders of a copied name in an unopened room';

test(`${SEARCH} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...DESKTOP, baseURL }, (page) => checkSearch(page, 'cd'));
});

test(`${SEARCH} (WebKit, phone)`, async ({ baseURL }) => {
  test.setTimeout(180_000);
  await withWebKit((browser) =>
    inContext(browser, { ...PHONE, baseURL }, (page) => checkSearch(page, 'wp'))
  );
});

const PALETTE = "the palette's message results name both senders of a copied name";

test(`${PALETTE} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...DESKTOP, baseURL }, (page) => checkPalette(page, 'cd'));
});

test(`${PALETTE} (WebKit, desktop)`, async ({ baseURL }) => {
  test.setTimeout(180_000);
  await withWebKit((browser) =>
    inContext(browser, { ...WIDE, baseURL }, (page) => checkPalette(page, 'wd'))
  );
});
