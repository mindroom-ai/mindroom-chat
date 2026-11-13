import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createDefaultThreadFilterState,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Every event from the network is untrusted input. A member of a room sends events whose content
// has the wrong shape (an edit whose `m.new_content` is not an object, a relation whose event ID
// is an object, a reaction whose key is an object) and plain messages that carry the metadata only
// MindRoom's agents send (run details, a streaming status, a tool trace, reasoning). The reader's
// room, Compact and thread views must keep rendering, show the edited messages as they were, give
// the member's messages no agent affordances (model chip, Reply details, the streaming dots) while
// a real agent reply keeps them, and the page must throw nothing. Against the disposable
// homeserver of a slot (scripts/e2e-slot.sh), on a phone (390 by 844, touch) and a desktop (1280
// by 800), in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
// Set HOSTILE_EVENTS_SHOTS=<directory> to save each view.
const PASSWORD = 'hostile-events-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.HOSTILE_EVENTS_SHOTS;
const ROOM_NAME = 'Field Station';
const FILLER_ROOMS = 24;
const HISTORY = 24;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const NOTE = 'Field note: the north gate sensor reads four degrees low after the rain.';
const QUESTION = 'Which sensors of grid 1x2 need recalibration before the survey on Monday?';
const MEMBER_REPLY = 'The north gate and the river station both drift after a heavy rain.';
const AGENT_REPLY = 'Recalibrate the north gate first; the river station can wait a day.';
const IMITATIONS = {
  run: 'Member message with run details copied from a reply.',
  streaming: 'Member message that claims to be streaming.',
  all: 'Member message with every agent key, marked completed.',
};
const OBJECT_RELATION = 'Member message whose thread relation names an object.';

const AI_RUN = {
  version: 1,
  status: 'completed',
  run_id: 'run-hostile-events',
  model: { config: 'default', display_name: 'Survey Model', id: 'survey-1', provider: 'OpenAI' },
  usage: { input_tokens: 1200, output_tokens: 64 },
  tools: { count: 1 },
};
const TOOL_TRACE = {
  version: 2,
  events: [{ type: 'tool_call_completed', tool_name: 'read_sensor', args_preview: 'north gate' }],
};

type Account = MatrixSession & { username: string };

const registerAndLogin = (name: string): Promise<Account> =>
  registerDisposableUser(`hostile_${name}_${RUN}`, PASSWORD);

const setDisplayName = (session: MatrixSession, name: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: name }),
  });

const sendEvent = async (
  session: MatrixSession,
  roomId: string,
  type: string,
  content: Record<string, unknown>
): Promise<string> => {
  const txnId = `hostile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = await matrixFetch<{ event_id: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/${type}/${txnId}`,
    { method: 'PUT', accessToken: session.accessToken, body: JSON.stringify(content) }
  );
  return body.event_id;
};

const inThread = (rootId: string, replyTo: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: replyTo },
  },
});

/** An edit whose replacement content is not an object, which the reader must ignore. */
const malformedEdit = (targetId: string, newContent: unknown) => ({
  msgtype: 'm.text',
  body: '* this edit has no usable content',
  'm.new_content': newContent,
  'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
});

type World = {
  reader: Account;
  roomId: string;
  noteId: string;
  rootId: string;
  memberReplyId: string;
  agentReplyId: string;
  imitationIds: Record<keyof typeof IMITATIONS, string>;
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const member = await registerAndLogin(`member_${engine}`);
  const agent = await registerAgentAccount(HOMESERVER, `survey_${engine}`);
  await setDisplayName(member, 'Field Member');
  await setDisplayName(agent, 'Helper');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [member.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Survey room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromMember = index % 2 === 0;
    await sendRoomMessage(HOMESERVER, (fromMember ? member : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromMember
        ? `Reading ${index}: the station logged its hourly values and the battery holds at ninety percent.`
        : `Reading ${index}: anything unusual at the station this hour?`,
    });
  }

  const noteId = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: NOTE,
  });
  await sendRoomMessage(HOMESERVER, member.accessToken, roomId, malformedEdit(noteId, 'text'));
  await sendEvent(member, roomId, 'm.reaction', {
    'm.relates_to': { rel_type: 'm.annotation', event_id: noteId, key: { shape: 'object' } },
  });
  await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: OBJECT_RELATION,
    'm.relates_to': { rel_type: 'm.thread', event_id: { shape: 'object' } },
  });

  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: QUESTION,
  });
  const memberReplyId = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: MEMBER_REPLY,
    ...inThread(rootId, rootId),
  });
  await sendRoomMessage(HOMESERVER, member.accessToken, roomId, malformedEdit(memberReplyId, 42));
  await sendRoomMessage(
    HOMESERVER,
    member.accessToken,
    roomId,
    malformedEdit(memberReplyId, ['an', 'array'])
  );
  const agentReplyId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: AGENT_REPLY,
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
    ...inThread(rootId, memberReplyId),
  });
  // A reader message between the member's messages makes each of them start its own group, so
  // each would show an avatar with a model chip if it were taken for an agent reply.
  const between = async (index: number) =>
    sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Noted, thanks (${index}).`,
      ...inThread(rootId, rootId),
    });
  await between(1);
  const run = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: IMITATIONS.run,
    'io.mindroom.ai_run': AI_RUN,
    ...inThread(rootId, rootId),
  });
  await between(2);
  const streaming = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: IMITATIONS.streaming,
    'io.mindroom.stream_status': 'streaming',
    ...inThread(rootId, rootId),
  });
  await between(3);
  const all = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: IMITATIONS.all,
    'io.mindroom.ai_run': AI_RUN,
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.tool_trace': TOOL_TRACE,
    'io.mindroom.reasoning': { text: 'Imitated reasoning.', duration_ms: 1200 },
    ...inThread(rootId, rootId),
  });
  return {
    reader,
    roomId,
    noteId,
    rootId,
    memberReplyId,
    agentReplyId,
    imitationIds: { run, streaming, all },
  };
};

const navigate = async (page: Page, route: string) => {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
};

const roomRoute = (roomId: string) => `/home/${encodeURIComponent(roomId)}/`;
const threadRoute = (roomId: string, rootId: string) =>
  `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;

