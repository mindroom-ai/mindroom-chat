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
// the plugin's German strings were still loading. The plugin's pages open from their links, one
// with the app's rail and one filling the window; an unknown plugin's page, and the example's with
// `?plugins=off` or `enabled: false`, say "Page not found" where they are. Activity (the bell's
// popover and its page) and the Threads page preview an agent's greeting reply as the plugin does,
// "Greeting: <text>", in German too once the app is, and a person's as its body; a thread an agent's
// greeting starts takes that line as its title. With the plugin off, they show the bodies. Set
// PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'client-plugin-password';
const RUN = Date.now().toString(36);
const GREETING = 'Hello from the example plugin';
const GERMAN_LABEL = 'Beispiel-Plugin';
const AGENT_BODY = 'Plain body of the agent reply';
const PERSON_BODY = 'Plain body of a person';
const ROW_GREETING = 'Hello from a row';
const ROW_AGENT_BODY = 'Plain body of the agent row reply';
const ROW_PERSON_BODY = 'Plain body of the person row reply';
const CARD_GREETING = 'A thread from a greeting';
const CARD_BODY = 'Plain body of the greeting root';
const AGENT_ROOT = `Thread with an agent greeting ${RUN}`;
const PERSON_ROOT = `Thread with a person greeting ${RUN}`;

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
  // The third-party notices read a plugin's installed packages from its lockfile.
  const { version: linkifyVersion } = JSON.parse(
    readFileSync(resolve('node_modules/linkifyjs/package.json'), 'utf8')
  ) as { version: string };
  writeFileSync(
    join(ownPackages, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/linkifyjs': { version: linkifyVersion } },
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
  const other = await registerDisposableUser(`plugin_other_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'greeter');
  const roomId = await createRoom(HOMESERVER, person.accessToken, {
    name: 'Plugin room',
    invite: [agent.userId, other.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await joinRoom(HOMESERVER, other.accessToken, roomId);
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

  // The rows' threads: an agent's greeting reply, a person's, and a thread a greeting starts.
  const send = (user: { accessToken: string }, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, user.accessToken, roomId, { msgtype: 'm.text', ...content });
  const reply = (root: string) => ({ 'm.relates_to': { rel_type: 'm.thread', event_id: root } });
  const agentRoot = await send(person, { body: AGENT_ROOT });
  await send(agent, {
    body: ROW_AGENT_BODY,
    'com.example.greeting': { text: ROW_GREETING },
    ...reply(agentRoot),
  });
  const personRoot = await send(person, { body: PERSON_ROOT });
  await send(other, {
    body: ROW_PERSON_BODY,
    'com.example.greeting': { text: ROW_GREETING },
    ...reply(personRoot),
  });
  const cardRoot = await send(agent, {
    body: CARD_BODY,
    'com.example.greeting': { text: CARD_GREETING },
  });
  await send(person, { body: 'Thanks for the greeting', ...reply(cardRoot) });
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

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });
const examplePage = (page: Page) => page.locator('[data-example-page]');
const windowPage = (page: Page) => page.locator('[data-example-window-page]');

test("the plugin's pages open from their links, with the rail and filling the window", ({
  browser,
}) =>
  onBuild(browser, {}, async (page, data) => {
    await signIn(page, data);
    await page.goto('/p/example/');
    await expect(examplePage(page)).toBeVisible({ timeout: 30_000 });
    await expect(rail(page)).toBeVisible();
    await shot(page, 'plugin-page');
    const toWindow = page.getByRole('link', { name: 'Fill the window' });
    await expect(toWindow).toHaveAttribute('href', '/p/example/window');
    await toWindow.click();
    await expect(windowPage(page)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/p\/example\/window$/);
    await expect(rail(page)).toHaveCount(0);
    await shot(page, 'plugin-page-window');
    await page.getByRole('link', { name: 'Back to the rail' }).click();
    await expect(examplePage(page)).toBeVisible({ timeout: 30_000 });
    await expect(rail(page)).toBeVisible();
  }));

for (const [name, plugins, path] of [
  ['an unknown plugin', {}, '/p/unknown/'],
  ['?plugins=off', {}, '/p/example/?plugins=off'],
  ['plugins.example.enabled: false', { example: { enabled: false } }, '/p/example/'],
] as const) {
  test(`a plugin page says "Page not found" for ${name}`, ({ browser }) =>
    onBuild(browser, plugins, async (page, data) => {
      await signIn(page, data);
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(rail(page)).toBeVisible();
      await expect(examplePage(page)).toHaveCount(0);
      // It stays at the address: no redirect, and no space named "p".
      expect(new URL(page.url()).pathname).toBe(new URL(path, page.url()).pathname);
      await shot(page, `plugin-page-not-found-${name.replace(/\W+/g, '-')}`);
    }));
}

/** The rows of Activity's popover, Activity's page and the Threads page, as `name` shows them. */
const expectRows = async (
  page: Page,
  name: string,
  expected: { agentReply: string; cardTitle: string; hidden: string[] }
) => {
  const check = async (rows: ReturnType<Page['locator']>, place: string) => {
    const agentRow = rows.filter({ hasText: AGENT_ROOT });
    await expect(agentRow).toContainText(expected.agentReply, { timeout: 60_000 });
    await expect(rows.filter({ hasText: PERSON_ROOT })).toContainText(ROW_PERSON_BODY);
    await expect(rows.filter({ hasText: expected.cardTitle })).toHaveCount(1);
    for (const text of expected.hidden) await expect(rows.filter({ hasText: text })).toHaveCount(0);
    await shot(page, `${name}-${place}`);
  };
  const bell = page.getByRole('button', { name: /^(Activity|Aktivität)/ }).first();
  await bell.click();
  const popover = page.getByRole('dialog');
  await check(popover.locator('[data-activity-row]'), 'activity-popover');
  await page.keyboard.press('Escape');
  await page.goto('/activity/');
  await check(page.locator('[data-activity-row]'), 'activity-page');
  await page.goto('/threads/');
  await page.getByRole('radio', { name: /^(All|Alle)$/ }).click();
  await check(page.getByRole('navigation').getByRole('button'), 'threads-page');
};

const pluginRows = (language: 'en' | 'de' = 'en') => {
  const label = language === 'de' ? 'Gruß' : 'Greeting';
  return {
    agentReply: `${label}: ${ROW_GREETING}`,
    cardTitle: `${label}: ${CARD_GREETING}`,
    hidden: [ROW_AGENT_BODY, CARD_BODY],
  };
};

const coreRows = {
  agentReply: ROW_AGENT_BODY,
  cardTitle: CARD_BODY,
  hidden: [`Greeting: ${ROW_GREETING}`, `Greeting: ${CARD_GREETING}`],
};

test("Activity and the Threads page preview an agent's greeting through the plugin", ({
  browser,
}) =>
  onBuild(browser, {}, async (page, data) => {
    await signIn(page, data);
    await page.goto('/home/');
    await expectRows(page, 'rows', pluginRows());
  }));

test('the rows read the German preview once the app is German, without a reload', ({ browser }) =>
  onBuild(browser, {}, async (page, data) => {
    await signIn(page, data);
    await page.goto('/threads/');
    await page.getByRole('radio', { name: 'All' }).click();
    const rows = page.getByRole('navigation').getByRole('button');
    await expect(rows.filter({ hasText: AGENT_ROOT })).toContainText(`Greeting: ${ROW_GREETING}`, {
      timeout: 60_000,
    });
    await page.evaluate(() => {
      (window as { pluginSpecLoad?: boolean }).pluginSpecLoad = true;
    });
    await pickLanguage(page, 'Deutsch');
    await expect(rows.filter({ hasText: AGENT_ROOT })).toContainText(`Gruß: ${ROW_GREETING}`);
    await expect(rows.filter({ hasText: `Gruß: ${CARD_GREETING}` })).toHaveCount(1);
    await shot(page, 'rows-german-threads-page');
    // Activity's popover, opened in the same page load.
    await page
      .getByRole('button', { name: /^Aktivität/ })
      .first()
      .click();
    const popoverRows = page.getByRole('dialog').locator('[data-activity-row]');
    await expect(popoverRows.filter({ hasText: AGENT_ROOT })).toContainText(
      `Gruß: ${ROW_GREETING}`
    );
    await shot(page, 'rows-german-activity-popover');
    expect(await page.evaluate(() => (window as { pluginSpecLoad?: boolean }).pluginSpecLoad)).toBe(
      true
    );
  }));

test('plugins.example.enabled: false previews every row by its body', ({ browser }) =>
  onBuild(browser, { example: { enabled: false } }, async (page, data) => {
    await signIn(page, data);
    await page.goto('/home/');
    await expectRows(page, 'rows-disabled', coreRows);
  }));

test('?plugins=off previews every row by its body', ({ browser }) =>
  onBuild(browser, {}, async (page, data) => {
    await page.goto(`${buildLoginPath(HOMESERVER)}?plugins=off`);
    await page.locator('input[name="usernameInput"]').fill(data.person.username);
    await page.locator('input[name="passwordInput"]').fill(data.person.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await waitForLoggedInShell(page);
    // The setting holds for the page load, so the lists open without loading the page again.
    const open = (path: string) =>
      page.evaluate((to) => {
        window.history.pushState(null, '', to);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, path);
    await open('/threads/');
    await page.getByRole('radio', { name: 'All' }).click();
    const rows = page.getByRole('navigation').getByRole('button');
    await expect(rows.filter({ hasText: AGENT_ROOT })).toContainText(ROW_AGENT_BODY, {
      timeout: 60_000,
    });
    await expect(rows.filter({ hasText: CARD_BODY })).toHaveCount(1);
    await expect(rows.filter({ hasText: `Greeting: ${ROW_GREETING}` })).toHaveCount(0);
    await open('/activity/');
    const activityRows = page.locator('[data-activity-row]');
    await expect(activityRows.filter({ hasText: AGENT_ROOT })).toContainText(ROW_AGENT_BODY, {
      timeout: 60_000,
    });
    await expect(activityRows.filter({ hasText: CARD_BODY })).toHaveCount(1);
    await shot(page, 'rows-plugins-off');
  }));
