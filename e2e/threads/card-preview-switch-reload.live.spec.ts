import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
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

// A reader of a busy agent room leaves it for another room and comes back, then reloads. Every
// agent thread finished long ago and has its AI title. Cards must keep previewing the agent's
// final reply: not the person's prompt, not "Thinking...". On live-test pass 2's load lane,
// 210 of 234 cards previewed the prompt for 5 to 11 s after a room switch, and for 46 to 114 s
// after a reload in WebKit; some finished cards kept "Thinking..." for minutes (P2-lane6-F003).
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'card-preview-switch-reload-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Release Desk';
const OTHER_ROOM = 'Quiet corner';
const FILLER_ROOMS = 25;
const HISTORY = 150;
const AGENT_THREADS = 60;
const AGENT_NAMES = ['Planner', 'Reviewer', 'Tester', 'Writer'];
const AWAY_MS = 30_000;
const WATCH_MS = 12_000;

const promptText = (index: number) => `Item ${index}: which fixes go into the release notes?`;
const finalText = (index: number) =>
  `Item ${index} is ready: the notes list the export fix and the keyboard shortcuts.`;

type Account = MatrixSession & { username: string };
type AgentThread = { index: number; rootId: string };

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

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `csr_${name}_${RUN}`;
  await matrixFetch(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

const inThread = (rootId: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const inBatches = async (
  count: number,
  width: number,
  job: (index: number) => Promise<unknown>
) => {
  for (let start = 0; start < count; start += width)
    await Promise.all(
      Array.from({ length: Math.min(width, count - start) }, (_, offset) => job(start + offset))
    );
};

const seed = async (engine: string) => {
  const reader = await registerAndLogin(engine);
  const peer = await registerAndLogin(`${engine}_peer`);
  const agents: MatrixSession[] = [];
  for (const name of AGENT_NAMES) {
    const agent = await registerAgentAccount(HOMESERVER, `${name.toLowerCase()}_${engine}_${RUN}`);
    await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
      method: 'PUT',
      accessToken: agent.accessToken,
      body: JSON.stringify({ displayname: name }),
    });
    agents.push(agent);
  }
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [peer.userId, ...agents.map((agent) => agent.userId)],
  });
  await joinRoom(HOMESERVER, peer.accessToken, roomId);
  for (const agent of agents) await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await inBatches(FILLER_ROOMS, 5, (index) =>
    createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
  );
  await createRoom(HOMESERVER, reader.accessToken, { name: OTHER_ROOM });
  const send = (sender: MatrixSession, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, sender.accessToken, roomId, content);
  await inBatches(HISTORY, 25, async (index) => {
    const rootId = await send(peer, {
      msgtype: 'm.notice',
      body: `Earlier note ${index}: the staging deploy waits for review.`,
    });
    await send(reader, { msgtype: 'm.text', body: `Earlier note ${index}: noted.`, ...inThread(rootId) });
  });
  const threads: AgentThread[] = [];
  await inBatches(AGENT_THREADS, 10, async (offset) => {
    const index = offset + 1;
    const agent = agents[index % agents.length];
    if (!agent) throw new Error('no agent');
    const rootId = await send(peer, { msgtype: 'm.text', body: promptText(index) });
    const replyId = await send(agent, {
      msgtype: 'm.text',
      body: 'Thinking...',
      'io.mindroom.stream_status': 'pending',
      ...inThread(rootId),
    });
    const edit = (body: string, status: string) =>
      send(agent, {
        msgtype: 'm.text',
        body: `* ${body}`,
        'io.mindroom.stream_status': status,
        'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
        'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
      });
    await edit(`Item ${index}: checking the release notes.`, 'streaming');
    await edit(finalText(index), 'completed');
    await send(agent, {
      msgtype: 'm.notice',
      body: `Release notes item ${index}`,
      'io.mindroom.thread_summary': {
        version: 1,
        summary: `Release notes item ${index}`,
        message_count: 2,
        generated_at: new Date().toISOString(),
        model: 'test',
      },
      ...inThread(rootId),
    });
    threads.push({ index, rootId });
  });
  return { reader, roomId, threads };
};

const threadCard = (page: Page, rootId: string) =>
  page.locator(`[data-compact-room-view] [data-thread-root-id="${rootId}"]`).first();

