import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';
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
// member of the room sees the card without a field. A redirect from that server, which would replay
// the key to another origin, fails the answer instead, and the key stays in the field for a retry.
// An answer from the keyboard leaves the keyboard focus on the card through the agent's edit, also
// when the edit comes before the server's answer, and on Save after an error.

const MINDROOM_API = 'http://127.0.0.1:29597';
/** Another origin, where a redirect from the MindRoom server points. */
const ELSEWHERE = 'http://127.0.0.1:29598';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const PASSWORD = 'secret-request-spec-password';

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** The card's content as the agent posts it, and as each of its edits sets the status. */
const cardContent = (
  requesterId: string,
  requestId: string,
  status: 'pending' | 'saved' | 'declined'
) => ({
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
/** The buttons only a message row's hover toolbar has. */
const TOOLBAR_BUTTONS = 'button[aria-label="Add Reaction"], button[aria-label="Reply"]';
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

/** A fresh run's accounts, a thread the agent joined, and the agent's pending card in it. */
const seedCard = async (withOther: boolean) => {
  // Fresh for each run, so a repeat in the same worker registers its own accounts.
  const run = randomUUID().replaceAll('-', '').slice(0, 10);
  const requestId = `req-${run}`;
  const requester = await registerDisposableUser(`secret_req_${run}`, PASSWORD);
  const other = withOther
    ? await registerDisposableUser(`secret_other_${run}`, PASSWORD)
    : undefined;
  const agent = await registerAgentAccount(HOMESERVER, 'assistant');
  const room = await createThreadFixture(HOMESERVER, requester.accessToken, {
    name: `Key request ${run}`,
    rootBody: 'Open a pull request for the fix',
    replyBody: 'Use the GitHub account of the team',
    invite: other ? [agent.userId, other.userId] : [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, room.roomId);
  if (other) await joinRoom(HOMESERVER, other.accessToken, room.roomId);
  const cardId = await sendRoomMessage(HOMESERVER, agent.accessToken, room.roomId, {
    ...cardContent(requester.userId, requestId, 'pending'),
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: room.rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: room.rootId },
    },
  });
  const answerUrl = `${MINDROOM_API}/api/rooms/${encodeURIComponent(
    room.roomId
  )}/secret-requests/${requestId}`;
  return { requester, other, agent, room, requestId, cardId, answerUrl };
};

/** The MindRoom server's sign-in, which gives `requester` the session `sessionToken`. */
const routeSignIn = async (
  context: BrowserContext,
  requester: DisposableUser,
  sessionToken: string,
  signIns: unknown[] = []
) => {
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
};

/** Every request of `context` but the answer itself that carries `key`, the homeserver's included. */
const watchLeaks = (context: BrowserContext, key: string, answerUrl: string) => {
  const leaks: string[] = [];
  context.on('request', (request) => {
    if (request.url() === answerUrl) return;
    if (`${request.url()}\n${request.postData() ?? ''}`.includes(key)) leaks.push(request.url());
  });
  return leaks;
};

test('the requester saves a key to the MindRoom server only, and another member gets no field', async ({
  browser,
  context,
  page,
}) => {
  test.slow();
  const key = `ghp_${randomUUID().replaceAll('-', '')}`;
  const sessionToken = `session-${randomUUID()}`;
  const { requester, other, agent, room, requestId, cardId, answerUrl } = await seedCard(true);
  if (!other) throw new Error('no other member');

  // The page answers for the MindRoom server: one sign-in, then the request's route.
  const signIns: unknown[] = [];
  const answers: { url: string; body: string | null; authorization?: string }[] = [];
  await routeSignIn(context, requester, sessionToken, signIns);
  await context.route(`${MINDROOM_API}/api/rooms/**`, async (route) => {
    const request = route.request();
    answers.push({
      url: request.url(),
      body: request.postData(),
      authorization: (await request.allHeaders()).authorization,
    });
    await route.fulfill({ status: 204, headers: CORS });
  });
  const leaks = watchLeaks(context, key, answerUrl);

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

  // The requester types the key into the masked field and saves with the mouse.
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
  // The card names where the key goes: the deployment's server, as the agent published none.
  await expect(card).toContainText('Sent to 127.0.0.1:29597');
  await field.fill(key);
  // The typed key is in the field only, not in the page's markup.
  expect(
    await page.evaluate((value) => document.documentElement.outerHTML.includes(value), key)
  ).toBe(false);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('Saved, waiting for the agent');
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

  // A mouse answer put no focus in the row, so its toolbar shows with the pointer and goes with it.
  const row = page.locator(`[data-message-id="${cardId}"]`);
  await card.hover();
  await expect(row.locator(TOOLBAR_BUTTONS).first()).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(row.locator(TOOLBAR_BUTTONS)).toHaveCount(0);

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

test('a redirect from the MindRoom server sends the key nowhere else, and the key stays for a retry', async ({
  context,
  page,
}) => {
  test.slow();
  const key = `ghp_${randomUUID().replaceAll('-', '')}`;
  const { requester, room, answerUrl } = await seedCard(false);
  await routeSignIn(context, requester, `session-${randomUUID()}`);
  // The MindRoom server, or a proxy in front of it, sends the answer on to another origin.
  const answers: string[] = [];
  await context.route(`${MINDROOM_API}/api/rooms/**`, async (route) => {
    answers.push(route.request().url());
    await route.fulfill({ status: 307, headers: { ...CORS, Location: `${ELSEWHERE}/keys` } });
  });
  // That origin takes whatever reaches it, and would make the card say Saved.
  const elsewhere: string[] = [];
  await context.route(`${ELSEWHERE}/**`, async (route) => {
    await route.fulfill({ status: 204, headers: CORS });
  });
  context.on('request', (request) => {
    if (request.url().startsWith(ELSEWHERE)) elsewhere.push(`${request.method()} ${request.url()}`);
  });
  const leaks = watchLeaks(context, key, answerUrl);

  await openThread(context, page, requester, room);
  const card = keyCard(page);
  await expect(statusChip(page)).toHaveAttribute('data-secret-request-status', 'waitingForYou', {
    timeout: 30_000,
  });
  const field = card.getByLabel('GitHub key', { exact: true });
  await field.fill(key);
  await card.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(card.getByRole('alert')).toHaveText(
    "Couldn't reach the server. Check your connection and try again."
  );
  await expect(statusChip(page)).toHaveAttribute('data-secret-request-status', 'waitingForYou');
  await expect(card.getByRole('status')).toHaveText('');
  await expect(field).toHaveValue(key);
  expect(answers).toEqual([answerUrl]);
  expect(elsewhere).toEqual([]);
  expect(leaks).toEqual([]);
});

/** A seeded card opened by its requester, with the MindRoom server's answer to the POST left to `answer`. */
const openForKeyboard = async (
  context: BrowserContext,
  page: Page,
  answer: (route: Route) => Promise<void>
) => {
  const seeded = await seedCard(false);
  await routeSignIn(context, seeded.requester, `session-${randomUUID()}`);
  await context.route(`${MINDROOM_API}/api/rooms/**`, answer);
  await openThread(context, page, seeded.requester, seeded.room);
  const card = keyCard(page);
  await expect(statusChip(page)).toHaveAttribute('data-secret-request-status', 'waitingForYou', {
    timeout: 30_000,
  });
  const field = card.getByLabel('GitHub key', { exact: true });
  await field.fill(`ghp_${randomUUID().replaceAll('-', '')}`);
  return { ...seeded, card, field };
};

/** Tabs from the field, past the show and hide toggle, to the button `label`. */
const tabTo = async (page: Page, card: Locator, field: Locator, label: 'Save' | 'Decline') => {
  const target = card.getByRole('button', { name: label, exact: true });
  await field.focus();
  for (let presses = 0; presses < 5; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
  return target;
};

/** The agent's edit of its card to a final status. */
const editCard = async (
  seeded: Awaited<ReturnType<typeof seedCard>>,
  status: 'saved' | 'declined'
) => {
  const final = cardContent(seeded.requester.userId, seeded.requestId, status);
  await sendRoomMessage(HOMESERVER, seeded.agent.accessToken, seeded.room.roomId, {
    ...final,
    body: `* ${final.body}`,
    'm.new_content': final,
    'm.relates_to': { rel_type: 'm.replace', event_id: seeded.cardId },
  });
};

for (const [label, final, waiting] of [
  ['Save', 'saved', 'Saved, waiting for the agent'],
  ['Decline', 'declined', 'Declined, waiting for the agent'],
] as const) {
  test(`${label} from the keyboard leaves the focus on the card through the agent's edit`, async ({
    context,
    page,
  }) => {
    test.slow();
    // A slow server, so the button is busy for a while.
    const seeded = await openForKeyboard(context, page, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({ status: 204, headers: CORS });
    });
    const target = await tabTo(page, seeded.card, seeded.field, label);

    await page.keyboard.press('Enter');
    // Busy, not disabled: a disabled button would drop the focus to the page.
    await expect(target).toHaveAttribute('aria-disabled', 'true');
    await expect(target).toBeFocused();
    await expect(seeded.card.getByRole('status')).toHaveText(waiting);
    await expect(seeded.card).toBeFocused();

    await editCard(seeded, final);
    await expect(statusChip(page)).toHaveAttribute('data-secret-request-status', final, {
      timeout: 30_000,
    });
    await expect(seeded.card).toBeFocused();
  });
}

test("the card takes the keyboard focus when the agent's edit comes before the server's answer", async ({
  context,
  page,
}) => {
  test.slow();
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const answering = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const seeded = await openForKeyboard(context, page, async (route) => {
    reached();
    await released;
    await route.fulfill({ status: 204, headers: CORS });
  });
  await tabTo(page, seeded.card, seeded.field, 'Save');

  await page.keyboard.press('Enter');
  await answering;
  await editCard(seeded, 'saved');
  await expect(statusChip(page)).toHaveAttribute('data-secret-request-status', 'saved', {
    timeout: 30_000,
  });
  await expect(seeded.card).toBeFocused();
  release();
  // The late answer changes nothing: the agent's edit decided.
  await page.waitForTimeout(500);
  await expect(statusChip(page)).toHaveText('Saved');
  await expect(seeded.card).toBeFocused();
});

test('an error after Save from the keyboard leaves the focus on Save to retry', async ({
  context,
  page,
}) => {
  test.slow();
  const seeded = await openForKeyboard(context, page, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 503, headers: CORS });
  });
  const save = await tabTo(page, seeded.card, seeded.field, 'Save');
  const key = await seeded.field.inputValue();

  await page.keyboard.press('Enter');

  await expect(seeded.card.getByRole('alert')).toHaveText(
    'The server ran into a problem. Try again later.'
  );
  await expect(save).toBeFocused();
  await expect(save).not.toHaveAttribute('aria-disabled', 'true');
  await expect(seeded.field).toHaveValue(key);
});
