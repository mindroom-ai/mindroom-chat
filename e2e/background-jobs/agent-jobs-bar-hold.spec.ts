import { writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { jobsBarChanges, watchJobsBar } from '../helpers/jobsBar';
import { matrixFetch, sendReaction, sendRoomMessage } from '../helpers/matrix';
import {
  composer,
  expect,
  openLobby,
  sendFromComposer,
  showThread,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';
import { expectRoomCompact } from '../helpers/roomViewSwitch';

// An agent that thinks longer than the jobs bar's 2 s hold between two tool calls of one reply: the
// bar stays through the pause, showing the call that ended as finished, and goes 2 s after the reply
// ends. The stub's `#pause` scenario makes two shell calls with 3.5 s of thinking between them.
// In a thread, in the main timeline of a room whose agents answer there (`!thread_mode room`), and
// in a thread where another agent's reply streams on after the helper's: the bar follows the
// helper's own reply, not that one.
// Chromium and, tagged `@webkit` for the WebKit project, WebKit; a desktop and a phone.
test.describe.configure({ timeout: 300_000 });

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, hasTouch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true },
];
const RUNNING = 'Running: run_shell_command';
const FINISHED = 'Finished: run_shell_command';
const PAUSE_FINISHED = /Finished \W*pause/;

