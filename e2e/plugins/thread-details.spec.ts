import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
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
import { touch } from '../helpers/touch';

// The example plugin's details appear in a Compact card's desktop hover card and in its
// actions menu, reached by right click on desktop or a long press on a phone. A plain thread
// has no hover card. THREAD_DETAILS_SHOTS=1 saves both themes and the phone menu to
// test-results/thread-details/.
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
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-thread-details-build-'));
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

  const person = await registerDisposableUser(`plugin_details_${RUN}`, 'plugin-details-pass');
  const agent = await registerAgentAccount(HOMESERVER, 'greeter');
  const roomId = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: 'Orchard',
    topic: 'Where the example plugin shows thread details',
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
  check: (page: Page, data: Seed) => Promise<void>,
  contextOptions: BrowserContextOptions = {}
) => {
  writeFileSync(join(build!, 'config.json'), JSON.stringify({ ...shippedConfig, plugins }));
  const server = await serveBuild(build!);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    ...contextOptions,
    baseURL: server.origin,
  });
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

const screenshot = async (page: Page, name: string) => {
  if (process.env.THREAD_DETAILS_SHOTS !== '1') return;
  mkdirSync('test-results/thread-details', { recursive: true });
  await page.screenshot({ path: `test-results/thread-details/${name}.png` });
};

test('desktop hover shows greeting details in both themes, but plain cards have none', ({
  browser,
}) =>
  onBuild(browser, {}, async (page, { greetingRoot, plainRoot }) => {
    await expect(card(page, plainRoot)).toBeVisible({ timeout: 60_000 });
    const details = page.locator('[data-thread-card-details] [data-example-plugin-details]');
    await card(page, greetingRoot).hover();
    await expect(details).toBeVisible();
    await expect(details).toContainText('Greeting');
    await expect(details).toContainText(GREETING);
    await screenshot(page, 'hover-light');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html[data-theme-kind="dark"]')).toHaveCount(1);
    await card(page, greetingRoot).hover();
    await expect(details).toBeVisible();
    await expect(details).toContainText('Greeting');
    await expect(details).toContainText(GREETING);
    await screenshot(page, 'hover-dark');

    await card(page, plainRoot).hover();
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-thread-card-details]')).toHaveCount(0);
  }));

test('desktop right click puts greeting details before Open thread and Escape closes the menu', ({
  browser,
}) =>
  onBuild(browser, {}, async (page, { greetingRoot }) => {
    await expect(card(page, greetingRoot)).toBeVisible({ timeout: 60_000 });
    await card(page, greetingRoot).click({ button: 'right' });
    const menu = page.getByRole('menu');
    const details = menu.locator('[data-thread-details]');
    await expect(details).toBeVisible();
    await expect(details).toContainText('Greeting');
    await expect(details).toContainText(GREETING);
    const firstItem = menu.getByRole('menuitem').first();
    await expect(firstItem).toHaveText('Open thread');
    expect(
      await details.evaluate((element) => {
        const item = element.closest('[role="menu"]')?.querySelector('[role="menuitem"]');
        return (
          !!item && !!(element.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      })
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }));

test('a phone long press shows greeting details without opening the thread', ({ browser }) =>
  onBuild(
    browser,
    {},
    async (page, { greetingRoot }) => {
      const greetingCard = card(page, greetingRoot);
      await expect(greetingCard).toBeVisible({ timeout: 60_000 });
      const result = await touch(greetingCard, [
        { type: 'start' },
        { type: 'wait', ms: 700 },
        { type: 'end' },
      ]);
      expect(result.liftAllowed).toBe(false);
      const details = page.getByRole('menu').locator('[data-thread-details]');
      await expect(details).toBeVisible();
      await expect(details).toContainText('Greeting');
      await expect(details).toContainText(GREETING);
      expect(new URL(page.url()).searchParams.has('threadId')).toBe(false);
      await screenshot(page, 'phone-menu');
    },
    {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 3,
    }
  ));
