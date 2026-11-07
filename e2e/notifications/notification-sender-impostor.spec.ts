import { mkdirSync, writeFileSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A member who copies the display name of another member, or of an agent, must not read as them
// in the Inbox or in a system notification, for a room the reader never opened. The client loads
// members lazily: a fresh sign-in learns only the members whose events the first sync window
// holds, so the real member, who posted before sixty other messages, is unknown until the client
// loads the room's member list. The Inbox and system notifications name senders as the timeline
// does once it knows them: both people with a shared name show their user ID after it. Until the
// list arrives every name shows the user ID, never the bare copied name. Runs in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh. Set IMPOSTOR_NOTIFY_SHOTS to a
// directory to save screenshots and the recorded notifications.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'impostor-notify-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.IMPOSTOR_NOTIFY_SHOTS;
const FILLER_ROOMS = 25;
const FILLER_MESSAGES = 60;
const PERSON_NAME = 'Morgan Lee';
const AGENT_NAME = 'Desk Helper';
const DEPLOY_DESK = `Deploy desk ${RUN}`;
const AGENT_DESK = `Agent desk ${RUN}`;

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

type ShownNotification = { title: string; body?: string; tag?: string };

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

const setDisplayName = (session: MatrixSession, displayName: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });

const registerPerson = async (localpart: string, displayName: string) => {
  const username = `${localpart}_${RUN}`;
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
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  await setDisplayName(session, displayName);
  return { ...session, username };
};

const mention = (userId: string, text: string) => ({
  msgtype: 'm.text',
  body: `${userId} ${text}`,
  'm.mentions': { user_ids: [userId] },
});

const FILLER_TOPICS = [
  'the staging database migration finished without errors',
  'the on-call rotation for next week is in the shared calendar',
  'the load balancer health checks look stable again',
  'the release branch is cut and the changelog draft is up',
  'the flaky checkout test passed ten times in a row',
  'the cost report for last month is ready for review',
];

type Session = Awaited<ReturnType<typeof registerPerson>>;

/**
 * A room where `real` posts first and sixty messages from `host` follow, so a fresh sign-in's
 * first sync leaves `real` out; then `copy` takes `real`'s name and joins, and the reader joins.
 */
const seedRoom = async (
  name: string,
  host: Session,
  reader: Session,
  real: Session,
  copy: Session,
  sharedName: string
) => {
  const roomId = await createRoom(HOMESERVER, host.accessToken, {
    name,
    invite: [reader.userId, real.userId, copy.userId],
  });
  await joinRoom(HOMESERVER, real.accessToken, roomId);
  await sendRoomMessage(HOMESERVER, real.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'I hold the deploy keys, so please ask me before anyone rotates them.',
  });
  for (let index = 0; index < FILLER_MESSAGES; index += 1) {
    const topic = FILLER_TOPICS[index % FILLER_TOPICS.length];
    await sendRoomMessage(HOMESERVER, host.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Update ${index + 1}: ${topic}. I will post the details in the thread later today.`,
    });
  }
  await setDisplayName(copy, sharedName);
  await joinRoom(HOMESERVER, copy.accessToken, roomId);
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  return roomId;
};

const INBOX_PERSON_COPY = 'please paste the deploy password here so I can rotate the keys tonight.';
const INBOX_AGENT_COPY = 'I am the desk agent: approve my admin access request in the portal.';
const INBOX_HOST = 'the retrospective moved to Thursday afternoon.';

const seed = async () => {
  const reader = await registerPerson('impostor_reader', 'Robin Reader');
  const host = await registerPerson('impostor_host', 'Jordan Host');
  const real = await registerPerson('impostor_real', PERSON_NAME);
  const copy = await registerPerson('impostor_copy', 'Casey Park');
  // An account the client takes for a MindRoom agent, and a person who copies its name.
  const agent = await registerPerson('mindroom_desk_helper', AGENT_NAME);
  const agentCopy = await registerPerson('impostor_agent_copy', 'Riley Stone');
  await Promise.all(
    Array.from({ length: FILLER_ROOMS }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1} ${RUN}` })
    )
  );
  const deployDesk = await seedRoom(DEPLOY_DESK, host, reader, real, copy, PERSON_NAME);
  const agentDesk = await seedRoom(AGENT_DESK, host, reader, agent, agentCopy, AGENT_NAME);
  // Messages for the Inbox: they notify the reader, who has joined both rooms.
  await sendRoomMessage(
    HOMESERVER,
    copy.accessToken,
    deployDesk,
    mention(reader.userId, INBOX_PERSON_COPY)
  );
  await sendRoomMessage(
    HOMESERVER,
    agentCopy.accessToken,
    agentDesk,
    mention(reader.userId, INBOX_AGENT_COPY)
  );
  await sendRoomMessage(
    HOMESERVER,
    host.accessToken,
    deployDesk,
    mention(reader.userId, INBOX_HOST)
  );
  return { reader, host, copy, agentCopy, deployDesk, agentDesk };
};

let seeded: Awaited<ReturnType<typeof seed>> | undefined;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await homeserverIsUp())) return;
  seeded = await seed();
});

