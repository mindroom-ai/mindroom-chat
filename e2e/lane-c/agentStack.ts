import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { activeAccountButtonNamePattern } from '../helpers/auth';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';

/**
 * Fixtures for the agent specs (`e2e/lane-c/agent-*.spec.ts`): a real MindRoom backend with the stub model of
 * scripts/agent-stack/stack.py, run against this slot's homeserver, and a browser signed in as its test account.
 * With E2E_AGENT_MODEL=real the backend runs Claude Haiku 5.5 and GPT-6 Luna instead, following a script that
 * gives the stub's hashtags the same meaning; the provider keys must then be in the environment (stack.py's
 * docstring), and the specs skip without them.
 *
 * The first spec of a run starts the stack (a minute, several the first time a MindRoom commit is installed);
 * later specs reuse it until `python3 scripts/agent-stack/stack.py <slot> down` or `scripts/e2e-slot.sh <slot> down`.
 * The specs skip themselves when there is no MindRoom checkout (E2E_MINDROOM_CHECKOUT, default
 * /home/basnijholt/Work/dev/mindroom) or no homeserver on the slot's port.
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
};

export type MatrixEvent = {
  event_id: string;
  type: string;
  sender: string;
  origin_server_ts: number;
  content: Record<string, unknown>;
};

const STACK_SCRIPT = fileURLToPath(new URL('../../scripts/agent-stack/stack.py', import.meta.url));
const EXIT_NO_CHECKOUT = 3;
const EXIT_NO_HOMESERVER = 4;
const EXIT_NO_KEYS = 5;

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
  if ([EXIT_NO_CHECKOUT, EXIT_NO_HOMESERVER, EXIT_NO_KEYS].includes(result.status ?? -1))
    return message;
  throw new Error(
    `The agent stack did not start (exit ${result.status}):\n${message.slice(-4000)}`
  );
};

/** The client config the specs need: the slot's homeserver, and canvases on. */
const routeClientConfig = async (page: Page, stack: AgentStack): Promise<void> => {
  await page.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({
      response,
      json: {
        ...config,
        homeserverList: [stack.homeserver],
        defaultHomeserver: 0,
        mindroom: { ...config.mindroom, canvas: { enabled: true, libraries: false } },
      },
    });
  });
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
};

const signIn = async (page: Page, stack: AgentStack): Promise<void> => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('settings')) {
      localStorage.setItem('settings', JSON.stringify({ isPeopleDrawer: false }));
    }
  });
  await page.goto(`/login/${encodeURIComponent(stack.homeserver)}`, { timeout: 180_000 });
  await page.locator('input[name="usernameInput"]').fill(stack.tester.username);
  await page.locator('input[name="passwordInput"]').fill(stack.tester.password);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  // The first start of an account sets up its encryption, which takes long on a loaded machine.
  await expect(
    page.getByRole('button', { name: activeAccountButtonNamePattern }).first()
  ).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
};

type WorkerFixtures = {
  /** More options for `stack.py up`, such as `['--calls', <service URL>]`; another set restarts the stack. */
  agentStackArgs: string[];
  agentStackOrSkip: AgentStack | string;
  testerStorageState: string | undefined;
};

export const test = base.extend<{ stack: AgentStack }, WorkerFixtures>({
  agentStackArgs: [[], { scope: 'worker', option: true }],
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
      const file = join(directory, 'tester.json');
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
  page: async ({ page, agentStackOrSkip }, use) => {
    if (typeof agentStackOrSkip !== 'string') await routeClientConfig(page, agentStackOrSkip);
    await use(page);
  },
});

export { expect };

/** A word unique to this test, so its thread and messages are easy to find. */
export const uniqueWord = (prefix: string): string =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

/** Moves the loaded client to a thread of the lobby, as a link inside the app would. */
export const showThread = async (page: Page, stack: AgentStack, rootId: string): Promise<void> => {
  await page.evaluate((url) => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, threadUrl(stack, rootId));
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

export const messageRow = (page: Page, eventId: string): Locator =>
  page.locator(`[data-message-id="${eventId}"]`).first();

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
