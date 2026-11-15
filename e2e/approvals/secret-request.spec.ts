import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  createThreadFixture,
  joinRoom,
  registerAgentAccount,
  sendRoomMessage,
  type ThreadFixture,
} from '../helpers/matrix';

// A MindRoom agent asks for a key in a thread (an `io.mindroom.secret_request` card) on the
// homeserver of `just hs-up` or of an e2e slot. No MindRoom runs: the page answers for the
// deployment's configured server (`mindroom.computers.apiUrl`), which takes the answer because the
// asking agent published no server of its own; it signs the page in for a homeserver OpenID token and
// takes the key. The requester types the key into the masked field, a text field that is no sign-in
// field, and saves; the server gets exactly the key with the session as bearer, and the key reaches
// no other request and stays nowhere in the page. The agent then edits the card to saved. Another
// member of the room sees the card without a field.

const MINDROOM_API = 'http://127.0.0.1:29597';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const PASSWORD = 'secret-request-spec-password';

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** The card's content as the agent posts it, and as each of its edits sets the status. */
const cardContent = (requesterId: string, requestId: string, status: 'pending' | 'saved') => ({
  msgtype: 'm.notice',
  body: '🔑 assistant asks for your GitHub key. Open MindRoom Chat to enter it.',
  'io.mindroom.secret_request': {
    request_id: requestId,
    requester_id: requesterId,
    service: 'github',
    display_name: 'GitHub',
    hosts: ['api.github.com'],
    reason: 'To open the pull request for the fix.',
    status,
    expires_at: Date.now() + 60 * 60_000,
  },
});

/** Signs `user` in with the configured MindRoom server and opens the thread. */
const openThread = async (
  context: BrowserContext,
  page: Page,
  user: DisposableUser,
  room: ThreadFixture
) => {
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({
      response,
      json: {
        ...config,
        homeserverList: [HOMESERVER],
        defaultHomeserver: 0,
        mindroom: { ...config.mindroom, computers: { apiUrl: MINDROOM_API } },
      },
    });
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await page.goto(
    `/home/${encodeURIComponent(room.roomId)}?threadId=${encodeURIComponent(room.rootId)}`
  );
  await expect(page.getByText(room.replyBody, { exact: true })).toBeVisible({ timeout: 60_000 });
};

const keyCard = (page: Page) => page.locator('[aria-label="Key request"]');
const statusChip = (page: Page) => keyCard(page).locator('[data-secret-request-status]');

/** The card as the agent's saved edit shows it: no field and no note of an answer on its way. */
const expectSaved = async (page: Page) => {
  await expect(statusChip(page)).toHaveAttribute('data-secret-request-status', 'saved', {
    timeout: 30_000,
  });
  await expect(statusChip(page)).toHaveText('Saved');
  await expect(keyCard(page).getByRole('status')).toHaveCount(0);
  await expect(keyCard(page).locator('input')).toHaveCount(0);
};