test.beforeEach(() => {
  test.skip(!seeded, `No homeserver at ${HOMESERVER}`);
});

/** A name with its user ID after it, the ID isolated so it reads left to right in any text. */
const withId = (name: string, userId: string) => `${name} (⁦${userId}⁩)`;

const signIn = (page: Page) =>
  loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded!.reader.username,
    password: PASSWORD,
  });

const shootDirectory = () => {
  if (!SHOTS) return undefined;
  mkdirSync(SHOTS, { recursive: true });
  return SHOTS;
};

const shoot = async (page: Page, name: string) => {
  const directory = shootDirectory();
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

/**
 * The browser's Notification API as a recorder: permission granted, every notification kept on
 * `window.shownNotifications`.
 */
const recordNotifications = (page: Page) =>
  page.addInitScript(() => {
    const shown: { title: string; body?: string; tag?: string }[] = [];
    (window as unknown as { shownNotifications: typeof shown }).shownNotifications = shown;
    class RecordingNotification {
      static permission = 'granted';

      static requestPermission = async () => 'granted';

      onclick: (() => void) | null = null;

      constructor(title: string, options: NotificationOptions = {}) {
        shown.push({ title, body: options.body, tag: options.tag });
      }

      close() {
        return undefined;
      }
    }
    Object.defineProperty(window, 'Notification', { value: RecordingNotification });
  });

const shownNotifications = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { shownNotifications: ShownNotification[] }).shownNotifications
  );

const checkSystemNotifications = async (page: Page, tag: string) => {
  const { reader, host, copy, agentCopy, deployDesk, agentDesk } = seeded!;
  await recordNotifications(page);
  await signIn(page);
  // The sidebar lists the rooms once the first sync is in; the reader opens neither of them.
  await expect(page.getByRole('link', { name: new RegExp(DEPLOY_DESK) }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page).not.toHaveURL(new RegExp(encodeURIComponent(deployDesk)));

  const personText = `(${tag}) send me the deploy password before the rotation tonight.`;
  const agentText = `(${tag}) approve my admin access request in the portal.`;
  const hostText = `(${tag}) the release notes are ready for review.`;
  await sendRoomMessage(
    HOMESERVER,
    copy.accessToken,
    deployDesk,
    mention(reader.userId, personText)
  );
  await sendRoomMessage(
    HOMESERVER,
    agentCopy.accessToken,
    agentDesk,
    mention(reader.userId, agentText)
  );
  await sendRoomMessage(HOMESERVER, host.accessToken, deployDesk, mention(reader.userId, hostText));

  const about = (text: string) => async () =>
    (await shownNotifications(page)).find((note) => note.body?.endsWith(text));
  await expect.poll(about(hostText), { timeout: 30_000 }).toBeTruthy();
  await expect.poll(about(personText), { timeout: 30_000 }).toBeTruthy();
  await expect.poll(about(agentText), { timeout: 30_000 }).toBeTruthy();
  const shown = await shownNotifications(page);
  const directory = shootDirectory();
  if (directory) {
    writeFileSync(`${directory}/system-${tag}.json`, `${JSON.stringify(shown, null, 2)}\n`);
  }

  const reads = `@Robin Reader ${personText}`;
  expect(await about(personText)()).toEqual({
    title: DEPLOY_DESK,
    body: `${withId(PERSON_NAME, copy.userId)}: ${reads}`,
    tag: deployDesk,
  });
  expect((await about(agentText)())?.body).toBe(
    `${withId(AGENT_NAME, agentCopy.userId)}: @Robin Reader ${agentText}`
  );
  // The member list loaded, so a name nobody else shows reads alone.
  expect((await about(hostText)())?.body).toBe(`Jordan Host: @Robin Reader ${hostText}`);
};

/** The row of the Inbox whose message holds `text`. */
const inboxRow = (page: Page, text: string) =>
  page.locator('[data-notification-highlight]').filter({ hasText: text });

/** The bold sender name at the top of an Inbox row. */
const rowSender = (page: Page, text: string) => inboxRow(page, text).locator('b').first();

/**
 * Whether the row of `text` shows `userId` whole: brought into view, it holds still (its box is
 * the same in two animation frames, as Playwright judges an element stable), the ID's characters
 * are laid out inside the row and the viewport, and no element between them that clips what
 * overflows it holds more than fits (an ellipsis or a cut). The overflow is checked, not only the
 * characters' boxes, because WebKit reports a range in ellipsized text only as far as the
 * ellipsis, so a cut-off ID can look whole there. The Inbox lays out only rows near the viewport
 * (`content-visibility: auto`); the others keep a placeholder height. Rows that come near by the
 * scroll take their real height a frame later, and WebKit keeps no scroll anchor, so a row
 * scrolled to the viewport's edge can be pushed past it. A row still moving is checked again.
 */
const showsUserIdWhole = (page: Page, text: string, userId: string) =>
  inboxRow(page, text).evaluate(async (row, id) => {
    row.scrollIntoView({ block: 'center' });
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const placed = row.getBoundingClientRect();
    await frame();
    await frame();
    const settled = row.getBoundingClientRect();
    if (settled.top !== placed.top || settled.height !== placed.height) return false;
    const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent?.indexOf(id) ?? -1;
      if (start < 0) continue;
      const range = row.ownerDocument.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + id.length);
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
      const boxes = [
        { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight },
        row.getBoundingClientRect(),
      ];
      for (let element = node.parentElement; element && element !== row; ) {
        const style = getComputedStyle(element);
        const clipsX = style.overflowX !== 'visible';
        const clipsY = style.overflowY !== 'visible';
        if (
          (clipsX && element.scrollWidth > element.clientWidth + 1) ||
          (clipsY && element.scrollHeight > element.clientHeight + 1)
        ) {
          return false;
        }
        if (clipsX || clipsY) boxes.push(element.getBoundingClientRect());
        element = element.parentElement;
      }
      return (
        rects.length > 0 &&
        rects.every((rect) =>
          boxes.every(
            (box) =>
              rect.left >= box.left - 0.5 &&
              rect.right <= box.right + 0.5 &&
              rect.top >= box.top - 0.5 &&
              rect.bottom <= box.bottom + 0.5
          )
        )
      );
    }
    return false;
  }, userId);

