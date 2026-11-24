import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
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

// Production build with the default-on example client plugin and a temporary default-off opt-in
// fixture plugin (plus any directories in MINDROOM_CLIENT_PLUGINS if set), served against the
// disposable homeserver. Verifies Settings -> Plugins toggles both immediately without reload,
// persists across reloads via io.mindroom.settings, keeps Settings -> Plugins visible, and
// restores both when toggled back.
// Set PLUGIN_SETTINGS_SHOTS=<dir> to save dark and light screenshots of Settings -> Plugins.
const EXAMPLE_PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const RUN = Date.now().toString(36);
const GREETING = 'Good morning, orchard';
const PLAIN = 'Which trees need pruning?';

const createOptInPlugin = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'mindroom-opt-in-plugin-'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'opt-in-client-plugin',
      version: '1.0.0',
      private: true,
      description: 'Default-off fixture plugin for Settings -> Plugins E2E.',
      mindroomClientPlugin: {
        id: 'opt-in',
        name: 'Opt-in',
        apiVersion: 67,
        defaultEnabled: false,
        entry: './index.tsx',
      },
    })
  );
  writeFileSync(
    join(dir, 'index.tsx'),
    [
      "import type { ClientPlugin, ThreadCardBadgeProps } from '@mindroom/client-sdk/core';",
      'function OptInBadge({ room, threadId }: ThreadCardBadgeProps) {',
      '  const root = room.getThread(threadId)?.rootEvent ?? room.findEventById(threadId);',
      "  const greeting = root?.getContent()?.['com.example.greeting'];",
      "  if (typeof greeting !== 'object' || greeting === null) return null;",
      '  return <span data-opt-in-plugin-badge>Opt-in</span>;',
      '}',
      'const plugin: ClientPlugin = { threadCardBadges: [{ Component: OptInBadge }] };',
      'export default plugin;',
    ].join('\n')
  );
  return dir;
};

const resolveBuildPlugins = (optInDir: string): string => {
  const configured = (process.env.MINDROOM_CLIENT_PLUGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const withExample = configured.some((dir) => resolve(dir) === EXAMPLE_PLUGIN)
    ? configured
    : [...configured, EXAMPLE_PLUGIN];
  return [...withExample, optInDir].join(',');
};

test.use({ viewport: { width: 1440, height: 900 }, video: 'off' });
test.describe.configure({ mode: 'serial' });

type Seed = { person: DisposableUser; roomId: string; greetingRoot: string; plainRoot: string };

let build: string | undefined;
let optInPlugin: string | undefined;
let shippedConfig: Record<string, unknown> = {};
let seeded: Seed | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  optInPlugin = createOptInPlugin();
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-settings-build-'));
  const result = spawnSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: resolveBuildPlugins(optInPlugin) },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `the build with plugins failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }
  shippedConfig = JSON.parse(readFileSync(join(build, 'config.json'), 'utf8')) as Record<
    string,
    unknown
  >;

  const person = await registerDisposableUser(`plugin_settings_${RUN}`, 'plugin-settings-pass');
  const agent = await registerAgentAccount(HOMESERVER, 'greeter');
  const roomId = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: 'Orchard',
    topic: 'Where Settings -> Plugins toggles the example plugin',
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
  if (optInPlugin) rmSync(optInPlugin, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const onBuild = async (
  browser: Browser,
  plugins: Record<string, unknown>,
  check: (page: Page, data: Seed) => Promise<void>
) => {
  if (!build || !seeded) throw new Error('Plugin settings E2E build or seed did not initialize');
  writeFileSync(join(build, 'config.json'), JSON.stringify({ ...shippedConfig, plugins }));
  const server = await serveBuild(build);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...seeded.person });
    await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
    await setRoomCompact(page, true);
    await check(page, seeded);
  } finally {
    await context.close();
    await server.close();
  }
};

const card = (page: Page, rootId: string) =>
  page.locator(`[data-compact-room-view] button[data-thread-root-id="${rootId}"]`);

const exampleBadgeOf = (page: Page, rootId: string) =>
  card(page, rootId).locator('[data-compact-card-metadata] [data-example-plugin-badge]');

const optInBadgeOf = (page: Page, rootId: string) =>
  card(page, rootId).locator('[data-compact-card-metadata] [data-opt-in-plugin-badge]');

const openPluginsSettings = async (page: Page) => {
  await chooseFromAccountMenu(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'Plugins', exact: true })
    .click();
  return dialog;
};

test('Settings -> Plugins toggles default-on and default-off plugins immediately, persists across reload, and restores both', ({
  browser,
}) =>
  onBuild(browser, {}, async (page, { greetingRoot, plainRoot }) => {
    await expect(card(page, plainRoot)).toBeVisible({ timeout: 60_000 });
    await expect(exampleBadgeOf(page, greetingRoot)).toHaveText('Greeting', { timeout: 60_000 });
    await expect(optInBadgeOf(page, greetingRoot)).toHaveCount(0);

    const dialog = await openPluginsSettings(page);
    const exampleSwitch = dialog.getByRole('switch', { name: 'Example', exact: true });
    const optInSwitch = dialog.getByRole('switch', { name: 'Opt-in', exact: true });
    await expect(exampleSwitch).toBeChecked();
    await expect(optInSwitch).not.toBeChecked();

    const shotsDir = process.env.PLUGIN_SETTINGS_SHOTS?.trim();
    if (shotsDir) {
      mkdirSync(shotsDir, { recursive: true });
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html[data-theme-kind="dark"]')).toHaveCount(1);
      await page.screenshot({ path: join(shotsDir, 'settings-plugins-dark.png') });
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(page.locator('html[data-theme-kind="light"]')).toHaveCount(1);
      await page.screenshot({ path: join(shotsDir, 'settings-plugins-light.png') });
    }

    await exampleSwitch.click();
    await expect(exampleSwitch).not.toBeChecked();
    await optInSwitch.click();
    await expect(optInSwitch).toBeChecked();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(exampleBadgeOf(page, greetingRoot)).toHaveCount(0, { timeout: 15_000 });
    await expect(optInBadgeOf(page, greetingRoot)).toHaveText('Opt-in', { timeout: 15_000 });

    await page.reload();
    await expect(card(page, greetingRoot)).toBeVisible({ timeout: 60_000 });
    await expect(exampleBadgeOf(page, greetingRoot)).toHaveCount(0);
    await expect(optInBadgeOf(page, greetingRoot)).toHaveText('Opt-in', { timeout: 60_000 });

    const reopened = await openPluginsSettings(page);
    const persistedExample = reopened.getByRole('switch', { name: 'Example', exact: true });
    const persistedOptIn = reopened.getByRole('switch', { name: 'Opt-in', exact: true });
    await expect(persistedExample).not.toBeChecked();
    await expect(persistedOptIn).toBeChecked();
    await persistedExample.click();
    await expect(persistedExample).toBeChecked();
    await persistedOptIn.click();
    await expect(persistedOptIn).not.toBeChecked();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(exampleBadgeOf(page, greetingRoot)).toHaveText('Greeting', { timeout: 60_000 });
    await expect(optInBadgeOf(page, greetingRoot)).toHaveCount(0, { timeout: 15_000 });
  }));
