import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';

// While an agent replies in a thread, holding Send opens Steer, Queue and Auto; the message goes
// out with the mode picked as `io.mindroom.mid_turn` (mindroom#4074), and a tap sends the Chats
// setting's default, Auto, which the backend also takes for a message without the key. Against the disposable homeserver of a slot (scripts/e2e-slot.sh):
//   scripts/e2e-slot.sh <slot> npx playwright test e2e/composer/send-mid-turn-mode.spec.ts

const PASSWORD = 'send-mid-turn-mode-password';
const RUN = Date.now().toString(36);
const QUESTION = 'Which harbour lights still need new bulbs?';
const STREAMING = 'Checking the maintenance log for the harbour lights.';

type RoomEvent = { type: string; sender: string; content: Record<string, unknown> };

/** A reader's thread with a question, and an agent's reply to it that is still streaming. */
const seed = async () => {
  const reader = await registerDisposableUser(`midturn_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'harbour');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Harbour Desk',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: QUESTION,
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: STREAMING,
    'io.mindroom.stream_status': 'streaming',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  return { reader, roomId, rootId };
};

/** The content of the reader's message whose body is `body`, once the server has it. */
const sentContent = async (accessToken: string, roomId: string, body: string) => {
  let found: Record<string, unknown> | undefined;
  await expect
    .poll(
      async () => {
        const { chunk } = await matrixFetch<{ chunk: RoomEvent[] }>(
          HOMESERVER,
          `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`,
          { accessToken }
        );
        found = chunk.find(
          (event) => event.type === 'm.room.message' && event.content.body === body
        )?.content;
        return found !== undefined;
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  return found!;
};

const composer = (page: Page) => page.locator('[data-editable-name="RoomInput"]').last();
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send message' }).last();

/** Holds the mouse on Send past the long press, then lets go. */
const holdSend = async (page: Page) => {
  const box = await sendButton(page).boundingBox();
  if (!box) throw new Error('Send is not on the page');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('holding Send while an agent replies sends the mode picked', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { reader, roomId, rootId } = await seed();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.getByText(STREAMING).last()).toBeVisible({ timeout: 60_000 });

  await composer(page).click();
  await page.keyboard.type('Also check the north pier.');
  await holdSend(page);
  const menu = page.getByRole('menu', { name: 'Send while the agent replies' });
  await expect(menu).toBeVisible();
  // The hold sent nothing: the text waits in the composer for a pick.
  await expect(composer(page)).toContainText('Also check the north pier.');
  await menu.getByRole('menuitem', { name: 'Queue' }).click();
  await expect(menu).toBeHidden();
  const queued = await sentContent(reader.accessToken, roomId, 'Also check the north pier.');
  expect(queued['io.mindroom.mid_turn']).toBe('queue');
  expect(queued['m.relates_to']).toMatchObject({ rel_type: 'm.thread', event_id: rootId });

  // A tap sends with the default.
  await composer(page).click();
  await page.keyboard.type('And the south breakwater.');
  await sendButton(page).click();
  const tapped = await sentContent(reader.accessToken, roomId, 'And the south breakwater.');
  expect(tapped['io.mindroom.mid_turn']).toBe('auto');
});
