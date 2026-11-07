import type { Locator, Page } from '@playwright/test';
import { sendRoomMessage } from '../helpers/matrix';
import {
  composer,
  createAgentRoom,
  expect,
  openLobby,
  readRouterWelcome,
  routerToken,
  test,
  uniqueWord,
} from '../helpers/agentStack';

// A room is unread only for what its thread lists show. An agent's notice that does not carry
// `io.mindroom.conversation: true` stays out of them, such as a status line, so it leaves its room
// read; a marked one lists as a conversation and makes its room unread. Runs against the agent
// stack (scripts/agent-stack/stack.py) with the stub model, where the router is that agent;
// MindRoom's agents never answer a notice. Skips without a MindRoom checkout.

/** The room's row in the room list; `data-highlight` says whether it shows as unread. */
const roomRow = (page: Page, name: string): Locator =>
  page.locator('[data-highlight]').filter({ has: page.getByRole('link', { name }) });

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

  const agent = routerToken(stack);
  const send = (roomId: string, body: string, marked: boolean) =>
    sendRoomMessage(stack.homeserver, agent, roomId, {
      msgtype: 'm.notice',
      body,
      ...(marked ? { 'io.mindroom.conversation': true } : {}),
    });
  await send(ids.unmarked, `${word} indexing finished`, false);
  await send(ids.marked, `${word} weekly report`, true);

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
