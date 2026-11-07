import { matrixFetch } from '../helpers/matrix';
import {
  composer,
  expect,
  sendFromComposer,
  test,
  uniqueWord,
  type AgentStack,
} from '../helpers/agentStack';
import { expectRoomCompact } from '../helpers/roomViewSwitch';

// The real MindRoom backend publishes each room's effective thread mode as room state
// `io.mindroom.thread_mode` (state key "", MindRoom #3729): its router writes `thread` once the
// helper agent, which answers in threads, has joined, and `room` after the room's admin sends
// `!thread_mode room`. The client opens the room in Compact while the state says `thread`, moves the
// open room to the Threads view when it says `room`, and back when `!thread_mode reset` restores
// the configured mode, as long as the reader has not chosen a view. Runs against the agent stack
// (scripts/agent-stack/stack.py) with the stub model; skips without a MindRoom checkout.
const THREAD_MODE = 'io.mindroom.thread_mode';

/** The mode the room's current `io.mindroom.thread_mode` state names, or undefined. */
const publishedMode = async (stack: AgentStack, roomId: string): Promise<string | undefined> => {
  try {
    const content = await matrixFetch<{ mode?: string }>(
      stack.homeserver,
      `/rooms/${encodeURIComponent(roomId)}/state/${THREAD_MODE}/`,
      { accessToken: stack.tester.accessToken }
    );
    return content.mode;
  } catch {
    return undefined;
  }
};

const joinedMembers = async (stack: AgentStack, roomId: string): Promise<string[]> => {
  const { joined } = await matrixFetch<{ joined: Record<string, unknown> }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/joined_members`,
    { accessToken: stack.tester.accessToken }
  );
  return Object.keys(joined);
};

/**
 * A room of the tester's with the router, which may write the room's state, and then the helper.
 * The router publishes the mode when a responder's membership changes in a room it is in; joining
 * a room it was invited to does not publish (MindRoom main 42e66ba76), so the router goes first.
 */
const createAgentRoom = async (stack: AgentStack): Promise<string> => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(
    stack.homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({
        name: `Support desk ${uniqueWord('mode')}`,
        preset: 'private_chat',
        invite: [stack.agents.router],
        // The creator holds the room by its version's rules; the router gets the power to write
        // the room's state, as in rooms MindRoom creates.
        power_level_content_override: { users: { [stack.agents.router]: 100 } },
      }),
    }
  );
  await expect
    .poll(() => joinedMembers(stack, roomId), { timeout: 60_000, message: 'the router joins' })
    .toContain(stack.agents.router);
  await matrixFetch(stack.homeserver, `/rooms/${encodeURIComponent(roomId)}/invite`, {
    method: 'POST',
    accessToken: stack.tester.accessToken,
    body: JSON.stringify({ user_id: stack.agents.helper }),
  });
  return roomId;
};

test('the room view follows the thread mode MindRoom publishes', async ({ page, stack }) => {
  test.setTimeout(300_000);
  const roomId = await createAgentRoom(stack);
  await expect
    .poll(() => publishedMode(stack, roomId), {
      timeout: 120_000,
      message: 'the router publishes the thread mode once the helper joined',
    })
    .toBe('thread');

  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await expectRoomCompact(page, true);
  await page.screenshot({ path: test.info().outputPath('thread-mode-thread.png') });

  // The room's admin moves its agents to the main timeline.
  await sendFromComposer(page, '!thread_mode room');
  await expect
    .poll(() => publishedMode(stack, roomId), { timeout: 60_000, message: 'room published' })
    .toBe('room');
  await expectRoomCompact(page, false);
  await page.screenshot({ path: test.info().outputPath('thread-mode-room.png') });

  // Back to the configured mode.
  await sendFromComposer(page, '!thread_mode reset');
  await expect
    .poll(() => publishedMode(stack, roomId), { timeout: 60_000, message: 'thread published' })
    .toBe('thread');
  await expectRoomCompact(page, true);
});
