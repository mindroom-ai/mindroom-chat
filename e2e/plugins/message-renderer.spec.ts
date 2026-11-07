import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { buildLoginPath } from '../env';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. A MindRoom agent's reply that
// carries the plugin's content key renders through the plugin, with the label from the plugin's
// config.json section; a person's message with the same key renders as the app renders it.
// `?plugins=off`, on the page itself or on the sign-in page the session started from, and
// `plugins.example.enabled: false` show the app's own rendering of the reply instead. A second
// plugin installed its own copy of a package the app bundles too, which the build accepts as the
// plugin's. Without a label in config.json the plugin shows its own, from its strings: English, and
// German once the app's language is German, without a reload, also in a reply that rendered while
// the plugin's German strings were still loading. Set PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'client-plugin-password';
const RUN = Date.now().toString(36);
const GREETING = 'Hello from the example plugin';
const GERMAN_LABEL = 'Beispiel-Plugin';
const AGENT_BODY = 'Plain body of the agent reply';
const PERSON_BODY = 'Plain body of a person';

test.use({ viewport: { width: 1280, height: 800 } });
test.describe.configure({ mode: 'serial' });

type Seed = {
  person: DisposableUser;
  roomId: string;
  rootId: string;
  agentReplyId: string;
  personMessageId: string;
};

let build: string | undefined;
let ownPackages: string | undefined;
let shippedConfig: Record<string, unknown> = {};
let seeded: Seed | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-build-'));
  ownPackages = mkdtempSync(join(tmpdir(), 'mindroom-plugin-own-packages-'));
  cpSync(resolve('node_modules/linkifyjs'), join(ownPackages, 'node_modules/linkifyjs'), {
    recursive: true,
  });
  writeFileSync(
    join(ownPackages, 'package.json'),
    JSON.stringify({
      name: 'own-packages-plugin',
      version: '1.0.0',
      mindroomClientPlugin: { id: 'own-packages', apiVersion: 1, entry: './index.js' },
    })
  );
  writeFileSync(
    join(ownPackages, 'index.js'),
    "import { find } from 'linkifyjs';\nexport default { messageRenderers: [], find };\n"
  );
  const result = spawnSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: `${PLUGIN},${ownPackages}` },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `the build with the plugins failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }
  shippedConfig = JSON.parse(readFileSync(join(build, 'config.json'), 'utf8'));

  const person = await registerDisposableUser(`plugin_person_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'greeter');
  const roomId = await createRoom(HOMESERVER, person.accessToken, {
    name: 'Plugin room',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Greet me, please.',
  });
  const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: rootId } };
  const agentReplyId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: AGENT_BODY,
    'com.example.greeting': { text: GREETING },
    ...inThread,
  });
  const personMessageId = await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: PERSON_BODY,
    'com.example.greeting': { text: 'Not from an agent' },
    ...inThread,
  });
  seeded = { person, roomId, rootId, agentReplyId, personMessageId };
});

