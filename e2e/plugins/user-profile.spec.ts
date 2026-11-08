import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  setDirectAccountData,
  type MatrixSession,
} from '../helpers/matrix';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver, on a wide screen and on a
// phone. A greeting card shows its greeting in the plugin's side panel, where the name of the agent
// who sent it opens the app's profile card of the agent beside the name, through the client SDK's
// `useOpenUserProfile`, as a mention pill opens one: Escape closes it, and its Message button opens
// the direct chat with the agent. The panel also shows the signed-in person's own card
// (`UserProfileCard`), as the floating card that the timeline's sender name opens shows it.
// Set PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'plugin-profile-password';
const RUN = Date.now().toString(36);
const GREETING = 'Good morning';
const ALICE = 'Alice Example';
const AGENT = 'Greeter Agent';

let build: string | undefined;
let alice: DisposableUser;
let agent: MatrixSession;
let rootId = '';
let threadPath = '';
let directPath = '';

const setDisplayName = ({ userId, accessToken }: MatrixSession, displayname: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(userId)}/displayname`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify({ displayname }),
  });

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-profile-build-'));
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

  alice = await registerDisposableUser(`profile_alice_${RUN}`, PASSWORD);
  agent = await registerAgentAccount(HOMESERVER, 'greeter');
  await setDisplayName(alice, ALICE);
  await setDisplayName(agent, AGENT);
  const roomId = await createRoom(HOMESERVER, alice.accessToken, {
    name: `Profile cards ${RUN}`,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  rootId = await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Greet me, please.',
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: GREETING,
    'com.example.greeting': { text: GREETING },
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
  threadPath = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;
  // Alice's direct chat with the agent, which the card's Message button opens.
  const directId = await createRoom(HOMESERVER, alice.accessToken, {
    name: `Direct ${RUN}`,
    preset: 'trusted_private_chat',
    invite: [agent.userId],
  });
  await setDirectAccountData(HOMESERVER, alice.accessToken, alice.userId, agent.userId, directId);
  directPath = `/direct/${encodeURIComponent(directId)}`;
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const shot = async (page: Page, name: string) => {
  const directory = process.env.PLUGIN_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

/** The floating profile card of `userId`, as the app shows it. */
const floatingCard = (page: Page, userId: string) =>
  page.getByRole('dialog', { name: userId, exact: true });

/** Whether two boxes share no point: the card opens beside what opened it, not over it. */
const apart = async (one: Locator, other: Locator) => {
  const [a, b] = [await one.boundingBox(), await other.boundingBox()];
  if (!a || !b) return false;
  return (
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
  );
};

for (const [screen, tag, viewport] of [
  ['a wide screen', 'wide', { width: 1600, height: 1000 }],
  ['a phone', 'phone', { width: 390, height: 844 }],
] as const) {
  test(`on ${screen}, the example panel opens the greeting sender's profile card and shows the account's own`, async ({
    browser,
  }) => {
    test.setTimeout(5 * 60_000);
    const server = await serveBuild(build!);
    const context = await browser.newContext({ baseURL: server.origin, viewport });
    const page = await context.newPage();
    try {
      await loginWithPassword(page, { homeserver: HOMESERVER, ...alice });
      await page.goto(threadPath);
      const greeting = page.locator('[data-message-id]').filter({
        has: page.locator('[data-example-plugin]', { hasText: `Example plugin: ${GREETING}` }),
      });
      await expect(greeting).toHaveCount(1, { timeout: 60_000 });

      // Alice's own card, as the sender name of her message opens it in the timeline.
      const ownSender = page
        .locator(`[data-message-id="${rootId}"] [data-user-id="${alice.userId}"]`)
        .first();
      await ownSender.click();
      const ownFloating = floatingCard(page, alice.userId);
      await expect(ownFloating.getByRole('heading', { name: ALICE })).toBeVisible();
      const ownText = await ownFloating.innerText();
      await page.keyboard.press('Escape');
      await expect(ownFloating).toHaveCount(0);

      await greeting.getByRole('button', { name: 'Show in panel' }).click();
      const panel = page.getByRole('region', { name: 'Example panel', exact: true });
      await expect(panel).toContainText(`Greeting: ${GREETING}`);

      // The panel's own card of Alice shows what the floating one showed, without its frame.
      const inline = panel.locator('[data-example-plugin-own-card]');
      await inline.scrollIntoViewIfNeeded();
      await expect(inline).toHaveText(ownText, { useInnerText: true });
      await expect(panel.getByRole('dialog')).toHaveCount(0);
      await shot(page, `${tag}-inline-card`);

      // The sender's name opens the app's card of the agent beside it, as a mention pill does.
      const name = panel.getByRole('button', { name: AGENT, exact: true });
      await name.scrollIntoViewIfNeeded();
      await name.click();
      const card = floatingCard(page, agent.userId);
      await expect(card.getByRole('heading', { name: AGENT })).toBeVisible();
      await expect(card).toContainText(agent.userId);
      expect(await apart(card, name)).toBe(true);
      // Where the side it asks for has no room, as on a phone, the card goes where it fits.
      await expect(card).toBeInViewport({ ratio: 1 });
      await shot(page, `${tag}-floating-card`);

      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);
      await expect(panel).toContainText(`Greeting: ${GREETING}`);

      // Its Message button opens the direct chat with the agent, and the card closes.
      await name.click();
      await card.getByRole('button', { name: 'Message', exact: true }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(directPath);
      await expect(card).toHaveCount(0);
      await shot(page, `${tag}-direct-chat`);
    } finally {
      await context.close();
      await server.close();
    }
  });
}
