import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom, matrixFetch } from '../helpers/matrix';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. The plugin's slash command,
// `/greet`, shows in the composer's command menu after the app's own, with its description. Run
// with a text, it sends the room the plugin's notice and no message of its own; without one it fails
// as a built-in command fails: the text stays in the composer with the plugin's error above it, and
// the composer still sends.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const RUN = Date.now().toString(36);

test.use({ viewport: { width: 1280, height: 800 }, video: 'off' });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-command-build-'));
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
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

/** The room's newest messages first, as the msgtype and body of each. */
const messages = async (accessToken: string, roomId: string) => {
  const { chunk } = await matrixFetch<{
    chunk: Array<{ type: string; content: Record<string, unknown> }>;
  }>(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`, {
    accessToken,
  });
  return chunk
    .filter(({ type }) => type === 'm.room.message')
    .map(({ content }) => [content.msgtype, content.body]);
};

const composer = (page: Page) => page.locator('[data-editable-name="RoomInput"]');

test("the example plugin's slash command shows in the command menu and runs in the room", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  const person = await registerDisposableUser(`plugin_command_${RUN}`, 'plugin-command-password');
  const roomId = await createPrivateRoom(HOMESERVER, person.accessToken, { name: 'Greetings' });
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    await expect(composer(page)).toBeVisible({ timeout: 60_000 });

    await composer(page).click();
    await page.keyboard.type('/');
    const commands = page.locator('[data-slash-command]');
    await expect(page.locator('[data-slash-command="greet"]')).toContainText(
      'Send the room a greeting. Example: /greet Hello'
    );
    await expect(commands.last()).toHaveAttribute('data-slash-command', 'greet');
    await shot('command-menu');

    // Tab takes the only command left and leaves room for the text.
    await page.keyboard.type('gr');
    await expect(commands).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(composer(page)).toContainText('/greet');
    await page.keyboard.type('Hello there');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => messages(person.accessToken, roomId), { timeout: 30_000 })
      .toEqual([['m.notice', 'Example greeting: Hello there']]);
    await expect(page.getByText('Example greeting: Hello there')).toBeVisible();
    await expect(composer(page)).not.toContainText('/greet');
    await shot('greeted');

    // The space ends the word, so no menu takes the Enter.
    await page.keyboard.type('/greet ');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('alert').filter({ hasText: '/greet failed: Type a greeting after /greet.' })
    ).toBeVisible();
    await expect(composer(page)).toContainText('/greet');
    await shot('failed');

    await composer(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Still sending');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => messages(person.accessToken, roomId), { timeout: 30_000 })
      .toEqual([
        ['m.text', 'Still sending'],
        ['m.notice', 'Example greeting: Hello there'],
      ]);
  } finally {
    // The page's live sync may still be in a route.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
});
