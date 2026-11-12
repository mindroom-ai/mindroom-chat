import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, loginToMatrix, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';

// The room menu's "Show tool calls" switch leaves the tool-call lines out of every agent reply,
// keeps the reply's text, and stays off after a reload; switching it on brings the lines back.
// Set TOOL_CALLS_SHOTS=<directory> to save the thread and the open menu.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'tool-calls-toggle-spec-password';
const RUN = Date.now().toString(36);
const ANSWER = 'Q3 monthly churn came in at 2.9%, down from 3.4% in Q2.';
const SHOTS = process.env.TOOL_CALLS_SHOTS;

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/** A thread where an agent answered after running two tools. */
const seed = async () => {
  const username = `tct_reader_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  const reader = await loginToMatrix(HOMESERVER, username, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'research');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Churn report',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Compare our Q3 churn against SaaS benchmarks.',
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: `🔧 \`web_search\` [1]\n\n🔧 \`run_python_code\` [2]\n\n${ANSWER}`,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>🔧 <code>web_search</code> [1]</p><p>🔧 <code>run_python_code</code> [2]</p><p>${ANSWER}</p>`,
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.tool_trace': {
      version: 2,
      events: [
        { type: 'tool_call_completed', tool_name: 'web_search', result_preview: '8 results' },
        { type: 'tool_call_completed', tool_name: 'run_python_code', result_preview: '0.029' },
      ],
    },
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  return { username, roomId, rootId };
};

const toolLines = (page: Page) =>
  page.locator('[data-message-disclosure] > button').filter({ hasText: 'web_search' });

/** Chooses the room menu's tool calls switch, checking it showed `checked` before. */
const switchToolCalls = async (page: Page, checked: boolean) => {
  await page.getByRole('button', { name: 'More Options' }).click();
  const entry = page.getByRole('menuitemcheckbox', { name: 'Show tool calls' });
  await expect(entry).toHaveAttribute('aria-checked', String(checked));
  await shot(page, `menu-${checked ? 'shown' : 'hidden'}`);
  await entry.click();
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test("the room menu shows or hides an agent reply's tool calls", async ({ page }) => {
  test.setTimeout(180_000);
  const world = await seed();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.username,
    password: PASSWORD,
  });
  await page.goto(
    `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`
  );
  const answer = page.getByText(ANSWER, { exact: true });
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(toolLines(page)).toHaveCount(1);

  await switchToolCalls(page, true);
  await expect(toolLines(page)).toHaveCount(0);
  await expect(answer).toBeVisible();
  await shot(page, 'thread-hidden');

  await page.reload();
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(toolLines(page)).toHaveCount(0);

  await switchToolCalls(page, false);
  await expect(toolLines(page)).toHaveCount(1);
});