test('the requester saves a key to the MindRoom server only, and another member gets no field', async ({
  browser,
  context,
  page,
}) => {
  test.slow();
  // Fresh for each run, so a repeat in the same worker registers its own accounts.
  const run = randomUUID().replaceAll('-', '').slice(0, 10);
  const key = `ghp_${randomUUID().replaceAll('-', '')}`;
  const sessionToken = `session-${randomUUID()}`;
  const requestId = `req-${run}`;
  const requester = await registerDisposableUser(`secret_req_${run}`, PASSWORD);
  const other = await registerDisposableUser(`secret_other_${run}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'assistant');
  const room = await createThreadFixture(HOMESERVER, requester.accessToken, {
    name: `Key request ${run}`,
    rootBody: 'Open a pull request for the fix',
    replyBody: 'Use the GitHub account of the team',
    invite: [agent.userId, other.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, room.roomId);
  await joinRoom(HOMESERVER, other.accessToken, room.roomId);
  const cardId = await sendRoomMessage(HOMESERVER, agent.accessToken, room.roomId, {
    ...cardContent(requester.userId, requestId, 'pending'),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: room.rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: room.rootId },
    },
  });

  // The page answers for the MindRoom server: one sign-in, then the request's route.
  const signIns: unknown[] = [];
  const answers: { url: string; body: string | null; authorization?: string }[] = [];
  await context.route(`${MINDROOM_API}/api/client-sessions`, async (route) => {
    signIns.push(route.request().postDataJSON() as unknown);
    await route.fulfill({
      headers: CORS,
      json: {
        session_token: sessionToken,
        user_id: requester.userId,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    });
  });
  await context.route(`${MINDROOM_API}/api/rooms/**`, async (route) => {
    const request = route.request();
    answers.push({
      url: request.url(),
      body: request.postData(),
      authorization: (await request.allHeaders()).authorization,
    });
    await route.fulfill({ status: 204, headers: CORS });
  });
  const roomPath = encodeURIComponent(room.roomId);
  const answerUrl = `${MINDROOM_API}/api/rooms/${roomPath}/secret-requests/${requestId}`;
  // Every request of the requester's page but the answer, the homeserver's included.
  const leaks: string[] = [];
  context.on('request', (request) => {
    if (request.url() === answerUrl) return;
    if (`${request.url()}\n${request.postData() ?? ''}`.includes(key)) leaks.push(request.url());
  });

  // Another member sees the pending card with whom it waits for, and no field.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await openThread(otherContext, otherPage, other, room);
  await expect(statusChip(otherPage)).toHaveAttribute('data-secret-request-status', 'pending', {
    timeout: 30_000,
  });
  await expect(keyCard(otherPage)).toContainText('GitHub key');
  await expect(keyCard(otherPage)).toContainText('Waiting for');
  await expect(keyCard(otherPage)).toContainText(requester.username);
  await expect(keyCard(otherPage).locator('input')).toHaveCount(0);

  // The requester types the key into the masked field and saves.
  await openThread(context, page, requester, room);
  const card = keyCard(page);
  await expect(statusChip(page)).toHaveAttribute('data-secret-request-status', 'waitingForYou', {
    timeout: 30_000,
  });
  await expect(card).toContainText('To open the pull request for the fix.');
  await expect(card).toContainText('api.github.com');
  const field = card.getByLabel('GitHub key', { exact: true });
  // Masked without being a password field, which browsers and password managers would fill or save.
  await expect(field).toHaveAttribute('type', 'text');
  await expect(field).toHaveAttribute('autocomplete', 'off');
  await expect(field).toHaveAttribute('data-form-type', 'other');
  await expect(field).toHaveCSS('-webkit-text-security', 'disc');
  await expect(card.locator('input[type="password"]')).toHaveCount(0);
  await field.fill(key);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('Saved, waiting for the agent');
  // Save went away with the field; focus moved to the status instead of the page.
  await expect(card.getByRole('status')).toBeFocused();
  await expect(card.locator('input')).toHaveCount(0);

  expect(signIns).toHaveLength(1);
  expect(signIns[0]).toMatchObject({ openid_token: { access_token: expect.any(String) } });
  expect(answers).toHaveLength(1);
  expect(answers[0]?.url).toBe(answerUrl);
  expect(JSON.parse(answers[0]?.body ?? 'null')).toEqual({ secret: key });
  expect(answers[0]?.authorization).toBe(`Bearer ${sessionToken}`);

  // The agent edits the card to saved; both people see it so, and neither gets a field.
  const saved = cardContent(requester.userId, requestId, 'saved');
  await sendRoomMessage(HOMESERVER, agent.accessToken, room.roomId, {
    ...saved,
    body: `* ${saved.body}`,
    'm.new_content': saved,
    'm.relates_to': { rel_type: 'm.replace', event_id: cardId },
  });
  await expectSaved(page);
  await expectSaved(otherPage);
  await expect(keyCard(otherPage)).not.toContainText('Waiting for');

  // The key went to the MindRoom server once and nowhere else, and the page keeps none of it.
  expect(answers).toHaveLength(1);
  expect(leaks).toEqual([]);
  const keyInPage = await page.evaluate(
    (value) =>
      document.documentElement.outerHTML.includes(value) ||
      [...document.querySelectorAll('input, textarea')].some((element) =>
        (element as HTMLInputElement).value.includes(value)
      ),
    key
  );
  expect(keyInPage).toBe(false);
  await otherContext.close();
});
