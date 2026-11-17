import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendReaction,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';

// In a thread, an agent asks a question with options. The backend then titles the thread and
// reviews a skill, two quiet marker rows below the question. The person picks an option with a
// reaction, and the agent's answer replies to the question. Only the marker rows sit between the
// question and the answer, so the answer shows no reply quote: the question is right above it.
// In the room (Classic), the same skill review notice is a full agent message, so there an answer
// past it still quotes its question. Set REPLY_QUOTE_SHOTS=<directory> to save each view.
const PASSWORD = 'reply-quote-past-markers-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.REPLY_QUOTE_SHOTS;

const ROOT = 'Can you tidy up the release notes for this week?';
const QUESTION = 'Which release should I clean up?';
const TITLE = 'Release notes cleanup';
const SKILL = 'release-notes';
const ANSWER =
  'Done: the v3 final notes now group the fixes by area and drop the duplicate entries.';
const OTHER_ROOMS = Array.from({ length: 12 }, (_, index) => `Project room ${index + 1}`);

type Seed = {
  reader: DisposableUser;
  roomId: string;
  rootId: string;
  questionId: string;
  titleId: string;
  reviewId: string;
  answerId: string;
};

const setDisplayName = (session: MatrixSession, displayName: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });

/** Thread fallback relation, as the backend sends its notices: a reply only for older clients. */
const inThread = (rootId: string, previousId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: previousId },
  },
});

/** A genuine reply in the thread. */
const replyInThread = (rootId: string, replyToId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: false,
    'm.in_reply_to': { event_id: replyToId },
  },
});

/** The thread; with `threaded` false, the same messages in the room, without the title. */
const seed = async (name: string, threaded: boolean): Promise<Seed> => {
  const reader = await registerDisposableUser(`rqpm_${name}_${RUN}`, PASSWORD);
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
  await Promise.all(
    OTHER_ROOMS.map((room) =>
      createPrivateRoom(HOMESERVER, reader.accessToken, { name: room, topic: `${room} notes` })
    )
  );
  const send = (session: MatrixSession, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, session.accessToken, roomId, content);
  const notice = (rootId: string, previousId: string) =>
    threaded ? inThread(rootId, previousId) : {};
  const reply = (rootId: string, replyToId: string) =>
    threaded
      ? replyInThread(rootId, replyToId)
      : { 'm.relates_to': { 'm.in_reply_to': { event_id: replyToId } } };

  const rootId = await send(reader, { msgtype: 'm.text', body: ROOT });
  const questionId = await send(agent, {
    msgtype: 'm.text',
    body: `${QUESTION}\n\n1. v3 final\n2. v4 draft\n\nReact with an emoji or type the number to respond.`,
    'io.mindroom.interactive': {
      creator_agent: 'code',
      question_text: QUESTION,
      options: { '✅': 'v3', '📄': 'v4', '1': 'v3', '2': 'v4' },
      option_labels: { '✅': 'v3 final', '📄': 'v4 draft', '1': 'v3 final', '2': 'v4 draft' },
      source_event_id: rootId,
    },
    ...(threaded ? replyInThread(rootId, rootId) : {}),
  });
  const titleId = threaded
    ? await send(agent, {
        msgtype: 'm.notice',
        body: TITLE,
        'io.mindroom.thread_summary': {
          version: 1,
          summary: TITLE,
          generated_at: new Date().toISOString(),
          message_count: 2,
          model: 'test',
        },
        ...inThread(rootId, questionId),
      })
    : questionId;
  const reviewId = await send(agent, {
    msgtype: 'm.notice',
    body: `Updated skill ${SKILL}`,
    'io.mindroom.skill_review': { changes: { [SKILL]: 'updated' } },
    ...notice(rootId, titleId),
  });
  await sendReaction(HOMESERVER, reader.accessToken, roomId, questionId, '✅');
  const answerId = await send(agent, {
    msgtype: 'm.text',
    body: ANSWER,
    ...reply(rootId, questionId),
  });
  return { reader, roomId, rootId, questionId, titleId, reviewId, answerId };
};

const check = async (
  browser: Browser,
  options: BrowserContextOptions,
  baseURL: string | undefined,
  name: string,
  threaded = true
) => {
  const seeded = await seed(threaded ? name : `${name}_room`, threaded);
  const { reader, roomId, rootId, questionId, titleId, reviewId, answerId } = seeded;
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    const viewMode = threaded ? 'threaded' : 'classic';
    await seedRoomOverviewState({ page, roomId, userId: reader.userId, viewMode });
    const thread = threaded ? `?threadId=${encodeURIComponent(rootId)}` : '';
    await page.goto(`/home/${encodeURIComponent(roomId)}/${thread}`);

    const answer = page.locator(`[data-message-id="${answerId}"]`);
    await expect(answer).toContainText(ANSWER, { timeout: 60_000 });
    await answer.scrollIntoViewIfNeeded();
    // The question and both marker rows show above the answer.
    await expect(page.locator(`[data-message-id="${questionId}"]`)).toBeVisible();
    const review = page.locator(`[data-message-id="${reviewId}"]`);
    await expect(review).toBeVisible();
    await expect(review).toContainText(SKILL);
    const quote = answer.locator(`button[data-event-id="${questionId}"]`);
    if (!threaded) {
      // In the room, the skill review is a full agent message: the answer quotes its question.
      await expect(quote).toBeVisible();
      await expect(quote).toContainText(QUESTION);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-room.png` });
      return;
    }
    const title = page.locator(`[data-message-id="${titleId}"]`);
    await expect(title).toBeVisible();
    await expect(title).toContainText(TITLE);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
    // Only marker rows sit between the question and the answer: no quote of the question.
    await expect(quote).toHaveCount(0);
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

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`an answer to a question shows no quote past marker rows (Chromium, ${form})`, async ({
    browser,
    baseURL,
  }) => {
    await check(browser, options, baseURL, `chromium-${form}`);
  });

  test(`in the room, an answer past a skill review quotes its question (Chromium, ${form})`, async ({
    browser,
    baseURL,
  }) => {
    await check(browser, options, baseURL, `chromium-${form}`, false);
  });
}
