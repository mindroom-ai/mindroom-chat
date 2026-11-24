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

// Home asks an agent of the account's rooms: the question goes out as a new thread, mentioning the
// agent, in the room it answered in last, and that thread opens; the rooms' own drafts and replies
// stay theirs. An agent never used gets its direct chat started first, which waits for it to join.
// Runs against the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh; the
// agents are plain accounts that publish their `io.mindroom.server` state as MindRoom's do.
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
  return root;
};

/** The event the open page's URL names as its thread, with what the server holds of it. */
const openedEvent = async (page: Page, reader: MatrixSession, roomId: string) => {
  const url = new URL(page.url());
  expect(decodeURIComponent(url.pathname)).toContain(roomId);
  const eventId = url.searchParams.get('threadId') ?? '';
  // A confirmed ID, never the client's temporary one.
  expect(eventId).toMatch(/^\$/);
  return matrixFetch<{ type: string; sender: string; content: Record<string, unknown> }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
    { accessToken: reader.accessToken }
  );
};

const storageKey = (prefix: string, userId: string, roomId: string) =>
  `${prefix}${JSON.stringify([userId, roomId])}`;
const paragraph = (text: string) => JSON.stringify([{ type: 'paragraph', children: [{ text }] }]);

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

test("a question from Home is a new thread of its own, which leaves rooms' drafts alone", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const username = `home_ask_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);
  const helper = await registerAgent('helper', 'Helper');
  const scout = await registerAgent('scout', 'Scout');
  const lobby = await agentRoom(reader, 'Lobby', [helper, scout]);
  const engineering = await agentRoom(reader, 'Engineering', [helper]);
  await answeredThread(reader, helper, lobby, 'Onboarding checklist for new hires');
  await answeredThread(reader, scout, lobby, 'Vendor shortlist for the spring offsite');
  const root = await answeredThread(
    reader,
    helper,
    engineering,
    'Staging deploy fails on the linux runner'
  );

  await signIn(page, username);
  // Both rooms hold an unsent draft, and Engineering a reply kept for the next message.
  const kept = {
    [storageKey('roomInputDraft:', reader.userId, lobby)]: paragraph('Lobby draft'),
    [storageKey('roomInputDraft:', reader.userId, engineering)]: paragraph('Engineering draft'),
    [storageKey('roomInputReply:', reader.userId, engineering)]: JSON.stringify({
      userId: reader.userId,
      eventId: root,
      body: 'Staging deploy fails on the linux runner',
    }),
  };
  await page.evaluate((entries) => {
    Object.entries(entries).forEach(([key, value]) => localStorage.setItem(key, value));
  }, kept);
  await page.reload();

  // The agent that answered last answers, in the room it answered in.
  await expect(page.getByRole('button', { name: 'Helper answers' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: `In Engineering ${RUN}` })).toBeVisible();
  await expect(page.getByRole('button', { name: /Open thread: Vendor shortlist/ })).toBeVisible();

  const field = page.locator('[data-editable-name="RoomInput"]');
  await expect(field).not.toContainText('Engineering draft');
  await field.click();
  await page.keyboard.type('Summarize the open incidents');
  // Both pickers move, and back: the text stays Home's, the rooms keep theirs.
  await page.getByRole('button', { name: `In Engineering ${RUN}` }).click();
  await page.getByRole('menuitemradio', { name: `Lobby ${RUN}` }).click();
  await expect(page.getByRole('button', { name: `In Lobby ${RUN}` })).toBeFocused();
  await page.getByRole('button', { name: 'Helper answers' }).click();
  await page.getByRole('menuitemradio', { name: 'Scout' }).click();
  await expect(page.getByRole('button', { name: 'Scout answers' })).toBeFocused();
  await page.getByRole('button', { name: 'Scout answers' }).click();
  await page.getByRole('menuitemradio', { name: 'Helper' }).click();
  await expect(page.getByRole('button', { name: `In Engineering ${RUN}` })).toBeVisible();
  await expect(field).toContainText('Summarize the open incidents');
  await expect(field).not.toContainText('draft');
  expect(
    await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), Object.keys(kept))
  ).toEqual(Object.values(kept));

  await field.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/threadId=%24|threadId=\$/, { timeout: 30_000 });
  const sent = await openedEvent(page, reader, engineering);
  expect(sent.sender).toBe(reader.userId);
  expect(sent.content.body).toBe('Summarize the open incidents');
  expect(sent.content['m.mentions']).toEqual({ user_ids: [helper.userId] });
  // A root: no thread, no reply, though the room kept one.
  expect(sent.content['m.relates_to']).toBeUndefined();
});

test('an agent never used gets its direct chat started, which waits for the agent to join', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const username = `home_dm_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);
  const quill = await registerAgent('quill', 'Quill');
  await agentRoom(reader, 'Lobby', [quill]);

  await signIn(page, username);
  await expect(page.getByRole('button', { name: 'In Direct chat' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Ask Quill anything…' }).click();
  // The chat is made, but takes no question until Quill is in it.
  const waiting = page.getByRole('button', { name: 'Waiting for Quill to join the chat…' });
  await expect(waiting).toBeDisabled({ timeout: 30_000 });
  const field = page.locator('[data-editable-name="RoomInput"]');
  await expect(field).toHaveCount(0);
  const direct = await matrixFetch<Record<string, string[]>>(
    HOMESERVER,
    `/user/${encodeURIComponent(reader.userId)}/account_data/m.direct`,
    { accessToken: reader.accessToken }
  );
  const [dmId] = direct[quill.userId] ?? [];
  expect(dmId).toBeTruthy();
  if (!dmId) throw new Error('Expected a direct chat room id');
  await joinRoom(HOMESERVER, quill.accessToken, dmId);

  await expect(field).toBeFocused({ timeout: 30_000 });
  await page.keyboard.type('Draft the release notes');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/direct\/.*threadId=/, { timeout: 30_000 });
  const sent = await openedEvent(page, reader, dmId);
  expect(sent.sender).toBe(reader.userId);
  // New direct chats are encrypted, so the plaintext body shows in the opened thread while the
  // server event still carries any relation in the clear.
  expect(sent.type).toBe('m.room.encrypted');
  expect(sent.content['m.relates_to']).toBeUndefined();
  await expect(
    page.locator('[data-body-direction]').filter({ hasText: 'Draft the release notes' })
  ).toBeVisible({ timeout: 30_000 });
});

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('dropping a file onto Home stages it inline, survives room switches, and sends a mentioned thread', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const username = `home_drop_${RUN}`;
  const reader = await registerDisposableUser(username, PASSWORD);
  const helper = await registerAgent('helper_drop', 'Helper');
  const engineering = await agentRoom(reader, 'Engineering', [helper]);
  const lobby = await agentRoom(reader, 'Lobby', [helper]);
  await answeredThread(reader, helper, engineering, 'Check the diagram');

  await signIn(page, username);
  await expect(page.getByRole('button', { name: `In Engineering ${RUN}` })).toBeVisible({
    timeout: 60_000,
  });

  const heading = page.getByRole('heading', { level: 1 });
  await heading.evaluate((el, b64) => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    data.items.add(new File([bytes], 'note.png', { type: 'image/png' }));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      el.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
      );
    }
  }, TINY_PNG_B64);

  const card = page.getByText('note.png');
  await expect(card).toBeVisible({ timeout: 30_000 });
  const field = page.locator('[data-editable-name="RoomInput"]');
  const [hBox, cBox, fBox] = await Promise.all([
    heading.boundingBox(),
    card.boundingBox(),
    field.boundingBox(),
  ]);
  expect(cBox!.y).toBeGreaterThanOrEqual(hBox!.y + hBox!.height - 1);
  expect(cBox!.y + cBox!.height).toBeLessThanOrEqual(fBox!.y + 1);

  await page.getByRole('button', { name: `In Engineering ${RUN}` }).click();
  await page.getByRole('menuitemradio', { name: `Lobby ${RUN}` }).click();
  await expect(card).toBeVisible();

  await field.click();
  await page.keyboard.type('Please inspect this chart');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/threadId=%24|threadId=\$/, { timeout: 30_000 });

  const root = await openedEvent(page, reader, lobby);
  const rootId = new URL(page.url()).searchParams.get('threadId') ?? '';
  expect(root.content).toMatchObject({
    msgtype: 'm.image',
    body: 'note.png',
    'm.mentions': { user_ids: [helper.userId] },
  });
  expect(root.content['m.relates_to']).toBeUndefined();

  await expect
    .poll(
      async () => {
        const { chunk } = await matrixFetch<{ chunk: Array<{ content: Record<string, unknown> }> }>(
          HOMESERVER,
          `/rooms/${encodeURIComponent(lobby)}/messages?dir=b&limit=10`,
          { accessToken: reader.accessToken }
        );
        return chunk.find((e) => e.content.body === 'Please inspect this chart')?.content;
      },
      { timeout: 30_000 }
    )
    .toMatchObject({
      msgtype: 'm.text',
      'm.mentions': { user_ids: [helper.userId] },
      'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
    });
});
