import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// In a thread, an agent answers, then the backend titles the thread and reviews a skill: two quiet
// marker rows at the bottom. They show side by side on one line, each keeping its own message ID;
// on a phone the long skill name ends in an ellipsis instead of wrapping. A third marker goes to
// a second line there rather than squeezing all three.
// Set QUIET_MARKER_SHOTS=<directory> to save each view.
const PASSWORD = 'quiet-markers-side-by-side-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.QUIET_MARKER_SHOTS;

const ROOT = 'Can you tidy up the release notes for this week?';
const ANSWER =
  'Done: the v3 final notes now group the fixes by area and drop the duplicate entries.';
const TITLE = 'Release notes cleanup';
const SKILL = 'developing-mindroom-chat';
const OTHER_SKILL = 'developing-mindroom-backend';

const setDisplayName = (session: MatrixSession, displayName: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });

/** Thread fallback relation, as the backend sends its messages: a reply only for older clients. */
const inThread = (rootId: string, previousId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: previousId },
  },
});

const seed = async (name: string, skills: readonly string[] = [SKILL]) => {
  const reader = await registerDisposableUser(`qmsbs_${name}_${RUN}`, PASSWORD);
  await setDisplayName(reader, 'Sam Lee');
  // A `mindroom_` account on the reader's server: only its notices become marker rows.
  const agent = await registerAgentAccount(HOMESERVER, `code_${name}`);
  await setDisplayName(agent, 'Code');
  const roomId = await createPrivateRoom(HOMESERVER, reader.accessToken, {
    name: 'Release planning',
    topic: 'Release notes and changelogs',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const send = (session: MatrixSession, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, session.accessToken, roomId, content);

  const rootId = await send(reader, { msgtype: 'm.text', body: ROOT });
  const answerId = await send(agent, {
    msgtype: 'm.text',
    body: ANSWER,
    ...inThread(rootId, rootId),
  });
  const titleId = await send(agent, {
    msgtype: 'm.notice',
    body: TITLE,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: TITLE,
      generated_at: new Date().toISOString(),
      message_count: 2,
      model: 'test',
    },
    ...inThread(rootId, answerId),
  });
  const reviewIds: string[] = [];
  for (const skill of skills) {
    reviewIds.push(
      await send(agent, {
        msgtype: 'm.notice',
        body: `Updated skill ${skill}`,
        'io.mindroom.skill_review': { changes: { [skill]: 'updated' } },
        ...inThread(rootId, reviewIds.at(-1) ?? titleId),
      })
    );
  }
  return { reader, roomId, rootId, answerId, titleId, reviewIds };
};

/** Opens the seeded thread and waits for its markers. */
const openThread = async (
  browser: Browser,
  options: BrowserContextOptions,
  baseURL: string | undefined,
  seeded: Awaited<ReturnType<typeof seed>>
) => {
  const { reader, roomId, rootId, answerId, titleId } = seeded;
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({ page, roomId, userId: reader.userId, viewMode: 'threaded' });
  await page.goto(`/home/${encodeURIComponent(roomId)}/?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.locator(`[data-message-id="${answerId}"]`)).toContainText(ANSWER, {
    timeout: 60_000,
  });
  await expect(page.locator(`[data-message-id="${titleId}"]`)).toContainText(TITLE);
  return { context, page };
};

const check = async (
  browser: Browser,
  options: BrowserContextOptions,
  baseURL: string | undefined,
  name: string,
  shortened: boolean
) => {
  const seeded = await seed(name);
  const { titleId } = seeded;
  const [reviewId] = seeded.reviewIds;
  const { context, page } = await openThread(browser, options, baseURL, seeded);
  try {
    const title = page.locator(`[data-message-id="${titleId}"]`);
    const review = page.locator(`[data-message-id="${reviewId}"]`);
    await expect(review).toContainText(SKILL);
    // Both markers sit in one run row.
    const run = page.locator('[data-quiet-marker-run]');
    await expect(run).toHaveCount(1);
    await expect(run.locator(`[data-message-id="${titleId}"]`)).toHaveCount(1);
    await expect(run.locator(`[data-message-id="${reviewId}"]`)).toHaveCount(1);
    const [titleBox, reviewBox] = await Promise.all([title.boundingBox(), review.boundingBox()]);
    expect(titleBox && reviewBox).toBeTruthy();
    expect(Math.abs(titleBox!.y - reviewBox!.y)).toBeLessThan(1);
    // One line each: the skill name's code font may add a pixel, a second line would add ~18.
    expect(Math.abs(titleBox!.height - reviewBox!.height)).toBeLessThan(4);
    expect(reviewBox!.x).toBeGreaterThan(titleBox!.x + titleBox!.width);
    expect(reviewBox!.x + reviewBox!.width).toBeLessThanOrEqual(options.viewport!.width);
    // The skill name ends in an ellipsis only where the line is too short for it.
    const label = review.locator('[data-skill-review] button > span');
    const cut = await label.evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(cut).toBe(shortened);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } finally {
    await context.close();
  }
};

/** A title and two skill reviews on a phone: two lines, each marker keeping its fixed words. */
const checkThree = async (
  browser: Browser,
  options: BrowserContextOptions,
  baseURL: string | undefined,
  name: string
) => {
  const seeded = await seed(name, [SKILL, OTHER_SKILL]);
  const { context, page } = await openThread(browser, options, baseURL, seeded);
  try {
    const ids = [seeded.titleId, ...seeded.reviewIds];
    const markers = ids.map((id) => page.locator(`[data-message-id="${id}"]`));
    await expect(markers[2]!).toContainText(OTHER_SKILL.slice(0, 6));
    const run = page.locator('[data-quiet-marker-run]');
    await expect(run).toHaveCount(1);
    await expect(run.locator('[data-message-id]')).toHaveCount(3);
    const boxes = await Promise.all(markers.map((marker) => marker.boundingBox()));
    const tops = boxes.map((box) => Math.round(box!.y));
    // The title and the first review share the first line; the second review is on the next.
    expect(Math.abs(tops[0]! - tops[1]!)).toBeLessThan(1);
    expect(tops[2]!).toBeGreaterThan(tops[1]! + 10);
    for (const box of boxes) {
      expect(box!.x + box!.width).toBeLessThanOrEqual(options.viewport!.width);
    }
    // A review is never narrower than its icon and fixed words: its skill name starts inside it.
    for (const review of markers.slice(1)) {
      const room = await review.evaluate((node) => {
        const code = node.querySelector('code');
        const marker = node.getBoundingClientRect();
        return code ? marker.right - code.getBoundingClientRect().left : -1;
      });
      expect(room).toBeGreaterThan(0);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  } finally {
    await context.close();
  }
};

const DESKTOP: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
  colorScheme: 'light',
};
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  colorScheme: 'dark',
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeAll(() => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(180_000);
});

test('a title and a skill review notice share one row (Chromium, desktop)', async ({
  browser,
  baseURL,
}) => {
  await check(browser, DESKTOP, baseURL, 'desktop', false);
});

test('a title and a skill review notice share one row (Chromium, phone)', async ({
  browser,
  baseURL,
}) => {
  await check(browser, PHONE, baseURL, 'phone', true);
});

test('a title and two skill reviews take two lines (Chromium, phone)', async ({
  browser,
  baseURL,
}) => {
  await checkThree(browser, PHONE, baseURL, 'phone-3');
});
