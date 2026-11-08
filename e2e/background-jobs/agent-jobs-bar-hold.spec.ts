import { writeFileSync } from 'node:fs';
import { jobsBarChanges, watchJobsBar } from '../helpers/jobsBar';
import { matrixFetch } from '../helpers/matrix';
import {
  expect,
  openLobby,
  sendFromComposer,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';

// An agent that thinks longer than the jobs bar's 2 s hold between two tool calls of one reply: the
// bar stays through the pause, showing the call that ended as finished, and goes 2 s after the reply
// ends. The stub's `#pause` scenario makes two shell calls with 3.5 s of thinking between them.
// Chromium and, tagged `@webkit` for the WebKit project, WebKit; a desktop and a phone.
test.describe.configure({ timeout: 300_000 });

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, hasTouch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true },
];
const RUNNING = 'Running: run_shell_command';
const FINISHED = 'Finished: run_shell_command';

/** When the homeserver received the edit that finished the reply, by the same clock as the page's. */
const replyEndedAt = async (stack: AgentStack, replyId: string): Promise<number> => {
  const { chunk } = await matrixFetch<{ chunk: MatrixEvent[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(stack.rooms.lobby)}/messages?dir=b&limit=200`,
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
        const reply = await waitForAgentReply(
          stack,
          rootId,
          (body) => /Finished \W*pause/.test(body),
          { timeout: 120_000 }
        );
        const ended = await replyEndedAt(stack, reply.event_id);
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
        // The first call runs, ends and stays as finished through the pause; then the second.
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
      }
    );
  });
}
