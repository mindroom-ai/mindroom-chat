import { expect, test, type Page } from '@playwright/test';
import { activeAccountButtonNamePattern } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { roomViewSwitch } from '../helpers/roomViewSwitch';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Slash commands in the composer: typing `/` as the first word opens the command menu, a
// message command changes what is sent, a command that acts changes the room without sending a
// message, and one that cannot run keeps the text and says why. Runs against the disposable
// homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh).

const SERVER_NAME = 'matrix.localhost';
const PASSWORD = 'slash-commands-password';
const RUN = Date.now().toString(36);

type RoomEvent = { type: string; sender: string; content: Record<string, unknown> };

const register = async (username: string): Promise<string> => {
  const body = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  return body.access_token;
};

const signIn = async (page: Page, username: string) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 60_000,
  });
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible({
    timeout: 120_000,
  });
};

const composer = (page: Page) => page.locator('[data-editable-name="RoomInput"]');

/** A member's current `m.room.member` content, from the room's member list. */
const memberContent = async (token: string, roomId: string, userId: string) => {
  const { chunk } = await matrixFetch<{ chunk: Array<RoomEvent & { state_key: string }> }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/members`,
    { accessToken: token }
  );
  return chunk.find((event) => event.state_key === userId)?.content ?? {};
};

const latestMessages = async (token: string, roomId: string) => {
  const { chunk } = await matrixFetch<{ chunk: RoomEvent[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`,
    { accessToken: token }
  );
  return chunk.filter((event) => event.type === 'm.room.message');
};

test('slash commands: the menu, a message command, commands that act, and a refusal', async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );

  const owner = `slash_owner_${RUN}`;
  const guest = `slash_guest_${RUN}`;
  const token = await register(owner);
  await register(guest);
  const roomId = await createPrivateRoom(HOMESERVER, token, {
    name: 'Command Deck',
    topic: 'Slash commands at work',
  });
  await sendRoomMessage(HOMESERVER, token, roomId, { msgtype: 'm.text', body: 'Deck open' }, RUN);

  await signIn(page, owner);
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });
  // The Full view shows sent messages as rows, the plainest place to read a sent body.
  const viewSwitch = roomViewSwitch(page);
  await expect(viewSwitch).toBeVisible({ timeout: 60_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();

  // `/` as the first word lists the commands with what they do.
  await composer(page).click();
  await page.keyboard.type('/');
  const commands = page.locator('[data-slash-command]');
  await expect(page.getByText('Commands', { exact: true })).toBeVisible();
  await expect(commands.first()).toHaveText(/\/me/);
  await expect(page.locator('[data-slash-command="invite"]')).toContainText('Invite user to room.');
  await page.screenshot({ path: testInfo.outputPath('slash-menu.png') });

  // Typing narrows the list; Tab takes the first command and leaves room for its arguments.
  await page.keyboard.type('shr');
  await expect(commands).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(commands).toHaveCount(0);
  await expect(composer(page)).toContainText('/shrug');
  await page.keyboard.type('no idea');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await latestMessages(token, roomId))[0]?.content.body, { timeout: 30_000 })
    .toBe('¯\\_(ツ)_/¯ no idea');
  await expect(page.getByText('¯\\_(ツ)_/¯ no idea')).toBeVisible();

  // A command that acts sends no message: the invite lands and the composer empties.
  const before = (await latestMessages(token, roomId)).length;
  // The space after the user ID ends the word, so no mention menu takes the Enter.
  await page.keyboard.type(`/invite @${guest}:${SERVER_NAME} `);
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await memberContent(token, roomId, `@${guest}:${SERVER_NAME}`)).membership, {
      timeout: 30_000,
    })
    .toBe('invite');
  await expect(composer(page)).not.toContainText('/invite');

  await page.keyboard.type('/myroomnick Deck Captain');
  await page.keyboard.press('Enter');
  await expect
    .poll(
      async () => (await memberContent(token, roomId, `@${owner}:${SERVER_NAME}`)).displayname,
      { timeout: 30_000 }
    )
    .toBe('Deck Captain');
  expect((await latestMessages(token, roomId)).length).toBe(before);

  // A command that cannot run keeps the text and shows its usage.
  await page.keyboard.type('/myroomavatar not-a-picture');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Could not run /myroomavatar.' })
  ).toBeVisible();
  await expect(composer(page)).toContainText('/myroomavatar not-a-picture');
  await page.screenshot({ path: testInfo.outputPath('slash-refused.png') });
  expect((await latestMessages(token, roomId)).length).toBe(before);
});
