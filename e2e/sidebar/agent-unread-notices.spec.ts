import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import {
  composer,
  createAgentRoom,
  createEncryptedAgentRoom,
  expect,
  openLobby,
  openNewSession,
  readRouterWelcome,
  routerToken,
  sendFromComposer,
  test,
  uniqueWord,
  type AgentStack,
} from '../helpers/agentStack';

// A room with a MindRoom agent is unread only for what its thread lists show. A notice that does
// not carry `io.mindroom.conversation: true` from an agent stays out of them, such as a status
// line, so it leaves its room read; an agent's marked one lists as a conversation and makes its
// room unread. Runs against the agent stack (scripts/agent-stack/stack.py) with the stub model,
// where the router is that agent; MindRoom's agents never answer a notice. Skips without a
// MindRoom checkout.

/** The room's row in the room list; `data-highlight` says whether it shows as unread. */
const roomRow = (page: Page, name: string): Locator =>
  page.locator('[data-highlight]').filter({ has: page.getByRole('link', { name }) });

/** The router sends a notice to the room, with the conversation mark when `marked`. */
const sendNotice = (stack: AgentStack, roomId: string, body: string, marked: boolean) =>
  sendRoomMessage(stack.homeserver, routerToken(stack), roomId, {
    msgtype: 'm.notice',
    body,
    ...(marked ? { 'io.mindroom.conversation': true } : {}),
  });

test("an agent's notice makes its room unread only when marked", async ({ page, stack }) => {
  test.setTimeout(300_000);
  const word = uniqueWord('unread');
  // Home lists both rooms; they are in no space. The router's welcome is read in each.
  const rooms = { unmarked: `${word} status`, marked: `${word} reports` };
  const ids = {
    unmarked: await createAgentRoom(stack, rooms.unmarked, false),
    marked: await createAgentRoom(stack, rooms.marked, false),
  };
  await readRouterWelcome(stack, ids.unmarked);
  await readRouterWelcome(stack, ids.marked);

  await openLobby(page, stack);
  for (const name of Object.values(rooms)) {
    await expect(roomRow(page, name)).toHaveAttribute('data-highlight', 'false', {
      timeout: 60_000,
    });
  }

  await sendNotice(stack, ids.unmarked, `${word} indexing finished`, false);
  await sendNotice(stack, ids.marked, `${word} weekly report`, true);

  // The unmarked notice was sent first, so the client holds it once the marked one shows.
  const expectRooms = async () => {
    await expect(roomRow(page, rooms.marked)).toHaveAttribute('data-highlight', 'true', {
      timeout: 90_000,
    });
    await expect(roomRow(page, rooms.unmarked)).toHaveAttribute('data-highlight', 'false');
  };

  // Arriving live, and again from the stored timeline after a reload.
  await expectRooms();
  await page.screenshot({ path: test.info().outputPath('unread-notices-live.png') });
  await page.reload({ timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await expectRooms();
  await page.screenshot({ path: test.info().outputPath('unread-notices-reload.png') });
});

test('a notice in an encrypted agent room leaves the room read once it decrypts', async ({
  page,
  stack,
  browser,
}) => {
  test.setTimeout(420_000);
  const word = uniqueWord('sealed');
  const rooms = { sealed: `${word} sealed`, anchor: `${word} anchor` };
  const ids = {
    sealed: await createEncryptedAgentRoom(stack, rooms.sealed),
    anchor: await createAgentRoom(stack, rooms.anchor, false),
  };
  // A person of the homeserver joins the encrypted room and sends the notice from their own
  // device, so it reaches the tester encrypted.
  const person = { username: `${word}_person`, password: randomUUID() };
  const { access_token: personToken, user_id: personId } = await matrixFetch<{
    access_token: string;
    user_id: string;
  }>(stack.homeserver, '/register', {
    method: 'POST',
    body: JSON.stringify({ ...person, auth: { type: 'm.login.dummy' } }),
  });
  await matrixFetch(stack.homeserver, `/rooms/${encodeURIComponent(ids.sealed)}/invite`, {
    method: 'POST',
    accessToken: stack.tester.accessToken,
    body: JSON.stringify({ user_id: personId }),
  });
  await joinRoom(stack.homeserver, personToken, ids.sealed);
  await readRouterWelcome(stack, ids.sealed);
  await readRouterWelcome(stack, ids.anchor);

  await openLobby(page, stack);
  for (const name of Object.values(rooms)) {
    await expect(roomRow(page, name)).toHaveAttribute('data-highlight', 'false', {
      timeout: 60_000,
    });
  }

  const personPage = await openNewSession(browser, stack, {}, person);
  await personPage.goto(`/home/${encodeURIComponent(ids.sealed)}`, { timeout: 180_000 });
  await expect(composer(personPage)).toBeVisible({ timeout: 90_000 });
  await sendFromComposer(personPage, `/notice ${word} build finished`);
  await expect
    .poll(
      async () => {
        const { chunk } = await matrixFetch<{ chunk: { sender: string; type: string }[] }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(ids.sealed)}/messages?dir=b&limit=10`,
          { accessToken: stack.tester.accessToken }
        );
        return chunk.some((e) => e.sender === personId && e.type === 'm.room.encrypted');
      },
      { timeout: 60_000, intervals: [500, 1000], message: "the person's encrypted notice" }
    )
    .toBe(true);

  // The anchor's marked notice was sent after the encrypted one, so the tester's client holds
  // both once the anchor room shows unread; the encrypted room then reads once its notice decrypts.
  await sendNotice(stack, ids.anchor, `${word} weekly report`, true);
  const expectSealedRead = async () => {
    await expect(roomRow(page, rooms.anchor)).toHaveAttribute('data-highlight', 'true', {
      timeout: 90_000,
    });
    let read = 0;
    await expect
      .poll(
        async () => {
          const shown = await roomRow(page, rooms.sealed).getAttribute('data-highlight');
          read = shown === 'false' ? read + 1 : 0;
          return read >= 3;
        },
        { timeout: 60_000, intervals: [1000], message: 'the encrypted room stays read' }
      )
      .toBe(true);
  };

  // Arriving live, and again after a reload, where the stored notice decrypts once more.
  await expectSealedRead();
  await page.screenshot({ path: test.info().outputPath('unread-notices-encrypted.png') });
  await page.reload({ timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await expectSealedRead();
  await page.screenshot({ path: test.info().outputPath('unread-notices-encrypted-reload.png') });
});
