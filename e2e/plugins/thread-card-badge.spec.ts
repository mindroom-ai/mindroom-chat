import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  createPrivateRoom,
  joinRoom,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';
import { setRoomCompact } from '../helpers/roomViewSwitch';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. In the Compact view of a room
// with an agent, the card of a thread an agent's greeting begins shows the plugin's thread card
// badge, "Greeting", in the card's metadata row inside its button, and the card of a thread a plain
// message begins shows none. The badge is no control: a click on it opens its thread, as a click
// anywhere on the card does. With `plugins.example.enabled: false` in config.json no card shows it.
// THREAD_CARD_BADGE_SHOTS=1 saves a screenshot of the cards to
// test-results/thread-card-badge/cards.png.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const RUN = Date.now().toString(36);
const GREETING = 'Good morning, orchard';
const PLAIN = 'Which trees need pruning?';

test.use({ viewport: { width: 1440, height: 900 }, video: 'off' });
test.describe.configure({ mode: 'serial' });

type Seed = { person: DisposableUser; roomId: string; greetingRoot: string; plainRoot: string };

let build: string | undefined;
let shippedConfig: Record<string, unknown> = {};
let seeded: Seed | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-thread-card-badge-build-'));
  const result = spawnSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: PLUGIN },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `the build with the plugin failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }
  shippedConfig = JSON.parse(readFileSync(join(build, 'config.json'), 'utf8'));

  const person = await registerDisposableUser(`plugin_badge_${RUN}`, 'plugin-badge-pass');
  const agent = await registerAgentAccount(HOMESERVER, 'greeter');
  const roomId = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: 'Orchard',
    topic: 'Where the example plugin marks a thread card',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const reply = (root: string, body: string) => ({
    msgtype: 'm.text',
    body,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: root,
      is_falling_back: true,
      'm.in_reply_to': { event_id: root },
    },
  });
  const greetingRoot = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: GREETING,
    'com.example.greeting': { text: GREETING },
  });
  await sendRoomMessage(
    HOMESERVER,
    person.accessToken,
    roomId,
    reply(greetingRoot, 'Good morning to you too')
  );
  const plainRoot = await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: PLAIN,
  });
  await sendRoomMessage(
    HOMESERVER,
    agent.accessToken,
    roomId,
    reply(plainRoot, 'The apple trees by the wall.')
  );
  seeded = { person, roomId, greetingRoot, plainRoot };
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/**
 * Serves the build, with `plugins` as config.json's plugin sections, on a new origin, and runs
 * `check` in a page of a new browser context there, signed in and in the room's Compact view.
 */
const onBuild = async (
  browser: Browser,
  plugins: Record<string, unknown>,
  check: (page: Page, data: Seed) => Promise<void>
) => {
  writeFileSync(join(build!, 'config.json'), JSON.stringify({ ...shippedConfig, plugins }));
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    const data = seeded!;
    await loginWithPassword(page, { homeserver: HOMESERVER, ...data.person });
    await page.goto(`/home/${encodeURIComponent(data.roomId)}/`);
    await setRoomCompact(page, true);
    await check(page, data);
  } finally {
    await context.close();
    await server.close();
  }
};

const card = (page: Page, rootId: string) =>
  page.locator(`[data-compact-room-view] button[data-thread-root-id="${rootId}"]`);

const badgeOf = (page: Page, rootId: string) =>
  card(page, rootId).locator('[data-compact-card-metadata] [data-example-plugin-badge]');

test("the card of a thread a greeting begins shows the plugin's badge, which opens the thread", ({
  browser,
}) =>
  onBuild(browser, {}, async (page, { greetingRoot, plainRoot }) => {
    await expect(card(page, plainRoot)).toBeVisible({ timeout: 60_000 });
    await expect(badgeOf(page, greetingRoot)).toHaveText('Greeting', { timeout: 60_000 });
    await expect(card(page, plainRoot).locator('[data-example-plugin-badge]')).toHaveCount(0);
    if (process.env.THREAD_CARD_BADGE_SHOTS === '1') {
      mkdirSync('test-results/thread-card-badge', { recursive: true });
      await page.screenshot({ path: 'test-results/thread-card-badge/cards.png' });
    }

    await badgeOf(page, greetingRoot).click();
    await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(greetingRoot)}`));
  }));

test('plugins.example.enabled: false shows no badge on any card', ({ browser }) =>
  onBuild(browser, { example: { enabled: false } }, async (page, { greetingRoot, plainRoot }) => {
    await expect(card(page, greetingRoot)).toBeVisible({ timeout: 60_000 });
    await expect(card(page, plainRoot)).toBeVisible();
    await expect(page.locator('[data-example-plugin-badge]')).toHaveCount(0);
  }));
