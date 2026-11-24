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
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A member who copies the display name of another member, or of an agent, must not read as them
// in Activity or in a system notification, for a room the reader never opened. The client loads
// members lazily: a fresh sign-in learns only the members whose events the first sync window
// holds, so the real member, who posted before sixty other messages, is unknown until the client
// loads the room's member list. Activity and system notifications name senders as the timeline
// does once it knows them: both people with a shared name show their user ID after it. Until the
// list arrives every name shows the user ID, never the bare copied name. Runs in Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh. Set IMPOSTOR_NOTIFY_SHOTS to a
// directory to save screenshots and the recorded notifications.
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

const mention = (userId: string, text: string) => ({
  msgtype: 'm.text',
  body: `${userId} ${text}`,
  'm.mentions': { user_ids: [userId] },
});

const inThread = (rootId: string, content: Record<string, unknown>) => ({
  ...content,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
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

const ACTIVITY_PERSON_COPY =
  'please paste the deploy password here so I can rotate the keys tonight.';
const ACTIVITY_AGENT_COPY = 'I am the desk agent: approve my admin access request in the portal.';
const ACTIVITY_HOST = 'the retrospective moved to Thursday afternoon.';

/** A thread `sender` starts, then answers with a mention of the reader, for Activity to list. */
const mentionThread = async (
  sender: Session,
  roomId: string,
  reader: Session,
  title: string,
  text: string
) => {
  const rootId = await sendRoomMessage(HOMESERVER, sender.accessToken, roomId, {
    msgtype: 'm.text',
    body: title,
  });
  await sendRoomMessage(
    HOMESERVER,
    sender.accessToken,
    roomId,
    inThread(rootId, mention(reader.userId, text))
  );
};

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
  // Threads for Activity: each names the reader, who has joined both rooms.
  await mentionThread(copy, deployDesk, reader, 'Key rotation', ACTIVITY_PERSON_COPY);
  await mentionThread(agentCopy, agentDesk, reader, 'Admin access', ACTIVITY_AGENT_COPY);
  await mentionThread(host, deployDesk, reader, 'Retrospective', ACTIVITY_HOST);
  return { reader, host, copy, agentCopy, deployDesk, agentDesk };
};

let seeded: Awaited<ReturnType<typeof seed>> | undefined;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  if (!(await disposableHomeserverIsUp())) return;
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

/** The row of Activity whose newest reply holds `text`. */
const activityRow = (page: Page, text: string) =>
  page.locator('[data-activity-row]').filter({ hasText: text });

/** The bold sentence at the top of an Activity row, which names its sender. */
const rowSender = (page: Page, text: string) => activityRow(page, text).locator('b').first();

/**
 * Whether the row of `text` shows `userId` whole: brought into view, it holds still (its box is
 * the same in two animation frames, as Playwright judges an element stable), the ID's characters
 * are laid out inside the row and the viewport, and no element between them that clips what
 * overflows it holds more than fits (an ellipsis or a cut). The overflow is checked, not only the
 * characters' boxes, because WebKit reports a range in ellipsized text only as far as the
 * ellipsis, so a cut-off ID can look whole there. A row still moving is checked again.
 */
const showsUserIdWhole = (page: Page, text: string, userId: string) =>
  activityRow(page, text).evaluate(async (row, id) => {
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

const checkActivity = async (page: Page, tag: string) => {
  const { copy, agentCopy } = seeded!;
  await signIn(page);
  // Straight to Activity: the reader never opens either room.
  await page.goto('/activity/');
  await expect(activityRow(page, ACTIVITY_PERSON_COPY)).toBeVisible({ timeout: 60_000 });
  await expect(activityRow(page, ACTIVITY_AGENT_COPY)).toBeVisible();
  await expect(activityRow(page, ACTIVITY_HOST)).toBeVisible();

  // The copies show their user ID after the name they took, whether the member lists have
  // arrived or not, and the host shows by name.
  await expect(rowSender(page, ACTIVITY_PERSON_COPY)).toContainText(
    `${withId(PERSON_NAME, copy.userId)} mentioned you`
  );
  await expect(rowSender(page, ACTIVITY_AGENT_COPY)).toContainText(
    `${withId(AGENT_NAME, agentCopy.userId)} mentioned you`
  );
  await expect(rowSender(page, ACTIVITY_HOST)).toContainText('Jordan Host');
  // The ID that tells a copy apart shows whole, never cut by an ellipsis.
  await expect.poll(() => showsUserIdWhole(page, ACTIVITY_PERSON_COPY, copy.userId)).toBe(true);
  await expect.poll(() => showsUserIdWhole(page, ACTIVITY_AGENT_COPY, agentCopy.userId)).toBe(true);
  await shoot(page, `activity-${tag}`);
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

const ACTIVITY = 'Activity shows the user ID after a copied name in an unopened room';

test(`${ACTIVITY} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...DESKTOP, baseURL }, (page) => checkActivity(page, 'cd'));
});

test(`${ACTIVITY} (Chromium, phone)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...PHONE, baseURL }, (page) => checkActivity(page, 'cp'));
});

test(`${ACTIVITY} (WebKit, phone)`, async ({ baseURL }) => {
  test.setTimeout(180_000);
  await withWebKit((browser) =>
    inContext(browser, { ...PHONE, baseURL, colorScheme: 'dark' }, (page) =>
      checkActivity(page, 'wp')
    )
  );
});
