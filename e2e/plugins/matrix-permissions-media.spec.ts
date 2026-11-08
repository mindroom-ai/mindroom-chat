import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver, which serves authenticated
// media. The plugin reads the room through the client SDK's `matrix` subpath: an agent's greeting
// shows the agent's avatar, through the authenticated media endpoint once the app's service worker
// adds the access token, and is marked as an agent's; the plugin's panel says the viewer may post,
// and that the viewer may not once a moderator raises the room's message level above the viewer's.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'client-plugin-password';
const RUN = Date.now().toString(36);

test.use({ viewport: { width: 1600, height: 1000 } });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-matrix-build-'));
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

test("the example plugin shows an agent's avatar and mark, and whether the viewer may post", async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.setTimeout(5 * 60_000);

  const moderator = await registerDisposableUser(`plugin_moderator_${RUN}`, PASSWORD);
  const viewer = await registerDisposableUser(`plugin_viewer_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'avatar');
  const uploaded = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=avatar.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${agent.accessToken}`, 'Content-Type': 'image/png' },
    body: readFileSync(resolve('public/res/icons/mindroom-192.png')),
  });
  expect(uploaded.status).toBe(200);
  const { content_uri: avatarUrl } = (await uploaded.json()) as { content_uri: string };
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/avatar_url`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });
  const roomId = await createRoom(HOMESERVER, moderator.accessToken, {
    name: 'Plugin permissions',
    invite: [viewer.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, moderator.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Greet us, please.',
  });
  const greetingId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Hello from an agent',
    'com.example.greeting': { text: 'Hello from an agent' },
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });

  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...viewer });
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);

    const sender = page.locator(`[data-message-id="${greetingId}"] [data-example-plugin-sender]`);
    await expect(sender).toHaveText(`From ${agent.userId}, a MindRoom agent`, { timeout: 60_000 });
    // The avatar loads from the authenticated endpoint once the service worker controls the page.
    const avatar = sender.locator('img');
    await expect
      .poll(
        () =>
          avatar.evaluate((image: HTMLImageElement) => ({
            authenticated: image.src.includes('/_matrix/client/v1/media/thumbnail/'),
            loaded: image.complete && image.naturalWidth > 0,
          })),
        { timeout: 60_000 }
      )
      .toEqual({ authenticated: true, loaded: true });

    await roomMoreOptions(page).click();
    await page.getByRole('menuitemcheckbox', { name: 'Example panel', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Example panel', exact: true });
    await expect(panel).toContainText('You may post here');

    const path = `/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`;
    const levels = await matrixFetch<{ events?: Record<string, number> }>(HOMESERVER, path, {
      accessToken: moderator.accessToken,
    });
    await sendStateEvent(HOMESERVER, moderator.accessToken, roomId, 'm.room.power_levels', '', {
      ...levels,
      events: { ...levels.events, 'm.room.message': 50 },
    });
    await expect(panel).toContainText('You may not post here', { timeout: 30_000 });
  } finally {
    await context.close();
    await server.close();
  }
});
