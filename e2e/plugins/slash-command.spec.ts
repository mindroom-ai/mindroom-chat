import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom, createThreadFixture, matrixFetch } from '../helpers/matrix';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. The plugin's slash commands,
// `/greet` and `/subroom`, show in the composer's command menu after the app's own, in the order the
// plugin lists them, with their descriptions. Run with a text, `/greet` sends the room the plugin's
// notice and no message of its own; without one it refuses with its usage as a built-in command
// does: the text stays in the composer with the usage line above it, which names the command and
// gives its description in the app's language, and the composer still sends. Typed in a thread, it
// greets that thread.
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

/**
 * The room's newest messages first, as the msgtype and body of each and the root of the thread it
 * is in (null outside threads).
 */
const messages = async (accessToken: string, roomId: string) => {
  const { chunk } = await matrixFetch<{
    chunk: Array<{ type: string; content: Record<string, unknown> }>;
  }>(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`, {
    accessToken,
  });
  return chunk
    .filter(({ type }) => type === 'm.room.message')
    .map(({ content }) => {
      const relation = content['m.relates_to'] as
        | { rel_type?: string; event_id?: string }
        | undefined;
      const thread = relation?.rel_type === 'm.thread' ? relation.event_id : null;
      return [content.msgtype, content.body, thread];
    });
};

test("the example plugin's slash commands show in the command menu, and /greet runs in the room", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  const person = await registerDisposableUser(`plugin_command_${RUN}`, 'plugin-command-password');
  const roomId = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: 'Greetings',
    topic: 'Where the example plugin greets',
  });
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  const composer = page.locator('[data-editable-name="RoomInput"]');
  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    await expect(composer).toBeVisible({ timeout: 60_000 });

    await composer.click();
    await page.keyboard.type('/');
    const commands = page.locator('[data-slash-command]');
    await expect(page.locator('[data-slash-command="greet"]')).toContainText(
      'Send the room a greeting. Example: /greet Hello'
    );
    await expect(page.locator('[data-slash-command="subroom"]')).toContainText(
      'Create a sub-room of this room. Example: /subroom Ideas'
    );
    const names = await commands.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-slash-command'))
    );
    expect(names.slice(-2)).toEqual(['greet', 'subroom']);
    await shot('command-menu');

    // Tab takes the only command left and leaves room for the text.
    await page.keyboard.type('gr');
    await expect(commands).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(composer).toContainText('/greet');
    await page.keyboard.type('Hello there');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => messages(person.accessToken, roomId), { timeout: 30_000 })
      .toEqual([['m.notice', 'Example greeting: Hello there', null]]);
    await expect(page.getByText('Example greeting: Hello there')).toBeVisible();
    await expect(composer).not.toContainText('/greet');
    await shot('greeted');

    // The space ends the word, so no menu takes the Enter.
    await page.keyboard.type('/greet ');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('alert').filter({
        hasText: 'Could not run /greet. Send the room a greeting. Example: /greet Hello',
      })
    ).toBeVisible();
    await expect(composer).toContainText('/greet');
    await shot('usage');

    await composer.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Still sending');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => messages(person.accessToken, roomId), { timeout: 30_000 })
      .toEqual([
        ['m.text', 'Still sending', null],
        ['m.notice', 'Example greeting: Hello there', null],
      ]);

    await page.evaluate(() => localStorage.setItem('i18nextLng', 'de'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await composer.click();
    await page.keyboard.type('/greet ');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('alert').filter({
        hasText:
          '/greet konnte nicht ausgeführt werden. Dem Raum einen Gruß senden. Beispiel: /greet Hallo',
      })
    ).toBeVisible();
    await expect(composer).toContainText('/greet');
    await shot('usage-german');
  } finally {
    // The page's live sync may still be in a route.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
});

test("the example plugin's slash command greets the thread it was typed in", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  const person = await registerDisposableUser(`plugin_thread_${RUN}`, 'plugin-command-password');
  const thread = await createThreadFixture(HOMESERVER, person.accessToken, {
    name: 'Greetings in threads',
    topic: 'Where the example plugin greets a thread',
    rootBody: 'Who wants a greeting?',
    replyBody: 'Me, in the thread',
  });
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  const composer = page.locator('[data-editable-name="RoomInput"]');
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
    await page.goto(
      `/home/${encodeURIComponent(thread.roomId)}?threadId=${encodeURIComponent(thread.rootId)}`
    );
    await expect(page.getByText(thread.replyBody, { exact: true })).toBeVisible({
      timeout: 60_000,
    });

    await composer.click();
    await page.keyboard.type('/greet Hi');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => messages(person.accessToken, thread.roomId), { timeout: 30_000 })
      .toEqual([
        ['m.notice', 'Example greeting: Hi', thread.rootId],
        ['m.text', thread.replyBody, thread.rootId],
        ['m.text', thread.rootBody, null],
      ]);
    await expect(page.getByText('Example greeting: Hi')).toBeVisible();
    await expect(composer).not.toContainText('/greet');
    await page.screenshot({ path: testInfo.outputPath('greeted-thread.png') });
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
});