type Sample = { prompt: Set<number>; thinking: Set<number>; notFinal: Set<number> };

/** Reads every agent card's text every 300 ms for `ms`; the last read decides `notFinal`. */
const watchCards = async (page: Page, threads: AgentThread[], ms: number): Promise<Sample> => {
  const sample: Sample = { prompt: new Set(), thinking: new Set(), notFinal: new Set() };
  const ids = threads.map((thread) => thread.rootId);
  const until = Date.now() + ms;
  let last: (string | null)[] = [];
  while (Date.now() < until) {
    last = await page.evaluate(
      (rootIds) =>
        rootIds.map(
          (rootId) =>
            document.querySelector(
              `[data-compact-room-view] [data-thread-root-id="${CSS.escape(rootId)}"]`
            )?.textContent ?? null
        ),
      ids
    );
    last.forEach((text, position) => {
      const thread = threads[position];
      if (!thread || text === null) return;
      if (text.includes(promptText(thread.index))) sample.prompt.add(thread.index);
      if (text.includes('Thinking...')) sample.thinking.add(thread.index);
    });
    await page.waitForTimeout(300);
  }
  last.forEach((text, position) => {
    const thread = threads[position];
    if (thread && !(text ?? '').includes(finalText(thread.index).slice(0, 40)))
      sample.notFinal.add(thread.index);
  });
  return sample;
};

const report = (label: string, sample: Sample) => {
  const line = `${label}: prompt ${sample.prompt.size}, thinking ${sample.thinking.size}, not final at the end ${sample.notFinal.size} of ${AGENT_THREADS}`;
  test.info().annotations.push({ type: 'card previews', description: line });
  // eslint-disable-next-line no-console
  console.log(`card previews: ${line}`);
};

const check = async (page: Page, engine: string, world: Awaited<ReturnType<typeof seed>>) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createHiddenOverviewFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(world.roomId)}/`);
  const heading = page.getByRole('heading', { name: ROOM_NAME }).first();
  await expect(heading).toBeVisible({ timeout: 60_000 });
  for (const thread of world.threads)
    await expect(threadCard(page, thread.rootId)).toContainText(
      finalText(thread.index).slice(0, 40),
      { timeout: 120_000 }
    );

  // Away in another room, then back, within the app.
  await page.getByRole('link', { name: OTHER_ROOM }).first().click();
  await expect(page.getByRole('heading', { name: OTHER_ROOM }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(AWAY_MS);
  await page.getByRole('link', { name: ROOM_NAME }).first().click();
  await expect(heading).toBeVisible({ timeout: 30_000 });
  const switched = await watchCards(page, world.threads, WATCH_MS);
  report(`${engine} room switch`, switched);

  await page.reload();
  await expect(heading).toBeVisible({ timeout: 60_000 });
  const reloaded = await watchCards(page, world.threads, WATCH_MS * 2);
  report(`${engine} reload`, reloaded);

  expect.soft([...switched.prompt], `${engine} room switch: cards that previewed the prompt`).toEqual([]);
  expect.soft([...switched.thinking], `${engine} room switch: cards that previewed "Thinking..."`).toEqual([]);
  expect.soft([...switched.notFinal], `${engine} room switch: cards without the final reply`).toEqual([]);
  expect.soft([...reloaded.thinking], `${engine} reload: cards that previewed "Thinking..."`).toEqual([]);
  expect.soft([...reloaded.notFinal], `${engine} reload: cards without the final reply`).toEqual([]);
};

const run = async (newContext: () => Promise<BrowserContext>, engine: string) => {
  const world = await seed(engine);
  const context = await newContext();
  try {
    const page = await context.newPage();
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await check(page, engine, world);
  } finally {
    await context.close();
  }
};

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('finished agent cards keep their final reply through a room switch and a reload (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(600_000);
  await run(
    () =>
      (browser as Browser).newContext({
        viewport: { width: 1440, height: 900 },
        baseURL,
      }),
    'chromium'
  );
});

test('finished agent cards keep their final reply through a room switch and a reload (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(600_000);
  const browser = await launchWebKit();
  try {
    await run(
      () =>
        browser.newContext({
          viewport: { width: 1440, height: 900 },
          baseURL,
        }),
      'webkit'
    );
  } finally {
    await browser.close();
  }
});
