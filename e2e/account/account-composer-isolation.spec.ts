import { expect, test, type Page } from '@playwright/test';
import { switchToStoredUsername } from '../helpers/accounts';
import { buildLoginPath } from '../env';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Two accounts signed in on one device share a room. What one account leaves in that room's
// composer (the message it replies to, its staged files, its unsent text) must not show up in
// the other account's composer, and must not be sent as the other account. Runs against the
// disposable homeserver of `just hs-up` (or a slot of scripts/e2e-slot.sh).
const SERVER_NAME = 'matrix.localhost';
const PASSWORD = 'composer-isolation-password';
const RUN = Date.now().toString(36);
const QUESTION = 'Which seeds go in first this spring?';
const UNSENT = 'Unsent words of the first account';
const ANSWER = 'Hello from the second account';
const FILE_NAME = 'planting-plan.txt';

type MatrixEvent = {
  type: string;
  sender: string;
  content: Record<string, unknown>;
};

const matrix = async <T>(
  path: string,
  init: { token?: string; body?: unknown; method?: 'PUT' } = {}
) => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

const register = async (username: string): Promise<string> => {
  const { access_token: token } = await matrix<{ access_token: string }>('/register', {
    body: { username, password: PASSWORD, auth: { type: 'm.login.dummy' } },
  });
  return token;
};

/** A room both accounts are in, holding one message from the second account. */
const createSharedRoom = async (first: string, second: string) => {
  const firstToken = await register(first);
  const secondToken = await register(second);
  const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
    token: firstToken,
    body: { name: 'Seed Swap', preset: 'private_chat', invite: [`@${second}:${SERVER_NAME}`] },
  });
  await matrix(`/join/${encodeURIComponent(roomId)}`, { token: secondToken, body: {} });
  await matrix(`/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${RUN}`, {
    token: secondToken,
    method: 'PUT',
    body: { msgtype: 'm.text', body: QUESTION },
  });
  return { roomId, secondToken };
};

/**
 * Signs in through the login page. A busy machine can take well over the shared helper's 30
 * seconds to build the app and finish a first sync, so this waits longer for the shell.
 */
const signIn = async (page: Page, username: string, addAccount = false) => {
  await page.goto(buildLoginPath(HOMESERVER, addAccount));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 90_000,
  });
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  const accountButton = page.getByRole('button', {
    name: new RegExp(`account menu for @?${username}`),
  });
  await expect(accountButton).toBeVisible({ timeout: 120_000 });
};

/** Opens a route inside the running app, so the page (and its memory) is not reloaded. */
const openRoute = (page: Page, path: string) =>
  page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);

/** The question in the timeline (a reply bar quoting it is not part of the timeline). */
const question = (page: Page) =>
  page.getByTestId('room-virtual-inner').getByText(QUESTION, { exact: true });

/** Opens the room in the Full view, where messages have a Reply button. */
const openFullRoom = async (page: Page, roomId: string) => {
  await openRoute(page, `/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 30_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();
  await expect(question(page)).toBeVisible({ timeout: 30_000 });
};

const composer = (page: Page) => page.locator('[data-editable-name="RoomInput"]');
const cancelReply = (page: Page) => page.getByRole('button', { name: 'Cancel reply' });

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test("a second account in a shared room gets none of the first account's composer state", async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const first = `x3_first_${RUN}`;
  const second = `x3_second_${RUN}`;
  const { roomId, secondToken } = await createSharedRoom(first, second);

  // Both accounts on this device; the second one is added last, so the first is switched to.
  await signIn(page, first);
  await signIn(page, second, true);
  await switchToStoredUsername(page, first);

  // The first account replies to the question, stages a file and types, then leaves it unsent.
  await openFullRoom(page, roomId);
  await question(page).hover();
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(cancelReply(page)).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: FILE_NAME, mimeType: 'text/plain', buffer: Buffer.from('Beans, then peas.') });
  await expect(page.getByText(FILE_NAME, { exact: true }).first()).toBeVisible();
  await composer(page).click();
  await page.keyboard.type(UNSENT);
  await expect(composer(page)).toContainText(UNSENT);
  await page.screenshot({ path: testInfo.outputPath('first-account-composer.png') });

  // The second account opens the same room in the same tab: its composer is empty.
  await switchToStoredUsername(page, second);
  await openFullRoom(page, roomId);
  await expect(composer(page)).toBeVisible();
  await expect(cancelReply(page)).toHaveCount(0);
  await expect(page.getByText(FILE_NAME, { exact: true })).toHaveCount(0);
  await expect(composer(page)).not.toContainText(UNSENT);
  await page.screenshot({ path: testInfo.outputPath('second-account-composer.png') });

  // What the second account sends is only its own message: no reply, no file.
  await composer(page).click();
  await page.keyboard.type(ANSWER);
  await page.keyboard.press('Enter');
  const secondUserId = `@${second}:${SERVER_NAME}`;
  const sentBySecond = async () => {
    const { chunk } = await matrix<{ chunk: MatrixEvent[] }>(
      `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`,
      { token: secondToken }
    );
    return chunk.filter(
      (event) => event.sender === secondUserId && event.type === 'm.room.message'
    );
  };
  await expect
    .poll(async () => (await sentBySecond()).map((event) => event.content.body), {
      timeout: 30_000,
    })
    .toContain(ANSWER);
  const sent = await sentBySecond();
  const answer = sent.find((event) => event.content.body === ANSWER);
  expect(answer?.content['m.relates_to']).toBeUndefined();
  expect(sent.some((event) => event.content.msgtype === 'm.file')).toBe(false);
});
