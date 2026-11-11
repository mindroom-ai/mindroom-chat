import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  test as base,
  expect,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { activeAccountButtonNamePattern } from './auth';
import { matrixFetch, sendRoomMessage } from './matrix';

/**
 * Fixtures for the agent specs (`e2e/<domain>/agent-*.spec.ts`): a real MindRoom backend with the stub model of
 * scripts/agent-stack/stack.py, run against this slot's homeserver, and a browser signed in as its test account.
 * With E2E_AGENT_MODEL=real the backend runs Claude Haiku 5.5 and GPT-6 Luna instead, following a script that
 * gives the stub's hashtags the same meaning; the provider keys must then be in the environment (stack.py's
 * docstring), and the specs skip without them.
 *
 * The first spec of a run starts the stack (a minute, several the first time a MindRoom commit is installed);
 * later specs reuse it until `python3 scripts/agent-stack/stack.py <slot> down` or `scripts/e2e-slot.sh <slot> down`.
 * The specs skip themselves when there is no MindRoom checkout (E2E_MINDROOM_CHECKOUT, default
 * /home/basnijholt/Work/dev/mindroom) or no homeserver on the slot's port. E2E_PLUGIN_DIRS adds plugin
 * directories to the stack (stack.py's docstring), and a stack started with other ones restarts.
 */

/** One of the thread's two models: its config key, provider model ID and the name clients show. */
export type AgentModel = { key: string; id: string; displayName: string };

export type AgentStack = {
  slot: number;
  /** `stub`: the stub model of scripts/agent-stack/stub_model.py; `real`: provider models. */
  model: 'stub' | 'real';
  /** The room's default model and the one the model picker switches a thread to. */
  models: { first: AgentModel; second: AgentModel };
  sha: string;
  namespace: string;
  homeserver: string;
  apiUrl: string;
  dir: string;
  stubRequests: string;
  logs: { backend: string; stub: string };
  tester: { userId: string; username: string; password: string; accessToken: string };
  /** A real-model stack runs only the helper. */
  agents: { router: string; helper: string; scout?: string };
  rooms: { lobby: string; space: string };
  approvalExpirySeconds: number;
  /** The helper's voice calls (`--calls`), or null. */
  calls?: { serviceUrl: string; profile: 'realtime' | 'live'; model: string } | null;
  /**
   * The plugin directories of E2E_PLUGIN_DIRS: each one's MindRoom plugin (its manifest name, or null without one),
   * the tools the helper took from it, its stub-model scenario file and module or null, and whether its manifest
   * names an `origin_module`.
   */
  pluginDirs?: {
    dir: string;
    plugin: string | null;
    tools: string[];
    scenarios: string | null;
    scenarioModule: string | null;
    origins: boolean;
  }[];
  /**
   * The port of the backend's plugin origins, on while a plugin of `pluginDirs` has an `origin_module`, else
   * null: plugin `<plugin>` serves host `<label>` at `http://<label>.<plugin>.localhost:<port>`.
   */
  pluginOriginPort?: number | null;
  /**
   * Call transcripts (`calls.transcripts`): `stub` speech-to-text is a stand-in that answers from
   * each recording's length, `real` is OpenAI's (`--transcription real`); and the model that writes
   * the notes. Null for a MindRoom without them.
   */
  transcription?: { stt: 'stub' | 'real'; notesModel: string } | null;
};

export type MatrixEvent = {
  event_id: string;
  type: string;
  sender: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
};

export const STACK_SCRIPT = fileURLToPath(
  new URL('../../scripts/agent-stack/stack.py', import.meta.url)
);
const EXIT_NO_CHECKOUT = 3;
const EXIT_NO_HOMESERVER = 4;
const EXIT_NO_KEYS = 5;
/** `--terminals` on a MindRoom without the terminal toolkit. */
const EXIT_NO_TERMINALS = 6;

const slotNumber = (): number => {
  const port = Number(process.env.E2E_MATRIX_PORT ?? '28008');
  return port === 28008 ? 0 : port - 28100;
};

