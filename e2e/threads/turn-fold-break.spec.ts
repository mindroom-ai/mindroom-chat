import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
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
  type DisposableUser,
} from '../helpers/disposableAccounts';

// A person asks in a thread; the agent posts five progress messages and then its answer. That
// finished turn folds its five messages behind a break ("5 earlier messages"), which shows them
// on a click and folds them again from "Hide 5 messages". The person asks again, and the agent's
// second turn still streams: it shows every message and no break. A run's reply answers its turn
// though the run posted a caption and two images after it: they stay in view under the reply.
// Set TURN_FOLD_SHOTS=<directory> to save each state.
const PASSWORD = 'turn-fold-break-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.TURN_FOLD_SHOTS;

const QUESTION = 'Can you check why the nightly export job got slower this week?';
const PROGRESS = [
  'Looking at the export job logs from the last seven nights.',
  'The run time went from 12 to 41 minutes on Tuesday.',
  'Tuesday is when the archive table passed two million rows.',
  'The export query scans the whole archive table: it has no index on the date column.',
  'Trying the query with a date index on a copy of the table.',
];
const ANSWER =
  'Found it: the export scans the whole archive table. With an index on its date column the job ' +
  'takes 11 minutes again. Want me to add the index in a migration?';
const FOLLOW_UP = 'Yes, add the index, and check the other nightly jobs too.';
const WORKING = [
  'Writing the migration for the date index.',
  'The migration runs in 3 seconds on the copy.',
  'Now checking the other nightly jobs',
];

const REQUEST = 'Can you write up a summary of the change?';
const DRAFT = 'First draft of the summary';
const NOTE = 'Checking the draft against the diff.';
const SUMMARY = 'Final summary of the change';
const CAPTION = 'Before and after:';
// A run's finished reply carries its metadata, as getAiRunInfo reads it; what the run posts as it
// works (a caption, an upload) carries neither.
const AI_RUN = {
  'io.mindroom.stream_status': 'completed',
  'io.mindroom.ai_run': {
    version: 1,
    status: 'completed',
    usage: { input_tokens: 1200, output_tokens: 80 },
  },
};
// A 1x1 PNG; its event's `info` says 120x80 so the row keeps a visible size.
const PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

type Seed = {
  reader: DisposableUser;
  roomId: string;
  rootId: string;
  progressIds: string[];
  answerId: string;
  workingIds: string[];
};

const setDisplayName = (session: MatrixSession, displayName: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });

const inThread = (rootId: string, previousId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: previousId },
  },
});

