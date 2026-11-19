import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Home asks an agent of the account's rooms: the question goes out from the room's own composer as
// a new thread, mentioning the agent, in the room last used with it, and that thread opens. An agent
// never used gets its direct chat started first. Runs against the disposable homeserver of
// `just hs-up` or of a slot of scripts/e2e-slot.sh; the agents are plain accounts that publish
// their `io.mindroom.server` state as MindRoom's do.
const PASSWORD = 'home-ask-spec-password';
const RUN = Date.now().toString(36);

const setDisplayName = (session: MatrixSession, displayName: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });

const registerAgent = async (name: string, displayName: string) => {
  const session = await registerAgentAccount(HOMESERVER, name);
  await setDisplayName(session, displayName);
  return session;
};

/** A room of the reader's with these agents, each publishing its server state there. */
const agentRoom = async (reader: MatrixSession, name: string, agents: MatrixSession[]) => {
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `${name} ${RUN}`,
    // Invitees get the creator's power, so the agents may publish their state.
    preset: 'trusted_private_chat',
    invite: agents.map((agent) => agent.userId),
  });
  for (const agent of agents) {
    await joinRoom(HOMESERVER, agent.accessToken, roomId);
    await sendStateEvent(
      HOMESERVER,
      agent.accessToken,
      roomId,
      'io.mindroom.server',
      agent.userId,
      {
        role: 'Answers questions',
      }
    );
  }
  return roomId;
};

/** A thread the reader started and `agent` answered. */
const answeredThread = async (
  reader: MatrixSession,
  agent: MatrixSession,
  roomId: string,
  title: string
) => {
  const root = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: title,
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Here is what I found.',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: root,
      is_falling_back: true,
      'm.in_reply_to': { event_id: root },
    },
  });
};

const latestOwnMessage = async (reader: MatrixSession, roomId: string) => {
  const page = await matrixFetch<{
    chunk: Array<{ type: string; sender: string; content: Record<string, unknown> }>;
  }>(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=10`, {
    accessToken: reader.accessToken,
  });
  return page.chunk.find(
    (event) => event.type === 'm.room.message' && event.sender === reader.userId
  );
};

const signIn = async (page: Page, username: string) => {
  // Neither the tour's offer nor the recovery dialog, which a new encrypted direct chat would open,
  // covers the page.
  await page.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, object | undefined>;
    await route.fulfill({
      response,
      json: {
        ...config,
        encryptionRecovery: { ...config.encryptionRecovery, promptAtStart: false },
        tour: { ...config.tour, offerAtStart: false },
      },
    });
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.goto('/home');
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a question from Home starts a thread for the agent in the room last used with it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const username = `home_ask_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);
  const helper = await registerAgent('helper', 'Helper');
  const scout = await registerAgent('scout', 'Scout');
  const lobby = await agentRoom(reader, 'Lobby', [helper, scout]);
  const engineering = await agentRoom(reader, 'Engineering', [helper]);
  await answeredThread(reader, helper, lobby, 'Onboarding checklist for new hires');
  await answeredThread(reader, scout, lobby, 'Vendor shortlist for the spring offsite');
  await answeredThread(reader, helper, engineering, 'Staging deploy fails on the linux runner');

  await signIn(page, username);
  // The agent last used answers, in its room.
  await expect(page.getByRole('button', { name: 'Helper answers' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: `In Engineering ${RUN}` })).toBeVisible();
  // The four newest threads are listed.
  await expect(page.getByRole('button', { name: /Open thread: Vendor shortlist/ })).toBeVisible();

  const field = page.locator('[data-editable-name="RoomInput"]');
  await field.click();
  await page.keyboard.type('Summarize the open incidents');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/threadId=/, { timeout: 30_000 });
  const sent = await latestOwnMessage(reader, engineering);
  expect(sent?.content.body).toBe('Summarize the open incidents');
  expect(sent?.content['m.mentions']).toEqual({ user_ids: [helper.userId] });
});

test('an agent never used gets its direct chat started from the field', async ({ page }) => {
  test.setTimeout(120_000);
  const username = `home_dm_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);
  const quill = await registerAgent('quill', 'Quill');
  await agentRoom(reader, 'Lobby', [quill]);

  await signIn(page, username);
  await expect(page.getByRole('button', { name: 'In Direct chat' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Ask Quill anything…' }).click();
  const field = page.locator('[data-editable-name="RoomInput"]');
  await expect(field).toBeFocused({ timeout: 30_000 });
  await page.keyboard.type('Draft the release notes');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/direct\/.*threadId=/, { timeout: 30_000 });
  await expect(page.getByText('Draft the release notes').first()).toBeVisible();
});