/** Starts the slot's stack, or finds it running; a string is the reason to skip. */
const startAgentStack = (args: string[]): AgentStack | string => {
  const result = spawnSync('python3', [STACK_SCRIPT, String(slotNumber()), 'up', ...args], {
    encoding: 'utf8',
    timeout: 20 * 60_000,
  });
  if (result.status === 0) return JSON.parse(result.stdout) as AgentStack;
  const message = (result.stderr || String(result.error ?? '')).trim();
  if (
    [EXIT_NO_CHECKOUT, EXIT_NO_HOMESERVER, EXIT_NO_KEYS, EXIT_NO_TERMINALS].includes(
      result.status ?? -1
    )
  )
    return message;
  // stack.py's last line of its own names the reason; the tail of the backend log follows it.
  const reason =
    message
      .split('\n')
      .filter((line) => line.startsWith('agent-stack: '))
      .at(-1) ?? '';
  throw new Error(
    `The agent stack did not start (exit ${result.status}): ${reason}\n${message.slice(-4000)}`
  );
};

/**
 * The client config the specs need: the slot's homeserver, and canvases on, then the `topLevel` keys
 * and the `mindroom` settings given. A spec may route it again with other ones; the route added last
 * answers.
 */
export const routeClientConfig = async (
  page: Page,
  stack: AgentStack,
  mindroom: Record<string, unknown> = {},
  topLevel: Record<string, unknown> = {}
): Promise<void> => {
  await page.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({
      response,
      json: {
        ...config,
        homeserverList: [stack.homeserver],
        defaultHomeserver: 0,
        ...topLevel,
        mindroom: {
          ...config.mindroom,
          canvas: { enabled: true, libraries: false },
          ...mindroom,
        },
      },
    });
  });
  // Chat renders the configuration it cached on an earlier load and keeps it for the whole page
  // load; one it fetches meanwhile applies from the next load (src/app/config/ClientConfigLoader.tsx).
  // The signed-in storage state cached the sign-in's, so a page's first load drops it and starts
  // from the configuration routed here; its later loads find that one cached.
  await page.addInitScript((key) => {
    try {
      if (sessionStorage.getItem('e2e-client-config-routed')) return;
      sessionStorage.setItem('e2e-client-config-routed', '1');
      localStorage.removeItem(key);
    } catch {
      // A sandboxed frame, such as an agent canvas, has no storage.
    }
  }, 'io.mindroom.client-config:/config.json');
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
};

/** Signs `account` in with its password, the test account by default, for a spec's own browser. */
export const signIn = async (
  page: Page,
  stack: AgentStack,
  account: { username: string; password: string } = stack.tester
): Promise<void> => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('settings')) {
      localStorage.setItem('settings', JSON.stringify({ isPeopleDrawer: false }));
    }
  });
  await page.goto(`/login/${encodeURIComponent(stack.homeserver)}`, { timeout: 180_000 });
  await page.locator('input[name="usernameInput"]').fill(account.username);
  await page.locator('input[name="passwordInput"]').fill(account.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  // The first start of an account sets up its encryption, which takes long on a loaded machine.
  await expect(
    page.getByRole('button', { name: activeAccountButtonNamePattern }).first()
  ).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
};

/**
 * Signs the tester in to MindRoom's client sessions from outside the page, with a token of its own
 * bound to the stack's API, and returns the session token.
 */
