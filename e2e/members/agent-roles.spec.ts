import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { roomMoreOptions } from '../helpers/roomMenu';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';

// The role each agent publishes about itself in its `io.mindroom.server` state shows under its
// name in the room's member list, on its profile card and on the Members page of Room Settings. A
// person who writes the same state about themselves gets no role line: their rows and card stay as
// they were. Runs against the disposable homeserver. AGENT_ROLE_SHOTS=<directory> saves the member list and the agent's card, light and dark.
const PASSWORD = 'agent-roles-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.AGENT_ROLE_SHOTS;
const HELPER = 'Helper';
// Long enough to wrap past two lines on the card and past one in the list, where it is cut.
const ROLE =
  'Answers questions about the codebase, runs its tests, reviews pull requests before they ' +
  'merge and keeps the release notes of every version up to date';
const SPOOF = 'Room administrator, ask me for access';
const SERVER_STATE = 'io.mindroom.server';

test.use({ viewport: { width: 1280, height: 800 } });

let alice: DisposableUser;
let agent: MatrixSession;
let roomId = '';

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  alice = await registerDisposableUser(`roles_alice_${RUN}`, PASSWORD);
  agent = await registerAgentAccount(HOMESERVER, 'helper');
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: HELPER }),
  });
  // As in the rooms MindRoom and the client create, every member may write the server state,
  // each only under their own user ID.
  const created = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: alice.accessToken,
    body: JSON.stringify({
      preset: 'private_chat',
      name: `Agent roles ${RUN}`,
      invite: [agent.userId],
      power_level_content_override: { events: { [SERVER_STATE]: 0 } },
    }),
  });
  roomId = created.room_id;
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await sendStateEvent(HOMESERVER, agent.accessToken, roomId, SERVER_STATE, agent.userId, {
    role: ROLE,
  });
  await sendStateEvent(HOMESERVER, alice.accessToken, roomId, SERVER_STATE, alice.userId, {
    role: SPOOF,
  });
  await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Who does what here?',
  });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** How many lines of text the element shows. */
const lines = async (text: Locator): Promise<number> => {
  const lineHeight = await text.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight));
  return Math.round((await text.boundingBox())!.height / lineHeight);
};

const memberRow = (page: Page, userId: string) =>
  page.locator(`button[data-user-id="${userId}"]`).first();

const openMembers = async (page: Page) => {
  const showMembers = page.getByRole('button', { name: 'Members', exact: true });
  await expect(showMembers.or(page.getByRole('button', { name: 'Hide Members' }))).toBeVisible({
    timeout: 30_000,
  });
  if (await showMembers.isVisible()) await showMembers.click();
};

const openCard = async (page: Page, userId: string) => {
  await memberRow(page, userId).click();
  const card = page.getByRole('dialog', { name: userId, exact: true });
  await expect(card).toBeVisible();
  return card;
};

test('an agent shows its role in the member list and on its card; a person does not', async ({
  page,
}) => {
  await loginWithPassword(page, { homeserver: HOMESERVER, ...alice });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await openMembers(page);

  const helperRow = memberRow(page, agent.userId);
  await expect(helperRow).toContainText(HELPER, { timeout: 30_000 });
  await expect(helperRow).toContainText(ROLE);
  // One line: the role is cut, not wrapped, in the narrow list.
  expect(await lines(helperRow.getByText(ROLE, { exact: true }))).toBe(1);
  await expect(memberRow(page, alice.userId)).not.toContainText(SPOOF);

  if (SHOTS) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // The theme fades between schemes; shoot once it settles.
      await page.waitForFunction(
        () => !document.getAnimations().some((animation) => animation instanceof CSSTransition)
      );
      await page.screenshot({ path: `${SHOTS}/members-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }

  const helperCard = await openCard(page, agent.userId);
  await expect(helperCard.getByText(ROLE, { exact: true })).toBeVisible();
  expect(await lines(helperCard.getByText(ROLE, { exact: true }))).toBe(2);
  if (SHOTS) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // The theme fades between schemes; shoot once it settles.
      await page.waitForFunction(
        () => !document.getAnimations().some((animation) => animation instanceof CSSTransition)
      );
      await page.screenshot({ path: `${SHOTS}/card-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await page.keyboard.press('Escape');
  await expect(helperCard).toBeHidden();

  const aliceCard = await openCard(page, alice.userId);
  await expect(aliceCard).not.toContainText(SPOOF);
  await page.keyboard.press('Escape');
  await expect(aliceCard).toBeHidden();

  // The Members page of the room's settings lists the same rows.
  await roomMoreOptions(page).click();
  await page.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
  const settings = page.getByRole('dialog').last();
  await settings.getByText('Members', { exact: true }).first().click();
  const settingsRow = settings.locator(`button[data-user-id="${agent.userId}"]`);
  await expect(settingsRow).toContainText(ROLE, { timeout: 20_000 });
  await expect(settings.locator(`button[data-user-id="${alice.userId}"]`)).not.toContainText(SPOOF);
});
