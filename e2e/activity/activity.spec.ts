import { expect, test, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { activeAccountButton } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom, joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';

// The Activity bell: an agent's mention and its pending tool approval in the person's thread show
// as rows and on the bell's count; Approve answers from the popover; a row opens its thread beside
// the Activity list, and reading it clears the row; on a phone the top bar's bell opens a sheet.
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const PASSWORD = 'activity-e2e-password';
const RUN = Date.now().toString(36);

type Fixture = { person: DisposableUser; roomId: string; askRoot: string; replyRoot: string };

const thread = (rootId: string) => ({
  'm.relates_to': { rel_type: 'm.thread', event_id: rootId, is_falling_back: true },
});

const sendEvent = (user: DisposableUser, roomId: string, type: string, content: object) =>
  matrixFetch<{ event_id: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/${type}/act-${Date.now()}-${Math.random()}`,
    { method: 'PUT', accessToken: user.accessToken, body: JSON.stringify(content) }
  );

const seed = async (browserName: string): Promise<Fixture> => {
  const person = await registerDisposableUser(`act_p_${browserName}_${RUN}`, PASSWORD);
  const agent = await registerDisposableUser(`mindroom_act_${browserName}_${RUN}`, PASSWORD);
  const roomId = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: `Launch ${RUN}`,
    topic: 'Activity rows and their answers',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);

  const askRoot = await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: `Ship the staging deploy ${RUN}`,
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: `${person.userId} I need your approval for the deploy.`,
    'm.mentions': { user_ids: [person.userId] },
    ...thread(askRoot),
  });
  await sendEvent(agent, roomId, 'io.mindroom.tool_approval', {
    tool_name: 'run_shell_command',
    arguments: { command: 'npm run deploy:staging' },
    agent_name: 'code',
    requester_id: person.userId,
    approver_user_id: person.userId,
    approvable: true,
    status: 'pending',
    approval_id: `approval-${RUN}`,
    requested_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    thread_id: askRoot,
    ...thread(askRoot),
  });

  const replyRoot = await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: `When should I leave for the airport ${RUN}?`,
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Leave at 7:45 AM.',
    ...thread(replyRoot),
  });
  return { person, roomId, askRoot, replyRoot };
};

const signIn = async (page: Page, user: DisposableUser) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 60_000,
  });
  await page.locator('input[name="usernameInput"]').fill(user.username);
  await page.locator('input[name="passwordInput"]').fill(user.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(activeAccountButton(page)).toBeVisible({ timeout: 120_000 });
};

const approvalResponses = async (user: DisposableUser, roomId: string) => {
  const { chunk } = await matrixFetch<{
    chunk: { type: string; sender: string; content: Record<string, unknown> }[];
  }>(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50`, {
    method: 'GET',
    accessToken: user.accessToken,
  });
  return chunk.filter(
    (event) => event.type === 'io.mindroom.tool_approval_response' && event.sender === user.userId
  );
};

let fixture: Fixture;

test.beforeAll(async ({ browserName }) => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  fixture = await seed(browserName);
});

test('the bell lists what waits and what is new, and answers an approval in place', async ({
  page,
}) => {
  await signIn(page, fixture.person);
  const bell = page.getByRole('button', { name: /^Activity, \d+ unread$/ });
  await expect(bell).toBeVisible({ timeout: 90_000 });

  await bell.click();
  const popover = page.getByRole('dialog', { name: 'Activity' });
  await expect(popover).toBeVisible();
  const approvalRow = popover.locator('[data-activity-row="approval"]');
  await expect(approvalRow).toContainText('needs approval', { timeout: 60_000 });
  await expect(approvalRow).toContainText('run_shell_command npm run deploy:staging');
  await expect(popover.locator('[data-activity-row="reply"]')).toContainText('Leave at 7:45 AM.');

  await approvalRow.getByRole('button', { name: 'Approve' }).click();
  await expect(approvalRow).toContainText('Approved');
  await expect
    .poll(async () => (await approvalResponses(fixture.person, fixture.roomId)).length, {
      timeout: 30_000,
    })
    .toBe(1);
  const [response] = await approvalResponses(fixture.person, fixture.roomId);
  expect(response!.content.status).toBe('approved');
});

test('a row opens its thread beside the Activity list, and reading it clears the row once left', async ({
  page,
}) => {
  await signIn(page, fixture.person);
  // A second press of the bell, while its popover is open, opens the Activity page.
  const bell = page.getByRole('button', { name: /^Activity/ }).first();
  await bell.click();
  await expect(page.getByRole('dialog', { name: 'Activity' })).toBeVisible();
  await bell.click();
  await expect(page).toHaveURL(/\/activity\/$/);
  await expect(page.getByRole('dialog', { name: 'Activity' })).toBeHidden();

  const list = page.getByRole('navigation', { name: 'Activity' });
  const replyRow = list.locator('[data-activity-row="reply"]');
  await expect(replyRow).toContainText('Leave at 7:45 AM.', { timeout: 60_000 });
  await replyRow.getByText(`When should I leave for the airport ${RUN}?`).click();
  await expect(page).toHaveURL(
    new RegExp(`/activity/[^/?]+\\?threadId=${encodeURIComponent(fixture.replyRoot)}`)
  );
  await expect(page.getByRole('main').getByText('Leave at 7:45 AM.')).toBeVisible({
    timeout: 60_000,
  });
  // The list stays beside the thread.
  await expect(list).toBeVisible();

  // With Unread on, the row of the thread beside the list stays while it shows; once the thread
  // is left, the read row goes.
  await list.getByRole('switch', { name: 'Unread' }).click();
  const row = list.getByText(`When should I leave for the airport ${RUN}?`);
  await expect(row).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/activity\/$/);
  await expect(row).toBeHidden({ timeout: 60_000 });
});

test('on a phone the top bar bell opens Activity as a sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, fixture.person);
  await page
    .locator('[data-phone-top-bar]')
    .getByRole('button', { name: /^Activity/ })
    .click();
  const sheet = page.getByRole('dialog', { name: 'Activity' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-activity-list="sheet"]')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close Activity' }).click();
  await expect(sheet).toBeHidden();
});