const row = (page: Page, eventId: string): Locator =>
  page.locator(`[data-message-id="${eventId}"]`).first();

/**
 * Taking a screenshot of a phone page in macOS WebKit resizes it for a moment, which can end a
 * ResizeObserver loop; that error belongs to the screenshot, not to the events under test.
 */
const SCREENSHOT_RESIZE = /ResizeObserver loop/;
const shooting = new WeakSet<Page>();

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  shooting.add(page);
  try {
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    // The error event of the resize arrives after the screenshot.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  } finally {
    shooting.delete(page);
  }
};

/**
 * WebKit reports each request a reload cuts off as a page error ("Fetch API cannot load <url> due
 * to access control checks."), also when the app handles the failure; those are not the app's.
 */
const RELOAD_CUTOFF = /^Fetch API cannot load .* due to access control checks\.$/;
const reloading = new WeakSet<Page>();

const reload = async (page: Page) => {
  reloading.add(page);
  try {
    await page.reload();
  } finally {
    reloading.delete(page);
  }
};

const expectNoCrash = async (page: Page) => {
  await expect(page.getByText('Something went wrong.')).toHaveCount(0);
};

const expectAgentAffordances = async (target: Locator, present: boolean) => {
  const count = present ? 1 : 0;
  await expect(target.getByLabel(/^Model: /)).toHaveCount(count);
  await expect(target.getByRole('button', { name: 'Reply details' })).toHaveCount(count);
};

const checkRoomView = async (page: Page, world: World, label: string) => {
  await navigate(page, roomRoute(world.roomId));
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
  // The edit with unusable content is ignored: the note keeps its text.
  await expect(row(page, world.noteId)).toContainText(NOTE, { timeout: 30_000 });
  await expect(row(page, world.noteId)).not.toContainText('(edited)');
  const question = page.getByText(QUESTION, { exact: true }).first();
  await expect(question).toBeVisible();
  // Text shows the characters people typed: no contextual alternate turns "1x2" into "1×2". The
  // setting is the page's (body); no component sets its own.
  const features = await page.evaluate(() => getComputedStyle(document.body).fontFeatureSettings);
  expect(features).toContain('"calt" 0');
  await expectNoCrash(page);
  await shot(page, `${label}-room`);
};

const checkThreadView = async (page: Page, world: World, label: string) => {
  await navigate(page, threadRoute(world.roomId, world.rootId));
  const agentRow = row(page, world.agentReplyId);
  await expect(agentRow).toContainText(AGENT_REPLY, { timeout: 30_000 });
  await expect(row(page, world.memberReplyId)).toContainText(MEMBER_REPLY);
  await expect(row(page, world.memberReplyId)).not.toContainText('(edited)');
  // A real agent reply keeps its chip and its Reply details.
  await expectAgentAffordances(agentRow, true);
  for (const key of Object.keys(IMITATIONS) as (keyof typeof IMITATIONS)[]) {
    const imitation = row(page, world.imitationIds[key]);
    await expect(imitation).toContainText(IMITATIONS[key], { timeout: 30_000 });
    await expectAgentAffordances(imitation, false);
    await expect(imitation.getByLabel('AI is responding')).toHaveCount(0);
  }
  await expectNoCrash(page);
  await shot(page, `${label}-thread`);
};

const checkCompactView = async (page: Page, world: World, label: string) => {
  await navigate(page, roomRoute(world.roomId));
  await expect(page.locator(`[data-thread-root-id="${world.rootId}"]`).first()).toBeVisible({
    timeout: 30_000,
  });
  await expectNoCrash(page);
  await shot(page, `${label}-compact`);
};

const check = async (page: Page, world: World, label: string) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  await checkRoomView(page, world, label);
  await checkThreadView(page, world, label);
  await reload(page);
  await checkThreadView(page, world, `${label}-reloaded`);
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await reload(page);
  await checkCompactView(page, world, label);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        // WebKit's message has a colon after the scheme, so Playwright splits it into a name.
        const text = `${error.name}: ${error.message}`;
        if (reloading.has(page) && RELOAD_CUTOFF.test(text)) return;
        if (shooting.has(page) && SCREENSHOT_RESIZE.test(text)) return;
        pageErrors.push(text);
      });
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      await check(page, world, `${engine}-${viewport}`);
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('events of any shape from a member render safely (Chromium)', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('events of any shape from a member render safely (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