/** When the homeserver received the edit that finished the reply, by the same clock as the page's. */
const replyEndedAt = async (stack: AgentStack, roomId: string, replyId: string): Promise<number> => {
  const { chunk } = await matrixFetch<{ chunk: MatrixEvent[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=200`,
    { accessToken: stack.tester.accessToken }
  );
  const ends = chunk
    .filter((event) => {
      const relation = event.content['m.relates_to'] as
        | { rel_type?: string; event_id?: string }
        | undefined;
      const content = event.content['m.new_content'] as Record<string, unknown> | undefined;
      return (
        relation?.rel_type === 'm.replace' &&
        relation.event_id === replyId &&
        content?.['io.mindroom.stream_status'] === 'completed'
      );
    })
    .map((event) => event.origin_server_ts);
  expect(ends.length, 'the edit that finished the reply').toBeGreaterThan(0);
  return Math.min(...ends);
};

/** The helper's finished `#pause` reply in a room where it is the only one, once it finished. */
const finishedMainReply = async (stack: AgentStack, roomId: string): Promise<string> => {
  let replyId: string | undefined;
  await expect
    .poll(
      async () => {
        const { chunk } = await matrixFetch<{ chunk: MatrixEvent[] }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=200`,
          { accessToken: stack.tester.accessToken }
        );
        const end = chunk.find((event) => {
          const content = event.content['m.new_content'] as Record<string, unknown> | undefined;
          return (
            event.sender === stack.agents.helper &&
            content?.['io.mindroom.stream_status'] === 'completed' &&
            PAUSE_FINISHED.test(String(content.body ?? ''))
          );
        });
        replyId = (end?.content['m.relates_to'] as { event_id?: string } | undefined)?.event_id;
        return !!replyId;
      },
      { timeout: 120_000, intervals: [500, 1000], message: "the helper's finished reply" }
    )
    .toBe(true);
  return replyId!;
};

/**
 * The bar's titles from the first call on, which must be the two calls each running and then
 * finished, then gone: the first call stays as finished through the pause, and the bar goes 2 s
 * after the reply ended.
 */
const expectHeldThroughPause = async (page: Page, testInfo: TestInfo, ended: number) => {
  await expect(page.getByRole('region', { name: /run_shell_command/ })).toBeHidden({
    timeout: 30_000,
  });
  const changes = await jobsBarChanges(page);
  writeFileSync(
    testInfo.outputPath('jobs-bar.json'),
    JSON.stringify({ replyEnded: ended, changes }, null, 2)
  );
  const shown = changes.findIndex((change) => change.label !== null);
  const seen = changes.slice(shown).map((change) => change.label);
  expect(seen, 'the jobs bar from the first call on').toEqual([
    RUNNING,
    FINISHED,
    RUNNING,
    FINISHED,
    null,
  ]);
  const at = (index: number) => changes[index]?.at ?? NaN;
  const pause = at(shown + 2) - at(shown + 1);
  expect(pause, 'ms the bar showed the first call as finished').toBeGreaterThan(2_500);
  const gone = at(changes.length - 1) - ended;
  expect(gone, 'ms from the reply’s end until the bar went').toBeGreaterThanOrEqual(1_900);
  expect(gone).toBeLessThan(15_000);
};

/** The mode the room's current `io.mindroom.thread_mode` state names, or undefined. */
const publishedMode = async (stack: AgentStack, roomId: string): Promise<string | undefined> => {
  try {
    const content = await matrixFetch<{ mode?: string }>(
      stack.homeserver,
      `/rooms/${encodeURIComponent(roomId)}/state/io.mindroom.thread_mode/`,
      { accessToken: stack.tester.accessToken }
    );
    return content.mode;
  } catch {
    return undefined;
  }
};

/**
 * A room of the tester's whose agents answer in its main timeline. The router joins first, with
 * the power to write the room's state, so it publishes the mode when the helper joins and again
 * when the room's admin sends `!thread_mode room`.
 */
const createMainTimelineRoom = async (stack: AgentStack): Promise<string> => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(
    stack.homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({
        name: `Build desk ${uniqueWord('main')}`,
        preset: 'private_chat',
        invite: [stack.agents.router],
        power_level_content_override: { users: { [stack.agents.router]: 100 } },
      }),
    }
  );
  const joined = async () =>
    Object.keys(
      (
        await matrixFetch<{ joined: Record<string, unknown> }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/joined_members`,
          { accessToken: stack.tester.accessToken }
        )
      ).joined
    );
  await expect
    .poll(joined, { timeout: 60_000, message: 'the router joins' })
    .toContain(stack.agents.router);
  await matrixFetch(stack.homeserver, `/rooms/${encodeURIComponent(roomId)}/invite`, {
    method: 'POST',
    accessToken: stack.tester.accessToken,
    body: JSON.stringify({ user_id: stack.agents.helper }),
  });
  await expect
    .poll(() => publishedMode(stack, roomId), {
      timeout: 120_000,
      message: 'the router publishes the thread mode once the helper joined',
    })
    .toBe('thread');
  await sendRoomMessage(stack.homeserver, stack.tester.accessToken, roomId, {
    msgtype: 'm.text',
    body: '!thread_mode room',
  });
  await expect
    .poll(() => publishedMode(stack, roomId), { timeout: 60_000, message: 'room published' })
    .toBe('room');
  return roomId;
};

/** Asks one agent in the thread, with a mention, as the composer would send it. */
const askInThread = (
  stack: AgentStack,
  rootId: string,
  agent: string,
  name: string,
  text: string
) =>
  sendRoomMessage(stack.homeserver, stack.tester.accessToken, stack.rooms.lobby, {
    msgtype: 'm.text',
    body: `${name} ${text}`,
    'm.mentions': { user_ids: [agent] },
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

for (const { name, viewport, hasTouch } of VIEWPORTS) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch });

    test(
      'the jobs bar stays while the agent thinks between two calls, and goes 2 s after its reply',
      { tag: '@webkit' },
      async ({ page, stack }, testInfo) => {
        const word = uniqueWord('pause');
        await openLobby(page, stack);
        const rootId = await startThread(stack, `${word} hello`);
        await waitForAgentReply(stack, rootId, (body) => body.includes('You said'));
        await showThread(page, stack, rootId);
        await watchJobsBar(page);
        await sendFromComposer(page, `#pause ${word}`);
        const reply = await waitForAgentReply(stack, rootId, (body) => PAUSE_FINISHED.test(body), {
          timeout: 120_000,
        });
        const ended = await replyEndedAt(stack, stack.rooms.lobby, reply.event_id);
        await expectHeldThroughPause(page, testInfo, ended);
      }
    );

    test(
      'in a room whose agents answer in the main timeline, the jobs bar stays between two calls',
      { tag: '@webkit' },
      async ({ page, stack }, testInfo) => {
        const roomId = await createMainTimelineRoom(stack);
        await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
        await expect(composer(page)).toBeVisible({ timeout: 90_000 });
        // The room shows its main timeline, where the helper answers.
        await expectRoomCompact(page, false);
        await watchJobsBar(page);
        await sendRoomMessage(stack.homeserver, stack.tester.accessToken, roomId, {
          msgtype: 'm.text',
          body: `Helper #pause ${uniqueWord('main')}`,
          'm.mentions': { user_ids: [stack.agents.helper] },
        });
        const replyId = await finishedMainReply(stack, roomId);
        const ended = await replyEndedAt(stack, roomId, replyId);
        const reply = await matrixFetch<MatrixEvent>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(replyId)}`,
          { accessToken: stack.tester.accessToken }
        );
        expect(
          (reply.content['m.relates_to'] as { rel_type?: string } | undefined)?.rel_type,
          'the reply is in the main timeline'
        ).toBeUndefined();
        await expectHeldThroughPause(page, testInfo, ended);
      }
    );

    test(
      "the jobs bar goes 2 s after its own reply while another agent's reply streams on",
      { tag: '@webkit' },
      async ({ page, stack }, testInfo) => {
        const { scout } = stack.agents;
        test.skip(!scout, 'the stub stack has the second agent');
        const word = uniqueWord('pair');
        await openLobby(page, stack);
        const rootId = await startThread(stack, `${word} hello`);
        await waitForAgentReply(stack, rootId, (body) => body.includes('You said'));
        await showThread(page, stack, rootId);
        await watchJobsBar(page);
        // The scout streams 400 words; the helper makes its two calls beside it.
        await askInThread(stack, rootId, scout!, 'Scout', `#stopme ${word}`);
        const scoutReply = await waitForThreadEvent(
          stack,
          rootId,
          (event) =>
            event.sender === scout &&
            event.type === 'm.room.message' &&
            streamStatus(event) === 'streaming',
          { description: "the scout's streaming reply" }
        );
        await askInThread(stack, rootId, stack.agents.helper, 'Helper', `#pause ${word}`);
        try {
          const reply = await waitForAgentReply(stack, rootId, (body) => PAUSE_FINISHED.test(body), {
            timeout: 120_000,
          });
          const ended = await replyEndedAt(stack, stack.rooms.lobby, reply.event_id);
          await expectHeldThroughPause(page, testInfo, ended);
          const scoutNow = await waitForThreadEvent(
            stack,
            rootId,
            (event) => event.event_id === scoutReply.event_id
          );
          expect(streamStatus(scoutNow), 'the scout still streams after the bar went').toBe(
            'streaming'
          );
        } finally {
          // Stop the scout, as its Stop button would, so the next test finds it idle.
          await sendReaction(
            stack.homeserver,
            stack.tester.accessToken,
            stack.rooms.lobby,
            scoutReply.event_id,
            '🛑'
          );
          await waitForThreadEvent(
            stack,
            rootId,
            (event) =>
              event.event_id === scoutReply.event_id && streamStatus(event) !== 'streaming',
            { timeout: 60_000, description: "the scout's stopped reply" }
          );
        }
      }
    );
  });
}