export const clientSessionToken = async (stack: AgentStack): Promise<string> => {
  const openIdToken = await matrixFetch<Record<string, unknown>>(
    stack.homeserver,
    `/user/${encodeURIComponent(stack.tester.userId)}/openid/request_token`,
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({ 'io.mindroom.audience': new URL(stack.apiUrl).origin }),
    }
  );
  const response = await fetch(`${stack.apiUrl}/api/client-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openid_token: openIdToken }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { session_token: string }).session_token;
};

/**
 * A page signed in to an account (the tester's by default) on a device of its own: for the tester, a
 * new session that has not been verified and holds no room keys, so it cannot read encrypted rooms yet.
 */
export const openNewSession = async (
  browser: Browser,
  stack: AgentStack,
  options: BrowserContextOptions,
  account: { username: string; password: string } = stack.tester
): Promise<Page> => {
  // Playwright gives a new context the project's options it does not set, the tester's saved
  // session among them; a key set to undefined counts as set.
  const page = await (await browser.newContext({ storageState: undefined, ...options })).newPage();
  await routeClientConfig(page, stack);
  await signIn(page, stack, account);
  return page;
};

type WorkerFixtures = {
  /** More options for `stack.py up`, such as `['--calls', <service URL>]`; another set restarts the stack. */
  agentStackArgs: string[];
  agentStackOrSkip: AgentStack | string;
  testerStorageState: string | undefined;
};

type TestFixtures = {
  stack: AgentStack;
  /** The stack's API as the `page` fixture's `mindroom.computers.apiUrl`. */
  clientApiUrl: boolean;
  /**
   * Top-level keys of the `page` fixture's client config, such as `{ createRoom: { ... } }`; its
   * `mindroom` settings come from `clientApiUrl` or `routeClientConfig`'s third argument.
   */
  clientConfig: Record<string, unknown>;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  agentStackArgs: [[], { scope: 'worker', option: true }],
  clientApiUrl: [false, { option: true }],
  clientConfig: [{}, { option: true }],
  agentStackOrSkip: [
    async ({ agentStackArgs }, use) => {
      await use(startAgentStack(agentStackArgs));
    },
    { scope: 'worker', timeout: 20 * 60_000 },
  ],
  // One password sign-in per stack; every test starts from its browser storage, IndexedDB included,
  // also in the new worker Playwright starts after a failure.
  testerStorageState: [
    async ({ browser, agentStackOrSkip }, use, workerInfo) => {
      if (typeof agentStackOrSkip === 'string') {
        await use(undefined);
        return;
      }
      const directory = join(agentStackOrSkip.dir, 'browser-state');
      mkdirSync(directory, { recursive: true });
      // One session per browser: two browsers on one device's crypto store would break its Olm sessions.
      const browserName = browser.browserType().name();
      const file = join(
        directory,
        browserName === 'chromium' ? 'tester.json' : `tester-${browserName}.json`
      );
      if (!existsSync(file)) {
        const context = await browser.newContext({ baseURL: workerInfo.project.use.baseURL });
        const page = await context.newPage();
        await routeClientConfig(page, agentStackOrSkip);
        await signIn(page, agentStackOrSkip);
        await context.storageState({ path: file, indexedDB: true });
        await context.close();
      }
      await use(file);
    },
    { scope: 'worker', timeout: 8 * 60_000 },
  ],
  storageState: async ({ testerStorageState }, use) => {
    await use(testerStorageState);
  },
  stack: async ({ agentStackOrSkip }, use, testInfo) => {
    testInfo.skip(typeof agentStackOrSkip === 'string', String(agentStackOrSkip));
    await use(agentStackOrSkip as AgentStack);
  },
  page: async ({ page, agentStackOrSkip, clientApiUrl, clientConfig }, use) => {
    if (typeof agentStackOrSkip !== 'string') {
      const mindroom = clientApiUrl ? { computers: { apiUrl: agentStackOrSkip.apiUrl } } : {};
      await routeClientConfig(page, agentStackOrSkip, mindroom, clientConfig);
    }
    await use(page);
  },
});

export { expect };

/** A word unique to this test, so its thread and messages are easy to find. */
export const uniqueWord = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The router's access token, from the stack's state file; the stack keeps it out of its output. */
export const routerToken = (stack: AgentStack): string =>
  (JSON.parse(readFileSync(join(stack.dir, 'state.json'), 'utf8')) as { routerToken: string })
    .routerToken;

/** Posts a message to the lobby as the test account; the agents answer it in a thread rooted on it. */
export const startThread = (stack: AgentStack, body: string): Promise<string> =>
  sendRoomMessage(stack.homeserver, stack.tester.accessToken, stack.rooms.lobby, {
    msgtype: 'm.text',
    body,
  });

export const threadUrl = (stack: AgentStack, rootId: string): string =>
  `/home/${encodeURIComponent(stack.rooms.lobby)}?threadId=${encodeURIComponent(rootId)}`;

const expectThreadShown = async (page: Page, rootId: string): Promise<void> => {
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 90_000 });
  await expect(messageRow(page, rootId)).toBeVisible({ timeout: 60_000 });
};

/** Loads the client on the thread and waits for its banner and its root. */
export const openThread = async (page: Page, stack: AgentStack, rootId: string): Promise<void> => {
  await page.goto(threadUrl(stack, rootId), { timeout: 180_000 });
  await expectThreadShown(page, rootId);
};

/** Loads the client on the lobby, so a thread started afterwards opens without a page load. */
export const openLobby = async (page: Page, stack: AgentStack): Promise<void> => {
  await page.goto(`/home/${encodeURIComponent(stack.rooms.lobby)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
};

/** Moves the loaded client to `path`, as a link inside the app would. */
export const showPath = (page: Page, path: string): Promise<void> =>
  page.evaluate((url) => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

/** Moves the loaded client to a thread of the lobby, as a link inside the app would. */
export const showThread = async (page: Page, stack: AgentStack, rootId: string): Promise<void> => {
  await showPath(page, threadUrl(stack, rootId));
  await expectThreadShown(page, rootId);
};

export const composer = (page: Page): Locator =>
  page.getByRole('textbox', { name: 'Send a message...' });

/** Types into the composer (a rich-text editor, so keystrokes rather than fill) and sends with Enter. */
export const sendFromComposer = async (page: Page, text: string): Promise<void> => {
  await composer(page).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
};

export const messageRow = (scope: Page | Locator, eventId: string): Locator =>
  scope.locator(`[data-message-id="${eventId}"]`).first();

const latestContent = (events: MatrixEvent[]): Map<string, MatrixEvent> => {
  // The room's events, newest first, folded so each original carries its latest edit's content.
  const originals = new Map<string, MatrixEvent>();
  const edits = new Map<string, Record<string, unknown>>();
  events.forEach((event) => {
    const relation = event.content['m.relates_to'] as
      | { rel_type?: string; event_id?: string }
      | undefined;
    if (relation?.rel_type === 'm.replace' && relation.event_id) {
      if (!edits.has(relation.event_id)) {
        edits.set(relation.event_id, {
          ...event.content,
          ...((event.content['m.new_content'] as Record<string, unknown>) ?? {}),
        });
      }
      return;
    }
    originals.set(event.event_id, event);
  });
  originals.forEach((event, id) => {
    const edit = edits.get(id);
    // The edit's relation points at the original; the original keeps its own (the thread).
    if (edit) {
      originals.set(id, {
        ...event,
        content: { ...event.content, ...edit, 'm.relates_to': event.content['m.relates_to'] },
      });
    }
  });
  return originals;
};

/** The lobby's latest events (edits applied), oldest first. */
export const lobbyEvents = async (stack: AgentStack, limit = 200): Promise<MatrixEvent[]> => {
  const { chunk } = await matrixFetch<{ chunk: MatrixEvent[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(stack.rooms.lobby)}/messages?dir=b&limit=${limit}`,
    { accessToken: stack.tester.accessToken }
  );
  return [...latestContent(chunk).values()].reverse();
};

export const inThread = (event: MatrixEvent, rootId: string): boolean => {
  const relation = event.content['m.relates_to'] as
    | { rel_type?: string; event_id?: string }
    | undefined;
  return relation?.rel_type === 'm.thread' && relation.event_id === rootId;
};

/**
 * Waits until the thread has an event that matches, as the homeserver has it, and returns it. Agents answer
 * through edits, so the content is the latest edit's.
 */
export const waitForThreadEvent = async (
  stack: AgentStack,
  rootId: string,
  matches: (event: MatrixEvent) => boolean,
  { timeout = 90_000, description = 'a matching thread event' } = {}
): Promise<MatrixEvent> => {
  let found: MatrixEvent | undefined;
  await expect
    .poll(
      async () => {
        found = (await lobbyEvents(stack)).find(
          (event) => inThread(event, rootId) && matches(event)
        );
        return !!found;
      },
      { timeout, intervals: [500, 1000], message: `waiting for ${description}` }
    )
    .toBe(true);
  return found as MatrixEvent;
};

export const bodyOf = (event: MatrixEvent): string =>
  typeof event.content.body === 'string' ? event.content.body : '';

export const streamStatus = (event: MatrixEvent): unknown =>
  event.content['io.mindroom.stream_status'];

/** The provider model ID the backend says answered, from the reply's `io.mindroom.ai_run` metadata. */
export const answeringModelId = (event: MatrixEvent): unknown => {
  const run = event.content['io.mindroom.ai_run'] as { model?: { id?: unknown } } | undefined;
  return run?.model?.id;
};

type AgentReplyOptions = {
  agent?: string;
  timeout?: number;
  /** The provider model ID the reply must have been written by. */
  modelId?: string;
};

/** The agent's reply in the thread once its stream completed and its body matches. */
export const waitForAgentReply = (
  stack: AgentStack,
  rootId: string,
  matches: (body: string) => boolean,
  { agent = stack.agents.helper, timeout = 90_000, modelId }: AgentReplyOptions = {}
): Promise<MatrixEvent> =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === agent &&
      event.type === 'm.room.message' &&
      streamStatus(event) === 'completed' &&
      (modelId === undefined || answeringModelId(event) === modelId) &&
      matches(bodyOf(event)),
    {
      timeout,
      description: `a completed reply from ${agent}${
        modelId === undefined ? '' : ` on ${modelId}`
      }`,
    }
  );

/** A new room of the tester with the helper and the router, once both joined it. */
export const createAgentRoom = async (
  stack: AgentStack,
  name: string,
  encrypted: boolean
): Promise<string> => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(
    stack.homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({
        name,
        preset: 'private_chat',
        invite: [stack.agents.helper, stack.agents.router],
        initial_state: encrypted
          ? [
              {
                type: 'm.room.encryption',
                state_key: '',
                content: { algorithm: 'm.megolm.v1.aes-sha2' },
              },
            ]
          : [],
      }),
    }
  );
  await expect
    .poll(
      async () => {
        const { joined } = await matrixFetch<{ joined: Record<string, unknown> }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/joined_members`,
          { accessToken: stack.tester.accessToken }
        );
        return !!joined[stack.agents.helper] && !!joined[stack.agents.router];
      },
      { timeout: 90_000, intervals: [500, 1000], message: 'the agents join the room' }
    )
    .toBe(true);
  return roomId;
};

