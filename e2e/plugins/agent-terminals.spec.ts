import {
  clientSessionToken,
  expect,
  messageRow,
  openThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
} from '../helpers/agentStack';

// The agent stack with --terminals (scripts/agent-stack/stack.py's docstring): the stub's #terminal makes the
// helper open a terminal in the slot's sandbox runner and run an echo in it. The backend's terminal routes then
// list that terminal as one the tester may type in, and its stream shows what the echo printed and what the
// tester types. A MindRoom without the terminal toolkit skips it.
test.use({ agentStackArgs: ['--terminals'] });
test.describe.configure({ timeout: 300_000 });

// What #terminal's `echo stub-terminal-$((6 * 7))` prints, which its typed line does not hold.
const MARKER = 'stub-terminal-42';

type Terminal = { agent_user_id: string; id: string; alive: boolean; writable: boolean };

/** The terminals the backend's routes list in `room` for the session `token`. */
const listTerminals = async (room: string, token: string): Promise<Terminal[]> => {
  const listed = await fetch(`${room}/terminals`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(listed.status).toBe(200);
  return ((await listed.json()) as { terminals: Terminal[] }).terminals;
};

test("the helper runs a command in a terminal, which the backend's terminal routes show", async ({
  page,
  stack,
}) => {
  const token = await clientSessionToken(stack);
  const room = `${stack.apiUrl}/api/rooms/${encodeURIComponent(stack.rooms.lobby)}`;
  // A reused stack keeps the terminals of earlier runs, so the test looks at the one it opens.
  const before = (await listTerminals(room, token)).map(({ id }) => id);
  const rootId = await startThread(stack, `${uniqueWord('terminal')} #terminal`);
  await openThread(page, stack, rootId);
  const reply = await waitForAgentReply(stack, rootId, (body) => body.includes(MARKER), {
    timeout: 120_000,
  });
  await expect(messageRow(page, reply.event_id)).toContainText(MARKER);

  const opened = (await listTerminals(room, token)).filter(({ id }) => !before.includes(id));
  expect(opened).toEqual([
    expect.objectContaining({ agent_user_id: stack.agents.helper, alive: true, writable: true }),
  ]);
  const terminal = `${room}/agents/${encodeURIComponent(
    stack.agents.helper
  )}/terminals/${encodeURIComponent(opened[0]?.id ?? '')}`;

  // The stream admits only the slot's Chat as origin, so the page opens it.
  const stream = terminal.replace(/^http/, 'ws');
  // It resolves only once the terminal showed the marker, then what the tester typed.
  await page.evaluate(
    ({ url, session, marker }) =>
      new Promise<void>((resolve, reject) => {
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
            resolve();
          }
        };
        socket.onclose = ({ code }) => {
          clearTimeout(timer);
          reject(new Error(`the terminal stream closed with ${code}: ${text}`));
        };
      }),
    { url: stream, session: token, marker: MARKER }
  );
  // Closed, so runs on a reused stack never fill the workspace's terminals.
  const closed = await fetch(terminal, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(closed.status).toBe(204);
});