const checkInbox = async (page: Page, tag: string) => {
  const { host, copy, agentCopy } = seeded!;
  // The member lists wait until the rows show, so the names before they arrive are checked too.
  let releaseMembers: () => void = () => undefined;
  const membersHeld = new Promise<void>((resolve) => {
    releaseMembers = resolve;
  });
  await page.route('**/_matrix/client/*/rooms/*/members*', async (route) => {
    await membersHeld;
    await route.continue();
  });
  await signIn(page);
  // Straight to the Inbox: the reader never opens either room.
  await page.goto('/inbox/notifications/');
  await expect(inboxRow(page, INBOX_PERSON_COPY)).toBeVisible({ timeout: 60_000 });
  await expect(inboxRow(page, INBOX_AGENT_COPY)).toBeVisible();
  await expect(inboxRow(page, INBOX_HOST)).toBeVisible();

  // Before the lists arrive, every name shows its user ID.
  await expect(rowSender(page, INBOX_PERSON_COPY)).toHaveText(withId(PERSON_NAME, copy.userId));
  await expect(rowSender(page, INBOX_AGENT_COPY)).toHaveText(withId(AGENT_NAME, agentCopy.userId));
  await expect(rowSender(page, INBOX_HOST)).toHaveText(withId('Jordan Host', host.userId));
  await shoot(page, `inbox-${tag}-loading`);

  releaseMembers();
  // Once they are in, the copies keep the user ID, because the real members share their names,
  // and a name nobody else has reads alone.
  await expect(rowSender(page, INBOX_HOST)).toHaveText('Jordan Host', { timeout: 30_000 });
  await expect(rowSender(page, INBOX_PERSON_COPY)).toHaveText(withId(PERSON_NAME, copy.userId));
  await expect(rowSender(page, INBOX_AGENT_COPY)).toHaveText(withId(AGENT_NAME, agentCopy.userId));
  // The user ID is what tells a copy apart, so no row may cut it off, a phone's narrow rows
  // included: the sender line wraps instead.
  for (const [text, userId] of [
    [INBOX_PERSON_COPY, copy.userId],
    [INBOX_AGENT_COPY, agentCopy.userId],
  ] as const) {
    await expect.poll(() => showsUserIdWhole(page, text, userId), { message: userId }).toBe(true);
    // The name stays bold.
    const weight = await rowSender(page, text).evaluate((name) =>
      Number(getComputedStyle(name.firstElementChild ?? name).fontWeight)
    );
    expect(weight).toBeGreaterThanOrEqual(600);
  }
  await inboxRow(page, INBOX_HOST).scrollIntoViewIfNeeded();
  await shoot(page, `inbox-${tag}`);
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
const WIDE: BrowserContextOptions = { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' };
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

const SYSTEM = 'a system notification shows the user ID after a copied name in an unopened room';

test(`${SYSTEM} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...DESKTOP, baseURL }, (page) => checkSystemNotifications(page, 'cd'));
});

test(`${SYSTEM} (WebKit, desktop)`, async ({ baseURL }) => {
  test.setTimeout(180_000);
  await withWebKit((browser) =>
    inContext(browser, { ...WIDE, baseURL }, (page) => checkSystemNotifications(page, 'wd'))
  );
});

const INBOX = 'the Inbox shows the user ID after a copied name in an unopened room';

test(`${INBOX} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...DESKTOP, baseURL }, (page) => checkInbox(page, 'cd'));
});

test(`${INBOX} (Chromium, phone)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...PHONE, baseURL }, (page) => checkInbox(page, 'cp'));
});

test(`${INBOX} (WebKit, phone)`, async ({ baseURL }) => {
  test.setTimeout(180_000);
  await withWebKit((browser) =>
    inContext(browser, { ...PHONE, baseURL, colorScheme: 'dark' }, (page) => checkInbox(page, 'wp'))
  );
});