/** A new encrypted room of the tester with the helper and the router, once both joined it. */
export const createEncryptedAgentRoom = (stack: AgentStack, name: string): Promise<string> =>
  createAgentRoom(stack, name, true);

/**
 * Reads the router's welcome thread in a new room, its root with a main-timeline receipt and its
 * reply with a receipt in its thread, so a test's counts are its own. The reader's own messages
 * read only their own thread or the main timeline (mindroom-tuwunel #139), so the welcome would
 * stay unread on the server, and a session that cannot decrypt it counts it otherwise.
 */
export const readRouterWelcome = async (stack: AgentStack, roomId: string): Promise<void> => {
  type Raw = { event_id: string; sender: string; content: { 'm.relates_to'?: unknown } };
  let welcome: Raw[] = [];
  await expect
    .poll(
      async () => {
        const { chunk } = await matrixFetch<{ chunk: Raw[] }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`,
          { accessToken: stack.tester.accessToken }
        );
        welcome = chunk.filter(
          (event) =>
            event.sender === stack.agents.router && event.content['m.relates_to'] !== undefined
        );
        const root = chunk.find(
          (event) => event.sender === stack.agents.router && !event.content['m.relates_to']
        );
        if (root) welcome = [root, ...welcome];
        return welcome.length;
      },
      { timeout: 30_000, intervals: [500, 1000], message: "the router's welcome thread" }
    )
    .toBeGreaterThanOrEqual(2);
  const [root, ...replies] = welcome;
  if (!root) throw new Error("The router's welcome has no root");
  const receipt = (eventId: string, threadId: string) =>
    matrixFetch(
      stack.homeserver,
      `/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
      {
        method: 'POST',
        accessToken: stack.tester.accessToken,
        body: JSON.stringify({ thread_id: threadId }),
      }
    );
  await receipt(root.event_id, 'main');
  if (replies[0]) await receipt(replies[0].event_id, root.event_id);
};

/** Sends "@Helper <text>" from the composer, with the mention Tab takes from its suggestions. */
export const mentionHelper = async (page: Page, stack: AgentStack, text: string): Promise<void> => {
  await composer(page).click();
  await page.keyboard.type('@Hel');
  await expect(page.getByText(stack.agents.helper, { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press('Tab');
  await page.keyboard.type(` ${text}`);
  await page.keyboard.press('Enter');
};

/** The tester's unread counts in a room as the server has them: its main timeline's and each thread's. */
export const serverUnreadCounts = async (
  stack: AgentStack,
  roomId: string
): Promise<{ room: number; threads: Record<string, number> }> => {
  const filter = JSON.stringify({
    room: { rooms: [roomId], timeline: { limit: 1, unread_thread_notifications: true } },
  });
  type Counts = { notification_count?: number };
  const sync = await matrixFetch<{
    rooms?: {
      join?: Record<
        string,
        { unread_notifications?: Counts; unread_thread_notifications?: Record<string, Counts> }
      >;
    };
  }>(stack.homeserver, `/sync?timeout=0&filter=${encodeURIComponent(filter)}`, {
    accessToken: stack.tester.accessToken,
  });
  const joined = sync.rooms?.join?.[roomId];
  return {
    room: joined?.unread_notifications?.notification_count ?? 0,
    threads: Object.fromEntries(
      Object.entries(joined?.unread_thread_notifications ?? {}).map(([id, counts]) => [
        id,
        counts.notification_count ?? 0,
      ])
    ),
  };
};