const seedRoom = async (name: string) => {
  const reader = await registerDisposableUser(`tfb_${name}_${RUN}`, PASSWORD);
  await setDisplayName(reader, 'Sam Lee');
  const agent = await registerAgentAccount(HOMESERVER, `ops_${name}`);
  await setDisplayName(agent, 'Ops');
  const roomId = await createPrivateRoom(HOMESERVER, reader.accessToken, {
    name: 'Data jobs',
    topic: 'Nightly jobs and exports',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const send = (session: MatrixSession, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, session.accessToken, roomId, content);
  return { reader, agent, roomId, send };
};

const seed = async (name: string): Promise<Seed> => {
  const { reader, agent, roomId, send } = await seedRoom(name);
  const agentSays = async (rootId: string, previousId: string, body: string, status: string) =>
    send(agent, {
      msgtype: 'm.text',
      body,
      'io.mindroom.stream_status': status,
      ...inThread(rootId, previousId),
    });

  const rootId = await send(reader, { msgtype: 'm.text', body: QUESTION });
  let previousId = rootId;
  const progressIds: string[] = [];
  for (const body of PROGRESS) {
    previousId = await agentSays(rootId, previousId, body, 'completed');
    progressIds.push(previousId);
  }
  const answerId = await agentSays(rootId, previousId, ANSWER, 'completed');
  previousId = await send(reader, {
    msgtype: 'm.text',
    body: FOLLOW_UP,
    ...inThread(rootId, answerId),
  });
  const workingIds: string[] = [];
  for (const [index, body] of WORKING.entries()) {
    const status = index === WORKING.length - 1 ? 'streaming' : 'completed';
    previousId = await agentSays(rootId, previousId, body, status);
    workingIds.push(previousId);
  }
  return { reader, roomId, rootId, progressIds, answerId, workingIds };
};

/**
 * A finished turn whose run's reply, as MindRoom sends it when the run starts, comes before what
 * the run posted as it worked: a caption and two images. An earlier run's reply and a note fold.
 */
const seedAttachments = async (name: string) => {
  const { reader, agent, roomId, send } = await seedRoom(`${name}_att`);
  const rootId = await send(reader, { msgtype: 'm.text', body: REQUEST });
  let previousId = rootId;
  const agentSends = async (content: Record<string, unknown>) => {
    previousId = await send(agent, { ...content, ...inThread(rootId, previousId) });
    return previousId;
  };
  const foldedIds = [
    await agentSends({ msgtype: 'm.text', body: DRAFT, ...AI_RUN }),
    await agentSends({ msgtype: 'm.text', body: NOTE }),
  ];
  const summaryId = await agentSends({ msgtype: 'm.text', body: SUMMARY, ...AI_RUN });
  const captionId = await agentSends({ msgtype: 'm.text', body: CAPTION });
  const imageIds: string[] = [];
  for (const body of ['before.png', 'after.png']) {
    const response = await fetch(
      `${HOMESERVER}/_matrix/media/v3/upload?filename=${encodeURIComponent(body)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${agent.accessToken}`, 'Content-Type': 'image/png' },
        body: PICTURE,
      }
    );
    expect(response.ok, `uploading ${body}`).toBe(true);
    const url = ((await response.json()) as { content_uri: string }).content_uri;
    const info = { mimetype: 'image/png', w: 120, h: 80, size: PICTURE.length };
    imageIds.push(await agentSends({ msgtype: 'm.image', body, url, info }));
  }
  return { reader, roomId, rootId, foldedIds, summaryId, captionId, imageIds };
};

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const check = async (
  browser: Browser,
  options: BrowserContextOptions,
  baseURL: string | undefined,
  name: string
) => {
  const { reader, roomId, rootId, progressIds, answerId, workingIds } = await seed(name);
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({ page, roomId, userId: reader.userId, viewMode: 'threaded' });
    await page.goto(`/home/${encodeURIComponent(roomId)}/?threadId=${encodeURIComponent(rootId)}`);

    const row = (id: string) => page.locator(`[data-message-id="${id}"]`);
    const answer = row(answerId);
    await expect(answer).toContainText(ANSWER, { timeout: 60_000 });
    // The streaming turn shows all its messages and no break: only the finished turn has one.
    for (const id of workingIds) await expect(row(id)).toBeVisible();
    const breaks = page.locator('[data-turn-break]');
    await expect(breaks).toHaveCount(1);
    const pill = breaks.getByRole('button');
    await expect(pill).toHaveText('···5 earlier messages···');
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
    for (const id of progressIds) await expect(row(id)).toHaveCount(0);
    await expect(row(rootId)).toContainText(QUESTION);
    await pill.scrollIntoViewIfNeeded();
    await shot(page, `${name}-folded`);

    // Its pill opens the turn: the five messages show again, under the break.
    await pill.click();
    await expect(pill).toHaveText('Hide 5 messages');
    await expect(pill).toHaveAttribute('aria-expanded', 'true');
    await expect(pill).toBeFocused();
    for (const id of progressIds) await expect(row(id)).toBeVisible();
    const breakBox = await breaks.boundingBox();
    const firstBox = await row(progressIds[0]!).boundingBox();
    expect(breakBox && firstBox && breakBox.y < firstBox.y).toBe(true);
    await expect(answer).toBeVisible();
    await breaks.scrollIntoViewIfNeeded();
    await shot(page, `${name}-open`);

    // Hide folds it again, from the keyboard too.
    await pill.press('Enter');
    await expect(pill).toHaveText('···5 earlier messages···');
    for (const id of progressIds) await expect(row(id)).toHaveCount(0);
    await expect(answer).toContainText(ANSWER);
  } finally {
    await context.close();
  }
};

const checkAttachments = async (
  browser: Browser,
  options: BrowserContextOptions,
  baseURL: string | undefined,
  name: string
) => {
  const { reader, roomId, rootId, foldedIds, summaryId, captionId, imageIds } =
    await seedAttachments(name);
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: reader.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({ page, roomId, userId: reader.userId, viewMode: 'threaded' });
    await page.goto(`/home/${encodeURIComponent(roomId)}/?threadId=${encodeURIComponent(rootId)}`);

    const row = (id: string) => page.locator(`[data-message-id="${id}"]`);
    await expect(row(rootId)).toContainText(REQUEST, { timeout: 60_000 });
    await expect(row(imageIds[1]!)).toBeVisible({ timeout: 60_000 });
    const breaks = page.locator('[data-turn-break]');
    await expect(breaks).toHaveCount(1);
    await shot(page, `${name}-attachments-after-reply`);

    // Only the earlier run's reply and the note fold; the reply and what came after it show.
    await expect(breaks.getByRole('button')).toHaveText('···2 earlier messages···');
    for (const id of foldedIds) await expect(row(id)).toHaveCount(0);
    await expect(row(summaryId)).toContainText(SUMMARY);
    await expect(row(captionId)).toContainText(CAPTION);
    for (const id of imageIds) await expect(row(id)).toBeVisible();
  } finally {
    await context.close();
  }
};

const DESKTOP: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
  colorScheme: 'dark',
};
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  colorScheme: 'dark',
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS, video: 'off', trace: 'off' });

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
  test(`a finished turn folds its middle messages behind a break (Chromium, ${form})`, async ({
    browser,
    baseURL,
  }) => {
    await check(browser, options, baseURL, form);
  });

  test(`a run's reply answers its turn, the attachments posted after it in view (Chromium, ${form})`, async ({
    browser,
    baseURL,
  }) => {
    await checkAttachments(browser, options, baseURL, form);
  });
}
