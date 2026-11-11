import {
  expect,
  messageRow,
  openThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  type AgentStack,
} from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';

// The agent stack with --terminals (scripts/agent-stack/stack.py's docstring): the stub's #terminal makes the
// helper open a terminal in the slot's sandbox runner and run an echo in it. The backend's terminal routes then
// list that terminal as one the tester may type in, and its stream shows what the echo printed and what the
// tester types. A MindRoom without the terminal toolkit skips it.
test.use({ agentStackArgs: ['--terminals'] });
test.describe.configure({ timeout: 300_000 });

// What #terminal's `echo stub-terminal-$((6 * 7))` prints, which its typed line does not hold.
const MARKER = 'stub-terminal-42';

type Terminal = { agent_user_id: string; id: string; alive: boolean; writable: boolean };

/** A client session of the tester's own with the stack's backend, for a token bound to its API. */
const signIn = async (stack: AgentStack): Promise<string> => {
  const openIdToken = await matrixFetch<Record<string, unknown>>(
    stack.homeserver,
    `/user/${encodeURIComponent(stack.tester.userId)}/openid/request_token`,
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({ 'io.mindroom.audience': new URL(stack.apiUrl).origin }),
    }
  );
  const response = await fetch(`${stack.apiUrl}/api/client-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openid_token: openIdToken }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { session_token: string }).session_token;
};

test("the helper runs a command in a terminal, which the backend's terminal routes show", async ({
  page,
  stack,
}) => {
  const rootId = await startThread(stack, `${uniqueWord('terminal')} #terminal`);
  await openThread(page, stack, rootId);
  const reply = await waitForAgentReply(stack, rootId, (body) => body.includes(MARKER), {
    timeout: 120_000,
  });
  await expect(messageRow(page, reply.event_id)).toContainText(MARKER);

  const token = await signIn(stack);
  const room = `${stack.apiUrl}/api/rooms/${encodeURIComponent(stack.rooms.lobby)}`;
  const listed = await fetch(`${room}/terminals`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(listed.status).toBe(200);
  const { terminals } = (await listed.json()) as { terminals: Terminal[] };
  expect(terminals).toEqual([
    expect.objectContaining({ agent_user_id: stack.agents.helper, alive: true, writable: true }),
  ]);

  // The stream admits only the slot's Chat as origin, so the page opens it.
  const stream = `${room.replace(/^http/, 'ws')}/agents/${encodeURIComponent(
    stack.agents.helper
  )}/terminals/${encodeURIComponent(terminals[0]?.id ?? '')}`;
  const shown = await page.evaluate(
    ({ url, session, marker }) =>
      new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(url, ['mindroom-session', `mindroom-session.${session}`]);
        socket.binaryType = 'arraybuffer';
        const decoder = new TextDecoder();
        let text = '';
        let typed = false;
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error(`the terminal showed only: ${text}`));
        }, 30_000);
        socket.onmessage = ({ data }) => {
          if (typeof data === 'string') return;
          text += decoder.decode(data as ArrayBuffer, { stream: true });
          if (!typed && text.includes(marker)) {
            typed = true;
            socket.send(JSON.stringify({ type: 'input', data: 'echo tester-$((20 + 1))\r' }));
          }
          if (typed && text.includes('tester-21')) {
            clearTimeout(timer);
            socket.close();
            resolve(text);
          }
        };
        socket.onclose = ({ code }) => {
          clearTimeout(timer);
          reject(new Error(`the terminal stream closed with ${code}: ${text}`));
        };
      }),
    { url: stream, session: token, marker: MARKER }
  );
  expect(shown).toContain(MARKER);
  expect(shown).toContain('tester-21');
});