test.afterAll(() => {
  for (const dir of [build, ownPackages]) if (dir) rmSync(dir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/**
 * Serves the build, with `plugins` as config.json's plugin sections, on a new origin, and runs
 * `check` in a page of a new browser context there.
 */
const onBuild = async (
  browser: Browser,
  plugins: Record<string, unknown>,
  check: (page: Page, data: Seed) => Promise<void>,
  options: BrowserContextOptions = {}
) => {
  writeFileSync(join(build!, 'config.json'), JSON.stringify({ ...shippedConfig, plugins }));
  const server = await serveBuild(build!);
  const context = await browser.newContext({ ...options, baseURL: server.origin });
  const page = await context.newPage();
  try {
    await check(page, seeded!);
  } finally {
    await context.close();
    await server.close();
  }
};

const signIn = (page: Page, { person }: Seed) =>
  loginWithPassword(page, { homeserver: HOMESERVER, ...person });

const threadPath = ({ roomId, rootId }: Seed) =>
  `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;

const shot = async (page: Page, name: string) => {
  const directory = process.env.PLUGIN_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

const row = (page: Page, eventId: string) => page.locator(`[data-message-id="${eventId}"]`);

/** Waits for the thread's replies, then returns the agent's reply row. */
const agentReply = async (page: Page, data: Seed) => {
  await expect(row(page, data.personMessageId)).toContainText(PERSON_BODY, { timeout: 60_000 });
  return row(page, data.agentReplyId);
};

const expectCoreRendering = async (page: Page, data: Seed, name: string) => {
  const reply = await agentReply(page, data);
  await expect(reply).toContainText(AGENT_BODY);
  await expect(reply.locator('[data-example-plugin]')).toHaveCount(0);
  await shot(page, name);
};

test("an agent's reply renders through the plugin, a person's message as the app renders it", ({
  browser,
}) =>
  onBuild(browser, { example: { label: 'From config' } }, async (page, data) => {
    await signIn(page, data);
    await page.goto(threadPath(data));
    const reply = await agentReply(page, data);
    await expect(reply.locator('[data-example-plugin]')).toHaveText(`From config: ${GREETING}`);
    await expect(reply).not.toContainText(AGENT_BODY);
    await shot(page, 'plugin');
    await expect(row(page, data.personMessageId).locator('[data-example-plugin]')).toHaveCount(0);
  }));

test('?plugins=off shows the reply as the app renders it', ({ browser }) =>
  onBuild(browser, {}, async (page, data) => {
    await signIn(page, data);
    await page.goto(`${threadPath(data)}&plugins=off`);
    await expectCoreRendering(page, data, 'plugins-off');
  }));

test('?plugins=off on the sign-in page holds for the rest of that page load', ({ browser }) =>
  onBuild(browser, {}, async (page, data) => {
    await page.goto(`${buildLoginPath(HOMESERVER)}?plugins=off`);
    await page.locator('input[name="usernameInput"]').fill(data.person.username);
    await page.locator('input[name="passwordInput"]').fill(data.person.password);
    await page.evaluate(() => {
      (window as { pluginSpecLoad?: boolean }).pluginSpecLoad = true;
    });
    await page.getByRole('button', { name: 'Login' }).click();
    await waitForLoggedInShell(page);
    // Into the thread without loading the page again, as the app's own links go.
    await page.evaluate((path) => {
      window.history.pushState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, threadPath(data));
    await expectCoreRendering(page, data, 'plugins-off-from-sign-in');
    expect(await page.evaluate(() => (window as { pluginSpecLoad?: boolean }).pluginSpecLoad)).toBe(
      true
    );
    expect(new URL(page.url()).searchParams.get('plugins')).toBeNull();
  }));

test('plugins.example.enabled: false shows the reply as the app renders it', ({ browser }) =>
  onBuild(browser, { example: { enabled: false, label: 'From config' } }, async (page, data) => {
    await signIn(page, data);
    await page.goto(threadPath(data));
    await expectCoreRendering(page, data, 'plugin-disabled');
  }));

/** Picks `language` on the Language & region page of Settings, then closes Settings. */
const pickLanguage = async (page: Page, language: string) => {
  await chooseFromAccountMenu(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('button', { name: 'Language & region', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('menuitemradio', { name: language, exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
};

test("the plugin's label follows the language picked in Settings, without a reload", ({
  browser,
}) =>
  onBuild(browser, {}, async (page, data) => {
    await signIn(page, data);
    await page.goto(threadPath(data));
    const label = (await agentReply(page, data)).locator('[data-example-plugin]');
    await expect(label).toHaveText(`Example plugin: ${GREETING}`);
    await page.evaluate(() => {
      (window as { pluginSpecLoad?: boolean }).pluginSpecLoad = true;
    });

    await pickLanguage(page, 'Deutsch');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(label).toHaveText(`${GERMAN_LABEL}: ${GREETING}`);
    await shot(page, 'plugin-german');
    expect(await page.evaluate(() => (window as { pluginSpecLoad?: boolean }).pluginSpecLoad)).toBe(
      true
    );
  }));

test("a reply that renders while the plugin's German strings load shows them when they arrive", ({
  browser,
}) =>
  onBuild(
    browser,
    {},
    async (page, data) => {
      await signIn(page, data);
      // The build's chunk of the plugin's German strings answers only once released.
      let release: () => void = () => undefined;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let held = false;
      await page.route('**/*.js', async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        if (body.includes(GERMAN_LABEL)) {
          held = true;
          await released;
        }
        await route.fulfill({ response, body });
      });
      await page.evaluate(() => localStorage.setItem('i18nextLng', 'de'));
      await page.goto(threadPath(data));

      const label = (await agentReply(page, data)).locator('[data-example-plugin]');
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      await expect(label).toHaveText(`Example plugin: ${GREETING}`);
      await expect.poll(() => held).toBe(true);

      release();
      await expect(label).toHaveText(`${GERMAN_LABEL}: ${GREETING}`);
      await shot(page, 'plugin-german-late');
    },
    // Requests a service worker makes pass by the page's routes.
    { serviceWorkers: 'block' }
  ));
